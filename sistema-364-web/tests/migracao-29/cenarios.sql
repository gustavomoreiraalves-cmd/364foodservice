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

-- Cenário 6: ficha finalizada é imutável — cabeçalho e itens.
do $$
declare v_ficha uuid; v_item uuid;
begin
  select id into v_ficha from defumacoes where lote = 'DEF-260822-001'
    and empresa_id = '11111111-1111-1111-1111-111111111111';
  select id into v_item from defumacao_itens where defumacao_id = v_ficha limit 1;
  update defumacoes set status = 'finalizada' where id = v_ficha;

  begin
    update defumacoes set temperatura_c = 100 where id = v_ficha;
    raise exception 'FALHA 6a: cabeçalho de ficha finalizada mudou';
  exception when others then
    if sqlerrm not like '%finalizada%' then raise; end if;
  end;

  begin
    update defumacao_itens set peso_final_kg = 90 where id = v_item;
    raise exception 'FALHA 6b: item de ficha finalizada mudou';
  exception when others then
    if sqlerrm not like '%finalizada%' then raise; end if;
  end;

  begin
    insert into defumacao_itens (defumacao_id, materia_prima_id, peso_bruto_kg, empresa_id)
      values (v_ficha, '33333333-3333-3333-3333-333333333333', 10, '11111111-1111-1111-1111-111111111111');
    raise exception 'FALHA 6c: item novo entrou em ficha finalizada';
  exception when others then
    if sqlerrm not like '%finalizada%' then raise; end if;
  end;

  raise notice 'OK 6: ficha finalizada é imutável';
end $$;

-- Cenário 7: cancelar exige motivo, e cancelada é terminal.
do $$
declare v_ficha uuid;
begin
  select id into v_ficha from defumacoes where lote = 'DEF-260822-001'
    and empresa_id = '11111111-1111-1111-1111-111111111111';
  begin
    update defumacoes set status = 'cancelada' where id = v_ficha;
    raise exception 'FALHA 7a: cancelou sem motivo';
  exception when check_violation then null; end;

  update defumacoes set status = 'cancelada', cancelada_motivo = 'Erro de digitação no peso',
    cancelada_em = now(), cancelada_por_id = '22222222-2222-2222-2222-222222222222'
    where id = v_ficha;

  begin
    update defumacoes set status = 'rascunho' where id = v_ficha;
    raise exception 'FALHA 7b: ficha cancelada voltou para rascunho';
  exception when others then
    if sqlerrm not like '%cancelada%' then raise; end if;
  end;
  raise notice 'OK 7: cancelamento exige motivo e é terminal';
end $$;

-- Cenário 8: apagar a ficha em cascata não é bloqueado pelo trigger do item.
do $$
declare v_ficha uuid;
begin
  insert into defumacoes (lote, empresa_id) values ('DEF-260822-777', '11111111-1111-1111-1111-111111111111')
    returning id into v_ficha;
  insert into defumacao_itens (defumacao_id, materia_prima_id, peso_bruto_kg, empresa_id)
    values (v_ficha, '33333333-3333-3333-3333-333333333333', 10, '11111111-1111-1111-1111-111111111111');
  update defumacoes set status = 'finalizada' where id = v_ficha;
  delete from defumacoes where id = v_ficha;
  raise notice 'OK 8: delete em cascata passa';
end $$;

commit;
