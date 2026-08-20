-- Exercita a produção interna ponta a ponta depois da migração 17.
-- O alvo principal é a auditoria: era ali que a versão anterior quebrava, e um
-- teste que só verificasse "as tabelas existem" não pegaria o defeito.
-- Cada bloco levanta exceção no comportamento errado, então o exit code decide.

\set ON_ERROR_STOP on
set role authenticated;
set req.role = 'authenticated';
set req.uid = 'a0000000-0000-0000-0000-00000000000a';
set req.jwt = '{"email":"ana@364.local","user_metadata":{"nome":"Ana"}}';

\echo '# regra de validade e produção interna'
insert into produto_regras_validade (empresa_id, produto_id, conservacao, permitido, validade_valor, validade_unidade)
values ('77566548-b211-42a6-ba31-c9411751290c', 'c0000000-0000-0000-0000-000000000001', 'resfriado', true, 5, 'dias');

insert into producoes_internas (empresa_id, produto_id, conservacao, quantidade, unidade_medida, recipientes, responsavel_user_id)
values ('77566548-b211-42a6-ba31-c9411751290c', 'c0000000-0000-0000-0000-000000000001', 'resfriado', 10, 'kg', 4, 'a0000000-0000-0000-0000-00000000000a');

do $$
declare v_codigo text; v_id uuid;
begin
  select codigo, id into v_codigo, v_id from producoes_internas limit 1;
  if v_codigo is null or v_codigo not like 'PRD-INT-%' then
    raise exception 'trigger de código não gerou PRD-INT-*, veio "%"', v_codigo;
  end if;
end $$;

\echo '# finalizar calcula a validade pela regra'
do $$
declare v producoes_internas%rowtype; v_id uuid;
begin
  select id into v_id from producoes_internas limit 1;
  v := public.finalizar_producao_interna(v_id);

  if v.status <> 'finalizada' then raise exception 'status ficou "%"', v.status; end if;
  -- regra: resfriado = 5 dias a partir de produzido_em
  if v.validade::date <> (v.produzido_em + interval '5 days')::date then
    raise exception 'validade calculada errada: % (produzido_em %)', v.validade, v.produzido_em;
  end if;
  if v.validade_manual then raise exception 'validade não deveria estar marcada como manual'; end if;
end $$;

\echo '# a auditoria da finalização foi gravada'
-- Fora do papel de `authenticated` de propósito: a policy `audit_select_admin`
-- restringe a leitura de audit_logs a administradores, e ana não é uma. Ler
-- daqui como dono confere o que foi de fato gravado, sem afrouxar a policy —
-- e mantém o assert num statement separado, para que uma falha aqui não
-- desfaça a finalização feita no bloco anterior.
reset role;
do $$
declare n int; v_id uuid; v_empresa uuid;
begin
  select id, empresa_id into v_id, v_empresa from producoes_internas where status = 'finalizada' limit 1;
  if v_id is null then raise exception 'nenhuma produção finalizada — o bloco anterior não persistiu'; end if;

  -- Este é o assert que a versão anterior da migração não alcançava:
  -- fn_registrar_auditoria inseria em colunas que não existem.
  select count(*) into n from audit_logs where recurso = 'producoes_internas' and acao = 'FINALIZAR' and recurso_id = v_id;
  if n <> 1 then raise exception 'auditoria de FINALIZAR não foi gravada (% linhas)', n; end if;

  select count(*) into n from audit_logs
    where recurso_id = v_id
      and usuario_id = 'a0000000-0000-0000-0000-00000000000a'
      and empresa_id = v_empresa;
  if n <> 1 then raise exception 'auditoria gravada sem usuario_id/empresa_id corretos'; end if;
end $$;
set role authenticated;

\echo '# conservação não autorizada é recusada pelo banco'
do $$
declare v_id uuid;
begin
  insert into producoes_internas (empresa_id, produto_id, conservacao, quantidade, unidade_medida)
  values ('77566548-b211-42a6-ba31-c9411751290c', 'c0000000-0000-0000-0000-000000000001', 'congelado', 1, 'kg')
  returning id into v_id;
  perform public.finalizar_producao_interna(v_id);
  raise exception 'finalizou com conservação "congelado", que não tem regra permitida';
exception when others then
  if sqlerrm not like '%conservação "congelado" autorizada%' then raise; end if;
end $$;

\echo '# etiqueta: impressão registrada e auditada'
do $$
declare v_id uuid; n int;
begin
  select id into v_id from producoes_internas where status = 'finalizada' limit 1;
  perform public.registrar_impressao('producao_interna', v_id, 'original', 4);

  select count(*) into n from etiqueta_impressoes where source_id = v_id and tipo = 'original' and quantidade = 4;
  if n <> 1 then raise exception 'impressão não registrada (% linhas)', n; end if;
end $$;

reset role;
do $$
declare n int; v_id uuid;
begin
  select id into v_id from producoes_internas where status = 'finalizada' limit 1;
  select count(*) into n from audit_logs where recurso = 'etiqueta_impressoes' and acao = 'IMPRESSAO' and recurso_id = v_id;
  if n <> 1 then raise exception 'auditoria de IMPRESSAO não gravada (% linhas)', n; end if;
end $$;
set role authenticated;

\echo '# reimpressão sem motivo é recusada'
do $$
declare v_id uuid;
begin
  select id into v_id from producoes_internas where status = 'finalizada' limit 1;
  perform public.registrar_impressao('producao_interna', v_id, 'reimpressao', 1);
  raise exception 'aceitou reimpressão sem motivo';
exception when others then
  if sqlerrm not like '%motivo da reimpressão%' then raise; end if;
end $$;

\echo '# tabelas append-only recusam UPDATE'
do $$
begin
  update etiqueta_impressoes set quantidade = 99;
  raise exception 'etiqueta_impressoes aceitou UPDATE, deveria ser append-only';
exception when others then
  if sqlerrm not like '%imutável%' and sqlerrm not like '%permission denied%' then raise; end if;
end $$;

\echo 'OK: produção interna, validade, auditoria e etiquetas funcionando'
