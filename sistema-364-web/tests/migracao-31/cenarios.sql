-- Exercita a atualização 31. Roda depois do fixture e da migração.
\set QUIET on
set client_min_messages = warning;
begin;

-- Cenário 1: sobram exatamente 2 pessoas jurídicas (uma por CNPJ distinto).
do $$
declare n int;
begin
  select count(*) into n from empregadores;
  if n <> 2 then raise exception 'FALHA 1: esperava 2 empregadores, achou %', n; end if;
  raise notice 'OK 1: um empregador por CNPJ';
end $$;

-- Cenário 2: as 4 marcas ficaram vinculadas, e a Steakhouse ao empregador que já existia.
do $$
declare sem_vinculo int; v_stk uuid;
begin
  select count(*) into sem_vinculo from empresas where empregador_id is null;
  if sem_vinculo <> 0 then raise exception 'FALHA 2: % marcas sem empregador_id', sem_vinculo; end if;
  select empregador_id into v_stk from empresas where slug = 'steakhouse';
  if v_stk <> '30000000-0000-0000-0000-000000000001' then
    raise exception 'FALHA 2: Steakhouse apontou para % em vez do empregador existente', v_stk;
  end if;
  raise notice 'OK 2: marcas vinculadas';
end $$;

-- Cenário 3: Food Service, Burguer e Foodtruck apontam para a MESMA pessoa jurídica nova.
do $$
declare n int;
begin
  select count(distinct empregador_id) into n from empresas where slug in ('food-service','burguer','foodtruck-afya');
  if n <> 1 then raise exception 'FALHA 3: as 3 marcas do CNPJ 60361009000150 apontam para % empregadores', n; end if;
  raise notice 'OK 3: CNPJ compartilhado virou uma única pessoa jurídica';
end $$;

-- Cenário 4: CNPJ com máscara é recusado em empregadores.
do $$
begin
  begin
    insert into empregadores (grupo_id, razao_social, cnpj)
      values ('10000000-0000-0000-0000-000000000001', 'X', '11.222.333/0001-81');
    raise exception 'FALHA 4: aceitou CNPJ com máscara';
  exception when check_violation then
    raise notice 'OK 4: CNPJ só dígitos';
  end;
end $$;

-- Cenário 5: regime tributário fora da lista é recusado.
do $$
begin
  begin
    update empregadores set regime_tributario = 'lucro_imaginario' where cnpj = '37541736000187';
    raise exception 'FALHA 5: aceitou regime inválido';
  exception when check_violation then
    raise notice 'OK 5: regime tributário validado';
  end;
end $$;

-- Cenário 6: só um certificado ativo por empregador.
do $$
begin
  insert into certificados_digitais (empregador_id, pfx_cifrado, senha_cifrada, cnpj_certificado, valido_de, valido_ate)
    values ('30000000-0000-0000-0000-000000000001', 'a:b:c', 'a:b:c', '37541736000187', now(), now() + interval '1 year');
  begin
    insert into certificados_digitais (empregador_id, pfx_cifrado, senha_cifrada, cnpj_certificado, valido_de, valido_ate)
      values ('30000000-0000-0000-0000-000000000001', 'a:b:c', 'a:b:c', '37541736000187', now(), now() + interval '1 year');
    raise exception 'FALHA 6: aceitou dois certificados ativos';
  exception when unique_violation then
    raise notice 'OK 6: um certificado ativo por empregador';
  end;
  -- Desativado, um novo pode entrar.
  update certificados_digitais set ativo = false where empregador_id = '30000000-0000-0000-0000-000000000001';
  insert into certificados_digitais (empregador_id, pfx_cifrado, senha_cifrada, cnpj_certificado, valido_de, valido_ate)
    values ('30000000-0000-0000-0000-000000000001', 'a:b:c', 'a:b:c', '37541736000187', now(), now() + interval '1 year');
  raise notice 'OK 6b: substituição preserva histórico';
end $$;

-- Cenário 7: usuário authenticated (não dono) não enxerga certificados.
do $$
declare n int;
begin
  set local role authenticated;
  select count(*) into n from certificados_digitais;
  reset role;
  if n <> 0 then raise exception 'FALHA 7: authenticated leu % certificados', n; end if;
  raise notice 'OK 7: pfx invisível para o cliente';
end $$;

-- Cenário 8: updated_at muda ao editar empregador.
do $$
declare antes timestamptz; depois timestamptz;
begin
  select updated_at into antes from empregadores where cnpj = '37541736000187';
  perform pg_sleep(0.01);
  update empregadores set telefone = '11999990000' where cnpj = '37541736000187';
  select updated_at into depois from empregadores where cnpj = '37541736000187';
  if depois is null or depois <= coalesce(antes, '-infinity') then raise exception 'FALHA 8: updated_at não avançou'; end if;
  raise notice 'OK 8: updated_at';
end $$;

rollback;
