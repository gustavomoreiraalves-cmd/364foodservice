# Cadastro das empresas do grupo (pessoa jurídica + certificado A1)

Data: 2026-08-23
Status: aprovado em conversa, aguardando plano de implementação

## Problema

O sistema não tem um lugar único com os dados da pessoa jurídica. Hoje existem
duas tabelas que parecem "empresa" e nenhuma serve sozinha:

| Tabela | Papel real | Conteúdo em produção |
|---|---|---|
| `empresas` | unidade de negócio / marca: é o `empresa_id` de todo registro, base do RLS e do prefixo de código | 4 linhas (Food Service, Steakhouse, Burguer, Foodtruck/Afya). Só 2 CNPJs distintos — Food Service, Burguer e Foodtruck repetem `60361009000150` |
| `empregadores` | pessoa jurídica (criada para o eSocial no módulo de ponto) | 1 linha: 364 Steakhouse Comércio de Alimentos Ltda, CNPJ `37541736000187`, com razão social, IE, endereço, responsável legal |

Consequências:

- O upload de NF-e (`app/api/nfe/upload/route.js:56`) confere o CNPJ do
  destinatário contra `empresas.cnpj`. Funciona só porque o CNPJ foi copiado nas
  três marcas; não há uma fonte de verdade.
- Não há onde guardar o certificado A1, que pertence ao CNPJ e será necessário
  nas fases 2 e 3 da importação de NF-e (assinatura e consulta à SEFAZ).
- Dados de contato, contador e responsáveis não existem em lugar nenhum.
- Etiquetas, fichas e romaneios não têm de onde ler razão social e endereço.

## Decisões

1. **`empregadores` vira o cadastro central da pessoa jurídica.** A tabela já tem
   os campos fiscais básicos e é referenciada por `unidades`, `colaboradores`,
   `ponto_nsr_controle` e `ponto_marcacoes` e por sete arquivos do módulo de
   ponto. Renomear custaria mais do que vale; o nome técnico fica, e a interface
   chama de "Empresas (CNPJ)".
2. **`empresas` passa a apontar para a pessoa jurídica** por `empregador_id`. A
   marca continua sendo o eixo operacional do sistema; o CNPJ passa a ser lido
   pelo vínculo, não pela coluna `empresas.cnpj`.
3. **Certificado A1 fica no banco, cifrado** (arquivo `.pfx` e senha), com chave
   de ambiente própria, no mesmo padrão do `PONTO_BIOMETRIA_CHAVE`. Entra no
   backup diário sem esforço extra; só rotas server-side com service role leem.
4. **Tela própria, restrita ao módulo `admin`**, em `/empresas`, no grupo
   Cadastros do menu.

## Escopo

Dentro:

- Ampliar `empregadores` com regime tributário, CNAE, contato e responsáveis.
- Vincular `empresas.empregador_id` e migrar os dados existentes.
- Tabela `certificados_digitais` e rotas de upload, consulta de status e remoção.
- Tela `/empresas` com blocos: dados fiscais, contato e responsáveis,
  certificado A1, operações vinculadas.
- Helpers em `lib/` para os processos lerem a pessoa jurídica e o certificado.
- Upload de NF-e passa a conferir o CNPJ via `empregadores`.
- O cadastro de empregador em `/ponto/unidades` vira somente seleção
  (o formulário de criação sai de lá e aponta para `/empresas`).

Fora (decidido explicitamente):

- Dados bancários e PIX, logo/identidade visual, parâmetros de emissão
  (série, numeração, ambiente SEFAZ, CSC). Entram quando a emissão chegar; a
  tabela já terá lugar.
- Uso efetivo do certificado para assinar ou consultar a SEFAZ (fases 2 e 3 da
  NF-e). Esta spec entrega o armazenamento e a leitura server-side.
- Trocar etiquetas, fichas e romaneios para usar os dados da empresa. O helper
  fica pronto; cada impressão adota quando for tocada.
- Remover a coluna `empresas.cnpj`. Fica por compatibilidade, deixa de ser lida
  pelo upload de NF-e e o plano pode agendar a remoção numa migração futura.

## Arquitetura

### 1. Banco — `supabase/atualizacao_30_empresas_pessoa_juridica.sql`

