# Lote de produto acabado no romaneio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a chave de rastreio de lote na expedição de "matéria-prima" (`recebimento_item_id`) para "embalagem/produção" (`embalagem_id`), eliminando a ambiguidade documentada no código, e dar ao operador do romaneio uma seção editável de alocação por produto/lote (hoje 100% automática e invisível).

**Architecture:** Migração aditiva (`atualizacao_54`) adiciona `expedicao_itens.embalagem_id` e reescreve `vw_estoque_produto_lote` pra agrupar por `produto_id + embalagem_id` (em vez de `produto_id + recebimento_item_id`), trazendo `embalagens.lote`/`embalagens.data` sem ambiguidade. `lib/expedicao.js` (lógica pura de FEFO/empacotamento) só troca o nome do campo. A API de salvar romaneio grava a coluna nova. A tela de romaneio ganha uma seção de alocação editável por produto, que alimenta o mesmo `empacotarCaixas` de sempre.

**Tech Stack:** Next.js (App Router), Supabase/Postgres, `node:test` (testes puros), Postgres local descartável (testes de migração, padrão `tests/migracao-NN/`).

**Spec:** `docs/superpowers/specs/2026-09-16-lote-produto-acabado-expedicao-design.md`

## Global Constraints

- Migração é aditiva: sem `drop column`, sem backfill de `expedicao_itens` históricos (spec, seção "Modelo de dados").
- `embalagem_id` é nullable em `expedicao_itens` — mesma semântica de "sem lote" que `recebimento_item_id` já tem hoje.
- `vw_estoque_produto_lote` só considera `embalagens.status = 'finalizada'` (spec, seção "Modelo de dados").
- `validade` da view é `min(embalagem_itens.validade)` dentro do grupo produto+embalagem (spec).
- "Caixas" continua só como resultado auto-calculado de `empacotarCaixas` — não vira editável direto (spec, seção "Frontend").

---

### Task 1: Migração 54 — `embalagem_id` em `expedicao_itens` e reescrita de `vw_estoque_produto_lote`

**Files:**
- Create: `supabase/atualizacao_54_lote_produto_acabado_expedicao.sql`
- Test: `tests/migracao-54/fixture.sql`, `tests/migracao-54/cenarios.sql`, `tests/migracao-54/verificar.sh`

**Interfaces:**
- Produces: coluna `public.expedicao_itens.embalagem_id uuid references public.embalagens(id)`; view `public.vw_estoque_produto_lote` com colunas `(empresa_id, produto_id, embalagem_id, lote, fabricacao, validade, total_embalado, total_expedido, saldo)`.

- [ ] **Step 1: Escrever a migração**

`supabase/atualizacao_54_lote_produto_acabado_expedicao.sql`:

```sql
-- supabase/atualizacao_54_lote_produto_acabado_expedicao.sql
--
-- Troca a chave de rastreio de lote na expedição de matéria-prima
-- (expedicao_itens.recebimento_item_id) para embalagem/produção
-- (embalagem_id) — o código impresso na etiqueta do produto acabado, não o
-- lote de origem da matéria-prima. Resolve a ambiguidade documentada em
-- app/expedicao/[id]/page.js: quando duas embalagens diferentes consomem a
-- mesma matéria-prima, o sistema não tinha como saber qual embalagem
-- originou uma unidade expedida específica. Spec:
-- docs/superpowers/specs/2026-09-16-lote-produto-acabado-expedicao-design.md
--
-- Aditiva: recebimento_item_id fica na tabela (romaneios já finalizados não
-- mudam); só gravações novas passam a preencher embalagem_id.
begin;

alter table public.expedicao_itens
  add column if not exists embalagem_id uuid references public.embalagens(id);
create index if not exists expedicao_itens_embalagem_idx on public.expedicao_itens(embalagem_id);

-- Junto com a troca de chave: (a) validade vira min() dentro do grupo
-- produto+embalagem (uma embalagem pode ter consumido mais de uma matéria-
-- prima com validades diferentes pro mesmo produto — a mais próxima é a que
-- importa); (b) embalagem em rascunho para de contar como saldo disponível
-- (bug lateral fechado junto, aprovado no design).
create or replace view public.vw_estoque_produto_lote as
select
  ei.empresa_id,
  ei.produto_id,
  ei.embalagem_id,
  emb.lote,
  emb.data as fabricacao,
  min(ei.validade) as validade,
  sum(ei.quantidade) as total_embalado,
  coalesce((
    select sum(exi.quantidade) from public.expedicao_itens exi
    join public.expedicao_caixas ec on ec.id = exi.expedicao_caixa_id
    join public.expedicoes ex on ex.id = ec.expedicao_id
    where exi.embalagem_id = ei.embalagem_id
      and exi.produto_id = ei.produto_id
      and ex.status <> 'cancelado'
  ), 0) as total_expedido,
  sum(ei.quantidade) - coalesce((
    select sum(exi.quantidade) from public.expedicao_itens exi
    join public.expedicao_caixas ec on ec.id = exi.expedicao_caixa_id
    join public.expedicoes ex on ex.id = ec.expedicao_id
    where exi.embalagem_id = ei.embalagem_id
      and exi.produto_id = ei.produto_id
      and ex.status <> 'cancelado'
  ), 0) as saldo
from public.embalagem_itens ei
join public.embalagens emb on emb.id = ei.embalagem_id and emb.status = 'finalizada'
group by ei.empresa_id, ei.produto_id, ei.embalagem_id, emb.lote, emb.data;

commit;

-- ---------- ROLLBACK ----------
-- begin;
-- create or replace view public.vw_estoque_produto_lote as
-- select
--   ei.empresa_id,
--   ei.produto_id,
--   ei.recebimento_item_id,
--   ei.validade,
--   sum(ei.quantidade) as total_embalado,
--   coalesce((
--     select sum(exi.quantidade) from public.expedicao_itens exi
--     join public.expedicao_caixas ec on ec.id = exi.expedicao_caixa_id
--     join public.expedicoes ex on ex.id = ec.expedicao_id
--     where exi.recebimento_item_id = ei.recebimento_item_id
--       and exi.produto_id = ei.produto_id
--       and ex.status <> 'cancelado'
--   ), 0) as total_expedido,
--   sum(ei.quantidade) - coalesce((
--     select sum(exi.quantidade) from public.expedicao_itens exi
--     join public.expedicao_caixas ec on ec.id = exi.expedicao_caixa_id
--     join public.expedicoes ex on ex.id = ec.expedicao_id
--     where exi.recebimento_item_id = ei.recebimento_item_id
--       and exi.produto_id = ei.produto_id
--       and ex.status <> 'cancelado'
--   ), 0) as saldo
-- from public.embalagem_itens ei
-- where ei.recebimento_item_id is not null
-- group by ei.empresa_id, ei.produto_id, ei.recebimento_item_id, ei.validade;
-- alter table public.expedicao_itens drop column if exists embalagem_id;
-- commit;
```

