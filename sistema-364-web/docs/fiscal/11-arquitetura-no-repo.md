# Plano de Arquitetura — Emissão de NF-e (Modelo 55) — 364 Food Services

Baseado em leitura direta do repositório (`schema.sql`, migrações 22/27/31/35, `lib/`, `app/api/nfe/*`, `app/pedidos/*`, `tests/`) e nos cinco documentos de pesquisa já produzidos em `docs/fiscal/01` a `05`. Não refiz a pesquisa tributária/técnica — apoiei-me nela e cito onde ela já resolveu uma decisão.

---

## 1. Mapa do que já existe e pode ser reaproveitado

| Peça | Onde | O que reaproveitar |
|---|---|---|
| **Certificado A1 cifrado** | `lib/certificadoServer.js:117-129` (`obterCertificadoAtivo`) | Já devolve `{ pfx: Buffer, senha: string, meta }` a partir de `empregador_id`. É **a única porta de saída do pfx decifrado** (comentário na linha 115-116) — a assinatura XML e o mTLS da Fase 2/3 devem entrar exatamente por aqui, nunca decifrar de novo em outro lugar. |
| **Extração PKCS#12** | `lib/certificadoServer.js:60-87` (`inspecionarPfx`) | Já usa `node-forge` para extrair certificado + CNPJ do `.pfx`. `docs/fiscal/04-stack-node-emissor.md:37-58` mostra o mesmo padrão para extrair a chave privada — é código adicional na mesma função, não uma lib nova. |
| **Cifra AES-256-GCM** | `lib/certificadoServer.js:25-37` (`cifrar`/`decifrar`) | Padrão de chave (`CERTIFICADO_CHAVE`, 32 bytes base64) a repetir se algo novo precisar ser cifrado (ex.: nenhum campo novo deveria precisar, o pfx já cobre a assinatura). |
| **Cadastro de pessoa jurídica** | `supabase/atualizacao_31_empresas_pessoa_juridica.sql:1-14` + `atualizacao_11_ponto_cadastros.sql:33-46` | `empregadores` já tem `cnpj`, `inscricao_estadual`, `endereco/numero/complemento/bairro/cidade/uf/cep`, `codigo_municipio_ibge`, `regime_tributario` (`'simples'|'presumido'|'real'|'mei'`, check em `atualizacao_31:47-49`) e `cnae_principal`. **O bloco `emit` do XML está essencialmente pronto** — falta só mapear `regime_tributario='simples'` → `CRT=1`. |
| **Autorização por empresa** | `lib/autorizacao.js:27-38` (`garantirEmpresa`) e `:63-71` (`garantirColaborador`) | É o padrão de segurança citado no prompt — toda rota nova de NF-e de saída deve chamar `garantirEmpresa(sb, user, isAdmin, empresaId)` antes de tocar qualquer linha. Nota: `git status` mostra este arquivo **em movimento** nesta branch (`lib/nfe/autorizacao.js` deletado → `lib/autorizacao.js` novo) — importar do caminho novo. |
| **Autenticação de rota** | `lib/pontoServer.js:22-36` (`autorizarModulo`) | Todas as rotas de `app/api/nfe/*` chamam isso (`app/api/nfe/documentos/route.js:11`). Uma rota nova de emissão pediria um módulo próprio de permissão (`'nfe_emissao'` ou reaproveitar `'pedidos'`) na tabela `permissoes`. |
| **Parse de XML** | `lib/nfe/parseNFe.js` | É parser de **entrada** (lê `infNFe` existente). Não serve para montar XML de saída, mas o padrão de função pura sem I/O (`fast-xml-parser`, `XMLParser` com `attributeNamePrefix:'@_'`) é o mesmo a seguir para o **builder** de saída — inclusive reaproveitar a mesma instância de parser para os dois sentidos, se fizer sentido, ou pelo menos o mesmo estilo de `num()`/`digitos()`/`arredMoeda()` (linhas 19-33). |
| **Storage privado por chave** | `app/api/nfe/upload/route.js:84-87` | Padrão `path = \`${empresaId}/nfe/${chave}.xml\`` no bucket `recebimentos`. Para saída, replicar em bucket próprio (`nfe-saida` ou subpasta `${empresaId}/nfe-saida/${chave}/...`) — **não criar bucket compartilhado com o de entrada**, para não herdar `allowed_mime_types`/policies pensadas para o fluxo de entrada. |
| **RLS por empresa** | Toda migração desde a 06, com a função `empresas_permitidas()` (usada em `atualizacao_22:46`, `atualizacao_35:43` etc.) | Copiar a policy `"empresa_scoped_access"` literalmente — é o padrão de 100% das tabelas novas desde a atualização 06. |
| **Padrão de rota de API** | `app/api/nfe/documentos/route.js`, `app/api/nfe/upload/route.js`, `app/api/nfe/documentos/[chave]/preparar/route.js` | `export const runtime = 'nodejs'` (obrigatório: `node-forge`/crypto não rodam em Edge), `autorizarModulo` → `garantirEmpresa` → lógica → `NextResponse.json`. Erros sempre com `{ error: mensagem }` e `status` explícito. |
| **Padrão de função atômica no banco** | `atualizacao_35_conciliacao_bancaria.sql:190-479` (todas as `fn_*`) | Uma transação = uma função `plpgsql`, chamada por RPC da rota (nunca múltiplos `update` soltos da rota). `security definer` só quando a checagem interna precisa enxergar através do RLS de outra tabela (ver `fn_pedido_bloquear_edicao`, `atualizacao_27:73-90`, e o comentário de por quê). É exatamente o padrão que a numeração sequencial de NF-e (seção 3) precisa. |
| **Lock de linha para serializar** | `atualizacao_30_ficha_embalagem.sql:238-246` (`for share`) e `for update` em `atualizacao_35:259,278,325,371,424` | Já é idioma do projeto travar linha dentro de função seguranca-definer antes de decidir estado. A numeração de NF-e usa a mesma técnica (`for update` sobre o contador). |
| **Trigger de imutabilidade de pedido** | `atualizacao_27_pedidos_edicao.sql:73-167` | Pedido só edita itens/cabeçalho em `Pendente`; `Faturado`/`Enviado`/`Cancelado` travam. A emissão de NF-e deve **disparar a partir de um pedido já `Faturado`**, sem tocar nesse trigger. |
| **Fluxo de pedido é 100% client-side** | `app/pedidos/page.js:86-108` | `finalizar()` e `mudarStatus()` chamam `supabase.from('pedidos')` direto do browser (anon key + RLS), sem rota de API. **Isso não serve para emissão** — emissão precisa de service role, certificado e chamada SOAP, então é a primeira vez que o módulo Pedidos precisa de uma rota de servidor de verdade. |
| **Teste de migração em SQL puro** | `tests/migracao-35/verificar.sh` + `fixture.sql` + `cenarios.sql` | Sobe um Postgres descartável, roda a migração duas vezes (idempotência), roda `cenarios.sql`, extrai o rollback comentado por `sed` e confere que ele limpa só as tabelas certas (linhas 26-41). Replicar tal e qual para a migração 36. |
| **Teste de função pura em `.mjs`** | `tests/autorizacao.test.mjs:1-35`, `tests/nfe-parcelas.test.mjs`, `tests/extratos-matching.test.mjs` | `node --test`, sem framework, com um "Supabase de mentira" (`fakeSb`, linhas 19-35) quando a função só precisa de `.from().select().eq().maybeSingle()`. `package.json:9` roda só `tests/*.test.mjs` (não recursivo) — todo teste novo tem que ficar direto em `tests/`. |
| **Pesquisa tributária/técnica já feita** | `docs/fiscal/01` a `05` | Autorizador SVRS + URLs de produção/homologação (`03:20-60`), layout 4.00 + campos de ST + CST/CSOSN (`02`), CFOP por natureza de operação (`05`), avaliação de libs npm + recomendação de arquitetura (`04`), regras de ST/RO específicas de carne (`01`). Não repetir esta pesquisa — só citar. |

