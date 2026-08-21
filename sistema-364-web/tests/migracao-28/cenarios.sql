-- Exercita a atualização 28. Roda depois do fixture e da migração.
\set QUIET on
set client_min_messages = warning;

-- Uma única transação para o arquivo inteiro: os cenários 6 e 7 usam
-- `set_config(..., true)` (equivalente a `SET LOCAL`) para simular
-- `req.empresa_bloqueada`/`req.permissoes` e depois restauram o valor
-- explicitamente. Sem uma transação envolvendo o arquivo todo, cada `do $$`
-- roda na sua própria transação implícita (autocommit do psql) e o valor
-- "restaurado" não sobrevive até o próximo `do $$`: ao fim de uma transação
-- que gravou um GUC customizado pela primeira vez na sessão, o Postgres não
-- volta a "não definido" (NULL), e sim ao padrão do placeholder, que é
-- string vazia — não bate com `coalesce(current_setting(...), padrao)` no
-- dublê de `tem_permissao` do fixture. O cenário 8 (produção sem restrição)
-- é onde isso aparecia: chegava com `req.permissoes = ''` em vez de restaurado.
begin;

-- Cenário 1: as colunas novas existem e aceitam os valores esperados.
do $$
begin
  update recebimento_itens set volumes = 20 where id = '66666666-6666-6666-6666-666666666666';
  update produtos set conservacao_texto = 'MANTER CONGELADO A -12 °C' where id = '44444444-4444-4444-4444-444444444444';
  update empresas set sim_numero = '030', sim_municipio = 'Ji-Paraná' where id = '11111111-1111-1111-1111-111111111111';
  raise notice 'OK 1: colunas novas gravam';
end $$;

-- Cenário 2: volumes zero ou negativo é recusado; nulo é permitido (item antigo).
do $$
begin
  begin
    update recebimento_itens set volumes = 0 where id = '66666666-6666-6666-6666-666666666666';
    raise exception 'FALHA 2a: volumes zero aceito';
  exception when check_violation then null; end;
  begin
    update recebimento_itens set volumes = -1 where id = '66666666-6666-6666-6666-666666666666';
    raise exception 'FALHA 2b: volumes negativo aceito';
  exception when check_violation then null; end;
  update recebimento_itens set volumes = null where id = '66666666-6666-6666-6666-666666666666';
  update recebimento_itens set volumes = 20 where id = '66666666-6666-6666-6666-666666666666';
  raise notice 'OK 2: volumes validado';
end $$;

-- Cenário 3: o check de source_type aceita os três tipos novos e recusa lixo.
do $$
begin
  insert into etiqueta_impressoes (empresa_id, source_type, source_id, tipo, quantidade, modelo)
    values ('11111111-1111-1111-1111-111111111111', 'recebimento_item', '66666666-6666-6666-6666-666666666666', 'original', 20, 'recebimento');
  insert into etiqueta_impressoes (empresa_id, source_type, source_id, tipo, quantidade, modelo)
    values ('11111111-1111-1111-1111-111111111111', 'embalagem_item', gen_random_uuid(), 'original', 1, 'producao-lote');
  insert into etiqueta_impressoes (empresa_id, source_type, source_id, tipo, quantidade, modelo)
    values ('11111111-1111-1111-1111-111111111111', 'expedicao_caixa', gen_random_uuid(), 'original', 1, 'despacho');
  begin
    insert into etiqueta_impressoes (empresa_id, source_type, source_id, tipo, quantidade, modelo)
      values ('11111111-1111-1111-1111-111111111111', 'inventado', gen_random_uuid(), 'original', 1, 'x');
    raise exception 'FALHA 3: source_type inventado aceito';
  exception when check_violation then null; end;
  raise notice 'OK 3: source_type ampliado';
end $$;

-- Cenário 4: a RPC registra impressão de item de recebimento.
do $$
declare v_qtd int;
begin
  perform set_config('req.uid', '77777777-7777-7777-7777-777777777777', true);
  perform public.registrar_impressao('recebimento_item', '66666666-6666-6666-6666-666666666666',
                                     'original', 20, 'recebimento', 'EM210', null);
  select quantidade into v_qtd from etiqueta_impressoes
    where source_type = 'recebimento_item' and tipo = 'original' and impressora = 'EM210';
  if v_qtd is distinct from 20 then raise exception 'FALHA 4a: impressão não registrada'; end if;
  if not exists (select 1 from audit_logs where acao = 'IMPRESSAO' and recurso = 'etiqueta_impressoes') then
    raise exception 'FALHA 4b: auditoria não registrada';
  end if;
  raise notice 'OK 4: RPC aceita recebimento_item';
end $$;

-- Cenário 5: reimpressão sem motivo é recusada; com motivo passa e fica auditada.
do $$
begin
  begin
    perform public.registrar_impressao('recebimento_item', '66666666-6666-6666-6666-666666666666',
                                       'reimpressao', 1, 'recebimento', null, '   ');
    raise exception 'FALHA 5a: reimpressão sem motivo aceita';
  exception when others then
    if sqlerrm not like '%motivo da reimpressão%' then raise; end if;
  end;
  perform public.registrar_impressao('recebimento_item', '66666666-6666-6666-6666-666666666666',
                                     'reimpressao', 1, 'recebimento', null, 'Etiqueta danificada');
  if not exists (select 1 from audit_logs where acao = 'REIMPRESSAO' and justificativa = 'Etiqueta danificada') then
    raise exception 'FALHA 5b: motivo não auditado';
  end if;
  raise notice 'OK 5: reimpressão exige motivo';
