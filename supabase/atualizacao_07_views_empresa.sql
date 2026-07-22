-- =========================================================
-- 364 — ATUALIZAÇÃO 07: VIEWS DE ESTOQUE POR EMPRESA
-- Antes de rodar, confirme a versão do Postgres no SQL Editor:
--   select version();
-- security_invoker exige Postgres 15+. Se o projeto estiver em versão
-- anterior, NÃO rode este arquivo — avise para mover o cálculo de estoque
-- para o client (mesmo estilo já usado em app/relatorios/page.js) em vez de view.
--
-- Sem security_invoker, a view roda com o dono (role postgres) e não respeita
-- a RLS de quem está consultando — vazaria linhas de todas as empresas.
-- Rode depois de atualizacao_06_rls_multiempresa.sql.
-- =========================================================

drop view if exists vw_estoque_materia_prima;
create view vw_estoque_materia_prima
with (security_invoker = true) as
select
  mp.empresa_id,
  mp.id as materia_prima_id,
  mp.nome,
  mp.unidade,
  coalesce(sum(r.quantidade), 0) as total_recebido,
  coalesce((select sum(pc.quantidade) from producao_consumo pc
            where pc.materia_prima_id = mp.id and pc.empresa_id = mp.empresa_id), 0) as total_consumido,
  coalesce(sum(r.quantidade), 0)
  - coalesce((select sum(pc.quantidade) from producao_consumo pc
              where pc.materia_prima_id = mp.id and pc.empresa_id = mp.empresa_id), 0) as saldo
from materias_primas mp
left join recebimentos r on r.materia_prima_id = mp.id and r.empresa_id = mp.empresa_id
group by mp.empresa_id, mp.id, mp.nome, mp.unidade;

drop view if exists vw_estoque_defumado;
create view vw_estoque_defumado
with (security_invoker = true) as
select
  mp.empresa_id,
  mp.id as materia_prima_id,
  mp.nome,
  coalesce((select sum(di.peso_final_kg) from defumacao_itens di
            where di.materia_prima_id = mp.id and di.empresa_id = mp.empresa_id), 0) as total_defumado,
  coalesce((select sum(ei.quantidade * ft.quantidade) from embalagem_itens ei
            join ficha_tecnica ft on ft.produto_id = ei.produto_id and ft.materia_prima_id = mp.id
            where ei.empresa_id = mp.empresa_id), 0) as total_embalado,
  coalesce((select sum(di.peso_final_kg) from defumacao_itens di
            where di.materia_prima_id = mp.id and di.empresa_id = mp.empresa_id), 0)
  - coalesce((select sum(ei.quantidade * ft.quantidade) from embalagem_itens ei
              join ficha_tecnica ft on ft.produto_id = ei.produto_id and ft.materia_prima_id = mp.id
              where ei.empresa_id = mp.empresa_id), 0) as saldo_kg
from materias_primas mp;

drop view if exists vw_estoque_produto;
create view vw_estoque_produto
with (security_invoker = true) as
select
  p.empresa_id,
  p.id as produto_id,
  p.codigo,
  p.nome,
  p.unidade,
  coalesce((select sum(pr.quantidade) from producoes pr
            where pr.produto_id = p.id and pr.empresa_id = p.empresa_id), 0) as total_produzido,
  coalesce((select sum(pi.quantidade) from pedido_itens pi join pedidos pe on pe.id = pi.pedido_id
            where pi.produto_id = p.id and pi.empresa_id = p.empresa_id and pe.status <> 'Cancelado'), 0) as total_vendido,
  coalesce((select sum(pr.quantidade) from producoes pr
            where pr.produto_id = p.id and pr.empresa_id = p.empresa_id), 0)
  - coalesce((select sum(pi.quantidade) from pedido_itens pi join pedidos pe on pe.id = pi.pedido_id
              where pi.produto_id = p.id and pi.empresa_id = p.empresa_id and pe.status <> 'Cancelado'), 0) as saldo
from produtos p;
