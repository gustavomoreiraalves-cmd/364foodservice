# Lote de produto acabado no romaneio — design

Data: 2026-09-16
Status: aprovado, aguardando plano de implementação

## Motivação

A tela de romaneio (`/expedicao/[id]`) hoje só deixa o operador confirmar
caixas e dados de transportadora — o lote de cada produto é alocado sozinho
por FEFO, sem o operador ver ou poder ajustar. Pedido do usuário: mostrar e
permitir informar quantidade e lote de cada produto faturado.

O problema não é só de tela: o sistema hoje rastreia o "lote" da unidade
expedida pela **matéria-prima** que entrou nela
(`expedicao_itens.recebimento_item_id` → `recebimento_itens.lote`), não pelo
**lote de produção/embalagem** (`embalagens.lote` — o código impresso na
etiqueta do produto acabado). Quando duas embalagens diferentes consomem a
mesma matéria-prima (mesmo produto + mesmo lote de origem), o sistema não
tem como saber qual embalagem originou uma unidade específica já expedida —
`vw_estoque_produto_lote` funde o saldo das duas, e o código já documenta a
limitação (`app/expedicao/[id]/page.js`, comentários de
`carregarFabricacaoValidade`).

Decisão confirmada com o usuário: "lote" = lote de produção/embalagem
(`embalagens.lote`), e a correção é na raiz — trocar a chave de rastreio de
estoque/expedição de matéria-prima para embalagem, não um patch de
desempate manual por cima do modelo atual.

## Modelo de dados

### `expedicao_itens`

Nova coluna `embalagem_id uuid references embalagens(id)`, nullable (mesma
semântica de "sem lote" que `recebimento_item_id` tem hoje, pra produto não
rastreado ou sem saldo). `recebimento_item_id` **fica na tabela**, sem
migração de dado — romaneios já finalizados continuam com o que já tinham;
só as gravações novas passam a preencher `embalagem_id` em vez de
`recebimento_item_id`. Sem backfill: não há como recuperar, para uma
expedição antiga, qual embalagem específica originou a unidade (é
exatamente a mesma ambiguidade que estamos corrigindo daqui pra frente).

### `vw_estoque_produto_lote`

Reescrita para agrupar por `(empresa_id, produto_id, embalagem_id)` em vez
de `(empresa_id, produto_id, recebimento_item_id, validade)`, com join em
`embalagens` para trazer `lote` e `data` (fabricação) direto — sem
ambiguidade, porque cada `embalagem_itens` pertence a exatamente uma
embalagem.

```sql
create or replace view public.vw_estoque_produto_lote as
select
  ei.empresa_id,
  ei.produto_id,
  ei.embalagem_id,
  emb.lote,
  emb.data as fabricacao,
  min(ei.validade) as validade,
  sum(ei.quantidade) as total_embalado,
  coalesce((
    select sum(exi.quantidade) from public.expedicao_itens exi
    join public.expedicao_caixas ec on ec.id = exi.expedicao_caixa_id
    join public.expedicoes ex on ex.id = ec.expedicao_id
    where exi.embalagem_id = ei.embalagem_id
      and exi.produto_id = ei.produto_id
      and ex.status <> 'cancelado'
  ), 0) as total_expedido,
  sum(ei.quantidade) - coalesce((
    select sum(exi.quantidade) from public.expedicao_itens exi
    join public.expedicao_caixas ec on ec.id = exi.expedicao_caixa_id
    join public.expedicoes ex on ex.id = ec.expedicao_id
    where exi.embalagem_id = ei.embalagem_id
      and exi.produto_id = ei.produto_id
      and ex.status <> 'cancelado'
  ), 0) as saldo
from public.embalagem_itens ei
join public.embalagens emb on emb.id = ei.embalagem_id and emb.status = 'finalizada'
group by ei.empresa_id, ei.produto_id, ei.embalagem_id, emb.lote, emb.data;
```

(Mesmo padrão de subquery escalar repetida que a view original já usa —
não uma lateral join — pra ficar consistente com o resto do arquivo de
migração 50 e não precisar de `embalagem_id` em `embalagem_itens` além do
que já existe.)

Duas mudanças de comportamento junto com a troca de chave (achado desta
tarefa, aprovado com o usuário):
- **`validade`** passa a ser `min(ei.validade)` dentro do grupo produto+
  embalagem (uma embalagem pode ter consumido mais de um lote de matéria-
  prima com validades diferentes pro mesmo produto — a mais próxima é a que
  importa pra FEFO e pra não vender algo mais perto de vencer do que a
  etiqueta sugere).
