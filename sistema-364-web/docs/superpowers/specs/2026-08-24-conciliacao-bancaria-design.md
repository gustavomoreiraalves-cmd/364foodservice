# Conciliação bancária — importação de extratos e faturas de cartão

**Data:** 2026-08-24
**Status:** aprovado em brainstorming, aguardando plano de implementação
**Migração:** 35

## Objetivo

Importar extratos bancários (Sicoob, Cresol, Sicredi, Banco do Brasil, Santander,
Bradesco) e faturas de cartão de crédito para dentro do módulo financeiro, e
conciliar cada saída com as parcelas do contas a pagar. Toda saída do banco deve
terminar registrada no contas a pagar: quando não existir lançamento
correspondente, o colaborador cria a conta a pagar na própria tela de
conciliação. A cada associação confirmada o sistema aprende o padrão
(descrição do extrato → fornecedor + categoria) e passa a sugerir
automaticamente nas importações seguintes.

### Decisões de escopo (aprovadas)

1. **Formatos aceitos:** PDF, OFX e CSV. PDF é extraído pela Claude API;
   OFX e CSV têm parsers determinísticos próprios (CSV irreconhecível cai no
   caminho da IA).
2. **Só saídas nesta fase.** Entradas (vendas, Pix recebidos, transferências)
   ficam visíveis no extrato importado com status `ignorado`, sem conciliação.
   Conciliar entradas com recebimentos/PDV é fase futura.
3. **Saída sem correspondência:** o colaborador cria a conta a pagar direto da
   linha do extrato, com formulário pré-preenchido, e a linha já sai conciliada.
4. **Fatura de cartão modelada linha a linha.** Cada compra da fatura concilia
   com uma conta a pagar individual (fornecedor real — Mercado Livre etc.).
   O pagamento da fatura no extrato bancário baixa em lote todas as parcelas
   vinculadas às linhas daquela fatura. A despesa é contada uma única vez.
5. **Aprendizado sugere, colaborador confirma.** Linhas chegam pré-associadas;
   confirmação em lote com um clique. Nada é conciliado sem revisão humana.

## Arquitetura

Segue o precedente do importador de NF-e (`app/api/nfe/*`): route handlers com
`autorizarModulo(request, 'financeiro')` + service role para escrita e parse;
leituras de tela continuam client-side via PostgREST com RLS, como o restante
do módulo financeiro. A chave da Claude API (`ANTHROPIC_API_KEY`) vive só no
servidor.

Alternativas descartadas: pipeline client-side (exigiria expor a API key ou
manter dois pipelines) e importação batch/cron (conciliação é interativa, o
colaborador está na tela).

## Modelo de dados (migração 35)

Quatro tabelas novas, todas com RLS `empresa_scoped_access`
(`empresa_id in (select public.empresas_permitidas())`), padrão das demais.

### `contas_bancarias`

Cadastro inexistente até aqui. Cartão de crédito é uma conta de tipo próprio —
a fatura importa contra ela.

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | uuid pk | `gen_random_uuid()` |
| `empresa_id` | uuid not null | → `empresas(id)` |
| `nome` | text not null | ex.: "Sicoob principal" |
| `instituicao` | text not null | Sicoob, Cresol, Sicredi, Banco do Brasil, Santander, Bradesco (texto livre) |
| `tipo` | text not null | check `('conta_corrente','cartao_credito')` |
| `agencia` | text | |
| `numero_conta` | text | número da conta ou final do cartão |
| `ativo` | boolean not null default true | |
| `created_at` | timestamptz not null default now() | |

### `extrato_importacoes`

Um registro por arquivo importado (modelo de `pdv_importacoes`).

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | uuid pk | |
| `empresa_id` | uuid not null | → `empresas(id)` |
| `conta_bancaria_id` | uuid not null | → `contas_bancarias(id)` |
| `tipo` | text not null | check `('extrato','fatura_cartao')` |
| `arquivo_path` | text not null | Storage, bucket `recebimentos` |
| `arquivo_nome` | text | |
| `formato` | text not null | check `('pdf','ofx','csv')` |
| `periodo_inicio` / `periodo_fim` | date | extraídos do arquivo |
| `status` | text not null | check `('processando','aguardando_conciliacao','concluida','erro')` |
| `total_lancamentos` / `conciliados` | int | contadores |
| `alerta` | text | divergência aritmética não bloqueante |
| `erro` | text | mensagem quando `status = 'erro'` |
| `created_at` | timestamptz not null default now() | |