---

## 2. Lacunas — o que não existe e precisa ser criado

**Dados fiscais que faltam no cadastro:**
- `clientes` (`schema.sql:98-106`) só tem `nome, cnpj, tipo, contato, telefone` + `ativo` (`atualizacao_26:19`). **Não tem endereço, IE, indicador de IE, e-mail, município/UF** — nenhum dos campos obrigatórios do bloco `dest` do XML (`docs/fiscal/02:38`). Sem isso não dá para emitir para nenhum cliente cadastrado hoje.
- `produtos` (`schema.sql:40-50`) não tem `NCM`, `CEST`, `CFOP`, origem da mercadoria, GTIN. Confirmado por `grep -rn "ncm\|cfop"` no schema inteiro — zero ocorrências fora do parser de entrada.
- `empresas`/`empregadores` tem `regime_tributario` mas não tem **série de NF-e ativa** nem **ambiente padrão** (homologação/produção).

**Motor de regras fiscais**: não existe nenhuma tabela ou função que decida CSOSN/CFOP/MVA a partir de NCM+UF destino+regra de RO. O achado central de `docs/fiscal/01:83-91` (carne de abate próprio sai isenta por causa do imposto pago na entrada do animal vivo; carne comprada de terceiro ou embutido permanece em ST clássica com MVA 30-35%) **não tem hoje nenhum lugar no sistema para morar** — é regra de negócio nova, não dado de cadastro simples.

**Camada de emissão inteira**: não existe:
- montagem/serialização do XML da NF-e (builder);
- assinatura XML (`xml-crypto`+chave extraída do pfx — `docs/fiscal/04:35-73`);
- transporte SOAP 1.2 com mTLS (`docs/fiscal/03:96-129`);
- tratamento de retorno/rejeição;
- geração de chave de acesso + DV;
- numeração sequencial sem colisão;
- máquina de estados da nota;
- eventos (cancelamento, CC-e, inutilização — não confundir com a manifestação do destinatário, que é do módulo de entrada e já existe conceitualmente);
- DANFE em PDF;
- fila/retentativa pós-timeout.

**Rota de disparo**: Pedidos não tem `app/api/pedidos/*` — é tudo Supabase direto do client (`app/pedidos/page.js:44-108`). É preciso criar a primeira rota de servidor do módulo Pedidos só para isto.

**Permissão**: não existe módulo `'nfe_emissao'` (ou equivalente) na tabela `permissoes` — hoje só `'recebimentos'` é usado pelas rotas de NF-e (entrada).

**Financeiro de saída**: não existe `contas_a_receber` (só `contas_a_pagar`, `atualizacao_16`). Fora de escopo desta migração, mas relevante: emitir NF-e de venda hoje **não gera título a receber automaticamente** em lugar nenhum do sistema — é uma lacuna do módulo Pedidos como um todo, não desta migração especificamente; registro no plano, não ação aqui.

---

## 3. Modelo de dados — migração 36

Próximo número livre confirmado por `ls supabase/` → última é `atualizacao_35_conciliacao_bancaria.sql`, então **`atualizacao_36_nfe_emissao.sql`**.

### Decisões de design (com justificativa)

**Numeração sequencial sem buraco nem colisão**: recomendo **tabela de contador com lock de linha (`for update`) dentro da mesma função `security definer` que já grava a chave e insere o rascunho**, não `pg_advisory_xact_lock` isolado e não `SEQUENCE`.
- `SEQUENCE` está descartada: `docs/fiscal/04:132` confirma que `nextval()` nunca reverte em rollback — gera buraco a cada tentativa de emissão que falhar antes de chegar à SEFAZ, o que aqui é o caminho comum (rejeição de schema, item mal formado etc.), não a exceção.
- Entre lock de linha e `pg_advisory_xact_lock`, escolho **lock de linha** porque o projeto já usa esse idioma extensivamente (`for update`/`for share` em `atualizacao_27`, `atualizacao_30`, `atualizacao_35`) e porque aqui a linha travada (`nfe_series`) é também o dado de negócio que precisa ser lido e atualizado (`ultimo_numero`) — não é só uma trava, é a própria contagem. `pg_advisory_xact_lock` exigiria uma segunda fonte de verdade para o número em si; lock de linha resolve as duas coisas com uma tabela.
- **Reserva do número e gravação da chave acontecem na mesma transação** (`fn_nfe_reservar_numero`, abaixo) — inclusive o cálculo do DV roda dentro dessa função, não em JS, para que não exista uma janela entre "o Postgres decidiu o número" e "o número virou uma chave persistida". Isso segue literalmente a recomendação de `docs/fiscal/04:146`: "grave-a [a chave] assim que gerada, antes mesmo de tentar transmitir".
- **Buraco em caso de falha depois da reserva é aceito e não é bug** — é o comportamento correto e legalmente previsto (existe até o evento de Inutilização para formalizar buracos). O que a arquitetura proíbe é **colisão** (dois processos pegando o mesmo número), que o lock de linha impede por completo.

