-- Base mínima para exercitar a atualização 43 num Postgres local. Não é
-- espelho da produção: só o recorte de que nfe_saida_documentos,
-- nfe_saida_itens, nfe_saida_eventos e reservar_numero_fiscal precisam.
-- fiscal_numeracao é recriada aqui igual à atualização 40 (já aplicada em
-- produção) porque este teste roda a 43 isolada, sem rodar as migrações
-- anteriores de verdade.
create extension if not exists pgcrypto;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid()
);

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

create table if not exists public.pedidos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id)
);

create table if not exists public.pedido_itens (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid references public.pedidos(id)
);

create table if not exists public.produtos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id)
);

create table if not exists public.naturezas_operacao (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id)
);

-- Espelha a fiscal_numeracao da atualização 40 (colunas conferidas em
-- supabase/atualizacao_40_emissao_fiscal.sql).
create table if not exists public.fiscal_numeracao (
  id uuid primary key default gen_random_uuid(),
  empregador_id uuid not null references public.empregadores(id),
  modelo text not null check (modelo in ('55', '65')),
  ambiente text not null check (ambiente in ('producao', 'homologacao')),
  serie int not null check (serie > 0),
  ultimo_numero int not null default 0 check (ultimo_numero >= 0),
  updated_at timestamptz not null default now()
);
create unique index if not exists fiscal_numeracao_chave
  on public.fiscal_numeracao(empregador_id, modelo, ambiente, serie);

create or replace function public.fn_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Stub simplificado: a função real (atualização 05) usa auth.uid() e
-- usuario_empresas; aqui só precisa existir uma função para a policy chamar.
-- Devolve só a marca A — prova, no cenário de RLS, que a marca B (mesmo
-- CNPJ) fica de fora da leitura de authenticated.
create or replace function public.empresas_permitidas()
returns setof uuid
language sql stable as $$
  select id from public.empresas where nome = '364 Food Services'
$$;

do $$ begin create role authenticated; exception when duplicate_object then null; end $$;

-- empregador_a: mesma convenção de tests/migracao-40 e tests/migracao-36.
insert into public.empregadores (id, cnpj, razao_social)
  values ('99999999-0000-0000-0000-000000000001', '12345678000199', '364 FOOD SERVICES LTDA')
  on conflict (id) do nothing;

insert into public.empresas (id, nome, empregador_id)
  values ('11111111-1111-1111-1111-111111111111', '364 Food Services',
          '99999999-0000-0000-0000-000000000001')
  on conflict (id) do nothing;
insert into public.empresas (id, nome, empregador_id)
  values ('22222222-2222-2222-2222-222222222222', '364 Steakhouse (mesmo CNPJ, fora de empresas_permitidas)',
          '99999999-0000-0000-0000-000000000001')
  on conflict (id) do nothing;

insert into public.pedidos (id, empresa_id)
  values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111')
  on conflict (id) do nothing;
insert into public.pedidos (id, empresa_id)
  values ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222')
  on conflict (id) do nothing;

insert into public.pedido_itens (id, pedido_id)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001')
  on conflict (id) do nothing;
insert into public.pedido_itens (id, pedido_id)
  values ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001')
  on conflict (id) do nothing;

insert into public.produtos (id, empresa_id)
  values ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111')
  on conflict (id) do nothing;

insert into public.naturezas_operacao (id, empresa_id)
  values ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111')
  on conflict (id) do nothing;

-- Linha de numeração para o cenário 1 (reserva atômica). Não existe linha
-- para a série 2 nem para o ambiente produção — usado no cenário 2 (chave
-- inexistente em fiscal_numeracao).
insert into public.fiscal_numeracao (empregador_id, modelo, ambiente, serie, ultimo_numero)
  values ('99999999-0000-0000-0000-000000000001', '55', 'homologacao', 1, 10)
  on conflict (empregador_id, modelo, ambiente, serie) do nothing;
