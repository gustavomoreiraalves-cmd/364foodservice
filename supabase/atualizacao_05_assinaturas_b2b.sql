-- =========================================================
-- ATUALIZAÇÃO 05 — Assinaturas (boxes) + Tabela de preços B2B
-- Sprint 2 do plano do Conselho 364 (18/07/2026).
-- Rode no SQL Editor do Supabase APÓS o schema.sql.
-- =========================================================

-- ---------- ASSINATURAS (boxes mensais Bronze / Prata / Ouro) ----------
create table if not exists assinaturas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete restrict,
  plano text not null,                          -- Bronze | Prata | Ouro
  valor_mensal numeric(12,2) not null,
  dia_entrega int not null default 5,           -- dia do mês da entrega (1–28)
  status text not null default 'Ativa',         -- Ativa | Pausada | Cancelada
  inicio date not null default current_date,
  obs text,
  created_at timestamptz not null default now()
);

-- Entregas mensais de cada assinatura (uma por competência AAAA-MM)
create table if not exists assinatura_entregas (
  id uuid primary key default gen_random_uuid(),
  assinatura_id uuid not null references assinaturas(id) on delete cascade,
  competencia text not null,                    -- 'AAAA-MM'
  data_entrega date,
  status text not null default 'Pendente',      -- Pendente | Entregue | Pulada
  valor numeric(12,2) not null default 0,
  obs text,
  created_at timestamptz not null default now(),
  unique (assinatura_id, competencia)
);

-- ---------- TABELA DE PREÇOS B2B (preço por cliente e produto) ----------
-- Quando existir linha aqui, o pedido usa este preço em vez do preço de varejo.
create table if not exists cliente_precos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  produto_id uuid not null references produtos(id) on delete cascade,
  preco numeric(12,2) not null,
  created_at timestamptz not null default now(),
  unique (cliente_id, produto_id)
);

-- ---------- SEGURANÇA (mesmo padrão do schema.sql) ----------
alter table assinaturas enable row level security;
alter table assinatura_entregas enable row level security;
alter table cliente_precos enable row level security;

do $$
declare t text;
begin
  for t in select unnest(array['assinaturas','assinatura_entregas','cliente_precos'])
  loop
    execute format('drop policy if exists "authenticated_full_access" on %I;', t);
    execute format('create policy "authenticated_full_access" on %I for all using (auth.role() = ''authenticated'') with check (auth.role() = ''authenticated'');', t);
  end loop;
end $$;
