-- Base mínima para exercitar a atualização 40 num Postgres local. Não é
-- espelho da produção: só o recorte de que empresas_emissao_fiscal,
-- fiscal_numeracao e o trigger que deriva empregador_id precisam.
create extension if not exists pgcrypto;

create table if not exists public.empregadores (
  id uuid primary key default gen_random_uuid(),
  cnpj text not null,
  razao_social text
);

create table if not exists public.empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  empregador_id uuid references public.empregadores(id)
);

create or replace function public.fn_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- empregador_a: CNPJ compartilhado por duas marcas (empresa_a e empresa_b),
-- caso do 364 Steakhouse e 364 Food Service citado no spec da 40.
insert into public.empregadores (id, cnpj, razao_social)
  values ('99999999-0000-0000-0000-000000000001', '12345678000199', '364 FOOD SERVICES LTDA')
  on conflict (id) do nothing;
insert into public.empregadores (id, cnpj, razao_social)
  values ('99999999-0000-0000-0000-000000000002', '98765432000100', 'OUTRO CNPJ LTDA')
  on conflict (id) do nothing;

insert into public.empresas (id, nome, empregador_id)
  values ('11111111-1111-1111-1111-111111111111', '364 Food Services',
          '99999999-0000-0000-0000-000000000001')
  on conflict (id) do nothing;
insert into public.empresas (id, nome, empregador_id)
  values ('22222222-2222-2222-2222-222222222222', '364 Steakhouse (mesmo CNPJ)',
          '99999999-0000-0000-0000-000000000001')
  on conflict (id) do nothing;
insert into public.empresas (id, nome)
  values ('33333333-3333-3333-3333-333333333333', 'Marca sem empregador vinculado')
  on conflict (id) do nothing;

-- Role authenticated, como no Supabase local — criada aqui porque o cenário
-- 5 (RLS) precisa dela, e ela tem de existir antes das concessões que
-- cenarios.sql faz sobre as tabelas que a migração ainda vai criar.
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
