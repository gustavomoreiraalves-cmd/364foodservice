-- tests/migracao-50/cenarios.sql
-- pedido_a = aaaaaaaa-0000-0000-0000-000000000001 (Pendente, 1 item — ver fixture.sql)
\set ON_ERROR_STOP on

-- Cenário 1: Pendente → Separação é recusado sem expedição em rascunho.
do $$
begin
  begin
    update public.pedidos set status = 'Separação' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
    raise exception 'FALHA 1: Pendente→Separação foi aceito sem expedição em rascunho';
  exception when check_violation then null;
  end;
  raise notice 'OK 1: Pendente→Separação recusado sem romaneio';
end $$;

-- Cenário 2: criando o romaneio em rascunho, a transição passa a ser aceita.
insert into public.expedicoes (id, empresa_id, pedido_id, numero, status) values
  ('eeeeeeee-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000001', 'RM-260910-001', 'rascunho');
update public.pedidos set status = 'Separação' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$
declare v_status text;
begin
  select status into v_status from public.pedidos where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  if v_status <> 'Separação' then raise exception 'FALHA 2: status esperado Separação, veio %', v_status; end if;
  raise notice 'OK 2: Pendente→Separação aceito com expedição em rascunho';
end $$;

-- Cenário 3: Separação → Conferido é recusado enquanto a expedição não foi finalizada.
do $$
begin
  begin
    update public.pedidos set status = 'Conferido' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
    raise exception 'FALHA 3: Separação→Conferido foi aceito com expedição em rascunho';
  exception when check_violation then null;
  end;
  raise notice 'OK 3: Separação→Conferido recusado sem romaneio finalizado';
end $$;

-- Cenário 4: Separação → Pendente é recusado enquanto o romaneio segue em rascunho.
do $$
begin
  begin
    update public.pedidos set status = 'Pendente' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
    raise exception 'FALHA 4: Separação→Pendente foi aceito com expedição ainda em rascunho';
  exception when check_violation then null;
  end;
  raise notice 'OK 4: Separação→Pendente recusado sem cancelar o romaneio primeiro';
end $$;

-- Cenário 5: finalizando a expedição, Separação → Conferido passa a ser aceito.
update public.expedicoes set status = 'finalizado' where id = 'eeeeeeee-0000-0000-0000-000000000001';
update public.pedidos set status = 'Conferido' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$
declare v_status text;
begin
  select status into v_status from public.pedidos where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  if v_status <> 'Conferido' then raise exception 'FALHA 5: status esperado Conferido, veio %', v_status; end if;
  raise notice 'OK 5: Separação→Conferido aceito com romaneio finalizado';
end $$;

-- Cenário 6: Conferido → Faturado é recusado sem NF-e autorizada.
do $$
begin
  begin
    update public.pedidos set status = 'Faturado' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
    raise exception 'FALHA 6: Conferido→Faturado foi aceito sem NF-e autorizada';
  exception when check_violation then null;
  end;
  raise notice 'OK 6: Conferido→Faturado recusado sem nota autorizada';
end $$;

-- Cenário 7: com a NF-e autorizada, Conferido → Faturado passa a ser aceito.
insert into public.nfe_saida_documentos (id, empresa_id, pedido_id, status) values
  ('ffffffff-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000001', 'autorizado');
update public.pedidos set status = 'Faturado' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$
declare v_status text;
begin
  select status into v_status from public.pedidos where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  if v_status <> 'Faturado' then raise exception 'FALHA 7: status esperado Faturado, veio %', v_status; end if;
  raise notice 'OK 7: Conferido→Faturado aceito com NF-e autorizada';
end $$;

-- Cenário 8: Faturado → Enviado é aceito (par livre da lista branca).
update public.pedidos set status = 'Enviado' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$
declare v_status text;
begin
  select status into v_status from public.pedidos where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  if v_status <> 'Enviado' then raise exception 'FALHA 8: status esperado Enviado, veio %', v_status; end if;
  raise notice 'OK 8: Faturado→Enviado aceito';
end $$;

-- Cenário 9: pedido com NF-e autorizada não cancela nem reabre direto (mesma
-- trava vale a partir de Enviado, não só de Faturado — pedido_a está Enviado
-- desde o cenário 8).
do $$
begin
  begin
    update public.pedidos set status = 'Cancelado', cancelado_motivo = 'teste'
      where id = 'aaaaaaaa-0000-0000-0000-000000000001';
    raise exception 'FALHA 9a: cancelamento com NF-e autorizada foi aceito';
  exception when check_violation then null;
  end;
  begin
    update public.pedidos set status = 'Pendente', reaberto_motivo = 'teste'
      where id = 'aaaaaaaa-0000-0000-0000-000000000001';
    raise exception 'FALHA 9b: reabertura com NF-e autorizada foi aceita';
  exception when check_violation then null;
  end;
  raise notice 'OK 9: cancelar/reabrir com NF-e autorizada exige cancelar a nota primeiro';
end $$;

-- Cenário 10: transição fora da lista branca (ex.: Pendente→Faturado direto) é recusada.
insert into public.pedidos (id, empresa_id, cliente_id, status) values
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'cccccccc-0000-0000-0000-000000000001', 'Pendente');
insert into public.pedido_itens (id, pedido_id, produto_id, quantidade, preco_unitario) values
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002',
   'dddddddd-0000-0000-0000-000000000001', 1, 10);
