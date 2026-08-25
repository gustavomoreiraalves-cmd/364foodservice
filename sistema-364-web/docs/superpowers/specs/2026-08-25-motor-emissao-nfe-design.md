# Motor de Emissão de NF-e (modelo 55)

Data: 2026-08-25
Status: aprovado para plano de implementação

## Contexto

Segundo dos quatro specs derivados de
[2026-08-25-processo-pedido-romaneio-emissao-nfe-design.md](2026-08-25-processo-pedido-romaneio-emissao-nfe-design.md),
consumindo a configuração já desenhada em
[2026-08-25-configuracao-emissor-fiscal-design.md](2026-08-25-configuracao-emissor-fiscal-design.md)
(`empresas_emissao_fiscal`, `fiscal_numeracao`, certificado A1). É a peça de
maior risco regulatório do conjunto: assina XML, fala direto com a SEFAZ e
gera um documento que, uma vez autorizado, não se apaga — só se cancela ou
se corrige por evento.

`docs/fiscal/12-desenho-cadastro-fiscal.md` já tinha fixado, antes deste
spec, o mesmo princípio que a segunda opinião técnica reforçou no spec do
emissor: **quem emite é o CNPJ (`empregador_id`), a marca é só a origem
operacional da venda.** Este motor segue essa regra em cada tabela e em
cada chamada à SEFAZ.

Arquitetura técnica (assinatura XMLDSig, transporte mTLS via `undici`,
cifra do certificado) reaproveita o que já existe e está em produção no
lado de entrada
([2026-08-20-nfe-recebimento-design.md](2026-08-20-nfe-recebimento-design.md)):
mesma dependência (`xml-crypto`, `node-forge`, `fast-xml-parser`), mesmo
padrão de rota (`runtime = 'nodejs'`), mesma forma de carregar o
certificado (`lib/certificadoServer.js`/`lib/nfeCertificado.js`). Este spec
não repete essa base — só marca onde diverge (autorização em vez de
distribuição, XML próprio em vez de importado).

**Pesquisa feita antes de desenhar** (Portal Nacional, agosto de 2026):

- Rondônia usa o **SVRS** (Sefaz Virtual do Rio Grande do Sul) como
  ambiente de autorização — `NFeAutorizacao4` publicado em
  `nfe.svrs.rs.gov.br`. Endpoint exato (produção e homologação) e
  `SOAPAction` a confirmar contra o Manual de Integração vigente no
  momento da implementação, mesma cautela já registrada no spec de
  recebimento para o `distribuicaoDFe`.
- **Reforma Tributária (IBS/CBS) não é bloqueio da fase 1.** A migração 36
  já antecipou isso: `produtos.cst_ibs_cbs` nasce nulo porque a rejeição
  por ausência do grupo IBS/CBS só alcança contribuintes do Simples
  Nacional (CRT 1, o regime da 364) em **04/01/2027**. O motor não
  implementa os grupos IBS/CBS agora, mas o serializador de XML nasce
  organizado por versão de leiaute (ver "Versionamento de leiaute"
  abaixo) para não precisar de reescrita quando a data chegar.

## Escopo da fase 1

Dentro:

- Emissão de NF-e modelo 55, ambiente síncrono (autoriza no próprio
  request/polling curto, sem contingência offline real).
- Reserva atômica de número, resolvendo o que o spec do emissor deixou em
  aberto de propósito.
- Assinatura XMLDSig, transmissão `NFeAutorizacao4`, consulta de recibo
  (`NFeRetAutorizacao4`).
- Eventos de **cancelamento** (110111, janela de 24h) e **carta de
  correção** (110110) — regulatórios, não é opcional adiar.
- Geração de DANFE em PDF.
- Gatilho manual: botão "Emitir NF-e" no pedido já em status `Faturado`.

Fora (YAGNI da fase 1, não do produto):

- **NFC-e** (modelo 65) — fica para quando houver venda direta de fato; a
  configuração já suporta (spec do emissor), o motor não implementa ainda.
