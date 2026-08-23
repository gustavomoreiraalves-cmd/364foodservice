# Importação de vendas do PDV Consumer — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trazer para o 364 OS, por dia e por unidade, as vendas (mesa × delivery × origem), o caixa por forma de pagamento e os itens vendidos da 364 Steakhouse e da 364 Foodtruck/Afya, lendo o painel Consumer Connect.

**Architecture:** Migração 32 cria as tabelas `pdv_*` e duas views por dia. Um script Node roda no Mac via cron, usa o cookie de uma sessão do Connect, pagina os endpoints internos (JSON DataTables + fragmentos HTML), normaliza com funções puras e faz upsert no Supabase com a service role. A tela `/vendas/importacao` lê as views e a tabela de itens.

**Tech Stack:** Next.js 14 (App Router, JS sem TypeScript), Supabase (Postgres + RLS), `@supabase/supabase-js`, `cheerio` (novo, para os fragmentos HTML), `node --test` para testes, `psql` local para smoke da migração.

**Spec:** `docs/superpowers/specs/2026-08-23-importacao-vendas-consumer-design.md`

## Global Constraints

- Código, comentários, commits e docs em português, no estilo dos arquivos existentes (ver `lib/consolidado.js`, `supabase/atualizacao_29_ficha_defumacao.sql`).
- Sem TypeScript. Módulos ES (`"type": "module"` no `package.json`).
- Testes: `tests/*.test.mjs` com `node:test` + `node:assert/strict`. Rodar com `npm test`.
- Migração: `supabase/atualizacao_32_pdv_consumer.sql`, idempotente (`if not exists`, `drop policy if exists`), tudo em uma transação, rollback comentado no fim entre `-- begin;` e `-- commit;`. Nunca rodar em produção sem ok explícito do usuário (ver memória `acesso-psql-supabase-producao`).
- Valores monetários `numeric(12,2)`, quantidades `numeric(12,4)`.
- Fuso do PDV: America/Porto_Velho (UTC-4, sem horário de verão). `/Date(ms)/` e as datas `dd/mm/aaaa hh:mm:ss` do HTML são **hora local rotulada como UTC**: o instante real é `ms + 4h`; o dia local é `new Date(ms).toISOString().slice(0,10)`.
- Lojas do Connect: `-2147478159` = 364 Steakhouse (`empresas.slug = 'steakhouse'`), `-2147458165` = 364 Foodtruck/Afya (`slug = 'foodtruck-afya'`). O campo `Estabelecimento` do payload diz "364 Steakhouse" para as duas — nunca usar para identificar a loja.
- Endpoints paginados exigem corpo DataTables (`draw`, `start`, `length`, `order[0][column]`, `order[0][dir]`, `columns[i][data]`…) e header `X-Requested-With: XMLHttpRequest`. `GetProdutosVendidos` aceita corpo vazio e devolve `{data: [...]}` completo.
- Claude não digita senha: o cookie do Connect é copiado pelo usuário para `CONSUMER_CONNECT_COOKIE` no `.env.local`.
- Fixtures reais em `tests/fixtures/pdv/` (já no repositório; ver `README.md` da pasta para as linhas sintéticas).

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/atualizacao_32_pdv_consumer.sql` | tabelas `pdv_*`, views, RLS, seed de `pdv_lojas` |
| `tests/migracao-32/{fixture.sql,cenarios.sql,verificar.sh}` | smoke da migração em Postgres local |
| `lib/pdvConsumer/parse.js` | funções puras: datas, dinheiro, HTML do pedido e do caixa → objetos |
| `lib/pdvConsumer/normaliza.js` | funções puras: classificação e linhas prontas para o banco |
| `lib/pdvConsumer/connect.js` | cliente HTTP do Connect (filtros de sessão, paginação, detalhes) |
| `lib/pdvConsumer/importar.js` | orquestração por loja e janela, com cliente e banco injetados |
| `scripts/importar-pdv-consumer.mjs` | CLI: lê env, monta cliente e banco reais, chama `importar.js` |
| `scripts/IMPORTACAO-PDV.md` | como pegar o cookie, rodar, agendar |
| `lib/pdvVendas.js` | funções puras de agregação da tela |
| `app/vendas/importacao/page.js` | tela |
| `tests/pdv-parse.test.mjs`, `tests/pdv-normaliza.test.mjs`, `tests/pdv-connect.test.mjs`, `tests/pdv-importar.test.mjs`, `tests/pdv-vendas.test.mjs` | testes |

---

### Task 1: Migração 32 — tabelas, views, RLS e smoke

**Files:**
- Create: `supabase/atualizacao_32_pdv_consumer.sql`
- Create: `tests/migracao-32/fixture.sql`
- Create: `tests/migracao-32/cenarios.sql`
- Create: `tests/migracao-32/verificar.sh`

**Interfaces:**
- Produces: tabelas `pdv_lojas`, `pdv_pedidos`, `pdv_pedido_itens`, `pdv_pagamentos`, `pdv_caixas`, `pdv_caixa_movimentos`, `pdv_recebimentos`, `pdv_vendas_itens_dia`, `pdv_importacoes`; views `vw_pdv_vendas_dia`, `vw_pdv_caixa_formas_dia`. Colunas exatamente como abaixo — `normaliza.js` (Task 3) e a tela (Task 8) dependem dos nomes.

- [ ] **Step 1: Escrever o fixture mínimo do Postgres local**

`tests/migracao-32/fixture.sql`:

```sql
-- Esqueleto mínimo para exercitar a atualização 32 num Postgres local.
create schema if not exists auth;
create or replace function auth.uid() returns uuid
  language sql stable as $$ select nullif(current_setting('req.uid', true), '')::uuid $$;
create or replace function auth.role() returns text
  language sql stable as $$ select coalesce(current_setting('req.role', true), 'authenticated') $$;

create table empresas (id uuid primary key, nome text, slug text unique);
insert into empresas values
  ('0dda3c8e-228b-4d05-b50a-2e2f301d75a3', '364 Steakhouse', 'steakhouse'),
  ('b23fa634-61be-4620-bda7-c92dc01f3d24', '364 Foodtruck/Afya', 'foodtruck-afya'),
  ('77566548-b211-42a6-ba31-c9411751290c', '364 Food Service', 'food-service');

create or replace function public.empresas_permitidas() returns setof uuid
  language sql stable as $$ select id from empresas $$;

create or replace function public.fn_set_updated_at() returns trigger
  language plpgsql as $$ begin new.atualizado_em = now(); return new; end $$;
```

- [ ] **Step 2: Escrever a migração**

`supabase/atualizacao_32_pdv_consumer.sql`:

```sql
-- =========================================================
-- Atualização 32 — vendas importadas do PDV Consumer
--
-- Tabelas pdv_* guardam, por empresa, o que o painel Consumer Connect
-- mostra para a 364 Steakhouse e a 364 Foodtruck/Afya: pedidos com itens e
-- pagamentos, caixas com movimentações, recebimentos (com taxa e líquido) e
-- o snapshot diário de itens vendidos. O importador (scripts/
-- importar-pdv-consumer.mjs) escreve com a service role; usuários só leem.
--
-- Rode depois de atualizacao_29_ficha_defumacao.sql. Idempotente.
-- Spec: docs/superpowers/specs/2026-08-23-importacao-vendas-consumer-design.md
-- =========================================================
begin;

-- ---------- LOJAS DO CONNECT ----------
-- O payload do Connect diz "364 Steakhouse" para as duas lojas; a unidade
-- vem do filtro de loja, e esta tabela traduz o id do filtro em empresa.
create table if not exists public.pdv_lojas (
  id_connect bigint primary key,
  empresa_id uuid not null references public.empresas(id),
  nome_connect text not null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

insert into public.pdv_lojas (id_connect, empresa_id, nome_connect)
select v.id_connect, e.id, v.nome_connect
from (values
  (-2147478159::bigint, 'steakhouse',     'RO/Ji-Paraná - Dois de Abril 364 Steakhouse'),
  (-2147458165::bigint, 'foodtruck-afya', 'RO/Ji-Paraná - Jardim dos Migrantes 364 Steakhouse')
) as v(id_connect, slug, nome_connect)
join public.empresas e on e.slug = v.slug
on conflict (id_connect) do nothing;

-- ---------- PEDIDOS ----------
create table if not exists public.pdv_pedidos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  codigo integer not null,
  id_connect bigint,
  tipo text not null check (tipo in ('mesa', 'delivery', 'outro')),
  tipo_original text,
  origem text,
  status text,
  finalizado boolean not null default false,
  cliente text,
  numero integer,
  colaborador text,
  qtd_itens numeric(12,4),
  valor_total numeric(12,2) not null default 0,
  valor_itens numeric(12,2),
  valor_desconto numeric(12,2),
  valor_entrega numeric(12,2),
  valor_servico numeric(12,2),
  valor_acrescimo numeric(12,2),
  aberto_em timestamptz not null,
  fechado_em timestamptz,
  dia_venda date not null,
  excluido_em timestamptz,
  origem_raw jsonb,
  origem_html text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, codigo)
);
create index if not exists pdv_pedidos_dia_idx on public.pdv_pedidos (empresa_id, dia_venda);

create table if not exists public.pdv_pedido_itens (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pdv_pedidos(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id),
  posicao integer not null,
  nome text not null,
  observacao text,
  quantidade numeric(12,4) not null default 0,
  preco_unitario numeric(12,2),
  valor numeric(12,2),
  item_pai_posicao integer,
  eh_combo boolean not null default false
);
create index if not exists pdv_pedido_itens_pedido_idx on public.pdv_pedido_itens (pedido_id);

create table if not exists public.pdv_pagamentos (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pdv_pedidos(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id),
  posicao integer not null,
  valor numeric(12,2) not null,
  forma text,
  operadora text,
  forma_grupo text not null check (forma_grupo in ('pix','credito','debito','dinheiro','ifood_online','voucher','fiado','outro')),
  pago_em timestamptz
);
create index if not exists pdv_pagamentos_pedido_idx on public.pdv_pagamentos (pedido_id);

-- ---------- CAIXAS ----------
create table if not exists public.pdv_caixas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  codigo integer not null,
  id_connect bigint,
  usuario text,
  status text,
  aberto_em timestamptz not null,
  fechado_em timestamptz,
  dia_caixa date not null,
  saldo_inicial numeric(12,2),
  saldo_final numeric(12,2),
  total_dinheiro numeric(12,2),
  observacao text,
  origem_raw jsonb,
  origem_html text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, codigo)
);
create index if not exists pdv_caixas_dia_idx on public.pdv_caixas (empresa_id, dia_caixa);

create table if not exists public.pdv_caixa_movimentos (
  id uuid primary key default gen_random_uuid(),
  caixa_id uuid not null references public.pdv_caixas(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id),
  posicao integer not null,
  operacao text not null,
  origem text,
  pedido_codigo integer,
  momento timestamptz,
  entrada numeric(12,2),
  saida numeric(12,2),
  forma text,
  operadora text,
  forma_grupo text,
  observacao text
);
create index if not exists pdv_caixa_movimentos_caixa_idx on public.pdv_caixa_movimentos (caixa_id);

-- ---------- RECEBIMENTOS ----------
-- Única fonte com taxa e valor líquido. Sem chave própria no payload, então a
-- chave natural é a combinação que identifica um lançamento.
create table if not exists public.pdv_recebimentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  pedido_codigo integer,
  caixa_codigo integer,
  categoria text,
  forma text,
  operadora text,
  forma_grupo text not null,
  valor numeric(12,2) not null,
  valor_liquido numeric(12,2),
  percentual_taxa numeric(8,4),
  parcela integer,
  pago_em timestamptz not null,
  dia_pagamento date not null,
  credito_em date,
  observacao text,
  origem_raw jsonb,
  criado_em timestamptz not null default now(),
  unique (empresa_id, pedido_codigo, caixa_codigo, forma, operadora, valor, pago_em)
);
create index if not exists pdv_recebimentos_dia_idx on public.pdv_recebimentos (empresa_id, dia_pagamento);

-- ---------- ITENS VENDIDOS POR DIA ----------
create table if not exists public.pdv_vendas_itens_dia (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  dia date not null,
  codigo_produto integer,
  codigo_detalhe integer not null,
  nome text not null,
  categoria text,
  quantidade numeric(12,4) not null default 0,
  valor_vendido numeric(12,2) not null default 0,
  preco_venda numeric(12,2),
  preco_custo numeric(12,2),
  custo_medio numeric(12,2),
  lucro numeric(12,2),
  margem numeric(8,4),
  participacao_lucro numeric(8,4),
  curva_abc char(1),
  origem_raw jsonb,
  criado_em timestamptz not null default now(),
  unique (empresa_id, dia, codigo_detalhe)
);

-- ---------- LOG DE EXECUÇÃO ----------
create table if not exists public.pdv_importacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id),
  iniciado_em timestamptz not null default now(),
  terminado_em timestamptz,
  janela_inicio date,
  janela_fim date,
  status text not null default 'executando' check (status in ('executando','ok','erro','parcial')),
  pedidos integer not null default 0,
  caixas integer not null default 0,
  recebimentos integer not null default 0,
  itens_dia integer not null default 0,
  erro text,
  detalhes jsonb
);
create index if not exists pdv_importacoes_inicio_idx on public.pdv_importacoes (iniciado_em desc);

-- ---------- TRIGGERS ----------
drop trigger if exists trg_pdv_pedidos_updated on public.pdv_pedidos;
create trigger trg_pdv_pedidos_updated before update on public.pdv_pedidos
  for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_pdv_caixas_updated on public.pdv_caixas;
create trigger trg_pdv_caixas_updated before update on public.pdv_caixas
  for each row execute function public.fn_set_updated_at();