**Idempotência da emissão**: a chave de acesso (44 dígitos) é o identificador natural, gerada e persistida **antes** de qualquer chamada à SEFAZ (`status='rascunho'`). Reenvio depois de timeout nunca gera novo rascunho/número — a rota consulta primeiro `NfeConsultaProtocolo4`/`NFeRetAutorizacao4` pela chave já existente (`docs/fiscal/04:138-143`) e só reenvia o mesmo XML assinado se a consulta confirmar que a SEFAZ não recebeu. Reforço no banco: índice único parcial que impede duas notas **autorizadas** para o mesmo `pedido_id` (uma rejeição pode gerar um novo rascunho com número novo, mas nunca duas autorizadas para o mesmo pedido).

**Máquina de estados** (`nfe_saidas.status`):

```
rascunho → assinada → transmitida → aguardando_retorno → autorizada → cancelada
                            │                          → rejeitada
                            │                          → denegada
                            └──────────────────────────→ erro_transmissao (retry na MESMA chave)
autorizada (faixa não usada em série já reservada, sem nunca ter virado nota) → inutilizada (via nfe_eventos, sem nfe_saida_id)
```
`rejeitada`/`denegada` são terminais para aquela chave — corrigir exige novo rascunho (novo número). `erro_transmissao` é transitório e retenta a mesma chave, nunca gera número novo.

### DDL completo