do $$
begin
  begin
    update public.pedidos set status = 'Faturado' where id = 'aaaaaaaa-0000-0000-0000-000000000002';
    raise exception 'FALHA 10: Pendente→Faturado direto (pulando romaneio e emissão) foi aceito';
  exception when check_violation then null;
  end;
  raise notice 'OK 10: transição fora da lista branca recusada';
end $$;

-- Cenário 11: expedicoes_pedido_vivo_unico deixa refazer o romaneio depois de cancelar o anterior.
insert into public.expedicoes (id, empresa_id, pedido_id, numero, status) values
  ('eeeeeeee-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000002', 'RM-260910-002', 'rascunho');
do $$
begin
  begin
    insert into public.expedicoes (empresa_id, pedido_id, numero, status) values
      ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'RM-260910-003', 'rascunho');
    raise exception 'FALHA 11a: segundo romaneio vivo para o mesmo pedido foi aceito';
  exception when unique_violation then null;
  end;
  update public.expedicoes set status = 'cancelado' where id = 'eeeeeeee-0000-0000-0000-000000000002';
  insert into public.expedicoes (id, empresa_id, pedido_id, numero, status) values
    ('eeeeeeee-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
     'aaaaaaaa-0000-0000-0000-000000000002', 'RM-260910-003', 'rascunho');
  raise notice 'OK 11: cancelar o romaneio anterior libera criar um novo pro mesmo pedido';
end $$;

-- Cenário 12: RLS ligada com só policy de SELECT em expedicoes/expedicao_caixas/expedicao_itens.
do $$
declare t text; escritas int;
begin
  foreach t in array array['expedicoes','expedicao_caixas','expedicao_itens'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception 'FALHA 12a: RLS desligada em %', t;
    end if;
  end loop;
  select count(*) into escritas from pg_policies
   where schemaname = 'public' and tablename in ('expedicoes','expedicao_caixas','expedicao_itens')
     and cmd <> 'SELECT';
  if escritas <> 0 then
    raise exception 'FALHA 12b: existe policy de escrita para authenticated em tabela de expedição';
  end if;
  raise notice 'OK 12: RLS só de SELECT em expedicoes/expedicao_caixas/expedicao_itens';
end $$;

-- Cenário 13: vw_estoque_produto_lote calcula saldo = embalado - expedido em
-- expedições não canceladas, e ignora expedições canceladas.
insert into public.recebimento_itens (id, validade) values ('aaaaaaaa-1111-0000-0000-000000000001', '2026-12-01')
  on conflict (id) do nothing;
insert into public.embalagem_itens (id, empresa_id, produto_id, recebimento_item_id, quantidade, validade) values
  ('99999999-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001', 20, '2026-12-01');
with nova_caixa as (
  insert into public.expedicao_caixas (empresa_id, expedicao_id, numero)
  values ('11111111-1111-1111-1111-111111111111', 'eeeeeeee-0000-0000-0000-000000000003', 1)
  returning id
)
insert into public.expedicao_itens (empresa_id, expedicao_caixa_id, pedido_item_id, produto_id, recebimento_item_id, quantidade)
select '11111111-1111-1111-1111-111111111111', nova_caixa.id, 'bbbbbbbb-0000-0000-0000-000000000002',
       'dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001', 6
from nova_caixa;
do $$
declare v_saldo numeric;
begin
  select saldo into v_saldo from public.vw_estoque_produto_lote
   where recebimento_item_id = 'aaaaaaaa-1111-0000-0000-000000000001';
  if v_saldo <> 14 then raise exception 'FALHA 13: saldo esperado 14 (20-6), veio %', v_saldo; end if;
  raise notice 'OK 13: vw_estoque_produto_lote calcula saldo = embalado - expedido';
end $$;

-- Cenário 14: uma alocação presa a uma expedição CANCELADA (a
-- eeeeeeee-...002, cancelada no cenário 11) não entra em total_expedido nem
-- mexe no saldo — prova que o filtro `ex.status <> 'cancelado'` da subquery
-- correlacionada realmente exclui, e não só por acaso não aparecer no teste.
with nova_caixa_cancelada as (
  insert into public.expedicao_caixas (empresa_id, expedicao_id, numero)
  values ('11111111-1111-1111-1111-111111111111', 'eeeeeeee-0000-0000-0000-000000000002', 1)
  returning id
)
insert into public.expedicao_itens (empresa_id, expedicao_caixa_id, pedido_item_id, produto_id, recebimento_item_id, quantidade)
select '11111111-1111-1111-1111-111111111111', nova_caixa_cancelada.id, 'bbbbbbbb-0000-0000-0000-000000000002',
       'dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001', 9
from nova_caixa_cancelada;
do $$
declare v_saldo numeric;
begin
  select saldo into v_saldo from public.vw_estoque_produto_lote
   where recebimento_item_id = 'aaaaaaaa-1111-0000-0000-000000000001';
  if v_saldo <> 14 then
    raise exception 'FALHA 14: saldo esperado 14 (alocação em expedição cancelada não deveria contar), veio %', v_saldo;
  end if;
  raise notice 'OK 14: vw_estoque_produto_lote ignora alocação presa a expedição cancelada';
end $$;

select 'CENÁRIOS DA 50 OK' as resultado;
