-- Cenários da atualização 35: estrutura das tabelas. As funções de
-- conciliação têm cenários próprios (mesmo arquivo, seção da Task 2).
\set ON_ERROR_STOP on
\set empresa '11111111-1111-1111-1111-111111111111'
\set outra '22222222-2222-2222-2222-222222222222'

-- Cenário 1: conta bancária e importação nascem ligadas e o tipo é restrito.
insert into public.contas_bancarias (id, empresa_id, nome, instituicao, tipo)
  values ('cccccccc-0000-0000-0000-000000000001', :'empresa', 'Sicoob principal', 'Sicoob', 'conta_corrente');
insert into public.contas_bancarias (id, empresa_id, nome, instituicao, tipo)
  values ('cccccccc-0000-0000-0000-000000000002', :'empresa', 'Cartão Bradesco', 'Bradesco', 'cartao_credito');
do $$
begin
  begin
    insert into public.contas_bancarias (empresa_id, nome, instituicao, tipo)
      values ('11111111-1111-1111-1111-111111111111', 'X', 'Y', 'poupanca');
    raise exception 'FALHA 1: check de tipo aceitou valor fora da lista';
  exception when check_violation then
    raise notice 'OK 1: check de tipo em contas_bancarias barra valor inválido';
  end;
end $$;

-- Cenário 2: dedupe. Mesmo hash na mesma empresa é rejeitado; em empresa
-- diferente passa (o unique é (empresa_id, hash_dedupe)).
insert into public.extrato_importacoes (id, empresa_id, conta_bancaria_id, tipo, arquivo_path, formato)
  values ('dddddddd-0000-0000-0000-000000000001', :'empresa',
          'cccccccc-0000-0000-0000-000000000001', 'extrato', 'p/1.ofx', 'ofx');

insert into public.extrato_lancamentos
  (id, importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe)
  values ('eeeeeeee-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
          :'empresa', '2026-08-10', 'PIX ENVIADO BOI FORTE', 'PIX ENVIADO BOI FORTE',
          1500.00, 'saida', 'hash-a');
do $$
begin
  begin
    insert into public.extrato_lancamentos
      (importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe)
      values ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
              '2026-08-10', 'PIX ENVIADO BOI FORTE', 'PIX ENVIADO BOI FORTE',
              1500.00, 'saida', 'hash-a');
    raise exception 'FALHA 2: hash duplicado na mesma empresa foi aceito';
  exception when unique_violation then
    raise notice 'OK 2: dedupe rejeita hash repetido na mesma empresa';
  end;
end $$;

-- Cenário 3: apagar a importação leva os lançamentos (cascade), e o
-- lançamento não pode existir sem importação.
insert into public.extrato_importacoes (id, empresa_id, conta_bancaria_id, tipo, arquivo_path, formato)
  values ('dddddddd-0000-0000-0000-000000000009', :'empresa',
          'cccccccc-0000-0000-0000-000000000001', 'extrato', 'p/9.ofx', 'ofx');
insert into public.extrato_lancamentos
  (importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe)
  values ('dddddddd-0000-0000-0000-000000000009', :'empresa', '2026-08-11', 'TARIFA', 'TARIFA',
          49.90, 'saida', 'hash-z');
delete from public.extrato_importacoes where id = 'dddddddd-0000-0000-0000-000000000009';
do $$
declare n int;
begin
  select count(*) into n from public.extrato_lancamentos where hash_dedupe = 'hash-z';
  if n <> 0 then raise exception 'FALHA 3: cascade não limpou lançamento (achou %)', n; end if;
  raise notice 'OK 3: cascade de importação limpa os lançamentos';
end $$;

-- Cenário 4: RLS separa empresa. Com auth.role()='authenticated' e
-- empresas_permitidas() devolvendo só a primeira, um select como usuário
-- comum não pode ver linha da outra empresa.
insert into public.extrato_importacoes (id, empresa_id, conta_bancaria_id, tipo, arquivo_path, formato)
  values ('dddddddd-0000-0000-0000-000000000002', :'outra',
          'cccccccc-0000-0000-0000-000000000001', 'extrato', 'p/2.ofx', 'ofx');

create role usuario_teste_35 nologin;
grant usage on schema public to usuario_teste_35;
grant select on all tables in schema public to usuario_teste_35;

-- `set local role` só vale dentro de transação. Sem o begin/commit explícito o
-- psql roda cada comando em autocommit, o papel não troca, o teste rodaria como
-- superusuário (que ignora RLS) e passaria sem provar nada.
begin;
set local role usuario_teste_35;
do $$
declare n int;
begin
  select count(*) into n from public.extrato_importacoes;
  if n <> 1 then
    raise exception 'FALHA 4: RLS deixou ver % importações (esperado 1)', n;
  end if;
  raise notice 'OK 4: RLS mostra só a importação da empresa permitida';
end $$;
commit;