### `extrato_lancamentos`

Cada linha do extrato ou da fatura.

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | uuid pk | |
| `importacao_id` | uuid not null | → `extrato_importacoes(id)` on delete cascade |
| `empresa_id` | uuid not null | → `empresas(id)` |
| `data` | date not null | |
| `descricao` | text not null | como veio do banco |
| `descricao_normalizada` | text not null | ver Normalização |
| `valor` | numeric(12,2) not null | sempre positivo; sinal vive em `tipo` |
| `tipo` | text not null | check `('saida','entrada')` |
| `documento` | text | número do documento quando houver |
| `hash_dedupe` | text not null | ver Dedupe; unique `(empresa_id, hash_dedupe)` |
| `status` | text not null | check `('pendente','sugerido','conciliado','ignorado')` |
| `parcela_sugerida_id` | uuid | → `contas_a_pagar_parcelas(id)`; sugestão do motor, não é vínculo |
| `padrao_id` | uuid | → `conciliacao_padroes(id)`; padrão que gerou a sugestão |
| `fatura_id` | uuid | → `extrato_importacoes(id)`; quando esta linha do extrato bancário é o pagamento de uma fatura de cartão |
| `created_at` | timestamptz not null default now() | |

Entradas nascem com `status = 'ignorado'`.

### `conciliacao_vinculos`

Associação lançamento ↔ parcela, N:N — um débito às vezes paga 2–3 boletos do
mesmo fornecedor de uma vez; o caso comum 1:1 é apenas um vínculo.

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | uuid pk | |
| `lancamento_id` | uuid not null | → `extrato_lancamentos(id)` on delete cascade |
| `parcela_id` | uuid not null | → `contas_a_pagar_parcelas(id)` |
| `valor_aplicado` | numeric(12,2) not null | |
| `baixou_parcela` | boolean not null | true quando a conciliação foi quem baixou a parcela; controla a reversão |
| `empresa_id` | uuid not null | → `empresas(id)` |
| `created_at` | timestamptz not null default now() | |

### `conciliacao_padroes`

O aprendizado. Sem ML — de-para no espírito de `lib/nfe/dePara.js`.

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | uuid pk | |
| `empresa_id` | uuid not null | → `empresas(id)` |
| `padrao` | text not null | descrição normalizada; unique `(empresa_id, padrao)` |
| `fornecedor_id` | uuid | → `fornecedores(id)` |
| `categoria_conta` | text | mesmas categorias de `CATEGORIAS_CONTA` |
| `usos` | int not null default 1 | |
| `ultimo_uso` | timestamptz | |

Regra de atualização: confirmação igual ao gravado incrementa `usos`;
fornecedor diferente sobrescreve e reseta `usos = 1` (última confirmação
vence).

`contas_a_pagar` e `contas_a_pagar_parcelas` não ganham coluna nova — a
conciliação vive nos vínculos e a baixa continua sendo o UPDATE de status já
existente.

## Pipeline de importação

**Rota:** `POST /api/financeiro/extratos/upload` — route handler,
`runtime = 'nodejs'`, `maxDuration = 300`. Autoriza com
`autorizarModulo(request, 'financeiro')`. Multipart: arquivo +
`conta_bancaria_id` + `tipo`.

Fluxo:

1. Upload no bucket `recebimentos`, path
   `{empresaId}/extratos/{importacaoId}/{arquivo}` (helper novo em
   `lib/storage.js`).
2. Cria `extrato_importacoes` com `status = 'processando'`.
3. Parse conforme formato:
   - **OFX** — `lib/extratos/parseOfx.js`. OFX 2.x é XML
     (`fast-xml-parser`, já no repo); 1.x é SGML, resolvido com
     pré-processamento simples de fechamento de tags. O `FITID` do banco entra
     no `hash_dedupe` — dedupe perfeito.
   - **CSV** — `lib/extratos/parseCsv.js`, detecção heurística de colunas
     (data, valor, descrição). Se não reconhecer o layout, o texto cai no
     caminho da IA.
   - **PDF** — `lib/extratos/extrairPdf.js`. Envia o PDF direto à Claude API
     (modelo `claude-sonnet-5`, override por env `EXTRATO_IA_MODELO`), com
     tool de saída estruturada:
     `{periodo, saldo_inicial, saldo_final, lancamentos[]: {data, descricao, valor, tipo, documento}}`.
     Sem lib de PDF no projeto — a API lê PDF nativamente.
