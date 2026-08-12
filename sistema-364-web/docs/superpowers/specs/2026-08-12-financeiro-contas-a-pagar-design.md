# Financeiro — Categorias de Conta e Contas a Pagar

Data: 2026-08-12
Status: aprovado para plano de implementação

## Contexto

O sistema hoje tem uma tela solta de **Despesas** (`/despesas`): lançamento livre de
data, descrição, valor e responsável, sem categoria, sem vencimento, sem qualquer
vínculo com o módulo de Compras. Ao mesmo tempo, **Recebimento** (`/recebimentos`)
já lança notas fiscais de matéria-prima com fornecedor, itens, custo e status de
qualidade — mas o valor da nota nunca vira uma obrigação financeira: recebimento e
despesa são dois mundos desconectados.

Este ciclo cria o módulo **Financeiro**, unificando os dois lados: toda saída de
dinheiro do negócio (compra de matéria-prima, serviço, aluguel, o que for) passa a
ser uma única entidade — **Conta a Pagar** — categorizada, com vencimento e
rastreável até sua origem.

Este é um dos seis módulos identificados na análise de requisitos reversa do
sistema (Financeiro, Compras, Produção, Relatórios, Vendas, Pessoas). Compras,
Produção, Relatórios, Vendas e Pessoas ficam fora deste ciclo — o projeto evolui
módulo a módulo, e este documento cobre só Financeiro (mais o ponto de integração
já existente em Recebimento).

## Objetivo

- Cadastro de categoria de conta (4 tipos fixos: Custos Fixos, Custos Diretos,
  Custos Variáveis, Investimentos).
- Contas a Pagar: tela única que lista **toda** obrigação financeira da empresa,
  não importa a origem.
- Recebimento de matéria-prima passa a gerar automaticamente uma Conta a Pagar.
- Despesas manuais (aluguel, energia, serviços, notas fiscais avulsas que não são
  de matéria-prima) continuam possíveis, lançadas direto em Financeiro.
- A tela `/despesas` é aposentada — tudo que ela fazia passa a ser feito em
  Financeiro, com mais informação (categoria, fornecedor, vencimento, status).

## Fora de escopo (fica para outro ciclo)

- **Pedido de Compra** — solicitar compra a um fornecedor antes da mercadoria
  chegar. Só o vínculo Recebimento → Contas a Pagar entra agora.
- **Subcategorias** dentro dos 4 tipos fixos (ex: "Custos Fixos > Aluguel").
- Recalcular automaticamente a Conta a Pagar se um recebimento já salvo for
  editado depois (ex: um item que era Rejeitado vira Aceito). A conta nasce
  correta no momento do save; ajuste posterior é manual em Financeiro.
- Contas a **Receber** (lado de Vendas) — só contas a pagar.
- Relatório financeiro avançado por competência vs. caixa — os relatórios
  existentes (DRE simplificado, fluxo de caixa) mantêm exatamente o mesmo nível de
  simplicidade que já têm hoje, só trocando a fonte de dados.

## Modelo de dados

### Categoria de conta

Lista fixa no código da aplicação, no mesmo padrão já usado para
`fornecedores.categoria` (`app/fornecedores/page.js`) — não é uma tabela nova:

```js
const CATEGORIAS_CONTA = ['Custos Fixos', 'Custos Diretos', 'Custos Variáveis', 'Investimentos'];
```

`contas_a_pagar.categoria_conta` é `text not null` com `check` restringindo aos 4
valores.

### `contas_a_pagar` (nova tabela — substitui `despesas`)

