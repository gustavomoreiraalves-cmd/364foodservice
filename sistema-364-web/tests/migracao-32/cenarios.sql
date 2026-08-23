-- Exercita a atualização 32. Roda depois do fixture e da migração.
\set QUIET on
set client_min_messages = warning;
begin;

-- Cenário 1: as duas lojas foram semeadas e apontam para empresas distintas.
do $$
declare n integer; distintas integer;
begin
  select count(*), count(distinct empresa_id) into n, distintas from pdv_lojas;
  if n <> 2 or distintas <> 2 then
    raise exception 'FALHA 1: esperava 2 lojas em 2 empresas, achou % em %', n, distintas;
  end if;
  raise notice 'OK 1: lojas semeadas';
end $$;

-- Cenário 2: upsert de pedido por (empresa, codigo) não duplica.
do $$
declare n integer; v numeric;
begin
  insert into pdv_pedidos (empresa_id, codigo, tipo, finalizado, valor_total, aberto_em, dia_venda)
    values ('0dda3c8e-228b-4d05-b50a-2e2f301d75a3', 74941, 'mesa', false, 100, '2026-08-18T00:13:51Z', '2026-08-17')
  on conflict (empresa_id, codigo) do update set valor_total = excluded.valor_total, finalizado = excluded.finalizado;
  insert into pdv_pedidos (empresa_id, codigo, tipo, finalizado, valor_total, aberto_em, dia_venda)
    values ('0dda3c8e-228b-4d05-b50a-2e2f301d75a3', 74941, 'mesa', true, 160.71, '2026-08-18T00:13:51Z', '2026-08-17')
  on conflict (empresa_id, codigo) do update set valor_total = excluded.valor_total, finalizado = excluded.finalizado;
  select count(*), max(valor_total) into n, v from pdv_pedidos where codigo = 74941;
  if n <> 1 or v <> 160.71 then raise exception 'FALHA 2: % linhas, valor %', n, v; end if;
  raise notice 'OK 2: upsert de pedido';
end $$;

-- Cenário 3: a view de vendas só soma pedido finalizado e não excluído.
do $$
declare v numeric;
begin
  insert into pdv_pedidos (empresa_id, codigo, tipo, origem, finalizado, valor_total, aberto_em, dia_venda)
    values ('0dda3c8e-228b-4d05-b50a-2e2f301d75a3', 75222, 'delivery', 'DeliveryHub', false, 56.89, '2026-08-23T02:41:17Z', '2026-08-22');
  insert into pdv_pedidos (empresa_id, codigo, tipo, origem, finalizado, valor_total, aberto_em, dia_venda, excluido_em)
    values ('0dda3c8e-228b-4d05-b50a-2e2f301d75a3', 75223, 'mesa', 'Desktop', true, 999, '2026-08-18T02:41:17Z', '2026-08-17', now());
  select coalesce(sum(valor_total), 0) into v from vw_pdv_vendas_dia
    where empresa_id = '0dda3c8e-228b-4d05-b50a-2e2f301d75a3' and dia = '2026-08-17';
  if v <> 160.71 then raise exception 'FALHA 3: view somou %', v; end if;
  raise notice 'OK 3: view ignora aberto e excluído';
end $$;

-- Cenário 4: itens e pagamentos somem com o pedido (cascade).
do $$
declare p uuid; n integer;
begin
  select id into p from pdv_pedidos where codigo = 74941;
  insert into pdv_pedido_itens (pedido_id, empresa_id, posicao, nome, quantidade, valor)
    values (p, '0dda3c8e-228b-4d05-b50a-2e2f301d75a3', 1, 'Burguer', 1, 23.9);
  insert into pdv_pagamentos (pedido_id, empresa_id, posicao, valor, forma, forma_grupo)
    values (p, '0dda3c8e-228b-4d05-b50a-2e2f301d75a3', 1, 23.9, 'Pix Manual', 'pix');
  delete from pdv_pedidos where id = p;
  select count(*) into n from pdv_pedido_itens where pedido_id = p;
  if n <> 0 then raise exception 'FALHA 4: sobraram % itens', n; end if;
  raise notice 'OK 4: cascade';
end $$;

