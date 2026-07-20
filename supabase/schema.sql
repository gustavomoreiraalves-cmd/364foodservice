-- =========================================================
-- 364 FOODSERVICES — ESQUEMA DO BANCO DE DADOS (Supabase / Postgres)
-- Rode este arquivo inteiro no SQL Editor do seu projeto Supabase.
-- =========================================================

create extension if not exists "pgcrypto";

-- ---------- FUNCIONÁRIOS (equipe / responsáveis) ----------
create table funcionarios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null, -- vínculo com login (preenchido quando o funcionário ganha acesso)
  nome text not null,
  cargo text,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- FORNECEDORES ----------
create table fornecedores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cnpj text,
  categoria text,
  contato text,
  telefone text,
  email text,
  created_at timestamptz not null default now()
);

-- ---------- MATÉRIAS-PRIMAS ----------
create table materias_primas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  unidade text not null default 'kg',
  custo_unitario numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- PRODUTOS (catálogo) ----------
create table produtos (
  id uuid primary key default gen_random_uuid(),
  codigo text unique not null,           -- ex: 0364-001, gerado pela aplicação
  nome text not null,
  categoria text,
  unidade text not null default 'un',
  preco_venda numeric(12,2) not null default 0,
  validade_dias int not null default 90,
  created_at timestamptz not null default now()
);

-- ---------- FICHA TÉCNICA (BOM: quanto de cada matéria-prima por unidade produzida) ----------
create table ficha_tecnica (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references produtos(id) on delete cascade,
  materia_prima_id uuid not null references materias_primas(id) on delete restrict,
  quantidade numeric(12,4) not null,
  created_at timestamptz not null default now()
);

-- ---------- RECEBIMENTOS (entrada de matéria-prima = nascimento do lote) ----------
create table recebimentos (
  id uuid primary key default gen_random_uuid(),
  lote text not null,                     -- padrão LT-DD/MM/AA-XXX
  data date not null default current_date,
  fornecedor_id uuid references fornecedores(id),
  materia_prima_id uuid not null references materias_primas(id),
  quantidade numeric(12,4) not null,
  custo_unitario numeric(12,2) not null,
  nota_fiscal text,
  validade date,
  responsavel_id uuid references funcionarios(id),
  created_at timestamptz not null default now()
);

-- ---------- PRODUÇÃO (lotes de produto acabado) ----------
create table producoes (
  id uuid primary key default gen_random_uuid(),
  lote text not null,
  data date not null default current_date,
  produto_id uuid not null references produtos(id),
  quantidade numeric(12,4) not null,
  custo_total numeric(12,2) not null default 0,
  validade date,
  responsavel_id uuid references funcionarios(id),
  created_at timestamptz not null default now()
);

-- consumo de matéria-prima gerado por cada lote de produção (baixa de estoque)
create table producao_consumo (
  id uuid primary key default gen_random_uuid(),
  producao_id uuid not null references producoes(id) on delete cascade,
  materia_prima_id uuid not null references materias_primas(id),
  quantidade numeric(12,4) not null
);

-- ---------- CLIENTES ----------
create table clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cnpj text,
  tipo text,           -- Revenda, Distribuidor, Food Service, Consumidor Final
  contato text,
  telefone text,
  created_at timestamptz not null default now()
);

-- ---------- PEDIDOS DE VENDA ----------
create table pedidos (
  id uuid primary key default gen_random_uuid(),
  data date not null default current_date,
  cliente_id uuid references clientes(id),
  status text not null default 'Pendente',  -- Pendente | Faturado | Enviado | Cancelado
  responsavel_id uuid references funcionarios(id),
  created_at timestamptz not null default now()
);

create table pedido_itens (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references pedidos(id) on delete cascade,
  produto_id uuid not null references produtos(id),
  quantidade numeric(12,4) not null,
  preco_unitario numeric(12,2) not null
);

-- ---------- DESPESAS OPERACIONAIS ----------
create table despesas (
  id uuid primary key default gen_random_uuid(),
  data date not null default current_date,
  descricao text not null,
  valor numeric(12,2) not null,
  responsavel_id uuid references funcionarios(id),
  created_at timestamptz not null default now()
);

-- =========================================================
-- VIEWS DE ESTOQUE (calculadas, nunca editadas manualmente)
-- =========================================================

create view vw_estoque_materia_prima as
select
  mp.id as materia_prima_id,
  mp.nome,
  mp.unidade,
  coalesce(sum(r.quantidade), 0) as total_recebido,
  coalesce((select sum(pc.quantidade) from producao_consumo pc where pc.materia_prima_id = mp.id), 0) as total_consumido,
  coalesce(sum(r.quantidade), 0) - coalesce((select sum(pc.quantidade) from producao_consumo pc where pc.materia_prima_id = mp.id), 0) as saldo
from materias_primas mp
left join recebimentos r on r.materia_prima_id = mp.id
group by mp.id, mp.nome, mp.unidade;

create view vw_estoque_produto as
select
  p.id as produto_id,
  p.codigo,
  p.nome,
  p.unidade,
  coalesce((select sum(pr.quantidade) from producoes pr where pr.produto_id = p.id), 0) as total_produzido,
  coalesce((select sum(pi.quantidade) from pedido_itens pi join pedidos pe on pe.id = pi.pedido_id
            where pi.produto_id = p.id and pe.status <> 'Cancelado'), 0) as total_vendido,
  coalesce((select sum(pr.quantidade) from producoes pr where pr.produto_id = p.id), 0)
  - coalesce((select sum(pi.quantidade) from pedido_itens pi join pedidos pe on pe.id = pi.pedido_id
              where pi.produto_id = p.id and pe.status <> 'Cancelado'), 0) as saldo
from produtos p;

-- =========================================================
-- SEGURANÇA (RLS) — só usuários autenticados (funcionários logados)
-- podem ler/gravar. Ajuste depois se quiser permissões por cargo.
-- =========================================================
alter table funcionarios enable row level security;
alter table fornecedores enable row level security;
alter table materias_primas enable row level security;
alter table produtos enable row level security;
alter table ficha_tecnica enable row level security;
alter table recebimentos enable row level security;
alter table producoes enable row level security;
alter table producao_consumo enable row level security;
alter table clientes enable row level security;
alter table pedidos enable row level security;
alter table pedido_itens enable row level security;
alter table despesas enable row level security;

do $$
declare t text;
begin
  for t in select unnest(array[
    'funcionarios','fornecedores','materias_primas','produtos','ficha_tecnica',
    'recebimentos','producoes','producao_consumo','clientes','pedidos','pedido_itens','despesas'
  ])
  loop
    execute format('create policy "authenticated_full_access" on %I for all using (auth.role() = ''authenticated'') with check (auth.role() = ''authenticated'');', t);
  end loop;
end $$;
