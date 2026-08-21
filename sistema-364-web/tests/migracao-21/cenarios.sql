\set ON_ERROR_STOP on

-- O fixture concede select em massa antes das views existirem. Em produção o
-- Supabase cuida disso por default privileges; aqui é preciso conceder à mão,
-- senão o cenário de RLS lá embaixo falha por falta de permissão, e não por
-- security_invoker.
grant select on vw_produto_custo, vw_consolidado_mensal to authenticated;

-- fixture.sql é o retrato do schema ANTES da migração 21 — por isso não pode
-- preencher produtos.custo_unitario, coluna que só passa a existir depois que
-- a migração roda. P1 (custo cadastrado = 30) só pode ser gravado aqui.
update produtos set custo_unitario = 30.00
 where id = '50000000-0000-0000-0000-000000000001';

\echo '# vw_produto_custo resolve custo por cadastro, ficha e ausência'
do $$
declare c numeric; o text;
begin
  select custo_efetivo, origem_custo into c, o from vw_produto_custo
   where produto_id = '50000000-0000-0000-0000-000000000001';
  if c <> 30.00 or o <> 'cadastro' then
    raise exception 'P1 deveria ser 30/cadastro, veio %/%', c, o; end if;

  select custo_efetivo, origem_custo into c, o from vw_produto_custo
   where produto_id = '50000000-0000-0000-0000-000000000002';
  if c <> 40.00 or o <> 'ficha' then
    raise exception 'P2 deveria ser 40/ficha (2kg x 20), veio %/%', c, o; end if;

  select custo_efetivo, origem_custo into c, o from vw_produto_custo
   where produto_id = '50000000-0000-0000-0000-000000000003';
  if c <> 0 or o <> 'sem_custo' then
    raise exception 'P3 deveria ser 0/sem_custo, veio %/%', c, o; end if;
end $$;

\echo '# receita de competência exclui cancelado; caixa só faturado/enviado'
do $$
declare r record;
begin
  select * into r from vw_consolidado_mensal
   where empresa_id = '20000000-0000-0000-0000-00000000000a' and mes = '2026-07';

  -- competência: 2x100 (faturado) + 1x60 + 1x10 (pendente) = 270. Cancelado (500) fora.
  if r.receita_competencia <> 270.00 then
    raise exception 'receita_competencia deveria ser 270, veio %', r.receita_competencia; end if;
  -- caixa: só o faturado = 200.
  if r.receita_caixa <> 200.00 then
    raise exception 'receita_caixa deveria ser 200, veio %', r.receita_caixa; end if;
  if r.pedidos_qtd <> 2 then
    raise exception 'pedidos_qtd deveria ser 2 (cancelado fora), veio %', r.pedidos_qtd; end if;
  if r.itens_qtd <> 4 then
    raise exception 'itens_qtd deveria ser 4, veio %', r.itens_qtd; end if;
end $$;

\echo '# CMV usa o custo efetivo de cada produto'
do $$
declare r record;
begin
  select * into r from vw_consolidado_mensal
   where empresa_id = '20000000-0000-0000-0000-00000000000a' and mes = '2026-07';
  -- 2x30 (cadastro) + 1x40 (ficha) + 1x0 (sem custo) = 100.
  if r.cmv <> 100.00 then
    raise exception 'cmv deveria ser 100, veio %', r.cmv; end if;
  if r.produtos_sem_custo <> 1 then
    raise exception 'produtos_sem_custo deveria ser 1, veio %', r.produtos_sem_custo; end if;
  if r.produtos_custo_ficha <> 1 then
    raise exception 'produtos_custo_ficha deveria ser 1, veio %', r.produtos_custo_ficha; end if;
end $$;

\echo '# despesa ignora conta ligada a recebimento e respeita o fuso de São Paulo'
do $$
declare r record;
begin
  select * into r from vw_consolidado_mensal
   where empresa_id = '20000000-0000-0000-0000-00000000000a' and mes = '2026-07';
  -- 500 (energia) + 70 (lançada 01/08 UTC = 31/07 em SP). A NF de compra (200) fica fora.
  if r.despesa_competencia <> 570.00 then
    raise exception 'despesa_competencia deveria ser 570, veio %', r.despesa_competencia; end if;
  if r.despesa_caixa <> 300.00 then
    raise exception 'despesa_caixa deveria ser 300 (só a parcela paga), veio %', r.despesa_caixa; end if;
end $$;

\echo '# compras ignoram item rejeitado'
do $$
declare r record;
begin
  select * into r from vw_consolidado_mensal
   where empresa_id = '20000000-0000-0000-0000-00000000000a' and mes = '2026-07';
  if r.compras <> 200.00 then
    raise exception 'compras deveria ser 200 (10 x 20, rejeitado fora), veio %', r.compras; end if;
end $$;

\echo '# a permissão grupo foi concedida a quem tinha relatorios, e só a esses'
do $$
declare n int;
begin
  select count(*) into n from permissoes
   where modulo = 'grupo' and user_id = 'a0000000-0000-0000-0000-00000000000a';
  if n <> 1 then raise exception 'ana tinha relatorios e deveria ter ganhado grupo'; end if;

  select count(*) into n from permissoes
   where modulo = 'grupo' and user_id = 'b0000000-0000-0000-0000-00000000000b';
  if n <> 0 then raise exception 'bruno não tinha relatorios e não deveria ter grupo'; end if;
end $$;

\echo '# as duas views declaram security_invoker'
do $$
declare n int;
begin
  select count(*) into n from pg_class
   where relname in ('vw_produto_custo', 'vw_consolidado_mensal')
     and array_to_string(reloptions, ',') like '%security_invoker=true%';
  if n <> 2 then
    raise exception 'esperava 2 views com security_invoker=true, achei %', n; end if;
end $$;

\echo '# bruno (Steakhouse) não enxerga a Food Service através da view'
set role authenticated;
set req.role = 'authenticated';
set req.uid = 'b0000000-0000-0000-0000-00000000000b';

do $$
declare n int;
begin
  select count(*) into n from vw_consolidado_mensal
   where empresa_id = '20000000-0000-0000-0000-00000000000a';
  if n <> 0 then
    raise exception 'bruno viu % linha(s) da Food Service — security_invoker não segurou', n; end if;

  select count(*) into n from vw_consolidado_mensal
   where empresa_id = '20000000-0000-0000-0000-00000000000b';
  if n = 0 then raise exception 'bruno deveria ver a própria empresa'; end if;
end $$;

reset role;