| coluna | tipo | notas |
|---|---|---|
| `id` | uuid pk | |
| `descricao` | text not null | livre; para conta de recebimento, sugerir "Nota {numero} — {fornecedor}" |
| `categoria_conta` | text not null | check nos 4 tipos fixos |
| `fornecedor_id` | uuid not null, fk `fornecedores(id)` | **obrigatório em toda conta**, inclusive despesa 100% manual (aluguel/energia entram no cadastro de Fornecedores, categoria "Serviços" ou "Outros", que já existem) |
| `recebimento_id` | uuid null, fk `recebimentos(id)` | preenchido só quando a conta nasce de um Recebimento de matéria-prima |
| `nota_fiscal_numero` | text null | preenchido no lançamento manual quando há nota fiscal avulsa (não vinda de Recebimento) |
| `nota_fiscal_anexo_path` | text null | path no bucket privado (reaproveita o bucket `recebimentos`), preenchido junto com `nota_fiscal_numero` |
| `valor_total` | numeric(12,2) not null | soma das parcelas |
| `responsavel_id` | uuid null, fk `funcionarios(id)` | quem lançou |
| `empresa_id` | uuid not null, fk `empresas(id)` | RLS multiempresa, mesmo padrão de todo o sistema |
| `created_at` | timestamptz not null default now() | |

Quando `recebimento_id` está preenchido, `nota_fiscal_numero`/`nota_fiscal_anexo_path`
ficam vazios de propósito — a nota já está anexada no cabeçalho do recebimento,
acessível pelo link de origem; não duplica o arquivo.

**Três origens possíveis, mesma tabela, distinguidas por um selo na listagem:**

- **Recebimento** — `recebimento_id` preenchido.
- **Nota fiscal avulsa** — `recebimento_id` vazio, `nota_fiscal_numero` preenchido.
- **Despesa manual** — nem um nem outro; só descrição, fornecedor e categoria.

### `contas_a_pagar_parcelas` (nova tabela)

| coluna | tipo | notas |
|---|---|---|
| `id` | uuid pk | |
| `conta_a_pagar_id` | uuid not null, fk `contas_a_pagar(id)` on delete cascade | |
| `numero` | int not null | 1, 2, 3... (à vista = só a parcela 1) |
| `valor` | numeric(12,2) not null | |
| `vencimento` | date not null | |
| `status` | text not null default 'Pendente' | check em `('Pendente', 'Pago')` — **"Vencido" não é um status gravado**, é um estado derivado na UI (`status = 'Pendente' AND vencimento < hoje`), evita depender de job agendado pra atualizar linha |
| `data_pagamento` | date null | preenchido ao dar baixa |
| `forma_pagamento` | text null | Pix, Boleto, Transferência, Dinheiro — lista livre curta |
| `comprovante_path` | text null | path no bucket privado, preenchido ao dar baixa |
| `empresa_id` | uuid not null, fk `empresas(id)` | RLS |
| `created_at` | timestamptz not null default now() | |

### Regra de integridade: apagar um Recebimento com conta vinculada

Recebimento hoje permite excluir a nota inteira (cascade nos itens). Com o
vínculo novo:

- Se a Conta a Pagar vinculada **não tem nenhuma parcela paga**, excluir o
  Recebimento também exclui a Conta a Pagar e suas parcelas (cascade).
- Se **alguma parcela já foi paga**, a exclusão do Recebimento é bloqueada com
  aviso — evita apagar silenciosamente um registro de pagamento real. O usuário
  precisa primeiro tratar a Conta a Pagar em Financeiro.

## Fluxo: Recebimento gera Conta a Pagar

O formulário de Recebimento (cabeçalho da nota) ganha um bloco de **condição de
pagamento**, preenchido só no momento do lançamento (não é uma coluna persistida
em `recebimentos` — é usada na hora de gerar a Conta a Pagar e descartada depois):

- À vista, ou Parcelado (nº de parcelas + intervalo em dias entre elas).
- Categoria da conta, sugerida como "Custos Diretos" mas editável.

Ao salvar o recebimento:

1. Soma o `quantidade * custo_unitario` dos itens com status **Aceito** ou
   **Aceito com ressalva** (itens Rejeitados não entram — mesmo critério já usado
   no saldo de estoque e custo médio).
2. Se a soma for zero (todos os itens rejeitados), **não gera** Conta a Pagar.
3. Caso contrário, cria 1 `contas_a_pagar` (`fornecedor_id` = fornecedor do
   cabeçalho da nota, `recebimento_id` = o recebimento, `categoria_conta` = a
   escolhida no formulário, `valor_total` = a soma) e suas `contas_a_pagar_parcelas`
   (1 parcela se à vista; N parcelas com vencimentos espaçados pelo intervalo
   informado, primeira contando a partir da data da nota, se parcelado).

