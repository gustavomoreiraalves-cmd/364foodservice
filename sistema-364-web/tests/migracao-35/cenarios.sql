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

-- ================= FUNÇÕES DE CONCILIAÇÃO =================
-- Base comum: uma conta a pagar de R$ 1.500,00 em duas parcelas de 750,00,
-- e um lançamento de saída de 750,00 batendo com a primeira.
insert into public.contas_a_pagar (id, descricao, categoria_conta, fornecedor_id, valor_total, empresa_id)
  values ('ffffffff-0000-0000-0000-000000000001', 'Carne agosto', 'Custos Diretos',
          'aaaaaaaa-0000-0000-0000-000000000001', 1500.00, :'empresa');
insert into public.contas_a_pagar_parcelas (id, conta_a_pagar_id, numero, valor, vencimento, empresa_id)
  values ('99999999-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000001',
          1, 750.00, '2026-08-10', :'empresa'),
         ('99999999-0000-0000-0000-000000000002', 'ffffffff-0000-0000-0000-000000000001',
          2, 750.00, '2026-09-10', :'empresa');
insert into public.extrato_lancamentos
  (id, importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe, status)
  values ('eeeeeeee-0000-0000-0000-000000000010', 'dddddddd-0000-0000-0000-000000000001',
          :'empresa', '2026-08-10', 'PIX ENVIADO BOI FORTE 123', 'PIX ENVIADO BOI FORTE',
          750.00, 'saida', 'hash-c1', 'sugerido');

-- Cenário 5: conciliar baixa a parcela, cria vínculo e grava o padrão.
do $$
declare parc record; vinc record; pad record; imp record;
begin
  perform public.fn_conciliar_lancamento(
    'eeeeeeee-0000-0000-0000-000000000010',
    '[{"parcela_id":"99999999-0000-0000-0000-000000000001","valor_aplicado":750.00}]'::jsonb,
    'Pix', 'aaaaaaaa-0000-0000-0000-000000000001', 'Custos Diretos');

  select * into parc from public.contas_a_pagar_parcelas
    where id = '99999999-0000-0000-0000-000000000001';
  if parc.status <> 'Pago' then raise exception 'FALHA 5: parcela não foi baixada (%)', parc.status; end if;
  if parc.data_pagamento <> '2026-08-10' then
    raise exception 'FALHA 5: data_pagamento veio %, esperado a data do débito', parc.data_pagamento;
  end if;
  if parc.forma_pagamento <> 'Pix' then
    raise exception 'FALHA 5: forma_pagamento veio %', parc.forma_pagamento;
  end if;

  select * into vinc from public.conciliacao_vinculos
    where lancamento_id = 'eeeeeeee-0000-0000-0000-000000000010';
  if vinc.baixou_parcela is not true then raise exception 'FALHA 5: baixou_parcela devia ser true'; end if;
  if vinc.valor_aplicado <> 750.00 then raise exception 'FALHA 5: valor_aplicado %', vinc.valor_aplicado; end if;

  select * into pad from public.conciliacao_padroes where padrao = 'PIX ENVIADO BOI FORTE';
  if pad.fornecedor_id <> 'aaaaaaaa-0000-0000-0000-000000000001' then
    raise exception 'FALHA 5: padrão não aprendeu o fornecedor';
  end if;
  if pad.usos <> 1 then raise exception 'FALHA 5: usos devia ser 1, veio %', pad.usos; end if;

  select * into imp from public.extrato_importacoes where id = 'dddddddd-0000-0000-0000-000000000001';
  if imp.conciliados <> 1 then raise exception 'FALHA 5: contador conciliados %', imp.conciliados; end if;
  raise notice 'OK 5: conciliar baixa parcela, cria vínculo, aprende padrão e atualiza contador';
end $$;

-- Cenário 6: confirmar de novo o mesmo padrão incrementa usos; fornecedor
-- diferente sobrescreve e reseta para 1 (última confirmação vence).
insert into public.extrato_lancamentos
  (id, importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe)
  values ('eeeeeeee-0000-0000-0000-000000000011', 'dddddddd-0000-0000-0000-000000000001',
          :'empresa', '2026-09-10', 'PIX ENVIADO BOI FORTE 456', 'PIX ENVIADO BOI FORTE',
          750.00, 'saida', 'hash-c2');
do $$
declare pad record;
begin
  perform public.fn_conciliar_lancamento(
    'eeeeeeee-0000-0000-0000-000000000011',
    '[{"parcela_id":"99999999-0000-0000-0000-000000000002","valor_aplicado":750.00}]'::jsonb,
    'Pix', 'aaaaaaaa-0000-0000-0000-000000000001', 'Custos Diretos');
  select * into pad from public.conciliacao_padroes where padrao = 'PIX ENVIADO BOI FORTE';
  if pad.usos <> 2 then raise exception 'FALHA 6: usos devia ir a 2, veio %', pad.usos; end if;
  raise notice 'OK 6: confirmação repetida incrementa usos do padrão';
end $$;

-- Cenário 7: lançamento de entrada não concilia (fase só de saídas).
insert into public.extrato_lancamentos
  (id, importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe, status)
  values ('eeeeeeee-0000-0000-0000-000000000012', 'dddddddd-0000-0000-0000-000000000001',
          :'empresa', '2026-08-12', 'PIX RECEBIDO CLIENTE', 'PIX RECEBIDO CLIENTE',
          200.00, 'entrada', 'hash-c3', 'ignorado');
do $$
begin
  begin
    perform public.fn_conciliar_lancamento('eeeeeeee-0000-0000-0000-000000000012',
      '[{"parcela_id":"99999999-0000-0000-0000-000000000001","valor_aplicado":200.00}]'::jsonb,
      'Pix', null, null);
    raise exception 'FALHA 7: conciliou uma entrada';
  exception when others then
    if sqlerrm like 'FALHA 7%' then raise; end if;
    raise notice 'OK 7: entrada é rejeitada pela conciliação (%)', sqlerrm;
  end;
end $$;

-- Cenário 8: parcela já paga antes da conciliação é vinculada sem ser
-- rebaixada — baixou_parcela = false, e a data original não muda.
insert into public.contas_a_pagar (id, descricao, categoria_conta, fornecedor_id, valor_total, empresa_id)
  values ('ffffffff-0000-0000-0000-000000000002', 'Gás', 'Custos Fixos',
          'aaaaaaaa-0000-0000-0000-000000000001', 300.00, :'empresa');
insert into public.contas_a_pagar_parcelas
  (id, conta_a_pagar_id, numero, valor, vencimento, status, data_pagamento, forma_pagamento, empresa_id)
  values ('99999999-0000-0000-0000-000000000003', 'ffffffff-0000-0000-0000-000000000002',
          1, 300.00, '2026-08-05', 'Pago', '2026-08-04', 'Dinheiro', :'empresa');
insert into public.extrato_lancamentos
  (id, importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe)
  values ('eeeeeeee-0000-0000-0000-000000000013', 'dddddddd-0000-0000-0000-000000000001',
          :'empresa', '2026-08-05', 'DEB AUT GAS', 'DEB AUT GAS', 300.00, 'saida', 'hash-c4');
do $$
declare parc record; vinc record;
begin
  perform public.fn_conciliar_lancamento('eeeeeeee-0000-0000-0000-000000000013',
    '[{"parcela_id":"99999999-0000-0000-0000-000000000003","valor_aplicado":300.00}]'::jsonb,
    'Transferência', null, null);
  select * into parc from public.contas_a_pagar_parcelas where id = '99999999-0000-0000-0000-000000000003';
  if parc.data_pagamento <> '2026-08-04' or parc.forma_pagamento <> 'Dinheiro' then
    raise exception 'FALHA 8: conciliação pisou na baixa que já existia';
  end if;
  select * into vinc from public.conciliacao_vinculos
    where lancamento_id = 'eeeeeeee-0000-0000-0000-000000000013';
  if vinc.baixou_parcela is not false then
    raise exception 'FALHA 8: baixou_parcela devia ser false em parcela já paga';
  end if;
  raise notice 'OK 8: parcela já paga é só vinculada, nunca rebaixada';
