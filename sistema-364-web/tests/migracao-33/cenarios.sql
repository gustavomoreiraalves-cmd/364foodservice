-- Exercita a atualização 33. Roda depois do fixture, da migração 32 e da
-- migração 33 (aplicada com o mapa de 7 ids intacto — o cenário de guarda
-- contra edição manual é verificado à parte, em verificar.sh).
\set QUIET on
set client_min_messages = warning;
begin;

-- Cenário 1: colunas existem e a Steakhouse tem origem='backup' com as 7
-- chaves (dias da semana) no jsonb.
do $$
declare o text; n integer;
begin
  select origem into o from pdv_lojas where id_connect = -2147478159;
  select count(*) into n from pdv_lojas, jsonb_object_keys(drive_arquivos)
    where id_connect = -2147478159;
  if o <> 'backup' or n <> 7 then
    raise exception 'FALHA 1: origem=% chaves=% (esperava backup e 7)', o, n;
  end if;
  raise notice 'OK 1: Steakhouse em backup com 7 arquivos do Drive';
end $$;

-- Cenário 2: Afya sem fonte ativa (ativo=false), origem segue o default
-- 'painel' (plano B documentado, sem cron).
do $$
declare a boolean; o text;
begin
  select ativo, origem into a, o from pdv_lojas where id_connect = -2147458165;
  if a is not false or o <> 'painel' then
    raise exception 'FALHA 2: ativo=% origem=% (esperava false e painel)', a, o;
  end if;
  raise notice 'OK 2: Afya desativada até o backup dela subir ao Drive';
end $$;

-- Cenário 3: o check de origem recusa valor fora da lista.
do $$
begin
  begin
    update pdv_lojas set origem = 'planilha' where id_connect = -2147478159;
    raise exception 'FALHA 3: aceitou origem inválida';
  exception when check_violation then
    raise notice 'OK 3: check de origem';
  end;
end $$;

rollback;