4. **Validação aritmética:** extrato:
   `saldo_final − saldo_inicial ≈ Σ(entradas − saídas)` (tolerância de 1
   centavo); fatura: total ≈ soma das linhas. Divergência não bloqueia — grava
   `alerta` e a tela avisa.
5. **Normalização** da descrição → `descricao_normalizada`: maiúsculas, sem
   acento, remove sequências numéricas longas/datas/identificadores, colapsa
   espaços.
6. Insere `extrato_lancamentos` com dedupe: linha cujo hash já existe é pulada
   e contada como "já importada". Reimportar o mesmo arquivo é seguro e
   idempotente.
7. Roda o motor de sugestão: saídas terminam `pendente` ou `sugerido`.
8. Importação vira `aguardando_conciliacao`; resposta:
   `{total, novas, duplicadas, sugeridas, alerta}`. Ela passa a `concluida`
   quando nenhuma saída restar `pendente` ou `sugerido` (recalculado a cada
   conciliação/desfazer).

**Dedupe:** `hash_dedupe = sha256(conta_bancaria_id + data + valor + descricao_normalizada)`;
quando o OFX traz `FITID`, ele substitui a parte
`data+valor+descricao` do hash.

**Erro em qualquer etapa:** importação vira `erro` com mensagem; lançamentos
parciais daquela importação são apagados (o registro da importação permanece
para diagnóstico).

**Env nova:** `ANTHROPIC_API_KEY` (Vercel). Custo estimado por extrato PDF de
10 páginas: R$ 0,10–0,40.

## Motor de sugestão, conciliação e aprendizado

### Motor de sugestão

`lib/extratos/matching.js` — funções puras (rodam no servidor pós-importação e
no browser para ranquear candidatos):

1. Lookup em `conciliacao_padroes` por `descricao_normalizada` exata →
   fornecedor + categoria candidatos.
2. Busca parcelas `Pendente` da empresa com valor igual (tolerância de 1
   centavo) e vencimento numa janela de ±7 dias da data do débito; havendo
   fornecedor do padrão, filtra por ele.
3. Um candidato claro → `status = 'sugerido'`, grava `parcela_sugerida_id` e
   `padrao_id`. Vários ou nenhum → `pendente` (a UI ranqueia candidatos com a
   mesma lib).

### Conciliação — funções Postgres (atomicidade), chamadas por RPC

Route handlers em `app/api/financeiro/conciliacao/*`.

- **`fn_conciliar_lancamento(lancamento, parcelas[])`** — cria vínculo(s),
  lançamento vira `conciliado`, baixa parcela(s): `status = 'Pago'`,
  `data_pagamento` = data do débito, `forma_pagamento` inferida da descrição
  (contém PIX → Pix; BOLETO → Boleto; senão Transferência). Parcela já `Pago`
  só é vinculada (`baixou_parcela = false`), nunca re-baixada. Upsert do
  padrão no final. Tudo numa transação.
- **`fn_criar_conta_e_conciliar(...)`** — caso sem correspondência: cria
  `contas_a_pagar` + parcela única já paga + vínculo + padrão, numa transação.
- **Lote** — endpoint recebe array de lançamentos `sugerido` e itera
  `fn_conciliar_lancamento`; cada item é atômico, o lote não precisa ser.
- **Desfazer** — remove vínculo(s), lançamento volta a `pendente`; parcela
  volta a `Pendente` apenas quando `baixou_parcela = true`.

### Fatura de cartão

- `FORMAS_PAGAMENTO` em `lib/financeiro.js` ganha `'Cartão de Crédito'`.
- Linha de fatura concilia com parcela normalmente, mas **não baixa**
  (`baixou_parcela = false`) — a compra ainda não saiu do caixa.
- O pagamento da fatura aparece no extrato bancário; o colaborador associa o
  débito à importação da fatura (`fatura_id`), com sugestão do motor por valor
  total + descrição típica ("PAGAMENTO FATURA"). Confirmar dispara
  **`fn_conciliar_pagamento_fatura`**: baixa em lote todas as parcelas
  vinculadas às linhas daquela fatura, `data_pagamento` = data do débito,
  forma `Cartão de Crédito`.