- **Contingência offline real** (emitir sem conexão com a SEFAZ e
  transmitir depois) — o estado `contingencia` já existe na máquina de
  estados do documento (abaixo) para o schema não precisar mudar quando
  a fase 2 chegar, mas o fluxo de emissão offline não é implementado
  agora.
- **Inutilização formal de numeração** — evento raro (número pulado por
  falha após transmissão confirmada); tratado manualmente pelo contador
  fora do sistema até este virar um problema real.
- **Grupos IBS/CBS completos** — ver "Pesquisa feita antes de desenhar".
- **Geração de Contas a Receber** — o próximo spec consome o evento
  "documento autorizado"; este motor só expõe esse evento (ver
  "Integração com specs futuros"), não implementa a conta.
- **Romaneio** — o gatilho desta fase é manual; a automação
  Conferido→Faturado é do próximo spec, e só troca quem chama o motor, não
  o motor em si.

## Máquina de estados do documento

```
rascunho → numero_reservado → assinado → enviado → autorizado
                                              ├──→ rejeitado
                                              └──→ erro_comunicacao

autorizado → cancelado          (evento 110111, janela de 24h)
autorizado → (carta de correção, evento 110110 — não muda o status)

contingencia                    (estado reservado para a fase 2, não
                                  alcançado por nenhum fluxo desta fase)
```

Regra central: **`rejeitado` e `erro_comunicacao` antes de `enviado` com
sucesso reaproveitam o mesmo número reservado** numa nova tentativa — o
número só foi consumido do ponto de vista da `fiscal_numeracao`, nunca
chegou a existir do ponto de vista da SEFAZ. Depois de `enviado` com
sucesso (recibo aceito), qualquer problema encerra o documento como
`rejeitado` definitivo e a próxima tentativa reserva um número **novo**
— reusar um número que a SEFAZ já viu é o erro que a reserva atômica existe
para prevenir.

## Numeração: reserva atômica

RPC que o spec do emissor deixou pendente, implementada agora que existe
um fluxo de transmissão para justificar as regras de reuso/descarte:

```sql
create or replace function public.reservar_numero_fiscal(
  p_empregador_id uuid, p_modelo text, p_ambiente text, p_serie int
)
returns int
language sql
security definer
set search_path = public
as $$
  update fiscal_numeracao
     set ultimo_numero = ultimo_numero + 1, updated_at = now()
   where empregador_id = p_empregador_id and modelo = p_modelo
     and ambiente = p_ambiente and serie = p_serie
  returning ultimo_numero;
$$;
```

O `UPDATE` é a barreira de concorrência: duas chamadas simultâneas para a
mesma chave bloqueiam uma na outra no nível de linha do Postgres, cada
uma recebe um número diferente, nenhuma vê o valor intermediário da outra
— não precisa de `select ... for update` separado nem de lock explícito
de aplicação.

Chamada só pelo service role, de dentro do pipeline de emissão (não é
exposta como RPC pública via PostgREST — revogada de `authenticated` e
`anon`). Se `fiscal_numeracao` não tiver linha para a chave (marca ainda
não foi ativada no spec do emissor), a função não retorna linha e o
pipeline aborta com mensagem clara antes de gastar um número.

## Schema

### `nfe_saida_documentos` (nova tabela)