- **`emb.status = 'finalizada'`** no join: fecha um bug lateral onde uma
  embalagem ainda em rascunho contava como estoque disponível na view
  atual (sem filtro de status nenhum). Embalagem não finalizada não deveria
  ser saldo expedível.

Migração nova: `supabase/atualizacao_54_lote_produto_acabado_expedicao.sql`
(aditiva — coluna nova + view recriada; sem `drop`/backfill destrutivo).

## Backend

### `lib/expedicao.js`

`sugerirAlocacao`/`empacotarCaixas`: campo `recebimentoItemId` renomeado
para `embalagemId` em toda a assinatura/retorno — lógica pura (FEFO,
empacotamento, divergência) não muda, só a chave que carrega.

### `app/api/expedicao/[id]/route.js` (PUT — salvar rascunho)

Grava `embalagem_id` em `expedicao_itens` (troca a linha
`recebimento_item_id: item.recebimentoItemId || null` por
`embalagem_id: item.embalagemId || null`). Resto da rota (validação de
transportadora/itens do pedido, regravação completa das caixas) não muda.

### Etiqueta de despacho (`app/expedicao/[id]/page.js:imprimirEtiquetaCaixa`)

Hoje lê `i.recebimento_itens?.lote` (join com o lote de matéria-prima) e
resolve fabricação/validade via `carregarFabricacaoValidade` (a função com
a lógica de "fica a primeira encontrada"). Depois da migração, o select de
`expedicao_caixas` troca o embed de `recebimento_itens(lote)` para
`embalagens(lote, data)`, e a etiqueta lê `i.embalagens?.lote`/`.data`
direto — **`carregarFabricacaoValidade` e o estado
`fabricacaoValidadePorItem` são removidos**, porque a informação já vem
sem ambiguidade no mesmo select das caixas.

## Frontend (`/expedicao/[id]`)

Nova seção **"Alocação por produto"**, entre o cabeçalho do romaneio e a
seção "Caixas" existente:

- Uma linha por item do pedido (produto + quantidade pedida).
- Sub-linhas editáveis de alocação: select de lote (embalagem) disponível
  — texto `lote — validade — saldo Xun.`, ordenado FEFO — mais campo de
  quantidade. Pré-preenchidas pela sugestão FEFO atual (`sugerirAlocacao`),
  igual já acontece hoje só que agora visível e editável.
- Opção **"Sem lote"** no select — mesmo fallback que já existe hoje pra
  produto não rastreado ou sem saldo cobrindo a quantidade.
- Botão "+ lote" adiciona uma sub-linha nova pro mesmo item (split manual
  entre lotes); "×" remove uma sub-linha.
- Total alocado vs. pedido por item, visível inline (reaproveita
  `calcularDivergencia`, hoje só usada no erro do finalizar — passa a
  também alimentar essa exibição ao vivo).
- **"Caixas" continua existindo abaixo, só como resultado** — segue
  auto-calculada via `empacotarCaixas(alocacao, ...)` a partir da alocação
  (editada ou não), sem edição direta na caixa. Nada muda na regra de
  empacotamento (2 produtos distintos / 12 unidades por caixa).
- Reabertura de rascunho salvo: mesmo cuidado que já existe hoje — se o
  lote gravado no rascunho não aparecer mais na lista de saldo disponível
  da view (porque a própria alocação do rascunho já o consumiu), ele entra
  mesmo assim na lista de opções do select (mesmo padrão já usado em
  `PedidoForm`/`condicoesPagamento` pra cliente/condição inativos).

## Fora de escopo

- Backfill de romaneios já finalizados (não há como recuperar a embalagem
  de origem retroativamente).
- Peso real de caixa, otimização do algoritmo de empacotamento — inalterado.
- Qualquer mudança em `embalagens`/`embalagem_itens`/`producoes` em si —
  só o lado de leitura (view) e o lado de expedição mudam.

## Testes

- `lib/expedicao.js`: `sugerirAlocacao`/`empacotarCaixas` com a chave
  renomeada — testes existentes adaptados (`embalagemId` em vez de
  `recebimentoItemId`); comportamento de FEFO/empacotamento/divergência
  sem mudança, só a chave.
- Migração: teste de schema/vazio (padrão `tests/migracao-NN/` já usado no
  repo) confirmando a view nova existe e a coluna `expedicao_itens.
  embalagem_id` existe.
