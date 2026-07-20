-- =========================================================
-- ATUALIZAÇÃO 06 — Produção em duas etapas: DEFUMAÇÃO → EMBALAGEM
-- (19/07/2026) Ficha de defumação com horários, temperatura, perda de
-- limpeza e sobras por matéria-prima; ficha de embalagem que gera o
-- produto final; estoque intermediário de proteína defumada.
-- Rode no SQL Editor do Supabase.
-- =========================================================

-- ---------- DEFUMAÇÃO (uma ficha por sessão; vários itens de MP) ----------
create table if not exists defumacoes (
  id uuid primary key default gen_random_uuid(),
  lote text not null,                        -- LT-DD/MM/AA-XXX
  data date not null default current_date,
  hora_inicio time,                          -- início da defumação
  hora_fim time,                             -- fim da defumação
  temperatura_c numeric(5,1),                -- temperatura da defumação (°C)
  responsavel_id uuid references funcionarios(id),
  obs text,
  created_at timestamptz not null default now()
);

create table if not exists defumacao_itens (
  id uuid primary key default gen_random_uuid(),
  defumacao_id uuid not null references defumacoes(id) on delete cascade,
  materia_prima_id uuid not null references materias_primas(id),
  peso_bruto_kg numeric(12,3) not null,      -- MP crua que entrou na manipulação
  perda_limpeza_kg numeric(12,3) not null default 0,  -- descartado na limpeza
  sobra_kg numeric(12,3) not null default 0, -- sobra aproveitável (não defumada)
  peso_final_kg numeric(12,3) not null       -- proteína defumada obtida
);

-- ---------- EMBALAGEM (uma ficha por sessão; vários produtos) ----------
create table if not exists embalagens (
  id uuid primary key default gen_random_uuid(),
  lote text not null,
  data date not null default current_date,
  responsavel_id uuid references funcionarios(id),
  sobra_kg numeric(12,3) not null default 0, -- sobra de material após a manipulação
  obs text,
  created_at timestamptz not null default now()
);

create table if not exists embalagem_itens (
  id uuid primary key default gen_random_uuid(),
  embalagem_id uuid not null references embalagens(id) on delete cascade,
  produto_id uuid not null references produtos(id),
  quantidade numeric(12,3) not null,         -- unidades embaladas
  peso_total_kg numeric(12,3)                -- peso real dos produtos finalizados
);

-- ---------- SEGURANÇA ----------
alter table defumacoes enable row level security;
alter table defumacao_itens enable row level security;
alter table embalagens enable row level security;
alter table embalagem_itens enable row level security;

create policy authenticated_full_access on defumacoes for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy authenticated_full_access on defumacao_itens for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy authenticated_full_access on embalagens for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy authenticated_full_access on embalagem_itens for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ---------- VIEWS DE ESTOQUE (recriadas) ----------
-- MP crua: recebido − consumido (produções antigas + defumações)
drop view if exists vw_estoque_materia_prima;
create view vw_estoque_materia_prima as
select
  mp.id as materia_prima_id,
  mp.nome,
  mp.unidade,
  coalesce((select sum(r.quantidade) from recebimentos r where r.materia_prima_id = mp.id), 0) as total_recebido,
  coalesce((select sum(pc.quantidade) from producao_consumo pc where pc.materia_prima_id = mp.id), 0)
    + coalesce((select sum(di.peso_bruto_kg) from defumacao_itens di where di.materia_prima_id = mp.id), 0) as total_consumido,
  coalesce((select sum(r.quantidade) from recebimentos r where r.materia_prima_id = mp.id), 0)
    - coalesce((select sum(pc.quantidade) from producao_consumo pc where pc.materia_prima_id = mp.id), 0)
    - coalesce((select sum(di.peso_bruto_kg) from defumacao_itens di where di.materia_prima_id = mp.id), 0) as saldo
from materias_primas mp;

-- Defumado disponível (kg): entra pela defumação, sai pela embalagem
-- (consumo calculado pela ficha técnica do produto: kg de defumado por unidade)
create or replace view vw_estoque_defumado as
select
  mp.id as materia_prima_id,
  mp.nome,
  coalesce((select sum(di.peso_final_kg) from defumacao_itens di where di.materia_prima_id = mp.id), 0) as total_defumado,
  coalesce((select sum(ei.quantidade * ft.quantidade)
            from embalagem_itens ei
            join ficha_tecnica ft on ft.produto_id = ei.produto_id and ft.materia_prima_id = mp.id), 0) as total_embalado,
  coalesce((select sum(di.peso_final_kg) from defumacao_itens di where di.materia_prima_id = mp.id), 0)
    - coalesce((select sum(ei.quantidade * ft.quantidade)
                from embalagem_itens ei
                join ficha_tecnica ft on ft.produto_id = ei.produto_id and ft.materia_prima_id = mp.id), 0) as saldo_kg
from materias_primas mp;

-- Produto acabado: produções antigas + embalagens − vendas
drop view if exists vw_estoque_produto;
create view vw_estoque_produto as
select
  p.id as produto_id,
  p.codigo,
  p.nome,
  p.unidade,
  coalesce((select sum(pr.quantidade) from producoes pr where pr.produto_id = p.id), 0)
    + coalesce((select sum(ei.quantidade) from embalagem_itens ei where ei.produto_id = p.id), 0) as total_produzido,
  coalesce((select sum(pi.quantidade) from pedido_itens pi join pedidos pe on pe.id = pi.pedido_id
            where pi.produto_id = p.id and pe.status <> 'Cancelado'), 0) as total_vendido,
  coalesce((select sum(pr.quantidade) from producoes pr where pr.produto_id = p.id), 0)
    + coalesce((select sum(ei.quantidade) from embalagem_itens ei where ei.produto_id = p.id), 0)
    - coalesce((select sum(pi.quantidade) from pedido_itens pi join pedidos pe on pe.id = pi.pedido_id
                where pi.produto_id = p.id and pe.status <> 'Cancelado'), 0) as saldo
from produtos p;

-- Nota: a partir desta atualização, a FICHA TÉCNICA do produto passa a
-- significar "kg de proteína DEFUMADA por unidade embalada" (ex.: Costela
-- Defumada 500g = 0.500 de Costela Suína defumada). Revise as fichas.