end $$;

-- Cenário 9: desfazer devolve a parcela que a conciliação baixou e não
-- reabre a que já estava paga.
do $$
declare p1 record; p3 record; lanc record;
begin
  perform public.fn_desfazer_conciliacao('eeeeeeee-0000-0000-0000-000000000010');
  perform public.fn_desfazer_conciliacao('eeeeeeee-0000-0000-0000-000000000013');
  select * into p1 from public.contas_a_pagar_parcelas where id = '99999999-0000-0000-0000-000000000001';
  if p1.status <> 'Pendente' or p1.data_pagamento is not null then
    raise exception 'FALHA 9: parcela baixada pela conciliação não voltou a Pendente';
  end if;
  select * into p3 from public.contas_a_pagar_parcelas where id = '99999999-0000-0000-0000-000000000003';
  if p3.status <> 'Pago' or p3.data_pagamento <> '2026-08-04' then
    raise exception 'FALHA 9: desfazer reabriu parcela que já estava paga antes';
  end if;
  select * into lanc from public.extrato_lancamentos where id = 'eeeeeeee-0000-0000-0000-000000000010';
  if lanc.status <> 'pendente' then
    raise exception 'FALHA 9: lançamento devia voltar a pendente, veio %', lanc.status;
  end if;
  if exists (select 1 from public.conciliacao_vinculos
             where lancamento_id = 'eeeeeeee-0000-0000-0000-000000000010') then
    raise exception 'FALHA 9: vínculo sobreviveu ao desfazer';
  end if;
  raise notice 'OK 9: desfazer reverte só o que a conciliação mesmo baixou';
end $$;

-- Cenário 10: criar conta a partir do extrato (saída sem lançamento) e
-- desfazer apaga a conta criada — nada de conta a pagar fantasma.
insert into public.extrato_lancamentos
  (id, importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe)
  values ('eeeeeeee-0000-0000-0000-000000000014', 'dddddddd-0000-0000-0000-000000000001',
          :'empresa', '2026-08-15', 'TARIFA PACOTE SERVICOS', 'TARIFA PACOTE SERVICOS',
          49.90, 'saida', 'hash-c5');
do $$
declare lanc record; conta record; parc record;
begin
  perform public.fn_criar_conta_e_conciliar('eeeeeeee-0000-0000-0000-000000000014',
    'Tarifa bancária agosto', 'Custos Fixos', 'aaaaaaaa-0000-0000-0000-000000000001',
    'bbbbbbbb-0000-0000-0000-000000000001', 'Transferência');
  select * into lanc from public.extrato_lancamentos where id = 'eeeeeeee-0000-0000-0000-000000000014';
  if lanc.status <> 'conciliado' or lanc.conta_criada_id is null then
    raise exception 'FALHA 10: lançamento não ficou conciliado com conta_criada_id';
  end if;
  select * into conta from public.contas_a_pagar where id = lanc.conta_criada_id;
  if conta.valor_total <> 49.90 then raise exception 'FALHA 10: valor_total %', conta.valor_total; end if;
  select * into parc from public.contas_a_pagar_parcelas where conta_a_pagar_id = conta.id;
  if parc.status <> 'Pago' or parc.data_pagamento <> '2026-08-15' or parc.numero <> 1 then
    raise exception 'FALHA 10: parcela criada não nasceu paga na data do débito';
  end if;

  perform public.fn_desfazer_conciliacao('eeeeeeee-0000-0000-0000-000000000014');
  if exists (select 1 from public.contas_a_pagar where id = conta.id) then
    raise exception 'FALHA 10: desfazer deixou a conta criada para trás';
  end if;
  raise notice 'OK 10: criar conta do extrato e desfazer não deixa conta fantasma';
end $$;

-- Cenário 11: fatura de cartão. Linhas conciliam sem baixar; o pagamento da
-- fatura no extrato baixa todas de uma vez. Valor divergente só passa com
-- p_forcar.
insert into public.extrato_importacoes (id, empresa_id, conta_bancaria_id, tipo, arquivo_path, formato)
  values ('dddddddd-0000-0000-0000-000000000003', :'empresa',
          'cccccccc-0000-0000-0000-000000000002', 'fatura_cartao', 'p/fatura.pdf', 'pdf');
insert into public.contas_a_pagar (id, descricao, categoria_conta, fornecedor_id, valor_total, empresa_id)
  values ('ffffffff-0000-0000-0000-000000000003', 'Insumos Mercado Livre', 'Custos Variáveis',
          'aaaaaaaa-0000-0000-0000-000000000001', 400.00, :'empresa');
insert into public.contas_a_pagar_parcelas (id, conta_a_pagar_id, numero, valor, vencimento, empresa_id)
  values ('99999999-0000-0000-0000-000000000004', 'ffffffff-0000-0000-0000-000000000003',
          1, 400.00, '2026-08-20', :'empresa');
insert into public.extrato_lancamentos
  (id, importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe)
  values ('eeeeeeee-0000-0000-0000-000000000015', 'dddddddd-0000-0000-0000-000000000003',
          :'empresa', '2026-08-02', 'MERCADO LIVRE', 'MERCADO LIVRE', 400.00, 'saida', 'hash-f1');
insert into public.extrato_lancamentos
  (id, importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe)
  values ('eeeeeeee-0000-0000-0000-000000000016', 'dddddddd-0000-0000-0000-000000000001',
          :'empresa', '2026-08-25', 'PAGAMENTO FATURA CARTAO', 'PAGAMENTO FATURA CARTAO',
          400.00, 'saida', 'hash-f2');
do $$
declare parc record; vinc record;
begin
  -- linha da fatura: concilia, não baixa
  perform public.fn_conciliar_lancamento('eeeeeeee-0000-0000-0000-000000000015',
    '[{"parcela_id":"99999999-0000-0000-0000-000000000004","valor_aplicado":400.00}]'::jsonb,
    'Cartão de Crédito', 'aaaaaaaa-0000-0000-0000-000000000001', 'Custos Variáveis');
  select * into parc from public.contas_a_pagar_parcelas where id = '99999999-0000-0000-0000-000000000004';
  if parc.status <> 'Pendente' then
    raise exception 'FALHA 11: linha de fatura baixou a parcela (devia esperar o pagamento)';
  end if;

  -- valor divergente sem forçar: barra
  begin
    perform public.fn_conciliar_pagamento_fatura('eeeeeeee-0000-0000-0000-000000000016',
      'dddddddd-0000-0000-0000-000000000003', false);
  exception when others then
    raise exception 'FALHA 11: valor batia (400 = 400) e a função recusou: %', sqlerrm;
  end;
  select * into parc from public.contas_a_pagar_parcelas where id = '99999999-0000-0000-0000-000000000004';
  if parc.status <> 'Pago' or parc.forma_pagamento <> 'Cartão de Crédito'
     or parc.data_pagamento <> '2026-08-25' then
    raise exception 'FALHA 11: pagamento da fatura não baixou a parcela na data do débito';
  end if;
  select * into vinc from public.conciliacao_vinculos
    where lancamento_id = 'eeeeeeee-0000-0000-0000-000000000015';
  if vinc.baixou_parcela is not true then
    raise exception 'FALHA 11: baixou_parcela do vínculo da fatura devia virar true';
  end if;
  raise notice 'OK 11: fatura concilia sem baixar e o pagamento baixa em lote';
end $$;

-- Cenário 12: pagamento de fatura com valor diferente da soma exige p_forcar.
insert into public.contas_a_pagar (id, descricao, categoria_conta, fornecedor_id, valor_total, empresa_id)
  values ('ffffffff-0000-0000-0000-000000000004', 'Insumos diversos', 'Custos Variáveis',
          'aaaaaaaa-0000-0000-0000-000000000001', 100.00, :'empresa');
