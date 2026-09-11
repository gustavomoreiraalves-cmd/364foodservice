-- tests/migracao-51/cenarios.sql
\set ON_ERROR_STOP on

-- Cenário 1: unique(nfe_saida_documento_id) — uma conta por nota, nunca duas.
insert into public.contas_a_receber (id, descricao, cliente_id, pedido_id, nfe_saida_documento_id, valor_total, empresa_id) values
  ('11111111-0000-0000-0000-000000000001', 'NF-e 1 — Cliente Teste', 'cccccccc-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000001', 255.00,
   '11111111-1111-1111-1111-111111111111');
do $$
begin
  begin
    insert into public.contas_a_receber (descricao, cliente_id, pedido_id, nfe_saida_documento_id, valor_total, empresa_id) values
      ('duplicata', 'cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
       'ffffffff-0000-0000-0000-000000000001', 255.00, '11111111-1111-1111-1111-111111111111');
    raise exception 'FALHA 1: segunda conta pra mesma nota foi aceita';
  exception when unique_violation then null;
  end;
  raise notice 'OK 1: uma conta a receber por nota';
end $$;

insert into public.contas_a_receber_parcelas (id, conta_a_receber_id, numero, valor, vencimento, empresa_id) values
  ('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 1, 255.00, current_date,
   '11111111-1111-1111-1111-111111111111');

-- Cenário 2: cancelar a NF-e sem parcela recebida derruba a conta em cascata.
update public.nfe_saida_documentos set status = 'cancelado' where id = 'ffffffff-0000-0000-0000-000000000001';
do $$
declare n int;
begin
  select count(*) into n from public.contas_a_receber where nfe_saida_documento_id = 'ffffffff-0000-0000-0000-000000000001';
  if n <> 0 then raise exception 'FALHA 2: conta a receber sobreviveu ao cancelamento da nota sem parcela recebida'; end if;
  raise notice 'OK 2: cancelamento sem parcela recebida remove a conta em cascata';
end $$;

-- Cenário 3: cancelar NF-e com parcela recebida é bloqueado.
insert into public.nfe_saida_documentos (id, empresa_id, pedido_id, status) values
  ('ffffffff-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000001', 'autorizado');
insert into public.contas_a_receber (id, descricao, cliente_id, pedido_id, nfe_saida_documento_id, valor_total, empresa_id) values
  ('11111111-0000-0000-0000-000000000002', 'NF-e 2', 'cccccccc-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000002', 100.00,
   '11111111-1111-1111-1111-111111111111');
insert into public.contas_a_receber_parcelas (conta_a_receber_id, numero, valor, vencimento, status, data_recebimento, empresa_id) values
  ('11111111-0000-0000-0000-000000000002', 1, 100.00, current_date, 'Recebido', current_date,
   '11111111-1111-1111-1111-111111111111');
do $$
begin
  begin
    update public.nfe_saida_documentos set status = 'cancelado' where id = 'ffffffff-0000-0000-0000-000000000002';
    raise exception 'FALHA 3: cancelamento com parcela recebida foi aceito';
  exception when check_violation then null;
  end;
  raise notice 'OK 3: cancelamento bloqueado com parcela já recebida';
end $$;

select 'CENÁRIOS DA 51 OK' as resultado;
