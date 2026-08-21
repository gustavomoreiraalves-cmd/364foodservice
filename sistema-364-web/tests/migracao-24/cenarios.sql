-- Exercita as regras da atualização 24. Roda depois do fixture e da migração.
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
-- mas avançar o status continua livre (voltar para Pendente, não — cenário 11).
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
  raise notice 'OK 3: cabeçalho travado, avanço de status livre';
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

  -- `cancelado_em` não vai na mão do cliente: o trigger carimba do relógio do
  -- banco (ver cenário 10).
  update pedidos set status = 'Cancelado', cancelado_motivo = 'Cliente desistiu',
    cancelado_por_id = '33333333-3333-3333-3333-333333333333' where id = v_pedido;

  begin
    update pedidos set status = 'Pendente' where id = v_pedido;
    raise exception 'FALHA 4c: pedido cancelado voltou para Pendente';
  exception when check_violation then null; end;

  raise notice 'OK 4: cancelamento exige motivo e é terminal';
end $$;

-- Cenário 5: pedido sem item nenhum não é faturado.
do $$
declare v_pedido uuid;
begin
  insert into pedidos (cliente_id, empresa_id) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111')
    returning id into v_pedido;
  begin
    update pedidos set status = 'Faturado' where id = v_pedido;
    raise exception 'FALHA 5: pedido sem itens foi faturado';
  exception when check_violation then null; end;
  raise notice 'OK 5: pedido vazio não é faturado';
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

-- Cenário 9: pedido vazio pode ser cancelado. É a única saída dele: o cabeçalho
-- e os itens são gravados em duas chamadas, e quando a segunda falha sobra um
-- pedido Pendente sem item; a exclusão não existe mais na tela.
do $$
declare v_pedido uuid; v_status text;
begin
  insert into pedidos (cliente_id, empresa_id) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111')
    returning id into v_pedido;
  update pedidos set status = 'Cancelado', cancelado_motivo = 'Falha ao gravar os itens'
    where id = v_pedido;
  select status into v_status from pedidos where id = v_pedido;
  if v_status is distinct from 'Cancelado' then
    raise exception 'FALHA 9: pedido vazio não foi cancelado (ficou %)', v_status;
  end if;
  raise notice 'OK 9: pedido vazio pode ser cancelado';
end $$;

-- Cenário 10: cancelado_em é carimbado pelo banco, não pelo cliente. O valor
-- que o cliente mandar é descartado.
do $$
declare v_pedido uuid; v_em timestamptz;
begin
  insert into pedidos (cliente_id, empresa_id) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111')
    returning id into v_pedido;
  insert into pedido_itens (pedido_id, produto_id, quantidade, preco_unitario, empresa_id)
    values (v_pedido, '44444444-4444-4444-4444-444444444444', 1, 10, '11111111-1111-1111-1111-111111111111');
  update pedidos set status = 'Cancelado', cancelado_motivo = 'Cliente desistiu',
    cancelado_em = timestamptz '1999-01-01 00:00:00+00' where id = v_pedido;
  select cancelado_em into v_em from pedidos where id = v_pedido;
  if v_em is null then
    raise exception 'FALHA 10a: cancelado_em ficou nulo';
  end if;
  if v_em < clock_timestamp() - interval '1 minute' then
    raise exception 'FALHA 10b: cancelado_em veio do cliente (%)', v_em;
  end if;
  raise notice 'OK 10: cancelado_em vem do relógio do banco';
end $$;

-- Cenário 11: voltar de Faturado ou Enviado para Pendente exige motivo.
do $$
declare v_pedido uuid;
begin
  insert into pedidos (cliente_id, empresa_id) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111')
    returning id into v_pedido;
  insert into pedido_itens (pedido_id, produto_id, quantidade, preco_unitario, empresa_id)
    values (v_pedido, '44444444-4444-4444-4444-444444444444', 1, 10, '11111111-1111-1111-1111-111111111111');
  update pedidos set status = 'Faturado' where id = v_pedido;

  begin
    update pedidos set status = 'Pendente' where id = v_pedido;
    raise exception 'FALHA 11a: reabriu Faturado sem motivo';
  exception when check_violation then null; end;

  begin
    update pedidos set status = 'Pendente', reaberto_motivo = '  ' where id = v_pedido;
    raise exception 'FALHA 11b: reabriu com motivo em branco';
  exception when check_violation then null; end;

  update pedidos set status = 'Enviado' where id = v_pedido;
  begin
    update pedidos set status = 'Pendente' where id = v_pedido;
    raise exception 'FALHA 11c: reabriu Enviado sem motivo';
  exception when check_violation then null; end;

  raise notice 'OK 11: reabrir sem motivo é recusado';
end $$;

-- Cenário 12: reabrir com motivo passa e grava motivo, autor e data. O segundo
-- `update` pelado é recusado mesmo com a coluna já preenchida — é o caminho da
-- API sem passar pela tela.
do $$
declare v_pedido uuid; v_row pedidos%rowtype;
begin
  insert into pedidos (cliente_id, empresa_id) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111')
    returning id into v_pedido;
  insert into pedido_itens (pedido_id, produto_id, quantidade, preco_unitario, empresa_id)
    values (v_pedido, '44444444-4444-4444-4444-444444444444', 1, 10, '11111111-1111-1111-1111-111111111111');
  update pedidos set status = 'Faturado' where id = v_pedido;

  update pedidos set status = 'Pendente', reaberto_motivo = 'Preço errado na nota',
    reaberto_por_id = '33333333-3333-3333-3333-333333333333' where id = v_pedido;

  select * into v_row from pedidos where id = v_pedido;
  if v_row.status is distinct from 'Pendente' then
    raise exception 'FALHA 12a: pedido não voltou para Pendente (ficou %)', v_row.status;
  end if;
  if v_row.reaberto_motivo is distinct from 'Preço errado na nota' then
    raise exception 'FALHA 12b: motivo da reabertura não foi gravado';
  end if;
  if v_row.reaberto_por_id is null then
    raise exception 'FALHA 12c: autor da reabertura não foi gravado';
  end if;
  if v_row.reaberto_em is null then
    raise exception 'FALHA 12d: data da reabertura não foi gravada';
  end if;

  -- Com o pedido de novo Pendente, os itens voltam a aceitar escrita.
  update pedido_itens set preco_unitario = 12 where pedido_id = v_pedido;

  update pedidos set status = 'Faturado' where id = v_pedido;
  begin
    update pedidos set status = 'Pendente' where id = v_pedido;
    raise exception 'FALHA 12e: segunda reabertura herdou o motivo da primeira';
  exception when check_violation then null; end;

  raise notice 'OK 12: reabrir com motivo grava motivo, autor e data';
end $$;