insert into public.contas_a_pagar_parcelas (id, conta_a_pagar_id, numero, valor, vencimento, empresa_id)
  values ('99999999-0000-0000-0000-000000000005', 'ffffffff-0000-0000-0000-000000000004',
          1, 100.00, '2026-09-20', :'empresa');
insert into public.extrato_importacoes (id, empresa_id, conta_bancaria_id, tipo, arquivo_path, formato)
  values ('dddddddd-0000-0000-0000-000000000004', :'empresa',
          'cccccccc-0000-0000-0000-000000000002', 'fatura_cartao', 'p/fatura2.pdf', 'pdf');
insert into public.extrato_lancamentos
  (id, importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe)
  values ('eeeeeeee-0000-0000-0000-000000000017', 'dddddddd-0000-0000-0000-000000000004',
          :'empresa', '2026-09-02', 'MERCADO LIVRE', 'MERCADO LIVRE 2', 100.00, 'saida', 'hash-f3');
insert into public.extrato_lancamentos
  (id, importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe)
  values ('eeeeeeee-0000-0000-0000-000000000018', 'dddddddd-0000-0000-0000-000000000001',
          :'empresa', '2026-09-25', 'PAGAMENTO FATURA CARTAO', 'PAGAMENTO FATURA CARTAO 2',
          60.00, 'saida', 'hash-f4');
do $$
declare parc record;
begin
  perform public.fn_conciliar_lancamento('eeeeeeee-0000-0000-0000-000000000017',
    '[{"parcela_id":"99999999-0000-0000-0000-000000000005","valor_aplicado":100.00}]'::jsonb,
    'Cartão de Crédito', null, null);
  begin
    perform public.fn_conciliar_pagamento_fatura('eeeeeeee-0000-0000-0000-000000000018',
      'dddddddd-0000-0000-0000-000000000004', false);
    raise exception 'FALHA 12: pagamento parcial passou sem p_forcar';
  exception when others then
    if sqlerrm like 'FALHA 12%' then raise; end if;
    raise notice 'OK 12a: pagamento parcial é barrado sem confirmação (%)', sqlerrm;
  end;
  perform public.fn_conciliar_pagamento_fatura('eeeeeeee-0000-0000-0000-000000000018',
    'dddddddd-0000-0000-0000-000000000004', true);
  select * into parc from public.contas_a_pagar_parcelas where id = '99999999-0000-0000-0000-000000000005';
  if parc.status <> 'Pago' then raise exception 'FALHA 12: p_forcar não baixou'; end if;
  raise notice 'OK 12b: com p_forcar o pagamento parcial baixa as parcelas da fatura';
end $$;

-- Cenário 13: desfazer o pagamento da fatura devolve só a parcela que ele
-- baixou; a parcela que já estava paga antes de conciliar continua intacta;
-- as duas linhas seguem conciliadas (a compra não é desfeita, só o
-- pagamento) e voltam a baixou_parcela = false.
insert into public.extrato_importacoes (id, empresa_id, conta_bancaria_id, tipo, arquivo_path, formato)
  values ('dddddddd-0000-0000-0000-000000000005', :'empresa',
          'cccccccc-0000-0000-0000-000000000002', 'fatura_cartao', 'p/fatura3.pdf', 'pdf');
insert into public.contas_a_pagar (id, descricao, categoria_conta, fornecedor_id, valor_total, empresa_id)
  values ('ffffffff-0000-0000-0000-000000000005', 'Insumos loja A', 'Custos Variáveis',
          'aaaaaaaa-0000-0000-0000-000000000001', 250.00, :'empresa');
insert into public.contas_a_pagar_parcelas (id, conta_a_pagar_id, numero, valor, vencimento, empresa_id)
  values ('99999999-0000-0000-0000-000000000006', 'ffffffff-0000-0000-0000-000000000005',
          1, 250.00, '2026-09-20', :'empresa');
insert into public.contas_a_pagar (id, descricao, categoria_conta, fornecedor_id, valor_total, empresa_id)
  values ('ffffffff-0000-0000-0000-000000000006', 'Manutenção equipamento', 'Custos Fixos',
          'aaaaaaaa-0000-0000-0000-000000000001', 80.00, :'empresa');
insert into public.contas_a_pagar_parcelas
  (id, conta_a_pagar_id, numero, valor, vencimento, status, data_pagamento, forma_pagamento, empresa_id)
  values ('99999999-0000-0000-0000-000000000007', 'ffffffff-0000-0000-0000-000000000006',
          1, 80.00, '2026-08-01', 'Pago', '2026-07-30', 'Dinheiro', :'empresa');
insert into public.extrato_lancamentos
  (id, importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe)
  values ('eeeeeeee-0000-0000-0000-000000000019', 'dddddddd-0000-0000-0000-000000000005',
          :'empresa', '2026-09-03', 'LOJA A INSUMOS', 'LOJA A INSUMOS', 250.00, 'saida', 'hash-f5');
insert into public.extrato_lancamentos
  (id, importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe)
  values ('eeeeeeee-0000-0000-0000-000000000020', 'dddddddd-0000-0000-0000-000000000005',
          :'empresa', '2026-08-01', 'MANUTENCAO EQUIP', 'MANUTENCAO EQUIP', 80.00, 'saida', 'hash-f6');
insert into public.extrato_lancamentos
  (id, importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe)
  values ('eeeeeeee-0000-0000-0000-000000000021', 'dddddddd-0000-0000-0000-000000000001',
          :'empresa', '2026-09-25', 'PAGAMENTO FATURA CARTAO', 'PAGAMENTO FATURA CARTAO 3',
          330.00, 'saida', 'hash-f7');
do $$
declare pendente record; paga record; vinc1 record; vinc2 record; lanc record;
begin
  perform public.fn_conciliar_lancamento('eeeeeeee-0000-0000-0000-000000000019',
    '[{"parcela_id":"99999999-0000-0000-0000-000000000006","valor_aplicado":250.00}]'::jsonb,
    'Cartão de Crédito', 'aaaaaaaa-0000-0000-0000-000000000001', 'Custos Variáveis');
  perform public.fn_conciliar_lancamento('eeeeeeee-0000-0000-0000-000000000020',
    '[{"parcela_id":"99999999-0000-0000-0000-000000000007","valor_aplicado":80.00}]'::jsonb,
    'Cartão de Crédito', 'aaaaaaaa-0000-0000-0000-000000000001', 'Custos Fixos');
  perform public.fn_conciliar_pagamento_fatura('eeeeeeee-0000-0000-0000-000000000021',
    'dddddddd-0000-0000-0000-000000000005', false);

  -- prova que o pagamento só marcou baixou_parcela=true na linha que ele de
  -- fato baixou, não na linha que já estava paga antes de conciliar
  select * into vinc1 from public.conciliacao_vinculos
    where lancamento_id = 'eeeeeeee-0000-0000-0000-000000000019';
  if vinc1.baixou_parcela is not true then
    raise exception 'FALHA 13: pagamento devia ter marcado baixou_parcela=true na linha pendente';
  end if;
  select * into vinc2 from public.conciliacao_vinculos
    where lancamento_id = 'eeeeeeee-0000-0000-0000-000000000020';
  if vinc2.baixou_parcela is not false then
    raise exception 'FALHA 13: linha já paga antes não devia virar baixou_parcela=true';
  end if;

  perform public.fn_desfazer_conciliacao('eeeeeeee-0000-0000-0000-000000000021');

  select * into pendente from public.contas_a_pagar_parcelas where id = '99999999-0000-0000-0000-000000000006';
  if pendente.status <> 'Pendente' or pendente.data_pagamento is not null or pendente.forma_pagamento is not null then
    raise exception 'FALHA 13: desfazer o pagamento não devolveu a parcela que ele baixou (status=%, data=%, forma=%)',
      pendente.status, pendente.data_pagamento, pendente.forma_pagamento;
  end if;

  select * into paga from public.contas_a_pagar_parcelas where id = '99999999-0000-0000-0000-000000000007';
  if paga.status <> 'Pago' or paga.data_pagamento <> '2026-07-30' or paga.forma_pagamento <> 'Dinheiro' then
    raise exception 'FALHA 13: desfazer o pagamento mexeu na parcela que já estava paga antes (status=%, data=%, forma=%)',
      paga.status, paga.data_pagamento, paga.forma_pagamento;
  end if;

  select * into vinc1 from public.conciliacao_vinculos
    where lancamento_id = 'eeeeeeee-0000-0000-0000-000000000019';
  if vinc1 is null then raise exception 'FALHA 13: vínculo da linha pendente sumiu — a compra devia continuar conciliada'; end if;
  if vinc1.baixou_parcela is not false then
    raise exception 'FALHA 13: baixou_parcela da linha pendente devia voltar a false';
  end if;

  select * into vinc2 from public.conciliacao_vinculos
    where lancamento_id = 'eeeeeeee-0000-0000-0000-000000000020';
  if vinc2 is null then raise exception 'FALHA 13: vínculo da linha já paga sumiu — a compra devia continuar conciliada'; end if;
  if vinc2.baixou_parcela is not false then
    raise exception 'FALHA 13: baixou_parcela da linha já paga devia continuar false';
  end if;

  select * into lanc from public.extrato_lancamentos where id = 'eeeeeeee-0000-0000-0000-000000000021';
  if lanc.status <> 'pendente' or lanc.fatura_id is not null then
    raise exception 'FALHA 13: lançamento do pagamento devia voltar a pendente sem fatura_id (status=%, fatura_id=%)',
      lanc.status, lanc.fatura_id;
  end if;

  raise notice 'OK 13: desfazer o pagamento da fatura devolve só o que ele baixou e preserva a parcela já paga antes';