-- Cenário 5: taxa e líquido na view de formas.
do $$
declare t numeric; l numeric;
begin
  insert into pdv_recebimentos (empresa_id, pedido_codigo, caixa_codigo, forma, operadora, forma_grupo, valor, valor_liquido, percentual_taxa, pago_em, dia_pagamento)
    values ('0dda3c8e-228b-4d05-b50a-2e2f301d75a3', 75090, 1561, 'iFood Online', 'Outros', 'ifood_online', 136.09, 119.76, 12, '2026-08-21T22:42:57Z', '2026-08-21');
  select taxa, valor_liquido into t, l from vw_pdv_caixa_formas_dia where forma_grupo = 'ifood_online';
  if t <> 16.33 or l <> 119.76 then raise exception 'FALHA 5: taxa % líquido %', t, l; end if;
  raise notice 'OK 5: view de formas';
end $$;

-- Cenário 6: forma_grupo fora da lista é recusada.
do $$
declare p uuid;
begin
  insert into pdv_pedidos (empresa_id, codigo, tipo, finalizado, valor_total, aberto_em, dia_venda)
    values ('0dda3c8e-228b-4d05-b50a-2e2f301d75a3', 1, 'mesa', true, 1, now(), current_date) returning id into p;
  begin
    insert into pdv_pagamentos (pedido_id, empresa_id, posicao, valor, forma_grupo)
      values (p, '0dda3c8e-228b-4d05-b50a-2e2f301d75a3', 1, 1, 'cheque');
    raise exception 'FALHA 6: aceitou forma_grupo inválido';
  exception when check_violation then
    raise notice 'OK 6: check de forma_grupo';
  end;
end $$;

-- Cenário 7: sem chave natural, o importador substitui a janela inteira. Duas
-- parcelas idênticas (mesmo pedido, forma, operadora nula, valor e pago_em)
-- convivem; o delete por `dia_pagamento` limpa só o dia reimportado.
-- O recebimento do cenário 5 também cai no dia 21 e é varrido pelo delete —
-- por isso o total esperado ao fim é 3, e não 4.
do $$
declare n integer; n21 integer;
begin
  insert into pdv_recebimentos (empresa_id, pedido_codigo, caixa_codigo, forma, operadora, forma_grupo, valor, valor_liquido, parcela, pago_em, dia_pagamento)
  values
    ('0dda3c8e-228b-4d05-b50a-2e2f301d75a3', 75091, 1561, 'Cartão de Crédito', null, 'credito', 60, 58.2, 1, '2026-08-21T23:10:00Z', '2026-08-21'),
    ('0dda3c8e-228b-4d05-b50a-2e2f301d75a3', 75091, 1561, 'Cartão de Crédito', null, 'credito', 60, 58.2, 2, '2026-08-21T23:10:00Z', '2026-08-21'),
    ('0dda3c8e-228b-4d05-b50a-2e2f301d75a3', 75200, 1562, 'Dinheiro', null, 'dinheiro', 25, 25, null, '2026-08-22T20:00:00Z', '2026-08-22');

  -- o que o importador faz a cada rodada da janela 21..21
  delete from pdv_recebimentos
    where empresa_id = '0dda3c8e-228b-4d05-b50a-2e2f301d75a3'
      and dia_pagamento between '2026-08-21' and '2026-08-21';
  insert into pdv_recebimentos (empresa_id, pedido_codigo, caixa_codigo, forma, operadora, forma_grupo, valor, valor_liquido, parcela, pago_em, dia_pagamento)
  values
    ('0dda3c8e-228b-4d05-b50a-2e2f301d75a3', 75091, 1561, 'Cartão de Crédito', null, 'credito', 60, 58.2, 1, '2026-08-21T23:10:00Z', '2026-08-21'),
    ('0dda3c8e-228b-4d05-b50a-2e2f301d75a3', 75091, 1561, 'Cartão de Crédito', null, 'credito', 60, 58.2, 2, '2026-08-21T23:10:00Z', '2026-08-21');

  select count(*) into n from pdv_recebimentos
    where empresa_id = '0dda3c8e-228b-4d05-b50a-2e2f301d75a3';
  select count(*) into n21 from pdv_recebimentos
    where empresa_id = '0dda3c8e-228b-4d05-b50a-2e2f301d75a3' and dia_pagamento = '2026-08-21';
  if n <> 3 or n21 <> 2 then
    raise exception 'FALHA 7: % recebimentos no total, % no dia 21 (esperava 3 e 2)', n, n21;
  end if;
  raise notice 'OK 7: replace da janela mantém parcelas iguais e não vaza para outro dia';
end $$;

rollback;
