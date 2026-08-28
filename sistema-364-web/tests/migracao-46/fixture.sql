-- Base mínima para exercitar a atualização 46 num Postgres local.
create extension if not exists pgcrypto;

create table if not exists public.empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  prefixo_codigo text
);

-- custo_unitario, preco_venda e produtos_st_exige_cest são reproduzidos da
-- produção de propósito: sem eles a fixture aceitaria linha que o banco de
-- verdade recusa, e o harness certificaria uma carga que quebra no primeiro
-- insert. Foi exatamente esse buraco que deixou passar o null de custo.
create table if not exists public.produtos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  codigo text not null,
  nome text not null,
  unidade text not null,
  categoria text,
  custo_unitario numeric(12,2) not null default 0,
  preco_venda numeric(12,2) not null default 0,
  ncm text,
  cest text,
  sujeito_st boolean not null default false,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (empresa_id, codigo),
  constraint produtos_st_exige_cest check (not sujeito_st or cest is not null)
);

create table if not exists public.materias_primas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  nome text not null,
  unidade text not null,
  categoria text,
  custo_unitario numeric(12,2) not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.empresas (id, nome, prefixo_codigo)
  values ('11111111-1111-1111-1111-111111111111', 'Steakhouse Teste', 'STK')
  on conflict (id) do nothing;
insert into public.empresas (id, nome, prefixo_codigo)
  values ('22222222-2222-2222-2222-222222222222', 'Outra Empresa', 'OUT')
  on conflict (id) do nothing;

-- Cadastro feito à mão: fica com pdv_codigo_produto nulo depois da migração.
insert into public.produtos (id, empresa_id, codigo, nome, unidade)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          '11111111-1111-1111-1111-111111111111', 'STK-001', 'Molho Barbecue', 'kg');
insert into public.materias_primas (id, empresa_id, nome, unidade)
  values ('bbbbbbbb-0000-0000-0000-000000000001',
          '11111111-1111-1111-1111-111111111111', 'Costela Suína', 'kg');
insert into public.materias_primas (id, empresa_id, nome, unidade)
  values ('bbbbbbbb-0000-0000-0000-000000000002',
          '11111111-1111-1111-1111-111111111111', 'Costela Suina', 'kg');