end $$;

-- ================= FRONTEIRA DE EMPRESA (fornecedor/responsável) =================
-- fn_criar_conta_e_conciliar e fn_registrar_padrao recebem p_fornecedor_id e
-- p_responsavel_id do corpo da requisição HTTP e não conferiam a que empresa
-- eles pertencem — um usuário do financeiro numa empresa do grupo podia
-- apontar para o cadastro de outra. Fornecedor e funcionário abaixo são da
-- empresa 'outra' (:'outra'), a mesma que o cenário 4 já usa para RLS.
insert into public.fornecedores (id, empresa_id, nome, cnpj)
  values ('aaaaaaaa-0000-0000-0000-000000000099', :'outra', 'Fornecedor de Outra Empresa', '99999999000199');
insert into public.funcionarios (id, empresa_id, nome)
  values ('bbbbbbbb-0000-0000-0000-000000000099', :'outra', 'Funcionário de Outra Empresa');

-- Cenário 14: criar conta com fornecedor de outra empresa é recusado, e nada
-- fica gravado — nem conta, nem parcela, nem vínculo.
insert into public.extrato_lancamentos
  (id, importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe)
  values ('eeeeeeee-0000-0000-0000-000000000022', 'dddddddd-0000-0000-0000-000000000001',
          :'empresa', '2026-08-18', 'TAXA MANUTENCAO CONTA', 'TAXA MANUTENCAO CONTA', 35.00, 'saida', 'hash-g1');
do $$
declare
  n_contas_antes int; n_contas_depois int;
  n_parcelas_antes int; n_parcelas_depois int;
  n_vinculos_antes int; n_vinculos_depois int;
  lanc record;
begin
  select count(*) into n_contas_antes from public.contas_a_pagar;
  select count(*) into n_parcelas_antes from public.contas_a_pagar_parcelas;
  select count(*) into n_vinculos_antes from public.conciliacao_vinculos;

  begin
    perform public.fn_criar_conta_e_conciliar('eeeeeeee-0000-0000-0000-000000000022',
      'Taxa de manutenção', 'Custos Fixos', 'aaaaaaaa-0000-0000-0000-000000000099',
      null, 'Débito Automático');
    raise exception 'FALHA 14: criou conta com fornecedor de outra empresa';
  exception when others then
    if sqlerrm like 'FALHA 14%' then raise; end if;
  end;

  select count(*) into n_contas_depois from public.contas_a_pagar;
  select count(*) into n_parcelas_depois from public.contas_a_pagar_parcelas;
  select count(*) into n_vinculos_depois from public.conciliacao_vinculos;
  if n_contas_depois <> n_contas_antes or n_parcelas_depois <> n_parcelas_antes
     or n_vinculos_depois <> n_vinculos_antes then
    raise exception 'FALHA 14: rejeitou mas deixou rastro (contas %->%, parcelas %->%, vínculos %->%)',
      n_contas_antes, n_contas_depois, n_parcelas_antes, n_parcelas_depois, n_vinculos_antes, n_vinculos_depois;
  end if;

  select * into lanc from public.extrato_lancamentos where id = 'eeeeeeee-0000-0000-0000-000000000022';
  if lanc.status = 'conciliado' then
    raise exception 'FALHA 14: lançamento ficou conciliado mesmo com a exceção';
  end if;

  raise notice 'OK 14: fornecedor de outra empresa é recusado ao criar conta e nada fica gravado';
end $$;

-- Cenário 15: criar conta com responsável de outra empresa é recusado
-- (fornecedor é válido, isolando que quem barrou foi o responsável).
insert into public.extrato_lancamentos
  (id, importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe)
  values ('eeeeeeee-0000-0000-0000-000000000023', 'dddddddd-0000-0000-0000-000000000001',
          :'empresa', '2026-08-19', 'TAXA EXTRATO PAPEL', 'TAXA EXTRATO PAPEL', 12.00, 'saida', 'hash-g2');
do $$
declare lanc record;
begin
  begin
    perform public.fn_criar_conta_e_conciliar('eeeeeeee-0000-0000-0000-000000000023',
      'Taxa de extrato', 'Custos Fixos', 'aaaaaaaa-0000-0000-0000-000000000001',
      'bbbbbbbb-0000-0000-0000-000000000099', 'Débito Automático');
    raise exception 'FALHA 15: criou conta com responsável de outra empresa';
  exception when others then
    if sqlerrm like 'FALHA 15%' then raise; end if;
  end;

  select * into lanc from public.extrato_lancamentos where id = 'eeeeeeee-0000-0000-0000-000000000023';
  if lanc.status = 'conciliado' then
    raise exception 'FALHA 15: lançamento ficou conciliado mesmo com responsável de outra empresa';
  end if;
  if exists (select 1 from public.contas_a_pagar where descricao = 'Taxa de extrato') then
    raise exception 'FALHA 15: conta foi criada mesmo com responsável de outra empresa';
  end if;
  raise notice 'OK 15: responsável de outra empresa é recusado ao criar conta';
end $$;

-- Cenário 16: responsável nulo continua funcionando — ele é opcional, a
-- conferência nova não pode transformá-lo em obrigatório.
insert into public.extrato_lancamentos
  (id, importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe)
  values ('eeeeeeee-0000-0000-0000-000000000024', 'dddddddd-0000-0000-0000-000000000001',
          :'empresa', '2026-08-20', 'TAXA TED ENVIADA', 'TAXA TED ENVIADA', 18.50, 'saida', 'hash-g3');
do $$
declare lanc record; conta record;
begin
  perform public.fn_criar_conta_e_conciliar('eeeeeeee-0000-0000-0000-000000000024',
    'TED enviada', 'Custos Fixos', 'aaaaaaaa-0000-0000-0000-000000000001',
    null, 'Transferência');
  select * into lanc from public.extrato_lancamentos where id = 'eeeeeeee-0000-0000-0000-000000000024';
  if lanc.status <> 'conciliado' or lanc.conta_criada_id is null then
    raise exception 'FALHA 16: responsável nulo devia continuar funcionando';
  end if;
  select * into conta from public.contas_a_pagar where id = lanc.conta_criada_id;
  if conta.responsavel_id is not null then
    raise exception 'FALHA 16: responsavel_id devia ficar nulo';
  end if;
  raise notice 'OK 16: responsável nulo continua sendo aceito ao criar conta';
end $$;

