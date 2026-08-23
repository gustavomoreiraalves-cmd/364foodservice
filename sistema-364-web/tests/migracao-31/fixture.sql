-- Esqueleto mínimo para exercitar a atualização 31 num Postgres local.
-- Reproduz o estado de produção: 4 marcas em `empresas` com só 2 CNPJs distintos
-- e 1 empregador (Steakhouse) já cadastrado pelo módulo de ponto.
create extension if not exists pgcrypto;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid
  language sql stable as $$ select nullif(current_setting('req.uid', true), '')::uuid $$;
create or replace function public.is_admin() returns boolean
  language sql stable as $$ select coalesce(current_setting('req.admin', true), '') = '1' $$;
create or replace function public.fn_set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create table grupos (id uuid primary key default gen_random_uuid(), nome text);
create table empresas (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid references grupos(id),
  nome text, slug text, cnpj text, prefixo_codigo text, ativo boolean default true
);
create table empregadores (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references grupos(id) on delete restrict,
  razao_social text not null,
  nome_fantasia text,
  cnpj text unique not null,
  inscricao_estadual text, endereco text, cidade text, uf text, cep text,
  responsavel_legal text,
  fuso text not null default 'America/Sao_Paulo',
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
alter table empregadores enable row level security;
create policy "empregadores_select" on empregadores for select using (true);
create policy "empregadores_admin_write" on empregadores for all using (public.is_admin()) with check (public.is_admin());

insert into grupos (id, nome) values ('10000000-0000-0000-0000-000000000001', 'Grupo 364');
insert into empresas (id, grupo_id, nome, slug, cnpj, prefixo_codigo) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '364 Food Service', 'food-service', '60361009000150', '0364'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '364 Steakhouse', 'steakhouse', '37.541.736/0001-87', 'STK'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '364 Burguer', 'burguer', '60361009000150', 'BURG'),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '364 Foodtruck/Afya', 'foodtruck-afya', '60361009000150', 'AFYA');
insert into empregadores (id, grupo_id, razao_social, cnpj) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '364 Steakhouse Comercio de Alimentos Ltda', '37541736000187');

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
alter default privileges in schema public grant select on tables to authenticated;
