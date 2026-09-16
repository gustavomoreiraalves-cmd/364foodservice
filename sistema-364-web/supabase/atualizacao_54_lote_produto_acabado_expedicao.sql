-- supabase/atualizacao_54_lote_produto_acabado_expedicao.sql
--
-- Troca a chave de rastreio de lote na expedição de matéria-prima
-- (expedicao_itens.recebimento_item_id) para embalagem/produção
-- (embalagem_id) — o código impresso na etiqueta do produto acabado, não o
-- lote de origem da matéria-prima. Resolve a ambiguidade documentada em
-- app/expedicao/[id]/page.js: quando duas embalagens diferentes consomem a
-- mesma matéria-prima, o sistema não tinha como saber qual embalagem
-- originou uma unidade expedida específica. Spec:
-- docs/superpowers/specs/2026-09-16-lote-produto-acabado-expedicao-design.md
--
-- Aditiva: recebimento_item_id fica na tabela (romaneios já finalizados não
-- mudam); só gravações novas passam a preencher embalagem_id. A view não dá
-- pra recriar com `create or replace` porque a lista de colunas mudou
-- (`create or replace view` recusa isso) — por isso é `drop view if exists
-- ... cascade` seguido de `create view`; ainda idempotente (o `if exists`
-- faz a segunda rodada não falhar), só não é "substituição no lugar".
begin;

alter table public.expedicao_itens
  add column if not exists embalagem_id uuid references public.embalagens(id);
create index if not exists expedicao_itens_embalagem_idx on public.expedicao_itens(embalagem_id);

-- Junto com a troca de chave: (a) validade vira min() dentro do grupo
-- produto+embalagem (uma embalagem pode ter consumido mais de uma matéria-
-- prima com validades diferentes pro mesmo produto — a mais próxima é a que
-- importa); (b) embalagem em rascunho para de contar como saldo disponível
-- (bug lateral fechado junto, aprovado no design).
drop view if exists public.vw_estoque_produto_lote cascade;
create view public.vw_estoque_produto_lote as
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

commit;

-- ---------- ROLLBACK ----------
-- begin;
-- drop view if exists public.vw_estoque_produto_lote cascade;
-- create view public.vw_estoque_produto_lote as
-- select
--   ei.empresa_id,
--   ei.produto_id,
--   ei.recebimento_item_id,
--   ei.validade,
--   sum(ei.quantidade) as total_embalado,
--   coalesce((
--     select sum(exi.quantidade) from public.expedicao_itens exi
--     join public.expedicao_caixas ec on ec.id = exi.expedicao_caixa_id
--     join public.expedicoes ex on ex.id = ec.expedicao_id
--     where exi.recebimento_item_id = ei.recebimento_item_id
--       and exi.produto_id = ei.produto_id
--       and ex.status <> 'cancelado'
--   ), 0) as total_expedido,
--   sum(ei.quantidade) - coalesce((
--     select sum(exi.quantidade) from public.expedicao_itens exi
--     join public.expedicao_caixas ec on ec.id = exi.expedicao_caixa_id
--     join public.expedicoes ex on ex.id = ec.expedicao_id
--     where exi.recebimento_item_id = ei.recebimento_item_id
--       and exi.produto_id = ei.produto_id
--       and ex.status <> 'cancelado'
--   ), 0) as saldo
-- from public.embalagem_itens ei
-- where ei.recebimento_item_id is not null
-- group by ei.empresa_id, ei.produto_id, ei.recebimento_item_id, ei.validade;
-- alter table public.expedicao_itens drop column if exists embalagem_id;
-- commit;
