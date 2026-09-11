-- tests/migracao-51/fixture.sql
create extension if not exists pgcrypto;

-- Stub de auth.role(), mesmo padrão de tests/migracao-36/fixture.sql (e
-- reaplicado em tests/migracao-50/fixture.sql) — a policy
-- "empresa_scoped_access" desta atualização chama auth.role() como as
-- demais já em produção; sem o stub, "schema auth does not exist" num
-- Postgres local sem Supabase.
create schema if not exists auth;
create or replace function auth.role() returns text
  language sql stable as $$ select 'authenticated'::text $$;

create table if not exists public.empresas (id uuid primary key default gen_random_uuid(), nome text not null);
create table if not exists public.funcionarios (id uuid primary key default gen_random_uuid());
create table if not exists public.clientes (id uuid primary key default gen_random_uuid(), empresa_id uuid references public.empresas(id));
create table if not exists public.pedidos (id uuid primary key default gen_random_uuid(), empresa_id uuid references public.empresas(id));
create table if not exists public.nfe_saida_documentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id),
  pedido_id uuid references public.pedidos(id),
  status text not null default 'rascunho'
);

create or replace function public.empresas_permitidas()
returns setof uuid language sql stable as $$
  select id from public.empresas where nome = '364 Food Services'
$$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;

insert into public.empresas (id, nome) values ('11111111-1111-1111-1111-111111111111', '364 Food Services') on conflict (id) do nothing;
insert into public.clientes (id, empresa_id) values ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111') on conflict (id) do nothing;
insert into public.pedidos (id, empresa_id) values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111') on conflict (id) do nothing;
insert into public.nfe_saida_documentos (id, empresa_id, pedido_id, status) values
  ('ffffffff-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'autorizado')
  on conflict (id) do nothing;
