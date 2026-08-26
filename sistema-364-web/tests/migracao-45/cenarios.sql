-- Cenários da atualização 45: cadastro de contas bancárias compartilhado no
-- grupo e dedupe de lançamentos por conta.
\set ON_ERROR_STOP on
\set empresa '11111111-1111-1111-1111-111111111111'
\set outra '22222222-2222-2222-2222-222222222222'

-- Cenário 1: o backfill preencheu o lançamento que nasceu antes da 45.
do $$
declare v_conta uuid;
begin
  select conta_bancaria_id into v_conta from public.extrato_lancamentos
    where id = 'eeeeeeee-0000-0000-0000-000000000011';
  if v_conta is distinct from 'cccccccc-0000-0000-0000-000000000011'::uuid then
    raise exception 'FALHA 1: backfill deixou conta_bancaria_id = %', v_conta;
  end if;
  raise notice 'OK 1: backfill herdou a conta da importação';
end $$;

-- Cenário 2: conta do grupo pode nascer sem empresa dona.
insert into public.contas_bancarias (id, empresa_id, nome, instituicao, tipo)
  values ('cccccccc-0000-0000-0000-000000000012', null,
          'Cartão Itaú do grupo', 'Itaú', 'cartao_credito');
do $$
begin
  raise notice 'OK 2: contas_bancarias aceita empresa_id nulo';
end $$;

-- Cenário 3: conta cadastrada por outra empresa continua visível.
insert into public.contas_bancarias (id, empresa_id, nome, instituicao, tipo)
  values ('cccccccc-0000-0000-0000-000000000013', :'outra',
          'Cresol Buffet', 'Cresol', 'conta_corrente');

create role usuario_teste_45 nologin;
grant usage on schema public to usuario_teste_45;
grant select, insert, update on all tables in schema public to usuario_teste_45;

-- `set local role` só vale dentro de transação: em autocommit o papel não
-- troca e o teste rodaria como superusuário, que ignora RLS.
begin;
set local role usuario_teste_45;
do $$
declare n int;
begin
  -- A da fixture (empresa 1), a sem empresa dona e a da outra empresa.
  select count(*) into n from public.contas_bancarias;
  if n <> 3 then
    raise exception 'FALHA 3: usuário comum vê % contas (esperado 3)', n;
  end if;
  if not exists (select 1 from public.contas_bancarias
                 where id = 'cccccccc-0000-0000-0000-000000000013') then
    raise exception 'FALHA 3: conta cadastrada por outra empresa ficou invisível';
  end if;
  raise notice 'OK 3: cadastro é do grupo — empresa dona não filtra mais';
end $$;
commit;

-- Cenário 4: quem não tem o módulo financeiro não vê nada. Prova que a policy
-- nova gateia de verdade, e não virou um "for all using (true)".
begin;
set local role usuario_teste_45;
set local teste.modulo_financeiro = 'off';
do $$
declare n int;
begin
  select count(*) into n from public.contas_bancarias;
  if n <> 0 then
    raise exception 'FALHA 4: sem o módulo financeiro ainda vê % contas', n;
  end if;
  raise notice 'OK 4: policy exige o módulo financeiro';
end $$;
commit;

-- Cenário 5: o dedupe agora é da conta, não da empresa. Duas empresas
-- importando o mesmo extrato da mesma conta não duplicam o lançamento.
insert into public.extrato_importacoes (id, empresa_id, conta_bancaria_id, tipo, arquivo_path, formato)
  values ('dddddddd-0000-0000-0000-000000000012', :'outra',
          'cccccccc-0000-0000-0000-000000000011', 'extrato', 'p/12.ofx', 'ofx');
do $$
begin
  begin
    insert into public.extrato_lancamentos
      (importacao_id, empresa_id, conta_bancaria_id, data, descricao, descricao_normalizada,
       valor, tipo, hash_dedupe)
      values ('dddddddd-0000-0000-0000-000000000012', '22222222-2222-2222-2222-222222222222',
              'cccccccc-0000-0000-0000-000000000011', '2026-08-01', 'TARIFA PACOTE',
              'TARIFA PACOTE', 49.90, 'saida', 'hash-antigo');
    raise exception 'FALHA 5: mesmo hash na mesma conta passou por vir de outra empresa';
  exception when unique_violation then
    raise notice 'OK 5: dedupe por conta barra a segunda importação do mesmo extrato';
  end;
end $$;

-- Cenário 6: contas diferentes com o mesmo hash continuam convivendo — o
-- hash só é identidade dentro da conta.
insert into public.extrato_importacoes (id, empresa_id, conta_bancaria_id, tipo, arquivo_path, formato)
  values ('dddddddd-0000-0000-0000-000000000013', :'empresa',
          'cccccccc-0000-0000-0000-000000000013', 'extrato', 'p/13.ofx', 'ofx');
insert into public.extrato_lancamentos
  (importacao_id, empresa_id, conta_bancaria_id, data, descricao, descricao_normalizada,
   valor, tipo, hash_dedupe)
  values ('dddddddd-0000-0000-0000-000000000013', :'empresa',
          'cccccccc-0000-0000-0000-000000000013', '2026-08-01', 'TARIFA PACOTE',
          'TARIFA PACOTE', 49.90, 'saida', 'hash-antigo');
do $$
begin
  raise notice 'OK 6: mesmo hash em conta diferente é lançamento diferente';
end $$;

-- Cenário 7: lançamento sem conta não entra. É o que garante que o dedupe
-- não tem buraco.
do $$
begin
  begin
    insert into public.extrato_lancamentos
      (importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe)
      values ('dddddddd-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111',
              '2026-08-02', 'SEM CONTA', 'SEM CONTA', 1.00, 'saida', 'hash-sem-conta');
    raise exception 'FALHA 7: lançamento sem conta_bancaria_id foi aceito';
  exception when not_null_violation then
    raise notice 'OK 7: conta_bancaria_id é obrigatório no lançamento';
  end;
end $$;
