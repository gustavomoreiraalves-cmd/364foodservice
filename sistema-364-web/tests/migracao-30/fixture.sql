-- Esqueleto mínimo para exercitar a atualização 30 num Postgres local.
create schema if not exists auth;
create or replace function auth.uid() returns uuid
  language sql stable as $$ select nullif(current_setting('req.uid', true), '')::uuid $$;
create or replace function auth.role() returns text
  language sql stable as $$ select coalesce(current_setting('req.role', true), 'authenticated') $$;

create table empresas (id uuid primary key, nome text, slug text unique);
insert into empresas values
  ('0dda3c8e-228b-4d05-b50a-2e2f301d75a3', '364 Steakhouse', 'steakhouse'),
  ('b23fa634-61be-4620-bda7-c92dc01f3d24', '364 Foodtruck/Afya', 'foodtruck-afya'),
  ('77566548-b211-42a6-ba31-c9411751290c', '364 Food Service', 'food-service');

create or replace function public.empresas_permitidas() returns setof uuid
  language sql stable as $$ select id from empresas $$;

create or replace function public.fn_set_updated_at() returns trigger
  language plpgsql as $$ begin new.atualizado_em = now(); return new; end $$;
