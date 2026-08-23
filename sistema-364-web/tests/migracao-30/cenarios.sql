-- Exercita a atualização 30. Roda depois do fixture e da migração.
--
-- Cada asserção negativa é ancorada no SQLSTATE que a trava emite —
-- `check_violation` para as travas de trigger, `unique_violation` para a
-- unicidade do número da ficha, `raise_exception` para a RPC — e nunca em
-- `when others` casando pedaço de texto. Na revisão da 29 esse padrão produziu
-- quatro falsos verdes: a mensagem do próprio `raise exception 'FALHA ...'`
-- continha as mesmas palavras que a trava, então o `when others` engolia a
-- asserção junto com o erro de verdade.
--
-- Nos cenários da RPC, cujas mensagens saem no mesmo SQLSTATE P0001
-- (`raise_exception`) do `raise exception 'FALHA ...'`, a asserção fica FORA do
-- bloco `exception`: o bloco só marca uma flag e o FALHA é levantado depois.
\set QUIET on
set client_min_messages = warning;
begin;

-- Cenário 1: a ficha de embalagem legada sobreviveu e ganhou status padrão.
do $$
declare v_status text; v_itens int;
begin
  select status into v_status from embalagens where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  if v_status is distinct from 'rascunho' then
    raise exception 'FALHA 1a: ficha legada ficou com status %', v_status;
  end if;
  select count(*) into v_itens from embalagem_itens where embalagem_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  if v_itens <> 1 then
    raise exception 'FALHA 1b: item da ficha legada sumiu (achou % linhas)', v_itens;
  end if;
  raise notice 'OK 1: ficha legada preservada e em rascunho';
end $$;

-- Cenário 2: A MINA DESARMADA. Inserir item numa ficha em rascunho funciona.
-- Com a versão antiga do trigger — `after insert on embalagem_itens`, lendo
-- `recebimento_itens.status_recebimento` — este insert estouraria 42703
-- (undefined_column), porque a coluna não existe mais desde a atualização 09.
-- Nenhum `exception` aqui de propósito: se a mina continuar armada, o erro
-- sobe e derruba o script.
do $$
declare v_ficha uuid;
begin
  insert into embalagens (lote, data, responsavel_id, sobra_kg, empresa_id)
    values ('EMB-260822-001', current_date, '22222222-2222-2222-2222-222222222222', 1.5,
            '11111111-1111-1111-1111-111111111111')
    returning id into v_ficha;

  -- Produto A, do LOTE A (custo 21,90/kg, rendimento 0,45): 18 kg embalados.
  insert into embalagem_itens (embalagem_id, produto_id, recebimento_item_id, quantidade, peso_total_kg, validade, empresa_id)
    values (v_ficha, '44444444-4444-4444-4444-444444444444', '66666666-6666-6666-6666-666666666666',
            40, 18, date '2026-12-20', '11111111-1111-1111-1111-111111111111');
  -- Mesmo produto, LOTE C (custo 30,00/kg, rendimento 0,60): 5,4 kg. Dois lotes
  -- de custos e rendimentos diferentes no MESMO produto — é o que prova que a
  -- conta é item a item, não média da ficha.
  insert into embalagem_itens (embalagem_id, produto_id, recebimento_item_id, quantidade, peso_total_kg, validade, empresa_id)
    values (v_ficha, '44444444-4444-4444-4444-444444444444', '68686868-6868-6868-6868-686868686868',
            10, 5.4, date '2026-12-19', '11111111-1111-1111-1111-111111111111');
  -- Produto B, lote A, com validade.
  insert into embalagem_itens (embalagem_id, produto_id, recebimento_item_id, quantidade, peso_total_kg, validade, empresa_id)
    values (v_ficha, 'dddddddd-dddd-dddd-dddd-dddddddddddd', '66666666-6666-6666-6666-666666666666',
            12, 11.7, date '2026-12-20', '11111111-1111-1111-1111-111111111111');
  -- Produto B de novo, SEM validade: a linha de estoque do produto B não pode
  -- prometer prazo que estas 3 unidades não têm.
  insert into embalagem_itens (embalagem_id, produto_id, recebimento_item_id, quantidade, peso_total_kg, empresa_id)
    values (v_ficha, 'dddddddd-dddd-dddd-dddd-dddddddddddd', '66666666-6666-6666-6666-666666666666',
            3, 1.35, '11111111-1111-1111-1111-111111111111');

  raise notice 'OK 2: item entra em ficha de rascunho — o trigger que lia a coluna morta saiu';