| coluna | tipo | nota |
| --- | --- | --- |
| `id` | uuid pk | |
| `empresa_id` | uuid not null references `empresas(id)` | a marca de origem da venda |
| `empregador_id` | uuid not null references `empregadores(id)` | o emissor real; populado por trigger a partir de `empresas.empregador_id`, mesmo padrão do spec do emissor |
| `pedido_id` | uuid not null references `pedidos(id)` | |
| `natureza_operacao_id` | uuid not null references `naturezas_operacao(id)` | escolhida pelo operador ao clicar "Emitir NF-e" — não é sempre "venda": pode ser devolução, bonificação etc., e isso depende do motivo comercial, não só do destinatário |
| `modelo` | text not null default `'55'` | fixo nesta fase; coluna existe para quando NFC-e entrar |
| `ambiente` | text not null | copiado de `empresas_emissao_fiscal` no momento da emissão — a nota carrega o ambiente em que foi de fato transmitida, não o que está configurado *agora* |
| `serie`, `numero` | int | `numero` só é preenchido após `reservar_numero_fiscal` — `null` em `rascunho` |
| `chave` | char(44) | montada a partir de UF, data, CNPJ, modelo, série, número, código numérico aleatório e dígito verificador — só existe a partir de `numero_reservado` |
| `status` | text not null default `'rascunho'` | check nos valores da máquina de estados acima |
| `motivo_rejeicao` | text | preenchido em `rejeitado`/`erro_comunicacao` |
| `protocolo_autorizacao` | text | devolvido pela SEFAZ em `autorizado` |
| `xml_path`, `danfe_path` | text | bucket privado, mesmo padrão de `recebimentos` |
| `valor_total` | numeric(12,2) not null | soma de `nfe_saida_itens` |
| `emitida_em`, `cancelada_em` | timestamptz | |
| `created_at`, `updated_at` | timestamptz | |

`unique (empregador_id, modelo, ambiente, serie, numero)` — segunda barreira
contra duplicidade, agora no documento em si (a primeira já está em
`fiscal_numeracao`).

### `nfe_saida_itens` (nova tabela)

Snapshot congelado do que foi declarado à SEFAZ — `regras_tributarias`
muda com o tempo (correção de alíquota, mudança de CFOP), a nota já
emitida não pode mudar junto.

| coluna | tipo | nota |
| --- | --- | --- |
| `id` | uuid pk | |
| `nfe_saida_documento_id` | uuid not null references `nfe_saida_documentos(id)` on delete cascade | |
| `pedido_item_id` | uuid not null references `pedido_itens(id)` | rastreabilidade até o pedido original |
| `produto_id` | uuid not null references `produtos(id)` | |
| `ncm`, `cfop`, `cst_icms` ou `csosn` | text | copiados de `fn_resolver_regra_tributaria` no momento da emissão, não lidos de novo depois |
| `quantidade`, `valor_unitario`, `valor_total` | numeric | |
| `base_calculo_icms`, `aliquota_icms`, `valor_icms` | numeric | resultado do cálculo, não recalculado depois |
| (demais campos de ICMS-ST/PIS/COFINS conforme o resultado de `fn_resolver_regra_tributaria` para o item) | | |

### `nfe_saida_eventos` (nova tabela)

| coluna | tipo | nota |
| --- | --- | --- |
| `id` | uuid pk | |
| `nfe_saida_documento_id` | uuid not null references `nfe_saida_documentos(id)` | |
| `tipo` | text not null check `('cancelamento', 'carta_correcao')` | |
| `sequencia` | int not null | CC-e pode ter mais de uma; cancelamento é sempre 1 |
| `justificativa` | text not null | motivo do cancelamento ou texto da correção — mínimo de caracteres exigido pela SEFAZ, validado na API |
| `protocolo` | text | devolvido pela SEFAZ quando aceito |
| `xml_path` | text | |
| `status` | text not null default `'enviado'` check `('enviado', 'aceito', 'rejeitado')` | |
| `created_at` | timestamptz not null default now() | |

RLS de todas as três: padrão `empresa_id in (select public.empresas_permitidas())`,
igual ao resto do sistema (diferente de `certificados_digitais` e
`empresas_emissao_fiscal.csc_token_cifrado` — aqui não há segredo
guardado, é documento fiscal já público por natureza depois de autorizado).

## Versionamento de leiaute

O serializador de XML (`lib/sefazSaida/montarXml.js`) não monta a NF-e
como uma função monolítica com `if` espalhado por grupo tributário.
Estrutura: um "resolvedor" que junta pedido + `nfe_saida_itens` +
`fn_resolver_regra_tributaria` num objeto intermediário neutro
(`{ emitente, destinatario, itens: [{ produto, tributos: { icms, pis,
cofins, ibsCbs? } }], ... }`), e um "serializador" que converte esse
objeto no XML da versão de leiaute vigente. Hoje só existe o serializador
da versão atual (sem IBS/CBS); quando 04/01/2027 chegar, entra um novo
serializador (ou uma ramificação por `vigente_em`), sem mexer no
resolvedor nem no restante do pipeline. Registrado aqui porque é decisão
de arquitetura que não pode nascer implícita numa função grande.

