# Dashboard consolidada do Grupo 364 — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a rota `/grupo`, que mostra receita, CMV, margem, despesas, lucro, número de pedidos e ticket médio das quatro empresas do Grupo 364 somados, sem trocar a seleção de empresa, com ranking por empresa e série de doze meses.

**Architecture:** Duas views no Postgres (`vw_produto_custo` e `vw_consolidado_mensal`) fazem a agregação e devolvem uma linha por empresa por mês. `lib/consolidado.js` guarda toda a aritmética em funções puras, testadas no `node --test`. A tela e os dois gráficos SVG só compõem o que essas camadas entregam.

**Tech Stack:** Next.js 14 (App Router, componentes `'use client'`), React 18, Supabase JS v2 (PostgREST), Postgres 15+, `node:test`. Nenhuma dependência nova.

## Correções aplicadas depois da revisão do código

Dois pontos deste plano estavam errados e foram corrigidos na implementação.
O texto abaixo já reflete a correção; ficam registrados aqui para que ninguém
reintroduza a versão antiga a partir de um trecho esquecido.

1. **A fonte da qualidade do recebimento.** O plano mandava filtrar por
   `recebimento_itens.status_recebimento in ('Aceito','Aceito com ressalva')`,
   para não depender de `inspecoes_qualidade`. Essa coluna **não existe mais em
   produção**: a condição sanitária migrou para `inspecoes_qualidade`, e o resto
   do app já lê de lá (`lib/qualidade.js`, `app/estoque/page.js`,
   `app/relatorios/page.js`, `app/recebimentos/page.js`). A migração abortava com
   `column ri.status_recebimento does not exist`. O `compras_mp` passa a fazer
   `join inspecoes_qualidade iq on iq.recebimento_item_id = ri.id` filtrando
   `iq.status in ('aprovado','aprovado_com_ressalva')` — minúsculo, join interno
   (item sem inspeção não gerou movimento de estoque, logo não é compra). Como o
   repositório não versiona o DDL dessa tabela, a migração abre com uma guarda
   `to_regclass` que falha com mensagem acionável se ela não existir.

2. **A base do saldo de caixa.** `saldoCaixa` era
   `receitaCaixa − despesaCaixa − compras`. Todo recebimento aprovado gera uma
   `contas_a_pagar` com `recebimento_id` e suas parcelas
   (`app/recebimentos/page.js`), então a mesma compra saía do saldo duas vezes:
   como `compras` (competência, na data do recebimento) e como `despesa_caixa`
   (na data do pagamento). A fórmula passa a ser `receitaCaixa − despesaCaixa`.
   `compras` continua devolvido e exibido, como número de competência, fora da
   conta.

## Global Constraints

- Nenhuma dependência nova no `package.json`. Gráficos são SVG escrito à mão.
- Toda view criada leva `with (security_invoker = true)`. Sem isso a view roda como `postgres` e devolve linhas de empresas às quais o usuário não tem acesso, furando a RLS.
- A migração inteira roda dentro de `begin; ... commit;`. Falha no meio não pode deixar schema parcial.
- Idempotência: `drop view if exists` antes de cada `create view`, `add column if not exists`, `on conflict do nothing` nos inserts.
- Valores numéricos chegam do PostgREST como **string** (`numeric` vira string no JSON). Todo consumo em JavaScript passa por `Number()`.
- Textos de interface em português do Brasil. Dinheiro sempre via `fmtMoney` de `lib/format.js`.
- Classes CSS existentes: `.kpi-grid`, `.kpi`, `.panel`, `.grid2`, `.table-wrap`, `.num`, `.muted`, `.erro`, `.empty-row`, `.tag` (`.ok`/`.warn`/`.bad`), `.btn`, `.form-grid`. Não inventar classe nova sem adicionar em `app/globals.css`.
- Cores de gráfico saem das variáveis já definidas em `app/globals.css`: `--amber` (#c68a2e), `--amber-bright` (#e0a949), `--smoke` (#3c352b), `--border` (#413a2f), `--paper-dim` (#c9c0af).
- Commits em português, no padrão do repositório (`feat:`, `fix:`, `docs:`, `test:`).

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/atualizacao_21_dashboard_grupo.sql` | Coluna `produtos.custo_unitario`, as duas views, a permissão `grupo`. |
| `tests/migracao-21/fixture.sql` | Esqueleto do schema de produção suficiente para aplicar a 21. |
| `tests/migracao-21/cenarios.sql` | Asserções sobre as views e a permissão. Silêncio é aprovação. |
| `tests/migracao-21/verificar.sh` | Runner: cria banco descartável, aplica fixture + migração + cenários. |
| `lib/consolidado.js` | Aritmética pura sobre as linhas da view. Sem React, sem Supabase. |
| `tests/consolidado.test.mjs` | Testes de `lib/consolidado.js` no `node --test`. |
| `components/charts/SerieMensal.js` | Gráfico SVG de doze meses. Recebe dados prontos. |
| `components/charts/BarraParticipacao.js` | Barra de participação usada na tabela de ranking. |
| `app/grupo/page.js` | Busca a view, compõe KPIs, painéis e tabela. |
| `lib/auth.js` | Entrada do módulo `grupo` em `MODULOS`. |
| `app/produtos/page.js` | Campo "Custo unitário (R$)" no cadastro de produto. |

## Ordem das tarefas

1. Migração 21 e seus testes de SQL — nada em JavaScript funciona sem a view.
2. `lib/consolidado.js` e seus testes — a tela depende dessas funções.
3. Os dois componentes de gráfico.
4. A tela `/grupo` e a entrada em `MODULOS`.
5. O campo de custo em `app/produtos/page.js`.

---

### Task 1: Migração 21 — coluna de custo, views e permissão

**Files:**
- Create: `supabase/atualizacao_21_dashboard_grupo.sql`
- Create: `tests/migracao-21/fixture.sql`
- Create: `tests/migracao-21/cenarios.sql`
- Create: `tests/migracao-21/verificar.sh`

**Interfaces:**
- Consumes: nada.
- Produces: a view `vw_consolidado_mensal` com as colunas `empresa_id uuid`, `mes text` (formato `AAAA-MM`), `receita_competencia numeric`, `receita_caixa numeric`, `cmv numeric`, `pedidos_qtd bigint`, `itens_qtd numeric`, `produtos_sem_custo bigint`, `produtos_custo_ficha bigint`, `despesa_competencia numeric`, `despesa_caixa numeric`, `compras numeric`. E a view `vw_produto_custo` com `empresa_id uuid`, `produto_id uuid`, `custo_efetivo numeric`, `origem_custo text` (`'cadastro'` | `'ficha'` | `'sem_custo'`).

**Contexto que o implementador precisa saber:**

- `despesas` não existe mais: a migração 16 (`supabase/atualizacao_16_financeiro_contas_a_pagar.sql:118`) fez `drop table despesas` depois de migrar tudo para `contas_a_pagar`.
- Uma `contas_a_pagar` com `recebimento_id` preenchido é a nota da compra de matéria-prima, e essa compra já é contada em `compras`. Contá-la também como despesa é contar duas vezes. `app/relatorios/page.js:28` aplica o mesmo filtro `.is('recebimento_id', null)`.
- `pedidos.data`, `recebimentos.data` e `contas_a_pagar_parcelas.data_pagamento` são do tipo `date` — extrair o mês direto está correto. Já `contas_a_pagar.created_at` é `timestamptz` gravado em UTC: uma conta lançada às 21h do dia 31 cairia no mês seguinte. Só essa coluna converte com `at time zone 'America/Sao_Paulo'`.
- A qualidade do recebimento sai de `inspecoes_qualidade.status` (`'aprovado'` | `'aprovado_com_ressalva'` | `'rejeitado'` | ..., em `lib/qualidade.js`), por `join` interno de `recebimento_itens` para a inspeção. `recebimento_itens.status_recebimento` **não existe mais em produção** — apesar do que diz `supabase/atualizacao_10_recebimento_itens.sql:17`, que ficou para trás. Item sem inspeção não gerou movimento de estoque e não conta como compra, por isso o join é interno. Como o repositório não versiona o DDL de `inspecoes_qualidade`, a migração 21 abre com uma guarda `to_regclass('public.inspecoes_qualidade')` que levanta exceção com mensagem acionável se a tabela faltar.
- A tabela de permissões é `public.permissoes (user_id uuid, modulo text)` — a coluna é `user_id`, não `usuario_id` (`supabase/usuarios_permissoes.sql:10`).
- O padrão de teste de migração já existe: veja `tests/migracao-17/verificar.sh`. Ele cria um banco descartável local, aplica um fixture, aplica a migração e roda um arquivo de cenários que levanta exceção quando algo está errado.

- [ ] **Step 1: Criar o fixture do banco de teste**

Criar `tests/migracao-21/fixture.sql`:

```sql
-- Esqueleto do schema de produção suficiente para aplicar a migração 21 e
-- exercitar as duas views num Postgres local descartável.
create schema if not exists auth;

create or replace function auth.uid() returns uuid
  language sql stable as $$ select nullif(current_setting('req.uid', true), '')::uuid $$;
create or replace function auth.role() returns text
  language sql stable as $$ select coalesce(nullif(current_setting('req.role', true), ''), 'anon') $$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
end $$;

create table auth.users (id uuid primary key, email text);

create table grupos (id uuid primary key, nome text);
create table empresas (id uuid primary key, nome text, grupo_id uuid references grupos(id));
create table permissoes (user_id uuid, modulo text, primary key (user_id, modulo));
create table usuario_empresas (user_id uuid, empresa_id uuid references empresas(id));
create table funcionarios (id uuid primary key, empresa_id uuid references empresas(id), nome text);
create table fornecedores (id uuid primary key, empresa_id uuid references empresas(id), nome text);

create table materias_primas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  nome text not null, unidade text not null default 'kg',
  custo_unitario numeric(12,2) not null default 0
);