end $$;

-- Cenário 3: item em rascunho NÃO gera estoque. O trigger antigo criava a
-- linha de `producoes` a cada item; estoque de produto acabado não pode nascer
-- de rascunho, que ainda pode ser cancelado.
do $$
declare v_ficha uuid; v_linhas int; v_total int;
begin
  select id into v_ficha from embalagens where lote = 'EMB-260822-001'
    and empresa_id = '11111111-1111-1111-1111-111111111111';
  select count(*) into v_linhas from producoes where embalagem_id = v_ficha;
  if v_linhas <> 0 then
    raise exception 'FALHA 3a: rascunho já gerou % linha(s) em producoes', v_linhas;
  end if;
  -- Nem por fora da coluna nova: o trigger antigo gravava sem `embalagem_id`.
  select count(*) into v_total from producoes where empresa_id = '11111111-1111-1111-1111-111111111111';
  if v_total <> 1 then
    raise exception 'FALHA 3b: producoes deveria ter só a linha legada do fixture (achou %)', v_total;
  end if;
  raise notice 'OK 3: item em rascunho não gera producoes';
end $$;

-- Cenário 4: finalizar a ficha gera as linhas de `producoes` — uma por
-- PRODUTO (os dois itens do produto A viram uma linha só), com `embalagem_id`,
-- `origem = 'embalagem'` e o lote da ficha.
--
-- E o centro do cenário: o CUSTO. Ele vem do lote de origem de cada item, com o
-- rendimento real da defumação daquele lote:
--
--   produto A = 18 kg ÷ 0,45 × R$ 21,90  (lote A)   =  R$   876,00
--             +  5,4 kg ÷ 0,60 × R$ 30,00 (lote C)  =  R$   270,00
--                                                     ------------
--                                                      R$ 1.146,00
--   produto B = 11,7 kg ÷ 0,45 × R$ 21,90            =  R$   569,40
--             +  1,35 kg ÷ 0,45 × R$ 21,90           =  R$    65,70
--                                                     ------------
--                                                      R$   635,10
--
-- Os números do fixture foram escolhidos para que cada fórmula errada dê um
-- resultado diferente destes:
--   • `peso × custo` (sem o rendimento):        A = R$ 556,20
--   • `unidades × ficha_tecnica × custo`:       A = R$ 660,60
--   • rendimento só da primeira fornada (0,50): A = R$ 1.058,40
--   • rendimento contando o rascunho (0,505):   A = R$ 1.050,58
--   • média das matérias-primas da ficha técnica (com o tempero a R$ 80/kg):
--     qualquer coisa menos R$ 1.146,00
do $$
declare
  v_ficha uuid; v_linhas int;
  v_qtd numeric; v_custo numeric; v_validade date; v_lote text; v_origem text;
  v_peso numeric; v_resp uuid;
  v_outra uuid;