## Pipeline de emissão (`lib/sefazSaida/`)

Espelha `lib/sefaz/` do spec de recebimento, mas para autorização em vez
de distribuição:

1. **Validação prévia** — pedido em `Faturado`, sem `nfe_saida_documento`
   ainda `autorizado` para ele, certificado do `empregador_id` ativo e não
   vencido, configuração em `empresas_emissao_fiscal` ativa para o
   modelo/ambiente da marca.
2. **Resolver tributos** — `fn_resolver_regra_tributaria` por item, grava
   em `nfe_saida_itens` (linha ainda sem `nfe_saida_documento_id`
   confirmado, transação só comita no fim).
3. **Reservar número** — `reservar_numero_fiscal`, grava `serie`/`numero`,
   monta `chave`, status → `numero_reservado`.
4. **Montar XML** — resolvedor + serializador da versão vigente.
5. **Assinar** — XMLDSig enveloped, RSA-SHA1, C14N, mesmo padrão de
   `lib/sefaz/assinatura.js`; status → `assinado`.
6. **Transmitir** — `NFeAutorizacao4` via `undici` com mTLS
   (`pfx`/`passphrase` do certificado carregado em memória, nunca em
   disco); status → `enviado`.
7. **Consultar recibo** — `NFeRetAutorizacao4`; SVRS pode devolver lote
   ainda em processamento, pipeline faz polling curto (poucos segundos,
   não é assíncrono de longo prazo como a distribuição).
8. **Gravar resultado** — `autorizado` (protocolo, `xml_path` do XML
   autorizado) ou `rejeitado`/`erro_comunicacao` (motivo, número liberado
   para reuso conforme a regra da máquina de estados).
9. **Gerar DANFE** — só a partir de `autorizado`; biblioteca de geração de
   PDF a avaliar na implementação (o layout tem Manual de Padrões
   Técnicos próprio, decisão não trava este spec).

Cancelamento e carta de correção seguem pipeline equivalente e mais curto
(monta evento → assina → transmite → grava em `nfe_saida_eventos`),
reaproveitando a mesma assinatura e o mesmo transporte.

## Integração com specs futuros

Este motor não gera Contas a Receber nem participa do romaneio — expõe o
necessário para que os próximos specs se conectem sem precisar mudar
nada aqui:

- **Romaneio** troca quem chama o pipeline de emissão (de botão manual
  para a transição automática Conferido→Faturado), sem alterar o pipeline.
- **Contas a Receber** escuta a transição de `nfe_saida_documentos.status`
  para `autorizado` (a decisão de como — trigger de banco, verificação no
  próprio endpoint que grava `autorizado`, ou consulta ao carregar a
  tela — fica para aquele spec, que já vai ter a tabela `contas_a_receber`
  desenhada e pode escolher o ponto de menor acoplamento).

## Interface

- **Botão "Emitir NF-e"** no detalhe do pedido (`app/pedidos/[id]/page.js`),
  visível quando `status = 'Faturado'` e não há `nfe_saida_documento`
  `autorizado` vinculado. Abre um passo intermediário para escolher a
  natureza de operação (pré-selecionada quando só houver uma cadastrada
  para a marca).
- **Bloco de status da nota** no mesmo pedido: rascunho/enviando/
  autorizado (com link para XML e DANFE)/rejeitado (com motivo e botão
  "Tentar novamente", que reaproveita o número já reservado).
- **Ações em nota autorizada**: "Cancelar" (dentro da janela de 24h,
  exige justificativa) e "Carta de correção" (exige texto, sem limite de
  janela regulatório tão curto).