-- Cenário 17: fn_registrar_padrao com fornecedor de outra empresa não
-- levanta exceção — ela é ignorada, mesmo tratamento do fornecedor nulo — e
-- por isso conciliar com esse fornecedor (só para fins de aprendizado) não
-- aborta a baixa real da parcela, que já é protegida por conta própria.
insert into public.contas_a_pagar (id, descricao, categoria_conta, fornecedor_id, valor_total, empresa_id)
  values ('ffffffff-0000-0000-0000-000000000007', 'Frete emergencial', 'Custos Diretos',
          'aaaaaaaa-0000-0000-0000-000000000001', 60.00, :'empresa');
insert into public.contas_a_pagar_parcelas (id, conta_a_pagar_id, numero, valor, vencimento, empresa_id)
  values ('99999999-0000-0000-0000-000000000008', 'ffffffff-0000-0000-0000-000000000007',
          1, 60.00, '2026-08-22', :'empresa');
insert into public.extrato_lancamentos
  (id, importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe)
  values ('eeeeeeee-0000-0000-0000-000000000025', 'dddddddd-0000-0000-0000-000000000001',
          :'empresa', '2026-08-22', 'FRETE EXPRESSO XYZ', 'FRETE EXPRESSO XYZ', 60.00, 'saida', 'hash-g4');
do $$
declare v_ret uuid; lanc record; parc record;
begin
  v_ret := public.fn_registrar_padrao('11111111-1111-1111-1111-111111111111',
    'PADRAO TESTE OUTRA EMPRESA', 'aaaaaaaa-0000-0000-0000-000000000099', 'Custos Diretos');
  if v_ret is not null then
    raise exception 'FALHA 17: fn_registrar_padrao devolveu id para fornecedor de outra empresa';
  end if;
  if exists (select 1 from public.conciliacao_padroes where padrao = 'PADRAO TESTE OUTRA EMPRESA') then
    raise exception 'FALHA 17: padrão foi gravado com fornecedor de outra empresa';
  end if;

  perform public.fn_conciliar_lancamento('eeeeeeee-0000-0000-0000-000000000025',
    '[{"parcela_id":"99999999-0000-0000-0000-000000000008","valor_aplicado":60.00}]'::jsonb,
    'Pix', 'aaaaaaaa-0000-0000-0000-000000000099', 'Custos Diretos');

  select * into parc from public.contas_a_pagar_parcelas where id = '99999999-0000-0000-0000-000000000008';
  if parc.status <> 'Pago' then
    raise exception 'FALHA 17: fornecedor de outra empresa (só para aprendizado) travou a baixa da parcela';
  end if;
  select * into lanc from public.extrato_lancamentos where id = 'eeeeeeee-0000-0000-0000-000000000025';
  if lanc.status <> 'conciliado' then
    raise exception 'FALHA 17: lançamento devia ficar conciliado mesmo sem aprender o padrão';
  end if;
  if exists (select 1 from public.conciliacao_padroes where padrao = 'FRETE EXPRESSO XYZ') then
    raise exception 'FALHA 17: aprendeu padrão com fornecedor de outra empresa';
  end if;

  raise notice 'OK 17: fornecedor de outra empresa não vira padrão, mas não trava a conciliação';
end $$;

-- Cenário 18 (controle): fornecedor e responsável da própria empresa
-- continuam passando — prova que a conferência nova não fechou demais.
insert into public.extrato_lancamentos
  (id, importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe)
  values ('eeeeeeee-0000-0000-0000-000000000026', 'dddddddd-0000-0000-0000-000000000001',
          :'empresa', '2026-08-23', 'TAXA MENSALIDADE CARTAO', 'TAXA MENSALIDADE CARTAO', 25.00, 'saida', 'hash-g5');
do $$
declare lanc record; conta record;
begin
  perform public.fn_criar_conta_e_conciliar('eeeeeeee-0000-0000-0000-000000000026',
    'Mensalidade cartão', 'Custos Fixos', 'aaaaaaaa-0000-0000-0000-000000000001',
    'bbbbbbbb-0000-0000-0000-000000000001', 'Débito Automático');
  select * into lanc from public.extrato_lancamentos where id = 'eeeeeeee-0000-0000-0000-000000000026';
  if lanc.status <> 'conciliado' or lanc.conta_criada_id is null then
    raise exception 'FALHA 18: fornecedor e responsável da própria empresa deviam passar';
  end if;
  select * into conta from public.contas_a_pagar where id = lanc.conta_criada_id;
  if conta.fornecedor_id <> 'aaaaaaaa-0000-0000-0000-000000000001'
     or conta.responsavel_id <> 'bbbbbbbb-0000-0000-0000-000000000001' then
    raise exception 'FALHA 18: fornecedor/responsável gravados não batem com os informados';
  end if;
  raise notice 'OK 18: fornecedor e responsável da própria empresa continuam sendo aceitos';
end $$;

-- ================= LINHA DE FATURA PELO "CRIAR E CONCILIAR" =================
-- O cenário 11 prova a regra do cartão pelo caminho de fn_conciliar_lancamento
-- (a parcela já existe no contas a pagar). O caminho que o manual manda usar no
-- passo 5 é o outro: a compra da fatura não tem conta a pagar nenhuma, e o
-- colaborador cria uma dali mesmo — fn_criar_conta_e_conciliar. Compra no
-- cartão não pode nascer paga: o dinheiro só sai do banco quando a fatura for
-- paga, e é o pagamento da fatura que baixa. Sem este cenário a regra do cartão
-- só era testada pela metade.
insert into public.extrato_importacoes (id, empresa_id, conta_bancaria_id, tipo, arquivo_path, formato)
  values ('dddddddd-0000-0000-0000-000000000006', :'empresa',
          'cccccccc-0000-0000-0000-000000000002', 'fatura_cartao', 'p/fatura4.pdf', 'pdf');
insert into public.extrato_lancamentos
  (id, importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe)
  values ('eeeeeeee-0000-0000-0000-000000000027', 'dddddddd-0000-0000-0000-000000000006',
          :'empresa', '2026-08-02', 'MERCADO LIVRE 111', 'MERCADO LIVRE A', 120.00, 'saida', 'hash-h1'),
         ('eeeeeeee-0000-0000-0000-000000000028', 'dddddddd-0000-0000-0000-000000000006',
          :'empresa', '2026-08-03', 'MERCADO LIVRE 222', 'MERCADO LIVRE B', 80.00, 'saida', 'hash-h2');
insert into public.extrato_lancamentos
  (id, importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe)
  values ('eeeeeeee-0000-0000-0000-000000000029', 'dddddddd-0000-0000-0000-000000000001',
          :'empresa', '2026-09-05', 'PAGAMENTO FATURA CARTAO', 'PAGAMENTO FATURA CARTAO 4',
          200.00, 'saida', 'hash-h3');
do $$
declare
  lanc1 record; lanc2 record; parc record; vinc1 record; vinc2 record;
  id_parc1 uuid; id_parc2 uuid; ret jsonb;