- [ ] **Step 2: Escrever a fixture do teste de migração**

`tests/migracao-54/fixture.sql` — schema mínimo PRÉ-migração 54 (expedicao_itens sem `embalagem_id`, view como a atualização 50 a deixou), mesmo estilo de `tests/migracao-50/fixture.sql`:

```sql
-- tests/migracao-54/fixture.sql
-- Base mínima pra exercitar a atualização 54 num Postgres local descartável.
-- Schema tal como a atualização 50 o deixou (pré-54): expedicao_itens sem
-- embalagem_id, vw_estoque_produto_lote agrupando por recebimento_item_id.
create extension if not exists pgcrypto;

create table public.empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null
);
create table public.produtos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id)
);
create table public.clientes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id)
);
create table public.pedidos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  cliente_id uuid references public.clientes(id),
  status text not null default 'Pendente'
);
create table public.pedido_itens (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  produto_id uuid not null references public.produtos(id),
  quantidade numeric(12,4) not null,
  preco_unitario numeric(12,2) not null default 0
);
create table public.recebimento_itens (
  id uuid primary key default gen_random_uuid(),
  validade date
);

-- embalagens tal como a atualização 30 a criou (colunas mínimas usadas aqui).
create table public.embalagens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  lote text not null,
  data date not null default current_date,
  status text not null default 'rascunho'
);
create table public.embalagem_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id),
  embalagem_id uuid references public.embalagens(id),
  produto_id uuid references public.produtos(id),
  recebimento_item_id uuid references public.recebimento_itens(id),
  quantidade numeric(12,3) not null,
  validade date
);

create table public.expedicoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  pedido_id uuid references public.pedidos(id),
  status text not null default 'rascunho'
);
create table public.expedicao_caixas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  expedicao_id uuid not null references public.expedicoes(id) on delete cascade,
  numero int not null
);
create table public.expedicao_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  expedicao_caixa_id uuid not null references public.expedicao_caixas(id) on delete cascade,
  pedido_item_id uuid not null references public.pedido_itens(id),
  produto_id uuid not null references public.produtos(id),
  recebimento_item_id uuid references public.recebimento_itens(id),
  quantidade numeric(12,4) not null check (quantidade > 0)
);

-- View tal como a atualização 50 a deixou (pré-54) — a 54 faz `create or
-- replace`, então o teste prova a transição real.
create or replace view public.vw_estoque_produto_lote as
select
  ei.empresa_id, ei.produto_id, ei.recebimento_item_id, ei.validade,
  sum(ei.quantidade) as total_embalado,
  0::numeric as total_expedido,
  sum(ei.quantidade) as saldo
from public.embalagem_itens ei
where ei.recebimento_item_id is not null
group by ei.empresa_id, ei.produto_id, ei.recebimento_item_id, ei.validade;

insert into public.empresas (id, nome) values
  ('11111111-1111-1111-1111-111111111111', 'Empresa Teste');
insert into public.produtos (id, empresa_id) values
  ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');
insert into public.clientes (id, empresa_id) values
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');
insert into public.pedidos (id, empresa_id, cliente_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000001');
insert into public.pedido_itens (id, pedido_id, produto_id, quantidade) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', 10);
insert into public.recebimento_itens (id, validade) values
  ('66666666-0000-0000-0000-000000000001', '2026-12-01');

-- Cenário-chave: DUAS embalagens finalizadas diferentes, mesmo produto,
-- consumindo a MESMA matéria-prima (mesmo recebimento_item_id) — é
-- exatamente a ambiguidade que a 54 corrige.
insert into public.embalagens (id, empresa_id, lote, data, status) values
  ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'LOTE-A', '2026-09-01', 'finalizada'),
  ('e0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'LOTE-B', '2026-09-02', 'finalizada'),
  -- Embalagem em rascunho — não deve contar como saldo disponível.
  ('e0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'LOTE-C-RASCUNHO', '2026-09-03', 'rascunho');
insert into public.embalagem_itens (id, empresa_id, embalagem_id, produto_id, recebimento_item_id, quantidade, validade) values
  ('f0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'e0000000-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
   '66666666-0000-0000-0000-000000000001', 5, '2026-12-01'),
  ('f0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'e0000000-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000001',
   '66666666-0000-0000-0000-000000000001', 7, '2026-11-15'),
  ('f0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'e0000000-0000-0000-0000-000000000003', 'dddddddd-0000-0000-0000-000000000001',
   '66666666-0000-0000-0000-000000000001', 100, '2026-12-01');

-- Expedição finalizada já consumiu 2 unidades do LOTE-A — prova que o
-- desconto de saldo é por embalagem, não mais fundido por matéria-prima.
insert into public.expedicoes (id, empresa_id, pedido_id, status) values
  ('11110000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000001', 'finalizado');
insert into public.expedicao_caixas (id, empresa_id, expedicao_id, numero) values
  ('caaa0000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '11110000-0000-0000-0000-000000000001', 1);
insert into public.expedicao_itens (id, empresa_id, expedicao_caixa_id, pedido_item_id, produto_id, recebimento_item_id, quantidade) values
  ('ei000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'caaa0000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000001', '66666666-0000-0000-0000-000000000001', 2);
```