begin
  select id into v_ficha from embalagens where lote = 'EMB-260822-001'
    and empresa_id = '11111111-1111-1111-1111-111111111111';

  -- ---- As recusas: nada de estoque com custo adivinhado ----

  -- 4a: ficha sem nenhum produto lançado não finaliza (mesma regra da 29).
  insert into embalagens (lote, empresa_id)
    values ('EMB-260822-900', '11111111-1111-1111-1111-111111111111') returning id into v_outra;
  begin
    update embalagens set status = 'finalizada' where id = v_outra;
    raise exception 'FALHA 4a: ficha sem item foi finalizada';
  exception when check_violation then null; end;

  -- 4b: item de lote REPROVADO na inspeção não vira produto acabado.
  insert into embalagens (lote, empresa_id)
    values ('EMB-260822-901', '11111111-1111-1111-1111-111111111111') returning id into v_outra;
  insert into embalagem_itens (embalagem_id, produto_id, recebimento_item_id, quantidade, peso_total_kg, validade, empresa_id)
    values (v_outra, '44444444-4444-4444-4444-444444444444', '67676767-6767-6767-6767-676767676767',
            5, 2, date '2026-12-20', '11111111-1111-1111-1111-111111111111');
  begin
    update embalagens set status = 'finalizada' where id = v_outra;
    raise exception 'FALHA 4b: ficha com lote reprovado na inspeção foi finalizada';
  exception when check_violation then null; end;

  -- 4c: lote sem defumação FINALIZADA não tem rendimento — sem rendimento o
  -- custo sairia errado (ou dividiria por zero), então recusa.
  insert into embalagens (lote, empresa_id)
    values ('EMB-260822-902', '11111111-1111-1111-1111-111111111111') returning id into v_outra;
  insert into embalagem_itens (embalagem_id, produto_id, recebimento_item_id, quantidade, peso_total_kg, validade, empresa_id)
    values (v_outra, '44444444-4444-4444-4444-444444444444', '69696969-6969-6969-6969-696969696969',
            5, 2, date '2026-12-20', '11111111-1111-1111-1111-111111111111');
  begin
    update embalagens set status = 'finalizada' where id = v_outra;
    raise exception 'FALHA 4c: ficha de lote sem defumação finalizada foi finalizada';
  exception when check_violation then null; end;

  -- 4d: item sem lote de origem — é o caminho definido para a ficha legada e
  -- para o item lançado sem lote. Não finaliza.
  insert into embalagens (lote, empresa_id)
    values ('EMB-260822-903', '11111111-1111-1111-1111-111111111111') returning id into v_outra;
  insert into embalagem_itens (embalagem_id, produto_id, quantidade, peso_total_kg, validade, empresa_id)
    values (v_outra, '44444444-4444-4444-4444-444444444444', 5, 2, date '2026-12-20',
            '11111111-1111-1111-1111-111111111111');
  begin
    update embalagens set status = 'finalizada' where id = v_outra;
    raise exception 'FALHA 4d: ficha com item sem lote de origem foi finalizada';
  exception when check_violation then null; end;

  -- 4e: item sem peso embalado. Custo zero silencioso é pior que recusa.
  insert into embalagens (lote, empresa_id)
    values ('EMB-260822-904', '11111111-1111-1111-1111-111111111111') returning id into v_outra;
  insert into embalagem_itens (embalagem_id, produto_id, recebimento_item_id, quantidade, validade, empresa_id)
    values (v_outra, '44444444-4444-4444-4444-444444444444', '66666666-6666-6666-6666-666666666666',
            5, date '2026-12-20', '11111111-1111-1111-1111-111111111111');
  begin
    update embalagens set status = 'finalizada' where id = v_outra;
    raise exception 'FALHA 4e: ficha com item sem peso foi finalizada';
  exception when check_violation then null; end;

  -- ---- E o caminho feliz ----
  update embalagens set status = 'finalizada' where id = v_ficha;

  select count(*) into v_linhas from producoes where embalagem_id = v_ficha;
  if v_linhas <> 2 then
    raise exception 'FALHA 4f: esperava 2 linhas em producoes (uma por produto), achou %', v_linhas;
  end if;

  select quantidade, custo_total, validade, lote, origem, peso_final_kg, responsavel_id
    into v_qtd, v_custo, v_validade, v_lote, v_origem, v_peso, v_resp
    from producoes where embalagem_id = v_ficha
      and produto_id = '44444444-4444-4444-4444-444444444444';
  if v_qtd <> 50 then
    raise exception 'FALHA 4g: os dois itens do produto A deveriam somar 50 unidades, achou %', v_qtd;
  end if;
  if v_custo <> 1146.00 then
    raise exception 'FALHA 4h: custo do produto A deveria ser 1146,00 (lote a lote, com rendimento), achou %', v_custo;
  end if;
  if v_validade <> date '2026-12-19' then
    raise exception 'FALHA 4i: a validade da linha deveria ser a mais curta dos itens, achou %', v_validade;
  end if;
  if v_lote <> 'EMB-260822-001' then
    raise exception 'FALHA 4j: a produção deveria levar o número da ficha, achou %', v_lote;
  end if;
  if v_origem <> 'embalagem' then
    raise exception 'FALHA 4k: origem deveria ser embalagem, achou %', v_origem;
  end if;
  -- As duas colunas que a linha de estoque herda da ficha e dos itens. Sem
  -- estas asserções, tirá-las do insert não derrubaria cenário nenhum.
  if v_peso <> 23.4 then
    raise exception 'FALHA 4l: peso_final_kg deveria ser o peso embalado (23,4), achou %', v_peso;
  end if;
  if v_resp is distinct from '22222222-2222-2222-2222-222222222222' then
    raise exception 'FALHA 4m: a produção deveria herdar o responsável da ficha, achou %', v_resp;
  end if;

  select quantidade, custo_total, validade into v_qtd, v_custo, v_validade
    from producoes where embalagem_id = v_ficha
      and produto_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  if v_qtd <> 15 or v_custo <> 635.10 then
    raise exception 'FALHA 4n: linha do produto B saiu com quantidade % e custo %', v_qtd, v_custo;
  end if;
  -- Um dos itens do produto B entrou sem validade: a linha não pode prometer
  -- prazo para unidades que não têm. `min` sozinho ignoraria o nulo.
  if v_validade is not null then
    raise exception 'FALHA 4o: produto B tem item sem validade — a linha não podia prometer % ', v_validade;
  end if;

  -- 4p: rendimento de lote cuja defumação foi FINALIZADA com item sem peso
  -- defumado informado — caminho que a atualização 29 permite de propósito (a
  -- tela da Fase 2 avisa e pede confirmação). O item não pesado tem que ficar
  -- fora dos DOIS lados da fração: o lote E tem uma fornada 100 → 45 e outra de
  -- 60 kg brutos sem peso final.
  --   certo  = 45 ÷ 100 = 0,45  →  9 kg ÷ 0,45 × R$ 20,00 = R$ 400,00
  --   errado = 45 ÷ 160 = 0,28125 →  9 kg ÷ 0,28125 × R$ 20,00 = R$ 640,00
  -- É a mesma regra de `rendimentoDaFicha` em lib/defumacao.js.
  insert into embalagens (lote, data, empresa_id)
    values ('EMB-260822-905', current_date, '11111111-1111-1111-1111-111111111111') returning id into v_outra;
  insert into embalagem_itens (embalagem_id, produto_id, recebimento_item_id, quantidade, peso_total_kg, validade, empresa_id)
    values (v_outra, '44444444-4444-4444-4444-444444444444', '6b6b6b6b-6b6b-6b6b-6b6b-6b6b6b6b6b6b',
            20, 9, date '2026-12-20', '11111111-1111-1111-1111-111111111111');
  update embalagens set status = 'finalizada' where id = v_outra;

  select custo_total into v_custo from producoes where embalagem_id = v_outra;
  if v_custo <> 400.00 then
    raise exception 'FALHA 4p: a fornada finalizada sem peso defumado inflou o custo — esperava 400,00, achou %', v_custo;
  end if;

  raise notice 'OK 4: finalizar gera uma producao por produto, custeada lote a lote pelo rendimento';
