-- Esqueleto mínimo do schema de produção para exercitar as policies localmente.
create schema if not exists auth;
create schema if not exists storage;

create or replace function auth.uid() returns uuid
  language sql stable as $$ select nullif(current_setting('req.uid', true), '')::uuid $$;
create or replace function auth.role() returns text
  language sql stable as $$ select coalesce(nullif(current_setting('req.role', true), ''), 'anon') $$;
-- No Supabase, storage.foldername devolve os segmentos de pasta do caminho.
create or replace function storage.foldername(name text) returns text[]
  language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;

create table grupos (id uuid primary key, nome text);
create table empresas (id uuid primary key, nome text, grupo_id uuid references grupos(id));
create table permissoes (user_id uuid, modulo text);
create table usuario_empresas (user_id uuid, empresa_id uuid references empresas(id));
create table empregadores (id uuid primary key, grupo_id uuid references grupos(id), razao_social text, cnpj text);
create table escalas (id uuid primary key, empresa_id uuid references empresas(id), nome text);
create table escala_dias (id uuid primary key, escala_id uuid references escalas(id), dia int);
create table storage.objects (id uuid primary key, bucket_id text, name text);

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

-- Grupo único, duas marcas, como em produção.
insert into grupos values ('f33ff856-93b7-4a8a-a17d-ac16004c3eb1', 'Grupo 364');
insert into empresas values
  ('77566548-b211-42a6-ba31-c9411751290c', 'Food Service', 'f33ff856-93b7-4a8a-a17d-ac16004c3eb1'),
  ('0dda3c8e-228b-4d05-b50a-2e2f301d75a3', 'Steakhouse',   'f33ff856-93b7-4a8a-a17d-ac16004c3eb1');
insert into empregadores values ('e0000000-0000-0000-0000-000000000001', 'f33ff856-93b7-4a8a-a17d-ac16004c3eb1', 'FS LTDA', '00000000000191');

-- ana: ponto na Food Service. bruno: ponto no Steakhouse. Nenhum é admin.
insert into permissoes values
  ('a0000000-0000-0000-0000-00000000000a', 'ponto'),
  ('b0000000-0000-0000-0000-00000000000b', 'ponto');
insert into usuario_empresas values
  ('a0000000-0000-0000-0000-00000000000a', '77566548-b211-42a6-ba31-c9411751290c'),
  ('b0000000-0000-0000-0000-00000000000b', '0dda3c8e-228b-4d05-b50a-2e2f301d75a3');

-- Escala e foto pertencem à Food Service (empresa da ana).
insert into escalas values ('50000000-0000-0000-0000-000000000001', '77566548-b211-42a6-ba31-c9411751290c', 'Salão 6x1');
insert into escala_dias values ('d0000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 1);
insert into storage.objects values
  ('f0000000-0000-0000-0000-000000000001', 'colaboradores', '77566548-b211-42a6-ba31-c9411751290c/c1/foto-1.jpg');

alter table escalas enable row level security;
alter table escala_dias enable row level security;
alter table empregadores enable row level security;
alter table grupos enable row level security;
alter table storage.objects enable row level security;

do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
grant usage on schema public, auth, storage to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
grant execute on all functions in schema public, auth, storage to authenticated;

-- As policies NÃO são criadas aqui de propósito: quem as instala é a
-- migração que está sendo testada (supabase/atualizacao_20_rls_escopo_empresa.sql),
-- aplicada pelo runner logo depois deste arquivo. Assim o teste exercita o SQL
-- real que vai para produção, não uma cópia que pode divergir.