- Nenhuma tela nova além da já existente de pedido — não cria um módulo
  "Notas de Saída" separado nesta fase; se o volume justificar uma
  listagem própria, isso é decisão de UX para depois de rodar em
  produção, não deste spec.

## Tratamento de erro

- Certificado ausente/vencido: pipeline aborta antes de reservar número,
  mensagem aponta para `/empresas`.
- Configuração inativa (`empresas_emissao_fiscal.ativo = false` para o
  modelo/ambiente): aborta antes de reservar número, mensagem aponta para
  `/fiscal/emissor`.
- SEFAZ fora do ar ou timeout na transmissão: `erro_comunicacao`, número
  liberado para nova tentativa, sem exigir ação manual além de clicar
  "Tentar novamente" — isso não é contingência formal (que exigiria emitir
  offline e transmitir depois), é só retry.
- Rejeição por schema/validação (ex: XML mal formado, alíquota
  inconsistente): `rejeitado`, motivo exibido, corrigir dado de origem
  antes de tentar de novo — mesmo número.
- Rejeição por duplicidade (a SEFAZ já viu esse número+chave): não deveria
  acontecer dado o índice único local, mas se acontecer o documento vai
  para `rejeitado` definitivo e a próxima tentativa reserva número novo.
- Falha ao gerar DANFE depois de autorizado: não desfaz a autorização —
  nota já existe do ponto de vista fiscal; tela mostra "gerar DANFE
  novamente" como ação separada, reaproveitando o XML já salvo.

## Testes

Seguindo `node --test tests/*.test.mjs`:

- `montarXml` sobre um pedido fixture: estrutura esperada, itens batem
  com `nfe_saida_itens`, chave de acesso com dígito verificador correto.
- `reservar_numero_fiscal`: duas chamadas concorrentes (via `Promise.all`
  contra um Postgres de teste) nunca recebem o mesmo número; chave
  inexistente não retorna número e não lança exceção não tratada.
- Máquina de estados: transição de `rejeitado`/`erro_comunicacao` para
  nova tentativa reaproveita `serie`/`numero`; transição a partir de
  `enviado` bem-sucedido nunca reaproveita.
- Assinatura XMLDSig: mesmo teste de round-trip já usado no spec de
  recebimento, aplicado ao XML de autorização.
- Evento de cancelamento fora da janela de 24h é rejeitado antes de
  chamar a SEFAZ (checagem local, evita gastar uma tentativa).
- `fn_resolver_regra_tributaria` sem regra cadastrada para o item aborta
  a emissão com mensagem apontando o produto, não deixa a nota sair sem
  tributo.

Sem chamada de rede real em teste automatizado — validação contra o
ambiente de homologação da SVRS é manual, mesma prática já estabelecida
no spec de recebimento.

## Migração

Próximo número sequencial livre no momento da implementação, depois da
migração criada pelo spec do emissor — cria `nfe_saida_documentos`,
`nfe_saida_itens`, `nfe_saida_eventos`, a função `reservar_numero_fiscal`
e o trigger que popula `empregador_id`. Sem backfill.

## Decisões registradas

| decisão | escolha |
| --- | --- |
| Escopo da fase 1 | Só NF-e 55, síncrono; NFC-e e contingência offline real ficam para depois |
| Gatilho | Botão manual em pedido `Faturado`; motor não sabe nem precisa saber que existirá romaneio |
| Reuso de número | Reaproveita antes de `enviado` com sucesso; nunca depois |
| Natureza de operação | Escolhida pelo operador na emissão, não inferida sozinha — depende do motivo comercial |
| Snapshot fiscal | `nfe_saida_itens` congela o resultado de `fn_resolver_regra_tributaria`, nunca recalcula depois de emitida |
| IBS/CBS | Fora da fase 1 — prazo real é 04/01/2027 para CRT 1, conforme já registrado na migração 36; motor nasce com serializador versionável para não precisar de reescrita |
| Endpoint SEFAZ | SVRS (RO), a confirmar contra o manual vigente na implementação |
| Geração de Contas a Receber | Não é deste spec — próximo spec escuta o evento "autorizado" |
