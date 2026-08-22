-- Exercita a atualização 29. Roda depois do fixture e da migração.
\set QUIET on
set client_min_messages = warning;
begin;

-- Cenário 1: a ficha legada sobreviveu e ganhou status padrão.
do $$
declare v_status text;
begin
  select status into v_status from defumacoes where id = '66666666-6666-6666-6666-666666666666';
  if v_status is distinct from 'rascunho' then
    raise exception 'FALHA 1: ficha legada ficou com status %', v_status;
  end if;
  raise notice 'OK 1: ficha legada preservada';
end $$;

-- Cenário 2: ficha nova grava com lote de origem no item.
do $$
declare v_ficha uuid;
begin
  insert into defumacoes (lote, data, hora_inicio, hora_fim, temperatura_c, responsavel_id, empresa_id)
    values ('DEF-260822-001', current_date, '08:00', '14:00', 92.5,
            '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111')
    returning id into v_ficha;
  insert into defumacao_itens (defumacao_id, materia_prima_id, recebimento_item_id,
                               peso_bruto_kg, perda_limpeza_kg, sobra_kg, peso_final_kg, empresa_id)
    values (v_ficha, '33333333-3333-3333-3333-333333333333', '55555555-5555-5555-5555-555555555555',
            180, 20, 5, 81, '11111111-1111-1111-1111-111111111111');
  raise notice 'OK 2: ficha com lote de origem';
end $$;

-- Cenário 3: peso defumado maior que o bruto é recusado pelo banco.
do $$
declare v_ficha uuid;
begin
  select id into v_ficha from defumacoes where lote = 'DEF-260822-001';
  begin
    insert into defumacao_itens (defumacao_id, materia_prima_id, recebimento_item_id,
                                 peso_bruto_kg, peso_final_kg, empresa_id)
      values (v_ficha, '33333333-3333-3333-3333-333333333333', '55555555-5555-5555-5555-555555555555',
              100, 120, '11111111-1111-1111-1111-111111111111');
    raise exception 'FALHA 3: peso defumado maior que o bruto foi aceito';
  exception when check_violation then null; end;
  raise notice 'OK 3: peso defumado limitado pelo bruto';
end $$;

-- Cenário 4: peso negativo é recusado.
do $$
declare v_ficha uuid;
begin
  select id into v_ficha from defumacoes where lote = 'DEF-260822-001';
  begin
    insert into defumacao_itens (defumacao_id, materia_prima_id, peso_bruto_kg, peso_final_kg, empresa_id)
      values (v_ficha, '33333333-3333-3333-3333-333333333333', -5, 1, '11111111-1111-1111-1111-111111111111');
    raise exception 'FALHA 4: peso negativo aceito';
  exception when check_violation then null; end;
  raise notice 'OK 4: peso negativo recusado';
end $$;

-- Cenário 5: número de ficha repetido na mesma empresa é recusado;
-- em outra empresa, passa.
do $$
begin
  begin
    insert into defumacoes (lote, empresa_id)
      values ('DEF-260822-001', '11111111-1111-1111-1111-111111111111');
    raise exception 'FALHA 5a: número de ficha repetido aceito';
  exception when unique_violation then null; end;

  insert into empresas (id, nome) values ('99999999-9999-9999-9999-999999999999', 'Steakhouse');
  insert into defumacoes (lote, empresa_id)
    values ('DEF-260822-001', '99999999-9999-9999-9999-999999999999');
  raise notice 'OK 5: número de ficha único por empresa';
end $$;