```sql
-- =========================================================
-- 364 — ATUALIZAÇÃO 36: EMISSÃO DE NF-e (SAÍDA, MODELO 55)
--
-- Até aqui o sistema só LÊ NF-e (atualização 22, nfe_documentos): recebimento
-- de compra. Esta migração cria o lado espelhado — emitir NF-e de venda a
-- partir de um pedido já Faturado.
--
-- Cinco peças novas:
--   nfe_series        — contador por empresa/modelo/série. É a fonte única de
--                        verdade da numeração; toda reserva de número passa
--                        por aqui com lock de linha (ver fn_nfe_reservar_numero).
--   nfe_saidas        — cabeçalho da nota (o "documento fiscal" propriamente).
--   nfe_saida_itens   — itens, com os campos de ICMS/ST que a tela e os
--                        relatórios precisam consultar; o resto do cálculo
--                        tributário (PIS/COFINS/IPI/FCP-ST/DIFAL) fica em
--                        `tributos jsonb`, no mesmo espírito de `origem_raw`
--                        da atualização 32 — dado de entrada para montar o
--                        XML, não algo que o SQL precisa somar/filtrar.
--   nfe_eventos       — cancelamento, carta de correção, inutilização. Não é
--                        o mesmo conceito de manifestação do destinatário
--                        (que é da NF-e de ENTRADA e já existe fora desta
--                        migração).
--   nfe_sefaz_log      — cada chamada SOAP feita (serviço, tentativa, cStat,
--                        duração). Existe para depurar rejeição e para provar,
--                        em auditoria, que a nota foi consultada antes de
--                        reenviada (nunca reenviada às cegas).
--
-- Numeração: SEQUENCE está descartada de propósito (nextval() não reverte em
-- rollback, gera buraco a cada tentativa fracassada, que aqui é comum). Em vez
-- disso, fn_nfe_reservar_numero trava a linha do contador (for update),
-- incrementa, calcula o dígito verificador (módulo 11, fórmula do MOC 7.0) e
-- já grava o rascunho na mesma transação — a chave de acesso nasce persistida
-- antes de qualquer contato com a SEFAZ. Buraco de numeração por falha depois
-- da reserva é aceitável (existe o evento de inutilização para isso);
-- colisão de número nunca é aceitável, e o lock de linha garante isso.
--
-- Colunas fiscais que faltavam em clientes/produtos (endereço, IE, NCM, CEST,
-- CFOP, origem da mercadoria) entram aqui também: sem elas não existe bloco
-- `dest`/`det` de XML possível. Não adiciono NCM/CEST "reais" de nenhum
-- produto — só a coluna; o preenchimento é cadastro, tela por tela.
--
-- Rode depois de atualizacao_35_conciliacao_bancaria.sql. Idempotente.
-- Rollback comentado no fim.
-- =========================================================
begin;

-- ---------- CADASTRO: campos fiscais que faltavam ----------

alter table public.clientes
  add column if not exists inscricao_estadual text,
  add column if not exists indicador_ie text not null default '9', -- 1-contribuinte / 2-isento / 9-não contribuinte (docs/fiscal/02:38)
  add column if not exists email text,
  add column if not exists endereco text,
  add column if not exists numero text,
  add column if not exists complemento text,
  add column if not exists bairro text,
  add column if not exists municipio text,
  add column if not exists codigo_municipio_ibge text,
  add column if not exists uf text,
  add column if not exists cep text;

alter table public.clientes drop constraint if exists clientes_indicador_ie_valido;
alter table public.clientes add constraint clientes_indicador_ie_valido
  check (indicador_ie in ('1', '2', '9'));

comment on column public.clientes.indicador_ie is
  'indIEDest do XML da NF-e: 1-contribuinte ICMS, 2-isento, 9-não contribuinte. Junto com idDest, dispara ICMSUFDest/DIFAL (docs/fiscal/02, item 7).';

alter table public.produtos
  add column if not exists ncm text,
  add column if not exists cest text,
  add column if not exists cfop_venda_uf text,       -- CFOP padrão quando cliente é do mesmo estado (RO)
  add column if not exists cfop_venda_fora_uf text,   -- CFOP padrão em venda interestadual
  add column if not exists origem_mercadoria text not null default '0', -- Tabela A do CST: 0-nacional, 1-8 variações de importação
  add column if not exists csosn_padrao text,         -- sugestão de partida; a regra de ST real decide na emissão (ver §4, motor tributário)
  add column if not exists gtin text;                 -- "SEM GTIN" literal quando não existir (docs/fiscal/02:134)

alter table public.produtos drop constraint if exists produtos_origem_mercadoria_valida;
alter table public.produtos add constraint produtos_origem_mercadoria_valida
  check (origem_mercadoria in ('0','1','2','3','4','5','6','7','8'));

alter table public.produtos drop constraint if exists produtos_csosn_padrao_valido;
alter table public.produtos add constraint produtos_csosn_padrao_valido
  check (csosn_padrao is null or csosn_padrao in ('101','102','201','202','203','500','900'));

comment on column public.produtos.csosn_padrao is
  'Sugestão de cadastro, não a decisão final: se o item está em ST muda por
   origem do lote (abate próprio x comprado de terceiro, docs/fiscal/01:83-91)
   e é resolvido item a item na emissão, não fixado no cadastro do produto.';

-- ---------- SÉRIES E NUMERAÇÃO ----------
-- Uma linha por empresa+modelo+série. ultimo_numero é o contador; toda
-- reserva passa por fn_nfe_reservar_numero, nunca por update direto daqui.
create table if not exists public.nfe_series (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  modelo text not null default '55' check (modelo in ('55')), -- só NF-e nesta fase; NFC-e (65) fica de fora por ora
  serie text not null,
  ambiente text not null default 'homologacao' check (ambiente in ('homologacao', 'producao')),
  ultimo_numero int not null default 0 check (ultimo_numero >= 0),
  ativa boolean not null default true,
  created_at timestamptz not null default now(),
  unique (empresa_id, modelo, serie)
);
create index if not exists nfe_series_empresa_idx on public.nfe_series(empresa_id);

alter table public.nfe_series enable row level security;
drop policy if exists "empresa_scoped_select" on public.nfe_series;
create policy "empresa_scoped_select" on public.nfe_series for select
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));
-- Sem policy de insert/update/delete para authenticated de propósito: a
-- numeração só muda dentro de fn_nfe_reservar_numero, chamada pela rota com
-- service role. Igual ao motivo de certificados_digitais não ter policy de
-- select (atualizacao_31): aqui o risco não é vazamento, é escrita direta
-- pulando o lock.

-- ---------- CABEÇALHO ----------
create table if not exists public.nfe_saidas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  pedido_id uuid references public.pedidos(id),
  cliente_id uuid references public.clientes(id),

  modelo text not null default '55',
  serie text not null,
  numero int not null,
  cnf text not null check (cnf ~ '^[0-9]{8}$'),   -- código numérico aleatório (CSPRNG, gerado pela rota antes de chamar fn_nfe_reservar_numero)
  dv text not null check (dv ~ '^[0-9]$'),
  chave text not null check (chave ~ '^[0-9]{44}$'),

  ambiente text not null check (ambiente in ('homologacao', 'producao')),
  tp_emis text not null default '1', -- 1-normal (contingência fica para fase futura, ver §6 riscos)
  natureza_operacao text not null,
  finalidade text not null default '1' check (finalidade in ('1','2','3','4')), -- normal/complementar/ajuste/devolução
  ind_final boolean not null default true,   -- indFinal: destinado a consumidor final?
  id_dest text not null check (id_dest in ('1','2','3')), -- 1-interna/2-interestadual/3-exterior

  status text not null default 'rascunho' check (status in (
    'rascunho', 'assinada', 'transmitida', 'aguardando_retorno',
    'autorizada', 'rejeitada', 'denegada', 'erro_transmissao', 'cancelada', 'inutilizada'
  )),
  motivo_status text,          -- xMotivo devolvido pela SEFAZ (cStat/xMotivo)
  codigo_status_sefaz text,    -- cStat cru, para não perder o código exato numa rejeição

  protocolo_autorizacao text,
  data_autorizacao timestamptz,

  valor_produtos numeric(12,2) not null default 0,
  valor_icms numeric(12,2) not null default 0,
  valor_icms_st numeric(12,2) not null default 0,
  valor_total numeric(12,2) not null default 0,

  xml_assinado_path text,      -- bucket privado, mesmo padrão de nfe_documentos.xml_path
  xml_autorizado_path text,    -- XML + protocolo anexado, só existe após autorização
  danfe_path text,

  criado_por uuid references public.funcionarios(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (empresa_id, chave),
  unique (empresa_id, modelo, serie, numero)
);
create index if not exists nfe_saidas_empresa_status_idx on public.nfe_saidas(empresa_id, status);
create index if not exists nfe_saidas_pedido_idx on public.nfe_saidas(pedido_id);
-- Um pedido nunca tem duas notas AUTORIZADAS ao mesmo tempo (rejeição pode
-- gerar um novo rascunho com número novo; isso é permitido e esperado).
create unique index if not exists nfe_saidas_pedido_autorizada_unica
  on public.nfe_saidas(pedido_id) where status = 'autorizada';

alter table public.nfe_saidas enable row level security;
drop policy if exists "empresa_scoped_select" on public.nfe_saidas;
create policy "empresa_scoped_select" on public.nfe_saidas for select
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));
-- Mesma decisão de nfe_series: sem policy de escrita para authenticated. Toda
-- mudança de status passa pelas funções abaixo, chamadas com service role.

drop trigger if exists trg_nfe_saidas_updated_at on public.nfe_saidas;
create trigger trg_nfe_saidas_updated_at before update on public.nfe_saidas
  for each row execute function public.fn_set_updated_at();

alter table public.pedidos add column if not exists nfe_saida_id uuid references public.nfe_saidas(id);
comment on column public.pedidos.nfe_saida_id is
  'Última NF-e autorizada emitida para este pedido. Não é travado pelo trigger
   da atualização 27 — o pedido pode ficar Faturado sem nota (ex.: emissão
   ainda não disparada) sem violar a imutabilidade de itens.';

-- ---------- ITENS ----------
create table if not exists public.nfe_saida_itens (
  id uuid primary key default gen_random_uuid(),
  nfe_saida_id uuid not null references public.nfe_saidas(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id),
  pedido_item_id uuid references public.pedido_itens(id),
  produto_id uuid not null references public.produtos(id),

  indice int not null,       -- nItem
  codigo text not null,
  descricao text not null,
  ncm text not null,
  cest text,
  cfop text not null,
  unidade text not null,
  quantidade numeric(12,4) not null check (quantidade > 0),
  valor_unitario numeric(12,4) not null check (valor_unitario >= 0),
  valor_total numeric(12,2) not null check (valor_total >= 0),

  origem_mercadoria text not null default '0',
  cst text,     -- só um dos dois preenchido; qual depende de empresas.regime_tributario no momento da emissão
  csosn text,

  valor_bc_icms_st numeric(12,2),
  aliquota_icms_st numeric(6,4),
  valor_icms_st numeric(12,2),
  percentual_mva numeric(6,4),
  valor_icms numeric(12,2),

  -- PIS/COFINS/IPI/FCP-ST/ICMSUFDest/campos de "ST retida anteriormente" (CST
  -- 60/CSOSN 500): grupo variável demais para colunas próprias e que o SQL
  -- nunca soma nem filtra — só precisa existir para montar o XML. Mesmo
  -- padrão de origem_raw (atualizacao_32_pdv_consumer.sql).
  tributos jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  unique (nfe_saida_id, indice)
);
create index if not exists nfe_saida_itens_nfe_saida_idx on public.nfe_saida_itens(nfe_saida_id);
create index if not exists nfe_saida_itens_empresa_idx on public.nfe_saida_itens(empresa_id);

alter table public.nfe_saida_itens drop constraint if exists nfe_saida_itens_cst_xor_csosn;
alter table public.nfe_saida_itens add constraint nfe_saida_itens_cst_xor_csosn
  check ((cst is not null) <> (csosn is not null));

alter table public.nfe_saida_itens enable row level security;
drop policy if exists "empresa_scoped_select" on public.nfe_saida_itens;
create policy "empresa_scoped_select" on public.nfe_saida_itens for select
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

-- ---------- EVENTOS (cancelamento, carta de correção, inutilização) ----------
create table if not exists public.nfe_eventos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  nfe_saida_id uuid references public.nfe_saidas(id), -- nulo só em inutilizacao (evento é sobre uma faixa de número, não uma nota)
  tipo text not null check (tipo in ('cancelamento', 'carta_correcao', 'inutilizacao')),
  sequencia int not null default 1,  -- nSeqEvento; CC-e permite até 20 (docs/fiscal/02:169)
  status text not null default 'rascunho' check (status in ('rascunho', 'transmitido', 'registrado', 'rejeitado')),
  justificativa text not null check (btrim(justificativa) <> ''),
  numero_inicial int,   -- só em inutilizacao
  numero_final int,     -- só em inutilizacao
  protocolo text,
  motivo_status text,
  xml_evento_path text,
  xml_retorno_path text,
  criado_por uuid references public.funcionarios(id),
  created_at timestamptz not null default now(),
  unique (nfe_saida_id, tipo, sequencia)
);
create index if not exists nfe_eventos_empresa_idx on public.nfe_eventos(empresa_id);
create index if not exists nfe_eventos_nfe_saida_idx on public.nfe_eventos(nfe_saida_id);

alter table public.nfe_eventos drop constraint if exists nfe_eventos_inutilizacao_tem_faixa;
alter table public.nfe_eventos add constraint nfe_eventos_inutilizacao_tem_faixa
  check (tipo <> 'inutilizacao' or (numero_inicial is not null and numero_final is not null and nfe_saida_id is null));

alter table public.nfe_eventos enable row level security;
drop policy if exists "empresa_scoped_select" on public.nfe_eventos;
create policy "empresa_scoped_select" on public.nfe_eventos for select
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

-- ---------- LOG DE COMUNICAÇÃO COM A SEFAZ ----------
-- Existe para depurar rejeição e provar, em auditoria, que a nota foi
-- consultada antes de reenviada (docs/fiscal/04:139-143) — nunca reenvio cego.
create table if not exists public.nfe_sefaz_log (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  nfe_saida_id uuid references public.nfe_saidas(id),
  nfe_evento_id uuid references public.nfe_eventos(id),
  servico text not null, -- 'NfeStatusServico4' | 'NFeAutorizacao4' | 'NFeRetAutorizacao4' | 'NfeConsultaProtocolo4' | 'NfeInutilizacao4' | 'RecepcaoEvento4'
  ambiente text not null check (ambiente in ('homologacao', 'producao')),
  tentativa int not null default 1,
  status_http int,
  codigo_retorno text,     -- cStat
  mensagem_retorno text,   -- xMotivo
  duracao_ms int,
  request_path text,       -- envelope SOAP enviado, no bucket privado — nunca inline (pode conter o XML assinado inteiro)
  response_path text,
  created_at timestamptz not null default now()
);
create index if not exists nfe_sefaz_log_empresa_idx on public.nfe_sefaz_log(empresa_id);
create index if not exists nfe_sefaz_log_nfe_saida_idx on public.nfe_sefaz_log(nfe_saida_id);

alter table public.nfe_sefaz_log enable row level security;
drop policy if exists "empresa_scoped_select" on public.nfe_sefaz_log;
create policy "empresa_scoped_select" on public.nfe_sefaz_log for select
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

-- ---------- FUNÇÕES ----------
-- Todas security invoker (default) exceto a de reserva de número, que precisa
-- travar nfe_series independentemente de quem está chamando enxergar a linha
-- via RLS — mesmo raciocínio de fn_pedido_bloquear_edicao (atualizacao_27).

-- Módulo 11 sobre os 43 primeiros dígitos da chave, pesos 2..9 ciclando da
-- direita para a esquerda (fórmula literal do MOC 7.0, docs/fiscal/03:176-179).
-- Testado com o vetor de exemplo do próprio MOC (soma 644 -> DV 5) em
-- tests/migracao-36/cenarios.sql.
create or replace function public.fn_nfe_dv_modulo11(p_43_digitos text)
returns text language plpgsql immutable as $$
declare
  v_soma int := 0; v_peso int := 2; v_resto int; i int;
begin
  if p_43_digitos !~ '^[0-9]{43}$' then
    raise exception 'Esperava 43 dígitos para calcular o DV, recebi %.', length(p_43_digitos);
  end if;
  for i in reverse 43..1 loop
    v_soma := v_soma + (substr(p_43_digitos, i, 1)::int * v_peso);
    v_peso := case when v_peso = 9 then 2 else v_peso + 1 end;
  end loop;
  v_resto := v_soma % 11;
  return case when v_resto in (0, 1) then '0' else (11 - v_resto)::text end;
end $$;

-- Reserva o próximo número da série (lock de linha), monta a chave de 44
-- dígitos e já insere o rascunho — tudo numa transação só, para que nunca
-- exista um número reservado sem chave gravada.
create or replace function public.fn_nfe_reservar_numero(
  p_empresa_id uuid, p_modelo text, p_serie text, p_ambiente text,
  p_cuf text, p_cnpj_emitente text, p_cnf text,
  p_pedido_id uuid, p_cliente_id uuid, p_natureza_operacao text,
  p_id_dest text, p_ind_final boolean, p_criado_por uuid default null
) returns public.nfe_saidas
language plpgsql security definer set search_path = public as $$
declare
  v_serie_id uuid; v_numero int; v_aamm text; v_43 text; v_dv text; v_chave text;
  v_nota public.nfe_saidas;
begin
  if p_cnf !~ '^[0-9]{8}$' then
    raise exception 'cNF precisa ter 8 dígitos numéricos (recebido de fora, gerado por CSPRNG).';
  end if;
  if p_cnpj_emitente !~ '^[0-9]{14}$' then
    raise exception 'CNPJ do emitente inválido para montar a chave de acesso.';
  end if;

  insert into public.nfe_series (empresa_id, modelo, serie, ambiente)
    values (p_empresa_id, p_modelo, p_serie, p_ambiente)
    on conflict (empresa_id, modelo, serie) do nothing;

  update public.nfe_series
     set ultimo_numero = ultimo_numero + 1
   where empresa_id = p_empresa_id and modelo = p_modelo and serie = p_serie
   returning id, ultimo_numero into v_serie_id, v_numero;

  v_aamm := to_char(clock_timestamp(), 'YYMM');
  v_43 := p_cuf || v_aamm || p_cnpj_emitente || p_modelo || lpad(p_serie, 3, '0')
          || lpad(v_numero::text, 9, '0') || '1' || p_cnf; -- tpEmis fixo em '1' nesta fase (ver riscos, §6)
  v_dv := public.fn_nfe_dv_modulo11(v_43);
  v_chave := v_43 || v_dv;

  insert into public.nfe_saidas (
    empresa_id, pedido_id, cliente_id, modelo, serie, numero, cnf, dv, chave,
    ambiente, natureza_operacao, id_dest, ind_final, criado_por
  ) values (
    p_empresa_id, p_pedido_id, p_cliente_id, p_modelo, p_serie, v_numero, p_cnf, v_dv, v_chave,
    p_ambiente, p_natureza_operacao, p_id_dest, p_ind_final, p_criado_por
  ) returning * into v_nota;

  return v_nota;
end $$;

-- Transições de status simples (sem lock adicional: nfe_saidas.id já é a
-- unidade de trabalho e cada rota processa uma nota por vez).
create or replace function public.fn_nfe_marcar_transmitida(p_nfe_saida_id uuid, p_xml_assinado_path text)
returns void language plpgsql as $$
begin
  update public.nfe_saidas
     set status = 'transmitida', xml_assinado_path = p_xml_assinado_path
   where id = p_nfe_saida_id and status in ('rascunho', 'assinada', 'erro_transmissao');
  if not found then
    raise exception 'Nota % não está num status que permita transmitir.', p_nfe_saida_id;
  end if;
end $$;

create or replace function public.fn_nfe_registrar_retorno(
  p_nfe_saida_id uuid, p_status text, p_codigo_status_sefaz text, p_motivo_status text,
  p_protocolo text default null, p_xml_autorizado_path text default null
) returns void language plpgsql as $$
begin
  if p_status not in ('autorizada', 'rejeitada', 'denegada', 'erro_transmissao', 'aguardando_retorno') then
    raise exception 'Status de retorno inválido: %.', p_status;
  end if;
  update public.nfe_saidas
     set status = p_status,
         codigo_status_sefaz = p_codigo_status_sefaz,
         motivo_status = p_motivo_status,
         protocolo_autorizacao = coalesce(p_protocolo, protocolo_autorizacao),
         data_autorizacao = case when p_status = 'autorizada' then clock_timestamp() else data_autorizacao end,
         xml_autorizado_path = coalesce(p_xml_autorizado_path, xml_autorizado_path)
   where id = p_nfe_saida_id;
  if not found then raise exception 'Nota % não encontrada.', p_nfe_saida_id; end if;

  if p_status = 'autorizada' then
    update public.pedidos set nfe_saida_id = p_nfe_saida_id
     where id = (select pedido_id from public.nfe_saidas where id = p_nfe_saida_id);
  end if;
end $$;

commit;

-- ---------- ROLLBACK ----------
-- begin;
-- alter table public.pedidos drop column if exists nfe_saida_id;
-- drop function if exists public.fn_nfe_registrar_retorno(uuid, text, text, text, text, text);
-- drop function if exists public.fn_nfe_marcar_transmitida(uuid, text);
-- drop function if exists public.fn_nfe_reservar_numero(uuid, text, text, text, text, text, text, uuid, uuid, text, text, boolean, uuid);
-- drop function if exists public.fn_nfe_dv_modulo11(text);
-- drop table if exists public.nfe_sefaz_log;
-- drop table if exists public.nfe_eventos;
-- drop table if exists public.nfe_saida_itens;
-- drop table if exists public.nfe_saidas;
-- drop table if exists public.nfe_series;
-- alter table public.produtos
--   drop column if exists ncm, drop column if exists cest,
--   drop column if exists cfop_venda_uf, drop column if exists cfop_venda_fora_uf,
--   drop column if exists origem_mercadoria, drop column if exists csosn_padrao,
--   drop column if exists gtin;
-- alter table public.clientes
--   drop column if exists inscricao_estadual, drop column if exists indicador_ie,
--   drop column if exists email, drop column if exists endereco, drop column if exists numero,
--   drop column if exists complemento, drop column if exists bairro, drop column if exists municipio,
--   drop column if exists codigo_municipio_ibge, drop column if exists uf, drop column if exists cep;
-- commit;
```