end $$;

-- Cenário 5: cancelar a ficha finalizada, com motivo, apaga EXATAMENTE as
-- linhas daquela ficha. Nem a ficha vizinha nem a linha legada de `producoes`
-- (origem = 'embalagem', sem `embalagem_id`, do tempo do trigger antigo) podem
-- ser tocadas — é por isso que o vínculo é por `embalagem_id` e não por
-- heurística de data + produto.
do $$
declare v_ficha uuid; v_vizinha uuid; v_linhas int; v_legadas int; v_cancelada_em timestamptz;
begin
  select id into v_ficha from embalagens where lote = 'EMB-260822-001'
    and empresa_id = '11111111-1111-1111-1111-111111111111';

  insert into embalagens (lote, data, empresa_id)
    values ('EMB-260822-002', current_date, '11111111-1111-1111-1111-111111111111')
    returning id into v_vizinha;
  insert into embalagem_itens (embalagem_id, produto_id, recebimento_item_id, quantidade, peso_total_kg, validade, empresa_id)
    values (v_vizinha, '44444444-4444-4444-4444-444444444444', '66666666-6666-6666-6666-666666666666',
            8, 4.5, date '2026-12-21', '11111111-1111-1111-1111-111111111111');
  update embalagens set status = 'finalizada' where id = v_vizinha;

  -- Cancelar sem motivo é recusado.
  begin
    update embalagens set status = 'cancelada' where id = v_ficha;
    raise exception 'FALHA 5a: cancelou ficha de embalagem sem motivo';
  exception when check_violation then null; end;

  -- A data do cancelamento vem do relógio do banco: manda 2001 de propósito e
  -- prova que foi substituída. Omitir o campo e conferir "not null" deixaria o
  -- cenário verde mesmo sem o carimbo — bastaria o cliente mandar qualquer
  -- valor.
  update embalagens set status = 'cancelada', cancelada_motivo = 'Peso lançado errado na balança',
    cancelada_em = '2001-01-01 00:00:00+00', cancelada_por_id = '22222222-2222-2222-2222-222222222222'
    where id = v_ficha;

  select cancelada_em into v_cancelada_em from embalagens where id = v_ficha;
  if v_cancelada_em is null or v_cancelada_em < now() - interval '1 minute' then
    raise exception 'FALHA 5b: cancelada_em não veio do relógio do banco (achou %)', v_cancelada_em;
  end if;

  select count(*) into v_linhas from producoes where embalagem_id = v_ficha;
  if v_linhas <> 0 then
    raise exception 'FALHA 5c: cancelar a ficha deixou % linha(s) de estoque para trás', v_linhas;
  end if;

  select count(*) into v_linhas from producoes where embalagem_id = v_vizinha;
  if v_linhas <> 1 then
    raise exception 'FALHA 5d: o cancelamento encostou na ficha vizinha (sobrou % linha)', v_linhas;
  end if;

  select count(*) into v_legadas from producoes
    where origem = 'embalagem' and embalagem_id is null;
  if v_legadas <> 1 then
    raise exception 'FALHA 5e: o cancelamento apagou a producao legada sem embalagem_id (sobrou %)', v_legadas;
  end if;

  raise notice 'OK 5: cancelar apaga só o estoque daquela ficha';
