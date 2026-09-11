-- tests/migracao-52/cenarios.sql
-- expedição finalizada = eeeeeeee-...0001, caixa cccccccc-...0001
-- expedição em rascunho = eeeeeeee-...0002, caixa cccccccc-...0002
-- item de recebimento (ramo antigo) = 66666666-...6666666666
\set ON_ERROR_STOP on

-- Cenário 1: `expedicao_caixa` com romaneio finalizado → sucesso, uma linha
-- nova em etiqueta_impressoes.
do $$
declare v_linhas int; v_empresa uuid;
begin
  perform public.registrar_impressao('expedicao_caixa', 'cccccccc-0000-0000-0000-000000000001',
                                     'original', 2, 'etiqueta-despacho');
  select count(*) into v_linhas from etiqueta_impressoes
    where source_type = 'expedicao_caixa' and source_id = 'cccccccc-0000-0000-0000-000000000001';
  if v_linhas <> 1 then
    raise exception 'FALHA 1: esperava 1 linha em etiqueta_impressoes pra caixa do romaneio finalizado, achou %', v_linhas;
  end if;
  select empresa_id into v_empresa from etiqueta_impressoes
    where source_type = 'expedicao_caixa' and source_id = 'cccccccc-0000-0000-0000-000000000001';
  if v_empresa <> '11111111-1111-1111-1111-111111111111' then
    raise exception 'FALHA 1b: impressão gravada na empresa errada (%)', v_empresa;
  end if;
  raise notice 'OK 1: expedicao_caixa com romaneio finalizado imprime e grava a auditoria';
end $$;

-- Cenário 2: `expedicao_caixa` com romaneio em rascunho → recusado com a
-- mensagem de status (mesmo padrão dos ramos irmãos finalizada/finalizado).
do $$
declare v_ok boolean; v_msg text;
begin
  begin
    perform public.registrar_impressao('expedicao_caixa', 'cccccccc-0000-0000-0000-000000000002',
                                       'original', 1);
    v_ok := true;
  exception when raise_exception then
    v_ok := false;
    get stacked diagnostics v_msg = message_text;
  end;
  if v_ok then
    raise exception 'FALHA 2: imprimiu etiqueta de caixa de romaneio em rascunho';
  end if;
  if v_msg not like '%romaneio finalizado%' then
    raise exception 'FALHA 2b: mensagem de recusa não menciona romaneio finalizado (veio "%")', v_msg;
  end if;
  raise notice 'OK 2: expedicao_caixa com romaneio em rascunho é recusado';
end $$;

-- Cenário 3: source_type inválido continua recusado com a mesma mensagem de
-- sempre — prova que o `else` final não regrediu com o ramo novo no meio.
do $$
declare v_ok boolean; v_msg text;
begin
  begin
    perform public.registrar_impressao('coisa_inexistente', gen_random_uuid(), 'original', 1);
    v_ok := true;
  exception when raise_exception then
    v_ok := false;
    get stacked diagnostics v_msg = message_text;
  end;
  if v_ok then
    raise exception 'FALHA 3: source_type inválido foi aceito';
  end if;
  if v_msg <> 'source_type inválido: coisa_inexistente' then
    raise exception 'FALHA 3b: mensagem de source_type inválido mudou (veio "%")', v_msg;
  end if;
  raise notice 'OK 3: source_type inválido continua recusado com a mesma mensagem';
end $$;

-- Cenário 4 (não-regressão): o ramo antigo `recebimento_item` continua
-- funcionando idêntico ao de antes do create or replace desta migração —
-- prova de que os ramos existentes não foram tocados.
do $$
declare v_linhas int; v_empresa uuid;
begin
  perform public.registrar_impressao('recebimento_item', '66666666-6666-6666-6666-666666666666',
                                     'original', 5, 'validade-cozinha');
  select count(*) into v_linhas from etiqueta_impressoes
    where source_type = 'recebimento_item' and source_id = '66666666-6666-6666-6666-666666666666';
  if v_linhas <> 1 then
    raise exception 'FALHA 4: esperava 1 linha em etiqueta_impressoes pro item de recebimento, achou %', v_linhas;
  end if;
  select empresa_id into v_empresa from etiqueta_impressoes
    where source_type = 'recebimento_item' and source_id = '66666666-6666-6666-6666-666666666666';
  if v_empresa <> '11111111-1111-1111-1111-111111111111' then
    raise exception 'FALHA 4b: impressão do ramo antigo gravada na empresa errada (%)', v_empresa;
  end if;
  raise notice 'OK 4: ramo antigo recebimento_item continua funcionando após o create or replace';
end $$;

select 'CENÁRIOS DA 52 OK' as resultado;