begin
  perform public.fn_criar_conta_e_conciliar('eeeeeeee-0000-0000-0000-000000000027',
    'Insumos Mercado Livre A', 'Custos Variáveis', 'aaaaaaaa-0000-0000-0000-000000000001',
    null, 'Cartão de Crédito');
  perform public.fn_criar_conta_e_conciliar('eeeeeeee-0000-0000-0000-000000000028',
    'Insumos Mercado Livre B', 'Custos Variáveis', 'aaaaaaaa-0000-0000-0000-000000000001',
    null, 'Cartão de Crédito');

  select * into lanc1 from public.extrato_lancamentos where id = 'eeeeeeee-0000-0000-0000-000000000027';
  select * into lanc2 from public.extrato_lancamentos where id = 'eeeeeeee-0000-0000-0000-000000000028';
  select id into id_parc1 from public.contas_a_pagar_parcelas where conta_a_pagar_id = lanc1.conta_criada_id;
  select id into id_parc2 from public.contas_a_pagar_parcelas where conta_a_pagar_id = lanc2.conta_criada_id;

  select * into parc from public.contas_a_pagar_parcelas where id = id_parc1;
  if parc.status <> 'Pendente' or parc.data_pagamento is not null or parc.forma_pagamento is not null then
    raise exception 'FALHA 19: compra de fatura criada pelo "criar e conciliar" nasceu paga (status=%, data=%, forma=%)',
      parc.status, parc.data_pagamento, parc.forma_pagamento;
  end if;
  if parc.vencimento <> '2026-08-02' then
    raise exception 'FALHA 19: vencimento devia ser a data da compra, veio %', parc.vencimento;
  end if;
  select * into parc from public.contas_a_pagar_parcelas where id = id_parc2;
  if parc.status <> 'Pendente' then
    raise exception 'FALHA 19: segunda compra da fatura também nasceu paga (%)', parc.status;
  end if;
  select * into vinc1 from public.conciliacao_vinculos
    where lancamento_id = 'eeeeeeee-0000-0000-0000-000000000027';
  if vinc1.baixou_parcela is not false then
    raise exception 'FALHA 19: vínculo de linha de fatura não pode nascer com baixou_parcela = true';
  end if;

  -- quem baixa é o pagamento da fatura no extrato da conta corrente
  ret := public.fn_conciliar_pagamento_fatura('eeeeeeee-0000-0000-0000-000000000029',
    'dddddddd-0000-0000-0000-000000000006', false);
  if (ret->>'baixadas')::int <> 2 then
    raise exception 'FALHA 19: o pagamento da fatura devia baixar 2 parcelas, baixou %', ret->>'baixadas';
  end if;
  select * into parc from public.contas_a_pagar_parcelas where id = id_parc1;
  if parc.status <> 'Pago' or parc.data_pagamento <> '2026-09-05'
     or parc.forma_pagamento <> 'Cartão de Crédito' then
    raise exception 'FALHA 19: pagamento da fatura não baixou a parcela criada pelo "criar e conciliar" (status=%, data=%)',
      parc.status, parc.data_pagamento;
  end if;
  select * into parc from public.contas_a_pagar_parcelas where id = id_parc2;
  if parc.status <> 'Pago' or parc.data_pagamento <> '2026-09-05' then
    raise exception 'FALHA 19: segunda parcela não foi baixada pelo pagamento da fatura (status=%)', parc.status;
  end if;

  -- desfazer o pagamento reabre exatamente essas duas, e só elas
  ret := public.fn_desfazer_conciliacao('eeeeeeee-0000-0000-0000-000000000029');
  if (ret->>'reabertas')::int <> 2 then
    raise exception 'FALHA 19: desfazer o pagamento devia reabrir 2 parcelas, reabriu %', ret->>'reabertas';
  end if;
  select * into parc from public.contas_a_pagar_parcelas where id = id_parc1;
  if parc.status <> 'Pendente' or parc.data_pagamento is not null then
    raise exception 'FALHA 19: desfazer o pagamento não devolveu a parcela da primeira compra';
  end if;
  select * into parc from public.contas_a_pagar_parcelas where id = id_parc2;
  if parc.status <> 'Pendente' then
    raise exception 'FALHA 19: desfazer o pagamento não devolveu a parcela da segunda compra';
  end if;
  select * into vinc1 from public.conciliacao_vinculos
    where lancamento_id = 'eeeeeeee-0000-0000-0000-000000000027';
  select * into vinc2 from public.conciliacao_vinculos
    where lancamento_id = 'eeeeeeee-0000-0000-0000-000000000028';
  if vinc1 is null or vinc2 is null then
    raise exception 'FALHA 19: as compras deviam continuar conciliadas — só o pagamento foi desfeito';
  end if;
  if vinc1.baixou_parcela is not false or vinc2.baixou_parcela is not false then
    raise exception 'FALHA 19: baixou_parcela das compras devia voltar a false';
  end if;

  raise notice 'OK 19: "criar e conciliar" numa linha de fatura cria a parcela em aberto, e quem baixa é o pagamento da fatura';
end $$;

-- ================= UMA PARCELA, UM LANÇAMENTO =================
-- Cenário 20: a linha de fatura conciliada deixa a parcela 'Pendente' de
-- propósito — e por isso ela volta a aparecer no pool de sugestões da próxima
-- importação. Sem guarda, um débito do extrato de mesmo valor e data próxima é
-- aceito contra a MESMA obrigação: duas saídas reais contabilizadas contra uma
-- dívida só, os dois lançamentos verdes. O unique de conciliacao_vinculos é
-- (lancamento_id, parcela_id), então ele não impede nada disso.
insert into public.extrato_importacoes (id, empresa_id, conta_bancaria_id, tipo, arquivo_path, formato)
  values ('dddddddd-0000-0000-0000-000000000007', :'empresa',
          'cccccccc-0000-0000-0000-000000000002', 'fatura_cartao', 'p/fatura5.pdf', 'pdf');
insert into public.contas_a_pagar (id, descricao, categoria_conta, fornecedor_id, valor_total, empresa_id)
  values ('ffffffff-0000-0000-0000-000000000008', 'Insumos loja B', 'Custos Variáveis',
          'aaaaaaaa-0000-0000-0000-000000000001', 150.00, :'empresa');
insert into public.contas_a_pagar_parcelas (id, conta_a_pagar_id, numero, valor, vencimento, empresa_id)
  values ('99999999-0000-0000-0000-000000000009', 'ffffffff-0000-0000-0000-000000000008',
          1, 150.00, '2026-08-14', :'empresa');
insert into public.extrato_lancamentos
  (id, importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe)
  values ('eeeeeeee-0000-0000-0000-000000000030', 'dddddddd-0000-0000-0000-000000000007',
          :'empresa', '2026-08-14', 'LOJA B INSUMOS', 'LOJA B INSUMOS', 150.00, 'saida', 'hash-h4'),
         ('eeeeeeee-0000-0000-0000-000000000031', 'dddddddd-0000-0000-0000-000000000001',
          :'empresa', '2026-08-14', 'PIX ENVIADO LOJA B', 'PIX ENVIADO LOJA B', 150.00, 'saida', 'hash-h5');
do $$
declare parc record; lanc record; n int;
begin
  perform public.fn_conciliar_lancamento('eeeeeeee-0000-0000-0000-000000000030',
    '[{"parcela_id":"99999999-0000-0000-0000-000000000009","valor_aplicado":150.00}]'::jsonb,
    'Cartão de Crédito', 'aaaaaaaa-0000-0000-0000-000000000001', 'Custos Variáveis');
  select * into parc from public.contas_a_pagar_parcelas where id = '99999999-0000-0000-0000-000000000009';
  if parc.status <> 'Pendente' then
    raise exception 'FALHA 20: pré-condição quebrou — linha de fatura não devia baixar a parcela (%)', parc.status;
  end if;

  begin
    perform public.fn_conciliar_lancamento('eeeeeeee-0000-0000-0000-000000000031',
      '[{"parcela_id":"99999999-0000-0000-0000-000000000009","valor_aplicado":150.00}]'::jsonb,
      'Pix', 'aaaaaaaa-0000-0000-0000-000000000001', 'Custos Variáveis');
    raise exception 'FALHA 20: a mesma parcela foi conciliada por dois lançamentos diferentes';
  exception when others then
    if sqlerrm like 'FALHA 20%' then raise; end if;
    raise notice 'OK 20a: parcela já vinculada a outro lançamento é recusada (%)', sqlerrm;
  end;

  select count(*) into n from public.conciliacao_vinculos
    where parcela_id = '99999999-0000-0000-0000-000000000009';
  if n <> 1 then raise exception 'FALHA 20: a parcela ficou com % vínculos', n; end if;
  select * into parc from public.contas_a_pagar_parcelas where id = '99999999-0000-0000-0000-000000000009';
  if parc.status <> 'Pendente' then
    raise exception 'FALHA 20: o lançamento recusado baixou a parcela mesmo assim (%)', parc.status;
  end if;
  select * into lanc from public.extrato_lancamentos where id = 'eeeeeeee-0000-0000-0000-000000000031';
  if lanc.status = 'conciliado' then
    raise exception 'FALHA 20: o lançamento recusado ficou conciliado';
  end if;
  raise notice 'OK 20b: a recusa não deixou rastro — nem vínculo a mais, nem baixa, nem lançamento verde';