Nota: como `expedicao_itens` (fixture, pré-migração) só tem `recebimento_item_id`, esta linha de "já expedido" fica sem vínculo de embalagem — é dado histórico legítimo (romaneio de antes da 54), e a migração não a toca. Depois de rodar a migração, esta linha existente continua com `embalagem_id` nulo — o cenário de saldo por embalagem usa só as linhas novas que o teste insere no passo 3.

- [ ] **Step 3: Escrever os cenários**

`tests/migracao-54/cenarios.sql`:

```sql
-- tests/migracao-54/cenarios.sql
\set ON_ERROR_STOP on

-- Cenário 1: coluna embalagem_id existe e aceita null.
do $$
declare v_tipo text;
begin
  select data_type into v_tipo from information_schema.columns
    where table_schema = 'public' and table_name = 'expedicao_itens' and column_name = 'embalagem_id';
  if v_tipo is null then
    raise exception 'FALHA 1: coluna expedicao_itens.embalagem_id não existe';
  end if;
  raise notice 'OK 1: expedicao_itens.embalagem_id existe (%)', v_tipo;
end $$;

-- Cenário 2: a view agora traz DUAS linhas pro produto (uma por embalagem),
-- não uma só fundida por matéria-prima — a ambiguidade que motivou a 54.
do $$
declare v_linhas int;
begin
  select count(*) into v_linhas from public.vw_estoque_produto_lote
    where produto_id = 'dddddddd-0000-0000-0000-000000000001'
      and embalagem_id in ('e0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002');
  if v_linhas <> 2 then
    raise exception 'FALHA 2: esperava 2 linhas (uma por embalagem), achou %', v_linhas;
  end if;
  raise notice 'OK 2: view não funde mais embalagens diferentes que usaram a mesma matéria-prima';
end $$;

-- Cenário 3: embalagem em rascunho não aparece — saldo não conta o que não
-- foi finalizado.
do $$
declare v_linhas int;
begin
  select count(*) into v_linhas from public.vw_estoque_produto_lote
    where embalagem_id = 'e0000000-0000-0000-0000-000000000003';
  if v_linhas <> 0 then
    raise exception 'FALHA 3: embalagem em rascunho apareceu na view (% linhas)', v_linhas;
  end if;
  raise notice 'OK 3: embalagem em rascunho não conta como saldo disponível';
end $$;

-- Cenário 4: lote/fabricação vêm certos, sem ambiguidade, e saldo = total
-- embalado (nenhuma expedição referencia embalagem_id ainda nesta linha).
do $$
declare v_lote text; v_saldo numeric;
begin
  select lote, saldo into v_lote, v_saldo from public.vw_estoque_produto_lote
    where embalagem_id = 'e0000000-0000-0000-0000-000000000001';
  if v_lote is distinct from 'LOTE-A' then
    raise exception 'FALHA 4a: lote esperado LOTE-A, veio %', v_lote;
  end if;
  if v_saldo <> 5 then
    raise exception 'FALHA 4b: saldo esperado 5, veio %', v_saldo;
  end if;
  raise notice 'OK 4: lote e saldo corretos pra LOTE-A';
end $$;

-- Cenário 5: expedição (não cancelada) referenciando embalagem_id desconta
-- do saldo daquela embalagem específica, sem afetar a outra que usou a
-- mesma matéria-prima.
do $$
declare v_saldo_a numeric; v_saldo_b numeric;
begin
  insert into public.expedicoes (id, empresa_id, pedido_id, status) values
    ('11110000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
     'aaaaaaaa-0000-0000-0000-000000000001', 'finalizado');
  insert into public.expedicao_caixas (id, empresa_id, expedicao_id, numero) values
    ('caaa0000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
     '11110000-0000-0000-0000-000000000002', 1);
  insert into public.expedicao_itens (id, empresa_id, expedicao_caixa_id, pedido_item_id, produto_id, embalagem_id, quantidade) values
    ('ei000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
     'caaa0000-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001',
     'dddddddd-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 3);

  select saldo into v_saldo_a from public.vw_estoque_produto_lote where embalagem_id = 'e0000000-0000-0000-0000-000000000001';
  select saldo into v_saldo_b from public.vw_estoque_produto_lote where embalagem_id = 'e0000000-0000-0000-0000-000000000002';
  if v_saldo_a <> 2 then
    raise exception 'FALHA 5a: saldo do LOTE-A esperado 2 (5-3), veio %', v_saldo_a;
  end if;
  if v_saldo_b <> 7 then
    raise exception 'FALHA 5b: saldo do LOTE-B esperado 7 (intocado), veio %', v_saldo_b;
  end if;
  raise notice 'OK 5: desconto de saldo é por embalagem, não fundido por matéria-prima';
end $$;

-- Cenário 6: expedição CANCELADA não desconta do saldo.
do $$
declare v_saldo numeric;
begin
  insert into public.expedicoes (id, empresa_id, pedido_id, status) values
    ('11110000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
     'aaaaaaaa-0000-0000-0000-000000000001', 'cancelado');
  insert into public.expedicao_caixas (id, empresa_id, expedicao_id, numero) values
    ('caaa0000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
     '11110000-0000-0000-0000-000000000003', 1);
  insert into public.expedicao_itens (id, empresa_id, expedicao_caixa_id, pedido_item_id, produto_id, embalagem_id, quantidade) values
    ('ei000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
     'caaa0000-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000001',
     'dddddddd-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002', 4);

  select saldo into v_saldo from public.vw_estoque_produto_lote where embalagem_id = 'e0000000-0000-0000-0000-000000000002';
  if v_saldo <> 7 then
    raise exception 'FALHA 6: saldo do LOTE-B deveria seguir 7 (expedição cancelada não desconta), veio %', v_saldo;
  end if;
  raise notice 'OK 6: expedição cancelada não desconta do saldo';
end $$;
```