create table produtos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  codigo text not null, nome text not null, categoria text,
  unidade text not null default 'un',
  preco_venda numeric(12,2) not null default 0,
  validade_dias int not null default 90,
  created_at timestamptz not null default now()
);

create table ficha_tecnica (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  produto_id uuid not null references produtos(id),
  materia_prima_id uuid not null references materias_primas(id),
  quantidade numeric(12,4) not null
);

create table clientes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id), nome text not null
);

create table pedidos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  data date not null, cliente_id uuid references clientes(id),
  status text not null default 'Pendente'
);

create table pedido_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  pedido_id uuid not null references pedidos(id),
  produto_id uuid not null references produtos(id),
  quantidade numeric(12,4) not null,
  preco_unitario numeric(12,2) not null
);

create table recebimentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  lote text not null, data date not null,
  fornecedor_id uuid references fornecedores(id)
);

create table recebimento_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  recebimento_id uuid not null references recebimentos(id),
  materia_prima_id uuid not null references materias_primas(id),
  lote text not null,
  quantidade numeric(12,4) not null,
  custo_unitario numeric(12,2) not null,
  deposito_id uuid,
  observacoes text
);

create table inspecoes_qualidade (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  recebimento_item_id uuid not null references recebimento_itens(id),
  status text not null default 'pendente'
);

create table contas_a_pagar (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  descricao text not null, categoria_conta text not null,
  fornecedor_id uuid references fornecedores(id),
  recebimento_id uuid references recebimentos(id),
  valor_total numeric(12,2) not null,
  created_at timestamptz not null default now()
);

create table contas_a_pagar_parcelas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  conta_a_pagar_id uuid not null references contas_a_pagar(id),
  numero int not null, valor numeric(12,2) not null,
  vencimento date not null,
  status text not null default 'Pendente',
  data_pagamento date
);

create or replace function public.empresas_permitidas() returns setof uuid
  language sql stable security definer set search_path = public as $$
  select empresa_id from usuario_empresas where user_id = auth.uid() $$;

-- RLS em TODAS as tabelas que as duas views leem, para provar que
-- security_invoker respeita o escopo. Faltando RLS em qualquer uma delas, as
-- linhas daquela tabela vazam entre empresas mesmo com a view "correta" —
-- inclusive materias_primas e ficha_tecnica, lidas pelo lateral de
-- vw_produto_custo.
alter table pedidos enable row level security;
alter table pedido_itens enable row level security;
alter table produtos enable row level security;
alter table recebimentos enable row level security;
alter table recebimento_itens enable row level security;
alter table contas_a_pagar enable row level security;
alter table contas_a_pagar_parcelas enable row level security;
alter table inspecoes_qualidade enable row level security;
alter table materias_primas enable row level security;
alter table ficha_tecnica enable row level security;
-- ... uma policy `empresa_scoped` por tabela:
create policy empresa_scoped on pedidos for all
  using (empresa_id in (select public.empresas_permitidas()));
-- (idem para as demais)

grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;

-- ---------- DADOS ----------
insert into grupos values ('10000000-0000-0000-0000-000000000001', 'Grupo 364');
insert into empresas values
  ('20000000-0000-0000-0000-00000000000a', 'Food Service', '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-00000000000b', 'Steakhouse',   '10000000-0000-0000-0000-000000000001');

insert into auth.users values
  ('a0000000-0000-0000-0000-00000000000a', 'ana@364.local'),
  ('b0000000-0000-0000-0000-00000000000b', 'bruno@364.local');
insert into usuario_empresas values
  ('a0000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a'),
  ('b0000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b');
insert into permissoes values
  ('a0000000-0000-0000-0000-00000000000a', 'relatorios'),
  ('b0000000-0000-0000-0000-00000000000b', 'pedidos');

insert into fornecedores values ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', 'Frigorífico X');

insert into materias_primas (id, empresa_id, nome, unidade, custo_unitario) values
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', 'Costela', 'kg', 20.00);

-- P1: custo cadastrado (30). P2: sem custo cadastrado, ficha de 2kg x 20 = 40. P3: sem custo e sem ficha.
insert into produtos (id, empresa_id, codigo, nome, preco_venda) values
  ('50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', '0364-001', 'Costela defumada', 100.00),
  ('50000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000a', '0364-002', 'Linguiça',         60.00),
  ('50000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-00000000000a', '0364-003', 'Pão de alho',      10.00);

insert into ficha_tecnica (empresa_id, produto_id, materia_prima_id, quantidade) values
  ('20000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', 2.0);

insert into clientes (id, empresa_id, nome) values
  ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', 'Mercado Y');

-- Julho/2026 na Food Service: 1 pedido faturado, 1 pendente, 1 cancelado.
insert into pedidos (id, empresa_id, data, cliente_id, status) values
  ('70000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', '2026-07-10', '60000000-0000-0000-0000-000000000001', 'Faturado'),
  ('70000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000a', '2026-07-12', '60000000-0000-0000-0000-000000000001', 'Pendente'),
  ('70000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-00000000000a', '2026-07-14', '60000000-0000-0000-0000-000000000001', 'Cancelado');