end $$;

-- ================= DESFAZER A COMPRA COM A FATURA JÁ PAGA =================
-- Cenário 21: desfazer a linha da fatura depois que o pagamento dela já foi
-- conciliado apaga o vínculo e reabre a parcela, mas o lançamento do pagamento
-- continua conciliado — e ele nunca roda de novo. Reconciliar a mesma compra
-- cria um vínculo com baixou_parcela = false, e a parcela fica 'Pendente' para
-- sempre, apesar de a fatura ter sido paga. A ordem certa é desfazer o
-- pagamento primeiro.
insert into public.extrato_importacoes (id, empresa_id, conta_bancaria_id, tipo, arquivo_path, formato)
  values ('dddddddd-0000-0000-0000-000000000008', :'empresa',
          'cccccccc-0000-0000-0000-000000000002', 'fatura_cartao', 'p/fatura6.pdf', 'pdf');
insert into public.contas_a_pagar (id, descricao, categoria_conta, fornecedor_id, valor_total, empresa_id)
  values ('ffffffff-0000-0000-0000-000000000009', 'Insumos loja C', 'Custos Variáveis',
          'aaaaaaaa-0000-0000-0000-000000000001', 90.00, :'empresa');
insert into public.contas_a_pagar_parcelas (id, conta_a_pagar_id, numero, valor, vencimento, empresa_id)
  values ('99999999-0000-0000-0000-00000000000a', 'ffffffff-0000-0000-0000-000000000009',
          1, 90.00, '2026-08-16', :'empresa');
insert into public.extrato_lancamentos
  (id, importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe)
  values ('eeeeeeee-0000-0000-0000-000000000032', 'dddddddd-0000-0000-0000-000000000008',
          :'empresa', '2026-08-16', 'LOJA C INSUMOS', 'LOJA C INSUMOS', 90.00, 'saida', 'hash-h6'),
         ('eeeeeeee-0000-0000-0000-000000000033', 'dddddddd-0000-0000-0000-000000000001',
          :'empresa', '2026-09-06', 'PAGAMENTO FATURA CARTAO', 'PAGAMENTO FATURA CARTAO 5',
          90.00, 'saida', 'hash-h7');
do $$
declare parc record; lanc record;
begin
  perform public.fn_conciliar_lancamento('eeeeeeee-0000-0000-0000-000000000032',
    '[{"parcela_id":"99999999-0000-0000-0000-00000000000a","valor_aplicado":90.00}]'::jsonb,
    'Cartão de Crédito', 'aaaaaaaa-0000-0000-0000-000000000001', 'Custos Variáveis');
  perform public.fn_conciliar_pagamento_fatura('eeeeeeee-0000-0000-0000-000000000033',
    'dddddddd-0000-0000-0000-000000000008', false);

  begin
    perform public.fn_desfazer_conciliacao('eeeeeeee-0000-0000-0000-000000000032');
    raise exception 'FALHA 21: desfez a compra com o pagamento da fatura ainda conciliado';
  exception when others then
    if sqlerrm like 'FALHA 21%' then raise; end if;
    raise notice 'OK 21a: desfazer a compra é recusado enquanto o pagamento da fatura está conciliado (%)', sqlerrm;
  end;

  select * into parc from public.contas_a_pagar_parcelas where id = '99999999-0000-0000-0000-00000000000a';
  if parc.status <> 'Pago' then
    raise exception 'FALHA 21: a recusa deixou a parcela reaberta (%)', parc.status;
  end if;

  -- controle: desfeito o pagamento, a compra volta a poder ser desfeita
  perform public.fn_desfazer_conciliacao('eeeeeeee-0000-0000-0000-000000000033');
  perform public.fn_desfazer_conciliacao('eeeeeeee-0000-0000-0000-000000000032');
  select * into lanc from public.extrato_lancamentos where id = 'eeeeeeee-0000-0000-0000-000000000032';
  if lanc.status = 'conciliado' then
    raise exception 'FALHA 21: a compra devia poder ser desfeita depois do pagamento';
  end if;
  if exists (select 1 from public.conciliacao_vinculos
             where lancamento_id = 'eeeeeeee-0000-0000-0000-000000000032') then
    raise exception 'FALHA 21: vínculo da compra sobreviveu ao desfazer';
  end if;
  select * into parc from public.contas_a_pagar_parcelas where id = '99999999-0000-0000-0000-00000000000a';
  if parc.status <> 'Pendente' then
    raise exception 'FALHA 21: parcela devia voltar a Pendente (%)', parc.status;
  end if;
  raise notice 'OK 21b: desfeito o pagamento, a compra volta a poder ser desfeita normalmente';
end $$;

-- ================= FATURA PAGA DUAS VEZES / PAGAMENTO QUE NÃO BAIXA NADA ====
-- Cenário 22: a segunda saída associada à MESMA fatura não baixava nada
-- (todas as parcelas já estavam 'Pago'), devolvia baixadas = 0 — que a tela
-- anunciava como "0 parcela(s) baixada(s)" — e ainda assim ficava conciliada:
-- uma saída real do banco contabilizada contra nada. Duas guardas: fatura já
-- paga é recusada, e baixar zero parcela é erro, nunca sucesso.
insert into public.extrato_importacoes (id, empresa_id, conta_bancaria_id, tipo, arquivo_path, formato)
  values ('dddddddd-0000-0000-0000-000000000009', :'empresa',
          'cccccccc-0000-0000-0000-000000000002', 'fatura_cartao', 'p/fatura7.pdf', 'pdf');
insert into public.contas_a_pagar (id, descricao, categoria_conta, fornecedor_id, valor_total, empresa_id)
  values ('ffffffff-0000-0000-0000-00000000000a', 'Insumos loja D', 'Custos Variáveis',
          'aaaaaaaa-0000-0000-0000-000000000001', 70.00, :'empresa');
insert into public.contas_a_pagar_parcelas (id, conta_a_pagar_id, numero, valor, vencimento, empresa_id)
  values ('99999999-0000-0000-0000-00000000000b', 'ffffffff-0000-0000-0000-00000000000a',
          1, 70.00, '2026-08-18', :'empresa');
insert into public.extrato_lancamentos
  (id, importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe)
  values ('eeeeeeee-0000-0000-0000-000000000034', 'dddddddd-0000-0000-0000-000000000009',
          :'empresa', '2026-08-18', 'LOJA D INSUMOS', 'LOJA D INSUMOS', 70.00, 'saida', 'hash-h8'),
         ('eeeeeeee-0000-0000-0000-000000000035', 'dddddddd-0000-0000-0000-000000000001',
          :'empresa', '2026-09-07', 'PAGAMENTO FATURA CARTAO', 'PAGAMENTO FATURA CARTAO 6',
          70.00, 'saida', 'hash-h9'),
         ('eeeeeeee-0000-0000-0000-000000000036', 'dddddddd-0000-0000-0000-000000000001',
          :'empresa', '2026-09-08', 'PAGAMENTO FATURA CARTAO', 'PAGAMENTO FATURA CARTAO 7',
          70.00, 'saida', 'hash-h10');