-- Cenário 6: ficha finalizada é imutável — cabeçalho (inclusive o próprio
-- número da ficha e a observação), o status em si (não volta para rascunho) e
-- os itens (alterar, inserir e apagar direto, sem ser cascata do cabeçalho).
--
-- Cada asserção usa `exception when check_violation` — não `when others`
-- casando um pedaço da mensagem: as triggers desta migração sempre marcam
-- `errcode = 'check_violation'`, e a mensagem do próprio `raise exception
-- 'FALHA ...'` abaixo contém as mesmas palavras ("finalizada", "cancelada")
-- que a trava usa. Um `when others` com `sqlerrm not like '%finalizada%'`
-- engoliria o FALHA da asserção junto com o erro de verdade e daria falso
-- verde se a trava sumisse.
do $$
declare v_ficha uuid; v_item uuid;
begin
  select id into v_ficha from defumacoes where lote = 'DEF-260822-001'
    and empresa_id = '11111111-1111-1111-1111-111111111111';
  select id into v_item from defumacao_itens where defumacao_id = v_ficha limit 1;
  update defumacoes set status = 'finalizada' where id = v_ficha;

  begin
    update defumacoes set temperatura_c = 100 where id = v_ficha;
    raise exception 'FALHA 6a: temperatura de ficha finalizada mudou';
  exception when check_violation then null; end;

  begin
    update defumacoes set lote = 'DEF-260822-002' where id = v_ficha;
    raise exception 'FALHA 6b: número da ficha finalizada mudou';
  exception when check_violation then null; end;

  begin
    update defumacoes set obs = 'reaproveitado' where id = v_ficha;
    raise exception 'FALHA 6c: observação de ficha finalizada mudou';
  exception when check_violation then null; end;

  begin
    update defumacoes set status = 'rascunho' where id = v_ficha;
    raise exception 'FALHA 6d: ficha finalizada voltou para rascunho';
  exception when check_violation then null; end;

  begin
    update defumacao_itens set peso_final_kg = 90 where id = v_item;
    raise exception 'FALHA 6e: item de ficha finalizada mudou';
  exception when check_violation then null; end;

  begin
    insert into defumacao_itens (defumacao_id, materia_prima_id, peso_bruto_kg, empresa_id)
      values (v_ficha, '33333333-3333-3333-3333-333333333333', 10, '11111111-1111-1111-1111-111111111111');
    raise exception 'FALHA 6f: item novo entrou em ficha finalizada';
  exception when check_violation then null; end;

  begin
    delete from defumacao_itens where id = v_item;
    raise exception 'FALHA 6g: item de ficha finalizada foi apagado direto (sem apagar o cabeçalho)';
  exception when check_violation then null; end;

  -- Menor da revisão final, corrigido junto com o Important 7: empresa_id
  -- entrou na mesma lista de campos travados que lote/obs/data/horários —
  -- sem isso dava para mover a ficha de empresa pelo banco depois de
  -- finalizada.
  begin
    update defumacoes set empresa_id = '99999999-9999-9999-9999-999999999999' where id = v_ficha;
    raise exception 'FALHA 6h: empresa da ficha finalizada mudou';
  exception when check_violation then null; end;

  raise notice 'OK 6: ficha finalizada é imutável — cabeçalho, status, itens e empresa';
end $$;

-- Cenário 7: cancelar exige motivo, cancelada é terminal, e a data do
-- cancelamento vem do relógio do banco — não do que o cliente mandar.
--
-- Manda um valor absurdo (ano de 2001) em `cancelada_em` de propósito: é o
-- teste discriminante de verdade. Um cenário que simplesmente omitisse
-- `cancelada_em` e conferisse "not null" continuaria verde mesmo se o
-- carimbo do trigger sumisse — bastaria o cliente (a tela, hoje; um script
-- amanhã) mandar QUALQUER valor não nulo. Só forçando um valor claramente
-- errado e provando que ele foi substituído é que a asserção prova que quem
-- manda na data é o `clock_timestamp()` do trigger, não o payload.
do $$
declare v_ficha uuid; v_cancelada_em timestamptz;
begin
  select id into v_ficha from defumacoes where lote = 'DEF-260822-001'
    and empresa_id = '11111111-1111-1111-1111-111111111111';
  begin
    update defumacoes set status = 'cancelada' where id = v_ficha;
    raise exception 'FALHA 7a: cancelou sem motivo';
  exception when check_violation then null; end;

  update defumacoes set status = 'cancelada', cancelada_motivo = 'Erro de digitação no peso',
    cancelada_em = '2001-01-01 00:00:00+00', cancelada_por_id = '22222222-2222-2222-2222-222222222222'
    where id = v_ficha;

  select cancelada_em into v_cancelada_em from defumacoes where id = v_ficha;
  if v_cancelada_em is null or v_cancelada_em < now() - interval '1 minute' then
    raise exception 'FALHA 7b: cancelada_em não foi carimbada pelo relógio do banco (achou %)', v_cancelada_em;
  end if;

  begin
    update defumacoes set status = 'rascunho' where id = v_ficha;
    raise exception 'FALHA 7c: ficha cancelada voltou para rascunho';
  exception when check_violation then null; end;

  -- Menor da revisão final, corrigido junto com o Important 7: uma vez
  -- cancelada, o motivo do cancelamento é tão parte do registro sanitário
  -- quanto o resto do cabeçalho — sem esta trava dava para reescrever o
  -- motivo de uma ficha já cancelada por cima do que ficou impresso.
  begin
    update defumacoes set cancelada_motivo = 'motivo reescrito depois' where id = v_ficha;
    raise exception 'FALHA 7d: motivo de ficha já cancelada foi reescrito';
  exception when check_violation then null; end;

  raise notice 'OK 7: cancelamento exige motivo, é terminal, cancelada_em vem do banco, e o motivo não é reescrevível';