end $$;

-- Cenário 6: ficha fora de rascunho é imutável — cabeçalho, status, e os itens
-- (alterar, inserir e apagar direto, sem ser cascata do cabeçalho). De
-- `finalizada` só se sai para `cancelada`; de `cancelada` não se sai.
do $$
declare v_ficha uuid; v_item uuid; v_cancelada uuid;
begin
  select id into v_ficha from embalagens where lote = 'EMB-260822-002'
    and empresa_id = '11111111-1111-1111-1111-111111111111';
  select id into v_item from embalagem_itens where embalagem_id = v_ficha limit 1;
  select id into v_cancelada from embalagens where lote = 'EMB-260822-001'
    and empresa_id = '11111111-1111-1111-1111-111111111111';

  begin
    update embalagens set obs = 'reaproveitado' where id = v_ficha;
    raise exception 'FALHA 6a: observação de ficha finalizada mudou';
  exception when check_violation then null; end;

  begin
    update embalagens set lote = 'EMB-260822-777' where id = v_ficha;
    raise exception 'FALHA 6b: número da ficha finalizada mudou';
  exception when check_violation then null; end;

  begin
    update embalagens set sobra_kg = 9 where id = v_ficha;
    raise exception 'FALHA 6c: sobra de ficha finalizada mudou';
  exception when check_violation then null; end;

  begin
    update embalagens set empresa_id = '99999999-9999-9999-9999-999999999999' where id = v_ficha;
    raise exception 'FALHA 6d: empresa da ficha finalizada mudou';
  exception when check_violation then null; end;

  begin
    update embalagens set status = 'rascunho' where id = v_ficha;
    raise exception 'FALHA 6e: ficha finalizada voltou para rascunho';
  exception when check_violation then null; end;

  begin
    update embalagem_itens set peso_total_kg = 99 where id = v_item;
    raise exception 'FALHA 6f: item de ficha finalizada mudou';
  exception when check_violation then null; end;

  begin
    insert into embalagem_itens (embalagem_id, produto_id, quantidade, peso_total_kg, empresa_id)
      values (v_ficha, '44444444-4444-4444-4444-444444444444', 1, 1, '11111111-1111-1111-1111-111111111111');
    raise exception 'FALHA 6g: item novo entrou em ficha finalizada';
  exception when check_violation then null; end;

  begin
    delete from embalagem_itens where id = v_item;
    raise exception 'FALHA 6h: item de ficha finalizada foi apagado direto';
  exception when check_violation then null; end;

  begin
    update embalagens set status = 'rascunho' where id = v_cancelada;
    raise exception 'FALHA 6i: ficha cancelada voltou para rascunho';
  exception when check_violation then null; end;

  begin
    update embalagens set cancelada_motivo = 'motivo reescrito depois' where id = v_cancelada;
    raise exception 'FALHA 6j: motivo de ficha já cancelada foi reescrito';
  exception when check_violation then null; end;

  raise notice 'OK 6: ficha fora de rascunho é imutável em cabeçalho, status e itens';