**`empregadores` — novas colunas** (todas opcionais, `add column if not exists`):

| Coluna | Tipo | Uso |
|---|---|---|
| `regime_tributario` | text | `simples`, `presumido`, `real`, `mei` — check constraint |
| `cnae_principal` | text | só dígitos |
| `inscricao_municipal` | text | |
| `numero`, `complemento`, `bairro` | text | o `endereco` atual fica como logradouro |
| `codigo_municipio_ibge` | text | exigido pela NF-e; 7 dígitos |
| `telefone`, `email` | text | contato principal da empresa |
| `email_fiscal` | text | destino de NF-e, intimações |
| `responsavel_legal_cpf`, `responsavel_legal_email`, `responsavel_legal_telefone` | text | complementa `responsavel_legal` |
| `contador_nome`, `contador_crc`, `contador_email`, `contador_telefone` | text | |
| `observacoes` | text | |
| `updated_at` | timestamptz | trigger com a função `fn_set_updated_at`, que já existe no banco |

Constraints: `cnpj` continua `unique` e só dígitos (check `cnpj ~ '^\d{14}$'`).
O check é aplicado com `not valid` + `validate constraint` para não travar se
houver sujeira; a migração normaliza antes com `regexp_replace`.

**`empresas.empregador_id`** — `uuid references empregadores(id) on delete restrict`.
Migração de dados, na mesma atualização:

```sql
-- Steakhouse já tem pessoa jurídica cadastrada.
update empresas e set empregador_id = p.id
  from empregadores p where p.cnpj = regexp_replace(e.cnpj, '\D', '', 'g')
  and e.empregador_id is null;

-- As demais marcas compartilham o CNPJ 60361009000150: cria uma pessoa jurídica
-- única para ele, com razão social provisória, e vincula as três.
insert into empregadores (grupo_id, razao_social, nome_fantasia, cnpj)
select distinct e.grupo_id, '364 Food Service (completar razão social)', '364 Food Service',
       regexp_replace(e.cnpj, '\D', '', 'g')
  from empresas e
 where e.empregador_id is null and e.cnpj is not null
   and not exists (select 1 from empregadores p where p.cnpj = regexp_replace(e.cnpj, '\D', '', 'g'));

update empresas e set empregador_id = p.id
  from empregadores p where p.cnpj = regexp_replace(e.cnpj, '\D', '', 'g')
  and e.empregador_id is null;
```

A coluna fica nullable: uma marca nova pode ser criada antes de a pessoa
jurídica existir, e a tela de empresas mostra marcas sem vínculo como pendência.

**`certificados_digitais`** — nova tabela:

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | uuid pk | |
| `empregador_id` | uuid not null references empregadores(id) on delete cascade | |
| `pfx_cifrado` | text not null | `iv:tag:cipher` em base64, AES-256-GCM |
| `senha_cifrada` | text not null | mesmo formato |
| `cnpj_certificado` | text not null | extraído do certificado; deve bater com `empregadores.cnpj` |
| `titular` | text | CN do subject |
| `emissor` | text | CN do issuer |
| `numero_serie` | text | |
| `valido_de`, `valido_ate` | timestamptz not null | |
| `ativo` | boolean not null default true | índice único parcial: um ativo por empregador |
| `enviado_por` | uuid references auth.users(id) | |
| `created_at` | timestamptz | |

Substituir certificado = inserir novo e marcar o anterior `ativo = false`. O
histórico fica, o que ajuda a auditar qual certificado assinou o quê.

**RLS:**

- `empregadores`: as policies atuais (`empregadores_select` para todo logado,
  `empregadores_admin_write`) já atendem.
- `certificados_digitais`: `enable row level security` **sem policy de select
  para `authenticated`**. Nenhum cliente lê o pfx; tudo passa pela rota server
  com service role. A tela vê só metadados, devolvidos pela rota.

### 2. Criptografia — `lib/certificadoServer.js`

Módulo server-only (mesma convenção de `lib/pontoServer.js`):

- `chaveCertificado()` lê `CERTIFICADO_CHAVE` (32 bytes em base64). Erro claro em
  português se ausente ou com tamanho errado. Chave **separada** da biometria: se
  uma vazar, a outra não cai junto.