Pontos que exigem atenção na implementação real (não resolvidos por esta migração, deliberadamente):
- `fn_set_updated_at()` é reaproveitada de `atualizacao_31:52-53` — confirmar que ela existe no schema atual antes de aplicar (já é usada por `empregadores`).
- `cUF`/CNPJ do emitente na reserva de número vêm de `empregadores` via `empresas.empregador_id` (`atualizacao_31:56`) — a rota precisa buscar isso antes de chamar `fn_nfe_reservar_numero`, não a função.

---

## 4. Camadas de código

```
lib/nfe-emissao/                       # análogo a lib/nfe/ (que é só de entrada)
  chaveAcesso.js                       # pura: valida/recalcula DV de uma chave de 44 dígitos
                                        # (mesma fórmula de fn_nfe_dv_modulo11, testada contra o
                                        # vetor do MOC — nunca gera chave nova, só confere)
  regrasTributarias.js                 # pura: dado {produto, cliente, empresa.regime_tributario},
                                        # decide CST/CSOSN, CFOP, e se entra ST. É onde mora o
                                        # achado de docs/fiscal/01 (carne de abate próprio x
                                        # comprada de terceiro) — tabela de regras versionada em
                                        # código, não em UI, porque muda por decreto estadual
  mvaRondonia.js                       # tabela estática NCM/CEST -> MVA (docs/fiscal/01, item 3.1),
                                        # separada de regrasTributarias.js porque é dado, não lógica
  montarXml.js                         # pura: {nota, itens, empresa, cliente} -> string XML sem
                                        # assinatura. Espelha o estilo de parseNFe.js, mas na
                                        # direção contrária
  assinarXml.js                        # impura (usa a chave privada extraída do pfx): recebe o
                                        # XML de montarXml.js + certificado de
                                        # certificadoServer.obterCertificadoAtivo(), devolve XML
                                        # assinado. xml-crypto + node-forge (docs/fiscal/04 §2)
  clienteSoap.js                       # impura: envia envelope SOAP 1.2 com mTLS (https.Agent
                                        # pfx+passphrase, nunca fetch nativo — docs/fiscal/04:79),
                                        # grava request/response em nfe_sefaz_log
  urls.js                              # URLs de homologação/produção do SVRS (docs/fiscal/03 §2),
                                        # centralizadas para não espalhar string mágica
  danfe.js                             # gera PDF via pdfkit (nfe-danfe-pdf como referência —
                                        # docs/fiscal/04 §5), nunca headless Chrome

app/api/nfe-emissao/
  route.js                             # POST — dispara emissão a partir de pedido_id.
                                        # garantirEmpresa + garantirColaborador(pedido) antes de
                                        # tudo. Orquestra: buscar cliente/itens -> regrasTributarias
                                        # -> RPC fn_nfe_reservar_numero -> montarXml -> assinarXml
                                        # -> RPC fn_nfe_marcar_transmitida -> clienteSoap -> RPC
                                        # fn_nfe_registrar_retorno
  [id]/route.js                        # GET — status atual da nota (consulta local, sem bater na
                                        # SEFAZ; útil pra tela de pedido mostrar "aguardando retorno")
  [id]/consultar/route.js              # POST — força NfeConsultaProtocolo4 pela chave, para o
                                        # botão "Consultar status" quando o retorno automático
                                        # não chegou (timeout/fila)
  [id]/cancelar/route.js               # POST — evento de cancelamento (só se autorizada há < 24h,
                                        # confirmar prazo exato de RO antes de travar — docs/fiscal/02:165)
  [id]/carta-correcao/route.js         # POST — evento de CC-e
  [id]/danfe/route.js                  # GET — serve o PDF do bucket (signed URL sob demanda, mesmo
                                        # padrão de anexo de recebimento)
  status-servico/route.js              # GET — NfeStatusServico4, cacheado (nunca checar antes de
                                        # cada envio — docs/fiscal/03 §8)

app/pedidos/[id]/page.js               # já existe — ganha um botão "Emitir NF-e" quando
                                        # status='Faturado', que chama app/api/nfe-emissao (a
                                        # PRIMEIRA chamada de servidor que este módulo faz —
                                        # hoje é 100% client-side, app/pedidos/page.js:86-108)

tests/
  nfe-emissao-chave.test.mjs           # fn_nfe_dv_modulo11 e chaveAcesso.js contra o vetor do MOC
  nfe-emissao-regras-tributarias.test.mjs  # casos de docs/fiscal/01 (abate próprio x comprado) e
                                        # docs/fiscal/05 (CFOP por natureza de operação)
  nfe-emissao-montar-xml.test.mjs      # XML gerado valida contra XSD via xmllint-wasm, offline
  migracao-36/                         # verificar.sh + fixture.sql + cenarios.sql, padrão da 35 —
                                        # inclusive cenário "duas reservas concorrentes não colidem"
```