end $$;

-- Cenário 7: apagar ficha finalizada é recusado — cancele com motivo, não
-- apague. Ficha em RASCUNHO continua apagável, levando os itens em cascata.
--
-- Este cenário só é discriminante porque a trava do ITEM compara com
-- `is distinct from`: se o `if not found` que detecta a cascata sumisse,
-- `v_status` ficaria nulo, `null is distinct from 'rascunho'` daria verdadeiro
-- e a exceção derrubaria o delete. Com `<>`, a mesma remoção passaria batido
-- (`null <> texto` é nulo, não verdadeiro) e o cenário seguiria verde quebrado.
do $$
declare v_finalizada uuid; v_rascunho uuid; v_sobrou int;
begin
  select id into v_finalizada from embalagens where lote = 'EMB-260822-002'
    and empresa_id = '11111111-1111-1111-1111-111111111111';
  begin
    delete from embalagens where id = v_finalizada;
    raise exception 'FALHA 7a: ficha finalizada foi apagada';
  exception when check_violation then null; end;

  insert into embalagens (lote, empresa_id) values ('EMB-260822-701', '11111111-1111-1111-1111-111111111111')
    returning id into v_rascunho;
  insert into embalagem_itens (embalagem_id, produto_id, quantidade, peso_total_kg, empresa_id)
    values (v_rascunho, '44444444-4444-4444-4444-444444444444', 5, 2.5, '11111111-1111-1111-1111-111111111111');
  delete from embalagens where id = v_rascunho;

  select count(*) into v_sobrou from embalagem_itens where embalagem_id = v_rascunho;
  if v_sobrou <> 0 then
    raise exception 'FALHA 7b: a cascata não levou os itens da ficha em rascunho (sobrou %)', v_sobrou;
  end if;

  raise notice 'OK 7: finalizada não apaga, rascunho apaga em cascata';
end $$;

-- Cenário 8: isolamento multiempresa dos itens. Sem isso, um item gravado com
-- empresa errada fica invisível para a tela da empresa dona (o filtro
-- `.eq('empresa_id', eid)` nunca alcança ele) e o mesmo peso defumado pode ser
-- embalado duas vezes, uma por empresa.
do $$
declare v_ficha uuid;
begin
  insert into embalagens (lote, empresa_id) values ('EMB-260822-801', '11111111-1111-1111-1111-111111111111')
    returning id into v_ficha;

  begin
    insert into embalagem_itens (embalagem_id, produto_id, quantidade, peso_total_kg, empresa_id)
      values (v_ficha, '44444444-4444-4444-4444-444444444444', 5, 2.5, '99999999-9999-9999-9999-999999999999');
    raise exception 'FALHA 8a: item com empresa diferente da ficha pai foi aceito';
  exception when check_violation then null; end;

  begin
    insert into embalagem_itens (embalagem_id, produto_id, recebimento_item_id, quantidade, peso_total_kg, empresa_id)
      values (v_ficha, '44444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
              5, 2.5, '11111111-1111-1111-1111-111111111111');
    raise exception 'FALHA 8b: item apontando para lote de outra empresa foi aceito';
  exception when check_violation then null; end;

  raise notice 'OK 8: isolamento multiempresa dos itens de embalagem';
