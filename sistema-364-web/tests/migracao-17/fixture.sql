-- Esqueleto do schema de produção suficiente para aplicar a migração 17.
-- O ponto central é `audit_logs`: ela JÁ EXISTE em produção, com colunas
-- diferentes das que a versão original da 17 assumia. Reproduzir isso aqui é o
-- que dá sentido ao teste — num banco vazio o defeito não aparece.

create schema if not exists auth;

create or replace function auth.uid() returns uuid
  language sql stable as $$ select nullif(current_setting('req.uid', true), '')::uuid $$;
create or replace function auth.role() returns text
  language sql stable as $$ select coalesce(nullif(current_setting('req.role', true), ''), 'anon') $$;
create or replace function auth.jwt() returns jsonb
  language sql stable as $$ select coalesce(nullif(current_setting('req.jwt', true), ''), '{}')::jsonb $$;

create table auth.users (id uuid primary key, email text);

create table grupos (id uuid primary key, nome text);
create table empresas (id uuid primary key, nome text, grupo_id uuid references grupos(id));
create table unidades (id uuid primary key, empresa_id uuid references empresas(id), nome text);
create table permissoes (user_id uuid, modulo text);
create table usuario_empresas (user_id uuid, empresa_id uuid references empresas(id));
create table funcionarios (id uuid primary key, empresa_id uuid references empresas(id), user_id uuid, nome text, ativo boolean default true);
create table produtos (
  id uuid primary key default gen_random_uuid(), codigo text not null, nome text not null,
  categoria text, unidade text not null, preco_venda numeric not null default 0,
  validade_dias int not null default 0, created_at timestamptz not null default now(),
  empresa_id uuid not null references empresas(id)
);
create table producoes (
  id uuid primary key default gen_random_uuid(), lote text not null, data date not null,
  produto_id uuid not null references produtos(id), quantidade numeric not null,
  custo_total numeric not null, validade date, responsavel_id uuid references funcionarios(id),
  created_at timestamptz not null default now(), peso_bruto_kg numeric, peso_final_kg numeric,
  empresa_id uuid not null references empresas(id), origem text
);

-- audit_logs COMO ESTÁ EM PRODUÇÃO — esta é a peça que quebrava a migração.
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  unidade_id uuid references unidades(id),
  usuario_id uuid,
  acao text not null,
  recurso text not null,
  recurso_id uuid,
  valores_anteriores jsonb,
  valores_novos jsonb,
  justificativa text,
  request_id text,
  ip text,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from permissoes where user_id = auth.uid() and modulo = 'admin') $$;
create or replace function public.tem_modulo(m text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from permissoes where user_id = auth.uid() and modulo in (m, 'admin')) $$;
create or replace function public.empresas_permitidas() returns setof uuid
  language sql stable security definer set search_path = public as $$
  select id from empresas where public.is_admin()
  union
  select empresa_id from usuario_empresas where user_id = auth.uid() $$;
-- Vem da migração 11; a 17 usa em triggers de imutabilidade.
create or replace function public.fn_bloquear_alteracao() returns trigger
  language plpgsql as $$
begin
  raise exception 'Tabela % é imutável (append-only).', tg_table_name;
end $$;

do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;

-- O Supabase concede acesso a anon/authenticated automaticamente nas tabelas
-- criadas em `public`, via default privileges. Sem replicar isso, a migração
-- aplicaria mas as tabelas novas ficariam inacessíveis — um falso negativo.
grant usage on schema public, auth to anon, authenticated;
grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;

insert into grupos values ('f33ff856-93b7-4a8a-a17d-ac16004c3eb1', 'Grupo 364');
insert into empresas values ('77566548-b211-42a6-ba31-c9411751290c', 'Food Service', 'f33ff856-93b7-4a8a-a17d-ac16004c3eb1');
insert into auth.users values ('a0000000-0000-0000-0000-00000000000a', 'ana@364.local');
insert into permissoes values
  ('a0000000-0000-0000-0000-00000000000a', 'producoes'),
  ('a0000000-0000-0000-0000-00000000000a', 'producoes.descarte');
insert into usuario_empresas values ('a0000000-0000-0000-0000-00000000000a', '77566548-b211-42a6-ba31-c9411751290c');
insert into produtos (id, codigo, nome, unidade, empresa_id)
  values ('c0000000-0000-0000-0000-000000000001', '0364-001', 'Molho Cheddar', 'kg', '77566548-b211-42a6-ba31-c9411751290c');