- [ ] **Step 4: Escrever o runner**

`tests/migracao-54/verificar.sh` (mesmo padrão de `tests/migracao-52/verificar.sh`, só trocando nomes):

```bash
#!/usr/bin/env bash
# tests/migracao-54/verificar.sh
# Mesmo padrão de tests/migracao-52/verificar.sh — Postgres local descartável.
set -euo pipefail
export PGOPTIONS='-c client_min_messages=notice'

AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
BANCO="${BANCO_TESTE_LOTE_EXPEDICAO:-lote_produto_acabado_expedicao_test_364}"
MIGRACAO="$RAIZ/supabase/atualizacao_54_lote_produto_acabado_expedicao.sql"

command -v psql >/dev/null || { echo "psql não encontrado no PATH"; exit 1; }
pg_isready -q || { echo "nenhum Postgres local aceitando conexões"; exit 1; }

limpar() { dropdb --if-exists "$BANCO" >/dev/null 2>&1 || true; }
trap limpar EXIT
limpar
createdb "$BANCO"

psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/fixture.sql"

# Duas vezes seguidas: prova idempotência (add column if not exists / create or replace).
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$MIGRACAO"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$MIGRACAO"

psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/cenarios.sql"

echo "MIGRAÇÃO 54 OK"
```

Dar permissão de execução:

