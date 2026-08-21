-- =========================================================
-- 364 — ATUALIZAÇÃO 21: DASHBOARD CONSOLIDADA DO GRUPO
--
-- Antes de rodar, confirme a versão do Postgres no SQL Editor:
--   select version();
-- security_invoker exige Postgres 15+. Sem ele a view roda com o dono
-- (role postgres) e devolve linhas de todas as empresas, furando a RLS.
--
-- Rode depois de atualizacao_16_financeiro_contas_a_pagar.sql.
-- Tudo dentro de uma transação: falha no meio não deixa schema parcial.
-- =========================================================
begin;

-- ---------- CUSTO CADASTRADO NO PRODUTO ----------
-- Zero significa "não informado" — o cálculo cai no custo teórico da ficha.
alter table produtos add column if not exists custo_unitario numeric(12,2) not null default 0;

comment on column produtos.custo_unitario is
  'Custo unitário informado no cadastro. Zero = não informado; vw_produto_custo cai na ficha técnica.';

-- ---------- CUSTO EFETIVO POR PRODUTO ----------
drop view if exists vw_consolidado_mensal;
drop view if exists vw_produto_custo;

create view vw_produto_custo with (security_invoker = true) as
select
  p.empresa_id,
  p.id as produto_id,
  case when coalesce(p.custo_unitario, 0) > 0 then p.custo_unitario
       else coalesce(ft.custo_ficha, 0) end as custo_efetivo,
  case when coalesce(p.custo_unitario, 0) > 0 then 'cadastro'
       when coalesce(ft.custo_ficha, 0) > 0 then 'ficha'
       else 'sem_custo' end as origem_custo
from produtos p
left join lateral (
  select sum(f.quantidade * mp.custo_unitario) as custo_ficha
  from ficha_tecnica f
  join materias_primas mp
    on mp.id = f.materia_prima_id and mp.empresa_id = f.empresa_id
  where f.produto_id = p.id and f.empresa_id = p.empresa_id
) ft on true;

-- ---------- CONSOLIDADO MENSAL ----------
-- Uma linha por (empresa, mês). As fontes entram por union all e só depois
-- são somadas: juntá-las por join multiplicaria as linhas de venda pelas de
-- despesa e inflaria todo número da tela.
--
-- pedidos.data, recebimentos.data e parcelas.data_pagamento são `date` — o mês
-- sai direto. contas_a_pagar.created_at é `timestamptz` em UTC, e uma conta
-- lançada às 21h do dia 31 cairia no mês seguinte; só ela converte para
-- America/Sao_Paulo.
create view vw_consolidado_mensal with (security_invoker = true) as
with vendas as (
  select
    p.empresa_id,
    to_char(p.data, 'YYYY-MM') as mes,
    coalesce(sum(pi.quantidade * pi.preco_unitario)
             filter (where p.status <> 'Cancelado'), 0) as receita_competencia,
    coalesce(sum(pi.quantidade * pi.preco_unitario)
             filter (where p.status in ('Faturado', 'Enviado')), 0) as receita_caixa,
    coalesce(sum(pi.quantidade * coalesce(pc.custo_efetivo, 0))
             filter (where p.status <> 'Cancelado'), 0) as cmv,
    count(distinct p.id) filter (where p.status <> 'Cancelado') as pedidos_qtd,
    coalesce(sum(pi.quantidade) filter (where p.status <> 'Cancelado'), 0) as itens_qtd,
    count(distinct pi.produto_id) filter (
      where p.status <> 'Cancelado' and coalesce(pc.origem_custo, 'sem_custo') = 'sem_custo'
    ) as produtos_sem_custo,
    count(distinct pi.produto_id) filter (
      where p.status <> 'Cancelado' and pc.origem_custo = 'ficha'
    ) as produtos_custo_ficha
  from pedidos p
  join pedido_itens pi on pi.pedido_id = p.id and pi.empresa_id = p.empresa_id
  left join vw_produto_custo pc
    on pc.produto_id = pi.produto_id and pc.empresa_id = pi.empresa_id
  group by 1, 2
),
despesas_competencia as (
  select
    cp.empresa_id,
    to_char(cp.created_at at time zone 'America/Sao_Paulo', 'YYYY-MM') as mes,
    sum(cp.valor_total) as despesa_competencia
  from contas_a_pagar cp
  where cp.recebimento_id is null   -- conta de compra já é contada em `compras`
  group by 1, 2
),
despesas_caixa as (
  select
    pa.empresa_id,
    to_char(pa.data_pagamento, 'YYYY-MM') as mes,
    sum(pa.valor) as despesa_caixa
  from contas_a_pagar_parcelas pa
  where pa.status = 'Pago' and pa.data_pagamento is not null
  group by 1, 2
),
compras_mp as (
  select
    ri.empresa_id,
    to_char(r.data, 'YYYY-MM') as mes,
    sum(ri.quantidade * ri.custo_unitario) as compras
  from recebimento_itens ri
  join recebimentos r on r.id = ri.recebimento_id and r.empresa_id = ri.empresa_id
  where ri.status_recebimento in ('Aceito', 'Aceito com ressalva')
  group by 1, 2
),
base as (
  select empresa_id, mes,
         receita_competencia, receita_caixa, cmv,
         pedidos_qtd, itens_qtd, produtos_sem_custo, produtos_custo_ficha,
         0::numeric as despesa_competencia, 0::numeric as despesa_caixa, 0::numeric as compras
  from vendas
  union all
  select empresa_id, mes,
         0::numeric, 0::numeric, 0::numeric,
         0::bigint, 0::numeric, 0::bigint, 0::bigint,
         despesa_competencia, 0::numeric, 0::numeric
  from despesas_competencia
  union all
  select empresa_id, mes,
         0::numeric, 0::numeric, 0::numeric,
         0::bigint, 0::numeric, 0::bigint, 0::bigint,
         0::numeric, despesa_caixa, 0::numeric
  from despesas_caixa
  union all
  select empresa_id, mes,
         0::numeric, 0::numeric, 0::numeric,
         0::bigint, 0::numeric, 0::bigint, 0::bigint,
         0::numeric, 0::numeric, compras
  from compras_mp
)
select
  empresa_id,
  mes,
  sum(receita_competencia)  as receita_competencia,
  sum(receita_caixa)        as receita_caixa,
  sum(cmv)                  as cmv,
  sum(pedidos_qtd)          as pedidos_qtd,
  sum(itens_qtd)            as itens_qtd,
  sum(produtos_sem_custo)   as produtos_sem_custo,
  sum(produtos_custo_ficha) as produtos_custo_ficha,
  sum(despesa_competencia)  as despesa_competencia,
  sum(despesa_caixa)        as despesa_caixa,
  sum(compras)              as compras
from base
group by 1, 2;

-- ---------- PERMISSÃO DO MÓDULO 'grupo' ----------
-- Sem este insert a aba nasceria invisível para todos exceto administradores.
-- Quem hoje enxerga Relatórios já vê receita e margem da própria empresa.
insert into public.permissoes (user_id, modulo)
select p.user_id, 'grupo' from public.permissoes p where p.modulo = 'relatorios'
on conflict do nothing;

commit;