-- ---------- RLS ----------
-- Só leitura para usuários: escrita é do importador, que usa a service role
-- (que passa por cima da RLS). pdv_lojas e pdv_importacoes não têm
-- empresa_id obrigatório, então a regra é "qualquer autenticado lê".
do $$
declare t text;
begin
  foreach t in array array['pdv_pedidos','pdv_pedido_itens','pdv_pagamentos','pdv_caixas',
                           'pdv_caixa_movimentos','pdv_recebimentos','pdv_vendas_itens_dia']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "empresa_scoped_read" on public.%I', t);
    execute format('create policy "empresa_scoped_read" on public.%I for select
      using (auth.role() = ''authenticated'' and empresa_id in (select public.empresas_permitidas()))', t);
  end loop;
end $$;

alter table public.pdv_lojas enable row level security;
drop policy if exists "authenticated_read" on public.pdv_lojas;
create policy "authenticated_read" on public.pdv_lojas for select using (auth.role() = 'authenticated');

alter table public.pdv_importacoes enable row level security;
drop policy if exists "authenticated_read" on public.pdv_importacoes;
create policy "authenticated_read" on public.pdv_importacoes for select using (auth.role() = 'authenticated');

-- ---------- VIEWS ----------
-- security_invoker: a view roda com a RLS de quem consulta (padrão da 21).
drop view if exists public.vw_pdv_vendas_dia;
create view public.vw_pdv_vendas_dia with (security_invoker = true) as
select
  empresa_id,
  dia_venda as dia,
  tipo,
  coalesce(origem, '') as origem,
  count(*)::integer as qtd_pedidos,
  coalesce(sum(qtd_itens), 0) as qtd_itens,
  coalesce(sum(valor_total), 0) as valor_total,
  coalesce(sum(valor_desconto), 0) as valor_desconto,
  coalesce(sum(valor_entrega), 0) as valor_entrega,
  coalesce(sum(valor_servico), 0) as valor_servico
from public.pdv_pedidos
where finalizado and excluido_em is null
group by empresa_id, dia_venda, tipo, coalesce(origem, '');

drop view if exists public.vw_pdv_caixa_formas_dia;
create view public.vw_pdv_caixa_formas_dia with (security_invoker = true) as
select
  empresa_id,
  dia_pagamento as dia,
  forma_grupo,
  coalesce(forma, '') as forma,
  coalesce(operadora, '') as operadora,
  count(*)::integer as qtd,
  sum(valor) as valor_bruto,
  sum(coalesce(valor_liquido, valor)) as valor_liquido,
  sum(valor - coalesce(valor_liquido, valor)) as taxa
from public.pdv_recebimentos
group by empresa_id, dia_pagamento, forma_grupo, coalesce(forma, ''), coalesce(operadora, '');

commit;

-- ---------- ROLLBACK ----------
-- begin;
-- drop view if exists public.vw_pdv_caixa_formas_dia;
-- drop view if exists public.vw_pdv_vendas_dia;
-- drop table if exists public.pdv_importacoes;
-- drop table if exists public.pdv_vendas_itens_dia;
-- drop table if exists public.pdv_recebimentos;
-- drop table if exists public.pdv_caixa_movimentos;
-- drop table if exists public.pdv_caixas;
-- drop table if exists public.pdv_pagamentos;
-- drop table if exists public.pdv_pedido_itens;
-- drop table if exists public.pdv_pedidos;
-- drop table if exists public.pdv_lojas;
-- commit;
```

- [ ] **Step 3: Escrever os cenários**

`tests/migracao-32/cenarios.sql`:

```sql
-- Exercita a atualização 32. Roda depois do fixture e da migração.
\set QUIET on
set client_min_messages = warning;
begin;

-- Cenário 1: as duas lojas foram semeadas e apontam para empresas distintas.
do $$
declare n integer; distintas integer;
begin
  select count(*), count(distinct empresa_id) into n, distintas from pdv_lojas;
  if n <> 2 or distintas <> 2 then
    raise exception 'FALHA 1: esperava 2 lojas em 2 empresas, achou % em %', n, distintas;
  end if;
  raise notice 'OK 1: lojas semeadas';
end $$;

-- Cenário 2: upsert de pedido por (empresa, codigo) não duplica.
do $$
declare n integer; v numeric;
begin
  insert into pdv_pedidos (empresa_id, codigo, tipo, finalizado, valor_total, aberto_em, dia_venda)
    values ('0dda3c8e-228b-4d05-b50a-2e2f301d75a3', 74941, 'mesa', false, 100, '2026-08-18T00:13:51Z', '2026-08-17')
  on conflict (empresa_id, codigo) do update set valor_total = excluded.valor_total, finalizado = excluded.finalizado;
  insert into pdv_pedidos (empresa_id, codigo, tipo, finalizado, valor_total, aberto_em, dia_venda)
    values ('0dda3c8e-228b-4d05-b50a-2e2f301d75a3', 74941, 'mesa', true, 160.71, '2026-08-18T00:13:51Z', '2026-08-17')
  on conflict (empresa_id, codigo) do update set valor_total = excluded.valor_total, finalizado = excluded.finalizado;
  select count(*), max(valor_total) into n, v from pdv_pedidos where codigo = 74941;
  if n <> 1 or v <> 160.71 then raise exception 'FALHA 2: % linhas, valor %', n, v; end if;
  raise notice 'OK 2: upsert de pedido';
end $$;

-- Cenário 3: a view de vendas só soma pedido finalizado e não excluído.
do $$
declare v numeric;
begin
  insert into pdv_pedidos (empresa_id, codigo, tipo, origem, finalizado, valor_total, aberto_em, dia_venda)
    values ('0dda3c8e-228b-4d05-b50a-2e2f301d75a3', 75222, 'delivery', 'DeliveryHub', false, 56.89, '2026-08-23T02:41:17Z', '2026-08-22');
  insert into pdv_pedidos (empresa_id, codigo, tipo, origem, finalizado, valor_total, aberto_em, dia_venda, excluido_em)
    values ('0dda3c8e-228b-4d05-b50a-2e2f301d75a3', 75223, 'mesa', 'Desktop', true, 999, '2026-08-18T02:41:17Z', '2026-08-17', now());
  select coalesce(sum(valor_total), 0) into v from vw_pdv_vendas_dia
    where empresa_id = '0dda3c8e-228b-4d05-b50a-2e2f301d75a3' and dia = '2026-08-17';
  if v <> 160.71 then raise exception 'FALHA 3: view somou %', v; end if;
  raise notice 'OK 3: view ignora aberto e excluído';
end $$;

-- Cenário 4: itens e pagamentos somem com o pedido (cascade).
do $$
declare p uuid; n integer;
begin
  select id into p from pdv_pedidos where codigo = 74941;
  insert into pdv_pedido_itens (pedido_id, empresa_id, posicao, nome, quantidade, valor)
    values (p, '0dda3c8e-228b-4d05-b50a-2e2f301d75a3', 1, 'Burguer', 1, 23.9);
  insert into pdv_pagamentos (pedido_id, empresa_id, posicao, valor, forma, forma_grupo)
    values (p, '0dda3c8e-228b-4d05-b50a-2e2f301d75a3', 1, 23.9, 'Pix Manual', 'pix');
  delete from pdv_pedidos where id = p;
  select count(*) into n from pdv_pedido_itens where pedido_id = p;
  if n <> 0 then raise exception 'FALHA 4: sobraram % itens', n; end if;
  raise notice 'OK 4: cascade';
end $$;

-- Cenário 5: taxa e líquido na view de formas.
do $$
declare t numeric; l numeric;
begin
  insert into pdv_recebimentos (empresa_id, pedido_codigo, caixa_codigo, forma, operadora, forma_grupo, valor, valor_liquido, percentual_taxa, pago_em, dia_pagamento)
    values ('0dda3c8e-228b-4d05-b50a-2e2f301d75a3', 75090, 1561, 'iFood Online', 'Outros', 'ifood_online', 136.09, 119.76, 12, '2026-08-21T22:42:57Z', '2026-08-21');
  select taxa, valor_liquido into t, l from vw_pdv_caixa_formas_dia where forma_grupo = 'ifood_online';
  if t <> 16.33 or l <> 119.76 then raise exception 'FALHA 5: taxa % líquido %', t, l; end if;
  raise notice 'OK 5: view de formas';
end $$;

-- Cenário 6: forma_grupo fora da lista é recusada.
do $$
declare p uuid;
begin
  insert into pdv_pedidos (empresa_id, codigo, tipo, finalizado, valor_total, aberto_em, dia_venda)
    values ('0dda3c8e-228b-4d05-b50a-2e2f301d75a3', 1, 'mesa', true, 1, now(), current_date) returning id into p;
  begin
    insert into pdv_pagamentos (pedido_id, empresa_id, posicao, valor, forma_grupo)
      values (p, '0dda3c8e-228b-4d05-b50a-2e2f301d75a3', 1, 1, 'cheque');
    raise exception 'FALHA 6: aceitou forma_grupo inválido';
  exception when check_violation then
    raise notice 'OK 6: check de forma_grupo';
  end;
end $$;

rollback;
```

- [ ] **Step 4: Escrever o runner**

`tests/migracao-32/verificar.sh`:

```bash
#!/usr/bin/env bash
# Exercita a atualização 32 (tabelas pdv_* do PDV Consumer) num Postgres
# local descartável. Não toca em produção. Requer psql no PATH e um servidor
# local. Uso: tests/migracao-32/verificar.sh
set -euo pipefail
export PGOPTIONS='-c client_min_messages=warning'

AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
BANCO="${BANCO_TESTE_PDV:-pdv_test_364}"

command -v psql >/dev/null || { echo "psql não encontrado no PATH"; exit 1; }
pg_isready -q || { echo "nenhum Postgres local aceitando conexões"; exit 1; }

limpar() { dropdb --if-exists "$BANCO" >/dev/null 2>&1 || true; }
trap limpar EXIT
limpar
createdb "$BANCO"

psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/fixture.sql"
# Duas vezes: prova idempotência da migração real.
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$RAIZ/supabase/atualizacao_32_pdv_consumer.sql"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$RAIZ/supabase/atualizacao_32_pdv_consumer.sql"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/cenarios.sql"

sed -n '/^-- begin;/,/^-- commit;/p' "$RAIZ/supabase/atualizacao_32_pdv_consumer.sql" | sed 's/^-- \{0,1\}//' > "$AQUI/.rollback.sql"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/.rollback.sql"
rm -f "$AQUI/.rollback.sql"

sobraram=$(psql -tAq -d "$BANCO" -c "select count(*) from information_schema.tables where table_name like 'pdv_%';")
[ "$sobraram" = "0" ] || { echo "rollback deixou $sobraram tabelas pdv_*"; exit 1; }
echo "OK: rollback limpo"
echo "MIGRAÇÃO 32 OK"
```

- [ ] **Step 5: Rodar o smoke**

Run: `chmod +x tests/migracao-32/verificar.sh && tests/migracao-32/verificar.sh`
Expected: seis linhas `OK n: …`, depois `OK: rollback limpo` e `MIGRAÇÃO 32 OK`. Se `pg_isready` falhar, suba o Postgres local (`brew services start postgresql@17`) — a memória `backup-364-os` registra que o 17 está no PATH.

- [ ] **Step 6: Commit**

```bash
git add supabase/atualizacao_32_pdv_consumer.sql tests/migracao-32 tests/fixtures/pdv
git commit -m "feat(pdv): migração 32 com tabelas e views das vendas do PDV Consumer"
```

---

### Task 2: `parse.js` — datas, dinheiro e HTML dos modais

**Files:**
- Create: `lib/pdvConsumer/parse.js`
- Test: `tests/pdv-parse.test.mjs`
- Modify: `package.json` (dependência `cheerio`)

**Interfaces:**
- Produces:
  - `dataConnect(str) → Date | null` — `/Date(1786997631620)/` → instante real (+4h).
  - `diaLocalConnect(str) → 'YYYY-MM-DD' | null` — dia local do mesmo valor.
  - `dataBr(str) → Date | null` — `'17/08/2026 20:13:51'` (hora local) → instante real; `'21/08/2026'` sem hora → meia-noite local.
  - `diaLocal(date) → 'YYYY-MM-DD'` — a partir de um `Date` real, o dia em America/Porto_Velho.
  - `dinheiro(str) → number | null` — `'R$ 7.902,13'` → `7902.13`; vazio → `null`.
  - `quantidade(str) → number` — `'3,0000'` → `3`.
  - `parsePedidoDetalhe(html) → { codigo, origem, tipoOriginal, status, numero, abertoEm, fechadoEm, colaborador, itens: [{posicao, nome, observacao, quantidade, precoUnitario, valor, itemPaiPosicao, ehCombo}], totais: {valorTotal, valorDesconto, valorItens, valorEntrega, valorServico, valorAcrescimo}, pagamentos: [{posicao, valor, forma, operadora, pagoEm}] }`
  - `parseCaixaDetalhe(html) → { codigo, usuario, status, abertoEm, saldoInicial, totalDinheiro, movimentos: [{posicao, operacao, origem, pedidoCodigo, momento, entrada, saida, meio, observacao}], saldoAtual }`

- [ ] **Step 1: Instalar cheerio**

Run: `npm install cheerio@^1.0.0`
Expected: `package.json` ganha `"cheerio": "^1.0.0"` em `dependencies` (o script roda fora do Next, mas é código do repositório; não é devDependency).

- [ ] **Step 2: Escrever os testes**

`tests/pdv-parse.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  dataConnect, diaLocalConnect, dataBr, diaLocal, dinheiro, quantidade,
  parsePedidoDetalhe, parseCaixaDetalhe,
} from '../lib/pdvConsumer/parse.js';

const fx = nome => readFileSync(new URL(`./fixtures/pdv/${nome}`, import.meta.url), 'utf8');

test('dataConnect trata /Date/ como hora local de Porto Velho', () => {
  // 1786997631620 = 2026-08-17T20:13:51Z no relógio do Connect = 20:13:51 local
  const d = dataConnect('/Date(1786997631620)/');
  assert.equal(d.toISOString(), '2026-08-18T00:13:51.620Z');
  assert.equal(diaLocalConnect('/Date(1786997631620)/'), '2026-08-17');
  assert.equal(dataConnect(null), null);
  assert.equal(dataConnect(''), null);
});

test('dataBr converte dd/mm/aaaa hh:mm:ss local', () => {
  assert.equal(dataBr('17/08/2026 20:13:51').toISOString(), '2026-08-18T00:13:51.000Z');
  assert.equal(dataBr('21/08/2026').toISOString(), '2026-08-21T04:00:00.000Z');
  assert.equal(dataBr(''), null);
  assert.equal(dataBr('  '), null);
});

test('diaLocal devolve o dia em Porto Velho de um instante real', () => {
  // 00:13Z do dia 18 ainda é 20:13 do dia 17 em Porto Velho
  assert.equal(diaLocal(new Date('2026-08-18T00:13:51Z')), '2026-08-17');
  assert.equal(diaLocal(new Date('2026-08-18T04:00:00Z')), '2026-08-18');
});

test('dinheiro e quantidade no formato brasileiro', () => {
  assert.equal(dinheiro('R$ 7.902,13'), 7902.13);
  assert.equal(dinheiro('R$ 0,00'), 0);
  assert.equal(dinheiro(''), null);
  assert.equal(dinheiro(undefined), null);
  assert.equal(quantidade('3,0000'), 3);
  assert.equal(quantidade('0,5000'), 0.5);
});

test('parsePedidoDetalhe lê pedido de mesa com complemento e três pagamentos', () => {
  const p = parsePedidoDetalhe(fx('pedido-mesa.html'));
  assert.equal(p.codigo, 74941);
  assert.equal(p.origem, 'Comanda Mobile');
  assert.equal(p.tipoOriginal, 'Mesas/Comandas');
  assert.equal(p.status, 'Finalizado Pago');
  assert.equal(p.numero, 2);
  assert.equal(p.abertoEm.toISOString(), '2026-08-18T00:13:51.000Z');
  assert.equal(p.fechadoEm.toISOString(), '2026-08-18T00:32:39.000Z');
  assert.equal(p.colaborador, 'Colaboradora Teste');

  assert.equal(p.itens.length, 7); // 4 pais + 3 filhos; linhas de subtotal não contam
  assert.deepEqual(p.itens[0], {
    posicao: 1, nome: 'Suco Laranja 500ml',
    observacao: '1 copo, Ir agora, Com açucar, somente lançando',
    quantidade: 3, precoUnitario: 18.9, valor: 56.7, itemPaiPosicao: null, ehCombo: false,
  });
  assert.equal(p.itens[1].nome, 'Burguer');
  assert.equal(p.itens[1].ehCombo, true);
  assert.deepEqual(p.itens[2], {
    posicao: 3, nome: 'Queijo Mussarela', observacao: null,
    quantidade: 1, precoUnitario: 5.9, valor: 5.9, itemPaiPosicao: 2, ehCombo: false,
  });

  assert.deepEqual(p.totais, {
    valorTotal: 160.71, valorDesconto: 0, valorItens: 146.1,
    valorEntrega: null, valorServico: 14.61, valorAcrescimo: null,
  });

  assert.equal(p.pagamentos.length, 3);
  assert.deepEqual(p.pagamentos[2], {
    posicao: 3, valor: 53.57, forma: 'Pix Manual', operadora: '(69)99280-1420', pagoEm: null,
  });
  assert.equal(p.pagamentos[0].forma, 'Cartão de Crédito');
});

test('parsePedidoDetalhe lê delivery com entrega e sem número', () => {
  const p = parsePedidoDetalhe(fx('pedido-delivery.html'));
  assert.equal(p.codigo, 74940);
  assert.equal(p.tipoOriginal, 'Delivery');
  assert.equal(p.origem, 'MenuDino App/Site');
  assert.equal(p.numero, null);
  assert.equal(p.itens.length, 1);
  assert.equal(p.itens[0].observacao, 'Vinagrete');
  assert.equal(p.totais.valorEntrega, 8);
  assert.equal(p.totais.valorServico, null);
  assert.equal(p.pagamentos.length, 1);
  assert.equal(p.pagamentos[0].valor, 50.9);
});

test('parseCaixaDetalhe lê cabeçalho, movimentações e saldo', () => {
  const c = parseCaixaDetalhe(fx('caixa-fechado.html'));
  assert.equal(c.codigo, 1561);
  assert.equal(c.usuario, 'Caixa');
  assert.equal(c.status, 'Fechado');
  assert.equal(c.abertoEm.toISOString(), '2026-08-21T21:40:14.000Z');
  assert.equal(c.saldoInicial, 178.6);
  assert.equal(c.totalDinheiro, 178.6);
  assert.equal(c.saldoAtual, 7902.13);

  // Abertura + 5 recebimentos + sangria + 2 recebimentos; "Saldo Atual" não é movimento
  assert.equal(c.movimentos.length, 9);
  assert.deepEqual(c.movimentos[0], {
    posicao: 1, operacao: 'Abertura', origem: 'Caixa', pedidoCodigo: null,
    momento: new Date('2026-08-21T21:40:14Z'), entrada: 178.6, saida: null,
    meio: 'Diversos', observacao: null,
  });
  assert.deepEqual(c.movimentos[1], {
    posicao: 2, operacao: 'Recebimento', origem: 'Pedido 75089', pedidoCodigo: 75089,
    momento: new Date('2026-08-21T22:37:37Z'), entrada: 139.6, saida: null,
    meio: 'Cartão de Crédito Mastercard', observacao: 'Levar Máquina - Lanç. Aut.',
  });
  assert.equal(c.movimentos[5].observacao, null); // "Recebimento" sem popover
  assert.deepEqual(c.movimentos[6], {
    posicao: 7, operacao: 'Sangria', origem: 'Caixa', pedidoCodigo: null,
    momento: new Date('2026-08-22T01:00:00Z'), entrada: null, saida: 100,
    meio: 'Dinheiro', observacao: null,
  });
});
```

- [ ] **Step 3: Rodar para ver falhar**

Run: `node --test tests/pdv-parse.test.mjs`
Expected: falha com `Cannot find module '.../lib/pdvConsumer/parse.js'`.

- [ ] **Step 4: Implementar**

`lib/pdvConsumer/parse.js`:

```js
// Leitura do que o Consumer Connect devolve: datas no formato .NET e em
// dd/mm/aaaa, dinheiro em R$, e os fragmentos HTML dos modais de pedido e de
// caixa. Só funções puras — nada de rede nem banco aqui.
//
// Fuso: o PDV está em Ji-Paraná (America/Porto_Velho, UTC-4, sem horário de
// verão). O Connect manda a hora local como se fosse UTC, tanto em
// `/Date(ms)/` quanto no texto. Corrigimos somando 4 horas.
import { load } from 'cheerio';

