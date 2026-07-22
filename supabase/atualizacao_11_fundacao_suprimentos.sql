-- =========================================================
-- 364 — ATUALIZAÇÃO 11: FUNDAÇÃO DO MÓDULO CENTRAL DE SUPRIMENTOS
-- Etapa 1 do plano: depósitos, centros de custo, regra de recebimento
-- por item, e seed real de `unidades` (até aqui uma tabela órfã, sem
-- nenhuma linha e sem nenhuma FK apontando para ela).
--
-- Rode depois de atualizacao_10_catchup_recebimento_itens.sql.
-- Idempotente — pode rodar mais de uma vez sem duplicar dados.
-- =========================================================

-- ---------- 1. DEPÓSITOS ----------
-- Um depósito é um espaço físico de armazenamento dentro de uma unidade
-- (ex.: "Câmara fria" e "Seco" são dois depósitos do CD). Antes desta
-- migração, `local_armazenamento` em recebimento_itens era texto livre.
create table if not exists public.depositos (
  id uuid primary key default gen_random_uuid(),
  unidade_id uuid not null references unidades(id) on delete cascade,
  empresa_id uuid not null references empresas(id) on delete cascade,
  nome text not null,
  tipo text not null default 'seco' check (tipo in ('seco', 'refrigerado', 'congelado', 'outro')),
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_depositos_unidade on depositos(unidade_id);

-- ---------- 2. CENTROS DE CUSTO ----------
-- unidade_id é opcional: centros de custo administrativos (ex.: "Marketing")
-- podem não pertencer a uma unidade operacional específica.
create table if not exists public.centros_custo (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  unidade_id uuid references unidades(id) on delete set null,
  nome text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_centros_custo_empresa on centros_custo(empresa_id);

-- ---------- 3. REGRA DE RECEBIMENTO POR ITEM (materias_primas) ----------
-- Controla como a tela de Recebimento se comporta para cada item — ver
-- app/recebimentos: o formulário passa a mudar dinamicamente conforme
-- `controle_recebimento` do item selecionado, em vez de tratar todo item
-- da mesma forma (comportamento atual).
alter table materias_primas add column if not exists controle_recebimento text not null default 'simples'
  check (controle_recebimento in ('simples', 'validade', 'lote'));
alter table materias_primas add column if not exists controla_validade boolean not null default false;
alter table materias_primas add column if not exists controla_lote boolean not null default false;
alter table materias_primas add column if not exists exige_temperatura boolean not null default false;
alter table materias_primas add column if not exists exige_inspecao boolean not null default false;
alter table materias_primas add column if not exists exige_foto boolean not null default false;
alter table materias_primas add column if not exists exige_documento_sanitario boolean not null default false;
alter table materias_primas add column if not exists dias_minimos_validade integer;
alter table materias_primas add column if not exists permite_recebimento_parcial boolean not null default true;
alter table materias_primas add column if not exists deposito_padrao_id uuid references depositos(id);
alter table materias_primas add column if not exists estoque_minimo numeric(12,4);
alter table materias_primas add column if not exists ativo boolean not null default true;

-- Backfill de coerência: itens já existentes hoje sempre passavam por lote
-- + validade no formulário atual (ver diagnóstico) — então nascem como
-- Tipo C (lote completo) para não perder controle já em uso na prática;
-- o usuário pode rebaixar manualmente os itens que forem, de fato, simples.
update materias_primas
set controle_recebimento = 'lote', controla_validade = true, controla_lote = true, exige_temperatura = true
where controle_recebimento = 'simples'
  and exists (select 1 from recebimento_itens ri where ri.materia_prima_id = materias_primas.id);

-- ---------- 4. SEED DE UNIDADES ----------
-- Uma unidade "Loja" (matriz) por empresa do grupo, mais a unidade
-- especial "CD" (Centro de Distribuição), que recebe e distribui para
-- todas as marcas — hospedada sob 364 Food Service, que já concentra os
-- dados reais de recebimento/estoque hoje.
insert into unidades (empresa_id, nome, tipo, descricao)
select e.id, 'Matriz', 'matriz', 'Unidade principal de ' || e.nome
from empresas e
where not exists (select 1 from unidades u where u.empresa_id = e.id and u.nome = 'Matriz');

insert into unidades (empresa_id, nome, tipo, descricao)
select e.id, 'CD', 'operacao', 'Centro de Distribuição do Grupo 364 — recebe e distribui para todas as marcas'
from empresas e
where e.slug = 'food-service'
  and not exists (select 1 from unidades u where u.empresa_id = e.id and u.nome = 'CD');

-- ---------- 5. SEED DE DEPÓSITOS DO CD ----------
insert into depositos (unidade_id, empresa_id, nome, tipo)
select u.id, u.empresa_id, v.nome, v.tipo
from unidades u
cross join (values
  ('Seco', 'seco'),
  ('Câmara fria', 'refrigerado'),
  ('Congelados', 'congelado')
) as v(nome, tipo)
where u.nome = 'CD'
  and not exists (select 1 from depositos d where d.unidade_id = u.id and d.nome = v.nome);

-- ---------- 6. RLS (mesmo padrão empresa_scoped_access das demais tabelas) ----------
alter table depositos enable row level security;
drop policy if exists "empresa_scoped_access" on depositos;
create policy "empresa_scoped_access" on depositos
  for all
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()))
  with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

alter table centros_custo enable row level security;
drop policy if exists "empresa_scoped_access" on centros_custo;
create policy "empresa_scoped_access" on centros_custo
  for all
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()))
  with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));