end $$;

-- Cenário 6: item inexistente e empresa fora do alcance são recusados.
do $$
begin
  begin
    perform public.registrar_impressao('recebimento_item', gen_random_uuid(), 'original', 1, 'recebimento', null, null);
    raise exception 'FALHA 6a: item inexistente aceito';
  exception when others then
    if sqlerrm not like '%Item de recebimento não encontrado%' then raise; end if;
  end;

  perform set_config('req.empresa_bloqueada', '11111111-1111-1111-1111-111111111111', true);
  begin
    perform public.registrar_impressao('recebimento_item', '66666666-6666-6666-6666-666666666666', 'original', 1, 'recebimento', null, null);
    raise exception 'FALHA 6b: empresa fora do alcance aceita';
  exception when others then
    if sqlerrm not like '%Sem acesso à empresa%' then raise; end if;
  end;
  perform set_config('req.empresa_bloqueada', '', true);
  raise notice 'OK 6: empresa e existência validadas';
end $$;

-- Cenário 7: sem o módulo `recebimentos` a impressão é recusada.
do $$
begin
  perform set_config('req.permissoes', 'producoes', true);
  begin
    perform public.registrar_impressao('recebimento_item', '66666666-6666-6666-6666-666666666666', 'original', 1, 'recebimento', null, null);
    raise exception 'FALHA 7: imprimiu sem o módulo recebimentos';
  exception when others then
    -- A mensagem mostra o rótulo em português ("Recebimento"), não o slug
    -- técnico do módulo ("recebimentos") — é o que corrige o vazamento do
    -- slug pro operador.
    if sqlerrm not like '%Sem permissão para imprimir etiquetas de Recebimento%' then raise; end if;
  end;
  perform set_config('req.permissoes', 'recebimentos,producoes', true);
  raise notice 'OK 7: permissão de módulo exigida';
end $$;

-- Cenário 8: o caminho antigo (produção) continua funcionando.
do $$
begin
  insert into producoes (id, empresa_id) values ('88888888-8888-8888-8888-888888888888', '11111111-1111-1111-1111-111111111111');
  perform public.registrar_impressao('producao', '88888888-8888-8888-8888-888888888888', 'original', 2, 'validade-cozinha', null, null);
  if not exists (select 1 from etiqueta_impressoes where source_type = 'producao' and quantidade = 2) then
    raise exception 'FALHA 8: caminho antigo quebrou';
  end if;
  raise notice 'OK 8: produção continua imprimindo';
end $$;

-- Cenário 9: produção interna — o ramo que o brief mais manda proteger. A
-- trava de status (só finalizada imprime) tem que sobreviver intacta.
do $$
declare
  v_fin uuid := gen_random_uuid();
  v_rasc uuid := gen_random_uuid();
begin
  insert into producoes_internas (id, empresa_id, status, codigo)
    values (v_fin, '11111111-1111-1111-1111-111111111111', 'finalizada', 'PRD-INT-000001');
  insert into producoes_internas (id, empresa_id, status, codigo)
    values (v_rasc, '11111111-1111-1111-1111-111111111111', 'rascunho', 'PRD-INT-000002');

  perform public.registrar_impressao('producao_interna', v_fin, 'original', 1, 'validade-cozinha', null, null);
  if not exists (select 1 from etiqueta_impressoes where source_type = 'producao_interna' and source_id = v_fin) then
    raise exception 'FALHA 9a: produção interna finalizada não imprimiu';
  end if;

  begin
    perform public.registrar_impressao('producao_interna', v_rasc, 'original', 1, 'validade-cozinha', null, null);
    raise exception 'FALHA 9b: produção interna não finalizada imprimiu';
  exception when others then
    if sqlerrm not like '%só podem ser impressas para produção finalizada%' then raise; end if;
  end;
  raise notice 'OK 9: trava de produção interna preservada';
end $$;

-- Cenário 10: lote é único DENTRO da empresa, não globalmente. Repetir o
-- mesmo texto de lote na mesma empresa é recusado (dois operadores lançando
-- no mesmo dia geram o mesmo LT-* por contagem de linhas — corrida real); o
-- mesmo texto de lote em empresa diferente passa, porque o QR passa a levar
-- o prefixo da empresa no caminho e o texto do lote sozinho não precisa
-- desambiguar entre empresas.
do $$
begin
  begin
    insert into recebimento_itens (recebimento_id, materia_prima_id, lote, quantidade, custo_unitario, empresa_id)
      values ('55555555-5555-5555-5555-555555555555', '33333333-3333-3333-3333-333333333333', 'LT-260821-001', 10, 5.00, '11111111-1111-1111-1111-111111111111');
    raise exception 'FALHA 10a: lote duplicado na mesma empresa foi aceito';
  exception when unique_violation then null; end;

  insert into recebimento_itens (recebimento_id, materia_prima_id, lote, quantidade, custo_unitario, empresa_id)
    values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'LT-260821-001', 10, 5.00, '99999999-9999-9999-9999-999999999999');
  if not exists (select 1 from recebimento_itens where lote = 'LT-260821-001' and empresa_id = '99999999-9999-9999-9999-999999999999') then
    raise exception 'FALHA 10b: mesmo lote em empresa diferente foi recusado';
  end if;
  raise notice 'OK 10: lote único por empresa (empresa_id, lote)';
end $$;

commit;
