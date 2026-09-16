-- tests/migracao-54/cenarios.sql
\set ON_ERROR_STOP on

-- Cenário 1: coluna embalagem_id existe e aceita null.
do $$
declare v_tipo text;
begin
  select data_type into v_tipo from information_schema.columns
    where table_schema = 'public' and table_name = 'expedicao_itens' and column_name = 'embalagem_id';
  if v_tipo is null then
    raise exception 'FALHA 1: coluna expedicao_itens.embalagem_id não existe';
  end if;
  raise notice 'OK 1: expedicao_itens.embalagem_id existe (%)', v_tipo;
end $$;

-- Cenário 2: a view agora traz DUAS linhas pro produto (uma por embalagem),
-- não uma só fundida por matéria-prima — a ambiguidade que motivou a 54.
do $$
declare v_linhas int;
begin
  select count(*) into v_linhas from public.vw_estoque_produto_lote
    where produto_id = 'dddddddd-0000-0000-0000-000000000001'
      and embalagem_id in ('e0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002');
  if v_linhas <> 2 then
    raise exception 'FALHA 2: esperava 2 linhas (uma por embalagem), achou %', v_linhas;
  end if;
  raise notice 'OK 2: view não funde mais embalagens diferentes que usaram a mesma matéria-prima';
end $$;

-- Cenário 3: embalagem em rascunho não aparece — saldo não conta o que não
-- foi finalizado.
do $$
declare v_linhas int;
begin
  select count(*) into v_linhas from public.vw_estoque_produto_lote
    where embalagem_id = 'e0000000-0000-0000-0000-000000000003';
  if v_linhas <> 0 then
    raise exception 'FALHA 3: embalagem em rascunho apareceu na view (% linhas)', v_linhas;
  end if;
  raise notice 'OK 3: embalagem em rascunho não conta como saldo disponível';
end $$;

-- Cenário 4: lote/fabricação vêm certos, sem ambiguidade, e saldo = total
-- embalado (nenhuma expedição referencia embalagem_id ainda nesta linha).
do $$
declare v_lote text; v_saldo numeric;
begin
  select lote, saldo into v_lote, v_saldo from public.vw_estoque_produto_lote
    where embalagem_id = 'e0000000-0000-0000-0000-000000000001';
  if v_lote is distinct from 'LOTE-A' then
    raise exception 'FALHA 4a: lote esperado LOTE-A, veio %', v_lote;
  end if;
  if v_saldo <> 5 then
    raise exception 'FALHA 4b: saldo esperado 5, veio %', v_saldo;
  end if;
  raise notice 'OK 4: lote e saldo corretos pra LOTE-A';
end $$;

-- Cenário 5: expedição (não cancelada) referenciando embalagem_id desconta
-- do saldo daquela embalagem específica, sem afetar a outra que usou a
-- mesma matéria-prima.
do $$
declare v_saldo_a numeric; v_saldo_b numeric;
begin
  insert into public.expedicoes (id, empresa_id, pedido_id, status) values
    ('11110000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
     'aaaaaaaa-0000-0000-0000-000000000001', 'finalizado');
  insert into public.expedicao_caixas (id, empresa_id, expedicao_id, numero) values
    ('caaa0000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
     '11110000-0000-0000-0000-000000000002', 1);
  insert into public.expedicao_itens (id, empresa_id, expedicao_caixa_id, pedido_item_id, produto_id, embalagem_id, quantidade) values
    ('ee000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
     'caaa0000-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001',
     'dddddddd-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 3);

  select saldo into v_saldo_a from public.vw_estoque_produto_lote where embalagem_id = 'e0000000-0000-0000-0000-000000000001';
  select saldo into v_saldo_b from public.vw_estoque_produto_lote where embalagem_id = 'e0000000-0000-0000-0000-000000000002';
  if v_saldo_a <> 2 then
    raise exception 'FALHA 5a: saldo do LOTE-A esperado 2 (5-3), veio %', v_saldo_a;
  end if;
  if v_saldo_b <> 7 then
    raise exception 'FALHA 5b: saldo do LOTE-B esperado 7 (intocado), veio %', v_saldo_b;
  end if;
  raise notice 'OK 5: desconto de saldo é por embalagem, não fundido por matéria-prima';
end $$;

-- Cenário 6: expedição CANCELADA não desconta do saldo.
do $$
declare v_saldo numeric;
begin
  insert into public.expedicoes (id, empresa_id, pedido_id, status) values
    ('11110000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
     'aaaaaaaa-0000-0000-0000-000000000001', 'cancelado');
  insert into public.expedicao_caixas (id, empresa_id, expedicao_id, numero) values
    ('caaa0000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
     '11110000-0000-0000-0000-000000000003', 1);
  insert into public.expedicao_itens (id, empresa_id, expedicao_caixa_id, pedido_item_id, produto_id, embalagem_id, quantidade) values
    ('ee000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
     'caaa0000-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000001',
     'dddddddd-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002', 4);

  select saldo into v_saldo from public.vw_estoque_produto_lote where embalagem_id = 'e0000000-0000-0000-0000-000000000002';
  if v_saldo <> 7 then
    raise exception 'FALHA 6: saldo do LOTE-B deveria seguir 7 (expedição cancelada não desconta), veio %', v_saldo;
  end if;
  raise notice 'OK 6: expedição cancelada não desconta do saldo';
end $$;
