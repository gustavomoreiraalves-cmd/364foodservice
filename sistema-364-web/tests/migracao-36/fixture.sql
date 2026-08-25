-- Base mínima para exercitar a atualização 36 num Postgres local. Não é
-- espelho da produção: só o recorte de que as FKs, as policies e a função de
-- resolução precisam. Espelha schema.sql (produtos, clientes, materias_primas)
-- e atualizacao_31 (empregadores).
create extension if not exists pgcrypto;

create schema if not exists auth;
create or replace function auth.role() returns text
  language sql stable as $$ select 'authenticated'::text $$;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid()
);

create table if not exists public.empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null
);

create table if not exists public.empregadores (
  id uuid primary key default gen_random_uuid(),
  cnpj text not null,
  razao_social text,
  regime_tributario text,
  inscricao_municipal text
);

alter table public.empresas add column if not exists empregador_id uuid references public.empregadores(id);

create or replace function public.empresas_permitidas()
returns setof uuid
language sql stable as $$ select id from public.empresas $$;

create or replace function public.fn_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table if not exists public.materias_primas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  nome text not null,
  unidade text not null default 'kg',
  custo_unitario numeric(12,2) not null default 0
);

create table if not exists public.produtos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  codigo text not null,
  nome text not null,
  categoria text,
  unidade text not null default 'un',
  preco_venda numeric(12,2) not null default 0,
  producao_interna boolean not null default false,
  created_at timestamptz not null default now(),
  unique (empresa_id, codigo)
);

create table if not exists public.clientes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  nome text not null,
  cnpj text,
  tipo text,
  contato text,
  telefone text,
  ativo boolean not null default true
);

insert into public.empregadores (id, cnpj, razao_social, regime_tributario)
  values ('99999999-0000-0000-0000-000000000001', '12345678000199', '364 FOOD SERVICES LTDA', 'simples')
  on conflict (id) do nothing;

insert into public.empresas (id, nome, empregador_id)
  values ('11111111-1111-1111-1111-111111111111', '364 Food Services',
          '99999999-0000-0000-0000-000000000001')
  on conflict (id) do nothing;
insert into public.empresas (id, nome)
  values ('22222222-2222-2222-2222-222222222222', 'Outra marca')
  on conflict (id) do nothing;

insert into auth.users (id) values ('aaaaaaaa-0000-0000-0000-000000000001')
  on conflict (id) do nothing;