end $$;

-- Cenário 8: apagar o cabeçalho de uma ficha em RASCUNHO continua
-- funcionando, e a cascata para os itens não é bloqueada pelo trigger do
-- item.
--
-- Até a revisão final este cenário usava uma ficha FINALIZADA — mas a
-- correção do Important 6 (trg_defumacoes_bloquear_delete, mais abaixo)
-- passou a bloquear justamente o delete de ficha fora de rascunho, que era o
-- caso que este cenário exercitava. Trocado para rascunho: continua provando
-- que a cascata do `on delete cascade` para os itens funciona (é o único
-- caminho de delete que ainda precisa funcionar), sem colidir com a trava
-- nova. O cenário 12 cobre o caso que este cobria antes (finalizada não
-- apaga).
--
-- Este cenário só é discriminante porque a trigger do ITEM compara com `is
-- distinct from` (ver comentário na migração): se o `if not found` que
-- detecta a cascata fosse removido, `v_status` ficaria nulo e a comparação
-- `is distinct from 'rascunho'` daria verdadeiro, disparando a exceção e
-- derrubando este delete. Com o antigo `<>`, a mesma remoção passaria batido
-- (`null <> texto` é nulo, não verdadeiro) e este cenário continuaria "OK"
-- mesmo quebrado.
do $$
declare v_ficha uuid;
begin
  insert into defumacoes (lote, empresa_id) values ('DEF-260822-777', '11111111-1111-1111-1111-111111111111')
    returning id into v_ficha;
  insert into defumacao_itens (defumacao_id, materia_prima_id, peso_bruto_kg, empresa_id)
    values (v_ficha, '33333333-3333-3333-3333-333333333333', 10, '11111111-1111-1111-1111-111111111111');
  delete from defumacoes where id = v_ficha;
  raise notice 'OK 8: delete em cascata de ficha em rascunho passa';
end $$;

-- Cenário 9: ficha não nasce finalizada pulando a checagem de item — a regra
-- "ficha sem matéria-prima não finaliza" vale tanto no insert quanto no
-- update do cabeçalho.
do $$
begin
  begin
    insert into defumacoes (lote, status, empresa_id)
      values ('DEF-260822-999', 'finalizada', '11111111-1111-1111-1111-111111111111');
    raise exception 'FALHA 9: ficha nasceu finalizada sem item lançado';
  exception when check_violation then null; end;
  raise notice 'OK 9: ficha não nasce finalizada sem item';
end $$;

-- Cenário 10: isolamento multiempresa dos itens de defumação (Important 7 da
-- revisão final). Sem a validação, um item gravado com empresa errada fica
-- invisível para a tela da empresa dona (o filtro `.eq('empresa_id', eid)`
-- nunca alcança ele) e não desconta do saldo do lote — o mesmo lote pode ser
-- lançado duas vezes, uma por empresa.
do $$
declare
  v_ficha uuid;
  v_lote_outra_empresa uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_recebimento_outra_empresa uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