insert into pedido_itens (empresa_id, pedido_id, produto_id, quantidade, preco_unitario) values
  ('20000000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 2, 100.00),
  ('20000000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', 1,  60.00),
  ('20000000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000003', 1,  10.00),
  ('20000000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000001', 5, 100.00);

-- Steakhouse tem venda no mesmo mês, para o teste de escopo por RLS.
insert into produtos (id, empresa_id, codigo, nome, preco_venda) values
  ('50000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', 'STK-001', 'Picanha', 200.00);
insert into pedidos (id, empresa_id, data, status) values
  ('70000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', '2026-07-20', 'Faturado');
insert into pedido_itens (empresa_id, pedido_id, produto_id, quantidade, preco_unitario) values
  ('20000000-0000-0000-0000-00000000000b', '70000000-0000-0000-0000-00000000000b', '50000000-0000-0000-0000-00000000000b', 1, 200.00);

-- Recebimento com três itens: I1 aprovado (200), I2 rejeitado (999) e I3 SEM
-- inspeção (250) — nenhum dos dois últimos pode entrar em compras.
insert into recebimentos (id, empresa_id, lote, data, fornecedor_id) values
  ('80000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', 'LT-260705-001', '2026-07-05', '30000000-0000-0000-0000-000000000001');
insert into recebimento_itens (id, empresa_id, recebimento_id, materia_prima_id, lote, quantidade, custo_unitario) values
  ('81000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', '80000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'LT-260705-001', 10,  20.00),
  ('81000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000a', '80000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'LT-260705-002',  1, 999.00),
  ('81000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-00000000000a', '80000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'LT-260705-003',  5,  50.00);
insert into inspecoes_qualidade (empresa_id, recebimento_item_id, status) values
  ('20000000-0000-0000-0000-00000000000a', '81000000-0000-0000-0000-000000000001', 'aprovado'),
  ('20000000-0000-0000-0000-00000000000a', '81000000-0000-0000-0000-000000000002', 'rejeitado');
-- I3 de propósito sem linha em inspecoes_qualidade.

-- Despesa avulsa de julho (500) + conta ligada ao recebimento (200), que NÃO é despesa.
insert into contas_a_pagar (id, empresa_id, descricao, categoria_conta, fornecedor_id, recebimento_id, valor_total, created_at) values
  ('90000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', 'Energia',  'Custos Fixos',   '30000000-0000-0000-0000-000000000001', null, 500.00, '2026-07-15T12:00:00Z'),
  ('90000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000a', 'NF compra','Custos Diretos', '30000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001', 200.00, '2026-07-06T12:00:00Z'),
  -- lançada 01/08 às 01h UTC = 31/07 às 22h em São Paulo: tem que cair em 2026-07.
  ('90000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-00000000000a', 'Virada',   'Custos Fixos',   '30000000-0000-0000-0000-000000000001', null,  70.00, '2026-08-01T01:00:00Z');

-- Energia: parcela paga em julho (300) e parcela pendente (200), que não entra
-- no caixa. NF de compra: parcela paga em julho (200) — a compra que sai do
-- caixa quando a nota é quitada, e que não pode ser subtraída de novo.
insert into contas_a_pagar_parcelas (empresa_id, conta_a_pagar_id, numero, valor, vencimento, status, data_pagamento) values
  ('20000000-0000-0000-0000-00000000000a', '90000000-0000-0000-0000-000000000001', 1, 300.00, '2026-07-20', 'Pago', '2026-07-20'),
  ('20000000-0000-0000-0000-00000000000a', '90000000-0000-0000-0000-000000000001', 2, 200.00, '2026-08-20', 'Pendente', null),
  ('20000000-0000-0000-0000-00000000000a', '90000000-0000-0000-0000-000000000002', 1, 200.00, '2026-07-25', 'Pago', '2026-07-25');
```

- [ ] **Step 2: Escrever os cenários de teste**

Criar `tests/migracao-21/cenarios.sql`. Cada bloco levanta exceção quando o comportamento errado acontece — o `psql` sai com código diferente de zero e o runner falha. Silêncio é aprovação.

```sql
\set ON_ERROR_STOP on

-- O fixture concede select em massa antes das views existirem. Em produção o
-- Supabase cuida disso por default privileges; aqui é preciso conceder à mão,
-- senão o cenário de RLS lá embaixo falha por falta de permissão, e não por
-- security_invoker.
grant select on vw_produto_custo, vw_consolidado_mensal to authenticated;

\echo '# vw_produto_custo resolve custo por cadastro, ficha e ausência'
do $$
declare c numeric; o text;
begin
  select custo_efetivo, origem_custo into c, o from vw_produto_custo
   where produto_id = '50000000-0000-0000-0000-000000000001';
  if c <> 30.00 or o <> 'cadastro' then
    raise exception 'P1 deveria ser 30/cadastro, veio %/%', c, o; end if;

  select custo_efetivo, origem_custo into c, o from vw_produto_custo
   where produto_id = '50000000-0000-0000-0000-000000000002';
  if c <> 40.00 or o <> 'ficha' then
    raise exception 'P2 deveria ser 40/ficha (2kg x 20), veio %/%', c, o; end if;

  select custo_efetivo, origem_custo into c, o from vw_produto_custo
   where produto_id = '50000000-0000-0000-0000-000000000003';
  if c <> 0 or o <> 'sem_custo' then
    raise exception 'P3 deveria ser 0/sem_custo, veio %/%', c, o; end if;
end $$;

\echo '# receita de competência exclui cancelado; caixa só faturado/enviado'
do $$
declare r record;
begin
  select * into r from vw_consolidado_mensal
   where empresa_id = '20000000-0000-0000-0000-00000000000a' and mes = '2026-07';

  -- competência: 2x100 (faturado) + 1x60 + 1x10 (pendente) = 270. Cancelado (500) fora.
  if r.receita_competencia <> 270.00 then
    raise exception 'receita_competencia deveria ser 270, veio %', r.receita_competencia; end if;
  -- caixa: só o faturado = 200.
  if r.receita_caixa <> 200.00 then
    raise exception 'receita_caixa deveria ser 200, veio %', r.receita_caixa; end if;
  if r.pedidos_qtd <> 2 then
    raise exception 'pedidos_qtd deveria ser 2 (cancelado fora), veio %', r.pedidos_qtd; end if;
  if r.itens_qtd <> 4 then
    raise exception 'itens_qtd deveria ser 4, veio %', r.itens_qtd; end if;
end $$;

\echo '# CMV usa o custo efetivo de cada produto'
do $$
declare r record;
begin
  select * into r from vw_consolidado_mensal
   where empresa_id = '20000000-0000-0000-0000-00000000000a' and mes = '2026-07';
  -- 2x30 (cadastro) + 1x40 (ficha) + 1x0 (sem custo) = 100.
  if r.cmv <> 100.00 then
    raise exception 'cmv deveria ser 100, veio %', r.cmv; end if;
  if r.produtos_sem_custo <> 1 then
    raise exception 'produtos_sem_custo deveria ser 1, veio %', r.produtos_sem_custo; end if;
  if r.produtos_custo_ficha <> 1 then
    raise exception 'produtos_custo_ficha deveria ser 1, veio %', r.produtos_custo_ficha; end if;
end $$;

\echo '# despesa ignora conta ligada a recebimento e respeita o fuso de São Paulo'
do $$
declare r record;
begin
  select * into r from vw_consolidado_mensal
   where empresa_id = '20000000-0000-0000-0000-00000000000a' and mes = '2026-07';
  -- 500 (energia) + 70 (lançada 01/08 UTC = 31/07 em SP). A NF de compra (200) fica fora.
  if r.despesa_competencia <> 570.00 then
    raise exception 'despesa_competencia deveria ser 570, veio %', r.despesa_competencia; end if;
  -- 300 (parcela da energia) + 200 (parcela da NF de compra).
  if r.despesa_caixa <> 500.00 then
    raise exception 'despesa_caixa deveria ser 500 (as duas parcelas pagas), veio %', r.despesa_caixa; end if;
end $$;

\echo '# compras ignoram item rejeitado'
do $$
declare r record;
begin
  select * into r from vw_consolidado_mensal
   where empresa_id = '20000000-0000-0000-0000-00000000000a' and mes = '2026-07';
  if r.compras <> 200.00 then
    raise exception 'compras deveria ser 200 (10 x 20; rejeitado e sem inspeção fora), veio %', r.compras; end if;
end $$;

\echo '# a permissão grupo foi concedida a quem tinha relatorios, e só a esses'
do $$
declare n int;
begin
  select count(*) into n from permissoes
   where modulo = 'grupo' and user_id = 'a0000000-0000-0000-0000-00000000000a';
  if n <> 1 then raise exception 'ana tinha relatorios e deveria ter ganhado grupo'; end if;

  select count(*) into n from permissoes
   where modulo = 'grupo' and user_id = 'b0000000-0000-0000-0000-00000000000b';
  if n <> 0 then raise exception 'bruno não tinha relatorios e não deveria ter grupo'; end if;
end $$;

\echo '# as duas views declaram security_invoker'
do $$
declare n int;
begin
  select count(*) into n from pg_class
   where relname in ('vw_produto_custo', 'vw_consolidado_mensal')
     and array_to_string(reloptions, ',') like '%security_invoker=true%';
  if n <> 2 then
    raise exception 'esperava 2 views com security_invoker=true, achei %', n; end if;
end $$;

\echo '# bruno (Steakhouse) não enxerga a Food Service através da view'
set role authenticated;
set req.role = 'authenticated';
set req.uid = 'b0000000-0000-0000-0000-00000000000b';

do $$
declare n int;
begin
  select count(*) into n from vw_consolidado_mensal
   where empresa_id = '20000000-0000-0000-0000-00000000000a';
  if n <> 0 then
    raise exception 'bruno viu % linha(s) da Food Service — security_invoker não segurou', n; end if;

  select count(*) into n from vw_consolidado_mensal
   where empresa_id = '20000000-0000-0000-0000-00000000000b';
  if n = 0 then raise exception 'bruno deveria ver a própria empresa'; end if;
end $$;

reset role;
```

- [ ] **Step 3: Escrever o runner**

Criar `tests/migracao-21/verificar.sh` e torná-lo executável:

```bash
#!/usr/bin/env bash
# Verifica a migração 21 (dashboard do grupo) num Postgres local descartável.
# Não toca em produção. Requer psql no PATH e um servidor local rodando.
#
# Uso: tests/migracao-21/verificar.sh
set -euo pipefail

export PGOPTIONS='-c client_min_messages=warning'

AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
MIG="$RAIZ/supabase/atualizacao_21_dashboard_grupo.sql"
BANCO="${BANCO_TESTE_MIG21:-mig21_teste}"

command -v psql >/dev/null || { echo "psql não encontrado no PATH"; exit 1; }
pg_isready -q || { echo "nenhum Postgres local aceitando conexões"; exit 1; }

limpar() { dropdb --if-exists "$BANCO" >/dev/null 2>&1 || true; }
trap limpar EXIT

novo_banco() {
  limpar; createdb "$BANCO"
  psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/fixture.sql"
}

echo "== 1. migração aplica e os cenários passam"
novo_banco
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$MIG" >/dev/null
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/cenarios.sql"

echo "== 2. rodar a migração duas vezes não quebra"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$MIG" >/dev/null
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/cenarios.sql" >/dev/null
echo "OK: migração é idempotente"

echo "== 3. falha no meio não deixa estado parcial"
novo_banco
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -c "drop table contas_a_pagar_parcelas;"
if psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$MIG" >/dev/null 2>&1; then
  echo "ERRO: a migração passou sem contas_a_pagar_parcelas, o que não deveria"; exit 1
fi
colunas=$(psql -tAq -d "$BANCO" -c "select count(*) from information_schema.columns where table_name='produtos' and column_name='custo_unitario';")
views=$(psql -tAq -d "$BANCO" -c "select count(*) from information_schema.views where table_name in ('vw_produto_custo','vw_consolidado_mensal');")
[ "$colunas" = "0" ] && [ "$views" = "0" ] || {
  echo "ERRO: a falha deixou $colunas coluna(s) e $views view(s) — a transação não segurou"; exit 1; }
echo "OK: nada foi aplicado, a transação desfez tudo"

echo
echo "3/3 cenários passaram"
```

Depois:

```bash
chmod +x tests/migracao-21/verificar.sh
```

- [ ] **Step 4: Rodar o teste para confirmar que ele falha**

Run: `tests/migracao-21/verificar.sh`
Expected: FAIL — `psql` reclama que `supabase/atualizacao_21_dashboard_grupo.sql` não existe.

Se `pg_isready` reclamar que não há Postgres local, subir um antes (`brew services start postgresql@16` no macOS) e repetir. Sem banco local esta tarefa não pode ser verificada.

- [ ] **Step 5: Escrever a migração**

Criar `supabase/atualizacao_21_dashboard_grupo.sql`:

```sql
-- =========================================================
-- 364 — ATUALIZAÇÃO 21: DASHBOARD CONSOLIDADA DO GRUPO
--
-- Antes de rodar, confirme a versão do Postgres no SQL Editor:
--   select version();
-- security_invoker exige Postgres 15+. Sem ele a view roda com o dono
-- (role postgres) e devolve linhas de todas as empresas, furando a RLS.
--
-- Rode depois de atualizacao_16_financeiro_contas_a_pagar.sql.
-- Tudo dentro de uma transação: falha no meio não deixa schema parcial.
-- =========================================================
begin;

-- ---------- CUSTO CADASTRADO NO PRODUTO ----------
-- Zero significa "não informado" — o cálculo cai no custo teórico da ficha.
alter table produtos add column if not exists custo_unitario numeric(12,2) not null default 0;

alter table produtos drop constraint if exists produtos_custo_unitario_check;
alter table produtos add constraint produtos_custo_unitario_check
  check (custo_unitario >= 0);

comment on column produtos.custo_unitario is
  'Custo unitário informado no cadastro. Zero = não informado; vw_produto_custo cai na ficha técnica.';

-- ---------- CUSTO EFETIVO POR PRODUTO ----------
drop view if exists vw_consolidado_mensal;
drop view if exists vw_produto_custo;

create view vw_produto_custo with (security_invoker = true) as
select
  p.empresa_id,
  p.id as produto_id,
  case when coalesce(p.custo_unitario, 0) > 0 then p.custo_unitario
       else coalesce(ft.custo_ficha, 0) end as custo_efetivo,
  case when coalesce(p.custo_unitario, 0) > 0 then 'cadastro'
       when coalesce(ft.custo_ficha, 0) > 0 then 'ficha'
       else 'sem_custo' end as origem_custo
from produtos p
left join lateral (
  select sum(f.quantidade * mp.custo_unitario) as custo_ficha
  from ficha_tecnica f
  join materias_primas mp
    on mp.id = f.materia_prima_id and mp.empresa_id = f.empresa_id
  where f.produto_id = p.id and f.empresa_id = p.empresa_id
) ft on true;

-- ---------- CONSOLIDADO MENSAL ----------
-- Uma linha por (empresa, mês). As fontes entram por union all e só depois
-- são somadas: juntá-las por join multiplicaria as linhas de venda pelas de
-- despesa e inflaria todo número da tela.
--
-- pedidos.data, recebimentos.data e parcelas.data_pagamento são `date` — o mês
-- sai direto. contas_a_pagar.created_at é `timestamptz` em UTC, e uma conta
-- lançada às 21h do dia 31 cairia no mês seguinte; só ela converte para
-- America/Sao_Paulo.
create view vw_consolidado_mensal with (security_invoker = true) as
with vendas as (
  select
    p.empresa_id,
    to_char(p.data, 'YYYY-MM') as mes,
    coalesce(sum(pi.quantidade * pi.preco_unitario)
             filter (where p.status <> 'Cancelado'), 0) as receita_competencia,
    coalesce(sum(pi.quantidade * pi.preco_unitario)
             filter (where p.status in ('Faturado', 'Enviado')), 0) as receita_caixa,
    coalesce(sum(pi.quantidade * coalesce(pc.custo_efetivo, 0))
             filter (where p.status <> 'Cancelado'), 0) as cmv,
    count(distinct p.id) filter (where p.status <> 'Cancelado') as pedidos_qtd,
    coalesce(sum(pi.quantidade) filter (where p.status <> 'Cancelado'), 0) as itens_qtd,
    count(distinct pi.produto_id) filter (
      where p.status <> 'Cancelado' and coalesce(pc.origem_custo, 'sem_custo') = 'sem_custo'
    ) as produtos_sem_custo,
    count(distinct pi.produto_id) filter (
      where p.status <> 'Cancelado' and pc.origem_custo = 'ficha'
    ) as produtos_custo_ficha
  from pedidos p
  join pedido_itens pi on pi.pedido_id = p.id and pi.empresa_id = p.empresa_id
  left join vw_produto_custo pc
    on pc.produto_id = pi.produto_id and pc.empresa_id = pi.empresa_id
  group by 1, 2
),
despesas_competencia as (
  select
    cp.empresa_id,
    to_char(cp.created_at at time zone 'America/Sao_Paulo', 'YYYY-MM') as mes,
    sum(cp.valor_total) as despesa_competencia
  from contas_a_pagar cp
  where cp.recebimento_id is null   -- conta de compra já é contada em `compras`
  group by 1, 2
),
despesas_caixa as (
  select
    pa.empresa_id,
    to_char(pa.data_pagamento, 'YYYY-MM') as mes,
    sum(pa.valor) as despesa_caixa
  from contas_a_pagar_parcelas pa
  where pa.status = 'Pago' and pa.data_pagamento is not null
  group by 1, 2
),
compras_mp as (
  select
    ri.empresa_id,
    to_char(r.data, 'YYYY-MM') as mes,
    sum(ri.quantidade * ri.custo_unitario) as compras
  from recebimento_itens ri
  join recebimentos r on r.id = ri.recebimento_id and r.empresa_id = ri.empresa_id
  join inspecoes_qualidade iq on iq.recebimento_item_id = ri.id
  where iq.status in ('aprovado', 'aprovado_com_ressalva')
  group by 1, 2
),
base as (
  select empresa_id, mes,
         receita_competencia, receita_caixa, cmv,
         pedidos_qtd, itens_qtd, produtos_sem_custo, produtos_custo_ficha,
         0::numeric as despesa_competencia, 0::numeric as despesa_caixa, 0::numeric as compras
  from vendas
  union all
  select empresa_id, mes,
         0::numeric, 0::numeric, 0::numeric,
         0::bigint, 0::numeric, 0::bigint, 0::bigint,
         despesa_competencia, 0::numeric, 0::numeric
  from despesas_competencia
  union all
  select empresa_id, mes,
         0::numeric, 0::numeric, 0::numeric,
         0::bigint, 0::numeric, 0::bigint, 0::bigint,
         0::numeric, despesa_caixa, 0::numeric
  from despesas_caixa
  union all
  select empresa_id, mes,
         0::numeric, 0::numeric, 0::numeric,
         0::bigint, 0::numeric, 0::bigint, 0::bigint,
         0::numeric, 0::numeric, compras
  from compras_mp
)
select
  empresa_id,
  mes,
  sum(receita_competencia)  as receita_competencia,
  sum(receita_caixa)        as receita_caixa,
  sum(cmv)                  as cmv,
  sum(pedidos_qtd)          as pedidos_qtd,
  sum(itens_qtd)            as itens_qtd,
  sum(produtos_sem_custo)   as produtos_sem_custo,
  sum(produtos_custo_ficha) as produtos_custo_ficha,
  sum(despesa_competencia)  as despesa_competencia,
  sum(despesa_caixa)        as despesa_caixa,
  sum(compras)              as compras
from base
group by 1, 2;

-- ---------- PERMISSÃO DO MÓDULO 'grupo' ----------
-- Sem este insert a aba nasceria invisível para todos exceto administradores.
-- Quem hoje enxerga Relatórios já vê receita e margem da própria empresa.
insert into public.permissoes (user_id, modulo)
select p.user_id, 'grupo' from public.permissoes p where p.modulo = 'relatorios'
on conflict do nothing;

commit;
```

- [ ] **Step 6: Rodar o teste até passar**

Run: `tests/migracao-21/verificar.sh`
Expected: PASS — imprime `3/3 cenários passaram`.

- [ ] **Step 7: Commit**

```bash
git add supabase/atualizacao_21_dashboard_grupo.sql tests/migracao-21
git commit -m "feat(grupo): views de custo e consolidado mensal para a dashboard do grupo"
```

---

### Task 2: `lib/consolidado.js` — aritmética do consolidado

**Files:**
- Create: `lib/consolidado.js`
- Test: `tests/consolidado.test.mjs`

**Interfaces:**
- Consumes: linhas de `vw_consolidado_mensal` (Task 1), com os campos numéricos possivelmente em formato string.
- Produces:
  - `mesCorrente(agora?: Date): string` — `'AAAA-MM'`.
  - `mesesAte(mesFinal: string, quantidade: number): string[]` — array de `'AAAA-MM'` terminando em `mesFinal`.
  - `mesAnterior(mes: string): string`.
  - `div(a: number, b: number): number` — devolve `0` quando `b` é zero.
  - `consolidar(linhas): Totais` onde `Totais = { receitaCompetencia, receitaCaixa, cmv, pedidos, itens, produtosSemCusto, produtosCustoFicha, despesaCompetencia, despesaCaixa, compras, lucroBruto, margemBrutaPct, lucroLiquido, ticketMedio, saldoCaixa }`, todos `number`.
  - `porEmpresa(linhas, empresas): Array<Totais & { id, nome, participacaoPct }>` — ordenado por `receitaCompetencia` decrescente.
  - `variacao(atual: number, anterior: number): number | null` — `null` quando `anterior` é zero.
  - `serie12(linhas, mesFinal): Array<Totais & { mes }>` — sempre doze posições.
  - `dominioSerie(dados): { min: number, max: number }`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/consolidado.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mesCorrente,
  mesesAte,
  mesAnterior,
  div,
  consolidar,
  porEmpresa,
  variacao,
  serie12,
  dominioSerie,
} from '../lib/consolidado.js';

const A = '20000000-0000-0000-0000-00000000000a';
const B = '20000000-0000-0000-0000-00000000000b';

// O PostgREST devolve numeric como string — os testes usam string de propósito.
function linha(over) {
  return {
    empresa_id: A, mes: '2026-07',
    receita_competencia: '0', receita_caixa: '0', cmv: '0',
    pedidos_qtd: '0', itens_qtd: '0',
    produtos_sem_custo: '0', produtos_custo_ficha: '0',
    despesa_competencia: '0', despesa_caixa: '0', compras: '0',
    ...over,
  };
}

test('div devolve 0 quando o denominador é zero', () => {
  assert.equal(div(10, 0), 0);
  assert.equal(div(10, 2), 5);
});

test('mesesAte devolve a quantidade pedida terminando no mês final', () => {
  assert.deepEqual(mesesAte('2026-03', 4), ['2025-12', '2026-01', '2026-02', '2026-03']);
});

test('mesesAte atravessa a virada de ano para trás', () => {
  assert.equal(mesesAte('2026-01', 12)[0], '2025-02');
  assert.equal(mesesAte('2026-01', 12).length, 12);
});

test('mesAnterior atravessa a virada de ano', () => {
  assert.equal(mesAnterior('2026-01'), '2025-12');
  assert.equal(mesAnterior('2026-08'), '2026-07');
});

test('mesCorrente formata AAAA-MM com mês de dois dígitos', () => {
  assert.equal(mesCorrente(new Date(2026, 2, 15)), '2026-03');
});

test('consolidar soma empresas diferentes e converte string em número', () => {
  const t = consolidar([
    linha({ empresa_id: A, receita_competencia: '1000', cmv: '400', pedidos_qtd: '4' }),
    linha({ empresa_id: B, receita_competencia: '500',  cmv: '100', pedidos_qtd: '1' }),
  ]);
  assert.equal(t.receitaCompetencia, 1500);
  assert.equal(t.cmv, 500);
  assert.equal(t.pedidos, 5);
  assert.equal(t.lucroBruto, 1000);
  assert.equal(t.ticketMedio, 300);
});

test('consolidar calcula margem, lucro líquido e saldo de caixa', () => {
  const t = consolidar([linha({
    receita_competencia: '1000', cmv: '400', despesa_competencia: '200',
    receita_caixa: '900', despesa_caixa: '150', compras: '250',
  })]);
  assert.equal(t.margemBrutaPct, 60);
  assert.equal(t.lucroLiquido, 400);
  assert.equal(t.saldoCaixa, 750);  // 900 - 150; `compras` é competência e fica fora
});

test('consolidar sem linhas devolve zeros, não NaN', () => {
  const t = consolidar([]);
  assert.equal(t.receitaCompetencia, 0);
  assert.equal(t.margemBrutaPct, 0);
  assert.equal(t.ticketMedio, 0);
});

test('ticket médio com zero pedidos devolve 0', () => {
  const t = consolidar([linha({ receita_competencia: '1000', pedidos_qtd: '0' })]);
  assert.equal(t.ticketMedio, 0);
});

test('porEmpresa mantém empresa sem movimento e calcula participação', () => {
  const empresas = [{ id: A, nome: 'Food Service' }, { id: B, nome: 'Steakhouse' }];
  const r = porEmpresa([linha({ empresa_id: A, receita_competencia: '800' })], empresas);
  assert.equal(r.length, 2);
  assert.equal(r[0].nome, 'Food Service');
  assert.equal(r[0].participacaoPct, 100);
  assert.equal(r[1].nome, 'Steakhouse');
  assert.equal(r[1].receitaCompetencia, 0);
  assert.equal(r[1].participacaoPct, 0);
});

test('porEmpresa ordena por receita decrescente', () => {
  const empresas = [{ id: A, nome: 'Food Service' }, { id: B, nome: 'Steakhouse' }];
  const r = porEmpresa([
    linha({ empresa_id: A, receita_competencia: '100' }),
    linha({ empresa_id: B, receita_competencia: '900' }),
  ], empresas);
  assert.equal(r[0].nome, 'Steakhouse');
  assert.equal(r[0].participacaoPct, 90);
});

test('variacao devolve null quando a base é zero', () => {
  assert.equal(variacao(500, 0), null);
});

test('variacao usa o módulo da base para não inverter o sinal', () => {
  assert.equal(variacao(150, 100), 50);
  assert.equal(variacao(-50, -100), 50);
});

test('serie12 devolve doze posições e preenche mês sem movimento com zero', () => {
  const s = serie12([linha({ mes: '2026-07', receita_competencia: '300' })], '2026-08');
  assert.equal(s.length, 12);
  assert.equal(s[11].mes, '2026-08');
  assert.equal(s[11].receitaCompetencia, 0);
  assert.equal(s[10].mes, '2026-07');
  assert.equal(s[10].receitaCompetencia, 300);
});

test('dominioSerie sempre inclui o zero e acomoda lucro negativo', () => {
  const s = serie12([
    linha({ mes: '2026-08', receita_competencia: '100', cmv: '400', despesa_competencia: '200' }),
  ], '2026-08');
  const d = dominioSerie(s);
  assert.equal(d.max >= 600, true);   // custo total = cmv + despesa
  assert.equal(d.min <= -500, true);  // lucro líquido = 100 - 400 - 200
});

test('dominioSerie sem dados não devolve intervalo degenerado', () => {
  const d = dominioSerie([]);
  assert.equal(d.min, 0);
  assert.equal(d.max, 1);
});
```

- [ ] **Step 2: Rodar o teste para confirmar que ele falha**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/consolidado.js'`.

- [ ] **Step 3: Escrever a implementação**

Criar `lib/consolidado.js`:

```js
// Aritmética da dashboard consolidada do grupo, sobre as linhas de
// vw_consolidado_mensal (uma por empresa por mês).
//
// Nada aqui importa React ou Supabase de propósito: é o que permite testar
// todo o cálculo no `node --test`, sem browser e sem banco.
//
// O PostgREST devolve colunas `numeric` como string. Toda leitura passa por
// Number() — somar string em JavaScript concatena, e o erro passa silencioso.

// Divisão guardada: denominador zero devolve 0, nunca NaN nem Infinity.
export function div(a, b) {
  return b ? a / b : 0;
}

export function mesCorrente(agora = new Date()) {
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
}

// Date.UTC normaliza mês negativo sozinho, então a virada de ano sai de graça.
export function mesesAte(mesFinal, quantidade) {
  const [ano, mes] = mesFinal.split('-').map(Number);
  const meses = [];
  for (let i = quantidade - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(ano, mes - 1 - i, 1));
    meses.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return meses;
}

export function mesAnterior(mes) {
  return mesesAte(mes, 2)[0];
}

const CAMPOS = {
  receitaCompetencia: 'receita_competencia',
  receitaCaixa: 'receita_caixa',
  cmv: 'cmv',
  pedidos: 'pedidos_qtd',
  itens: 'itens_qtd',
  produtosSemCusto: 'produtos_sem_custo',
  produtosCustoFicha: 'produtos_custo_ficha',
  despesaCompetencia: 'despesa_competencia',
  despesaCaixa: 'despesa_caixa',
  compras: 'compras',
};

// Os contadores de produto (produtosSemCusto, produtosCustoFicha) são
// `count(distinct)` por mês. Somá-los ao longo de vários meses conta o mesmo
// produto mais de uma vez — só use esses dois campos num recorte de um mês.
export function consolidar(linhas) {
  const t = {};
  for (const chave of Object.keys(CAMPOS)) t[chave] = 0;
  for (const l of linhas || []) {
    for (const [chave, coluna] of Object.entries(CAMPOS)) {
      t[chave] += Number(l[coluna] || 0);
    }
  }
  const lucroBruto = t.receitaCompetencia - t.cmv;
  return {
    ...t,
    lucroBruto,
    margemBrutaPct: div(lucroBruto, t.receitaCompetencia) * 100,
    lucroLiquido: lucroBruto - t.despesaCompetencia,
    ticketMedio: div(t.receitaCompetencia, t.pedidos),
    saldoCaixa: t.receitaCaixa - t.despesaCaixa,
  };
}

// Empresa sem movimento no recorte continua na lista, zerada. Sumir com ela
// esconderia justamente a operação que parou de vender.
export function porEmpresa(linhas, empresas) {
  const receitaGrupo = consolidar(linhas).receitaCompetencia;
  return (empresas || [])
    .map(e => {
      const t = consolidar((linhas || []).filter(l => l.empresa_id === e.id));
      return {
        id: e.id,
        nome: e.nome,
        ...t,
        participacaoPct: div(t.receitaCompetencia, receitaGrupo) * 100,
      };
    })
    .sort((a, b) => b.receitaCompetencia - a.receitaCompetencia);
}

// Base zero devolve null, renderizado como "—". Devolver Infinity ou 100%
// afirmaria um crescimento que não existe.
export function variacao(atual, anterior) {
  if (!anterior) return null;
  return ((atual - anterior) / Math.abs(anterior)) * 100;
}

export function serie12(linhas, mesFinal) {
  return mesesAte(mesFinal, 12).map(mes => ({
    mes,
    ...consolidar((linhas || []).filter(l => l.mes === mes)),
  }));
}

// Domínio vertical do gráfico. Inclui sempre o zero: barra que não parte da
// linha de base engana a leitura. `max` mínimo de 1 evita intervalo degenerado
// quando não há movimento nenhum.
export function dominioSerie(dados) {
  const valores = (dados || []).flatMap(d => [
    d.receitaCompetencia,
    d.cmv + d.despesaCompetencia,
    d.lucroLiquido,
  ]);
  return { min: Math.min(0, ...valores), max: Math.max(1, ...valores) };
}
```

- [ ] **Step 4: Rodar o teste até passar**

Run: `npm test`
Expected: PASS — todos os testes de `consolidado.test.mjs` verdes, e os testes já existentes (`custo-medio`, `lotes`, `producao`) continuam verdes.

- [ ] **Step 5: Commit**

```bash
git add lib/consolidado.js tests/consolidado.test.mjs
git commit -m "feat(grupo): aritmética do consolidado em funções puras testadas"
```

---

### Task 3: Componentes de gráfico SVG

**Files:**
- Create: `components/charts/SerieMensal.js`
- Create: `components/charts/BarraParticipacao.js`

**Interfaces:**
- Consumes: `dominioSerie` de `lib/consolidado.js` (Task 2) e o array devolvido por `serie12`.
- Produces:
  - `<SerieMensal dados={serie} />` onde `serie` é a saída de `serie12`.
  - `<BarraParticipacao pct={number} />` onde `pct` vai de 0 a 100.

**Contexto:** não há biblioteca de gráfico no projeto e não vamos adicionar nenhuma. Os dois componentes recebem dados já calculados e não buscam nada. A verificação é o `npm run build` — não há renderizador de React nos testes deste repositório, e a matemática que valia testar já ficou em `dominioSerie` (Task 2).

- [ ] **Step 1: Criar a barra de participação**

Criar `components/charts/BarraParticipacao.js`:

```jsx
'use client';

// Barra fina usada dentro da tabela de ranking: mostra a fatia da empresa na
// receita do grupo sem ocupar uma coluna de gráfico inteira.
export default function BarraParticipacao({ pct }) {
  const largura = Math.min(100, Math.max(0, Number(pct) || 0));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: 'var(--char3)', borderRadius: 3, minWidth: 40 }}>
        <div style={{ width: `${largura}%`, height: '100%', background: 'var(--amber)', borderRadius: 3 }} />
      </div>
      <span className="num" style={{ fontSize: 11.5, color: 'var(--paper-dim)', minWidth: 44 }}>
        {largura.toFixed(1)}%
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Criar o gráfico de série mensal**

Criar `components/charts/SerieMensal.js`:

```jsx
'use client';
import { dominioSerie } from '../../lib/consolidado';

const W = 720, H = 240;      // viewBox; o SVG escala para a largura do painel
const L = 10, R = 10, T = 14, B = 30;

// Doze meses de receita e custo em barras, com o lucro líquido como linha por
// cima. Sem biblioteca: o projeto não tem nenhuma e não vale carregar uma
// para três formas.
export default function SerieMensal({ dados }) {
  if (!dados?.length) {
    return <p className="muted" style={{ fontSize: 12.5 }}>Sem movimento no período.</p>;
  }

  const custoDe = d => d.cmv + d.despesaCompetencia;
  const { min, max } = dominioSerie(dados);
  const alturaPlot = H - T - B;
  const y = v => T + alturaPlot * (1 - (v - min) / (max - min));
  const base = y(0);
  const faixa = (W - L - R) / dados.length;
  const barra = faixa * 0.30;

  const linhaLucro = dados
    .map((d, i) => `${(L + faixa * (i + 0.5)).toFixed(1)},${y(d.lucroLiquido).toFixed(1)}`)
    .join(' ');

  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
           aria-label="Receita, custo e lucro líquido do grupo por mês">
        <line x1={L} y1={base} x2={W - R} y2={base} stroke="var(--border)" strokeWidth="1" />
        {dados.map((d, i) => {
          const centro = L + faixa * (i + 0.5);
          const topoReceita = y(d.receitaCompetencia);
          const topoCusto = y(custoDe(d));
          return (
            <g key={d.mes}>
              <rect x={centro - barra - 1} y={topoReceita} width={barra}
                    height={Math.max(base - topoReceita, 0)} fill="var(--amber)" />
              <rect x={centro + 1} y={topoCusto} width={barra}
                    height={Math.max(base - topoCusto, 0)} fill="var(--smoke)" />
              <text x={centro} y={H - 10} textAnchor="middle" fontSize="9"
                    fill="var(--paper-dim)">
                {`${d.mes.slice(5)}/${d.mes.slice(2, 4)}`}
              </text>
            </g>
          );
        })}
        <polyline points={linhaLucro} fill="none" stroke="var(--amber-bright)" strokeWidth="2" />
      </svg>
      <div style={{ display: 'flex', gap: 16, fontSize: 11.5, color: 'var(--paper-dim)', marginTop: 6 }}>
        <span><b style={{ color: 'var(--amber)' }}>▬</b> Receita</span>
        <span><b style={{ color: 'var(--smoke)' }}>▬</b> CMV + despesas</span>
        <span><b style={{ color: 'var(--amber-bright)' }}>▬</b> Lucro líquido</span>
      </div>
    </>
  );
}
```

- [ ] **Step 3: Verificar que o projeto compila**

Run: `npm run build`
Expected: PASS — build do Next.js sem erro.

- [ ] **Step 4: Commit**

```bash
git add components/charts
git commit -m "feat(grupo): gráficos SVG de série mensal e participação, sem dependência nova"
```

---

### Task 4: Tela `/grupo` e entrada no menu

**Files:**
- Create: `app/grupo/page.js`
- Modify: `lib/auth.js:8-20` (array `MODULOS`)

**Interfaces:**
- Consumes: `vw_consolidado_mensal` (Task 1); `consolidar`, `porEmpresa`, `variacao`, `serie12`, `mesesAte`, `mesAnterior`, `mesCorrente` de `lib/consolidado.js` (Task 2); `SerieMensal` e `BarraParticipacao` (Task 3).
- Produces: a rota `/grupo` e o módulo de permissão `'grupo'`.

**Contexto:** `AppShell` provê `EmpresaContext` com `{ empresaAtual, empresas, setEmpresaAtual }`. Esta tela usa **`empresas`** e ignora `empresaAtual` de propósito — é o ponto do recurso. `empresas` já vem filtrado pelo que o usuário pode acessar (`useAuth` em `lib/auth.js`), e a RLS das tabelas continua valendo por baixo da view.

- [ ] **Step 1: Registrar o módulo no menu**

Em `lib/auth.js`, dentro do array `MODULOS`, inserir a linha do grupo como **primeiro** item, antes de `fornecedores`:

```js
export const MODULOS = [
  { id: 'grupo', label: 'Grupo 364', href: '/grupo', ic: '◉', desc: 'Consolidado de todas as empresas' },
  { id: 'fornecedores', label: 'Fornecedores', href: '/fornecedores', ic: '▤', desc: 'Cadastro de fornecedores e categorias' },
```

O resto do array fica exatamente como está.

- [ ] **Step 2: Criar a tela**

Criar `app/grupo/page.js`:

```jsx
'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { fmtMoney } from '../../lib/format';
import AppShell from '../../components/AppShell';
import { useEmpresaAtual } from '../../lib/empresa';
import {
  consolidar, porEmpresa, variacao, serie12,
  mesesAte, mesAnterior, mesCorrente,
} from '../../lib/consolidado';
import SerieMensal from '../../components/charts/SerieMensal';
import BarraParticipacao from '../../components/charts/BarraParticipacao';

export default function GrupoPage() {
  return (
    <AppShell modulo="grupo" titulo="Grupo 364" desc="Consolidado de todas as empresas">
      <Conteudo />
    </AppShell>
  );
}

// Variação contra o mês anterior. Base zero vira "—": afirmar crescimento
// percentual sobre nada seria inventar número.
function Delta({ pct }) {
  if (pct === null || !isFinite(pct)) return <span className="muted" style={{ fontSize: 11 }}>—</span>;
  const cor = pct >= 0 ? 'var(--amber-bright)' : '#e5806c';
  return (
    <span style={{ fontSize: 11, color: cor }}>
      {pct >= 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}% vs mês anterior
    </span>
  );
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

// Tag de confiança do CMV daquela empresa no mês.
function TagCusto({ semCusto, porFicha }) {
  if (semCusto > 0) return <span className="tag bad">{semCusto} sem custo</span>;
  if (porFicha > 0) return <span className="tag warn">{porFicha} pela ficha</span>;
  return <span className="tag ok">custo cadastrado</span>;
}

function Conteudo() {
  const { empresas } = useEmpresaAtual();
  const [mes, setMes] = useState(mesCorrente());
  const [linhas, setLinhas] = useState(null);
  const [erro, setErro] = useState(null);

  // Chave estável: `empresas` é um array novo a cada render do AppShell, e usá-lo
  // direto como dependência refaria a consulta em laço.
  const idsEmpresas = (empresas || []).map(e => e.id).join(',');

  useEffect(() => {
    if (!idsEmpresas) return;
    let cancelado = false;
    async function carregar() {
      setLinhas(null);
      setErro(null);
      const janela = mesesAte(mes, 12);
      const { data, error } = await supabase
        .from('vw_consolidado_mensal')
        .select('*')
        .in('empresa_id', idsEmpresas.split(','))
        .gte('mes', janela[0])
        .lte('mes', mes);
      if (cancelado) return;
      if (error) {
        setErro(/vw_consolidado_mensal/.test(error.message)
          ? 'A view do consolidado não existe neste banco. Rode supabase/atualizacao_21_dashboard_grupo.sql no SQL Editor do Supabase.'
          : error.message);
        return;
      }
      setLinhas(data || []);
    }
    carregar();
    return () => { cancelado = true; };
  }, [idsEmpresas, mes]);

  if (erro) return <p className="erro">{erro}</p>;
  if (!linhas) return <p className="muted">Carregando…</p>;

  const anterior = mesAnterior(mes);
  const doMes = linhas.filter(l => l.mes === mes);
  const doAnterior = linhas.filter(l => l.mes === anterior);
  const t = consolidar(doMes);
  const ta = consolidar(doAnterior);
  const ranking = porEmpresa(doMes, empresas);
  const serie = serie12(linhas, mes);
  const rotulo = new Date(`${mes}-02T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const semMovimento = t.receitaCompetencia === 0 && t.despesaCompetencia === 0
    && t.compras === 0 && t.receitaCaixa === 0 && t.despesaCaixa === 0;

  return (
    <>
      <div className="panel">
        <h3>Período</h3>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div><label>Mês</label><input type="month" value={mes} onChange={e => setMes(e.target.value || mesCorrente())} /></div>
          <p className="muted" style={{ fontSize: 11.5, margin: 0 }}>
            Somando {empresas.length} empresa(s). O seletor de empresa da barra lateral não afeta esta tela.
          </p>
        </div>
      </div>

      {semMovimento ? (
        <div className="panel"><p className="muted">Sem movimento em {rotulo}.</p></div>
      ) : (
        <>
          <div className="kpi-grid">
            <Kpi label="Receita do grupo" valor={fmtMoney(t.receitaCompetencia)} delta={variacao(t.receitaCompetencia, ta.receitaCompetencia)} />
            <Kpi label="CMV" valor={fmtMoney(t.cmv)} delta={variacao(t.cmv, ta.cmv)} />
            <Kpi label="Margem bruta" valor={`${t.margemBrutaPct.toFixed(1)}%`} delta={variacao(t.margemBrutaPct, ta.margemBrutaPct)} />
            <Kpi label="Despesas" valor={fmtMoney(t.despesaCompetencia)} delta={variacao(t.despesaCompetencia, ta.despesaCompetencia)} />
            <Kpi label="Lucro líquido" valor={fmtMoney(t.lucroLiquido)} delta={variacao(t.lucroLiquido, ta.lucroLiquido)} />
            <Kpi label="Pedidos" valor={t.pedidos} delta={variacao(t.pedidos, ta.pedidos)} />
            <Kpi label="Ticket médio" valor={fmtMoney(t.ticketMedio)} delta={variacao(t.ticketMedio, ta.ticketMedio)} />
            <Kpi label="Saldo de caixa" valor={fmtMoney(t.saldoCaixa)} delta={variacao(t.saldoCaixa, ta.saldoCaixa)} />
          </div>

          <div className="grid2">
            <div className="panel">
              <h3>Resultado por competência ({rotulo})</h3>
              <table>
                <tbody>
                  <tr><td>Receita de vendas</td><td className="num">{fmtMoney(t.receitaCompetencia)}</td></tr>
                  <tr><td>(–) CMV</td><td className="num">{fmtMoney(t.cmv)}</td></tr>
                  <tr><td><b>= Lucro bruto</b></td><td className="num"><b>{fmtMoney(t.lucroBruto)}</b></td></tr>
                  <tr><td>(–) Despesas operacionais</td><td className="num">{fmtMoney(t.despesaCompetencia)}</td></tr>
                  <tr><td><b>= Lucro líquido</b></td><td className="num" style={{ color: 'var(--amber-bright)' }}><b>{fmtMoney(t.lucroLiquido)}</b></td></tr>
                </tbody>
              </table>
            </div>
            <div className="panel">
              <h3>Caixa ({rotulo})</h3>
              <table>
                <tbody>
                  <tr><td>Entradas (pedidos faturados/enviados)</td><td className="num">{fmtMoney(t.receitaCaixa)}</td></tr>
                  <tr><td>(–) Saídas (parcelas pagas)</td><td className="num">{fmtMoney(t.despesaCaixa)}</td></tr>
                  <tr><td><b>= Saldo</b></td><td className="num"><b>{fmtMoney(t.saldoCaixa)}</b></td></tr>
                  {/* informativo, fora da conta: a compra sai do caixa como parcela paga */}
                  <tr className="muted"><td>Compras recebidas no mês (competência)</td><td className="num">{fmtMoney(t.compras)}</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel">
            <h3>Últimos 12 meses</h3>
            <SerieMensal dados={serie} />
          </div>

          <div className="panel">
            <h3>Por empresa ({rotulo})</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Empresa</th><th>Receita</th><th>Participação</th><th>CMV</th>
                    <th>Margem</th><th>Despesas</th><th>Lucro</th><th>Pedidos</th>
                    <th>Ticket médio</th><th>Custo</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.map(e => (
                    <tr key={e.id}>
                      <td>{e.nome}</td>
                      <td className="num">{fmtMoney(e.receitaCompetencia)}</td>
                      <td style={{ minWidth: 130 }}><BarraParticipacao pct={e.participacaoPct} /></td>
                      <td className="num">{fmtMoney(e.cmv)}</td>
                      <td className="num">{e.margemBrutaPct.toFixed(1)}%</td>
                      <td className="num">{fmtMoney(e.despesaCompetencia)}</td>
                      <td className="num">{fmtMoney(e.lucroLiquido)}</td>
                      <td className="num">{e.pedidos}</td>
                      <td className="num">{fmtMoney(e.ticketMedio)}</td>
                      <td><TagCusto semCusto={e.produtosSemCusto} porFicha={e.produtosCustoFicha} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
              A coluna Custo indica de onde veio o CMV: produto sem custo cadastrado nem ficha técnica entra com zero e infla a margem.
            </p>
          </div>
        </>
      )}
    </>
  );
}
```

- [ ] **Step 3: Verificar que o projeto compila e os testes seguem verdes**

Run: `npm run verify`
Expected: PASS — `npm test` verde e `next build` sem erro, com `/grupo` na lista de rotas.

- [ ] **Step 4: Verificar a tela no navegador**

Subir o servidor de desenvolvimento e abrir `/grupo`. Conferir, nesta ordem:

1. A aba "Grupo 364" aparece no topo do menu lateral.
2. Os KPIs somam mais que qualquer empresa isolada (comparar com `/relatorios` trocando de empresa).
3. Trocar a empresa no seletor da barra lateral **não** muda nenhum número da tela.
4. Escolher um mês sem movimento mostra "Sem movimento em <mês>", não uma tela quebrada.
5. O console do navegador não tem erro.

- [ ] **Step 5: Commit**

```bash
git add app/grupo/page.js lib/auth.js
git commit -m "feat(grupo): dashboard consolidada do grupo em /grupo"
```

---

### Task 5: Campo de custo no cadastro de produto

**Files:**
- Modify: `app/produtos/page.js:10` (`PROD_VAZIO`), `:74-88` (`addProduto`), `:200-217` (formulário), `:224-241` (listagem)

**Interfaces:**
- Consumes: a coluna `produtos.custo_unitario` (Task 1) e a função `custoTeorico(produtoId)` que já existe em `app/produtos/page.js:149`.
- Produces: nenhum símbolo novo para outras tarefas.

**Contexto:** `custoTeorico(produtoId)` soma a ficha técnica do produto (`ficha_tecnica.quantidade × materias_primas.custo_unitario`) e já é usada na listagem. O campo novo não substitui esse cálculo: ele é o valor que tem precedência, e `custoTeorico` continua como referência e como fallback do lado do banco.

- [ ] **Step 1: Adicionar o campo ao estado do formulário**

Em `app/produtos/page.js`, linha 10, incluir `custo_unitario` no objeto:

```js
const PROD_VAZIO = { nome: '', categoria: '', unidade: 'un', custo_unitario: '', preco_venda: '', validade_dias: 90, producao_interna: false };
```

- [ ] **Step 2: Persistir o campo no insert**

Dentro de `addProduto`, no objeto passado para `.insert([...])`, adicionar a linha logo antes de `preco_venda`:

```js
      custo_unitario: Number(formProd.custo_unitario) || 0,
```

- [ ] **Step 3: Adicionar a função que atualiza o custo de um produto já cadastrado**

Logo depois de `delProduto` (por volta da linha 95), adicionar:

```js
  async function salvarCusto(produtoId, valor) {
    const { error } = await supabase.from('produtos')
      .update({ custo_unitario: Number(valor) || 0 })
      .eq('id', produtoId);
    if (error) { alert('Erro ao salvar o custo: ' + error.message); return; }
    carregar();
  }
```

- [ ] **Step 4: Adicionar o campo ao formulário de novo produto**

No `<form onSubmit={addProduto} className="form-grid">`, inserir o bloco abaixo imediatamente antes da linha do "Preço de venda (R$)":

```jsx
          <div>
            <label>Custo unitário (R$)</label>
            <input type="number" step="0.01" placeholder="0,00" value={formProd.custo_unitario}
                   onChange={e => setFormProd({ ...formProd, custo_unitario: e.target.value })} />
          </div>
```

E, no `<p className="muted">` logo abaixo do formulário, acrescentar a frase ao final do texto existente:

```
Deixar o custo em branco faz o sistema usar o custo teórico da ficha técnica no cálculo de CMV.
```

- [ ] **Step 5: Mostrar e editar o custo na listagem**

Na listagem do catálogo, substituir o cálculo da margem e o `<span>` de resumo. Onde hoje está:

```jsx
          const custoT = custoTeorico(p.id);
          const margem = Number(p.preco_venda) ? ((Number(p.preco_venda) - custoT) / Number(p.preco_venda) * 100) : 0;
```

passa a ser:

```jsx
          const custoT = custoTeorico(p.id);
          const custoEfetivo = Number(p.custo_unitario) > 0 ? Number(p.custo_unitario) : custoT;
          const margem = Number(p.preco_venda) ? ((Number(p.preco_venda) - custoEfetivo) / Number(p.preco_venda) * 100) : 0;
```

E o `<span className="muted">` do resumo passa a ser:

```jsx
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    Custo: {fmtMoney(custoEfetivo)}
                    {Number(p.custo_unitario) > 0
                      ? <span className="tag ok" style={{ marginLeft: 6 }}>cadastrado</span>
                      : custoT > 0
                        ? <span className="tag warn" style={{ marginLeft: 6 }}>pela ficha</span>
                        : <span className="tag bad" style={{ marginLeft: 6 }}>sem custo</span>}
                    {' · '}Preço: {fmtMoney(p.preco_venda)} · Margem: {margem.toFixed(1)}%
                  </span>
                  <button className="btn secondary small"
                          onClick={() => salvarCusto(p.id, prompt(`Custo unitário de ${p.nome} (R$). Custo teórico da ficha: ${fmtMoney(custoT)}`, p.custo_unitario || custoT.toFixed(2)) ?? p.custo_unitario)}>
                    Editar custo
                  </button>
```

- [ ] **Step 6: Verificar**

Run: `npm run verify`
Expected: PASS.

Depois, no navegador: cadastrar um produto com custo, cadastrar outro sem custo mas com ficha técnica, e confirmar que a listagem mostra as tags `cadastrado` e `pela ficha`. Em seguida abrir `/grupo` e conferir que a coluna Custo do ranking reflete o mesmo estado.

- [ ] **Step 7: Commit**

```bash
git add app/produtos/page.js
git commit -m "feat(produtos): custo unitário no cadastro, com fallback para a ficha técnica"
```

---

## Verificação final

Depois da Task 5, rodar tudo de uma vez:

```bash
npm run verify && tests/migracao-21/verificar.sh
```

Ambos precisam passar. Em seguida, aplicar `supabase/atualizacao_21_dashboard_grupo.sql` no SQL Editor do Supabase de produção — as views não existem lá até esse momento, e `/grupo` mostra a mensagem pedindo a migração até que ela rode.

## Fora de escopo

Alertas de parcelas vencidas, despesa por categoria de conta, curva ABC de produtos, recorte por cliente ou região e exportação. A estrutura de `vw_consolidado_mensal` e de `lib/consolidado.js` comporta cada um deles depois sem reescrita.