end $$;

-- Cenário 9: número de ficha repetido na mesma empresa é recusado; o mesmo
-- texto em outra empresa passa.
do $$
begin
  begin
    insert into embalagens (lote, empresa_id)
      values ('EMB-260822-001', '11111111-1111-1111-1111-111111111111');
    raise exception 'FALHA 9a: número de ficha repetido na mesma empresa foi aceito';
  exception when unique_violation then null; end;

  insert into embalagens (lote, empresa_id)
    values ('EMB-260822-001', '99999999-9999-9999-9999-999999999999');

  raise notice 'OK 9: número de ficha único por empresa';
end $$;

-- Cenário 10: quantidade embalada é contagem de unidades — inteira e positiva;
-- peso lançado é positivo. Fração de unidade na etiqueta não existe.
do $$
declare v_ficha uuid;
begin
  select id into v_ficha from embalagens where lote = 'EMB-260822-801'
    and empresa_id = '11111111-1111-1111-1111-111111111111';

  begin
    insert into embalagem_itens (embalagem_id, produto_id, quantidade, peso_total_kg, empresa_id)
      values (v_ficha, '44444444-4444-4444-4444-444444444444', 2.5, 1, '11111111-1111-1111-1111-111111111111');
    raise exception 'FALHA 10a: quantidade fracionária aceita';
  exception when check_violation then null; end;

  begin
    insert into embalagem_itens (embalagem_id, produto_id, quantidade, peso_total_kg, empresa_id)
      values (v_ficha, '44444444-4444-4444-4444-444444444444', 0, 1, '11111111-1111-1111-1111-111111111111');
    raise exception 'FALHA 10b: quantidade zero aceita';
  exception when check_violation then null; end;

  begin
    insert into embalagem_itens (embalagem_id, produto_id, quantidade, peso_total_kg, empresa_id)
      values (v_ficha, '44444444-4444-4444-4444-444444444444', 5, 0, '11111111-1111-1111-1111-111111111111');
    raise exception 'FALHA 10c: peso zero aceito';
  exception when check_violation then null; end;

  raise notice 'OK 10: quantidade inteira e positiva, peso positivo';
end $$;

-- Cenário 11: a RPC `registrar_impressao` passa a aceitar `embalagem_item`.
--
-- As mensagens da RPC saem no mesmo SQLSTATE do `raise exception 'FALHA ...'`
-- (P0001, `raise_exception`), então cada asserção negativa marca uma flag
-- dentro do bloco e levanta o FALHA FORA dele — senão o próprio FALHA seria
-- engolido pelo `exception` e o cenário ficaria verde com a trava quebrada.
do $$
declare v_item uuid; v_ok boolean; v_linhas int; v_empresa uuid;
begin
  select id into v_item from embalagem_itens
    where empresa_id = '11111111-1111-1111-1111-111111111111'
      and embalagem_id = (select id from embalagens where lote = 'EMB-260822-002'
                            and empresa_id = '11111111-1111-1111-1111-111111111111');

  -- Caminho feliz: o ramo novo existe e grava a auditoria com a empresa do item.
  perform public.registrar_impressao('embalagem_item', v_item, 'original', 10, 'producao-lote');
  select count(*) into v_linhas from etiqueta_impressoes
    where source_type = 'embalagem_item' and source_id = v_item;
  if v_linhas <> 1 then
    raise exception 'FALHA 11a: a RPC não gravou a impressão do item de embalagem (achou % linhas)', v_linhas;
  end if;
  select empresa_id into v_empresa from etiqueta_impressoes
    where source_type = 'embalagem_item' and source_id = v_item;
  if v_empresa <> '11111111-1111-1111-1111-111111111111' then
    raise exception 'FALHA 11b: a impressão foi gravada na empresa errada (%)', v_empresa;
  end if;

  -- Item inexistente.
  begin
    perform public.registrar_impressao('embalagem_item', gen_random_uuid(), 'original', 1);
    v_ok := true;
  exception when raise_exception then v_ok := false; end;
  if v_ok then raise exception 'FALHA 11c: a RPC aceitou item de embalagem inexistente'; end if;

  -- Sem o módulo `producoes` na permissão, não imprime.
  perform set_config('req.permissoes', 'recebimentos', true);
  begin
    perform public.registrar_impressao('embalagem_item', v_item, 'original', 1);
    v_ok := true;
  exception when raise_exception then v_ok := false; end;
  perform set_config('req.permissoes', '', true);
  if v_ok then raise exception 'FALHA 11d: imprimiu etiqueta de embalagem sem permissão de Produção'; end if;

  -- Empresa fora do escopo do usuário.
  perform set_config('req.empresa_bloqueada', '11111111-1111-1111-1111-111111111111', true);
  begin
    perform public.registrar_impressao('embalagem_item', v_item, 'original', 1);
    v_ok := true;
  exception when raise_exception then v_ok := false; end;
  perform set_config('req.empresa_bloqueada', '', true);
  if v_ok then raise exception 'FALHA 11e: imprimiu etiqueta de empresa fora do acesso'; end if;

  -- Reimpressão sem motivo.
  begin
    perform public.registrar_impressao('embalagem_item', v_item, 'reimpressao', 1);
    v_ok := true;
  exception when raise_exception then v_ok := false; end;
  if v_ok then raise exception 'FALHA 11f: reimprimiu sem motivo'; end if;

  raise notice 'OK 11: RPC aceita embalagem_item, exige módulo, empresa e motivo de reimpressão';