begin
  insert into defumacoes (lote, empresa_id) values ('DEF-260822-501', '11111111-1111-1111-1111-111111111111')
    returning id into v_ficha;

  -- Caso a: item com empresa_id diferente da ficha pai.
  begin
    insert into defumacao_itens (defumacao_id, materia_prima_id, peso_bruto_kg, empresa_id)
      values (v_ficha, '33333333-3333-3333-3333-333333333333', 10, '99999999-9999-9999-9999-999999999999');
    raise exception 'FALHA 10a: item com empresa diferente da ficha pai foi aceito';
  exception when check_violation then null; end;

  -- Caso b: item da empresa certa da ficha, mas apontando para um lote
  -- (recebimento_item_id) de OUTRA empresa.
  insert into recebimentos (id, empresa_id) values (v_recebimento_outra_empresa, '99999999-9999-9999-9999-999999999999');
  insert into recebimento_itens (id, recebimento_id, materia_prima_id, lote, quantidade, custo_unitario, empresa_id)
    values (v_lote_outra_empresa, v_recebimento_outra_empresa, '33333333-3333-3333-3333-333333333333', 'LT-OUTRAEMPRESA', 50, 10, '99999999-9999-9999-9999-999999999999');
  begin
    insert into defumacao_itens (defumacao_id, materia_prima_id, recebimento_item_id, peso_bruto_kg, empresa_id)
      values (v_ficha, '33333333-3333-3333-3333-333333333333', v_lote_outra_empresa, 10, '11111111-1111-1111-1111-111111111111');
    raise exception 'FALHA 10b: item apontando para lote de outra empresa foi aceito';
  exception when check_violation then null; end;

  raise notice 'OK 10: isolamento multiempresa dos itens de defumação';
end $$;

-- Cenário 11: as asserções positivas que faltavam (Important 9 da revisão
-- final). Sem elas, se a guarda de algum dos triggers acima inverter
-- (rascunho passando a ser bloqueado e o resto liberado), todos os cenários
-- de bloqueio continuam verdes e a tela para de funcionar sem que a suíte
-- acuse nada — só um cenário que prova que a operação normal continua
-- passando pega esse tipo de inversão.
do $$
declare v_ficha uuid; v_item uuid;
begin
  insert into defumacoes (lote, empresa_id) values ('DEF-260822-502', '11111111-1111-1111-1111-111111111111')
    returning id into v_ficha;
  insert into defumacao_itens (defumacao_id, materia_prima_id, peso_bruto_kg, empresa_id)
    values (v_ficha, '33333333-3333-3333-3333-333333333333', 10, '11111111-1111-1111-1111-111111111111')
    returning id into v_item;

  -- salvarCampo (app/producoes/defumacao/[id]/page.js) grava campo de
  -- cabeçalho em rascunho, campo a campo — precisa continuar funcionando.
  update defumacoes set temperatura_c = 88 where id = v_ficha;

  -- removerItem (mesma tela) apaga item de ficha em rascunho, direto — não
  -- em cascata do cabeçalho — precisa continuar funcionando.
  delete from defumacao_itens where id = v_item;

  raise notice 'OK 11: cabeçalho e item de ficha em rascunho continuam editáveis/apagáveis';
end $$;

-- Cenário 12: apagar o CABEÇALHO de uma ficha finalizada (ou cancelada), não
-- em cascata de item, é bloqueado — Important 6 da revisão final. Antes
-- desta correção a imutabilidade cobria update de cabeçalho e de itens, mas
-- nada cobria o DELETE do cabeçalho: apagar uma ficha finalizada passava e
-- levava os itens junto em cascata — o oposto do que um módulo cujo
-- argumento inteiro é imutabilidade de registro sanitário deveria permitir
-- (o cenário 8, acima, cobria exatamente esse caminho como "OK" até esta
-- correção).
do $$
declare v_ficha uuid;
begin
  insert into defumacoes (lote, empresa_id) values ('DEF-260822-503', '11111111-1111-1111-1111-111111111111')
    returning id into v_ficha;
  insert into defumacao_itens (defumacao_id, materia_prima_id, peso_bruto_kg, empresa_id)
    values (v_ficha, '33333333-3333-3333-3333-333333333333', 10, '11111111-1111-1111-1111-111111111111');
  update defumacoes set status = 'finalizada' where id = v_ficha;

  begin
    delete from defumacoes where id = v_ficha;
    raise exception 'FALHA 12: ficha finalizada foi apagada';
  exception when check_violation then null; end;

  raise notice 'OK 12: ficha finalizada não pode ser apagada';
end $$;

commit;