**Onde roda o quê:**
- **Server Component** (`app/pedidos/[id]/page.js` continua Server Component se já for): só leitura de status (`nfe_saidas` via RLS, mesma query direta que hoje lê `pedidos`).
- **Route Handler** (`app/api/nfe-emissao/*`): toda a orquestração — é onde certificado, assinatura e SOAP têm que rodar, porque é o único lugar com service role e `runtime = 'nodejs'`.
- **Fila** (`docs/fiscal/04:148-149`): não é obrigatória para o volume da 364 no MVP — o próprio `pg_advisory`/lock de linha já serializa concorrência na mesma série, e a Vercel Pro aguenta até 30 min por invocação. Fila (QStash) só entra na **fatia 5** (§5), exclusivamente para o loop de "reconsultar protocolo depois de timeout", não para a emissão em si.

---

## 5. Ordem de implementação — fatias verticais testáveis

**Fatia 1 — Certificado fala com a SEFAZ (sem emitir nada)**
Consultar `NfeStatusServico4` de homologação usando o certificado real já cadastrado, via `https.Agent({ pfx, passphrase })` (nunca `fetch`), reaproveitando `certificadoServer.obterCertificadoAtivo`.
- Critério de pronto: rota `GET /api/nfe-emissao/status-servico` devolve `cStat=107` (em operação) contra `nfe-homologacao.svrs.rs.gov.br` (`docs/fiscal/03:40-46`).
- Teste automatizado: nenhum em CI (bate na rede de propósito) — é o único smoke manual da lista, documentado como tal.
- **Prova o caminho inteiro**: mTLS na Vercel funciona com o pfx cifrado de verdade, sem precisar de `pem`/`openssl` externo (resolve de cara o maior risco do §6).