```bash
chmod +x tests/migracao-54/verificar.sh
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `bash tests/migracao-54/verificar.sh`
Expected: `OK 1` a `OK 6`, termina com `MIGRAÇÃO 54 OK`, sem `FALHA`.

Se algum cenário falhar, o erro nomeia o cenário (`FALHA N: ...`) — ajuste a migração (não o cenário) até bater.

- [ ] **Step 6: Commit**

```bash
git add supabase/atualizacao_54_lote_produto_acabado_expedicao.sql tests/migracao-54/
git commit -m "feat(expedicao): migração 54 — lote de produto acabado (embalagem) em vez de matéria-prima"
```

---

### Task 2: `lib/expedicao.js` — renomear `recebimentoItemId` para `embalagemId`

**Files:**
- Modify: `lib/expedicao.js:10-44` (`ordenarFefo`, `sugerirAlocacao`), `lib/expedicao.js:54-83` (`empacotarCaixas`)
- Test: `tests/expedicao.test.mjs` (todo o arquivo usa `recebimentoItemId` hoje)

**Interfaces:**
- Consumes: nada de outra task.
- Produces: `sugerirAlocacao(itensPedido, lotesPorProduto)` devolve `{ pedidoItemId, embalagemId, quantidade }[]` (campo renomeado); `lotesPorProduto[produtoId]` agora é `{ embalagemId, validade, saldo }[]`; `empacotarCaixas(alocacao, produtoPorPedidoItemId)` devolve caixas com itens `{ pedidoItemId, embalagemId, quantidade }`.

- [ ] **Step 1: Atualizar o teste (RED) — trocar `recebimentoItemId` por `embalagemId` em todo o arquivo**

Em `tests/expedicao.test.mjs`, substituir **toda ocorrência** de `recebimentoItemId` por `embalagemId` (são 13 ocorrências, em `ordenarFefo`, `sugerirAlocacao` e `empacotarCaixas` — `calcularDivergencia`/`calcularVolumesNfe`/`proximoNumeroExpedicao` não usam o campo, não mexem). Exemplo da primeira mudança:

```javascript
test('ordenarFefo: lote que vence primeiro vem primeiro', () => {
  const lotes = [
    { embalagemId: 'b', validade: '2026-12-01', saldo: 10 },
    { embalagemId: 'a', validade: '2026-10-01', saldo: 5 },
  ];
  const ordenado = ordenarFefo(lotes);
  assert.deepEqual(ordenado.map(l => l.embalagemId), ['a', 'b']);
});
```

(Repita a troca de nome — só o nome do campo, nenhum outro valor — nos outros 6 testes que usam o campo.)

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test tests/expedicao.test.mjs`
Expected: FAIL — `assert.deepEqual` comparando `embalagemId: undefined` (o código ainda devolve `recebimentoItemId`) contra o valor esperado.

- [ ] **Step 3: Renomear no código-fonte**

Em `lib/expedicao.js`, `sugerirAlocacao` (linha ~35):

```javascript
        alocacao.push({ pedidoItemId: item.pedidoItemId, embalagemId: lote.embalagemId, quantidade: usar });
```

E a linha do fallback "sem lote" (~40):

```javascript
      alocacao.push({ pedidoItemId: item.pedidoItemId, embalagemId: null, quantidade: restante });
```

Em `empacotarCaixas` (linha ~78):

```javascript
      atual.push({ pedidoItemId: item.pedidoItemId, embalagemId: item.embalagemId, quantidade: usar });
```

