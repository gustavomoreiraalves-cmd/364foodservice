-- Base mínima para exercitar a atualização 35 num Postgres local. Não é
-- espelho da produção: só o suficiente para as FKs, as policies e as
-- funções de conciliação rodarem. Espelha o recorte de
-- atualizacao_16_financeiro_contas_a_pagar.sql.
create extension if not exists pgcrypto;

create schema if not exists auth;
create or replace function auth.role() returns text
  language sql stable as $$ select 'authenticated'::text $$;

create table if not exists public.empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null
);

create table if not exists public.fornecedores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  nome text not null,
  cnpj text
);

create table if not exists public.funcionarios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  nome text not null
);

create table if not exists public.contas_a_pagar (
  id uuid primary key default gen_random_uuid(),
  descricao text not null,
  categoria_conta text not null check (categoria_conta in
    ('Custos Fixos','Custos Diretos','Custos Variáveis','Investimentos')),
  fornecedor_id uuid not null references public.fornecedores(id),
  recebimento_id uuid,
  nota_fiscal_numero text,
  nota_fiscal_anexo_path text,
  valor_total numeric(12,2) not null,
  responsavel_id uuid references public.funcionarios(id),
  empresa_id uuid not null references public.empresas(id),
  created_at timestamptz not null default now()
);

create table if not exists public.contas_a_pagar_parcelas (
  id uuid primary key default gen_random_uuid(),
  conta_a_pagar_id uuid not null references public.contas_a_pagar(id) on delete cascade,
  numero int not null,
  valor numeric(12,2) not null,
  vencimento date not null,
  status text not null default 'Pendente' check (status in ('Pendente','Pago')),
  data_pagamento date,
  forma_pagamento text,
  comprovante_path text,
  empresa_id uuid not null references public.empresas(id),
  created_at timestamptz not null default now(),
  unique (conta_a_pagar_id, numero)
);

-- Empresa do teste, com id fixo para os cenários poderem referenciá-la.
insert into public.empresas (id, nome)
  values ('11111111-1111-1111-1111-111111111111', 'Steakhouse Teste')
  on conflict (id) do nothing;
insert into public.empresas (id, nome)
  values ('22222222-2222-2222-2222-222222222222', 'Outra Empresa')
  on conflict (id) do nothing;

-- empresas_permitidas() devolve só a primeira: prova que o RLS separa.
create or replace function public.empresas_permitidas() returns setof uuid
  language sql stable as $$ select '11111111-1111-1111-1111-111111111111'::uuid $$;

insert into public.fornecedores (id, empresa_id, nome, cnpj)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          '11111111-1111-1111-1111-111111111111', 'Distribuidora Boi Forte', '12345678000199')
  on conflict (id) do nothing;
insert into public.funcionarios (id, empresa_id, nome)
  values ('bbbbbbbb-0000-0000-0000-000000000001',
          '11111111-1111-1111-1111-111111111111', 'Gustavo')
  on conflict (id) do nothing;
