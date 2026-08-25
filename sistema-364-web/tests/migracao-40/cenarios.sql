-- Cenários da atualização 40: configuração de emissão fiscal (NF-e/NFC-e).
-- Cada bloco falha alto (raise exception) quando a migração não se comporta.
--
-- empresa_a  = 11111111-1111-1111-1111-111111111111 (empregador_a)
-- empresa_b  = 22222222-2222-2222-2222-222222222222 (empregador_a — mesmo CNPJ de A)
-- empresa_sem_empregador = 33333333-3333-3333-3333-333333333333 (sem empregador_id)
-- empregador_a = 99999999-0000-0000-0000-000000000001
--
-- Os UUIDs vêm hardcoded dentro dos blocos do $$ ... $$ (em vez de :'var' do
-- psql) porque a substituição de variável do psql não entra em string
-- dollar-quoted — mesma convenção já usada em tests/migracao-36/cenarios.sql.
\set ON_ERROR_STOP on

-- Cenário 1: o trigger deriva empregador_id de empresas.empregador_id — e
-- sobrescreve qualquer coisa que o INSERT tenha mandado — e recusa gravar
-- para uma marca sem empregador (empresa_id) vinculado.
do $$
begin
  insert into public.empresas_emissao_fiscal (empresa_id, empregador_id, modelo, ambiente, serie)
    values ('11111111-1111-1111-1111-111111111111', '99999999-0000-0000-0000-000000000002', '55', 'homologacao', 1);

  if (select empregador_id from public.empresas_emissao_fiscal
       where empresa_id = '11111111-1111-1111-1111-111111111111' and modelo = '55' and ambiente = 'homologacao')
      <> '99999999-0000-0000-0000-000000000001'::uuid then
    raise exception 'FALHA 1a: trigger não sobrescreveu empregador_id com o valor real da marca (empresas.empregador_id)';
  end if;

  begin
    insert into public.empresas_emissao_fiscal (empresa_id, modelo, ambiente, serie)
      values ('33333333-3333-3333-3333-333333333333', '55', 'homologacao', 1);
    raise exception 'FALHA 1b: marca sem empregador_id vinculado foi aceita';
  exception
    when others then
      if sqlerrm not like '%não tem pessoa jurídica%' then
        raise;
      end if;
  end;
  raise notice 'OK 1: trigger deriva empregador_id de empresas e recusa marca sem empregador';
end $$;

-- Cenário 2: unicidade (empresa_id, modelo, ambiente) — a mesma marca não
-- pode ter duas linhas de NF-e/homologação (índice
-- empresas_emissao_fiscal_marca_modelo_ambiente).
do $$
begin
  begin
    insert into public.empresas_emissao_fiscal (empresa_id, modelo, ambiente, serie)
      values ('11111111-1111-1111-1111-111111111111', '55', 'homologacao', 2);
    raise exception 'FALHA 2: segunda linha para a mesma marca/modelo/ambiente foi aceita';
  exception when unique_violation then null;
  end;
  raise notice 'OK 2: empresa_id+modelo+ambiente é único (empresas_emissao_fiscal_marca_modelo_ambiente)';
end $$;

-- Cenário 3: unicidade de série por CNPJ (empregador_id, modelo, ambiente,
-- serie) — a marca B, que compartilha o CNPJ da marca A (empregador_a), não
-- pode reusar a série 1 do mesmo modelo/ambiente; uma série livre passa.
do $$
begin
  begin
    insert into public.empresas_emissao_fiscal (empresa_id, modelo, ambiente, serie)
      values ('22222222-2222-2222-2222-222222222222', '55', 'homologacao', 1);
    raise exception 'FALHA 3a: duas marcas do mesmo CNPJ usaram a mesma série de NF-e/homologação';
  exception when unique_violation then null;
  end;
  insert into public.empresas_emissao_fiscal (empresa_id, modelo, ambiente, serie)
    values ('22222222-2222-2222-2222-222222222222', '55', 'homologacao', 2);
  if (select empregador_id from public.empresas_emissao_fiscal
       where empresa_id = '22222222-2222-2222-2222-222222222222' and modelo = '55' and ambiente = 'homologacao')
      <> '99999999-0000-0000-0000-000000000001'::uuid then
    raise exception 'FALHA 3b: linha da marca B não ficou com o empregador_id do CNPJ compartilhado';
  end if;
  raise notice 'OK 3: série é única por CNPJ (empresas_emissao_fiscal_serie_por_cnpj), série livre passa';
end $$;

-- Cenário 4: fiscal_numeracao tem a mesma unicidade (fiscal_numeracao_chave).
do $$
begin
  insert into public.fiscal_numeracao (empregador_id, modelo, ambiente, serie, ultimo_numero)
    values ('99999999-0000-0000-0000-000000000001', '55', 'homologacao', 1, 10);
  begin
    insert into public.fiscal_numeracao (empregador_id, modelo, ambiente, serie, ultimo_numero)
      values ('99999999-0000-0000-0000-000000000001', '55', 'homologacao', 1, 20);
    raise exception 'FALHA 4: segunda linha de numeração para a mesma chave foi aceita';
  exception when unique_violation then null;
  end;
  raise notice 'OK 4: fiscal_numeracao é único por empregador_id+modelo+ambiente+serie';
end $$;

-- Cenário 5: RLS ligada em ambas as tabelas e nenhuma policy foi criada —
-- authenticated não enxerga nada (nem o que outra sessão gravou) e não
-- consegue gravar nada.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.empresas_emissao_fiscal, public.fiscal_numeracao to authenticated;

set role authenticated;

do $$
declare n int;
begin
  select count(*) into n from public.empresas_emissao_fiscal;
  if n <> 0 then raise exception 'FALHA 5a: authenticated enxergou % linha(s) de empresas_emissao_fiscal sem nenhuma policy', n; end if;

  select count(*) into n from public.fiscal_numeracao;
  if n <> 0 then raise exception 'FALHA 5b: authenticated enxergou % linha(s) de fiscal_numeracao sem nenhuma policy', n; end if;
end $$;

do $$
begin
  insert into public.empresas_emissao_fiscal (empresa_id, modelo, ambiente, serie)
    values ('11111111-1111-1111-1111-111111111111', '65', 'homologacao', 1);
  raise exception 'FALHA 5c: authenticated conseguiu inserir em empresas_emissao_fiscal sem policy';
exception when insufficient_privilege then null;
end $$;

reset role;

select 'CENÁRIOS DA 40 OK' as resultado;