Essa geração acontece na camada da aplicação (mesmo lugar que já salva
`recebimentos` + `recebimento_itens` hoje), não em trigger de banco — a condição
de pagamento só existe no formulário, não em uma coluna persistida.

## Tela Contas a Pagar (Financeiro)

- Listagem com filtro por status (Pendente/Pago/Vencida), categoria, fornecedor e
  faixa de vencimento; vencidas com destaque visual.
- Lançamento manual: descrição, categoria (obrigatória), fornecedor (obrigatório,
  dropdown do cadastro existente), nota fiscal opcional (número + anexo),
  condição de pagamento (à vista/parcelado) igual ao Recebimento.
- Baixa de parcela: marcar como Pago, com data de pagamento, forma de pagamento e
  comprovante opcional.
- Linha vinda de Recebimento mostra link para a nota de origem; todos os campos
  (fornecedor, categoria, parcelas) continuam editáveis ali mesmo, sem precisar
  voltar no Recebimento.

## Migração de Despesas → Contas a Pagar

Script SQL (`atualizacao_16_financeiro_contas_a_pagar.sql`, seguindo a numeração
sequencial já usada em `supabase/`):

1. Cria `contas_a_pagar` e `contas_a_pagar_parcelas` com RLS multiempresa (mesmo
   padrão de `empresas_permitidas()` usado em todo o schema).
2. Adiciona colunas necessárias ao bucket de storage existente `recebimentos`
   (reaproveitado para anexo de nota avulsa e comprovante de pagamento — mesmas
   políticas de signed URL já em uso).
3. Backfill: cada linha de `despesas` vira 1 `contas_a_pagar` (`categoria_conta`
   = "Custos Fixos", `fornecedor_id` = precisa de um fornecedor "Outros" genérico
   criado no próprio script para as despesas antigas sem fornecedor real — dado
   que o campo é obrigatório daqui pra frente) + 1 parcela já com `status = 'Pago'`
   e `data_pagamento` = a `data` original (o dado antigo não distinguia
   pago/pendente; assume-se liquidado, já que já aconteceu no passado).
4. `despesas` é dropada só depois de confirmado o backfill (mesmo padrão cauteloso
   do `atualizacao_15_unificar_colaboradores.sql`).

## Impacto em telas existentes

- **`/despesas`** aposentada: redireciona para `/financeiro/contas-a-pagar`, some
  da sidebar — mesmo padrão já usado para aposentar `/usuarios` e `/funcionarios`.
- **`lib/auth.js`**: módulo `despesas` em `MODULOS` vira `financeiro` (label
  "Financeiro", `href: '/financeiro/contas-a-pagar'`).
- **`/relatorios`**: DRE simplificado e fluxo de caixa trocam a fonte —
  hoje somam `despesas.valor` direto; passam a somar `contas_a_pagar.valor_total`
  por empresa. Nenhuma mudança de lógica além da troca de tabela (mantém o mesmo
  nível "simplificado" que já existe — não introduz distinção pago/pendente ou
  competência/caixa neste ciclo).
- **Recebimento (`/recebimentos`)**: formulário ganha o bloco de condição de
  pagamento descrito acima.

## Decisões já validadas nesta conversa (log de referência)

- Despesas manuais viram Contas a Pagar — a tela antiga é aposentada, não coexiste.
- Categorias de conta são 4 tipos fixos, sem subcategoria.
- 1 conta a pagar por nota de recebimento (não por item).
- Pedido de Compra fica para outro ciclo.
- Vencimento/parcelamento entram como campos novos no formulário de Recebimento
  no momento do lançamento, não editados depois num rascunho vazio.
- Conta a pagar precisa de vencimento, status, parcelamento, data/forma de
  pagamento e anexo de comprovante.
- Categoria sugerida da conta gerada por Recebimento é "Custos Diretos", editável.
- Fornecedor e categoria de conta são obrigatórios em **toda** conta a pagar, sem
  exceção de origem (nota avulsa e despesa manual incluídas).