end $$;

-- Cenário 12 (POSITIVO): ficha em rascunho continua editável. Sem esta
-- asserção, inverter qualquer guarda dos triggers (rascunho passando a ser o
-- bloqueado e o resto liberado) deixaria todos os cenários acima verdes — e a
-- tela pararia de gravar sem a suíte acusar nada.
do $$
declare v_ficha uuid; v_item uuid; v_updated timestamptz; v_sobrou int;
begin
  insert into embalagens (lote, data, empresa_id)
    values ('EMB-260822-950', current_date, '11111111-1111-1111-1111-111111111111')
    returning id into v_ficha;
  insert into embalagem_itens (embalagem_id, produto_id, recebimento_item_id, quantidade, peso_total_kg, validade, empresa_id)
    values (v_ficha, '44444444-4444-4444-4444-444444444444', '66666666-6666-6666-6666-666666666666',
            6, 3, date '2026-12-20', '11111111-1111-1111-1111-111111111111')
    returning id into v_item;

  -- salvarCampo grava campo a campo enquanto a ficha está em rascunho.
  update embalagens set obs = 'sobra devolvida para a câmara' where id = v_ficha;
  update embalagens set sobra_kg = 2.4 where id = v_ficha;
  update embalagens set responsavel_id = '22222222-2222-2222-2222-222222222222' where id = v_ficha;

  select updated_at into v_updated from embalagens where id = v_ficha;
  if v_updated is null or v_updated < now() - interval '1 minute' then
    raise exception 'FALHA 12a: updated_at não foi carimbado no update (achou %)', v_updated;
  end if;

  -- E editar rascunho não pode criar estoque pelo caminho do lado: o trigger de
  -- produção dispara em `after update on embalagens`, e a tela grava campo a
  -- campo — sem a guarda de transição, cada toque no cabeçalho de um rascunho
  -- viraria uma leva de linhas em `producoes`.
  select count(*) into v_sobrou from producoes where embalagem_id = v_ficha;
  if v_sobrou <> 0 then
    raise exception 'FALHA 12b: editar o cabeçalho do rascunho gerou % linha(s) de estoque', v_sobrou;
  end if;

  -- E o item de rascunho ainda pode ser corrigido e removido.
  update embalagem_itens set quantidade = 8, peso_total_kg = 4 where id = v_item;
  delete from embalagem_itens where id = v_item;
  select count(*) into v_sobrou from embalagem_itens where id = v_item;
  if v_sobrou <> 0 then
    raise exception 'FALHA 12c: item de rascunho não pôde ser apagado';
  end if;

  raise notice 'OK 12: ficha em rascunho continua editável — cabeçalho e itens';
end $$;

commit;
