-- Exercita as regras da atualização 21. Roda depois do fixture e da migração.
\set QUIET on
set client_min_messages = warning;

-- Cenário 1: pedido Pendente aceita item, edição de item e edição do cabeçalho.
do $$
declare v_pedido uuid; v_item uuid;
begin
  insert into pedidos (cliente_id, empresa_id) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111')
    returning id into v_pedido;
  insert into pedido_itens (pedido_id, produto_id, quantidade, preco_unitario, empresa_id)
    values (v_pedido, '44444444-4444-4444-4444-444444444444', 2, 50, '11111111-1111-1111-1111-111111111111')
    returning id into v_item;
  update pedido_itens set quantidade = 3 where id = v_item;
  update pedidos set data = current_date - 1 where id = v_pedido;
  delete from pedido_itens where id = v_item;
  raise notice 'OK 1: Pendente permite escrita';
end $$;

-- Cenário 2: fora de Pendente, item não pode ser inserido, alterado nem removido.
do $$
declare v_pedido uuid; v_item uuid; v_erro text;
begin
  insert into pedidos (cliente_id, empresa_id) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111')
    returning id into v_pedido;
  insert into pedido_itens (pedido_id, produto_id, quantidade, preco_unitario, empresa_id)
    values (v_pedido, '44444444-4444-4444-4444-444444444444', 2, 50, '11111111-1111-1111-1111-111111111111')
    returning id into v_item;
  update pedidos set status = 'Faturado' where id = v_pedido;

  begin
    update pedido_itens set quantidade = 10 where id = v_item;
    raise exception 'FALHA 2a: update de item passou com pedido Faturado';
  exception when check_violation then null; end;

  begin
    delete from pedido_itens where id = v_item;
    raise exception 'FALHA 2b: delete de item passou com pedido Faturado';
  exception when check_violation then null; end;

  begin
    insert into pedido_itens (pedido_id, produto_id, quantidade, preco_unitario, empresa_id)
      values (v_pedido, '44444444-4444-4444-4444-444444444444', 1, 10, '11111111-1111-1111-1111-111111111111');
    raise exception 'FALHA 2c: insert de item passou com pedido Faturado';
  exception when check_violation then null; end;

  raise notice 'OK 2: fora de Pendente o item está travado';
end $$;

-- Cenário 3: fora de Pendente, cliente e data do cabeçalho estão travados,
-- mas a transição de status continua livre.
do $$
declare v_pedido uuid;
begin
  insert into pedidos (cliente_id, empresa_id) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111')
    returning id into v_pedido;
  insert into pedido_itens (pedido_id, produto_id, quantidade, preco_unitario, empresa_id)
    values (v_pedido, '44444444-4444-4444-4444-444444444444', 1, 10, '11111111-1111-1111-1111-111111111111');
  update pedidos set status = 'Faturado' where id = v_pedido;

  begin
    update pedidos set data = current_date - 5 where id = v_pedido;
    raise exception 'FALHA 3a: data mudou com pedido Faturado';
  exception when check_violation then null; end;

  update pedidos set status = 'Enviado' where id = v_pedido;
  raise notice 'OK 3: cabeçalho travado, status livre';
end $$;

-- Cenário 4: cancelar exige motivo, e Cancelado é terminal.
do $$
declare v_pedido uuid;
begin
  insert into pedidos (cliente_id, empresa_id) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111')
    returning id into v_pedido;
  insert into pedido_itens (pedido_id, produto_id, quantidade, preco_unitario, empresa_id)
    values (v_pedido, '44444444-4444-4444-4444-444444444444', 1, 10, '11111111-1111-1111-1111-111111111111');

  begin
    update pedidos set status = 'Cancelado' where id = v_pedido;
    raise exception 'FALHA 4a: cancelou sem motivo';
  exception when check_violation then null; end;

  begin
    update pedidos set status = 'Cancelado', cancelado_motivo = '   ' where id = v_pedido;
    raise exception 'FALHA 4b: cancelou com motivo em branco';
  exception when check_violation then null; end;

  update pedidos set status = 'Cancelado', cancelado_motivo = 'Cliente desistiu', cancelado_em = now(),
    cancelado_por_id = '33333333-3333-3333-3333-333333333333' where id = v_pedido;

  begin
    update pedidos set status = 'Pendente' where id = v_pedido;
    raise exception 'FALHA 4c: pedido cancelado voltou para Pendente';
  exception when check_violation then null; end;

  raise notice 'OK 4: cancelamento exige motivo e é terminal';
end $$;

-- Cenário 5: pedido sem item nenhum não sai de Pendente.
do $$
declare v_pedido uuid;
begin
  insert into pedidos (cliente_id, empresa_id) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111')
    returning id into v_pedido;
  begin
    update pedidos set status = 'Faturado' where id = v_pedido;
    raise exception 'FALHA 5: pedido sem itens foi faturado';
  exception when check_violation then null; end;
  raise notice 'OK 5: pedido vazio não sai de Pendente';
end $$;

-- Cenário 6: quantidade e preço inválidos são recusados.
do $$
declare v_pedido uuid;
begin
  insert into pedidos (cliente_id, empresa_id) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111')
    returning id into v_pedido;
  begin
    insert into pedido_itens (pedido_id, produto_id, quantidade, preco_unitario, empresa_id)
      values (v_pedido, '44444444-4444-4444-4444-444444444444', 0, 10, '11111111-1111-1111-1111-111111111111');
    raise exception 'FALHA 6a: quantidade zero aceita';
  exception when check_violation then null; end;
  begin
    insert into pedido_itens (pedido_id, produto_id, quantidade, preco_unitario, empresa_id)
      values (v_pedido, '44444444-4444-4444-4444-444444444444', 1, -1, '11111111-1111-1111-1111-111111111111');
    raise exception 'FALHA 6b: preço negativo aceito';
  exception when check_violation then null; end;
  raise notice 'OK 6: quantidade e preço validados';
end $$;

-- Cenário 7: apagar o pedido em cascata não é bloqueado pelo trigger do item.
-- Não há botão de excluir na tela, mas manutenção pelo SQL não pode travar.
do $$
declare v_pedido uuid;
begin
  insert into pedidos (cliente_id, empresa_id) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111')
    returning id into v_pedido;
  insert into pedido_itens (pedido_id, produto_id, quantidade, preco_unitario, empresa_id)
    values (v_pedido, '44444444-4444-4444-4444-444444444444', 1, 10, '11111111-1111-1111-1111-111111111111');
  update pedidos set status = 'Faturado' where id = v_pedido;
  delete from pedidos where id = v_pedido;
  raise notice 'OK 7: delete em cascata passa';
end $$;

-- Cenário 8: updated_at é tocado a cada update do cabeçalho.
do $$
declare v_pedido uuid; v_antes timestamptz; v_depois timestamptz;
begin
  insert into pedidos (cliente_id, empresa_id) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111')
    returning id into v_pedido;
  select updated_at into v_antes from pedidos where id = v_pedido;
  perform pg_sleep(0.01);
  update pedidos set observacoes = 'entregar antes das 10h' where id = v_pedido;
  select updated_at into v_depois from pedidos where id = v_pedido;
  if v_depois <= v_antes then
    raise exception 'FALHA 8: updated_at não avançou';
  end if;
  raise notice 'OK 8: updated_at avança';
end $$;