Os comentários das duas funções (linhas 8-9, 19-23, 44-53) continuam válidos como estão — falam de "lote", não citam o nome do campo.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test tests/expedicao.test.mjs`
Expected: PASS, 17 testes.

- [ ] **Step 5: Rodar a suíte inteira (garantir que nada mais quebrou)**

Run: `node --test tests/*.test.mjs`
Expected: todos passam (nenhum outro arquivo de teste referencia `recebimentoItemId` de `lib/expedicao.js` — confirmar com `grep -rn recebimentoItemId tests/` que só aparece nas migrações de SQL, não em `.test.mjs`).

- [ ] **Step 6: Commit**

```bash
git add lib/expedicao.js tests/expedicao.test.mjs
git commit -m "refactor(expedicao): renomeia recebimentoItemId para embalagemId em lib/expedicao.js"
```

---

### Task 3: Backend — gravar `embalagem_id` e carregar saldo por embalagem

**Files:**
- Modify: `app/api/expedicao/[id]/route.js:75-79`
- Modify: `app/expedicao/[id]/page.js:73-166` (`carregar`, remove `carregarFabricacaoValidade`)

**Interfaces:**
- Consumes: `sugerirAlocacao`/`embalagemId` de Task 2; view `vw_estoque_produto_lote` (colunas `embalagem_id, lote, fabricacao, validade, saldo`) de Task 1.
- Produces: estado `lotesPorProduto` (`{ [produtoId]: { embalagemId, lote, fabricacao, validade, saldo }[] }`) usado por Task 4 (seção de alocação editável) e pela impressão de etiqueta.

- [ ] **Step 1: Rota PUT — gravar `embalagem_id`**

Em `app/api/expedicao/[id]/route.js`, trocar a montagem de `linhasItens` (linha 75-79):

```javascript
    const linhasItens = (caixa.itens || []).map(item => ({
      empresa_id: expedicao.empresa_id, expedicao_caixa_id: caixaGravada.id,
      pedido_item_id: item.pedidoItemId, produto_id: item.produtoId,
      embalagem_id: item.embalagemId || null, quantidade: item.quantidade,
    }));
```

- [ ] **Step 2: Tela — carregar `lotesPorProduto` sem filtrar saldo, e usar em vez de `carregarFabricacaoValidade`**

Em `app/expedicao/[id]/page.js`:

1. Remover o estado `fabricacaoValidadePorItem` (linha 50) e a função `carregarFabricacaoValidade` inteira (linhas 141-166) — a informação vai vir de `lotesPorProduto` (novo estado abaixo), sem a ambiguidade de "fica a primeira encontrada" que motivava aquela função.

2. Adicionar estado novo, junto dos outros `useState` (perto da linha 39):

```javascript
  // Saldo por produto+embalagem (Task 1: vw_estoque_produto_lote agrupada
  // por embalagem, não mais por matéria-prima) — alimenta a sugestão FEFO
  // de um rascunho novo E as opções de lote da seção de alocação editável
  // (Task 4). Sem filtrar saldo>0 aqui: reabrindo um rascunho salvo, o
  // lote que ele já usa precisa aparecer mesmo com saldo zerado por si
  // mesmo (mesmo raciocínio que já existia pra não re-rodar sugerirAlocacao
  // num rascunho salvo, comentário abaixo).
  const [lotesPorProduto, setLotesPorProduto] = useState({});
```

3. Substituir o trecho inteiro de `carregar()` que vai de "Reabrindo um rascunho..." (comentário, linha 104 atual) até o final da função (linha 139 atual, `}` que fecha `carregar`) por:

```javascript
    // Saldo por produto+embalagem (Task 1) dos produtos deste pedido — sem
    // filtro de saldo>0 na consulta (ver comentário do estado
    // lotesPorProduto, acima); o filtro pra sugestão de rascunho novo é
    // feito abaixo, em JS, só ali onde faz diferença.
    const produtoIds = [...new Set((itens || []).map(i => i.produto_id))];
    const { data: saldosLote } = produtoIds.length
      ? await supabase.from('vw_estoque_produto_lote').select('*').eq('empresa_id', empresaAtual.id).in('produto_id', produtoIds)
      : { data: [] };
    const porProduto = {};
    for (const l of saldosLote || []) {
      (porProduto[l.produto_id] ||= []).push({
        embalagemId: l.embalagem_id, lote: l.lote, fabricacao: l.fabricacao, validade: l.validade, saldo: Number(l.saldo),
      });
    }
    setLotesPorProduto(porProduto);

    // Reabrindo um rascunho que já foi salvo antes: usa a alocação que já
    // está gravada, não uma sugestão nova. `vw_estoque_produto_lote.saldo`
    // já desconta as PRÓPRIAS linhas deste rascunho (via total_expedido),
    // então rodar sugerirAlocacao de novo aqui leria esse lote como
    // consumido e degradaria a alocação rastreada pra "sem lote" em
    // silêncio — o total bateria (calcularDivergencia não vê problema), mas
    // a rastreabilidade do lote se perderia sem nenhum aviso.
    const itensSalvos = (caixasSalvas || []).flatMap(c => c.expedicao_itens || []);
    if (itensSalvos.length) {
      setAlocacao(itensSalvos.map(i => ({
        pedidoItemId: i.pedido_item_id, embalagemId: i.embalagem_id, quantidade: i.quantidade,
      })));
      return;
    }

    // Rascunho novo, sem nada salvo ainda — sugere a alocação FEFO a partir
    // do saldo de lote (vw_estoque_produto_lote, Task 1) dos produtos deste
    // pedido, só com saldo>0 (porProduto acima não filtra — ver comentário
    // do estado lotesPorProduto).
    const itensPedidoParaSugestao = (itens || []).map(i => ({
      pedidoItemId: i.id, produtoId: i.produto_id, quantidade: i.quantidade, rastreado: i.produto?.rastreado,
    }));
    const porProdutoComSaldo = Object.fromEntries(
      Object.entries(porProduto).map(([pid, lotes]) => [pid, lotes.filter(l => l.saldo > 0)])
    );
    setAlocacao(sugerirAlocacao(itensPedidoParaSugestao, porProdutoComSaldo));
  }
```

- [ ] **Step 3: Select de `caixasSalvas` — embed `embalagens` em vez de `recebimento_itens`**

Trocar a linha 90-92 (select de `expedicao_caixas`):

```javascript
      supabase.from('expedicao_caixas')
        .select('*, expedicao_itens(*, produtos(codigo, nome, conservacao_texto), embalagens(lote, data))')
        .eq('expedicao_id', exp.id).order('numero'),
```

- [ ] **Step 4: Etiqueta de despacho — ler `embalagens.lote`/`.data` e `lotesPorProduto` em vez de `fabricacaoValidadePorItem`**

Em `imprimirEtiquetaCaixa` (linha 183+):

1. Linha 190, trocar a checagem de "alguma linha tem lote":

```javascript
    const algumaLinhaTemLote = itensCaixa.some(i => i.embalagens?.lote);
```

2. Linhas 216-232, trocar a montagem de `produtos`:

```javascript
      try {
        produtos = await Promise.all(itensCaixa.map(async i => {
          const fv = (lotesPorProduto[i.produto_id] || []).find(l => l.embalagemId === i.embalagem_id) || {};
          const lote = i.embalagens?.lote || null;
          const qr = lote
            ? await qrSvg(urlRastreio(empresaAtual.prefixo_codigo, lote, process.env.NEXT_PUBLIC_SITE_URL), tamanhoQr)
            : null; // sem lote (não rastreado) — nada pra apontar, a linha sai sem QR.
          return {
            codigo: i.produtos?.codigo,
            nome: i.produtos?.nome,
            lote,
            quantidade: i.quantidade,
            fabricacao: i.embalagens?.data || fv.fabricacao,
            validade: fv.validade,
            qrSvg: qr,
          };
        }));
      } catch (e) {
        setErroEtiqueta('Não foi possível gerar o QR do lote: ' + e.message);
        return;
      }
```

   (`i.embalagens?.data` já vem certo direto do embed do passo 3 — `fv.fabricacao` fica como reforço/fallback, já que `lotesPorProduto` tem a mesma informação por outro caminho.)

- [ ] **Step 5: Verificar que compila e a suíte de testes segue passando**

Run: `node --test tests/*.test.mjs && npx next build`
Expected: testes 100% verdes (nenhum arquivo de teste cobre este componente diretamente — a verificação real é o build + a checagem manual da Task 5); build sem erro de tipo/sintaxe.

- [ ] **Step 6: Commit**

```bash
git add "app/api/expedicao/[id]/route.js" "app/expedicao/[id]/page.js"
git commit -m "feat(expedicao): grava e carrega lote por embalagem em vez de matéria-prima"
```

---

### Task 4: Frontend — seção "Alocação por produto" editável

**Files:**
- Modify: `app/expedicao/[id]/page.js:168-172` (mapas auxiliares), `app/expedicao/[id]/page.js:377-385` (seção "Caixas" — label do lote), JSX (nova seção antes de "Caixas")

**Interfaces:**
- Consumes: estado `alocacao` (`{ pedidoItemId, embalagemId, quantidade }[]`) e `lotesPorProduto` de Task 3; `somenteLeitura` (já existe, linha 356).
- Produces: nada consumido por outra task — é a ponta final da UI.

- [ ] **Step 1: Funções de edição da alocação**

Adicionar perto de `saldoProduto`/antes do `return` (perto da linha 168), junto com os mapas auxiliares já existentes:

```javascript
  // produto_id por pedidoItemId — usado pra buscar as opções de lote
  // (lotesPorProduto é indexado por produto_id) a partir de uma linha de
  // alocação, que só carrega pedidoItemId.
  const produtoIdPorPedidoItemId = Object.fromEntries(pedidoItens.map(i => [i.id, i.produto_id]));

  // Rótulo do lote pra exibição (código de embalagens.lote, não o uuid) —
  // usado tanto na seção de alocação quanto no resumo de "Caixas", abaixo.
  function labelLote(produtoId, embalagemId) {
    if (!embalagemId) return 'sem lote';
    const encontrado = (lotesPorProduto[produtoId] || []).find(l => l.embalagemId === embalagemId);
    return encontrado?.lote || embalagemId;
  }

  function atualizarLinhaAlocacao(indice, campo, valor) {
    setAlocacao(alocacao.map((linha, i) => (i === indice ? { ...linha, [campo]: valor } : linha)));
  }

  function adicionarLinhaAlocacao(pedidoItemId) {
    setAlocacao([...alocacao, { pedidoItemId, embalagemId: null, quantidade: 0 }]);
  }

  function removerLinhaAlocacao(indice) {
    setAlocacao(alocacao.filter((_, i) => i !== indice));
  }
```

- [ ] **Step 2: Renderizar a seção, antes de "Caixas"**

Na JSX, antes de `<h4>Caixas ({caixas.length})</h4>` (linha 377), inserir:

```jsx
      <h4>Alocação por produto</h4>
      {pedidoItens.map(item => {
        const linhas = alocacao.map((a, idx) => ({ ...a, idx })).filter(a => a.pedidoItemId === item.id);
        const totalAlocado = linhas.reduce((s, a) => s + Number(a.quantidade || 0), 0);
        const totalPedido = Number(item.quantidade);
        const opcoesLote = lotesPorProduto[item.produto_id] || [];
        return (
          <div key={item.id} style={{ borderBottom: '1px solid var(--linha)', padding: '6px 0' }}>
            <strong>{item.produto?.nome}</strong> — pedido {totalPedido}, alocado {totalAlocado}
            {totalAlocado !== totalPedido && (
              <span className="tag warn" style={{ marginLeft: 8 }}>diferente do pedido</span>
            )}
            {linhas.map(a => (
              <div key={a.idx} className="row-actions" style={{ marginTop: 4 }}>
                <select disabled={somenteLeitura} value={a.embalagemId || ''}
                  onChange={e => atualizarLinhaAlocacao(a.idx, 'embalagemId', e.target.value || null)}>
                  <option value="">Sem lote</option>
                  {opcoesLote.map(l => (
                    <option key={l.embalagemId} value={l.embalagemId}>
                      {l.lote}{l.validade ? ` — val. ${l.validade}` : ''} — saldo {l.saldo}
                    </option>
                  ))}
                </select>
                <input type="number" min="0" step="0.001" style={{ width: 90 }} disabled={somenteLeitura}
                  value={a.quantidade}
                  onChange={e => atualizarLinhaAlocacao(a.idx, 'quantidade', Number(e.target.value))} />
                {!somenteLeitura && (
                  <button className="btn danger small" type="button" onClick={() => removerLinhaAlocacao(a.idx)}>×</button>
                )}
              </div>
            ))}
            {!somenteLeitura && (
              <button className="btn secondary small" type="button" style={{ marginTop: 4 }}
                onClick={() => adicionarLinhaAlocacao(item.id)}>
                + lote
              </button>
            )}
          </div>
        );
      })}

```

- [ ] **Step 3: Trocar o rótulo do lote no resumo de "Caixas"**

Linha 382 atual:

```jsx
            <span key={j} className="tag"> {nomeProdutoPorPedidoItemId[it.pedidoItemId] || '?'} — lote {it.recebimentoItemId || 'sem lote'} × {it.quantidade}</span>
```

vira:

```jsx
            <span key={j} className="tag"> {nomeProdutoPorPedidoItemId[it.pedidoItemId] || '?'} — lote {labelLote(produtoIdPorPedidoItemId[it.pedidoItemId], it.embalagemId)} × {it.quantidade}</span>
```

- [ ] **Step 4: Trocar a payload de `salvar()` pra usar `embalagemId`**

Linha 272 atual (dentro de `salvar()`):

```javascript
          itens: itensCaixa.map(i => ({ pedidoItemId: i.pedidoItemId, produtoId: pedidoItens.find(pi => pi.id === i.pedidoItemId)?.produto_id, embalagemId: i.embalagemId, quantidade: i.quantidade })),
```

- [ ] **Step 5: Build e regressão**

Run: `npx next build && node --test tests/*.test.mjs`
Expected: build limpo, testes verdes. (Sem teste unitário pra esta seção — é estado de componente sem lógica pura extraível; a verificação real é a Task 5, manual no browser, mesmo padrão já usado nas telas de pedido desta sessão.)

- [ ] **Step 6: Commit**

```bash
git add "app/expedicao/[id]/page.js"
git commit -m "feat(expedicao): seção de alocação por produto/lote editável no romaneio"
```

---

### Task 5: Aplicar em produção e verificar de ponta a ponta

**Files:** nenhum arquivo novo — passo de verificação/deploy.

- [ ] **Step 1: Aplicar a migração 54 em produção**

```bash
set -a && source .env.local && set +a
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/atualizacao_54_lote_produto_acabado_expedicao.sql
```

Confirmar sem erro e (opcional) checar a view nova:

```bash
psql "$SUPABASE_DB_URL" -c "select * from vw_estoque_produto_lote limit 5;"
```

- [ ] **Step 2: Verificação manual no browser (preview local, aponta pra produção)**

1. Abrir um pedido `Pendente` com item de produto rastreado e saldo de embalagem finalizada disponível → "Iniciar romaneio".
2. Confirmar que a seção "Alocação por produto" aparece com a sugestão FEFO já preenchida (lote + validade + saldo visíveis, não mais uuid de matéria-prima).
3. Trocar o lote de uma linha pra outro disponível (se houver mais de um) e confirmar que a quantidade se mantém editável.
4. "Salvar rascunho" → reabrir a página do romaneio → confirmar que a alocação salva recarrega certa (não volta pra sugestão nova).
5. "Finalizar e emitir NF-e" → confirmar que finaliza sem erro e que a etiqueta de despacho impressa mostra o lote de produção correto (não o de matéria-prima).
6. `psql` rápido: conferir que a linha nova em `expedicao_itens` tem `embalagem_id` preenchido (não `recebimento_item_id`).

- [ ] **Step 3: Commit final (se algo precisar de ajuste da verificação manual)**

Só necessário se a Step 2 encontrar algo pra corrigir — nesse caso, corrigir, re-verificar, e comitar normalmente com uma mensagem descrevendo o ajuste.