export const FUSO_MS = 4 * 60 * 60 * 1000;

export function dataConnect(str) {
  const m = /\/Date\((-?\d+)\)\//.exec(str || '');
  if (!m) return null;
  return new Date(Number(m[1]) + FUSO_MS);
}

export function diaLocalConnect(str) {
  const m = /\/Date\((-?\d+)\)\//.exec(str || '');
  if (!m) return null;
  return new Date(Number(m[1])).toISOString().slice(0, 10);
}

export function dataBr(str) {
  const s = (str || '').trim();
  const m = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (!m) return null;
  const [, d, mo, y, h = '0', mi = '0', se = '0'] = m;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +se) + FUSO_MS);
}

export function diaLocal(date) {
  return new Date(date.getTime() - FUSO_MS).toISOString().slice(0, 10);
}

export function dinheiro(str) {
  const s = (str || '').replace(/[^\d,.-]/g, '');
  if (!s) return null;
  return Number(s.replace(/\./g, '').replace(',', '.'));
}

export function quantidade(str) {
  return dinheiro(str) ?? 0;
}

function limpo(texto) {
  return (texto || '').replace(/\s+/g, ' ').trim();
}

// Lê os pares <small>Rótulo</small><h6>valor</h6> do cabeçalho dos modais.
function campos($, raiz) {
  const out = {};
  $(raiz).find('small.text-muted').each((_, el) => {
    const rotulo = limpo($(el).text());
    const h6 = $(el).next('h6');
    out[rotulo] = h6.length ? h6 : null;
  });
  return out;
}

export function parsePedidoDetalhe(html) {
  const $ = load(html);
  const c = campos($, '.modal-body > .row');

  const codigoH6 = c['Código'];
  const codigo = Number(limpo(codigoH6.clone().children().remove().end().text()));
  const origem = limpo(codigoH6.find('.badge').text()) || null;
  const tipoOriginal = limpo(c['Tipo'].text());
  const status = limpo(c['Status'].text());
  const numero = c['Número'] ? Number(limpo(c['Número'].text())) || null : null;
  const abertoEm = dataBr(limpo(c['Abertura']?.text()));
  const fechadoEm = c['Fechamento'] ? dataBr(limpo(c['Fechamento'].text())) : null;
  const colaborador = c['Colaborador'] ? limpo(c['Colaborador'].text()) || null : null;

  const itens = [];
  let paiAtual = null;
  $('table.tabela-pedido-itens tbody tr').each((_, tr) => {
    const $tr = $(tr);
    if ($tr.hasClass('linha-subtotal')) return;
    const tds = $tr.children('td');
    const nomeTd = tds.eq(0).clone();
    const observacao = limpo(nomeTd.find('i.small').text()) || null;
    nomeTd.find('i').remove();
    nomeTd.find('br').remove();
    const nome = limpo(nomeTd.text());
    const posicao = itens.length + 1;
    const ehPai = $tr.hasClass('linha-pai');
    if (ehPai) paiAtual = posicao;
    itens.push({
      posicao, nome, observacao,
      quantidade: quantidade(tds.eq(2).text()),
      precoUnitario: dinheiro(tds.eq(1).text()),
      valor: dinheiro(tds.eq(3).text()),
      itemPaiPosicao: ehPai ? null : paiAtual,
      ehCombo: false,
    });
  });
  // Pai que tem filho é combo/personalizado: marca depois de ler todos.
  for (const it of itens) {
    if (it.itemPaiPosicao) itens[it.itemPaiPosicao - 1].ehCombo = true;
  }

  const t = campos($, '#pedpagamento .row');
  const totais = {
    valorTotal: t['Valor Total'] ? dinheiro(t['Valor Total'].text()) : null,
    valorDesconto: t['Valor Desc.'] ? dinheiro(t['Valor Desc.'].text()) : null,
    valorItens: t['Valor Itens'] ? dinheiro(t['Valor Itens'].text()) : null,
    valorEntrega: t['Valor Entrega'] ? dinheiro(t['Valor Entrega'].text()) : null,
    valorServico: t['Valor Serviço'] ? dinheiro(t['Valor Serviço'].text()) : null,
    valorAcrescimo: t['Valor Acréscimo'] ? dinheiro(t['Valor Acréscimo'].text()) : null,
  };

  const pagamentos = [];
  $('#pedpagamento table tbody tr').each((_, tr) => {
    const tds = $(tr).children('td');
    pagamentos.push({
      posicao: pagamentos.length + 1,
      valor: dinheiro(tds.eq(0).text()),
      forma: limpo(tds.eq(1).text()) || null,
      operadora: limpo(tds.eq(2).text()) || null,
      pagoEm: dataBr(limpo(tds.eq(3).text())),
    });
  });

  return { codigo, origem, tipoOriginal, status, numero, abertoEm, fechadoEm, colaborador, itens, totais, pagamentos };
}

export function parseCaixaDetalhe(html) {
  const $ = load(html);
  const c = campos($, '.modal-body > .row');
  const codigo = Number(limpo(c['ID'].text()));
  const usuario = limpo(c['Usuário'].text()) || null;
  const status = limpo(c['Status'].text()) || null;
  const aberturaH6 = c['Abertura'];
  const abertoEm = dataBr(limpo(aberturaH6.text()));
  const saldoInicial = dinheiro(aberturaH6.next('h6').text());
  const totalDinheiro = c['Total em Dinheiro'] ? dinheiro(c['Total em Dinheiro'].text()) : null;

  const movimentos = [];
  let saldoAtual = null;
  $('#table-movimentacoes-caixa tbody tr').each((_, tr) => {
    const tds = $(tr).children('td');
    const opTd = tds.eq(0);
    const operacao = limpo(opTd.text());
    if (operacao === 'Saldo Atual') {
      saldoAtual = dinheiro(tds.eq(3).text());
      return;
    }
    const origem = limpo(tds.eq(1).text()) || null;
    const ped = /Pedido\s+(\d+)/.exec(origem || '');
    movimentos.push({
      posicao: movimentos.length + 1,
      operacao,
      origem,
      pedidoCodigo: ped ? Number(ped[1]) : null,
      momento: dataBr(limpo(tds.eq(2).text())),
      entrada: dinheiro(tds.eq(3).text()),
      saida: dinheiro(tds.eq(4).text()),
      meio: limpo(tds.eq(5).text()) || null,
      observacao: opTd.find('a[data-content]').attr('data-content') || null,
    });
  });

  return { codigo, usuario, status, abertoEm, saldoInicial, totalDinheiro, movimentos, saldoAtual };
}
```

- [ ] **Step 5: Rodar os testes**

Run: `node --test tests/pdv-parse.test.mjs`
Expected: todos passam. Se `observacao` do item vier com entidades (`a&#231;ucar`), o cheerio já decodifica; se vier com espaço final, `limpo()` resolve.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json lib/pdvConsumer/parse.js tests/pdv-parse.test.mjs
git commit -m "feat(pdv): parser das respostas do Consumer Connect"
```

---

### Task 3: `normaliza.js` — classificação e linhas do banco

**Files:**
- Create: `lib/pdvConsumer/normaliza.js`
- Test: `tests/pdv-normaliza.test.mjs`

**Interfaces:**
- Consumes: `parse.js` (`dataConnect`, `diaLocalConnect`, `diaLocal`).
- Produces:
  - `classificaTipo(tipoOriginal) → 'mesa' | 'delivery' | 'outro'`
  - `classificaForma(forma, operadora) → forma_grupo`
  - `separaMeio(meio) → { forma, operadora }` — `'Cartão de Crédito Mastercard'` → `{forma:'Cartão de Crédito', operadora:'Mastercard'}`
  - `pedidoMudou(linhaConnect, existente) → boolean`
  - `normalizaPedido({ linha, detalhe, empresaId }) → { pedido, itens, pagamentos }` (objetos com nomes de coluna do banco; `itens`/`pagamentos` sem `pedido_id`, que o importador preenche)
  - `normalizaCaixa({ linha, detalhe, empresaId }) → { caixa, movimentos }`
  - `normalizaRecebimento(linha, empresaId) → objeto de `pdv_recebimentos``
  - `normalizaItemDia(linha, dia, empresaId) → objeto de `pdv_vendas_itens_dia``

- [ ] **Step 1: Escrever os testes**

`tests/pdv-normaliza.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePedidoDetalhe, parseCaixaDetalhe } from '../lib/pdvConsumer/parse.js';
import {
  classificaTipo, classificaForma, separaMeio, pedidoMudou,
  normalizaPedido, normalizaCaixa, normalizaRecebimento, normalizaItemDia,
} from '../lib/pdvConsumer/normaliza.js';

const fx = nome => readFileSync(new URL(`./fixtures/pdv/${nome}`, import.meta.url), 'utf8');
const json = nome => JSON.parse(fx(nome));
const EMPRESA = '0dda3c8e-228b-4d05-b50a-2e2f301d75a3';

test('classificaTipo', () => {
  assert.equal(classificaTipo('Mesas/Comandas'), 'mesa');
  assert.equal(classificaTipo('Delivery'), 'delivery');
  assert.equal(classificaTipo('Balcão'), 'outro');
  assert.equal(classificaTipo(null), 'outro');
});

test('classificaForma cobre as formas vistas no painel', () => {
  assert.equal(classificaForma('Pix Manual', '(69)99280-1420'), 'pix');
  assert.equal(classificaForma('Cartão de Crédito', 'Mastercard'), 'credito');
  assert.equal(classificaForma('Cartão de Débito', 'Visa'), 'debito');
  assert.equal(classificaForma('Dinheiro', null), 'dinheiro');
  assert.equal(classificaForma('iFood Online', 'Outros'), 'ifood_online');
  assert.equal(classificaForma('iFood Online', 'Voucher'), 'ifood_online');
  assert.equal(classificaForma('Vale Refeição', 'Voucher'), 'voucher');
  assert.equal(classificaForma('Fiado', null), 'fiado');
  assert.equal(classificaForma('Delivery Much', 'Outros'), 'outro');
  assert.equal(classificaForma(null, null), 'outro');
});

test('separaMeio divide forma e operadora do texto do caixa', () => {
  assert.deepEqual(separaMeio('Cartão de Crédito Mastercard'), { forma: 'Cartão de Crédito', operadora: 'Mastercard' });
  assert.deepEqual(separaMeio('iFood Online Outros'), { forma: 'iFood Online', operadora: 'Outros' });
  assert.deepEqual(separaMeio('Pix Manual (69)99280-1420'), { forma: 'Pix Manual', operadora: '(69)99280-1420' });
  assert.deepEqual(separaMeio('Vale Refeição Voucher'), { forma: 'Vale Refeição', operadora: 'Voucher' });
  assert.deepEqual(separaMeio('Dinheiro'), { forma: 'Dinheiro', operadora: null });
  assert.deepEqual(separaMeio('Diversos'), { forma: 'Diversos', operadora: null });
});

test('pedidoMudou compara status, valor e exclusão', () => {
  const linha = json('pedidos-lista.json').data[0];
  assert.equal(pedidoMudou(linha, null), true);
  assert.equal(pedidoMudou(linha, { status: 'Finalizado Pago', valor_total: 160.71, excluido_em: null, fechado_em: '2026-08-18T00:32:39.463+00:00' }), false);
  assert.equal(pedidoMudou(linha, { status: 'Em Aberto', valor_total: 160.71, excluido_em: null, fechado_em: null }), true);
  assert.equal(pedidoMudou(linha, { status: 'Finalizado Pago', valor_total: 100, excluido_em: null, fechado_em: '2026-08-18T00:32:39.463+00:00' }), true);
});

test('normalizaPedido monta pedido, itens e pagamentos para o banco', () => {
  const linha = json('pedidos-lista.json').data[0];
  const html = fx('pedido-mesa.html');
  // O importador anexa o HTML bruto ao detalhe; o normalizador só repassa.
  const detalhe = { ...parsePedidoDetalhe(html), html };
  const { pedido, itens, pagamentos } = normalizaPedido({ linha, detalhe, empresaId: EMPRESA });
  assert.equal(pedido.empresa_id, EMPRESA);
  assert.equal(pedido.codigo, 74941);
  assert.equal(pedido.id_connect, -1486004890);
  assert.equal(pedido.tipo, 'mesa');
  assert.equal(pedido.tipo_original, 'Mesas/Comandas');
  assert.equal(pedido.origem, 'Comanda Mobile');
  assert.equal(pedido.status, 'Finalizado Pago');
  assert.equal(pedido.finalizado, true);
  assert.equal(pedido.numero, 2);
  assert.equal(pedido.qtd_itens, 6);
  assert.equal(pedido.valor_total, 160.71);
  assert.equal(pedido.valor_servico, 14.61);
  assert.equal(pedido.aberto_em, '2026-08-18T00:13:51.620Z');
  assert.equal(pedido.dia_venda, '2026-08-17');
  assert.equal(pedido.excluido_em, null);
  assert.equal(pedido.origem_raw.Codigo, 74941);
  assert.equal(typeof pedido.origem_html, 'string');
  assert.equal(itens.length, 7);
  assert.equal(itens[2].item_pai_posicao, 2);
  assert.equal(pagamentos.length, 3);
  assert.equal(pagamentos[2].forma_grupo, 'pix');
  assert.equal(pagamentos[0].forma_grupo, 'credito');
});

test('normalizaPedido sem detalhe (pedido em aberto) usa só a linha', () => {
  const linha = json('pedidos-lista.json').data[2];
  const { pedido, itens, pagamentos } = normalizaPedido({ linha, detalhe: null, empresaId: EMPRESA });
  assert.equal(pedido.finalizado, false);
  assert.equal(pedido.tipo, 'delivery');
  assert.equal(pedido.dia_venda, '2026-08-22');
  assert.equal(pedido.fechado_em, null);
  assert.deepEqual(itens, []);
  assert.deepEqual(pagamentos, []);
});

test('normalizaCaixa', () => {
  const linha = json('caixas-lista.json').data[1];
  const html = fx('caixa-fechado.html');
  const detalhe = { ...parseCaixaDetalhe(html), html };
  const { caixa, movimentos } = normalizaCaixa({ linha, detalhe, empresaId: EMPRESA });
  assert.equal(caixa.codigo, 1561);
  assert.equal(caixa.status, 'Fechado');
  assert.equal(caixa.aberto_em, '2026-08-21T21:40:14.000Z');
  assert.equal(caixa.fechado_em, '2026-08-22T03:47:18.000Z');
  assert.equal(caixa.dia_caixa, '2026-08-21');
  assert.equal(caixa.saldo_final, 7902.13);
  assert.equal(caixa.total_dinheiro, 178.6);
  assert.equal(movimentos.length, 9);
  assert.equal(movimentos[1].pedido_codigo, 75089);
  assert.equal(movimentos[1].forma, 'Cartão de Crédito');
  assert.equal(movimentos[1].operadora, 'Mastercard');
  assert.equal(movimentos[1].forma_grupo, 'credito');
  assert.equal(movimentos[6].saida, 100);
  assert.equal(movimentos[6].forma_grupo, 'dinheiro');
});

test('normalizaRecebimento guarda taxa, líquido e data de crédito', () => {
  const r = normalizaRecebimento(json('recebimentos-lista.json').data[2], EMPRESA);
  assert.equal(r.pedido_codigo, 75090);
  assert.equal(r.caixa_codigo, 1561);
  assert.equal(r.forma, 'iFood Online');
  assert.equal(r.operadora, 'Outros');
  assert.equal(r.forma_grupo, 'ifood_online');
  assert.equal(r.valor, 136.09);
  assert.equal(r.valor_liquido, 119.76);
  assert.equal(r.percentual_taxa, 12);
  assert.equal(r.pago_em, '2026-08-21T22:42:57.000Z');
  assert.equal(r.dia_pagamento, '2026-08-21');
  assert.equal(r.credito_em, '2026-09-20');
  const dinheiro = normalizaRecebimento(json('recebimentos-lista.json').data[1], EMPRESA);
  assert.equal(dinheiro.operadora, null);
  assert.equal(dinheiro.forma_grupo, 'dinheiro');
});