- Débito diferente da soma conciliada (pagamento parcial, rotativo): alerta;
  baixa em lote só com confirmação explícita.

## UI

Padrões idênticos ao módulo atual: `AppShell`, `.panel`, `.form-grid`,
`.table-wrap`, tags de status, ações inline dentro da própria `<td>`,
`alert()` para erros, `useEmpresaAtual()` com `.eq('empresa_id', ...)` em toda
query, `fmtMoney`/`fmtDate` de `lib/format.js`.

### `/financeiro/contas-bancarias`

Cadastro simples: form-grid (nome, instituição, tipo, agência, número) +
tabela com ativar/desativar. Entrada nova em `lib/menu.js`, módulo
`financeiro` (permissão existente cobre).

### `/financeiro/conciliacao`

- **Topo:** seletor de conta bancária + componente `ImportarExtrato`
  (espelho de `components/ImportarNota.js`: input file escondido em
  label-botão, aceita `.pdf,.ofx,.csv`, Bearer token da sessão) + escolha
  extrato/fatura. Durante o processamento, "Extraindo lançamentos…" (chamada
  síncrona; PDF pode levar até ~1 min).
- **Importações recentes:** tabela com período, formato, status
  (`tag ok/warn/bad`), conciliados/total e aviso de divergência aritmética.
- **Lançamentos** da importação selecionada: filtros por status e tipo
  (selects controlados), ordenados por data. Colunas: data, descrição, valor,
  status, ação.
  - `sugerido`: sugestão inline (fornecedor · parcela · vencimento) com
    Confirmar / Trocar. Barra acima da tabela: "Confirmar N sugestões" em
    lote.
  - `pendente`: ação inline abre `.items-list` na `<td>` (padrão da baixa
    atual) com dropdown de parcelas candidatas ranqueadas no browser pela
    `matching.js`, e alternativa "Criar conta a pagar" — form inline
    pré-preenchido (valor, data, fornecedor/categoria do padrão) chamando
    `fn_criar_conta_e_conciliar`.
  - `conciliado`: mostra vínculo e botão Desfazer.
  - Entradas: tag `ignorado`; filtro as oculta por padrão.
  - Débito identificado como pagamento de fatura: ação "Associar à fatura"
    com dropdown de faturas de cartão abertas da conta.

### Fora de escopo desta fase

Nenhuma mudança na tela de contas a pagar além da constante nova de forma de
pagamento; sem toast, sem modal novo, sem dashboard de conciliação; sem
conciliação de entradas.

## Testes

### Migração (`tests/migracao-35/`)

`fixture.sql` + `cenarios.sql` + `verificar.sh` (psql em banco local
descartável, padrão da migração 33):

- Dedupe: reinserir o mesmo hash é rejeitado.
- `fn_conciliar_lancamento`: baixa a parcela, cria vínculo, faz upsert do
  padrão — e rollback total se uma etapa intermediária falhar.
- Parcela já paga: vincula sem re-baixar (`baixou_parcela = false`).
- `fn_criar_conta_e_conciliar`: conta + parcela paga + vínculo numa transação.
- `fn_conciliar_pagamento_fatura`: baixa em lote apenas as parcelas da fatura
  certa.
- Desfazer: parcela volta a `Pendente` somente quando `baixou_parcela = true`.

### Lógica pura (`node --test`, junto dos existentes)

- `tests/extratos-matching.test.mjs` — normalização de descrição, score,
  janela ±7 dias, tolerância de centavo, único-candidato vs ambíguo.
- `tests/extratos-parse-ofx.test.mjs` — fixtures OFX 1.x (SGML) e 2.x (XML),
  ampliadas com arquivos reais dos 6 bancos conforme coletados.
- `tests/extratos-parse-csv.test.mjs` — detecção heurística de colunas.
- `tests/extratos-validacao.test.mjs` — validação aritmética com resposta da
  IA mockada (testes nunca chamam a API).

Implementação segue TDD.

## Rollout

1. Migração 35 na produção via psql (`SUPABASE_DB_URL`) — somente com
   aprovação explícita do usuário, como de costume.
2. `ANTHROPIC_API_KEY` no Vercel (chave criada pelo usuário no console
   Anthropic).
3. Cadastro das contas: Sicoob, Cresol, Sicredi, BB, Santander, Bradesco +
   cartões.
4. Piloto: um extrato real + uma fatura real, com conferência manual dos
   matches antes de liberar o uso geral.