- `cifrar(buffer) -> 'iv:tag:cipher'` e `decifrar(texto) -> Buffer`, AES-256-GCM,
  IV de 12 bytes aleatório por chamada. Generalização do par
  `cifrarDescritor`/`decifrarDescritor`; o módulo de ponto não muda.
- `inspecionarPfx(buffer, senha)` usa `node-forge` (`pkcs12.pkcs12FromAsn1`) e
  devolve `{ cnpj, titular, emissor, numeroSerie, validoDe, validoAte }`. O CNPJ
  sai do OID `2.16.76.1.3.3` (otherName do ICP-Brasil) ou, na falta, dos 14
  dígitos após `:` no CN. Senha errada vira erro "Senha do certificado incorreta".
- `obterCertificadoAtivo(empregadorId) -> { pfx: Buffer, senha: string, meta }`
  ou `null`. Única porta de saída do pfx decifrado; as fases 2 e 3 da NF-e vão
  chamar esta função.

Dependência nova: `node-forge` (sem binário nativo, roda na Vercel).

Variável nova na Vercel e no `.env.local.example`: `CERTIFICADO_CHAVE`, gerada
com `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
Mesma advertência da biometria: perder a chave exige reenviar os certificados.
Anotar em `.env.local.example` e na memória de deploy.

### 3. API — `app/api/empresas/[id]/certificado/route.js`

Todas as rotas exigem usuário autenticado com módulo `admin`, via
`autorizarModulo(request, 'admin')` de `lib/pontoServer.js` (já existe e já usa
service role).

- `POST` — multipart com `arquivo` (.pfx/.p12, limite 64 KB) e `senha`.
  1. `inspecionarPfx`; erro 400 se senha errada ou arquivo inválido.
  2. Confere `cnpj` extraído contra `empregadores.cnpj`; 400 se diferente, com
     os dois CNPJs na mensagem.
  3. Recusa certificado já vencido (400). Aceita ainda não vigente, com aviso
     na resposta.
  4. Marca o ativo anterior como `ativo = false`, insere o novo cifrado.
  5. Devolve os metadados (nunca o pfx nem a senha).
- `GET` — metadados do certificado ativo: `{ titular, emissor, cnpj, validoAte,
  diasParaVencer, status }` com `status` em `vigente | vence_em_30_dias | vencido
  | ausente`.
- `DELETE` — marca o ativo como `ativo = false`. Não apaga a linha.

A senha trafega só neste POST, sobre HTTPS, e não é logada.

### 4. Tela — `app/empresas/page.js`

`AppShell modulo="admin" titulo="Empresas" desc="Pessoas jurídicas do grupo, certificados e responsáveis"`.

Estrutura igual às telas de cadastro existentes: formulário no topo e lista
abaixo, com `useCadastro({ tabela: 'empregadores', ... })`. Diferença: a
tabela não tem `empresa_id`; o hook recebe `empresaId: undefined` e o insert
precisa de `grupo_id`. O `paraGravar` da tela preenche `grupo_id` com o grupo
da empresa atual (`empresaAtual.grupo_id`) e normaliza CNPJ, CEP, CNAE e CPF
para só dígitos.

Blocos do formulário (um `fieldset` por bloco, mesma folha de estilo):

1. **Dados fiscais** — razão social, nome fantasia, CNPJ (máscara na exibição),
   IE, IM, regime tributário (select), CNAE, endereço completo, código IBGE do
   município, fuso.
2. **Contato e responsáveis** — telefone, e-mail, e-mail fiscal; responsável
   legal (nome, CPF, e-mail, telefone); contador (nome, CRC, e-mail, telefone);
   observações.
3. **Certificado A1** — só no modo edição (precisa do `id`). Mostra status
   vindo do `GET` com cor por situação, titular, validade e dias restantes.
   Campo de arquivo + senha + botão "Enviar certificado"; botão "Remover". O
   arquivo e a senha não passam pelo estado do `useCadastro`, vivem em estado
   local do bloco e são limpos após o envio.
4. **Operações vinculadas** — lista das linhas de `empresas` cujo
   `empregador_id` é este, só leitura, e lista das marcas **sem vínculo** com
   um select para vincular (update em `empresas.empregador_id`, restrito a
   admin pela policy `empresas_admin_write`).

Lista abaixo do formulário: razão social, CNPJ formatado, regime, situação do
certificado (badge), número de marcas vinculadas, ativo/inativo, botões
Editar / Inativar. A situação do certificado na lista vem de uma única chamada
`GET /api/empresas/certificados` que devolve o resumo de todos (evita N
chamadas).

Menu (`lib/menu.js`): item `{ label: 'Empresas (CNPJ)', href: '/empresas',
modulo: 'admin' }` no grupo Cadastros. Em `/ponto/unidades`, o formulário de
novo empregador sai; fica a lista e um link "Cadastrar ou editar em Empresas".

### 5. Leitura pelos processos — `lib/empresa.js`

O arquivo já exporta `useEmpresaAtual`. Acrescentar:

- `obterPessoaJuridica(empresaId)` (client, supabase anon): `select
  empregadores.* from empresas join ...` devolvendo o empregador da marca ou
  `null`. Cacheado por `empresaId` na sessão do módulo.
- `usePessoaJuridica()` hook sobre `useEmpresaAtual`, para componentes de
  impressão.

Server-side, `lib/certificadoServer.js` expõe `obterCertificadoAtivo`. A rota
de upload de NF-e troca o `select cnpj from empresas` por
`select empregadores.cnpj via empresas.empregador_id`; se a marca não tiver
vínculo, cai no comportamento atual (segue sem conferir), com a mesma
justificativa já escrita no código.

## Fluxo de dados

```
admin → /empresas (form) → supabase anon → empregadores (RLS admin_write)
admin → /empresas (bloco A1) → POST /api/empresas/[id]/certificado
       → inspecionarPfx → confere CNPJ → cifrar → certificados_digitais (service role)
