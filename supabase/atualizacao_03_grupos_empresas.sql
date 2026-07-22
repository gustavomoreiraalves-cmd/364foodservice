-- =========================================================
-- 364 — ATUALIZAÇÃO 03: GRUPO / EMPRESAS / UNIDADES
-- Fundação multiempresa do ERP do Grupo 364.
-- Rode este arquivo inteiro no SQL Editor do Supabase
-- (depois de schema.sql, usuarios_permissoes.sql e atualizacao_02_cadastro.sql).
-- =========================================================

create table if not exists public.grupos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.empresas (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references grupos(id) on delete restrict,
  nome text not null,
  slug text unique not null,       -- chave estável usada pela aplicação/migrações, ex: 'food-service'
  cnpj text,
  descricao text,
  prefixo_codigo text not null,    -- prefixo do código de produto desta empresa, ex: '0364', 'STK'
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.unidades (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  nome text not null,
  tipo text not null default 'matriz' check (tipo in ('matriz','filial','operacao')),
  descricao text,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- SEED (idempotente — pode rodar mais de uma vez sem duplicar) ----------
insert into grupos (nome, descricao)
select 'Grupo 364', 'Holding operacional das marcas do Grupo 364'
where not exists (select 1 from grupos where nome = 'Grupo 364');

insert into empresas (grupo_id, nome, slug, prefixo_codigo)
select g.id, v.nome, v.slug, v.prefixo
from grupos g
cross join (values
  ('364 Steakhouse',      'steakhouse',     'STK'),
  ('364 Food Service',    'food-service',   '0364'),  -- empresa existente — prefixo mantém o histórico
  ('364 Burguer',         'burguer',        'BURG'),
  ('364 Foodtruck/Afya',  'foodtruck-afya', 'AFYA')
) as v(nome, slug, prefixo)
where g.nome = 'Grupo 364'
  and not exists (select 1 from empresas e where e.slug = v.slug);