**Fatia 2 — Chave de acesso e numeração, sem XML nenhum**
`fn_nfe_dv_modulo11` + `fn_nfe_reservar_numero` no banco; `chaveAcesso.js` em JS só como validador.
- Critério de pronto: duas chamadas concorrentes a `fn_nfe_reservar_numero` para a mesma série nunca produzem número repetido; DV bate com o vetor de teste do MOC.
- Teste: `tests/migracao-36/cenarios.sql` (SQL puro, sem servidor) + `tests/nfe-emissao-chave.test.mjs`.
- Testável 100% offline, sem SEFAZ.

**Fatia 3 — Montagem e assinatura do XML, validado offline**
`montarXml.js` + `assinarXml.js`, para um pedido fixo de teste com 1 item sem ST (o caso mais simples: CSOSN 102).
- Critério de pronto: XML assinado valida contra o XSD do layout 4.00 via `xmllint-wasm`, e a assinatura é aceita pelo validador público do SVRS (`https://dfe-portal.svrs.rs.gov.br/Nfe/ValidadorXML`, `docs/fiscal/03:234`) — manual, uma vez.
- Teste automatizado: `tests/nfe-emissao-montar-xml.test.mjs` roda contra XSD local, sem rede.

**Fatia 4 — Transmissão de ponta a ponta em homologação, 1 item sem ST**
Junta 1+2+3 e efetivamente chama `NFeAutorizacao4`/`NFeRetAutorizacao4` de homologação, grava em `nfe_saidas`/`nfe_sefaz_log`, atualiza status.
- Critério de pronto: nota autorizada em homologação com `xNome` do destinatário = literal exigido (`docs/fiscal/02:233`), consultável depois via `NfeConsultaProtocolo4` pela chave.
- Teste automatizado: contrato mockado (fixtures de XML de retorno real capturadas nesta fatia) — não bate na SEFAZ em CI daqui em diante, só neste momento manual.