test('normalizaItemDia', () => {
  const i = normalizaItemDia(json('produtos-vendidos.json').data[0], '2026-08-21', EMPRESA);
  assert.equal(i.dia, '2026-08-21');
  assert.equal(i.codigo_produto, 172);
  assert.equal(i.codigo_detalhe, 203);
  assert.equal(i.nome, 'Bife Ancho');
  assert.equal(i.categoria, 'Churrasco');
  assert.equal(i.quantidade, 22);
  assert.equal(i.valor_vendido, 1993.8);
  assert.equal(i.curva_abc, 'A');
  assert.equal(i.margem, 57.7);
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `node --test tests/pdv-normaliza.test.mjs`
Expected: `Cannot find module '.../normaliza.js'`.

- [ ] **Step 3: Implementar**

`lib/pdvConsumer/normaliza.js`:

```js
// Transforma o que o parse.js devolve em linhas prontas para as tabelas
// pdv_* (nomes de coluna do banco). Funções puras.
import { dataConnect, diaLocalConnect, diaLocal } from './parse.js';

export function classificaTipo(tipoOriginal) {
  const t = (tipoOriginal || '').toLowerCase();
  if (t.includes('mesa') || t.includes('comanda')) return 'mesa';
  if (t.includes('delivery')) return 'delivery';
  return 'outro';
}

// Operadoras conhecidas, para separar "Cartão de Crédito Mastercard" no
// texto único do caixa. Telefone de Pix entra pelo regex.
const OPERADORAS = ['Mastercard', 'Visa', 'Elo', 'Amex', 'Hipercard', 'Voucher', 'Outros'];

export function separaMeio(meio) {
  const s = (meio || '').trim();
  if (!s) return { forma: null, operadora: null };
  const tel = /\s(\(\d{2}\)\s?\d{4,5}-?\d{4})$/.exec(s);
  if (tel) return { forma: s.slice(0, tel.index).trim(), operadora: tel[1] };
  for (const op of OPERADORAS) {
    if (s.endsWith(' ' + op)) return { forma: s.slice(0, -op.length).trim(), operadora: op };
  }
  return { forma: s, operadora: null };
}

export function classificaForma(forma, operadora) {
  const f = (forma || '').toLowerCase();
  const o = (operadora || '').toLowerCase();
  if (f.includes('ifood')) return 'ifood_online';
  if (f.includes('pix')) return 'pix';
  if (f.includes('crédito') || f.includes('credito')) return 'credito';
  if (f.includes('débito') || f.includes('debito')) return 'debito';
  if (f.includes('dinheiro')) return 'dinheiro';
  if (f.includes('fiado') || f.includes('conta corrente')) return 'fiado';
  if (f.includes('vale') || f.includes('voucher') || o === 'voucher') return 'voucher';
  return 'outro';
}

const iso = d => (d ? d.toISOString() : null);
const num = v => (v === null || v === undefined || v === '' ? null : Number(v));

export function pedidoMudou(linha, existente) {
  if (!existente) return true;
  if ((existente.status || null) !== (linha.Status || null)) return true;
  if (Number(existente.valor_total) !== Number(linha.ValorTotal)) return true;
  const exclLinha = iso(dataConnect(linha.DataHoraExclusao));
  const exclBanco = existente.excluido_em ? new Date(existente.excluido_em).toISOString() : null;
  if (exclLinha !== exclBanco) return true;
  const fechLinha = !!dataConnect(linha.DataHoraFechamento);
  const fechBanco = !!existente.fechado_em;
  return fechLinha !== fechBanco;
}

export function normalizaPedido({ linha, detalhe, empresaId }) {
  const status = detalhe?.status || linha.Status || null;
  const abertoEm = dataConnect(linha.DataHoraAbertura) || detalhe?.abertoEm;
  const pedido = {
    empresa_id: empresaId,
    codigo: Number(linha.Codigo),
    id_connect: num(linha.ID),
    tipo: classificaTipo(detalhe?.tipoOriginal || linha.Tipo),
    tipo_original: detalhe?.tipoOriginal || linha.Tipo || null,
    origem: detalhe?.origem || linha.Origem || null,
    status,
    finalizado: /^finalizado/i.test(status || ''),
    cliente: linha.NomeCliente || null,
    numero: detalhe?.numero ?? (linha.Numero ? Number(linha.Numero) : null),
    colaborador: detalhe?.colaborador || null,
    qtd_itens: num(linha.QtdItens),
    valor_total: detalhe?.totais?.valorTotal ?? Number(linha.ValorTotal || 0),
    valor_itens: detalhe?.totais?.valorItens ?? null,
    valor_desconto: detalhe?.totais?.valorDesconto ?? null,
    valor_entrega: detalhe?.totais?.valorEntrega ?? null,
    valor_servico: detalhe?.totais?.valorServico ?? null,
    valor_acrescimo: detalhe?.totais?.valorAcrescimo ?? null,
    aberto_em: iso(abertoEm),
    fechado_em: iso(dataConnect(linha.DataHoraFechamento) || detalhe?.fechadoEm || null),
    dia_venda: diaLocalConnect(linha.DataHoraAbertura) || diaLocal(abertoEm),
    excluido_em: iso(dataConnect(linha.DataHoraExclusao)),
    origem_raw: linha,
    origem_html: detalhe?.html ?? null,
  };
  const itens = (detalhe?.itens || []).map(i => ({
    empresa_id: empresaId,
    posicao: i.posicao,
    nome: i.nome,
    observacao: i.observacao,
    quantidade: i.quantidade,
    preco_unitario: i.precoUnitario,
    valor: i.valor,
    item_pai_posicao: i.itemPaiPosicao,
    eh_combo: i.ehCombo,
  }));
  const pagamentos = (detalhe?.pagamentos || []).map(p => ({
    empresa_id: empresaId,
    posicao: p.posicao,
    valor: p.valor,
    forma: p.forma,
    operadora: p.operadora,
    forma_grupo: classificaForma(p.forma, p.operadora),
    pago_em: iso(p.pagoEm),
  }));
  return { pedido, itens, pagamentos };
}

export function normalizaCaixa({ linha, detalhe, empresaId }) {
  const abertoEm = dataConnect(linha.DataHoraAbertura) || detalhe?.abertoEm;
  const caixa = {
    empresa_id: empresaId,
    codigo: Number(linha.Codigo),
    id_connect: num(linha.ID),
    usuario: linha.NomeUsuario || detalhe?.usuario || null,
    status: linha.StatusCaixa || detalhe?.status || null,
    aberto_em: iso(abertoEm),
    fechado_em: iso(dataConnect(linha.DataHoraFechamento)),
    dia_caixa: diaLocalConnect(linha.DataHoraAbertura) || diaLocal(abertoEm),
    saldo_inicial: num(linha.SaldoInicial) ?? detalhe?.saldoInicial ?? null,
    saldo_final: num(linha.SaldoFinal) ?? detalhe?.saldoAtual ?? null,
    total_dinheiro: detalhe?.totalDinheiro ?? num(linha.ValorTotalDinheiro),
    observacao: linha.Observacao || null,
    origem_raw: linha,
    origem_html: detalhe?.html ?? null,
  };
  const movimentos = (detalhe?.movimentos || []).map(m => {
    const { forma, operadora } = separaMeio(m.meio);
    return {
      empresa_id: empresaId,
      posicao: m.posicao,
      operacao: m.operacao,
      origem: m.origem,
      pedido_codigo: m.pedidoCodigo,
      momento: iso(m.momento),
      entrada: m.entrada,
      saida: m.saida,
      forma,
      operadora,
      forma_grupo: classificaForma(forma, operadora),
      observacao: m.observacao,
    };
  });
  return { caixa, movimentos };
}

export function normalizaRecebimento(linha, empresaId) {
  const pagoEm = dataConnect(linha.DataHoraPagamento);
  return {
    empresa_id: empresaId,
    pedido_codigo: num(linha.PedidoCodigo),
    caixa_codigo: num(linha.CaixaCodigo),
    categoria: linha.CategoriaContaText || null,
    forma: linha.FormaPagamentoText || null,
    operadora: linha.OperadoraCartaoText || null,
    forma_grupo: classificaForma(linha.FormaPagamentoText, linha.OperadoraCartaoText),
    valor: Number(linha.Valor || 0),
    valor_liquido: num(linha.ValorLiquido),
    percentual_taxa: num(linha.PercentualTaxa),
    parcela: num(linha.NumeroParcela),
    pago_em: iso(pagoEm),
    dia_pagamento: diaLocalConnect(linha.DataHoraPagamento),
    credito_em: diaLocalConnect(linha.DataCreditoID),
    observacao: linha.Observacao || null,
    origem_raw: linha,
  };
}

export function normalizaItemDia(linha, dia, empresaId) {
  return {
    empresa_id: empresaId,
    dia,
    codigo_produto: num(linha.CodigoProduto),
    codigo_detalhe: Number(linha.CodigoProdutoDetalhe),
    nome: linha.Nome,
    categoria: linha.DescricaoCategoria || null,
    quantidade: Number(linha.QuantidadeVendida || 0),
    valor_vendido: Number(linha.ValorVendido || 0),
    preco_venda: num(linha.PrecoVenda),
    preco_custo: num(linha.PrecoCusto),
    custo_medio: num(linha.CustoMedio),
    lucro: num(linha.Lucro),
    margem: num(linha.MargemLucro),
    participacao_lucro: num(linha.PercentualParticipacaoNoLucro),
    curva_abc: linha.ClassificacaoAbc || null,
    origem_raw: linha,
  };
}
```

Observação: `normalizaPedido` e `normalizaCaixa` leem `detalhe.html`. O `parse.js` não devolve esse campo — quem chama (o importador na Task 5, e os testes acima) anexa `html` ao objeto do detalhe.

- [ ] **Step 4: Rodar os testes**

Run: `node --test tests/pdv-normaliza.test.mjs`
Expected: todos passam.

- [ ] **Step 5: Commit**

```bash
git add lib/pdvConsumer/normaliza.js tests/pdv-normaliza.test.mjs
git commit -m "feat(pdv): normalização das vendas do Connect para as tabelas pdv_*"
```

---

### Task 4: `connect.js` — cliente HTTP do Connect

**Files:**
- Create: `lib/pdvConsumer/connect.js`
- Test: `tests/pdv-connect.test.mjs`

**Interfaces:**
- Produces: `criarClienteConnect({ cookie, fetch = globalThis.fetch, base = 'https://connect.consumer.com.br', pausaMs = 300, dormir })` → objeto com:
  - `setLoja(idConnect) → Promise<void>`
  - `setPeriodo(de, ate) → Promise<void>` (`'YYYY-MM-DD'`; manda `00:00` e `23:59`)
  - `listar(caminho, colunas, { tamanhoPagina = 200 } = {}) → Promise<object[]>` — pagina até `recordsTotal`
  - `detalhe(caminho, id) → Promise<string>` (HTML)
  - `produtosVendidos() → Promise<object[]>`
  - Erro `SessaoExpiradaError` (classe exportada) quando a resposta é redirect para login ou HTML com `<form` de login.
  - `COLUNAS` exportado: `{ pedidos: [...], caixas: [...], recebimentos: [...] }` com as listas exatas de colunas de cada DataTable.

- [ ] **Step 1: Escrever os testes**

`tests/pdv-connect.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarClienteConnect, SessaoExpiradaError, COLUNAS } from '../lib/pdvConsumer/connect.js';

// fetch falso: registra chamadas e responde pelo caminho.
function fetchFalso(respostas) {
  const chamadas = [];
  const fn = async (url, opts = {}) => {
    const u = new URL(url);
    chamadas.push({ caminho: u.pathname + u.search, opts });
    const r = respostas[u.pathname];
    const resp = typeof r === 'function' ? r(opts, chamadas.length) : r;
    return {
      ok: resp.status ? resp.status < 400 : true,
      status: resp.status || 200,
      redirected: !!resp.redirected,
      url: resp.url || url,
      headers: { get: h => (resp.headers || {})[h.toLowerCase()] || null },
      text: async () => (typeof resp.body === 'string' ? resp.body : JSON.stringify(resp.body)),
    };
  };
  fn.chamadas = chamadas;
  return fn;
}

test('setLoja e setPeriodo fazem POST com cookie e formato do painel', async () => {
  const f = fetchFalso({ '/QueryFilters/SetDatabaseFilter': { body: '{}' }, '/QueryFilters/SetDateFilter': { body: '{}' } });
  const c = criarClienteConnect({ cookie: 'ASP.NET_SessionId=abc', fetch: f, pausaMs: 0 });
  await c.setLoja(-2147478159);
  await c.setPeriodo('2026-08-20', '2026-08-23');
  assert.equal(f.chamadas[0].opts.method, 'POST');
  assert.equal(f.chamadas[0].opts.headers.Cookie, 'ASP.NET_SessionId=abc');
  assert.equal(f.chamadas[0].opts.headers['X-Requested-With'], 'XMLHttpRequest');
  assert.equal(f.chamadas[0].opts.body, 'ids=-2147478159');
  assert.equal(decodeURIComponent(f.chamadas[1].opts.body), 'start=2026-08-20 00:00&end=2026-08-23 23:59');
});

test('listar pagina até recordsTotal e monta corpo DataTables', async () => {
  const todas = Array.from({ length: 5 }, (_, i) => ({ Codigo: i + 1 }));
  const f = fetchFalso({
    '/Pedidos/GetListaPedidos': opts => {
      const p = new URLSearchParams(opts.body);
      const start = Number(p.get('start')), length = Number(p.get('length'));
      return { body: { draw: 1, recordsTotal: 5, recordsFiltered: 5, data: todas.slice(start, start + length) } };
    },
  });
  const c = criarClienteConnect({ cookie: 'x', fetch: f, pausaMs: 0 });
  const linhas = await c.listar('/Pedidos/GetListaPedidos', COLUNAS.pedidos, { tamanhoPagina: 2 });
  assert.equal(linhas.length, 5);
  assert.equal(f.chamadas.length, 3);
  const corpo = new URLSearchParams(f.chamadas[0].opts.body);
  assert.equal(corpo.get('columns[0][data]'), 'Codigo');
  assert.equal(corpo.get('order[0][column]'), '0');
  assert.equal(corpo.get('order[0][dir]'), 'desc');
  assert.equal(corpo.get('length'), '2');
});

test('listar devolve erro legível quando o servidor responde {error, message}', async () => {
  const f = fetchFalso({ '/Pedidos/GetListaPedidos': { body: { error: true, message: 'Object reference not set' } } });
  const c = criarClienteConnect({ cookie: 'x', fetch: f, pausaMs: 0 });
  await assert.rejects(() => c.listar('/Pedidos/GetListaPedidos', COLUNAS.pedidos), /Object reference not set/);
});

test('detalhe faz GET com id e devolve HTML', async () => {
  const f = fetchFalso({ '/Pedidos/GetDetalhesPedido': { body: '<div class="modal-dialog">x</div>' } });
  const c = criarClienteConnect({ cookie: 'x', fetch: f, pausaMs: 0 });
  const html = await c.detalhe('/Pedidos/GetDetalhesPedido', -1486004890);
  assert.match(html, /modal-dialog/);
  assert.equal(f.chamadas[0].caminho, '/Pedidos/GetDetalhesPedido?id=-1486004890');
  assert.equal(f.chamadas[0].opts.method, 'GET');
});

test('sessão expirada: redirect para login vira SessaoExpiradaError', async () => {
  const f = fetchFalso({ '/Pedidos/GetDetalhesPedido': { redirected: true, url: 'https://connect.consumer.com.br/autenticacao/login?ReturnUrl=x', body: '<form action="/autenticacao/login">' } });
  const c = criarClienteConnect({ cookie: 'x', fetch: f, pausaMs: 0 });
  await assert.rejects(() => c.detalhe('/Pedidos/GetDetalhesPedido', 1), SessaoExpiradaError);
});

test('produtosVendidos aceita corpo vazio e devolve data', async () => {
  const f = fetchFalso({ '/Produtos/GetProdutosVendidos': { body: { data: [{ Nome: 'Arroz' }] } } });
  const c = criarClienteConnect({ cookie: 'x', fetch: f, pausaMs: 0 });
  const itens = await c.produtosVendidos();
  assert.deepEqual(itens, [{ Nome: 'Arroz' }]);
});

test('erro 500 é tentado três vezes antes de falhar', async () => {
  let n = 0;
  const f = fetchFalso({ '/Financeiro/GetRecebimentos': () => { n++; return n < 3 ? { status: 500, body: 'erro' } : { body: { recordsTotal: 0, data: [] } }; } });
  const c = criarClienteConnect({ cookie: 'x', fetch: f, pausaMs: 0, dormir: async () => {} });
  const linhas = await c.listar('/Financeiro/GetRecebimentos', COLUNAS.recebimentos);
  assert.deepEqual(linhas, []);
  assert.equal(n, 3);
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `node --test tests/pdv-connect.test.mjs`
Expected: `Cannot find module`.

- [ ] **Step 3: Implementar**

`lib/pdvConsumer/connect.js`:

```js
// Cliente HTTP do painel Consumer Connect. O painel não tem API: estas são as
// chamadas que as próprias telas fazem (DataTables server-side + modais em
// HTML). Filtro de loja e de período são estado de sessão no servidor — por
// isso setLoja/setPeriodo existem e precisam vir antes das consultas.
//
// Recebe `fetch` injetável para teste. Nunca loga o cookie.

export class SessaoExpiradaError extends Error {
  constructor() { super('SESSAO_EXPIRADA: o cookie do Consumer Connect não é mais aceito; abra o painel no navegador, faça login e copie o cookie de novo (scripts/IMPORTACAO-PDV.md).'); this.name = 'SessaoExpiradaError'; }
}

export const COLUNAS = {
  pedidos: ['Codigo', 'Origem', 'Tipo', 'NomeCliente', 'QtdItens', 'ValorTotal', 'Status', 'DataHoraAberturaText', 'DuracaoText', 'Estabelecimento', 'DataHoraExclusaotext'],
  caixas: ['Codigo', 'NomeUsuario', 'DataHoraAberturaText', 'DataHoraFechamentoText', 'SaldoInicial', 'SaldoFinal', 'Observacao', 'StatusCaixa', 'Estabelecimento'],
  recebimentos: ['CategoriaContaText', 'FormaPagamentoText', 'DataHoraPagamentoText', 'DataCreditoText', 'Valor', 'ValorLiquido', 'PedidoCodigo', 'NomeColaborador', 'CaixaCodigo', 'Estabelecimento'],
};

function corpoDataTables(colunas, start, length) {
  const p = new URLSearchParams();
  p.set('draw', '1');
  p.set('start', String(start));
  p.set('length', String(length));
  p.set('search[value]', '');
  p.set('search[regex]', 'false');
  p.set('order[0][column]', '0');
  p.set('order[0][dir]', 'desc');
  colunas.forEach((c, i) => {
    p.set(`columns[${i}][data]`, c);
    p.set(`columns[${i}][name]`, '');
    p.set(`columns[${i}][searchable]`, 'true');
    p.set(`columns[${i}][orderable]`, 'true');
    p.set(`columns[${i}][search][value]`, '');
    p.set(`columns[${i}][search][regex]`, 'false');
  });
  return p.toString();
}

function pareceLogin(resp, texto) {
  if (resp.redirected && /autenticacao\/login/i.test(resp.url || '')) return true;
  return /<form[^>]*autenticacao\/login/i.test(texto);
}

export function criarClienteConnect({ cookie, fetch = globalThis.fetch, base = 'https://connect.consumer.com.br', pausaMs = 300, dormir } = {}) {
  if (!cookie) throw new Error('CONSUMER_CONNECT_COOKIE não informado.');
  const esperar = dormir || (ms => new Promise(r => setTimeout(r, ms)));
  const cabecalhos = extra => ({
    Cookie: cookie,
    'X-Requested-With': 'XMLHttpRequest',
    Accept: 'application/json, text/html, */*',
    ...extra,
  });

  async function chamar(caminho, { method = 'GET', body } = {}) {
    let ultimoErro;
    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      if (pausaMs) await esperar(pausaMs);
      const resp = await fetch(base + caminho, {
        method,
        headers: cabecalhos(body !== undefined ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        body,
        redirect: 'follow',
      });
      const texto = await resp.text();
      if (pareceLogin(resp, texto)) throw new SessaoExpiradaError();
      if (resp.ok) return texto;
      ultimoErro = new Error(`Connect ${method} ${caminho} respondeu ${resp.status}`);
      await esperar(500 * tentativa);
    }
    throw ultimoErro;
  }

  function json(texto, caminho) {
    let obj;
    try { obj = JSON.parse(texto); } catch { throw new Error(`Connect ${caminho} não devolveu JSON`); }
    if (obj && obj.error) throw new Error(`Connect ${caminho}: ${obj.message || 'erro'}`);
    return obj;
  }

  return {
    async setLoja(idConnect) {
      await chamar('/QueryFilters/SetDatabaseFilter', { method: 'POST', body: `ids=${idConnect}` });
    },
    async setPeriodo(de, ate) {
      const p = new URLSearchParams({ start: `${de} 00:00`, end: `${ate} 23:59` });
      await chamar('/QueryFilters/SetDateFilter', { method: 'POST', body: p.toString() });
    },
    async listar(caminho, colunas, { tamanhoPagina = 200 } = {}) {
      const linhas = [];
      let start = 0, total = Infinity;
      while (start < total) {
        const obj = json(await chamar(caminho, { method: 'POST', body: corpoDataTables(colunas, start, tamanhoPagina) }), caminho);
        const pagina = obj.data || [];
        linhas.push(...pagina);
        total = Number(obj.recordsTotal ?? 0);
        if (!pagina.length) break;
        start += pagina.length;
      }
      return linhas;
    },
    async detalhe(caminho, id) {
      return chamar(`${caminho}?id=${encodeURIComponent(id)}`);
    },
    async produtosVendidos() {
      const obj = json(await chamar('/Produtos/GetProdutosVendidos', { method: 'POST', body: '' }), '/Produtos/GetProdutosVendidos');
      return Array.isArray(obj) ? obj : (obj.data || []);
    },
  };
}
```

- [ ] **Step 4: Rodar os testes**

Run: `node --test tests/pdv-connect.test.mjs`
Expected: todos passam.

- [ ] **Step 5: Commit**

```bash
git add lib/pdvConsumer/connect.js tests/pdv-connect.test.mjs
git commit -m "feat(pdv): cliente HTTP do Consumer Connect com paginação e detecção de sessão"
```

---

### Task 5: `importar.js` — orquestração com cliente e banco injetados

**Files:**
- Create: `lib/pdvConsumer/importar.js`
- Test: `tests/pdv-importar.test.mjs`

**Interfaces:**
- Consumes: `connect.js` (`COLUNAS`, interface do cliente), `parse.js`, `normaliza.js`.
- Produces: `importarLoja({ cliente, banco, loja: { id_connect, empresa_id }, de, ate, log = () => {} }) → Promise<{ pedidos, caixas, recebimentos, itensDia, avisos: string[] }>` e `diasEntre(de, ate) → string[]`.
- Contrato do `banco` (implementado em Task 6 com Supabase; aqui um objeto fake):
  - `pedidosExistentes(empresaId, codigos) → Promise<Map<codigo, {id, status, valor_total, excluido_em, fechado_em}>>`
  - `gravarPedido({ pedido, itens, pagamentos }) → Promise<void>` (upsert + replace filhos)
  - `caixasExistentes(empresaId, codigos) → Promise<Map<codigo, {id, status}>>`
  - `gravarCaixa({ caixa, movimentos }) → Promise<void>`
  - `gravarRecebimentos(linhas) → Promise<void>` (upsert em lote)
  - `substituirItensDia(empresaId, dia, linhas) → Promise<void>`

- [ ] **Step 1: Escrever os testes**

`tests/pdv-importar.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importarLoja, diasEntre } from '../lib/pdvConsumer/importar.js';

const fx = nome => readFileSync(new URL(`./fixtures/pdv/${nome}`, import.meta.url), 'utf8');
const json = nome => JSON.parse(fx(nome));
const EMPRESA = '0dda3c8e-228b-4d05-b50a-2e2f301d75a3';
const LOJA = { id_connect: -2147478159, empresa_id: EMPRESA };

function clienteFalso() {
  const chamadas = [];
  return {
    chamadas,
    async setLoja(id) { chamadas.push(['setLoja', id]); },
    async setPeriodo(de, ate) { chamadas.push(['setPeriodo', de, ate]); },
    async listar(caminho) {
      chamadas.push(['listar', caminho]);
      if (caminho === '/Pedidos/GetListaPedidos') return json('pedidos-lista.json').data;
      if (caminho === '/Financeiro/GetHistoricoCaixa') return json('caixas-lista.json').data;
      if (caminho === '/Financeiro/GetRecebimentos') return json('recebimentos-lista.json').data;
      throw new Error('caminho inesperado ' + caminho);
    },
    async detalhe(caminho, id) {
      chamadas.push(['detalhe', caminho, id]);
      if (caminho === '/Pedidos/GetDetalhesPedido') return id === -1486004890 ? fx('pedido-mesa.html') : fx('pedido-delivery.html');
      return fx('caixa-fechado.html');
    },
    async produtosVendidos() { chamadas.push(['produtosVendidos']); return json('produtos-vendidos.json').data; },
  };
}

function bancoFalso({ pedidos = new Map(), caixas = new Map() } = {}) {
  const gravados = { pedidos: [], caixas: [], recebimentos: [], itensDia: [] };
  return {
    gravados,
    async pedidosExistentes() { return pedidos; },
    async gravarPedido(p) { gravados.pedidos.push(p); },
    async caixasExistentes() { return caixas; },
    async gravarCaixa(c) { gravados.caixas.push(c); },
    async gravarRecebimentos(l) { gravados.recebimentos.push(...l); },
    async substituirItensDia(empresaId, dia, linhas) { gravados.itensDia.push({ dia, n: linhas.length }); },
  };
}

test('diasEntre', () => {
  assert.deepEqual(diasEntre('2026-08-21', '2026-08-23'), ['2026-08-21', '2026-08-22', '2026-08-23']);
  assert.deepEqual(diasEntre('2026-08-23', '2026-08-21'), []);
});

test('importarLoja: banco vazio busca detalhe de pedido finalizado e grava tudo', async () => {
  const cliente = clienteFalso();
  const banco = bancoFalso();
  const r = await importarLoja({ cliente, banco, loja: LOJA, de: '2026-08-21', ate: '2026-08-22' });

  assert.deepEqual(cliente.chamadas[0], ['setLoja', -2147478159]);
  assert.deepEqual(cliente.chamadas[1], ['setPeriodo', '2026-08-21', '2026-08-22']);

  // 3 pedidos na lista: 2 finalizados (detalhe) + 1 em aberto (sem detalhe)
  const detalhesPedido = cliente.chamadas.filter(c => c[0] === 'detalhe' && c[1] === '/Pedidos/GetDetalhesPedido');
  assert.equal(detalhesPedido.length, 2);
  assert.equal(banco.gravados.pedidos.length, 3);
  const aberto = banco.gravados.pedidos.find(p => p.pedido.codigo === 75222);
  assert.equal(aberto.pedido.finalizado, false);
  assert.deepEqual(aberto.itens, []);
  const mesa = banco.gravados.pedidos.find(p => p.pedido.codigo === 74941);
  assert.equal(mesa.itens.length, 7);
  assert.match(mesa.pedido.origem_html, /modal-dialog/);

  // 2 caixas: aberto e fechado, ambos novos → detalhe dos dois
  assert.equal(banco.gravados.caixas.length, 2);
  assert.equal(banco.gravados.caixas.find(c => c.caixa.codigo === 1561).movimentos.length, 9);

  assert.equal(banco.gravados.recebimentos.length, 3);

  // itens por dia: um setPeriodo + produtosVendidos por dia da janela
  assert.deepEqual(banco.gravados.itensDia, [{ dia: '2026-08-21', n: 3 }, { dia: '2026-08-22', n: 3 }]);
  const periodosDia = cliente.chamadas.filter(c => c[0] === 'setPeriodo' && c[1] === c[2]);
  assert.equal(periodosDia.length, 2);

  assert.deepEqual(r, { pedidos: 3, caixas: 2, recebimentos: 3, itensDia: 6, avisos: [] });
});

test('importarLoja: pedido já igual no banco não busca detalhe nem regrava', async () => {
  const cliente = clienteFalso();
  const pedidos = new Map([[74941, { id: 'x', status: 'Finalizado Pago', valor_total: 160.71, excluido_em: null, fechado_em: '2026-08-18T00:32:39Z' }]]);
  const banco = bancoFalso({ pedidos });
  await importarLoja({ cliente, banco, loja: LOJA, de: '2026-08-21', ate: '2026-08-21' });
  const detalhes = cliente.chamadas.filter(c => c[0] === 'detalhe' && c[1] === '/Pedidos/GetDetalhesPedido').map(c => c[2]);
  assert.deepEqual(detalhes, [-1486004889]);
  assert.equal(banco.gravados.pedidos.some(p => p.pedido.codigo === 74941), false);
});

test('importarLoja: caixa fechado já fechado no banco não busca detalhe', async () => {
  const cliente = clienteFalso();
  const caixas = new Map([[1561, { id: 'c', status: 'Fechado' }], [1562, { id: 'd', status: 'Aberto' }]]);
  const banco = bancoFalso({ caixas });
  await importarLoja({ cliente, banco, loja: LOJA, de: '2026-08-21', ate: '2026-08-21' });
  const detalhes = cliente.chamadas.filter(c => c[0] === 'detalhe' && c[1] === '/Financeiro/GetDetalhesCaixa').map(c => c[2]);
  // o aberto é sempre relido (pode ter movimentação nova); o fechado não
  assert.deepEqual(detalhes, [-2131420458]);
});

test('importarLoja: erro no detalhe de um pedido vira aviso e não aborta', async () => {
  const cliente = clienteFalso();
  const original = cliente.detalhe;
  cliente.detalhe = async (caminho, id) => { if (id === -1486004890) throw new Error('timeout'); return original(caminho, id); };
  const banco = bancoFalso();
  const r = await importarLoja({ cliente, banco, loja: LOJA, de: '2026-08-21', ate: '2026-08-21' });
  assert.equal(r.avisos.length, 1);
  assert.match(r.avisos[0], /74941/);
  assert.equal(banco.gravados.pedidos.length, 2);
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `node --test tests/pdv-importar.test.mjs`
Expected: `Cannot find module`.

- [ ] **Step 3: Implementar**

`lib/pdvConsumer/importar.js`:

```js
// Orquestra a importação de uma loja numa janela de datas. Recebe o cliente
// do Connect e o "banco" (ver contrato em scripts/importar-pdv-consumer.mjs)
// por injeção, para o fluxo inteiro ser testável sem rede nem Supabase.
import { COLUNAS, SessaoExpiradaError } from './connect.js';
import { parsePedidoDetalhe, parseCaixaDetalhe } from './parse.js';
import { normalizaPedido, normalizaCaixa, normalizaRecebimento, normalizaItemDia, pedidoMudou } from './normaliza.js';

export function diasEntre(de, ate) {
  const dias = [];
  let d = new Date(de + 'T00:00:00Z');
  const fim = new Date(ate + 'T00:00:00Z');
  while (d <= fim) {
    dias.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 86400000);
  }
  return dias;
}

export async function importarLoja({ cliente, banco, loja, de, ate, log = () => {} }) {
  const empresaId = loja.empresa_id;
  const avisos = [];
  const r = { pedidos: 0, caixas: 0, recebimentos: 0, itensDia: 0 };

  await cliente.setLoja(loja.id_connect);
  await cliente.setPeriodo(de, ate);

  // ---- pedidos ----
  const linhasPedidos = await cliente.listar('/Pedidos/GetListaPedidos', COLUNAS.pedidos);
  log(`  pedidos na janela: ${linhasPedidos.length}`);
  const existentes = await banco.pedidosExistentes(empresaId, linhasPedidos.map(l => Number(l.Codigo)));
  for (const linha of linhasPedidos) {
    const atual = existentes.get(Number(linha.Codigo)) || null;
    if (!pedidoMudou(linha, atual)) continue;
    let detalhe = null;
    if (/^finalizado/i.test(linha.Status || '')) {
      try {
        const html = await cliente.detalhe('/Pedidos/GetDetalhesPedido', linha.ID);
        detalhe = { ...parsePedidoDetalhe(html), html };
      } catch (e) {
        if (e instanceof SessaoExpiradaError) throw e;
        avisos.push(`pedido ${linha.Codigo}: detalhe falhou (${e.message})`);
        continue;
      }
    }
    await banco.gravarPedido(normalizaPedido({ linha, detalhe, empresaId }));
    r.pedidos++;
  }

  // ---- caixas ----
  const linhasCaixas = await cliente.listar('/Financeiro/GetHistoricoCaixa', COLUNAS.caixas);
  const caixasBanco = await banco.caixasExistentes(empresaId, linhasCaixas.map(l => Number(l.Codigo)));
  for (const linha of linhasCaixas) {
    const atual = caixasBanco.get(Number(linha.Codigo));
    // Caixa fechado que já está fechado no banco não muda mais.
    if (atual && atual.status === 'Fechado' && linha.StatusCaixa === 'Fechado') continue;
    let detalhe = null;
    try {
      const html = await cliente.detalhe('/Financeiro/GetDetalhesCaixa', linha.ID);
      detalhe = { ...parseCaixaDetalhe(html), html };
    } catch (e) {
      if (e instanceof SessaoExpiradaError) throw e;
      avisos.push(`caixa ${linha.Codigo}: detalhe falhou (${e.message})`);
      continue;
    }
    await banco.gravarCaixa(normalizaCaixa({ linha, detalhe, empresaId }));
    r.caixas++;
  }

  // ---- recebimentos ----
  const linhasReceb = await cliente.listar('/Financeiro/GetRecebimentos', COLUNAS.recebimentos);
  if (linhasReceb.length) {
    await banco.gravarRecebimentos(linhasReceb.map(l => normalizaRecebimento(l, empresaId)));
    r.recebimentos = linhasReceb.length;
  }

  // ---- itens vendidos por dia ----
  for (const dia of diasEntre(de, ate)) {
    await cliente.setPeriodo(dia, dia);
    const itens = await cliente.produtosVendidos();
    await banco.substituirItensDia(empresaId, dia, itens.map(i => normalizaItemDia(i, dia, empresaId)));
    r.itensDia += itens.length;
  }

  return { ...r, avisos };
}
```

- [ ] **Step 4: Rodar os testes**

Run: `node --test tests/pdv-importar.test.mjs`
Expected: todos passam. Atenção ao teste 2: `pedidoMudou` compara `fechado_em` só como booleano, então `'2026-08-18T00:32:39Z'` basta.

- [ ] **Step 5: Commit**

```bash
git add lib/pdvConsumer/importar.js tests/pdv-importar.test.mjs
git commit -m "feat(pdv): orquestração da importação por loja e janela"
```

---

### Task 6: Script CLI, banco Supabase, docs e npm script

**Files:**
- Create: `scripts/importar-pdv-consumer.mjs`
- Create: `scripts/IMPORTACAO-PDV.md`
- Modify: `package.json` (script `importar-pdv`)
- Modify: `.env.local.example` (variáveis novas)

**Interfaces:**
- Consumes: `criarClienteConnect`, `importarLoja`.
- Produces: comando `npm run importar-pdv -- [--de YYYY-MM-DD] [--ate YYYY-MM-DD] [--loja ID] [--dry-run]`; linhas em `pdv_importacoes`.

- [ ] **Step 1: Escrever o script**

`scripts/importar-pdv-consumer.mjs`:

```js
// =========================================================
// 364 OS — importação diária das vendas do PDV Consumer.
//
// Lê o painel Consumer Connect com o cookie de uma sessão aberta no navegador
// (CONSUMER_CONNECT_COOKIE no .env.local) e grava nas tabelas pdv_* do
// Supabase com a service role. Reprocessa uma janela (padrão: D-3 até hoje)
// com upsert, então rodar de novo nunca duplica.
//
// Uso:
//   node scripts/importar-pdv-consumer.mjs                 # janela padrão, todas as lojas
//   node scripts/importar-pdv-consumer.mjs --de 2026-08-01 --ate 2026-08-23
//   node scripts/importar-pdv-consumer.mjs --loja -2147458165
//   node scripts/importar-pdv-consumer.mjs --dry-run        # só conta, não grava
// Detalhes: scripts/IMPORTACAO-PDV.md
// =========================================================
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { criarClienteConnect, SessaoExpiradaError } from '../lib/pdvConsumer/connect.js';
import { importarLoja } from '../lib/pdvConsumer/importar.js';
import { FUSO_MS } from '../lib/pdvConsumer/parse.js';

// Carrega .env.local sem depender de pacote: linha CHAVE=valor, aspas opcionais.
function carregarEnv(arquivo) {
  if (!fs.existsSync(arquivo)) return;
  for (const linha of fs.readFileSync(arquivo, 'utf8').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(linha);
    if (!m || linha.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
carregarEnv(path.resolve(process.cwd(), '.env.local'));

function arg(nome, padrao) {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : padrao;
}
const dryRun = process.argv.includes('--dry-run');
const hojeLocal = new Date(Date.now() - FUSO_MS).toISOString().slice(0, 10);
const janelaDias = Number(process.env.PDV_JANELA_DIAS || 3);
const de = arg('--de', new Date(new Date(hojeLocal + 'T00:00:00Z').getTime() - janelaDias * 86400000).toISOString().slice(0, 10));
const ate = arg('--ate', hojeLocal);
const somenteLoja = arg('--loja', null);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
const cookie = process.env.CONSUMER_CONNECT_COOKIE;
if (!url || !chave) { console.error('ERRO: NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias.'); process.exit(1); }
if (!cookie) { console.error('ERRO: CONSUMER_CONNECT_COOKIE não definido. Veja scripts/IMPORTACAO-PDV.md.'); process.exit(1); }

const sb = createClient(url, chave, { auth: { persistSession: false } });
const falhou = (erro, ctx) => { if (erro) throw new Error(`${ctx}: ${erro.message}`); };

// Implementação do contrato de banco usado por importarLoja (ver lib/pdvConsumer/importar.js).
function bancoSupabase() {
  return {
    async pedidosExistentes(empresaId, codigos) {
      const mapa = new Map();
      for (let i = 0; i < codigos.length; i += 500) {
        const { data, error } = await sb.from('pdv_pedidos')
          .select('id, codigo, status, valor_total, excluido_em, fechado_em')
          .eq('empresa_id', empresaId).in('codigo', codigos.slice(i, i + 500));
        falhou(error, 'pedidosExistentes');
        for (const p of data || []) mapa.set(p.codigo, p);
      }
      return mapa;
    },
    async gravarPedido({ pedido, itens, pagamentos }) {
      const { data, error } = await sb.from('pdv_pedidos').upsert(pedido, { onConflict: 'empresa_id,codigo' }).select('id').single();
      falhou(error, `gravarPedido ${pedido.codigo}`);
      const pedidoId = data.id;
      falhou((await sb.from('pdv_pedido_itens').delete().eq('pedido_id', pedidoId)).error, 'apagar itens');
      falhou((await sb.from('pdv_pagamentos').delete().eq('pedido_id', pedidoId)).error, 'apagar pagamentos');
      if (itens.length) falhou((await sb.from('pdv_pedido_itens').insert(itens.map(i => ({ ...i, pedido_id: pedidoId })))).error, 'inserir itens');
      if (pagamentos.length) falhou((await sb.from('pdv_pagamentos').insert(pagamentos.map(p => ({ ...p, pedido_id: pedidoId })))).error, 'inserir pagamentos');
    },
    async caixasExistentes(empresaId, codigos) {
      const { data, error } = await sb.from('pdv_caixas').select('id, codigo, status').eq('empresa_id', empresaId).in('codigo', codigos);
      falhou(error, 'caixasExistentes');
      return new Map((data || []).map(c => [c.codigo, c]));
    },
    async gravarCaixa({ caixa, movimentos }) {
      const { data, error } = await sb.from('pdv_caixas').upsert(caixa, { onConflict: 'empresa_id,codigo' }).select('id').single();
      falhou(error, `gravarCaixa ${caixa.codigo}`);
      falhou((await sb.from('pdv_caixa_movimentos').delete().eq('caixa_id', data.id)).error, 'apagar movimentos');
      if (movimentos.length) falhou((await sb.from('pdv_caixa_movimentos').insert(movimentos.map(m => ({ ...m, caixa_id: data.id })))).error, 'inserir movimentos');
    },
    async gravarRecebimentos(linhas) {
      for (let i = 0; i < linhas.length; i += 500) {
        const { error } = await sb.from('pdv_recebimentos').upsert(linhas.slice(i, i + 500), {
          onConflict: 'empresa_id,pedido_codigo,caixa_codigo,forma,operadora,valor,pago_em', ignoreDuplicates: false,
        });
        falhou(error, 'gravarRecebimentos');
      }
    },
    async substituirItensDia(empresaId, dia, linhas) {
      falhou((await sb.from('pdv_vendas_itens_dia').delete().eq('empresa_id', empresaId).eq('dia', dia)).error, 'apagar itens do dia');
      if (linhas.length) falhou((await sb.from('pdv_vendas_itens_dia').insert(linhas)).error, 'inserir itens do dia');
    },
  };
}

// Em --dry-run o banco só conta; nada é escrito.
function bancoSeco() {
  return {
    async pedidosExistentes() { return new Map(); },
    async gravarPedido() {},
    async caixasExistentes() { return new Map(); },
    async gravarCaixa() {},
    async gravarRecebimentos() {},
    async substituirItensDia() {},
  };
}

async function main() {
  const { data: lojas, error } = await sb.from('pdv_lojas').select('id_connect, empresa_id, nome_connect').eq('ativo', true);
  falhou(error, 'pdv_lojas');
  const alvo = somenteLoja ? lojas.filter(l => String(l.id_connect) === String(somenteLoja)) : lojas;
  if (!alvo.length) { console.error('Nenhuma loja ativa em pdv_lojas.'); process.exit(1); }

  console.log(`Importação PDV Consumer — ${de} a ${ate}${dryRun ? ' (dry-run)' : ''}`);
  const cliente = criarClienteConnect({ cookie });
  const banco = dryRun ? bancoSeco() : bancoSupabase();
  let statusGeral = 'ok';
  const resumo = [];

  for (const loja of alvo) {
    console.log(`\n${loja.nome_connect}`);
    let logId = null;
    if (!dryRun) {
      const { data } = await sb.from('pdv_importacoes').insert({ empresa_id: loja.empresa_id, janela_inicio: de, janela_fim: ate }).select('id').single();
      logId = data?.id;
    }
    try {
      const r = await importarLoja({ cliente, banco, loja, de, ate, log: m => console.log(m) });
      console.log(`  gravados: ${r.pedidos} pedidos, ${r.caixas} caixas, ${r.recebimentos} recebimentos, ${r.itensDia} itens/dia`);
      r.avisos.forEach(a => console.warn('  aviso: ' + a));
      const status = r.avisos.length ? 'parcial' : 'ok';
      if (status === 'parcial') statusGeral = 'parcial';
      resumo.push({ loja: loja.nome_connect, ...r });
      if (logId) await sb.from('pdv_importacoes').update({ terminado_em: new Date().toISOString(), status, pedidos: r.pedidos, caixas: r.caixas, recebimentos: r.recebimentos, itens_dia: r.itensDia, detalhes: { avisos: r.avisos } }).eq('id', logId);
    } catch (e) {
      console.error(`  ERRO: ${e.message}`);
      statusGeral = 'erro';
      if (logId) await sb.from('pdv_importacoes').update({ terminado_em: new Date().toISOString(), status: 'erro', erro: e.message }).eq('id', logId);
      if (e instanceof SessaoExpiradaError) break; // as outras lojas vão falhar igual
    }
  }
  console.log(`\nFim: ${statusGeral}`);
  process.exit(statusGeral === 'erro' ? 2 : 0);
}

main().catch(e => { console.error('ERRO: ' + e.message); process.exit(2); });
```

- [ ] **Step 2: npm script e exemplo de env**

Em `package.json`, dentro de `"scripts"`, depois de `"backup"`:

```json
    "importar-pdv": "node scripts/importar-pdv-consumer.mjs"
```

Em `.env.local.example`, no fim:

```
# Importação das vendas do PDV Consumer (scripts/importar-pdv-consumer.mjs).
# Cookie de uma sessão logada em https://connect.consumer.com.br — copie o
# valor inteiro do header "Cookie" (instruções em scripts/IMPORTACAO-PDV.md).
# Expira quando a sessão do painel expira; aí é só copiar de novo.
CONSUMER_CONNECT_COOKIE=
# Dias reprocessados a cada rodada (padrão 3).
PDV_JANELA_DIAS=3
```

- [ ] **Step 3: Escrever o guia**

`scripts/IMPORTACAO-PDV.md`:

```markdown
# Importação das vendas do PDV Consumer

O 364 OS lê o painel **Consumer Connect** (connect.consumer.com.br) da 364
Steakhouse e da 364 Foodtruck/Afya e grava pedidos, itens, pagamentos, caixas
e recebimentos nas tabelas `pdv_*`. A tela é **Vendas → Vendas PDV
(Steakhouse/Afya)**.

## Pegar o cookie da sessão

O painel não tem API nem token. O script usa o cookie do seu login:

1. Abra https://connect.consumer.com.br no Chrome e faça login.
2. `⌥⌘I` (DevTools) → aba **Network** → recarregue a página.
3. Clique na primeira requisição (`connect.consumer.com.br`) → **Headers** →
   em *Request Headers* copie o valor inteiro de `Cookie:` (começa com algo
   como `ASP.NET_SessionId=...`).
4. No `.env.local` do projeto: `CONSUMER_CONNECT_COOKIE='cole aqui'` (aspas
   simples).

Quando a sessão do painel expirar o script para com `SESSAO_EXPIRADA`: repita
os passos. Não feche a sessão no navegador ("Sair"), isso invalida o cookie.

## Rodar

```bash
npm run importar-pdv                        # últimos 3 dias, as duas lojas
npm run importar-pdv -- --de 2026-08-01     # carga inicial desde 1º de agosto
npm run importar-pdv -- --dry-run           # só conta, não grava
npm run importar-pdv -- --loja -2147458165  # só a Afya
```

Saída: contadores por loja e `Fim: ok | parcial | erro`. Cada rodada deixa
uma linha em `pdv_importacoes`, que a tela mostra como "Última importação".

## Agendar (cron, 05:00)

```bash
crontab -e
```

```
0 5 * * * cd "/caminho/do/sistema-364-web" && /usr/local/bin/npm run importar-pdv >> "$HOME/Library/Logs/364-importar-pdv.log" 2>&1
```

Use o caminho do `npm` que `which npm` devolver. O Mac precisa estar ligado e
com rede às 05:00 (mesma condição do backup das 12:30).

## Conferência

Compare um dia no painel (Dashboard → Valor Total Recebido, com o período
ajustado para o dia) com a soma de `vw_pdv_vendas_dia` daquele dia. Diferença
esperada: zero para dias com todos os pedidos finalizados.
```

- [ ] **Step 4: Rodar em dry-run contra o Connect real**

Pré-requisito: o usuário já colocou `CONSUMER_CONNECT_COOKIE` no `.env.local` e a migração 32 **ainda não** está em produção — o dry-run precisa de `pdv_lojas`. Ordem: (a) usuário aplica a migração 32 na produção via `psql "$SUPABASE_DB_URL" -f supabase/atualizacao_32_pdv_consumer.sql` (com ok explícito, conforme memória `acesso-psql-supabase-producao`); (b) `npm run importar-pdv -- --dry-run --de 2026-08-21 --ate 2026-08-22`.

Expected: duas lojas listadas, contadores maiores que zero na Steakhouse, `Fim: ok`. Se der `SESSAO_EXPIRADA`, o cookie está errado ou faltou aspas.

- [ ] **Step 5: Primeira carga real e conferência**

Run: `npm run importar-pdv -- --de 2026-08-01`
Depois: `psql "$SUPABASE_DB_URL" -c "select dia, sum(valor_total) from vw_pdv_vendas_dia where empresa_id = '0dda3c8e-228b-4d05-b50a-2e2f301d75a3' group by dia order by dia desc limit 7"`
Expected: totais por dia; conferir 21/08 com o painel (Dashboard, período 21/08 00:00–23:59, Valor Total Recebido). Registrar divergências, se houver, no commit.

- [ ] **Step 6: Commit**

```bash
git add scripts/importar-pdv-consumer.mjs scripts/IMPORTACAO-PDV.md package.json .env.local.example
git commit -m "feat(pdv): script de importação diária do Consumer Connect"
```

---

### Task 7: `lib/pdvVendas.js` — agregações da tela

**Files:**
- Create: `lib/pdvVendas.js`
- Test: `tests/pdv-vendas.test.mjs`

**Interfaces:**
- Consumes: linhas de `vw_pdv_vendas_dia`, `vw_pdv_caixa_formas_dia`, `pdv_vendas_itens_dia`, `pdv_importacoes`.
- Produces:
  - `periodoPadrao(agora = new Date()) → { de, ate }` (mês corrente até hoje, datas `YYYY-MM-DD`)
  - `periodoAnterior({ de, ate }) → { de, ate }` (mesmo número de dias, terminando no dia anterior a `de`)
  - `kpis(linhasVendas) → { faturamento, pedidos, ticketMedio, itensPorPedido, pctDelivery }`
  - `variacao(atual, anterior) → number | null` (percentual; `null` se base zero)
  - `porDia(linhasVendas) → [{ dia, mesa, delivery, outro, total, pedidos, ticket }]` ordenado por dia
  - `porOrigem(linhasVendas) → [{ origem, pedidos, valor, pct }]` ordenado por valor desc
  - `porForma(linhasFormas) → { linhas: [{ formaGrupo, rotulo, qtd, bruto, taxa, liquido }], total: {qtd, bruto, taxa, liquido} }`
  - `itensPeriodo(linhasItens) → [{ codigoDetalhe, nome, categoria, quantidade, valor, lucro, margem, abc, pct }]` com ABC recalculada no período (A até 80 % do valor acumulado, B até 95 %, C o resto)
  - `statusImportacao(ultima, agora = new Date()) → { texto, alerta: boolean }`
  - `ROTULOS_FORMA` — mapa `forma_grupo → rótulo` (`pix → 'Pix'`, `credito → 'Cartão de crédito'`, `debito → 'Cartão de débito'`, `dinheiro → 'Dinheiro'`, `ifood_online → 'iFood online'`, `voucher → 'Vale/voucher'`, `fiado → 'Fiado'`, `outro → 'Outros'`)

- [ ] **Step 1: Escrever os testes**

`tests/pdv-vendas.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  periodoPadrao, periodoAnterior, kpis, variacao, porDia, porOrigem, porForma,
  itensPeriodo, statusImportacao, ROTULOS_FORMA,
} from '../lib/pdvVendas.js';

const V = [
  { dia: '2026-08-21', tipo: 'mesa', origem: 'Comanda Mobile', qtd_pedidos: 10, qtd_itens: 40, valor_total: 1000 },
  { dia: '2026-08-21', tipo: 'delivery', origem: 'iFood', qtd_pedidos: 5, qtd_itens: 10, valor_total: 500 },
  { dia: '2026-08-22', tipo: 'mesa', origem: 'Comanda Mobile', qtd_pedidos: 8, qtd_itens: 24, valor_total: 800 },
  { dia: '2026-08-22', tipo: 'delivery', origem: 'MenuDino App/Site', qtd_pedidos: 2, qtd_itens: 4, valor_total: 100 },
];

test('periodoPadrao e periodoAnterior', () => {
  assert.deepEqual(periodoPadrao(new Date('2026-08-23T15:00:00Z')), { de: '2026-08-01', ate: '2026-08-23' });
  assert.deepEqual(periodoAnterior({ de: '2026-08-01', ate: '2026-08-23' }), { de: '2026-07-09', ate: '2026-07-31' });
  assert.deepEqual(periodoAnterior({ de: '2026-08-21', ate: '2026-08-21' }), { de: '2026-08-20', ate: '2026-08-20' });
});

test('kpis', () => {
  const k = kpis(V);
  assert.equal(k.faturamento, 2400);
  assert.equal(k.pedidos, 25);
  assert.equal(k.ticketMedio, 96);
  assert.equal(k.itensPorPedido, 78 / 25);
  assert.equal(k.pctDelivery, 600 / 2400 * 100);
  assert.deepEqual(kpis([]), { faturamento: 0, pedidos: 0, ticketMedio: 0, itensPorPedido: 0, pctDelivery: 0 });
});

test('variacao', () => {
  assert.equal(variacao(120, 100), 20);
  assert.equal(variacao(80, 100), -20);
  assert.equal(variacao(50, 0), null);
});

test('porDia empilha mesa e delivery', () => {
  const d = porDia(V);
  assert.equal(d.length, 2);
  assert.deepEqual(d[0], { dia: '2026-08-21', mesa: 1000, delivery: 500, outro: 0, total: 1500, pedidos: 15, ticket: 100 });
});

test('porOrigem ordena por valor e calcula participação', () => {
  const o = porOrigem(V);
  assert.equal(o[0].origem, 'Comanda Mobile');
  assert.equal(o[0].valor, 1800);
  assert.equal(o[0].pct, 75);
  assert.equal(o[1].origem, 'iFood');
});

test('porForma agrupa por forma_grupo com total', () => {
  const F = [
    { forma_grupo: 'credito', forma: 'Cartão de Crédito', operadora: 'Visa', qtd: 3, valor_bruto: 300, valor_liquido: 291, taxa: 9 },
    { forma_grupo: 'credito', forma: 'Cartão de Crédito', operadora: 'Mastercard', qtd: 2, valor_bruto: 200, valor_liquido: 194, taxa: 6 },
    { forma_grupo: 'pix', forma: 'Pix Manual', operadora: '(69)9', qtd: 4, valor_bruto: 400, valor_liquido: 400, taxa: 0 },
  ];
  const r = porForma(F);
  assert.equal(r.linhas.length, 2);
  assert.deepEqual(r.linhas[0], { formaGrupo: 'credito', rotulo: 'Cartão de crédito', qtd: 5, bruto: 500, taxa: 15, liquido: 485 });
  assert.deepEqual(r.total, { qtd: 9, bruto: 900, taxa: 15, liquido: 885 });
  assert.equal(ROTULOS_FORMA.ifood_online, 'iFood online');
});

test('itensPeriodo soma dias e recalcula ABC', () => {
  const I = [
    { dia: '2026-08-21', codigo_detalhe: 1, nome: 'Ancho', categoria: 'Churrasco', quantidade: 10, valor_vendido: 800, lucro: 400 },
    { dia: '2026-08-22', codigo_detalhe: 1, nome: 'Ancho', categoria: 'Churrasco', quantidade: 5, valor_vendido: 400, lucro: 200 },
    { dia: '2026-08-21', codigo_detalhe: 2, nome: 'Coca', categoria: 'Bebida', quantidade: 20, valor_vendido: 150, lucro: 100 },
    { dia: '2026-08-21', codigo_detalhe: 3, nome: 'Arroz', categoria: 'Acomp.', quantidade: 5, valor_vendido: 50, lucro: 40 },
  ];
  const r = itensPeriodo(I);
  assert.equal(r.length, 3);
  assert.equal(r[0].nome, 'Ancho');
  assert.equal(r[0].quantidade, 15);
  assert.equal(r[0].valor, 1200);
  assert.equal(r[0].lucro, 600);
  assert.equal(r[0].margem, 50);
  // ABC pelo acumulado ANTES do item: Ancho (0 %) = A, Coca (85,7 %) = B, Arroz (96,4 %) = C
  assert.equal(r[0].abc, 'A');
  assert.equal(r[1].abc, 'B');
  assert.equal(r[2].abc, 'C');
  assert.equal(r[1].pct, 150 / 1400 * 100);
});

test('statusImportacao', () => {
  const agora = new Date('2026-08-23T12:00:00Z');
  assert.deepEqual(statusImportacao(null, agora), { texto: 'Nenhuma importação registrada', alerta: true });
  assert.deepEqual(statusImportacao({ iniciado_em: '2026-08-23T08:00:00Z', status: 'ok' }, agora), { texto: 'Última importação: 23/08/2026 04:00 · ok', alerta: false });
  assert.equal(statusImportacao({ iniciado_em: '2026-08-21T08:00:00Z', status: 'ok' }, agora).alerta, true);
  assert.equal(statusImportacao({ iniciado_em: '2026-08-23T08:00:00Z', status: 'erro', erro: 'SESSAO_EXPIRADA' }, agora).alerta, true);
});
```

Regra da ABC: sobre o valor ordenado desc, o item recebe `A` se o acumulado **antes dele** está abaixo de 80 %, `B` se abaixo de 95 %, senão `C`.

- [ ] **Step 2: Rodar para ver falhar**

Run: `node --test tests/pdv-vendas.test.mjs`
Expected: `Cannot find module`.

- [ ] **Step 3: Implementar**

`lib/pdvVendas.js`:

```js
// Agregações da tela Vendas PDV. Funções puras sobre as linhas que o
// Supabase devolve (views e tabela de itens). Sem React, sem rede.

export const ROTULOS_FORMA = {
  pix: 'Pix', credito: 'Cartão de crédito', debito: 'Cartão de débito', dinheiro: 'Dinheiro',
  ifood_online: 'iFood online', voucher: 'Vale/voucher', fiado: 'Fiado', outro: 'Outros',
};

const iso = d => d.toISOString().slice(0, 10);
const dataUtc = s => new Date(s + 'T00:00:00Z');
const somaDias = (s, n) => iso(new Date(dataUtc(s).getTime() + n * 86400000));
const div = (a, b) => (b ? a / b : 0);
const n = v => Number(v) || 0;

export function periodoPadrao(agora = new Date()) {
  const ate = iso(agora);
  return { de: ate.slice(0, 8) + '01', ate };
}

export function periodoAnterior({ de, ate }) {
  const dias = Math.round((dataUtc(ate) - dataUtc(de)) / 86400000) + 1;
  const novoAte = somaDias(de, -1);
  return { de: somaDias(novoAte, -(dias - 1)), ate: novoAte };
}

export function kpis(linhas) {
  let faturamento = 0, pedidos = 0, itens = 0, delivery = 0;
  for (const l of linhas) {
    faturamento += n(l.valor_total);
    pedidos += n(l.qtd_pedidos);
    itens += n(l.qtd_itens);
    if (l.tipo === 'delivery') delivery += n(l.valor_total);
  }
  return {
    faturamento, pedidos,
    ticketMedio: div(faturamento, pedidos),
    itensPorPedido: div(itens, pedidos),
    pctDelivery: div(delivery, faturamento) * 100,
  };
}

export function variacao(atual, anterior) {
  if (!anterior) return null;
  return (atual - anterior) / anterior * 100;
}

export function porDia(linhas) {
  const mapa = new Map();
  for (const l of linhas) {
    const d = mapa.get(l.dia) || { dia: l.dia, mesa: 0, delivery: 0, outro: 0, total: 0, pedidos: 0, ticket: 0 };
    d[l.tipo in d ? l.tipo : 'outro'] += n(l.valor_total);
    d.total += n(l.valor_total);
    d.pedidos += n(l.qtd_pedidos);
    mapa.set(l.dia, d);
  }
  return [...mapa.values()].sort((a, b) => a.dia.localeCompare(b.dia)).map(d => ({ ...d, ticket: div(d.total, d.pedidos) }));
}

export function porOrigem(linhas) {
  const mapa = new Map();
  let total = 0;
  for (const l of linhas) {
    const o = mapa.get(l.origem) || { origem: l.origem || '(sem origem)', pedidos: 0, valor: 0 };
    o.pedidos += n(l.qtd_pedidos);
    o.valor += n(l.valor_total);
    total += n(l.valor_total);
    mapa.set(l.origem, o);
  }
  return [...mapa.values()].sort((a, b) => b.valor - a.valor).map(o => ({ ...o, pct: div(o.valor, total) * 100 }));
}

export function porForma(linhas) {
  const mapa = new Map();
  const total = { qtd: 0, bruto: 0, taxa: 0, liquido: 0 };
  for (const l of linhas) {
    const g = l.forma_grupo || 'outro';
    const f = mapa.get(g) || { formaGrupo: g, rotulo: ROTULOS_FORMA[g] || g, qtd: 0, bruto: 0, taxa: 0, liquido: 0 };
    f.qtd += n(l.qtd); f.bruto += n(l.valor_bruto); f.taxa += n(l.taxa); f.liquido += n(l.valor_liquido);
    total.qtd += n(l.qtd); total.bruto += n(l.valor_bruto); total.taxa += n(l.taxa); total.liquido += n(l.valor_liquido);
    mapa.set(g, f);
  }
  return { linhas: [...mapa.values()].sort((a, b) => b.bruto - a.bruto), total };
}

export function itensPeriodo(linhas) {
  const mapa = new Map();
  for (const l of linhas) {
    const i = mapa.get(l.codigo_detalhe) || { codigoDetalhe: l.codigo_detalhe, nome: l.nome, categoria: l.categoria, quantidade: 0, valor: 0, lucro: 0 };
    i.quantidade += n(l.quantidade); i.valor += n(l.valor_vendido); i.lucro += n(l.lucro);
    mapa.set(l.codigo_detalhe, i);
  }
  const lista = [...mapa.values()].sort((a, b) => b.valor - a.valor);
  const total = lista.reduce((s, i) => s + i.valor, 0);
  let acumulado = 0;
  return lista.map(i => {
    const antes = div(acumulado, total) * 100;
    acumulado += i.valor;
    return { ...i, margem: div(i.lucro, i.valor) * 100, pct: div(i.valor, total) * 100, abc: antes < 80 ? 'A' : antes < 95 ? 'B' : 'C' };
  });
}

export function statusImportacao(ultima, agora = new Date()) {
  if (!ultima) return { texto: 'Nenhuma importação registrada', alerta: true };
  const quando = new Date(ultima.iniciado_em);
  const horas = (agora - quando) / 36e5;
  const local = new Date(quando.getTime() - 4 * 36e5);
  const dd = String(local.getUTCDate()).padStart(2, '0');
  const mm = String(local.getUTCMonth() + 1).padStart(2, '0');
  const hh = String(local.getUTCHours()).padStart(2, '0');
  const mi = String(local.getUTCMinutes()).padStart(2, '0');
  const texto = `Última importação: ${dd}/${mm}/${local.getUTCFullYear()} ${hh}:${mi} · ${ultima.status}`;
  return { texto, alerta: ultima.status === 'erro' || horas > 36 };
}
```

- [ ] **Step 4: Rodar os testes**

Run: `node --test tests/pdv-vendas.test.mjs`
Expected: todos passam.

- [ ] **Step 5: Commit**

```bash
git add lib/pdvVendas.js tests/pdv-vendas.test.mjs
git commit -m "feat(pdv): agregações da tela de vendas do PDV"
```

---

### Task 8: Tela `/vendas/importacao`

**Files:**
- Modify: `app/vendas/importacao/page.js` (substitui o placeholder inteiro)
- Create: `components/charts/SerieDiariaPdv.js`
- Modify: `lib/menu.js:35` (rótulo do item)

**Interfaces:**
- Consumes: `lib/pdvVendas.js`, `BarraParticipacao`, `useEmpresaAtual`, `fmtMoney`, `supabase`.

- [ ] **Step 1: Renomear o item de menu**

Em `lib/menu.js`, trocar:

```js
      { label: 'Importação Steakhouse/Afya', href: '/vendas/importacao', modulo: 'pedidos' },
```

por:

```js
      { label: 'Vendas PDV (Steakhouse/Afya)', href: '/vendas/importacao', modulo: 'pedidos' },
```

Run: `node --test tests/menu.test.mjs` — Expected: passa (o teste não fixa rótulos; se fixar, atualize a string).

- [ ] **Step 2: Gráfico diário empilhado**

`components/charts/SerieDiariaPdv.js`:

```js
'use client';

const W = 720, H = 220, L = 10, R = 10, T = 12, B = 28;

// Barras por dia, mesa embaixo e delivery em cima. Mesmo estilo do
// SerieMensal: SVG próprio, sem biblioteca.
export default function SerieDiariaPdv({ dados }) {
  if (!dados?.length) return <p className="muted" style={{ fontSize: 12.5 }}>Sem vendas no período.</p>;
  const max = Math.max(...dados.map(d => d.total), 1);
  const alturaPlot = H - T - B;
  const y = v => T + alturaPlot * (1 - v / max);
  const base = y(0);
  const faixa = (W - L - R) / dados.length;
  const barra = faixa * 0.6;
  const mostrarRotulo = i => dados.length <= 16 || i % Math.ceil(dados.length / 16) === 0;
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Vendas por dia, mesa e delivery">
        <line x1={L} y1={base} x2={W - R} y2={base} stroke="var(--border)" strokeWidth="1" />
        {dados.map((d, i) => {
          const x = L + faixa * (i + 0.5) - barra / 2;
          const topoMesa = y(d.mesa + d.outro);
          const topoTotal = y(d.total);
          return (
            <g key={d.dia}>
              <rect x={x} y={topoMesa} width={barra} height={Math.max(base - topoMesa, 0)} fill="var(--amber)" />
              <rect x={x} y={topoTotal} width={barra} height={Math.max(topoMesa - topoTotal, 0)} fill="var(--smoke)" />
              {mostrarRotulo(i) && (
                <text x={x + barra / 2} y={H - 10} textAnchor="middle" fontSize="9" fill="var(--paper-dim)">
                  {d.dia.slice(8, 10)}/{d.dia.slice(5, 7)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div style={{ display: 'flex', gap: 16, fontSize: 11.5, color: 'var(--paper-dim)', marginTop: 6 }}>
        <span><b style={{ color: 'var(--amber)' }}>▬</b> Mesa/comanda</span>
        <span><b style={{ color: 'var(--smoke)' }}>▬</b> Delivery</span>
      </div>
    </>
  );
}
```

- [ ] **Step 3: Escrever a página**

`app/vendas/importacao/page.js`:

```js
'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { fmtMoney } from '../../../lib/format';
import AppShell from '../../../components/AppShell';
import { useEmpresaAtual } from '../../../lib/empresa';
import BarraParticipacao from '../../../components/charts/BarraParticipacao';
import SerieDiariaPdv from '../../../components/charts/SerieDiariaPdv';
import {
  periodoPadrao, periodoAnterior, kpis, variacao, porDia, porOrigem, porForma,
  itensPeriodo, statusImportacao,
} from '../../../lib/pdvVendas';

export default function VendasPdvPage() {
  return (
    <AppShell modulo="pedidos" titulo="Vendas PDV" desc="364 Steakhouse e 364 Foodtruck/Afya — importado do Consumer Connect">
      <Conteudo />
    </AppShell>
  );
}

function Delta({ pct }) {
  if (pct === null || !isFinite(pct)) return <span className="muted" style={{ fontSize: 11 }}>—</span>;
  const subiu = pct >= 0;
  return <span style={{ fontSize: 11, color: subiu ? 'var(--amber-bright)' : '#e5806c' }}>{subiu ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}% vs período anterior</span>;
}

function Kpi({ label, valor, delta }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value">{valor}</div>
      {delta !== undefined && <Delta pct={delta} />}
    </div>
  );
}

const fmtDia = d => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const fmtDataHora = s => (s ? new Date(new Date(s).getTime() - 4 * 36e5).toISOString().replace('T', ' ').slice(0, 16).split(' ').reverse().join(' ').replace(/(\d{4})-(\d{2})-(\d{2})/, '$3/$2/$1') : '—');

function Conteudo() {
  const { empresaAtual } = useEmpresaAtual();
  const [periodo, setPeriodo] = useState(periodoPadrao());
  const [temLoja, setTemLoja] = useState(null);
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [caixaAberto, setCaixaAberto] = useState(null);
  const [movimentos, setMovimentos] = useState([]);
  const [filtroCategoria, setFiltroCategoria] = useState('');
  const [busca, setBusca] = useState('');

  useEffect(() => {
    if (!empresaAtual) return;
    let ativo = true;
    (async () => {
      setErro(null); setDados(null);
      const { data: lojas } = await supabase.from('pdv_lojas').select('id_connect').eq('empresa_id', empresaAtual.id);
      if (!ativo) return;
      if (!lojas?.length) { setTemLoja(false); return; }
      setTemLoja(true);
      const ant = periodoAnterior(periodo);
      const e = empresaAtual.id;
      const [vendas, vendasAnt, formas, itens, caixas, importacao] = await Promise.all([
        supabase.from('vw_pdv_vendas_dia').select('*').eq('empresa_id', e).gte('dia', periodo.de).lte('dia', periodo.ate),
        supabase.from('vw_pdv_vendas_dia').select('*').eq('empresa_id', e).gte('dia', ant.de).lte('dia', ant.ate),
        supabase.from('vw_pdv_caixa_formas_dia').select('*').eq('empresa_id', e).gte('dia', periodo.de).lte('dia', periodo.ate),
        supabase.from('pdv_vendas_itens_dia').select('dia, codigo_detalhe, nome, categoria, quantidade, valor_vendido, lucro').eq('empresa_id', e).gte('dia', periodo.de).lte('dia', periodo.ate),
        supabase.from('pdv_caixas').select('id, codigo, aberto_em, fechado_em, saldo_inicial, saldo_final, status, dia_caixa').eq('empresa_id', e).gte('dia_caixa', periodo.de).lte('dia_caixa', periodo.ate).order('aberto_em', { ascending: false }),
        supabase.from('pdv_importacoes').select('iniciado_em, status, erro').eq('empresa_id', e).order('iniciado_em', { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (!ativo) return;
      const falha = [vendas, vendasAnt, formas, itens, caixas, importacao].find(r => r.error);
      if (falha) { setErro(falha.error.message); return; }
      setDados({ vendas: vendas.data, vendasAnt: vendasAnt.data, formas: formas.data, itens: itens.data, caixas: caixas.data, importacao: importacao.data });
    })();
    return () => { ativo = false; };
  }, [empresaAtual, periodo]);

  async function abrirCaixa(caixa) {
    if (caixaAberto === caixa.id) { setCaixaAberto(null); return; }
    const { data } = await supabase.from('pdv_caixa_movimentos').select('*').eq('caixa_id', caixa.id).order('posicao');
    setMovimentos(data || []);
    setCaixaAberto(caixa.id);
  }

  const calc = useMemo(() => {
    if (!dados) return null;
    const k = kpis(dados.vendas), ka = kpis(dados.vendasAnt);
    return {
      k, ka,
      dias: porDia(dados.vendas),
      origens: porOrigem(dados.vendas),
      formas: porForma(dados.formas),
      itens: itensPeriodo(dados.itens),
      status: statusImportacao(dados.importacao),
    };
  }, [dados]);

  if (temLoja === false) {
    return <div className="panel"><h3>Sem PDV Consumer</h3><p className="muted">A empresa selecionada não tem loja no Consumer Connect. Esta tela cobre a 364 Steakhouse e a 364 Foodtruck/Afya.</p></div>;
  }
  if (erro) return <div className="panel"><p style={{ color: '#e5806c' }}>Erro ao carregar: {erro}</p></div>;
  if (!calc) return <div className="panel"><p className="muted">Carregando…</p></div>;

  const categorias = [...new Set(calc.itens.map(i => i.categoria).filter(Boolean))].sort();
  const itensFiltrados = calc.itens.filter(i => (!filtroCategoria || i.categoria === filtroCategoria) && (!busca || i.nome.toLowerCase().includes(busca.toLowerCase())));

  return (
    <>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
        <label style={{ fontSize: 12 }}>De <input type="date" value={periodo.de} onChange={e => setPeriodo(p => ({ ...p, de: e.target.value }))} /></label>
        <label style={{ fontSize: 12 }}>Até <input type="date" value={periodo.ate} onChange={e => setPeriodo(p => ({ ...p, ate: e.target.value }))} /></label>
        <span className={`tag ${calc.status.alerta ? 'bad' : 'ok'}`}>{calc.status.texto}</span>
        {dados.importacao?.erro && <span className="muted" style={{ fontSize: 11 }}>{dados.importacao.erro}</span>}
      </div>

      <div className="kpi-grid">
        <Kpi label="Faturamento" valor={fmtMoney(calc.k.faturamento)} delta={variacao(calc.k.faturamento, calc.ka.faturamento)} />
        <Kpi label="Pedidos" valor={calc.k.pedidos} delta={variacao(calc.k.pedidos, calc.ka.pedidos)} />
        <Kpi label="Ticket médio" valor={fmtMoney(calc.k.ticketMedio)} delta={variacao(calc.k.ticketMedio, calc.ka.ticketMedio)} />
        <Kpi label="Itens por pedido" valor={calc.k.itensPorPedido.toFixed(2)} />
        <Kpi label="% delivery" valor={`${calc.k.pctDelivery.toFixed(1)}%`} />
      </div>

      <div className="panel">
        <h3>Venda por dia</h3>
        <SerieDiariaPdv dados={calc.dias} />
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table>
            <thead><tr><th>Dia</th><th className="num">Mesa</th><th className="num">Delivery</th><th className="num">Total</th><th className="num">Pedidos</th><th className="num">Ticket</th></tr></thead>
            <tbody>
              {calc.dias.map(d => (
                <tr key={d.dia}><td>{fmtDia(d.dia)}</td><td className="num">{fmtMoney(d.mesa)}</td><td className="num">{fmtMoney(d.delivery)}</td><td className="num">{fmtMoney(d.total)}</td><td className="num">{d.pedidos}</td><td className="num">{fmtMoney(d.ticket)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h3>Por origem</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Origem</th><th className="num">Pedidos</th><th className="num">Valor</th><th>Participação</th></tr></thead>
            <tbody>
              {calc.origens.map(o => (
                <tr key={o.origem}><td>{o.origem}</td><td className="num">{o.pedidos}</td><td className="num">{fmtMoney(o.valor)}</td><td><BarraParticipacao pct={o.pct} /></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h3>Caixa por forma de pagamento</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Forma</th><th className="num">Qtd</th><th className="num">Bruto</th><th className="num">Taxa</th><th className="num">Líquido</th></tr></thead>
            <tbody>
              {calc.formas.linhas.map(f => (
                <tr key={f.formaGrupo}><td>{f.rotulo}</td><td className="num">{f.qtd}</td><td className="num">{fmtMoney(f.bruto)}</td><td className="num">{fmtMoney(f.taxa)}</td><td className="num">{fmtMoney(f.liquido)}</td></tr>
              ))}
              <tr style={{ fontWeight: 600 }}><td>Total</td><td className="num">{calc.formas.total.qtd}</td><td className="num">{fmtMoney(calc.formas.total.bruto)}</td><td className="num">{fmtMoney(calc.formas.total.taxa)}</td><td className="num">{fmtMoney(calc.formas.total.liquido)}</td></tr>
            </tbody>
          </table>
        </div>
        <h4 style={{ marginTop: 18, fontSize: 12.5, color: 'var(--paper-dim)' }}>Caixas do período</h4>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Caixa</th><th>Abertura</th><th>Fechamento</th><th className="num">Saldo inicial</th><th className="num">Saldo final</th><th>Status</th></tr></thead>
            <tbody>
              {dados.caixas.map(c => (
                <>
                  <tr key={c.id} onClick={() => abrirCaixa(c)} style={{ cursor: 'pointer' }}>
                    <td>{c.codigo}</td><td>{fmtDataHora(c.aberto_em)}</td><td>{fmtDataHora(c.fechado_em)}</td>
                    <td className="num">{fmtMoney(c.saldo_inicial)}</td><td className="num">{c.saldo_final === null ? '—' : fmtMoney(c.saldo_final)}</td>
                    <td><span className={`tag ${c.status === 'Fechado' ? 'ok' : 'warn'}`}>{c.status}</span></td>
                  </tr>
                  {caixaAberto === c.id && (
                    <tr key={c.id + '-mov'}><td colSpan={6} style={{ padding: 0 }}>
                      <table style={{ fontSize: 11.5 }}>
                        <thead><tr><th>Operação</th><th>Origem</th><th>Hora</th><th className="num">Entrada</th><th className="num">Saída</th><th>Forma</th><th>Obs.</th></tr></thead>
                        <tbody>{movimentos.map(m => (
                          <tr key={m.id}><td>{m.operacao}</td><td>{m.origem}</td><td>{fmtDataHora(m.momento)}</td><td className="num">{m.entrada === null ? '' : fmtMoney(m.entrada)}</td><td className="num">{m.saida === null ? '' : fmtMoney(m.saida)}</td><td>{[m.forma, m.operadora].filter(Boolean).join(' ')}</td><td className="muted">{m.observacao}</td></tr>
                        ))}</tbody>
                      </table>
                    </td></tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h3>Itens vendidos</h3>
        <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
          <input placeholder="Buscar item" value={busca} onChange={e => setBusca(e.target.value)} />
          <select value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value)}>
            <option value="">Todas as categorias</option>
            {categorias.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Item</th><th>Categoria</th><th className="num">Qtd</th><th className="num">Valor</th><th className="num">Lucro</th><th className="num">Margem</th><th>ABC</th><th>Participação</th></tr></thead>
            <tbody>
              {itensFiltrados.map(i => (
                <tr key={i.codigoDetalhe}><td>{i.nome}</td><td className="muted">{i.categoria}</td><td className="num">{i.quantidade}</td><td className="num">{fmtMoney(i.valor)}</td><td className="num">{fmtMoney(i.lucro)}</td><td className="num">{i.margem.toFixed(1)}%</td><td><span className={`tag ${i.abc === 'A' ? 'ok' : i.abc === 'B' ? 'warn' : 'muted'}`}>{i.abc}</span></td><td><BarraParticipacao pct={i.pct} /></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
```

Simplifique `fmtDataHora` se ficar ilegível: o objetivo é `dd/mm/aaaa hh:mm` em hora local de Porto Velho. Uma versão clara:

```js
const fmtDataHora = s => {
  if (!s) return '—';
  const d = new Date(new Date(s).getTime() - 4 * 36e5);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
};
```

Use essa versão.

- [ ] **Step 4: Build e verificação visual**

Run: `npm run build`
Expected: build passa sem erro em `app/vendas/importacao/page.js`.

Depois, com o dev server (via `preview_start`, nunca `npm run dev` no Bash — ver memória `dev-local-sistema-364-web`: build e dev colidem no `.next`, então rode o build antes ou use só um dos dois), abra `/vendas/importacao` com a 364 Steakhouse selecionada e confira: KPIs preenchidos, gráfico com barras, tabela de formas com total, caixa expandindo movimentações, itens com ABC. Troque para 364 Food Service e confira o aviso "Sem PDV Consumer". Tire screenshot para o usuário.

- [ ] **Step 5: Commit**

```bash
git add app/vendas/importacao/page.js components/charts/SerieDiariaPdv.js lib/menu.js
git commit -m "feat(pdv): tela Vendas PDV com venda diária, origem, caixa por forma e itens"
```

---

### Task 9: Cron, ROADMAP e fechamento

**Files:**
- Modify: `ROADMAP.md` (seção nova)
- Modify: `tests/fixtures/pdv/README.md` (nada a mudar; só conferir que está commitado)

- [ ] **Step 1: Agendar o cron**

Run: `which npm` e depois, com o caminho devolvido:

```bash
(crontab -l 2>/dev/null; echo '0 5 * * * cd "'"$(pwd)"'" && '"$(which npm)"' run importar-pdv >> "$HOME/Library/Logs/364-importar-pdv.log" 2>&1') | crontab -
```

Run: `crontab -l`
Expected: linha do backup (12:30) e a nova (05:00).

- [ ] **Step 2: ROADMAP**

Acrescentar ao `ROADMAP.md`, na área de itens entregues, um bloco:

```markdown
### Vendas PDV Consumer (Steakhouse/Afya) — entregue em 2026-08-23

Importação diária (cron 05:00) do painel Consumer Connect para as tabelas
`pdv_*`: pedidos com itens e pagamentos, caixas com movimentações,
recebimentos com taxa/líquido e itens vendidos por dia. Tela em
Vendas → Vendas PDV. Spec em `docs/superpowers/specs/2026-08-23-importacao-vendas-consumer-design.md`,
operação em `scripts/IMPORTACAO-PDV.md`.

Pendente: alimentar `/grupo` com a receita do PDV; de-para item × produto
para baixa de estoque; duração real do cookie de sessão (medir na primeira
semana).
```

- [ ] **Step 3: Suite completa**

Run: `npm run verify`
Expected: todos os testes passam e o build fecha.

- [ ] **Step 4: Commit e push**

```bash
git add ROADMAP.md
git commit -m "docs: registra a importação de vendas do PDV Consumer no roadmap"
git push origin main
```

- [ ] **Step 5: Memória**

Atualizar a memória `364os_feature_backlog` (arquivo `364os_feature_backlog.md` no diretório de memória) com uma linha: importação do PDV Consumer entregue em 23/08/2026, cron 05:00, cookie manual; pendências listadas no ROADMAP.

---

## Self-review

**Cobertura do spec:** tabelas e views (T1); parser de `/Date/`, HTML de pedido e caixa (T2); classificação tipo/forma e dia local (T3); filtros de sessão, paginação DataTables, sessão expirada, retry, pausa (T4); janela D-3, "só detalhe se mudou", erro por loja não aborta, log `pdv_importacoes`, `--dry-run` (T5/T6); guia de cookie e cron (T6/T9); KPIs com comparação, série diária mesa×delivery, origem, formas com taxa/líquido, caixas com movimentações, itens com ABC no período, badge de última importação, aviso para empresa sem loja (T7/T8). Contas a pagar e baixa de estoque ficam fora, como o spec manda.

**Tipos e nomes:** `importarLoja` devolve `{pedidos, caixas, recebimentos, itensDia, avisos}` e o script lê exatamente esses campos; o contrato de `banco` tem os mesmos seis métodos no fake (T5) e no Supabase (T6); `normalizaPedido` lê `detalhe.html`, que o importador (T5) e os testes (T3) anexam. `COLUNAS.pedidos` bate com a lista capturada do painel.

**Placeholders:** nenhum.