processo (NF-e fase 2/3) → obterCertificadoAtivo(empregadorId) → decifrar → pfx em memória
impressão → usePessoaJuridica() → empresas.empregador_id → empregadores
```

## Erros e casos de borda

- CNPJ duplicado ao criar: o `unique` devolve 23505; a tela traduz para
  "Já existe uma empresa com este CNPJ".
- Inativar pessoa jurídica com marcas vinculadas: permitido (é só `ativo`), mas
  a tela avisa quantas marcas apontam para ela.
- Excluir: não oferecido. Quatro tabelas referenciam `empregadores`; a
  desativação é o caminho, como nos outros cadastros.
- Certificado cujo CNPJ não bate: recusado, mensagem mostra os dois.
- `CERTIFICADO_CHAVE` ausente na Vercel: o POST devolve 500 com a instrução de
  configurar; a tela exibe a mensagem como veio. O restante da tela funciona.
- Certificado vencido no banco: `GET` devolve `vencido`; a lista mostra o badge
  vermelho. Não bloqueia nada nesta fase.

## Testes

- Unitários em `tests/certificado.test.mjs` (`npm test`, `node --test`): `cifrar`/`decifrar` ida e volta; `decifrar` com tag alterada
  falha; `inspecionarPfx` com um pfx de teste autoassinado gerado por `openssl`
  no próprio teste (CN com CNPJ fictício), senha certa e errada; extração de
  CNPJ por OID e por CN.
- Migração: aplicar em banco de desenvolvimento, conferir que as 4 marcas
  ficam com `empregador_id` e que sobram exatamente 2 linhas em
  `empregadores`.
- Manual no preview: criar pessoa jurídica, editar, enviar pfx válido, enviar
  com senha errada, enviar pfx de outro CNPJ, remover, vincular marca,
  confirmar que `/ponto/unidades` ainda lista empregadores e que o upload de
  NF-e segue conferindo o CNPJ da Steakhouse.

## Entrega em ordem

1. Migração 30 + aplicação em produção (com ok explícito, conforme regra de
   escrita no banco de produção).
2. `lib/certificadoServer.js` + testes + `node-forge`.
3. Rotas da API.
4. Tela `/empresas`, menu, ajuste em `/ponto/unidades`.
5. Helper `lib/empresa.js` e troca no upload de NF-e.
6. `CERTIFICADO_CHAVE` na Vercel e no `.env.local.example`; memória de deploy.