**Fatia 5 — Idempotência e retentativa**
Simular timeout de rede depois do envio; a rota tem que consultar protocolo antes de qualquer reenvio, nunca gerar novo rascunho.
- Critério de pronto: teste que força timeout mockado e confirma que **nenhum segundo número foi reservado** e que a consulta (`NfeConsultaProtocolo4`) foi chamada antes de qualquer novo `NFeAutorizacao4`.
- Aqui entra a fila (QStash) só se o teste mostrar necessidade real de desacoplar o polling da requisição síncrona.

**Fatia 6 — ST/CSOSN reais (o motor tributário)**
`regrasTributarias.js` + `mvaRondonia.js`, cobrindo os casos de `docs/fiscal/01` e `05`: venda de produção própria com ST (CSOSN 201/202), carne de abate próprio isenta, revenda de terceiro com ST retida (CSOSN 500).
- Critério de pronto: para cada cenário do doc 05 (seções 1, 2, 3), a função devolve CFOP/CSOSN/campos de ST esperados.
- Teste: `tests/nfe-emissao-regras-tributarias.test.mjs`, tabela de casos, sem rede — mas **com aviso explícito no PR de que MVA/CEST exatos precisam de confirmação do contador antes de produção** (as lacunas do doc 01 não estão resolvidas, só mapeadas).

**Fatia 7 — Cancelamento e DANFE**
Evento de cancelamento (dentro do prazo) e geração de PDF via `pdfkit`.
- Critério de pronto: nota cancelada em homologação vira `status='cancelada'`; DANFE renderiza QR Code/chave legível.
- Teste: `montarXml.js` do evento validado offline contra XSD; DANFE testado por snapshot de texto extraído do PDF (não pixel a pixel).

**Fatia 8 — Botão em produção, atrás de flag**
Conecta `app/pedidos/[id]/page.js` à rota real, mas **ambiente `producao` só liberado depois de credenciamento manual na SEFIN-RO** (`docs/fiscal/03:181-198`, sem taxa, imediato, mas exige a empresa já ter recebido uma NF-e — que já aconteceu, dado o módulo de entrada).

---

## 6. Riscos específicos deste repositório

- **`pem`/`openssl` externo — descartado por escolha, não por acidente.** A única lib "full-stack" viva (`node-sped-nfe`) depende de `pem`, que faz `spawn` de `openssl` do sistema — não garantido no runtime Lambda-based da Vercel (`docs/fiscal/04:11,189`). Por isso o plano usa `node-forge` (já em `certificadoServer.js`) + `xml-crypto` direto, sem essa lib. Se alguém, no calor da implementação, importar `node-sped-nfe` "para ir mais rápido", isso reintroduz exatamente o risco que a Fatia 1 existe para eliminar.
- **`fetch()` nativo não aceita `pfx`/`Agent` customizado** (`docs/fiscal/04:79). Qualquer código que troque `https.Agent` manual por `fetch()` "porque é mais moderno" quebra o mTLS silenciosamente até bater na SEFAZ — vale um teste que force isso a falhar cedo (Fatia 1).
- **Vercel: timeout não é mais o problema clássico** (`docs/fiscal/04:84-90`) — no plano Pro, 300s (ou 30 min configurado) cobre assinatura+envio+polling numa invocação só. O risco real recategorizado é **cold start do handshake mTLS** e a necessidade de nunca depender de manter a function viva esperando a SEFAZ — por isso a Fatia 5 existe separada da 4.
- **JavaScript puro, sem TypeScript**: todo o motor tributário (`regrasTributarias.js`) e o builder de XML manipulam strings de tag por nome — sem tipos, um campo de ST esquecido só aparece como rejeição da SEFAZ, não como erro de build. Mitigação: os testes da Fatia 3/6 validam contra XSD (que faz o papel de "tipo" aqui) em vez de confiar em revisão de código.
- **RLS + service role**: todas as tabelas novas seguem `certificados_digitais`/`nfe_series` sem policy de escrita para `authenticated` — isso é intencional (§3), mas significa que **qualquer tela nova que tente gravar direto via `supabase.from('nfe_saidas')...` do client vai falhar silenciosamente por RLS**, não por erro óbvio. Vale um teste de RLS (`tests/rls/`, padrão já existente) cobrindo isso.
- **Certificado cifrado é ponto único de falha operacional, não técnico**: `certificadoServer.js:6-8` já avisa que perder `CERTIFICADO_CHAVE` é irrecuperável — nada nesta migração muda isso, mas a emissão passa a depender dele em produção real (hoje só valida cadastro). Confirmar backup da variável de ambiente antes de ligar `ambiente='producao'`.
- **O fluxo de entrada não pode quebrar**: `nfe_documentos`/`nfe_sefaz_estado` (atualização 22) usam o prefixo `nfe_*` e o bucket `recebimentos`. Esta migração usa `nfe_series`/`nfe_saidas`/`nfe_saida_itens`/`nfe_eventos`/`nfe_sefaz_log` (nomes novos, sem sobreposição) e um bucket próprio — nenhum `alter table` toca `nfe_documentos` ou `fornecedor_produto_mapa`. Único ponto de contato real é `lib/certificadoServer.js`, que é só lido (`obterCertificadoAtivo`), nunca modificado.
- **`git status` mostra `lib/autorizacao.js` em refatoração nesta branch** (movido de `lib/nfe/autorizacao.js`). Qualquer rota nova de emissão deve importar do caminho novo (`lib/autorizacao.js`) — confirmar que o merge dessa branch aconteceu antes de começar a Fatia 1, ou a importação quebra.
- **Reforma tributária (IBS/CBS) já é produção obrigatória desde 03/08/2026** (`docs/fiscal/02:20,30`) — implementar "layout antigo" e migrar depois não compensa; o builder da Fatia 3 já precisa considerar o grupo novo desde o início, mesmo que a 364 (Simples Nacional) só seja obrigada a partir de 04/01/2027 — o schema exige o grupo presente/coerente mesmo assim em alguns casos.
- **`clientes` e `produtos` sem dados fiscais é bloqueio de produto, não só de banco**: mesmo com a migração aplicada, nenhum pedido existente tem cliente com endereço/IE nem produto com NCM — a Fatia 4 (primeira emissão real) depende de alguém preencher isso manualmente para pelo menos um cliente e um produto de teste antes de rodar.