do $$
declare lanc record; parc record;
begin
  perform public.fn_conciliar_lancamento('eeeeeeee-0000-0000-0000-000000000034',
    '[{"parcela_id":"99999999-0000-0000-0000-00000000000b","valor_aplicado":70.00}]'::jsonb,
    'Cartão de Crédito', 'aaaaaaaa-0000-0000-0000-000000000001', 'Custos Variáveis');
  perform public.fn_conciliar_pagamento_fatura('eeeeeeee-0000-0000-0000-000000000035',
    'dddddddd-0000-0000-0000-000000000009', false);

  begin
    perform public.fn_conciliar_pagamento_fatura('eeeeeeee-0000-0000-0000-000000000036',
      'dddddddd-0000-0000-0000-000000000009', false);
    raise exception 'FALHA 22: a mesma fatura foi paga duas vezes';
  exception when others then
    if sqlerrm like 'FALHA 22%' then raise; end if;
    raise notice 'OK 22a: fatura que já teve o pagamento conciliado recusa um segundo pagamento (%)', sqlerrm;
  end;

  select * into lanc from public.extrato_lancamentos where id = 'eeeeeeee-0000-0000-0000-000000000036';
  if lanc.status = 'conciliado' or lanc.fatura_id is not null then
    raise exception 'FALHA 22: o segundo pagamento ficou conciliado mesmo recusado (status=%, fatura_id=%)',
      lanc.status, lanc.fatura_id;
  end if;
  select * into parc from public.contas_a_pagar_parcelas where id = '99999999-0000-0000-0000-00000000000b';
  if parc.data_pagamento <> '2026-09-07' then
    raise exception 'FALHA 22: o segundo pagamento mexeu na baixa feita pelo primeiro (%)', parc.data_pagamento;
  end if;
end $$;

-- 22b: fatura cuja única linha foi conciliada contra parcela que já estava
-- paga por fora. O pagamento não tem o que baixar — antes isso devolvia
-- baixadas = 0 e conciliava assim mesmo.
insert into public.extrato_importacoes (id, empresa_id, conta_bancaria_id, tipo, arquivo_path, formato)
  values ('dddddddd-0000-0000-0000-00000000000a', :'empresa',
          'cccccccc-0000-0000-0000-000000000002', 'fatura_cartao', 'p/fatura8.pdf', 'pdf');
insert into public.contas_a_pagar (id, descricao, categoria_conta, fornecedor_id, valor_total, empresa_id)
  values ('ffffffff-0000-0000-0000-00000000000b', 'Insumos loja E', 'Custos Variáveis',
          'aaaaaaaa-0000-0000-0000-000000000001', 65.00, :'empresa');
insert into public.contas_a_pagar_parcelas
  (id, conta_a_pagar_id, numero, valor, vencimento, status, data_pagamento, forma_pagamento, empresa_id)
  values ('99999999-0000-0000-0000-00000000000c', 'ffffffff-0000-0000-0000-00000000000b',
          1, 65.00, '2026-08-19', 'Pago', '2026-07-28', 'Dinheiro', :'empresa');
insert into public.extrato_lancamentos
  (id, importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe)
  values ('eeeeeeee-0000-0000-0000-000000000037', 'dddddddd-0000-0000-0000-00000000000a',
          :'empresa', '2026-08-19', 'LOJA E INSUMOS', 'LOJA E INSUMOS', 65.00, 'saida', 'hash-h11'),
         ('eeeeeeee-0000-0000-0000-000000000038', 'dddddddd-0000-0000-0000-000000000001',
          :'empresa', '2026-09-09', 'PAGAMENTO FATURA CARTAO', 'PAGAMENTO FATURA CARTAO 8',
          65.00, 'saida', 'hash-h12');
do $$
declare lanc record; parc record;
begin
  perform public.fn_conciliar_lancamento('eeeeeeee-0000-0000-0000-000000000037',
    '[{"parcela_id":"99999999-0000-0000-0000-00000000000c","valor_aplicado":65.00}]'::jsonb,
    'Cartão de Crédito', 'aaaaaaaa-0000-0000-0000-000000000001', 'Custos Variáveis');
  begin
    perform public.fn_conciliar_pagamento_fatura('eeeeeeee-0000-0000-0000-000000000038',
      'dddddddd-0000-0000-0000-00000000000a', false);
    raise exception 'FALHA 22: pagamento de fatura que não baixou nenhuma parcela passou como sucesso';
  exception when others then
    if sqlerrm like 'FALHA 22%' then raise; end if;
    raise notice 'OK 22b: pagamento que não baixaria nenhuma parcela é erro, não sucesso silencioso (%)', sqlerrm;
  end;

  select * into lanc from public.extrato_lancamentos where id = 'eeeeeeee-0000-0000-0000-000000000038';
  if lanc.status = 'conciliado' then
    raise exception 'FALHA 22: pagamento sem baixa nenhuma ficou conciliado';
  end if;
  select * into parc from public.contas_a_pagar_parcelas where id = '99999999-0000-0000-0000-00000000000c';
  if parc.data_pagamento <> '2026-07-28' or parc.forma_pagamento <> 'Dinheiro' then
    raise exception 'FALHA 22: a recusa pisou na baixa que já existia (data=%, forma=%)',
      parc.data_pagamento, parc.forma_pagamento;
  end if;
end $$;

-- ================= CONTADOR DA IMPORTAÇÃO =================
-- Cenário 23: conciliados/total_lancamentos é lido na tela como "quanto falta".
-- conciliados só conta saídas; total_lancamentos contava TODAS as linhas, então
-- um extrato com entradas nunca chegava a 1/1 — um extrato inteiramente
-- conciliado exibia "1/3" ao lado da tag verde "Conciliada". As duas pontas da
-- razão têm que contar a mesma população.
insert into public.extrato_importacoes (id, empresa_id, conta_bancaria_id, tipo, arquivo_path, formato)
  values ('dddddddd-0000-0000-0000-00000000000b', :'empresa',
          'cccccccc-0000-0000-0000-000000000001', 'extrato', 'p/3.ofx', 'ofx');
insert into public.extrato_lancamentos
  (id, importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe, status)
  values ('eeeeeeee-0000-0000-0000-000000000039', 'dddddddd-0000-0000-0000-00000000000b',
          :'empresa', '2026-08-26', 'TARIFA CESTA BASICA', 'TARIFA CESTA BASICA',
          32.00, 'saida', 'hash-i1', 'pendente'),
         ('eeeeeeee-0000-0000-0000-000000000040', 'dddddddd-0000-0000-0000-00000000000b',
          :'empresa', '2026-08-26', 'PIX RECEBIDO CLIENTE A', 'PIX RECEBIDO CLIENTE A',
          500.00, 'entrada', 'hash-i2', 'ignorado'),
         ('eeeeeeee-0000-0000-0000-000000000041', 'dddddddd-0000-0000-0000-00000000000b',
          :'empresa', '2026-08-27', 'PIX RECEBIDO CLIENTE B', 'PIX RECEBIDO CLIENTE B',
          300.00, 'entrada', 'hash-i3', 'ignorado');
do $$
declare imp record;
begin
  perform public.fn_recalcular_importacao('dddddddd-0000-0000-0000-00000000000b');
  select * into imp from public.extrato_importacoes where id = 'dddddddd-0000-0000-0000-00000000000b';
  if imp.total_lancamentos <> 1 then
    raise exception 'FALHA 23: total_lancamentos devia contar só as saídas (1), veio %', imp.total_lancamentos;
  end if;
  if imp.conciliados <> 0 or imp.status <> 'aguardando_conciliacao' then
    raise exception 'FALHA 23: importação com saída aberta devia ficar aguardando (conciliados=%, status=%)',
      imp.conciliados, imp.status;
  end if;

  perform public.fn_criar_conta_e_conciliar('eeeeeeee-0000-0000-0000-000000000039',
    'Tarifa cesta básica', 'Custos Fixos', 'aaaaaaaa-0000-0000-0000-000000000001',
    null, 'Débito Automático');
  select * into imp from public.extrato_importacoes where id = 'dddddddd-0000-0000-0000-00000000000b';
  if imp.conciliados <> imp.total_lancamentos then
    raise exception 'FALHA 23: extrato inteiramente conciliado exibiria %/%', imp.conciliados, imp.total_lancamentos;
  end if;
  if imp.status <> 'concluida' then
    raise exception 'FALHA 23: status devia ser concluida, veio %', imp.status;
  end if;
  raise notice 'OK 23: o contador da importação compara saídas com saídas e fecha em %/%',
    imp.conciliados, imp.total_lancamentos;
end $$;
