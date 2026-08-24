# Conciliação Bancária — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Importar extratos bancários (PDF/OFX/CSV) e faturas de cartão para dentro do módulo financeiro e conciliar cada saída com as parcelas do contas a pagar, com aprendizado de padrões a cada confirmação.

**Architecture:** Route handlers com service role fazem upload, parse e escrita (padrão de `app/api/nfe/*`); leitura de tela continua client-side via PostgREST com RLS, como o resto do financeiro. PDF é extraído pela Claude API no servidor; OFX/CSV têm parsers determinísticos próprios. Conciliação é atômica em funções Postgres chamadas por RPC.

**Tech Stack:** Next.js 14.2.5 (App Router, JS puro, sem TypeScript), React 18.3.1, Supabase (`@supabase/supabase-js` ^2.45.0), Claude API via `fetch` (sem SDK novo), CSS artesanal em `app/globals.css`, testes com `node --test` e `psql`.

**Spec:** `docs/superpowers/specs/2026-08-24-conciliacao-bancaria-design.md`

## Global Constraints

- **Migração 35** é a próxima: arquivo `supabase/atualizacao_35_conciliacao_bancaria.sql`. Convenção: cabeçalho em comentário longo explicando o porquê, `begin;`/`commit;`, e bloco `-- ---------- ROLLBACK ----------` comentado no fim (o `verificar.sh` descomenta com `sed` para testar). Idempotente (`create table if not exists`, `create or replace function`, `drop policy if exists` antes de `create policy`).
- **RLS**: toda tabela nova recebe policy com o nome e o corpo exatos das existentes:
  `create policy "empresa_scoped_access" on <tabela> for all using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas())) with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));`
- **Rotas** declaram `export const runtime = 'nodejs'`, autorizam com `autorizarModulo(request, 'financeiro')` de `lib/pontoServer.js` e validam a empresa com `garantirEmpresa(sb, user, isAdmin, empresaId)` de `lib/nfe/autorizacao.js`. Service role passa por cima do RLS — **sem `garantirEmpresa` a rota é um vazamento entre empresas do grupo**.
- **Nunca importar `lib/pontoServer.js` (nem nada que importe `next/server`) em arquivo coberto por `node --test`** — quebra a suíte. Lógica pura vive em `lib/extratos/*.js` sem import de Next.
- **Valores monetários**: `numeric(12,2)` no banco; em JS sempre comparar com tolerância de 1 centavo (`Math.abs(a - b) <= 0.01`), nunca `===`.
- **`valor` de lançamento é sempre positivo**; o sinal vive em `tipo` (`'saida'` | `'entrada'`).
- **Datas** em `YYYY-MM-DD` (string), como o resto do projeto (`lib/format.js`).
- **Testes**: `npm test` roda `node --test tests/*.test.mjs` — arquivos novos vão na raiz de `tests/`, não em subpasta. Teste de migração vai em `tests/migracao-35/` e roda por `tests/migracao-35/verificar.sh`.
- **Nenhuma dependência npm nova, com uma exceção declarada na Task 7:** o SDK oficial `@anthropic-ai/sdk` entra para a chamada da Claude API — HTTP à mão perderia retry automático de 429/5xx e os tipos de erro, e isso é caro numa rota que importa dinheiro. O parser OFX continua escrito à mão (o `fast-xml-parser` não lê OFX 1.x, que é SGML).
- **Env nova**: `ANTHROPIC_API_KEY` (obrigatória para PDF) e `EXTRATO_IA_MODELO` (opcional, default `claude-sonnet-5`).
- **Commits**: um por task, prefixo `feat:`/`test:`/`docs:` conforme o conteúdo.

## Ajustes ao spec (decididos ao detalhar o plano)

Três refinamentos que o spec não previa e que os executores devem seguir:

1. **`extrato_lancamentos.conta_criada_id`** (coluna nova, não estava no spec): guarda a conta a pagar criada por `fn_criar_conta_e_conciliar`. Sem ela, desfazer a conciliação deixaria uma conta a pagar fantasma em `Pendente`. Desfazer apaga essa conta (o cascade limpa parcela e vínculo).
2. **OFX não traz saldo inicial** (só `LEDGERBAL`, o saldo final). A validação aritmética é ignorada quando `saldoInicial` é `null` — vale para OFX e para CSV.
3. **`forma_pagamento` é inferida em JS** (`inferirFormaPagamento` em `matching.js`) e passada como parâmetro para as funções SQL. As funções não fazem parsing de texto.
4. **CSV com layout não reconhecido é recusado**, não mandado para a IA como o spec dizia. O caminho da IA manda o arquivo como bloco `document` de PDF — um CSV não entra nele. Em vez de inventar um segundo caminho (texto solto, sem o mesmo schema), a rota devolve erro pedindo OFX ou PDF, que são os dois formatos que a leitura automática cobre de verdade.
5. **A migração 35 também libera OFX e CSV no bucket `recebimentos`** (`storage.buckets.allowed_mime_types`). O bucket tem lista restrita — sem isso o upload de `.ofx` falha com "mime type is not supported", do mesmo jeito que o XML falhava antes da atualização 25.

## Estrutura de arquivos

**Criar:**

| Arquivo | Responsabilidade |
|---|---|
| `supabase/atualizacao_35_conciliacao_bancaria.sql` | 4 tabelas + coluna `conta_criada_id` + RLS + índices + 5 funções de conciliação |
| `tests/migracao-35/{fixture.sql,cenarios.sql,verificar.sh}` | Migração exercitada em Postgres local descartável |
| `lib/extratos/normalizar.js` | `normalizarDescricao` — texto do banco → chave de aprendizado |
| `lib/extratos/dedupe.js` | `hashDedupe` — sha256 da identidade do lançamento |
| `lib/extratos/validar.js` | `validarExtrato`, `validarFatura` — conferência aritmética |
| `lib/extratos/matching.js` | Motor de sugestão (funções puras, rodam no servidor e no browser) |
| `lib/extratos/parseOfx.js` | Parser OFX 1.x (SGML) e 2.x (XML), tokenizer próprio |
| `lib/extratos/parseCsv.js` | Parser CSV com detecção heurística de colunas |
| `lib/extratos/extrairPdf.js` | Extração via Claude API com tool de saída estruturada |
| `lib/extratos/cliente.js` | `chamarApi` — fetch com Bearer token da sessão (usado pela UI) |
| `lib/extratosServer.js` | Orquestração da importação no servidor (só rotas importam) |
| `app/api/financeiro/extratos/upload/route.js` | POST multipart: arquivo → lançamentos + sugestões |
| `app/api/financeiro/conciliacao/route.js` | POST: confirmar (individual e lote), criar conta, desfazer, pagar fatura |
| `app/financeiro/contas-bancarias/page.js` | Cadastro de contas e cartões |
| `app/financeiro/conciliacao/page.js` | Tela de conciliação |
| `components/ImportarExtrato.js` | Bloco de upload (espelho de `ImportarNota.js`) |
| `tests/extratos-normalizar.test.mjs`, `tests/extratos-matching.test.mjs`, `tests/extratos-parse-ofx.test.mjs`, `tests/extratos-parse-csv.test.mjs`, `tests/extratos-validar.test.mjs`, `tests/extratos-extrair-pdf.test.mjs` | Testes de lógica pura |

**Modificar:**

| Arquivo | Mudança |
|---|---|
| `lib/storage.js` | Helpers `uploadArquivoExtrato`, `signedUrlExtrato` |
| `lib/financeiro.js` | `FORMAS_PAGAMENTO` ganha `'Cartão de Crédito'` |
| `lib/menu.js` | Dois links novos no módulo `financeiro` |
| `ROADMAP.md` | Seção da conciliação bancária |
| `.env.example` (se existir; senão documentar no ROADMAP) | `ANTHROPIC_API_KEY`, `EXTRATO_IA_MODELO` |

---

### Task 1: Migração 35 — tabelas, RLS e índices

**Files:**
- Create: `supabase/atualizacao_35_conciliacao_bancaria.sql`
- Create: `tests/migracao-35/fixture.sql`
- Create: `tests/migracao-35/cenarios.sql`
- Create: `tests/migracao-35/verificar.sh`

**Interfaces:**
- Consumes: nada (primeira task).
- Produces: tabelas `contas_bancarias`, `extrato_importacoes`, `extrato_lancamentos`, `conciliacao_vinculos`, `conciliacao_padroes` com as colunas exatas listadas abaixo. As tasks 2, 8, 9, 10, 11 dependem desses nomes.

- [ ] **Step 1: Escrever o fixture do banco de teste**

Cria `tests/migracao-35/fixture.sql`. Ele stub-a o que o Supabase dá de graça (`auth.role()`, `public.empresas_permitidas()`) e cria as tabelas pré-existentes que a migração 35 referencia por FK.

```sql
-- Base mínima para exercitar a atualização 35 num Postgres local. Não é
-- espelho da produção: só o suficiente para as FKs, as policies e as
-- funções de conciliação rodarem. Espelha o recorte de
-- atualizacao_16_financeiro_contas_a_pagar.sql.
create extension if not exists pgcrypto;

create schema if not exists auth;
create or replace function auth.role() returns text
  language sql stable as $$ select 'authenticated'::text $$;

create table if not exists public.empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null
);

create table if not exists public.fornecedores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  nome text not null,
  cnpj text
);

create table if not exists public.funcionarios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  nome text not null
);

create table if not exists public.contas_a_pagar (
  id uuid primary key default gen_random_uuid(),
  descricao text not null,
  categoria_conta text not null check (categoria_conta in
    ('Custos Fixos','Custos Diretos','Custos Variáveis','Investimentos')),
  fornecedor_id uuid not null references public.fornecedores(id),
  recebimento_id uuid,
  nota_fiscal_numero text,
  nota_fiscal_anexo_path text,
  valor_total numeric(12,2) not null,
  responsavel_id uuid references public.funcionarios(id),
  empresa_id uuid not null references public.empresas(id),
  created_at timestamptz not null default now()
);

create table if not exists public.contas_a_pagar_parcelas (
  id uuid primary key default gen_random_uuid(),
  conta_a_pagar_id uuid not null references public.contas_a_pagar(id) on delete cascade,
  numero int not null,
  valor numeric(12,2) not null,
  vencimento date not null,
  status text not null default 'Pendente' check (status in ('Pendente','Pago')),
  data_pagamento date,
  forma_pagamento text,
  comprovante_path text,
  empresa_id uuid not null references public.empresas(id),
  created_at timestamptz not null default now(),
  unique (conta_a_pagar_id, numero)
);

-- Empresa do teste, com id fixo para os cenários poderem referenciá-la.
insert into public.empresas (id, nome)
  values ('11111111-1111-1111-1111-111111111111', 'Steakhouse Teste')
  on conflict (id) do nothing;
insert into public.empresas (id, nome)
  values ('22222222-2222-2222-2222-222222222222', 'Outra Empresa')
  on conflict (id) do nothing;

-- empresas_permitidas() devolve só a primeira: prova que o RLS separa.
create or replace function public.empresas_permitidas() returns setof uuid
  language sql stable as $$ select '11111111-1111-1111-1111-111111111111'::uuid $$;

insert into public.fornecedores (id, empresa_id, nome, cnpj)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          '11111111-1111-1111-1111-111111111111', 'Distribuidora Boi Forte', '12345678000199')
  on conflict (id) do nothing;
insert into public.funcionarios (id, empresa_id, nome)
  values ('bbbbbbbb-0000-0000-0000-000000000001',
          '11111111-1111-1111-1111-111111111111', 'Gustavo')
  on conflict (id) do nothing;
```

- [ ] **Step 2: Escrever a migração — cabeçalho e as cinco tabelas**

Cria `supabase/atualizacao_35_conciliacao_bancaria.sql`. Este step escreve o arquivo até o `commit;`; a Task 2 acrescenta as funções antes do bloco de rollback.

```sql
-- =========================================================
-- Atualização 35 — Conciliação bancária
--
-- O financeiro registra conta a pagar e baixa parcela, mas nada prova que o
-- que saiu do banco é o que foi lançado. Esta migração traz o extrato para
-- dentro do sistema: cada arquivo importado (extrato ou fatura de cartão)
-- vira uma linha em extrato_importacoes, cada linha do arquivo vira um
-- extrato_lancamentos, e a associação com as parcelas do contas a pagar vive
-- em conciliacao_vinculos (N:N — um débito às vezes paga vários boletos).
--
-- conciliacao_padroes é o aprendizado: a cada confirmação do colaborador,
-- a descrição normalizada do extrato passa a apontar para um fornecedor e
-- uma categoria, e a importação seguinte já chega sugerida.
--
-- Nesta fase só as saídas são conciliadas; entradas entram com status
-- 'ignorado' para ficarem visíveis sem cobrar trabalho de ninguém.
--
-- Rode depois de atualizacao_34_pdv_margem_larga.sql. Idempotente.
-- =========================================================
begin;

-- ---------- CONTAS BANCÁRIAS ----------
-- Cadastro que não existia. Cartão de crédito é conta de tipo próprio: a
-- fatura importa contra ela, e o pagamento da fatura aparece na conta
-- corrente como uma única saída.
create table if not exists public.contas_bancarias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  nome text not null,
  instituicao text not null,
  tipo text not null check (tipo in ('conta_corrente','cartao_credito')),
  agencia text,
  numero_conta text,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists contas_bancarias_empresa_id_idx
  on public.contas_bancarias(empresa_id);

alter table public.contas_bancarias enable row level security;
drop policy if exists "empresa_scoped_access" on public.contas_bancarias;
create policy "empresa_scoped_access" on public.contas_bancarias for all
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()))
  with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

-- ---------- IMPORTAÇÕES ----------
-- Um registro por arquivo. Espelha pdv_importacoes: status do job, contadores
-- e a mensagem de erro ficam aqui para a tela poder explicar o que aconteceu.
create table if not exists public.extrato_importacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  conta_bancaria_id uuid not null references public.contas_bancarias(id),
  tipo text not null check (tipo in ('extrato','fatura_cartao')),
  arquivo_path text not null,
  arquivo_nome text,
  formato text not null check (formato in ('pdf','ofx','csv')),
  periodo_inicio date,
  periodo_fim date,
  status text not null default 'processando'
    check (status in ('processando','aguardando_conciliacao','concluida','erro')),
  total_lancamentos int not null default 0,
  conciliados int not null default 0,
  alerta text,
  erro text,
  created_at timestamptz not null default now()
);
create index if not exists extrato_importacoes_empresa_id_idx
  on public.extrato_importacoes(empresa_id);
create index if not exists extrato_importacoes_conta_idx
  on public.extrato_importacoes(conta_bancaria_id);

alter table public.extrato_importacoes enable row level security;
drop policy if exists "empresa_scoped_access" on public.extrato_importacoes;
create policy "empresa_scoped_access" on public.extrato_importacoes for all
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()))
  with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

-- ---------- PADRÕES (o aprendizado) ----------
-- Criada antes de extrato_lancamentos porque este referencia padrao_id.
-- Chave é a descrição normalizada: "PIX ENVIADO BOI FORTE" aprende o
-- fornecedor uma vez e sugere para sempre. Sem ML — de-para, no espírito
-- de lib/nfe/dePara.js.
create table if not exists public.conciliacao_padroes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  padrao text not null,
  fornecedor_id uuid references public.fornecedores(id),
  categoria_conta text,
  usos int not null default 1,
  ultimo_uso timestamptz default now(),
  created_at timestamptz not null default now(),
  unique (empresa_id, padrao)
);

alter table public.conciliacao_padroes enable row level security;
drop policy if exists "empresa_scoped_access" on public.conciliacao_padroes;
create policy "empresa_scoped_access" on public.conciliacao_padroes for all
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()))
  with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

-- ---------- LANÇAMENTOS ----------
-- valor é sempre positivo; o sinal vive em tipo. hash_dedupe é a identidade
-- do lançamento: reimportar o mesmo período não duplica linha.
-- parcela_sugerida_id é sugestão do motor, não vínculo — o vínculo só nasce
-- quando o colaborador confirma.
create table if not exists public.extrato_lancamentos (
  id uuid primary key default gen_random_uuid(),
  importacao_id uuid not null references public.extrato_importacoes(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id),
  data date not null,
  descricao text not null,
  descricao_normalizada text not null,
  valor numeric(12,2) not null,
  tipo text not null check (tipo in ('saida','entrada')),
  documento text,
  hash_dedupe text not null,
  status text not null default 'pendente'
    check (status in ('pendente','sugerido','conciliado','ignorado')),
  parcela_sugerida_id uuid references public.contas_a_pagar_parcelas(id) on delete set null,
  padrao_id uuid references public.conciliacao_padroes(id) on delete set null,
  fatura_id uuid references public.extrato_importacoes(id) on delete set null,
  conta_criada_id uuid references public.contas_a_pagar(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (empresa_id, hash_dedupe)
);
create index if not exists extrato_lancamentos_importacao_idx
  on public.extrato_lancamentos(importacao_id);
create index if not exists extrato_lancamentos_empresa_status_idx
  on public.extrato_lancamentos(empresa_id, status);
create index if not exists extrato_lancamentos_fatura_idx
  on public.extrato_lancamentos(fatura_id);

alter table public.extrato_lancamentos enable row level security;
drop policy if exists "empresa_scoped_access" on public.extrato_lancamentos;
create policy "empresa_scoped_access" on public.extrato_lancamentos for all
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()))
  with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

-- ---------- VÍNCULOS ----------
-- N:N porque um débito único às vezes paga dois ou três boletos do mesmo
-- fornecedor. baixou_parcela guarda se foi esta conciliação que baixou a
-- parcela — é o que permite desfazer sem reabrir parcela que já estava paga
-- antes (ex.: linha de fatura de cartão, que concilia mas não baixa).
create table if not exists public.conciliacao_vinculos (
  id uuid primary key default gen_random_uuid(),
  lancamento_id uuid not null references public.extrato_lancamentos(id) on delete cascade,
  parcela_id uuid not null references public.contas_a_pagar_parcelas(id) on delete cascade,
  valor_aplicado numeric(12,2) not null,
  baixou_parcela boolean not null default false,
  empresa_id uuid not null references public.empresas(id),
  created_at timestamptz not null default now(),
  unique (lancamento_id, parcela_id)
);
create index if not exists conciliacao_vinculos_lancamento_idx
  on public.conciliacao_vinculos(lancamento_id);
create index if not exists conciliacao_vinculos_parcela_idx
  on public.conciliacao_vinculos(parcela_id);

alter table public.conciliacao_vinculos enable row level security;
drop policy if exists "empresa_scoped_access" on public.conciliacao_vinculos;
create policy "empresa_scoped_access" on public.conciliacao_vinculos for all
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()))
  with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

-- ---------- BUCKET ----------
-- O bucket 'recebimentos' foi criado com allowed_mime_types restrito (PDF,
-- imagens e, desde a atualização 25, XML). O extrato em OFX e em CSV bate em
-- "mime type is not supported" e o upload falha. Libera os dois aqui, mantendo
-- a lista anterior inteira.
--
-- O guard existe porque o schema storage só existe no Supabase: o teste local
-- (tests/migracao-35/) roda esta mesma migração num Postgres cru.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets
       set allowed_mime_types = array[
             'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic',
             'application/xml', 'text/xml',
             'application/x-ofx', 'text/csv', 'text/plain', 'application/octet-stream'
           ]
     where id = 'recebimentos';
  end if;
end $$;

commit;

-- ---------- ROLLBACK ----------
-- begin;
-- drop table if exists public.conciliacao_vinculos;
-- drop table if exists public.extrato_lancamentos;
-- drop table if exists public.conciliacao_padroes;
-- drop table if exists public.extrato_importacoes;
-- drop table if exists public.contas_bancarias;
-- commit;
--
-- O bucket fica FORA do bloco acima de propósito: tests/migracao-35/verificar.sh
-- extrai o rollback por sed entre "-- begin;" e "-- commit;" e roda num Postgres
-- cru, onde o schema storage não existe. Para desfazer a parte do bucket em
-- produção, rode à mão:
--   update storage.buckets set allowed_mime_types = array['application/pdf',
--     'image/jpeg','image/png','image/webp','image/heic','application/xml','text/xml']
--    where id = 'recebimentos';
```

- [ ] **Step 3: Escrever os cenários de teste**

Cria `tests/migracao-35/cenarios.sql`. Só o que as tabelas prometem — as funções são testadas na Task 2.

```sql
-- Cenários da atualização 35: estrutura das tabelas. As funções de
-- conciliação têm cenários próprios (mesmo arquivo, seção da Task 2).
\set ON_ERROR_STOP on
\set empresa '11111111-1111-1111-1111-111111111111'
\set outra '22222222-2222-2222-2222-222222222222'

-- Cenário 1: conta bancária e importação nascem ligadas e o tipo é restrito.
insert into public.contas_bancarias (id, empresa_id, nome, instituicao, tipo)
  values ('cccccccc-0000-0000-0000-000000000001', :'empresa', 'Sicoob principal', 'Sicoob', 'conta_corrente');
insert into public.contas_bancarias (id, empresa_id, nome, instituicao, tipo)
  values ('cccccccc-0000-0000-0000-000000000002', :'empresa', 'Cartão Bradesco', 'Bradesco', 'cartao_credito');
do $$
begin
  begin
    insert into public.contas_bancarias (empresa_id, nome, instituicao, tipo)
      values ('11111111-1111-1111-1111-111111111111', 'X', 'Y', 'poupanca');
    raise exception 'FALHA 1: check de tipo aceitou valor fora da lista';
  exception when check_violation then
    raise notice 'OK 1: check de tipo em contas_bancarias barra valor inválido';
  end;
end $$;

-- Cenário 2: dedupe. Mesmo hash na mesma empresa é rejeitado; em empresa
-- diferente passa (o unique é (empresa_id, hash_dedupe)).
insert into public.extrato_importacoes (id, empresa_id, conta_bancaria_id, tipo, arquivo_path, formato)
  values ('dddddddd-0000-0000-0000-000000000001', :'empresa',
          'cccccccc-0000-0000-0000-000000000001', 'extrato', 'p/1.ofx', 'ofx');

insert into public.extrato_lancamentos
  (id, importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe)
  values ('eeeeeeee-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
          :'empresa', '2026-08-10', 'PIX ENVIADO BOI FORTE', 'PIX ENVIADO BOI FORTE',
          1500.00, 'saida', 'hash-a');
do $$
begin
  begin
    insert into public.extrato_lancamentos
      (importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe)
      values ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
              '2026-08-10', 'PIX ENVIADO BOI FORTE', 'PIX ENVIADO BOI FORTE',
              1500.00, 'saida', 'hash-a');
    raise exception 'FALHA 2: hash duplicado na mesma empresa foi aceito';
  exception when unique_violation then
    raise notice 'OK 2: dedupe rejeita hash repetido na mesma empresa';
  end;
end $$;

-- Cenário 3: apagar a importação leva os lançamentos (cascade), e o
-- lançamento não pode existir sem importação.
insert into public.extrato_importacoes (id, empresa_id, conta_bancaria_id, tipo, arquivo_path, formato)
  values ('dddddddd-0000-0000-0000-000000000009', :'empresa',
          'cccccccc-0000-0000-0000-000000000001', 'extrato', 'p/9.ofx', 'ofx');
insert into public.extrato_lancamentos
  (importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe)
  values ('dddddddd-0000-0000-0000-000000000009', :'empresa', '2026-08-11', 'TARIFA', 'TARIFA',
          49.90, 'saida', 'hash-z');
delete from public.extrato_importacoes where id = 'dddddddd-0000-0000-0000-000000000009';
do $$
declare n int;
begin
  select count(*) into n from public.extrato_lancamentos where hash_dedupe = 'hash-z';
  if n <> 0 then raise exception 'FALHA 3: cascade não limpou lançamento (achou %)', n; end if;
  raise notice 'OK 3: cascade de importação limpa os lançamentos';
end $$;

-- Cenário 4: RLS separa empresa. Com auth.role()='authenticated' e
-- empresas_permitidas() devolvendo só a primeira, um select como usuário
-- comum não pode ver linha da outra empresa.
insert into public.extrato_importacoes (id, empresa_id, conta_bancaria_id, tipo, arquivo_path, formato)
  values ('dddddddd-0000-0000-0000-000000000002', :'outra',
          'cccccccc-0000-0000-0000-000000000001', 'extrato', 'p/2.ofx', 'ofx');

create role usuario_teste_35 nologin;
grant usage on schema public to usuario_teste_35;
grant select on all tables in schema public to usuario_teste_35;

-- `set local role` só vale dentro de transação. Sem o begin/commit explícito o
-- psql roda cada comando em autocommit, o papel não troca, o teste rodaria como
-- superusuário (que ignora RLS) e passaria sem provar nada.
begin;
set local role usuario_teste_35;
do $$
declare n int;
begin
  select count(*) into n from public.extrato_importacoes;
  if n <> 1 then
    raise exception 'FALHA 4: RLS deixou ver % importações (esperado 1)', n;
  end if;
  raise notice 'OK 4: RLS mostra só a importação da empresa permitida';
end $$;
commit;
```

- [ ] **Step 4: Escrever o verificar.sh**

Cria `tests/migracao-35/verificar.sh` (`chmod +x`). Espelha `tests/migracao-33/verificar.sh`: banco descartável, migração rodada duas vezes para provar idempotência, cenários, e rollback extraído do próprio arquivo por `sed`.

```bash
#!/usr/bin/env bash
# Exercita a atualização 35 (conciliação bancária) num Postgres local
# descartável. Não toca em produção. Requer psql no PATH e um servidor local.
# Uso: tests/migracao-35/verificar.sh
set -euo pipefail
export PGOPTIONS='-c client_min_messages=notice'

AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
BANCO="${BANCO_TESTE_CONCILIACAO:-conciliacao_test_364}"
MIGRACAO="$RAIZ/supabase/atualizacao_35_conciliacao_bancaria.sql"

command -v psql >/dev/null || { echo "psql não encontrado no PATH"; exit 1; }
pg_isready -q || { echo "nenhum Postgres local aceitando conexões"; exit 1; }

limpar() {
  # O papel é do cluster, não do banco: dropdb não o remove. Roda pelo banco
  # 'postgres' porque na primeira chamada o banco de teste ainda não existe.
  dropdb --if-exists "$BANCO" >/dev/null 2>&1 || true
  psql -q -d postgres -c 'drop role if exists usuario_teste_35;' >/dev/null 2>&1 || true
}
trap limpar EXIT
limpar
createdb "$BANCO"

psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/fixture.sql"

# Duas vezes seguidas: prova idempotência (if not exists + or replace).
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$MIGRACAO"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$MIGRACAO"

psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/cenarios.sql"

# Rollback: descomenta o bloco do fim do arquivo e roda.
sed -n '/^-- begin;/,/^-- commit;/p' "$MIGRACAO" | sed 's/^-- \{0,1\}//' > "$AQUI/.rollback.sql"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/.rollback.sql"
rm -f "$AQUI/.rollback.sql"

restantes=$(psql -tAq -d "$BANCO" -c "select count(*) from information_schema.tables
  where table_schema = 'public' and table_name in
  ('contas_bancarias','extrato_importacoes','extrato_lancamentos','conciliacao_vinculos','conciliacao_padroes');")
[ "$restantes" = "0" ] || { echo "rollback deixou $restantes tabela(s) da 35"; exit 1; }
sobreviveu=$(psql -tAq -d "$BANCO" -c "select count(*) from information_schema.tables
  where table_schema = 'public' and table_name = 'contas_a_pagar_parcelas';")
[ "$sobreviveu" = "1" ] || { echo "rollback derrubou contas_a_pagar_parcelas"; exit 1; }
echo "OK: rollback limpo (só as tabelas da 35 somem)"
echo "MIGRAÇÃO 35 OK"
```

- [ ] **Step 5: Rodar e verificar que passa**

```bash
chmod +x tests/migracao-35/verificar.sh && tests/migracao-35/verificar.sh
```

Esperado: `OK 1`, `OK 2`, `OK 3`, `OK 4`, `OK: rollback limpo`, `MIGRAÇÃO 35 OK`. Se `pg_isready` falhar, subir o Postgres local antes (`brew services start postgresql@17`) — o teste nunca deve ser apontado para produção.

- [ ] **Step 6: Commit**

```bash
git add supabase/atualizacao_35_conciliacao_bancaria.sql tests/migracao-35
git commit -m "feat(financeiro): tabelas da conciliação bancária (migração 35)"
```

---

### Task 2: Migração 35 — funções de conciliação

**Files:**
- Modify: `supabase/atualizacao_35_conciliacao_bancaria.sql` (inserir as funções antes do `commit;`, mantendo o bloco de rollback no fim e acrescentando os `drop function` nele)
- Modify: `tests/migracao-35/cenarios.sql` (acrescentar cenários 5 a 11 no fim)

**Interfaces:**
- Consumes: tabelas da Task 1.
- Produces: as funções que a Task 9 chama por RPC, com estas assinaturas exatas:
  - `public.fn_conciliar_lancamento(p_lancamento_id uuid, p_parcelas jsonb, p_forma_pagamento text, p_fornecedor_id uuid, p_categoria_conta text) returns jsonb`
  - `public.fn_criar_conta_e_conciliar(p_lancamento_id uuid, p_descricao text, p_categoria_conta text, p_fornecedor_id uuid, p_responsavel_id uuid, p_forma_pagamento text) returns jsonb`
  - `public.fn_desfazer_conciliacao(p_lancamento_id uuid) returns jsonb`
  - `public.fn_conciliar_pagamento_fatura(p_lancamento_id uuid, p_fatura_id uuid, p_forcar boolean) returns jsonb`
  - `public.fn_recalcular_importacao(p_importacao_id uuid) returns void` (interna)
  - `p_parcelas` é `[{"parcela_id": "<uuid>", "valor_aplicado": 1500.00}, ...]`.

- [ ] **Step 1: Escrever os cenários que falham (antes das funções)**

Acrescenta no fim de `tests/migracao-35/cenarios.sql`. Estes cenários chamam funções que ainda não existem — é o teste falhando primeiro.

```sql
-- ================= FUNÇÕES DE CONCILIAÇÃO =================
-- Base comum: uma conta a pagar de R$ 1.500,00 em duas parcelas de 750,00,
-- e um lançamento de saída de 750,00 batendo com a primeira.
insert into public.contas_a_pagar (id, descricao, categoria_conta, fornecedor_id, valor_total, empresa_id)
  values ('ffffffff-0000-0000-0000-000000000001', 'Carne agosto', 'Custos Diretos',
          'aaaaaaaa-0000-0000-0000-000000000001', 1500.00, :'empresa');
insert into public.contas_a_pagar_parcelas (id, conta_a_pagar_id, numero, valor, vencimento, empresa_id)
  values ('99999999-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000001',
          1, 750.00, '2026-08-10', :'empresa'),
         ('99999999-0000-0000-0000-000000000002', 'ffffffff-0000-0000-0000-000000000001',
          2, 750.00, '2026-09-10', :'empresa');
insert into public.extrato_lancamentos
  (id, importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe, status)
  values ('eeeeeeee-0000-0000-0000-000000000010', 'dddddddd-0000-0000-0000-000000000001',
          :'empresa', '2026-08-10', 'PIX ENVIADO BOI FORTE 123', 'PIX ENVIADO BOI FORTE',
          750.00, 'saida', 'hash-c1', 'sugerido');

-- Cenário 5: conciliar baixa a parcela, cria vínculo e grava o padrão.
do $$
declare parc record; vinc record; pad record; imp record;
begin
  perform public.fn_conciliar_lancamento(
    'eeeeeeee-0000-0000-0000-000000000010',
    '[{"parcela_id":"99999999-0000-0000-0000-000000000001","valor_aplicado":750.00}]'::jsonb,
    'Pix', 'aaaaaaaa-0000-0000-0000-000000000001', 'Custos Diretos');

  select * into parc from public.contas_a_pagar_parcelas
    where id = '99999999-0000-0000-0000-000000000001';
  if parc.status <> 'Pago' then raise exception 'FALHA 5: parcela não foi baixada (%)', parc.status; end if;
  if parc.data_pagamento <> '2026-08-10' then
    raise exception 'FALHA 5: data_pagamento veio %, esperado a data do débito', parc.data_pagamento;
  end if;
  if parc.forma_pagamento <> 'Pix' then
    raise exception 'FALHA 5: forma_pagamento veio %', parc.forma_pagamento;
  end if;

  select * into vinc from public.conciliacao_vinculos
    where lancamento_id = 'eeeeeeee-0000-0000-0000-000000000010';
  if vinc.baixou_parcela is not true then raise exception 'FALHA 5: baixou_parcela devia ser true'; end if;
  if vinc.valor_aplicado <> 750.00 then raise exception 'FALHA 5: valor_aplicado %', vinc.valor_aplicado; end if;

  select * into pad from public.conciliacao_padroes where padrao = 'PIX ENVIADO BOI FORTE';
  if pad.fornecedor_id <> 'aaaaaaaa-0000-0000-0000-000000000001' then
    raise exception 'FALHA 5: padrão não aprendeu o fornecedor';
  end if;
  if pad.usos <> 1 then raise exception 'FALHA 5: usos devia ser 1, veio %', pad.usos; end if;

  select * into imp from public.extrato_importacoes where id = 'dddddddd-0000-0000-0000-000000000001';
  if imp.conciliados <> 1 then raise exception 'FALHA 5: contador conciliados %', imp.conciliados; end if;
  raise notice 'OK 5: conciliar baixa parcela, cria vínculo, aprende padrão e atualiza contador';
end $$;

-- Cenário 6: confirmar de novo o mesmo padrão incrementa usos; fornecedor
-- diferente sobrescreve e reseta para 1 (última confirmação vence).
insert into public.extrato_lancamentos
  (id, importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe)
  values ('eeeeeeee-0000-0000-0000-000000000011', 'dddddddd-0000-0000-0000-000000000001',
          :'empresa', '2026-09-10', 'PIX ENVIADO BOI FORTE 456', 'PIX ENVIADO BOI FORTE',
          750.00, 'saida', 'hash-c2');
do $$
declare pad record;
begin
  perform public.fn_conciliar_lancamento(
    'eeeeeeee-0000-0000-0000-000000000011',
    '[{"parcela_id":"99999999-0000-0000-0000-000000000002","valor_aplicado":750.00}]'::jsonb,
    'Pix', 'aaaaaaaa-0000-0000-0000-000000000001', 'Custos Diretos');
  select * into pad from public.conciliacao_padroes where padrao = 'PIX ENVIADO BOI FORTE';
  if pad.usos <> 2 then raise exception 'FALHA 6: usos devia ir a 2, veio %', pad.usos; end if;
  raise notice 'OK 6: confirmação repetida incrementa usos do padrão';
end $$;

-- Cenário 7: lançamento de entrada não concilia (fase só de saídas).
insert into public.extrato_lancamentos
  (id, importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe, status)
  values ('eeeeeeee-0000-0000-0000-000000000012', 'dddddddd-0000-0000-0000-000000000001',
          :'empresa', '2026-08-12', 'PIX RECEBIDO CLIENTE', 'PIX RECEBIDO CLIENTE',
          200.00, 'entrada', 'hash-c3', 'ignorado');
do $$
begin
  begin
    perform public.fn_conciliar_lancamento('eeeeeeee-0000-0000-0000-000000000012',
      '[{"parcela_id":"99999999-0000-0000-0000-000000000001","valor_aplicado":200.00}]'::jsonb,
      'Pix', null, null);
    raise exception 'FALHA 7: conciliou uma entrada';
  exception when others then
    if sqlerrm like 'FALHA 7%' then raise; end if;
    raise notice 'OK 7: entrada é rejeitada pela conciliação (%)', sqlerrm;
  end;
end $$;

-- Cenário 8: parcela já paga antes da conciliação é vinculada sem ser
-- rebaixada — baixou_parcela = false, e a data original não muda.
insert into public.contas_a_pagar (id, descricao, categoria_conta, fornecedor_id, valor_total, empresa_id)
  values ('ffffffff-0000-0000-0000-000000000002', 'Gás', 'Custos Fixos',
          'aaaaaaaa-0000-0000-0000-000000000001', 300.00, :'empresa');
insert into public.contas_a_pagar_parcelas
  (id, conta_a_pagar_id, numero, valor, vencimento, status, data_pagamento, forma_pagamento, empresa_id)
  values ('99999999-0000-0000-0000-000000000003', 'ffffffff-0000-0000-0000-000000000002',
          1, 300.00, '2026-08-05', 'Pago', '2026-08-04', 'Dinheiro', :'empresa');
insert into public.extrato_lancamentos
  (id, importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe)
  values ('eeeeeeee-0000-0000-0000-000000000013', 'dddddddd-0000-0000-0000-000000000001',
          :'empresa', '2026-08-05', 'DEB AUT GAS', 'DEB AUT GAS', 300.00, 'saida', 'hash-c4');
do $$
declare parc record; vinc record;
begin
  perform public.fn_conciliar_lancamento('eeeeeeee-0000-0000-0000-000000000013',
    '[{"parcela_id":"99999999-0000-0000-0000-000000000003","valor_aplicado":300.00}]'::jsonb,
    'Transferência', null, null);
  select * into parc from public.contas_a_pagar_parcelas where id = '99999999-0000-0000-0000-000000000003';
  if parc.data_pagamento <> '2026-08-04' or parc.forma_pagamento <> 'Dinheiro' then
    raise exception 'FALHA 8: conciliação pisou na baixa que já existia';
  end if;
  select * into vinc from public.conciliacao_vinculos
    where lancamento_id = 'eeeeeeee-0000-0000-0000-000000000013';
  if vinc.baixou_parcela is not false then
    raise exception 'FALHA 8: baixou_parcela devia ser false em parcela já paga';
  end if;
  raise notice 'OK 8: parcela já paga é só vinculada, nunca rebaixada';
end $$;

-- Cenário 9: desfazer devolve a parcela que a conciliação baixou e não
-- reabre a que já estava paga.
do $$
declare p1 record; p3 record; lanc record;
begin
  perform public.fn_desfazer_conciliacao('eeeeeeee-0000-0000-0000-000000000010');
  perform public.fn_desfazer_conciliacao('eeeeeeee-0000-0000-0000-000000000013');
  select * into p1 from public.contas_a_pagar_parcelas where id = '99999999-0000-0000-0000-000000000001';
  if p1.status <> 'Pendente' or p1.data_pagamento is not null then
    raise exception 'FALHA 9: parcela baixada pela conciliação não voltou a Pendente';
  end if;
  select * into p3 from public.contas_a_pagar_parcelas where id = '99999999-0000-0000-0000-000000000003';
  if p3.status <> 'Pago' or p3.data_pagamento <> '2026-08-04' then
    raise exception 'FALHA 9: desfazer reabriu parcela que já estava paga antes';
  end if;
  select * into lanc from public.extrato_lancamentos where id = 'eeeeeeee-0000-0000-0000-000000000010';
  if lanc.status <> 'pendente' then
    raise exception 'FALHA 9: lançamento devia voltar a pendente, veio %', lanc.status;
  end if;
  if exists (select 1 from public.conciliacao_vinculos
             where lancamento_id = 'eeeeeeee-0000-0000-0000-000000000010') then
    raise exception 'FALHA 9: vínculo sobreviveu ao desfazer';
  end if;
  raise notice 'OK 9: desfazer reverte só o que a conciliação mesmo baixou';
end $$;

-- Cenário 10: criar conta a partir do extrato (saída sem lançamento) e
-- desfazer apaga a conta criada — nada de conta a pagar fantasma.
insert into public.extrato_lancamentos
  (id, importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe)
  values ('eeeeeeee-0000-0000-0000-000000000014', 'dddddddd-0000-0000-0000-000000000001',
          :'empresa', '2026-08-15', 'TARIFA PACOTE SERVICOS', 'TARIFA PACOTE SERVICOS',
          49.90, 'saida', 'hash-c5');
do $$
declare lanc record; conta record; parc record;
begin
  perform public.fn_criar_conta_e_conciliar('eeeeeeee-0000-0000-0000-000000000014',
    'Tarifa bancária agosto', 'Custos Fixos', 'aaaaaaaa-0000-0000-0000-000000000001',
    'bbbbbbbb-0000-0000-0000-000000000001', 'Transferência');
  select * into lanc from public.extrato_lancamentos where id = 'eeeeeeee-0000-0000-0000-000000000014';
  if lanc.status <> 'conciliado' or lanc.conta_criada_id is null then
    raise exception 'FALHA 10: lançamento não ficou conciliado com conta_criada_id';
  end if;
  select * into conta from public.contas_a_pagar where id = lanc.conta_criada_id;
  if conta.valor_total <> 49.90 then raise exception 'FALHA 10: valor_total %', conta.valor_total; end if;
  select * into parc from public.contas_a_pagar_parcelas where conta_a_pagar_id = conta.id;
  if parc.status <> 'Pago' or parc.data_pagamento <> '2026-08-15' or parc.numero <> 1 then
    raise exception 'FALHA 10: parcela criada não nasceu paga na data do débito';
  end if;

  perform public.fn_desfazer_conciliacao('eeeeeeee-0000-0000-0000-000000000014');
  if exists (select 1 from public.contas_a_pagar where id = conta.id) then
    raise exception 'FALHA 10: desfazer deixou a conta criada para trás';
  end if;
  raise notice 'OK 10: criar conta do extrato e desfazer não deixa conta fantasma';
end $$;

-- Cenário 11: fatura de cartão. Linhas conciliam sem baixar; o pagamento da
-- fatura no extrato baixa todas de uma vez. Valor divergente só passa com
-- p_forcar.
insert into public.extrato_importacoes (id, empresa_id, conta_bancaria_id, tipo, arquivo_path, formato)
  values ('dddddddd-0000-0000-0000-000000000003', :'empresa',
          'cccccccc-0000-0000-0000-000000000002', 'fatura_cartao', 'p/fatura.pdf', 'pdf');
insert into public.contas_a_pagar (id, descricao, categoria_conta, fornecedor_id, valor_total, empresa_id)
  values ('ffffffff-0000-0000-0000-000000000003', 'Insumos Mercado Livre', 'Custos Variáveis',
          'aaaaaaaa-0000-0000-0000-000000000001', 400.00, :'empresa');
insert into public.contas_a_pagar_parcelas (id, conta_a_pagar_id, numero, valor, vencimento, empresa_id)
  values ('99999999-0000-0000-0000-000000000004', 'ffffffff-0000-0000-0000-000000000003',
          1, 400.00, '2026-08-20', :'empresa');
insert into public.extrato_lancamentos
  (id, importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe)
  values ('eeeeeeee-0000-0000-0000-000000000015', 'dddddddd-0000-0000-0000-000000000003',
          :'empresa', '2026-08-02', 'MERCADO LIVRE', 'MERCADO LIVRE', 400.00, 'saida', 'hash-f1');
insert into public.extrato_lancamentos
  (id, importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe)
  values ('eeeeeeee-0000-0000-0000-000000000016', 'dddddddd-0000-0000-0000-000000000001',
          :'empresa', '2026-08-25', 'PAGAMENTO FATURA CARTAO', 'PAGAMENTO FATURA CARTAO',
          400.00, 'saida', 'hash-f2');
do $$
declare parc record; vinc record;
begin
  -- linha da fatura: concilia, não baixa
  perform public.fn_conciliar_lancamento('eeeeeeee-0000-0000-0000-000000000015',
    '[{"parcela_id":"99999999-0000-0000-0000-000000000004","valor_aplicado":400.00}]'::jsonb,
    'Cartão de Crédito', 'aaaaaaaa-0000-0000-0000-000000000001', 'Custos Variáveis');
  select * into parc from public.contas_a_pagar_parcelas where id = '99999999-0000-0000-0000-000000000004';
  if parc.status <> 'Pendente' then
    raise exception 'FALHA 11: linha de fatura baixou a parcela (devia esperar o pagamento)';
  end if;

  -- valor divergente sem forçar: barra
  begin
    perform public.fn_conciliar_pagamento_fatura('eeeeeeee-0000-0000-0000-000000000016',
      'dddddddd-0000-0000-0000-000000000003', false);
  exception when others then
    raise exception 'FALHA 11: valor batia (400 = 400) e a função recusou: %', sqlerrm;
  end;
  select * into parc from public.contas_a_pagar_parcelas where id = '99999999-0000-0000-0000-000000000004';
  if parc.status <> 'Pago' or parc.forma_pagamento <> 'Cartão de Crédito'
     or parc.data_pagamento <> '2026-08-25' then
    raise exception 'FALHA 11: pagamento da fatura não baixou a parcela na data do débito';
  end if;
  select * into vinc from public.conciliacao_vinculos
    where lancamento_id = 'eeeeeeee-0000-0000-0000-000000000015';
  if vinc.baixou_parcela is not true then
    raise exception 'FALHA 11: baixou_parcela do vínculo da fatura devia virar true';
  end if;
  raise notice 'OK 11: fatura concilia sem baixar e o pagamento baixa em lote';
end $$;

-- Cenário 12: pagamento de fatura com valor diferente da soma exige p_forcar.
insert into public.contas_a_pagar (id, descricao, categoria_conta, fornecedor_id, valor_total, empresa_id)
  values ('ffffffff-0000-0000-0000-000000000004', 'Insumos diversos', 'Custos Variáveis',
          'aaaaaaaa-0000-0000-0000-000000000001', 100.00, :'empresa');
insert into public.contas_a_pagar_parcelas (id, conta_a_pagar_id, numero, valor, vencimento, empresa_id)
  values ('99999999-0000-0000-0000-000000000005', 'ffffffff-0000-0000-0000-000000000004',
          1, 100.00, '2026-09-20', :'empresa');
insert into public.extrato_importacoes (id, empresa_id, conta_bancaria_id, tipo, arquivo_path, formato)
  values ('dddddddd-0000-0000-0000-000000000004', :'empresa',
          'cccccccc-0000-0000-0000-000000000002', 'fatura_cartao', 'p/fatura2.pdf', 'pdf');
insert into public.extrato_lancamentos
  (id, importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe)
  values ('eeeeeeee-0000-0000-0000-000000000017', 'dddddddd-0000-0000-0000-000000000004',
          :'empresa', '2026-09-02', 'MERCADO LIVRE', 'MERCADO LIVRE 2', 100.00, 'saida', 'hash-f3');
insert into public.extrato_lancamentos
  (id, importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe)
  values ('eeeeeeee-0000-0000-0000-000000000018', 'dddddddd-0000-0000-0000-000000000001',
          :'empresa', '2026-09-25', 'PAGAMENTO FATURA CARTAO', 'PAGAMENTO FATURA CARTAO 2',
          60.00, 'saida', 'hash-f4');
do $$
declare parc record;
begin
  perform public.fn_conciliar_lancamento('eeeeeeee-0000-0000-0000-000000000017',
    '[{"parcela_id":"99999999-0000-0000-0000-000000000005","valor_aplicado":100.00}]'::jsonb,
    'Cartão de Crédito', null, null);
  begin
    perform public.fn_conciliar_pagamento_fatura('eeeeeeee-0000-0000-0000-000000000018',
      'dddddddd-0000-0000-0000-000000000004', false);
    raise exception 'FALHA 12: pagamento parcial passou sem p_forcar';
  exception when others then
    if sqlerrm like 'FALHA 12%' then raise; end if;
    raise notice 'OK 12a: pagamento parcial é barrado sem confirmação (%)', sqlerrm;
  end;
  perform public.fn_conciliar_pagamento_fatura('eeeeeeee-0000-0000-0000-000000000018',
    'dddddddd-0000-0000-0000-000000000004', true);
  select * into parc from public.contas_a_pagar_parcelas where id = '99999999-0000-0000-0000-000000000005';
  if parc.status <> 'Pago' then raise exception 'FALHA 12: p_forcar não baixou'; end if;
  raise notice 'OK 12b: com p_forcar o pagamento parcial baixa as parcelas da fatura';
end $$;
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
tests/migracao-35/verificar.sh
```

Esperado: falha no cenário 5 com `function public.fn_conciliar_lancamento(...) does not exist`.

- [ ] **Step 3: Escrever as funções na migração**

Insere no `supabase/atualizacao_35_conciliacao_bancaria.sql`, **antes** do `commit;` final.

```sql
-- ---------- FUNÇÕES DE CONCILIAÇÃO ----------
-- Por que função no banco e não código na rota: conciliar mexe em três
-- tabelas (vínculo, parcela, padrão) e não pode ficar pela metade se cair no
-- meio. Aqui é uma transação só. As rotas chamam por RPC.
--
-- Todas rodam como security invoker (default): a rota usa service role e já
-- conferiu a empresa com garantirEmpresa(), e as funções revalidam a empresa
-- de cada parcela contra a do lançamento.

-- Recalcula contadores e status da importação. Uma importação está concluída
-- quando não sobra saída pendente nem sugerida.
create or replace function public.fn_recalcular_importacao(p_importacao_id uuid)
returns void language plpgsql as $$
declare v_total int; v_conciliados int; v_abertos int;
begin
  select count(*) filter (where tipo = 'saida'),
         count(*) filter (where tipo = 'saida' and status = 'conciliado'),
         count(*) filter (where tipo = 'saida' and status in ('pendente','sugerido'))
    into v_total, v_conciliados, v_abertos
    from public.extrato_lancamentos where importacao_id = p_importacao_id;

  update public.extrato_importacoes
     set total_lancamentos = (select count(*) from public.extrato_lancamentos
                               where importacao_id = p_importacao_id),
         conciliados = coalesce(v_conciliados, 0),
         status = case when status = 'erro' then 'erro'
                       when coalesce(v_abertos, 0) = 0 then 'concluida'
                       else 'aguardando_conciliacao' end
   where id = p_importacao_id;
end $$;

-- Grava o aprendizado. Mesmo fornecedor: soma um uso. Fornecedor diferente:
-- sobrescreve e volta a 1 — a última confirmação do colaborador é a verdade.
create or replace function public.fn_registrar_padrao(
  p_empresa_id uuid, p_padrao text, p_fornecedor_id uuid, p_categoria_conta text)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  if p_fornecedor_id is null or coalesce(trim(p_padrao), '') = '' then return null; end if;
  insert into public.conciliacao_padroes
    (empresa_id, padrao, fornecedor_id, categoria_conta, usos, ultimo_uso)
    values (p_empresa_id, p_padrao, p_fornecedor_id, p_categoria_conta, 1, now())
  on conflict (empresa_id, padrao) do update
    set fornecedor_id = excluded.fornecedor_id,
        categoria_conta = coalesce(excluded.categoria_conta, public.conciliacao_padroes.categoria_conta),
        usos = case when public.conciliacao_padroes.fornecedor_id = excluded.fornecedor_id
                    then public.conciliacao_padroes.usos + 1 else 1 end,
        ultimo_uso = now()
  returning id into v_id;
  return v_id;
end $$;

-- Concilia um lançamento com uma ou mais parcelas.
-- p_parcelas: [{"parcela_id":"<uuid>","valor_aplicado":123.45}, ...]
-- Parcela ainda Pendente é baixada (baixou_parcela = true). Parcela já Paga é
-- só vinculada — inclusive o caso da linha de fatura de cartão, que espera o
-- pagamento da fatura para baixar.
create or replace function public.fn_conciliar_lancamento(
  p_lancamento_id uuid,
  p_parcelas jsonb,
  p_forma_pagamento text default null,
  p_fornecedor_id uuid default null,
  p_categoria_conta text default null)
returns jsonb language plpgsql as $$
declare
  v_lanc record; v_parc record; v_item jsonb;
  v_baixou boolean; v_padrao_id uuid; v_baixadas int := 0; v_vinculadas int := 0;
  v_ehFatura boolean;
begin
  select * into v_lanc from public.extrato_lancamentos where id = p_lancamento_id for update;
  if v_lanc is null then raise exception 'Lançamento não encontrado.'; end if;
  if v_lanc.tipo <> 'saida' then
    raise exception 'Só saídas são conciliadas nesta fase (este lançamento é uma entrada).';
  end if;
  if v_lanc.status = 'conciliado' then
    raise exception 'Este lançamento já está conciliado. Desfaça antes de conciliar de novo.';
  end if;
  if p_parcelas is null or jsonb_array_length(p_parcelas) = 0 then
    raise exception 'Informe pelo menos uma parcela.';
  end if;

  -- Linha de fatura de cartão não baixa parcela: a compra ainda não saiu do
  -- caixa. Quem baixa é fn_conciliar_pagamento_fatura.
  select tipo = 'fatura_cartao' into v_ehFatura
    from public.extrato_importacoes where id = v_lanc.importacao_id;

  for v_item in select * from jsonb_array_elements(p_parcelas) loop
    select * into v_parc from public.contas_a_pagar_parcelas
      where id = (v_item->>'parcela_id')::uuid for update;
    if v_parc is null then raise exception 'Parcela % não encontrada.', v_item->>'parcela_id'; end if;
    if v_parc.empresa_id <> v_lanc.empresa_id then
      raise exception 'Parcela de outra empresa não pode ser conciliada aqui.';
    end if;

    v_baixou := (v_parc.status = 'Pendente') and not coalesce(v_ehFatura, false);
    if v_baixou then
      update public.contas_a_pagar_parcelas
         set status = 'Pago', data_pagamento = v_lanc.data,
             forma_pagamento = coalesce(p_forma_pagamento, forma_pagamento)
       where id = v_parc.id;
      v_baixadas := v_baixadas + 1;
    end if;

    insert into public.conciliacao_vinculos
      (lancamento_id, parcela_id, valor_aplicado, baixou_parcela, empresa_id)
      values (p_lancamento_id, v_parc.id,
              coalesce((v_item->>'valor_aplicado')::numeric, v_parc.valor),
              v_baixou, v_lanc.empresa_id)
    on conflict (lancamento_id, parcela_id) do nothing;
    v_vinculadas := v_vinculadas + 1;
  end loop;

  v_padrao_id := public.fn_registrar_padrao(v_lanc.empresa_id, v_lanc.descricao_normalizada,
                                            p_fornecedor_id, p_categoria_conta);

  update public.extrato_lancamentos
     set status = 'conciliado', padrao_id = coalesce(v_padrao_id, padrao_id)
   where id = p_lancamento_id;

  perform public.fn_recalcular_importacao(v_lanc.importacao_id);
  return jsonb_build_object('vinculadas', v_vinculadas, 'baixadas', v_baixadas);
end $$;

-- Saída sem conta a pagar: cria conta + parcela única já paga + vínculo, e
-- guarda a conta em conta_criada_id para o desfazer poder apagá-la.
create or replace function public.fn_criar_conta_e_conciliar(
  p_lancamento_id uuid,
  p_descricao text,
  p_categoria_conta text,
  p_fornecedor_id uuid,
  p_responsavel_id uuid default null,
  p_forma_pagamento text default null)
returns jsonb language plpgsql as $$
declare v_lanc record; v_conta_id uuid; v_parcela_id uuid; v_padrao_id uuid;
begin
  select * into v_lanc from public.extrato_lancamentos where id = p_lancamento_id for update;
  if v_lanc is null then raise exception 'Lançamento não encontrado.'; end if;
  if v_lanc.tipo <> 'saida' then raise exception 'Só saídas viram conta a pagar aqui.'; end if;
  if v_lanc.status = 'conciliado' then raise exception 'Este lançamento já está conciliado.'; end if;
  if p_fornecedor_id is null then raise exception 'Escolha o fornecedor.'; end if;

  insert into public.contas_a_pagar
    (descricao, categoria_conta, fornecedor_id, valor_total, responsavel_id, empresa_id)
    values (coalesce(nullif(trim(p_descricao), ''), v_lanc.descricao), p_categoria_conta,
            p_fornecedor_id, v_lanc.valor, p_responsavel_id, v_lanc.empresa_id)
    returning id into v_conta_id;

  insert into public.contas_a_pagar_parcelas
    (conta_a_pagar_id, numero, valor, vencimento, status, data_pagamento, forma_pagamento, empresa_id)
    values (v_conta_id, 1, v_lanc.valor, v_lanc.data, 'Pago', v_lanc.data,
            p_forma_pagamento, v_lanc.empresa_id)
    returning id into v_parcela_id;

  insert into public.conciliacao_vinculos
    (lancamento_id, parcela_id, valor_aplicado, baixou_parcela, empresa_id)
    values (p_lancamento_id, v_parcela_id, v_lanc.valor, true, v_lanc.empresa_id);

  v_padrao_id := public.fn_registrar_padrao(v_lanc.empresa_id, v_lanc.descricao_normalizada,
                                            p_fornecedor_id, p_categoria_conta);

  update public.extrato_lancamentos
     set status = 'conciliado', conta_criada_id = v_conta_id,
         padrao_id = coalesce(v_padrao_id, padrao_id)
   where id = p_lancamento_id;

  perform public.fn_recalcular_importacao(v_lanc.importacao_id);
  return jsonb_build_object('conta_id', v_conta_id, 'parcela_id', v_parcela_id);
end $$;

-- Desfaz: reabre só as parcelas que esta conciliação baixou, apaga os
-- vínculos e, se a conta a pagar nasceu daqui, apaga a conta (o cascade
-- limpa parcela e vínculo).
create or replace function public.fn_desfazer_conciliacao(p_lancamento_id uuid)
returns jsonb language plpgsql as $$
declare v_lanc record; v_reabertas int := 0;
begin
  select * into v_lanc from public.extrato_lancamentos where id = p_lancamento_id for update;
  if v_lanc is null then raise exception 'Lançamento não encontrado.'; end if;

  update public.contas_a_pagar_parcelas p
     set status = 'Pendente', data_pagamento = null, forma_pagamento = null
   where p.id in (select v.parcela_id from public.conciliacao_vinculos v
                   where v.lancamento_id = p_lancamento_id and v.baixou_parcela);
  get diagnostics v_reabertas = row_count;

  delete from public.conciliacao_vinculos where lancamento_id = p_lancamento_id;

  if v_lanc.conta_criada_id is not null then
    delete from public.contas_a_pagar where id = v_lanc.conta_criada_id;
  end if;

  update public.extrato_lancamentos
     set status = case when tipo = 'entrada' then 'ignorado'
                       when parcela_sugerida_id is not null then 'sugerido'
                       else 'pendente' end,
         conta_criada_id = null, fatura_id = null
   where id = p_lancamento_id;

  perform public.fn_recalcular_importacao(v_lanc.importacao_id);
  return jsonb_build_object('reabertas', v_reabertas);
end $$;

-- Pagamento da fatura no extrato bancário: baixa em lote todas as parcelas
-- vinculadas às linhas daquela fatura. p_forcar libera o caso de pagamento
-- parcial/rotativo, onde o débito não bate com a soma conciliada.
create or replace function public.fn_conciliar_pagamento_fatura(
  p_lancamento_id uuid, p_fatura_id uuid, p_forcar boolean default false)
returns jsonb language plpgsql as $$
declare v_lanc record; v_fatura record; v_soma numeric(12,2); v_baixadas int := 0;
begin
  select * into v_lanc from public.extrato_lancamentos where id = p_lancamento_id for update;
  if v_lanc is null then raise exception 'Lançamento não encontrado.'; end if;
  if v_lanc.tipo <> 'saida' then raise exception 'O pagamento da fatura é uma saída.'; end if;
  if v_lanc.status = 'conciliado' then raise exception 'Este lançamento já está conciliado.'; end if;

  select * into v_fatura from public.extrato_importacoes where id = p_fatura_id;
  if v_fatura is null then raise exception 'Fatura não encontrada.'; end if;
  if v_fatura.tipo <> 'fatura_cartao' then raise exception 'A importação escolhida não é uma fatura.'; end if;
  if v_fatura.empresa_id <> v_lanc.empresa_id then
    raise exception 'Fatura de outra empresa.';
  end if;

  select coalesce(sum(v.valor_aplicado), 0) into v_soma
    from public.conciliacao_vinculos v
    join public.extrato_lancamentos l on l.id = v.lancamento_id
   where l.importacao_id = p_fatura_id;

  if v_soma = 0 then
    raise exception 'Nenhuma linha desta fatura foi conciliada ainda — concilie as compras antes de baixar o pagamento.';
  end if;
  if abs(v_soma - v_lanc.valor) > 0.01 and not coalesce(p_forcar, false) then
    raise exception 'O débito de % não bate com a soma conciliada da fatura (%). Confirme para baixar assim mesmo.',
      to_char(v_lanc.valor, 'FM999999990.00'), to_char(v_soma, 'FM999999990.00');
  end if;

  update public.contas_a_pagar_parcelas p
     set status = 'Pago', data_pagamento = v_lanc.data, forma_pagamento = 'Cartão de Crédito'
   where p.status = 'Pendente'
     and p.id in (select v.parcela_id from public.conciliacao_vinculos v
                   join public.extrato_lancamentos l on l.id = v.lancamento_id
                  where l.importacao_id = p_fatura_id);
  get diagnostics v_baixadas = row_count;

  update public.conciliacao_vinculos v
     set baixou_parcela = true
   where v.lancamento_id in (select id from public.extrato_lancamentos where importacao_id = p_fatura_id);

  update public.extrato_lancamentos
     set status = 'conciliado', fatura_id = p_fatura_id
   where id = p_lancamento_id;

  perform public.fn_recalcular_importacao(v_lanc.importacao_id);
  perform public.fn_recalcular_importacao(p_fatura_id);
  return jsonb_build_object('baixadas', v_baixadas, 'soma_fatura', v_soma);
end $$;
```

E acrescenta no bloco de rollback, antes dos `drop table`:

```sql
-- drop function if exists public.fn_conciliar_pagamento_fatura(uuid, uuid, boolean);
-- drop function if exists public.fn_desfazer_conciliacao(uuid);
-- drop function if exists public.fn_criar_conta_e_conciliar(uuid, text, text, uuid, uuid, text);
-- drop function if exists public.fn_conciliar_lancamento(uuid, jsonb, text, uuid, text);
-- drop function if exists public.fn_registrar_padrao(uuid, text, uuid, text);
-- drop function if exists public.fn_recalcular_importacao(uuid);
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
tests/migracao-35/verificar.sh
```

Esperado: `OK 5` a `OK 12b` além dos anteriores, e `MIGRAÇÃO 35 OK`.

- [ ] **Step 5: Commit**

```bash
git add supabase/atualizacao_35_conciliacao_bancaria.sql tests/migracao-35/cenarios.sql
git commit -m "feat(financeiro): funções atômicas de conciliação e aprendizado de padrões"
```

---

### Task 3: Núcleo puro — normalização, dedupe e validação aritmética

**Files:**
- Create: `lib/extratos/normalizar.js`
- Create: `lib/extratos/dedupe.js`
- Create: `lib/extratos/validar.js`
- Create: `tests/extratos-normalizar.test.mjs`
- Create: `tests/extratos-validar.test.mjs`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `normalizarDescricao(descricao) -> string` (maiúsculas, sem acento, sem números, sem pontuação, espaços colapsados, máx. 120 chars)
  - `hashDedupe({ contaBancariaId, data, valor, descricaoNormalizada, fitid }) -> string` (sha256 hex)
  - `validarExtrato({ saldoInicial, saldoFinal, lancamentos }) -> { ok: boolean, alerta: string | null }`
  - `validarFatura({ total, lancamentos }) -> { ok: boolean, alerta: string | null }`
  - Usados pelas tasks 5, 6, 7 e 8.

- [ ] **Step 1: Escrever os testes que falham**

Cria `tests/extratos-normalizar.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarDescricao } from '../lib/extratos/normalizar.js';
import { hashDedupe } from '../lib/extratos/dedupe.js';

test('normaliza caixa, acento e pontuação', () => {
  assert.equal(normalizarDescricao('Pix enviado - Distribuição Boi Forte'),
    'PIX ENVIADO DISTRIBUICAO BOI FORTE');
});

test('descarta números: data, documento, CNPJ e valor não são aprendizado', () => {
  assert.equal(
    normalizarDescricao('PIX ENVIADO 12/08 BOI FORTE LTDA 45.678.901/0001-23 R$ 1.500,00'),
    'PIX ENVIADO BOI FORTE LTDA R');
});

test('duas linhas do mesmo fornecedor em meses diferentes viram a mesma chave', () => {
  const a = normalizarDescricao('DEB AUT ENERGISA 08/2026 fatura 998877');
  const b = normalizarDescricao('DEB AUT ENERGISA 09/2026 fatura 112233');
  assert.equal(a, b);
  assert.equal(a, 'DEB AUT ENERGISA FATURA');
});

test('entrada vazia ou nula devolve string vazia', () => {
  assert.equal(normalizarDescricao(''), '');
  assert.equal(normalizarDescricao(null), '');
  assert.equal(normalizarDescricao(undefined), '');
});

test('corta em 120 caracteres', () => {
  assert.equal(normalizarDescricao('A'.repeat(200)).length, 120);
});

test('hash é estável e separa lançamentos diferentes', () => {
  const base = {
    contaBancariaId: 'cccccccc-0000-0000-0000-000000000001',
    data: '2026-08-10', valor: 750, descricaoNormalizada: 'PIX ENVIADO BOI FORTE',
  };
  assert.equal(hashDedupe(base), hashDedupe({ ...base }));
  assert.notEqual(hashDedupe(base), hashDedupe({ ...base, valor: 750.01 }));
  assert.notEqual(hashDedupe(base), hashDedupe({ ...base, data: '2026-08-11' }));
  assert.notEqual(hashDedupe(base), hashDedupe({ ...base, contaBancariaId: 'outra' }));
  assert.match(hashDedupe(base), /^[0-9a-f]{64}$/);
});

test('valor entra no hash com dois decimais fixos', () => {
  const base = { contaBancariaId: 'c1', data: '2026-08-10', descricaoNormalizada: 'X' };
  assert.equal(hashDedupe({ ...base, valor: 750 }), hashDedupe({ ...base, valor: 750.0 }));
});

test('FITID do OFX manda no hash — dois débitos iguais no mesmo dia não colidem', () => {
  const base = {
    contaBancariaId: 'c1', data: '2026-08-10', valor: 100, descricaoNormalizada: 'TARIFA',
  };
  const a = hashDedupe({ ...base, fitid: 'A1' });
  const b = hashDedupe({ ...base, fitid: 'A2' });
  assert.notEqual(a, b);
  assert.notEqual(a, hashDedupe(base));
});
```

Cria `tests/extratos-validar.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarExtrato, validarFatura } from '../lib/extratos/validar.js';

const lancamentos = [
  { valor: 1000, tipo: 'entrada' },
  { valor: 250.5, tipo: 'saida' },
  { valor: 49.5, tipo: 'saida' },
];

test('extrato fechado: saldo final bate com a soma dos lançamentos', () => {
  const r = validarExtrato({ saldoInicial: 500, saldoFinal: 1200, lancamentos });
  assert.equal(r.ok, true);
  assert.equal(r.alerta, null);
});

test('tolerância de um centavo não vira alerta', () => {
  const r = validarExtrato({ saldoInicial: 500, saldoFinal: 1200.01, lancamentos });
  assert.equal(r.ok, true);
});

test('diferença acima de um centavo alerta e diz o tamanho da diferença', () => {
  const r = validarExtrato({ saldoInicial: 500, saldoFinal: 1300, lancamentos });
  assert.equal(r.ok, false);
  assert.match(r.alerta, /99,99|99\.99/);
});

test('sem saldo inicial a conferência é ignorada (OFX e CSV não trazem)', () => {
  const r = validarExtrato({ saldoInicial: null, saldoFinal: 1200, lancamentos });
  assert.equal(r.ok, true);
  assert.equal(r.alerta, null);
});

test('fatura: total confere com a soma das linhas', () => {
  const linhas = [{ valor: 300, tipo: 'saida' }, { valor: 100, tipo: 'saida' }];
  assert.equal(validarFatura({ total: 400, lancamentos: linhas }).ok, true);
  const ruim = validarFatura({ total: 450, lancamentos: linhas });
  assert.equal(ruim.ok, false);
  assert.match(ruim.alerta, /50,00|50\.00/);
});

test('fatura sem total informado não alerta', () => {
  assert.equal(validarFatura({ total: null, lancamentos: [{ valor: 1, tipo: 'saida' }] }).ok, true);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
npm test 2>&1 | tail -20
```

Esperado: `ERR_MODULE_NOT_FOUND` apontando `lib/extratos/normalizar.js`.

- [ ] **Step 3: Escrever os três módulos**

Cria `lib/extratos/normalizar.js`:

```js
// A descrição que o banco manda vem suja de tudo que não ensina nada: data,
// número de documento, CNPJ, valor. O que sobra ("PIX ENVIADO BOI FORTE") é a
// chave do aprendizado em conciliacao_padroes — precisa ser igual em agosto e
// em setembro para o padrão pegar.
const LIMITE = 120;

export function normalizarDescricao(descricao) {
  return String(descricao ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // tira acento (marcas combinantes)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')                      // pontuação vira espaço
    .split(' ')
    .filter(t => t && !/^\d+$/.test(t))               // token só de dígito não ensina nada
    .join(' ')
    .trim()
    .slice(0, LIMITE);
}
```

Cria `lib/extratos/dedupe.js`:

```js
// Identidade do lançamento. Reimportar o mesmo período (ou o extrato do mês
// que repete os últimos dias do anterior) não pode duplicar linha.
// Quando o arquivo é OFX, o banco já dá um id único por transação (FITID) —
// aí ele manda, e dois débitos idênticos no mesmo dia não colidem.
import crypto from 'node:crypto';

export function hashDedupe({ contaBancariaId, data, valor, descricaoNormalizada, fitid }) {
  const chave = fitid
    ? `${contaBancariaId}|FITID|${fitid}`
    : `${contaBancariaId}|${data}|${Number(valor).toFixed(2)}|${descricaoNormalizada}`;
  return crypto.createHash('sha256').update(chave).digest('hex');
}
```

Cria `lib/extratos/validar.js`:

```js
// Conferência aritmética do arquivo lido. Não bloqueia a importação — só
// levanta a mão: se o saldo não fecha, alguma linha ficou de fora (página
// cortada no PDF, layout novo) e o colaborador precisa saber antes de
// conciliar. Extrato sem saldo inicial (OFX, CSV) não tem como ser conferido.
const TOLERANCIA = 0.01;

function fmt(n) {
  return Number(n).toFixed(2).replace('.', ',');
}

function soma(lancamentos) {
  return (lancamentos || []).reduce(
    (t, l) => t + (l.tipo === 'entrada' ? Number(l.valor) : -Number(l.valor)), 0);
}

export function validarExtrato({ saldoInicial, saldoFinal, lancamentos }) {
  if (saldoInicial == null || saldoFinal == null) return { ok: true, alerta: null };
  const movimento = soma(lancamentos);
  const esperado = Number(saldoFinal) - Number(saldoInicial);
  const diferenca = Math.abs(movimento - esperado);
  if (diferenca <= TOLERANCIA) return { ok: true, alerta: null };
  return {
    ok: false,
    alerta: `O extrato não fecha: a soma dos lançamentos dá R$ ${fmt(movimento)} e a `
      + `diferença entre os saldos é R$ ${fmt(esperado)} (sobrou R$ ${fmt(diferenca)}). `
      + `Confira se alguma linha ficou de fora antes de conciliar.`,
  };
}

export function validarFatura({ total, lancamentos }) {
  if (total == null) return { ok: true, alerta: null };
  const somaLinhas = (lancamentos || []).reduce((t, l) => t + Number(l.valor), 0);
  const diferenca = Math.abs(somaLinhas - Number(total));
  if (diferenca <= TOLERANCIA) return { ok: true, alerta: null };
  return {
    ok: false,
    alerta: `A fatura não fecha: as linhas somam R$ ${fmt(somaLinhas)} e o total informado é `
      + `R$ ${fmt(total)} (diferença de R$ ${fmt(diferenca)}).`,
  };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
npm test 2>&1 | tail -20
```

Esperado: os 14 testes novos passando, e os 318 que já existiam continuam passando.

- [ ] **Step 5: Commit**

```bash
git add lib/extratos/normalizar.js lib/extratos/dedupe.js lib/extratos/validar.js \
  tests/extratos-normalizar.test.mjs tests/extratos-validar.test.mjs
git commit -m "feat(financeiro): normalização, dedupe e conferência aritmética de extrato"
```

---

### Task 4: Motor de sugestão

**Files:**
- Create: `lib/extratos/matching.js`
- Create: `tests/extratos-matching.test.mjs`
- Modify: `lib/financeiro.js` (acrescentar `'Cartão de Crédito'` a `FORMAS_PAGAMENTO`)

**Interfaces:**
- Consumes: nada (funções puras; roda no servidor na Task 8 e no browser na Task 12).
- Produces:
  - `JANELA_DIAS = 7`, `TOLERANCIA = 0.01`, `LIMIAR_SUGESTAO = 60`, `MARGEM_SUGESTAO = 15`
  - `valorCasa(a, b) -> boolean`
  - `diferencaDias(dataA, dataB) -> number` (inteiro, negativo quando `dataA` é anterior)
  - `inferirFormaPagamento(descricao) -> 'Pix' | 'Boleto' | 'Transferência'`
  - `candidatosParaLancamento(lancamento, parcelas, padrao) -> [{ parcelaId, score, motivos: string[] }]` (ordem decrescente de score)
  - `escolherSugestao(lancamento, parcelas, padrao) -> { parcelaId, score } | null`
  - Formato de `parcela`: `{ id, valor, vencimento, fornecedorId }`. Formato de `lancamento`: `{ data, valor, tipo, descricao }`. Formato de `padrao`: `{ fornecedorId, categoriaConta } | null`.

- [ ] **Step 1: Escrever os testes que falham**

Cria `tests/extratos-matching.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JANELA_DIAS, valorCasa, diferencaDias, inferirFormaPagamento,
  candidatosParaLancamento, escolherSugestao,
} from '../lib/extratos/matching.js';

const saida = { data: '2026-08-10', valor: 750, tipo: 'saida', descricao: 'PIX ENVIADO BOI FORTE' };
const parcela = (id, valor, vencimento, fornecedorId = 'forn-1') =>
  ({ id, valor, vencimento, fornecedorId });

test('valor casa com tolerância de um centavo, não além', () => {
  assert.equal(valorCasa(750, 750), true);
  assert.equal(valorCasa(750, 750.01), true);
  assert.equal(valorCasa(750, 750.02), false);
});

test('diferença de dias é assinada', () => {
  assert.equal(diferencaDias('2026-08-10', '2026-08-10'), 0);
  assert.equal(diferencaDias('2026-08-10', '2026-08-13'), -3);
  assert.equal(diferencaDias('2026-08-13', '2026-08-10'), 3);
});

test('forma de pagamento sai da descrição', () => {
  assert.equal(inferirFormaPagamento('PIX ENVIADO BOI FORTE'), 'Pix');
  assert.equal(inferirFormaPagamento('PAGAMENTO DE BOLETO 001'), 'Boleto');
  assert.equal(inferirFormaPagamento('LIQUIDACAO TITULO COBRANCA'), 'Boleto');
  assert.equal(inferirFormaPagamento('DEB AUT ENERGISA'), 'Transferência');
  assert.equal(inferirFormaPagamento(''), 'Transferência');
});

test('parcela fora da janela de 7 dias não é candidata', () => {
  const fora = parcela('p1', 750, '2026-08-20');
  assert.equal(candidatosParaLancamento(saida, [fora], null).length, 0);
  const dentro = parcela('p2', 750, `2026-08-${10 + JANELA_DIAS}`);
  assert.equal(candidatosParaLancamento(saida, [dentro], null).length, 1);
});

test('parcela de valor diferente não é candidata, nem perto', () => {
  assert.equal(candidatosParaLancamento(saida, [parcela('p1', 749, '2026-08-10')], null).length, 0);
});

test('candidato único no mesmo dia é sugerido', () => {
  const r = escolherSugestao(saida, [parcela('p1', 750, '2026-08-10')], null);
  assert.equal(r.parcelaId, 'p1');
  assert.ok(r.score >= 60);
});

test('dois candidatos idênticos são ambíguos: ninguém é sugerido', () => {
  const r = escolherSugestao(saida, [
    parcela('p1', 750, '2026-08-10'),
    parcela('p2', 750, '2026-08-10'),
  ], null);
  assert.equal(r, null);
});

test('o padrão aprendido desempata pelo fornecedor', () => {
  const r = escolherSugestao(saida, [
    parcela('p1', 750, '2026-08-10', 'forn-1'),
    parcela('p2', 750, '2026-08-10', 'forn-2'),
  ], { fornecedorId: 'forn-2', categoriaConta: 'Custos Diretos' });
  assert.equal(r.parcelaId, 'p2');
});

test('padrão que não acha ninguém não descarta os candidatos', () => {
  const r = candidatosParaLancamento(saida, [parcela('p1', 750, '2026-08-10', 'forn-9')],
    { fornecedorId: 'forn-inexistente' });
  assert.equal(r.length, 1, 'padrão errado não pode zerar a lista de candidatos');
});

test('candidatos vêm ordenados: quem vence mais perto do débito primeiro', () => {
  const r = candidatosParaLancamento(saida, [
    parcela('p-longe', 750, '2026-08-16'),
    parcela('p-perto', 750, '2026-08-10'),
  ], null);
  assert.deepEqual(r.map(c => c.parcelaId), ['p-perto', 'p-longe']);
});

test('entrada nunca gera candidato', () => {
  const entrada = { ...saida, tipo: 'entrada' };
  assert.equal(candidatosParaLancamento(entrada, [parcela('p1', 750, '2026-08-10')], null).length, 0);
  assert.equal(escolherSugestao(entrada, [parcela('p1', 750, '2026-08-10')], null), null);
});

test('sem parcela nenhuma não quebra', () => {
  assert.deepEqual(candidatosParaLancamento(saida, [], null), []);
  assert.equal(escolherSugestao(saida, null, null), null);
});

test('candidato distante da data não alcança o limiar sozinho', () => {
  const r = escolherSugestao(saida, [parcela('p1', 750, '2026-08-17')], null);
  assert.equal(r, null, 'vencimento a 7 dias sem padrão é fraco demais para sugerir');
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
node --test tests/extratos-matching.test.mjs 2>&1 | tail -10
```

Esperado: `ERR_MODULE_NOT_FOUND` de `lib/extratos/matching.js`.

- [ ] **Step 3: Escrever o motor**

Cria `lib/extratos/matching.js`:

```js
// Motor de sugestão: dado um débito do extrato e as parcelas pendentes,
// diz qual parcela provavelmente é aquele débito. Funções puras — a rota
// usa para pré-associar na importação, e a tela usa para ranquear o dropdown
// quando o colaborador vai escolher na mão.
//
// A régua: valor igual é pré-requisito (banco não erra centavo), data perto
// pontua, e o fornecedor aprendido no padrão é o desempate. Sem certeza não
// se sugere nada — deixar em 'pendente' custa um clique; sugerir errado custa
// uma parcela baixada no lugar errado.

export const JANELA_DIAS = 7;
export const TOLERANCIA = 0.01;
export const LIMIAR_SUGESTAO = 60;
export const MARGEM_SUGESTAO = 15;

const PONTOS_VALOR = 50;      // pré-requisito: todo candidato tem
const PONTOS_FORNECEDOR = 30; // padrão aprendido aponta para este fornecedor
const PONTOS_DATA = 20;       // proporcional à proximidade do vencimento

export function valorCasa(a, b) {
  return Math.abs(Number(a) - Number(b)) <= TOLERANCIA;
}

export function diferencaDias(dataA, dataB) {
  const ms = Date.parse(`${dataA}T00:00:00Z`) - Date.parse(`${dataB}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

export function inferirFormaPagamento(descricao) {
  const t = String(descricao ?? '').toUpperCase();
  if (t.includes('PIX')) return 'Pix';
  if (/BOLETO|TITULO|COBRANCA|COBRANÇA/.test(t)) return 'Boleto';
  return 'Transferência';
}

export function candidatosParaLancamento(lancamento, parcelas, padrao) {
  if (!lancamento || lancamento.tipo !== 'saida' || !Array.isArray(parcelas)) return [];

  let candidatos = [];
  for (const p of parcelas) {
    if (!valorCasa(lancamento.valor, p.valor)) continue;
    const dias = diferencaDias(lancamento.data, p.vencimento);
    if (Math.abs(dias) > JANELA_DIAS) continue;
    candidatos.push({ parcela: p, dias });
  }

  // Padrão aprendido filtra pelo fornecedor — mas só quando ele acha alguém.
  // Padrão desatualizado (fornecedor trocou de nome, boleto veio de outro CNPJ)
  // não pode esconder o candidato certo do colaborador.
  const fornecedorPadrao = padrao?.fornecedorId || null;
  if (fornecedorPadrao) {
    const doPadrao = candidatos.filter(c => c.parcela.fornecedorId === fornecedorPadrao);
    if (doPadrao.length) candidatos = doPadrao;
  }

  return candidatos
    .map(({ parcela, dias }) => {
      const motivos = ['valor igual'];
      let score = PONTOS_VALOR;
      if (fornecedorPadrao && parcela.fornecedorId === fornecedorPadrao) {
        score += PONTOS_FORNECEDOR;
        motivos.push('fornecedor já aprendido');
      }
      score += Math.round(PONTOS_DATA * (1 - Math.abs(dias) / JANELA_DIAS));
      motivos.push(dias === 0 ? 'vence no dia do débito' : `vence a ${Math.abs(dias)} dia(s) do débito`);
      return { parcelaId: parcela.id, score, motivos };
    })
    .sort((a, b) => b.score - a.score);
}

// Só sugere quando há um vencedor claro: pontuação acima do limiar e folga
// sobre o segundo colocado. Empate vira 'pendente' e a tela pede a escolha.
export function escolherSugestao(lancamento, parcelas, padrao) {
  const candidatos = candidatosParaLancamento(lancamento, parcelas, padrao);
  if (!candidatos.length) return null;
  const [primeiro, segundo] = candidatos;
  if (primeiro.score < LIMIAR_SUGESTAO) return null;
  if (segundo && primeiro.score - segundo.score < MARGEM_SUGESTAO) return null;
  return { parcelaId: primeiro.parcelaId, score: primeiro.score };
}
```

- [ ] **Step 4: Acrescentar a forma de pagamento do cartão**

Em `lib/financeiro.js`, trocar a linha da constante:

```js
export const FORMAS_PAGAMENTO = ['Pix', 'Boleto', 'Transferência', 'Dinheiro', 'Cartão de Crédito'];
```

- [ ] **Step 5: Rodar e confirmar que passa**

```bash
npm test 2>&1 | tail -20
```

Esperado: todos os testes de matching passando, suíte inteira verde.

- [ ] **Step 6: Commit**

```bash
git add lib/extratos/matching.js tests/extratos-matching.test.mjs lib/financeiro.js
git commit -m "feat(financeiro): motor de sugestão de conciliação e forma de pagamento cartão"
```

---

### Task 5: Parser OFX (1.x SGML e 2.x XML)

**Files:**
- Create: `lib/extratos/numero.js`
- Create: `lib/extratos/parseOfx.js`
- Create: `tests/extratos-numero.test.mjs`
- Create: `tests/extratos-parse-ofx.test.mjs`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `numeroBr(texto) -> number` (aceita `1.234,56`, `1234.56`, `-750,00`, `750`)
  - `dataIso(texto) -> string | null` (aceita `20260810120000[-3:BRT]`, `2026-08-10`, `10/08/2026`)
  - `parseOfx(texto) -> ExtratoLido` onde
    `ExtratoLido = { periodoInicio, periodoFim, saldoInicial, saldoFinal, total, lancamentos: [{ data, descricao, valor, tipo, documento, fitid }] }`
  - `saldoInicial` é sempre `null` no OFX (o formato só traz `LEDGERBAL`, o saldo final); `total` é `null` (só faturas têm).
  - Tasks 6 e 7 produzem **o mesmo shape `ExtratoLido`** — a Task 8 trata os três de forma idêntica.

- [ ] **Step 1: Escrever os testes que falham**

Cria `tests/extratos-numero.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numeroBr, dataIso } from '../lib/extratos/numero.js';

test('lê número no formato brasileiro', () => {
  assert.equal(numeroBr('1.234,56'), 1234.56);
  assert.equal(numeroBr('-750,00'), -750);
  assert.equal(numeroBr('0,01'), 0.01);
});

test('lê número no formato americano (OFX usa ponto decimal)', () => {
  assert.equal(numeroBr('1234.56'), 1234.56);
  assert.equal(numeroBr('-750.00'), -750);
  assert.equal(numeroBr('750'), 750);
});

test('número inválido devolve NaN, não zero', () => {
  assert.ok(Number.isNaN(numeroBr('SALDO')));
  assert.ok(Number.isNaN(numeroBr('')));
  assert.ok(Number.isNaN(numeroBr(null)));
});

test('data do OFX com fuso é cortada no dia', () => {
  assert.equal(dataIso('20260810120000[-3:BRT]'), '2026-08-10');
  assert.equal(dataIso('20260810'), '2026-08-10');
});

test('data brasileira e ISO', () => {
  assert.equal(dataIso('10/08/2026'), '2026-08-10');
  assert.equal(dataIso('2026-08-10'), '2026-08-10');
});

test('data ilegível devolve null', () => {
  assert.equal(dataIso('mês passado'), null);
  assert.equal(dataIso(''), null);
});
```

Cria `tests/extratos-parse-ofx.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOfx } from '../lib/extratos/parseOfx.js';

// OFX 1.x: SGML, tag de folha sem fechamento. É o que Sicoob, Sicredi e BB
// entregam hoje.
const OFX_102 = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
CHARSET:1252

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>BRL
<BANKACCTFROM><BANKID>756<ACCTID>12345-6<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20260801000000[-3:BRT]<DTEND>20260831000000[-3:BRT]
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260810000000[-3:BRT]<TRNAMT>-750.00<FITID>2026081001<MEMO>PIX ENVIADO BOI FORTE</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260812000000[-3:BRT]<TRNAMT>200.00<FITID>2026081202<MEMO>PIX RECEBIDO CLIENTE</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>1200.00<DTASOF>20260831000000[-3:BRT]</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

// OFX 2.x: XML de verdade, tudo fechado, tudo numa linha só.
const OFX_211 = `<?xml version="1.0" encoding="UTF-8"?><?OFX OFXHEADER="200" VERSION="211"?>`
  + `<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL</CURDEF><BANKTRANLIST>`
  + `<DTSTART>20260801</DTSTART><DTEND>20260831</DTEND>`
  + `<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260815</DTPOSTED><TRNAMT>-49.90</TRNAMT>`
  + `<FITID>X1</FITID><MEMO>TARIFA PACOTE SERVICOS</MEMO><CHECKNUM>445</CHECKNUM></STMTTRN>`
  + `</BANKTRANLIST><LEDGERBAL><BALAMT>950.10</BALAMT></LEDGERBAL>`
  + `</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

test('OFX 1.x: lê período, saldo final e os dois lançamentos', () => {
  const r = parseOfx(OFX_102);
  assert.equal(r.periodoInicio, '2026-08-01');
  assert.equal(r.periodoFim, '2026-08-31');
  assert.equal(r.saldoInicial, null, 'OFX não traz saldo inicial');
  assert.equal(r.saldoFinal, 1200);
  assert.equal(r.lancamentos.length, 2);
});

test('OFX 1.x: sinal do TRNAMT define tipo, e valor fica positivo', () => {
  const [debito, credito] = parseOfx(OFX_102).lancamentos;
  assert.deepEqual(debito, {
    data: '2026-08-10', descricao: 'PIX ENVIADO BOI FORTE', valor: 750,
    tipo: 'saida', documento: null, fitid: '2026081001',
  });
  assert.equal(credito.tipo, 'entrada');
  assert.equal(credito.valor, 200);
});

test('OFX 2.x: mesmo resultado com tags fechadas e arquivo em uma linha', () => {
  const r = parseOfx(OFX_211);
  assert.equal(r.periodoInicio, '2026-08-01');
  assert.equal(r.saldoFinal, 950.1);
  assert.equal(r.lancamentos.length, 1);
  assert.deepEqual(r.lancamentos[0], {
    data: '2026-08-15', descricao: 'TARIFA PACOTE SERVICOS', valor: 49.9,
    tipo: 'saida', documento: '445', fitid: 'X1',
  });
});

test('fatura de cartão (CCSTMTRS) é lida pelo mesmo caminho', () => {
  const cc = `<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><BANKTRANLIST>`
    + `<DTSTART>20260801</DTSTART><DTEND>20260831</DTEND>`
    + `<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260802</DTPOSTED><TRNAMT>-400.00</TRNAMT>`
    + `<FITID>C1</FITID><MEMO>MERCADO LIVRE</MEMO></STMTTRN>`
    + `</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;
  const r = parseOfx(cc);
  assert.equal(r.lancamentos.length, 1);
  assert.equal(r.lancamentos[0].descricao, 'MERCADO LIVRE');
});

test('transação única (sem array) não quebra', () => {
  const r = parseOfx(OFX_211);
  assert.ok(Array.isArray(r.lancamentos));
});

test('arquivo que não é OFX explica o problema em português', () => {
  assert.throws(() => parseOfx('isto nao e um ofx'), /não parece ser um arquivo OFX/i);
});

test('OFX sem nenhuma transação é erro, não extrato vazio silencioso', () => {
  const vazio = `<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>`
    + `<DTSTART>20260801</DTSTART><DTEND>20260831</DTEND></BANKTRANLIST>`
    + `</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  assert.throws(() => parseOfx(vazio), /nenhum lançamento/i);
});

test('MEMO ausente cai para NAME sem perder a linha', () => {
  const semMemo = `<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>`
    + `<DTSTART>20260801</DTSTART><DTEND>20260831</DTEND>`
    + `<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260810</DTPOSTED><TRNAMT>-10.00</TRNAMT>`
    + `<FITID>N1</FITID><NAME>DEB AUT ENERGISA</NAME></STMTTRN>`
    + `</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  assert.equal(parseOfx(semMemo).lancamentos[0].descricao, 'DEB AUT ENERGISA');
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
node --test tests/extratos-numero.test.mjs tests/extratos-parse-ofx.test.mjs 2>&1 | tail -10
```

Esperado: `ERR_MODULE_NOT_FOUND` de `lib/extratos/numero.js`.

- [ ] **Step 3: Escrever `lib/extratos/numero.js`**

```js
// Número e data chegam em três dialetos: OFX usa ponto decimal e data
// compactada (20260810120000[-3:BRT]), CSV de banco brasileiro usa vírgula
// decimal e dd/mm/aaaa, e a IA devolve ISO. Um lugar só resolve os três.

export function numeroBr(texto) {
  if (texto == null) return NaN;
  let t = String(texto).trim().replace(/\s|R\$| /g, '');
  if (!t) return NaN;
  // Negativo em parênteses, como alguns extratos escrevem: (1.234,56)
  let sinal = 1;
  if (/^\(.*\)$/.test(t)) { sinal = -1; t = t.slice(1, -1); }
  if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '').replace(',', '.');
  else if (t.includes(',')) t = t.replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return NaN;
  return sinal * Number(t);
}

export function dataIso(texto) {
  const t = String(texto ?? '').trim();
  if (!t) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{4})(\d{2})(\d{2})/.exec(t);          // OFX: 20260810120000[-3:BRT]
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(t);      // dd/mm/aaaa
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(t);     // dd/mm/aa
  if (m) return `20${m[3]}-${m[2]}-${m[1]}`;
  return null;
}
```

- [ ] **Step 4: Escrever `lib/extratos/parseOfx.js`**

```js
// OFX vem em duas gerações e os seis bancos do grupo usam as duas: a 1.x é
// SGML (tag de folha sem fechamento, uma por linha) e a 2.x é XML de verdade.
// fast-xml-parser só lê a segunda, então aqui vai um tokenizador que trata as
// duas igual: abre-tag seguida de texto é folha; abre-tag seguida de abre-tag
// é agregado.
import { numeroBr, dataIso } from './numero.js';

function tokenizar(texto) {
  const inicio = texto.indexOf('<OFX>');
  if (inicio < 0) throw new Error('Este arquivo não parece ser um arquivo OFX.');
  const corpo = texto.slice(inicio);
  const tokens = [];
  const re = /<(\/?)([A-Za-z0-9._]+)>|([^<]+)/g;
  let m;
  while ((m = re.exec(corpo)) !== null) {
    if (m[2]) tokens.push({ tipo: m[1] ? 'fecha' : 'abre', nome: m[2].toUpperCase() });
    else {
      const valor = m[3].trim();
      if (valor) tokens.push({ tipo: 'texto', valor });
    }
  }
  return tokens;
}

function montar(tokens) {
  const raiz = {};
  const pilha = [raiz];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const pai = pilha[pilha.length - 1];
    if (t.tipo === 'abre') {
      const proximo = tokens[i + 1];
      if (proximo && proximo.tipo === 'texto') {
        pai[t.nome] = proximo.valor;
        i++;
        // Na 2.x a folha fecha; na 1.x não. Consome o fechamento se vier.
        if (tokens[i + 1]?.tipo === 'fecha' && tokens[i + 1].nome === t.nome) i++;
      } else {
        const no = {};
        if (pai[t.nome] === undefined) pai[t.nome] = no;
        else if (Array.isArray(pai[t.nome])) pai[t.nome].push(no);
        else pai[t.nome] = [pai[t.nome], no];
        pilha.push(no);
      }
    } else if (t.tipo === 'fecha' && pilha.length > 1) {
      pilha.pop();
    }
  }
  return raiz;
}

function comoLista(valor) {
  if (!valor) return [];
  return Array.isArray(valor) ? valor : [valor];
}

export function parseOfx(texto) {
  const arvore = montar(tokenizar(texto));
  const ofx = arvore.OFX || {};
  const extrato = ofx.BANKMSGSRSV1?.STMTTRNRS?.STMTRS
    || ofx.CREDITCARDMSGSRSV1?.CCSTMTTRNRS?.CCSTMTRS;
  if (!extrato) {
    throw new Error('Não achei o extrato dentro do OFX (nem conta corrente, nem cartão).');
  }

  const lista = extrato.BANKTRANLIST || {};
  const lancamentos = comoLista(lista.STMTTRN).map(t => {
    const valor = numeroBr(t.TRNAMT);
    const data = dataIso(t.DTPOSTED);
    if (!data || Number.isNaN(valor)) {
      throw new Error('Uma transação do OFX veio sem data ou sem valor legível.');
    }
    return {
      data,
      descricao: String(t.MEMO || t.NAME || '').trim() || 'SEM DESCRIÇÃO',
      valor: Math.abs(valor),
      tipo: valor < 0 ? 'saida' : 'entrada',
      documento: t.CHECKNUM ? String(t.CHECKNUM) : null,
      fitid: t.FITID ? String(t.FITID) : null,
    };
  });

  if (!lancamentos.length) {
    throw new Error('O OFX não trouxe nenhum lançamento — confira o período exportado no banco.');
  }

  const saldoFinal = numeroBr(extrato.LEDGERBAL?.BALAMT);
  return {
    periodoInicio: dataIso(lista.DTSTART),
    periodoFim: dataIso(lista.DTEND),
    saldoInicial: null, // o formato não traz; a conferência aritmética é ignorada
    saldoFinal: Number.isNaN(saldoFinal) ? null : saldoFinal,
    total: null,
    lancamentos,
  };
}
```

- [ ] **Step 5: Rodar e confirmar que passa**

```bash
npm test 2>&1 | tail -20
```

- [ ] **Step 6: Commit**

```bash
git add lib/extratos/numero.js lib/extratos/parseOfx.js \
  tests/extratos-numero.test.mjs tests/extratos-parse-ofx.test.mjs
git commit -m "feat(financeiro): parser OFX 1.x e 2.x sem dependência nova"
```

---

### Task 6: Parser CSV com detecção de colunas

**Files:**
- Create: `lib/extratos/parseCsv.js`
- Create: `tests/extratos-parse-csv.test.mjs`

**Interfaces:**
- Consumes: `numeroBr`, `dataIso` de `lib/extratos/numero.js` (Task 5).
- Produces: `parseCsv(texto) -> ExtratoLido & { reconhecido: boolean }`. Quando `reconhecido` é `false`, `lancamentos` vem vazio e a Task 8 manda o arquivo para a IA — o CSV não reconhecido nunca é erro fatal.

- [ ] **Step 1: Escrever os testes que falham**

Cria `tests/extratos-parse-csv.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../lib/extratos/parseCsv.js';

const CSV_SICOOB = `Extrato de conta corrente
Conta: 12345-6

Data;Histórico;Documento;Valor
10/08/2026;PIX ENVIADO BOI FORTE;123456;-750,00
12/08/2026;PIX RECEBIDO CLIENTE;123457;200,00
31/08/2026;SALDO DO DIA;;1.200,00
`;

test('lê CSV com ponto e vírgula, data BR e valor com vírgula', () => {
  const r = parseCsv(CSV_SICOOB);
  assert.equal(r.reconhecido, true);
  assert.equal(r.lancamentos.length, 2, 'linha de saldo não é lançamento');
  assert.deepEqual(r.lancamentos[0], {
    data: '2026-08-10', descricao: 'PIX ENVIADO BOI FORTE', valor: 750,
    tipo: 'saida', documento: '123456', fitid: null,
  });
  assert.equal(r.lancamentos[1].tipo, 'entrada');
});

test('período sai da primeira e da última data', () => {
  const r = parseCsv(CSV_SICOOB);
  assert.equal(r.periodoInicio, '2026-08-10');
  assert.equal(r.periodoFim, '2026-08-12');
});

test('aceita vírgula como separador e cabeçalho em inglês', () => {
  const csv = 'Date,Description,Amount\n2026-08-10,MERCADO LIVRE,-400.00\n';
  const r = parseCsv(csv);
  assert.equal(r.reconhecido, true);
  assert.deepEqual(r.lancamentos[0].valor, 400);
  assert.equal(r.lancamentos[0].tipo, 'saida');
});

test('campo entre aspas com separador dentro não parte a coluna', () => {
  const csv = 'Data;Histórico;Valor\n10/08/2026;"BOI FORTE; MATRIZ";-750,00\n';
  assert.equal(parseCsv(csv).lancamentos[0].descricao, 'BOI FORTE; MATRIZ');
});

test('arquivo sem cabeçalho reconhecível não é erro — devolve reconhecido false', () => {
  const r = parseCsv('bla bla bla\noutra linha qualquer\n');
  assert.equal(r.reconhecido, false);
  assert.deepEqual(r.lancamentos, []);
});

test('cabeçalho sem coluna de valor não é reconhecido', () => {
  const r = parseCsv('Data;Histórico\n10/08/2026;ALGO\n');
  assert.equal(r.reconhecido, false);
});

test('linha com valor ilegível é descartada, o resto entra', () => {
  const csv = 'Data;Histórico;Valor\n10/08/2026;BOM;-750,00\n11/08/2026;RUIM;abc\n';
  const r = parseCsv(csv);
  assert.equal(r.lancamentos.length, 1);
  assert.equal(r.lancamentos[0].descricao, 'BOM');
});

test('CSV não traz saldo: conferência aritmética fica de fora', () => {
  const r = parseCsv(CSV_SICOOB);
  assert.equal(r.saldoInicial, null);
  assert.equal(r.saldoFinal, null);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
node --test tests/extratos-parse-csv.test.mjs 2>&1 | tail -10
```

- [ ] **Step 3: Escrever `lib/extratos/parseCsv.js`**

```js
// CSV de banco não tem padrão: muda o separador, o nome das colunas e a
// ordem. Aqui a gente tenta reconhecer o cabeçalho; quando não dá, devolve
// reconhecido: false e quem chamou manda o arquivo para a IA. Preferir a IA a
// adivinhar errado — lançamento errado no financeiro custa mais que a chamada.
import { numeroBr, dataIso } from './numero.js';

const SEPARADORES = [';', ',', '\t', '|'];

const COLUNAS = {
  data: /^(data|data\s*(do)?\s*(mov|lan|opera).*|date|dt)$/i,
  descricao: /(hist[oó]rico|descri|lan[çc]amento|memo|detalhe|description|narrative)/i,
  valor: /^(valor|vlr|value|amount|montante|valor\s*\(r\$\))$/i,
  documento: /(documento|^doc$|n[uú]mero|checknum)/i,
};

function dividirLinha(linha, separador) {
  const campos = [];
  let atual = '';
  let dentroDeAspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') {
      if (dentroDeAspas && linha[i + 1] === '"') { atual += '"'; i++; }
      else dentroDeAspas = !dentroDeAspas;
    } else if (c === separador && !dentroDeAspas) {
      campos.push(atual.trim()); atual = '';
    } else atual += c;
  }
  campos.push(atual.trim());
  return campos;
}

function acharCabecalho(linhas) {
  for (let i = 0; i < Math.min(linhas.length, 25); i++) {
    for (const separador of SEPARADORES) {
      const campos = dividirLinha(linhas[i], separador);
      if (campos.length < 2) continue;
      const mapa = {};
      campos.forEach((campo, indice) => {
        for (const [chave, re] of Object.entries(COLUNAS)) {
          if (mapa[chave] === undefined && re.test(campo)) mapa[chave] = indice;
        }
      });
      if (mapa.data !== undefined && mapa.valor !== undefined) {
        return { linhaCabecalho: i, separador, mapa };
      }
    }
  }
  return null;
}

const VAZIO = {
  reconhecido: false, periodoInicio: null, periodoFim: null,
  saldoInicial: null, saldoFinal: null, total: null, lancamentos: [],
};

export function parseCsv(texto) {
  const linhas = String(texto ?? '').split(/\r?\n/).filter(l => l.trim());
  const cabecalho = acharCabecalho(linhas);
  if (!cabecalho) return { ...VAZIO };

  const { linhaCabecalho, separador, mapa } = cabecalho;
  const lancamentos = [];
  for (const linha of linhas.slice(linhaCabecalho + 1)) {
    const campos = dividirLinha(linha, separador);
    const data = dataIso(campos[mapa.data]);
    const valor = numeroBr(campos[mapa.valor]);
    if (!data || Number.isNaN(valor) || valor === 0) continue;
    const descricao = (mapa.descricao !== undefined ? campos[mapa.descricao] : '').trim();
    // Linha de saldo (do dia, anterior, final) é resumo, não movimento.
    if (/^saldo/i.test(descricao)) continue;
    lancamentos.push({
      data,
      descricao: descricao || 'SEM DESCRIÇÃO',
      valor: Math.abs(valor),
      tipo: valor < 0 ? 'saida' : 'entrada',
      documento: mapa.documento !== undefined ? (campos[mapa.documento] || null) : null,
      fitid: null,
    });
  }

  if (!lancamentos.length) return { ...VAZIO };
  const datas = lancamentos.map(l => l.data).sort();
  return {
    reconhecido: true,
    periodoInicio: datas[0],
    periodoFim: datas[datas.length - 1],
    saldoInicial: null,
    saldoFinal: null,
    total: null,
    lancamentos,
  };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
npm test 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
git add lib/extratos/parseCsv.js tests/extratos-parse-csv.test.mjs
git commit -m "feat(financeiro): parser CSV com detecção de colunas e fallback para IA"
```

---

### Task 7: Extração de PDF pela Claude API

**Files:**
- Create: `lib/extratos/extrairPdf.js`
- Create: `tests/extratos-extrair-pdf.test.mjs`
- Modify: `package.json` (dependência nova `@anthropic-ai/sdk`)

**Interfaces:**
- Consumes: `dataIso` de `lib/extratos/numero.js`.
- Produces:
  - `MODELO_PADRAO = 'claude-opus-5'`
  - `FERRAMENTA` (definição da tool, exportada para o teste conferir o schema)
  - `montarPedido({ base64, tipo, modelo }) -> object` (o corpo do pedido, sem o cliente)
  - `async extrairPdf({ base64, tipo, apiKey, modelo, cliente }) -> ExtratoLido` — mesmo shape das tasks 5 e 6. `cliente` existe só para o teste injetar um dublê; em produção o módulo constrói o cliente do SDK.
- Nota: este módulo não importa `next/server` nem o cliente Supabase — continua testável por `node --test`.

**Decisões que divergem do resto do plano** (tomadas depois de consultar a referência da API):

1. **Usa o SDK oficial `@anthropic-ai/sdk`, não `fetch` cru.** A restrição global "nenhuma dependência npm nova" vale para todo o resto da feature, mas não aqui: chamar a API por HTTP à mão perde retry automático de 429 e 5xx, tipos de erro e cabeçalhos corretos. Numa rota que importa dinheiro, o retry sozinho já paga a dependência.
2. **Modelo padrão `claude-opus-5`.** Extração de extrato é trabalho sensível a acerto: uma linha lida errado vira lançamento errado no financeiro. O override por env (`EXTRATO_IA_MODELO`) continua existindo para quem quiser trocar.
3. **Fallback de recusa ligado.** Se o modelo recusar a leitura por política, a API refaz o pedido no modelo de fallback dentro da mesma chamada. `stop_reason: 'refusal'` na resposta final vira erro em português, em vez de "não achei a ferramenta na resposta".

- [ ] **Step 1: Instalar o SDK**

```bash
npm install @anthropic-ai/sdk
```

- [ ] **Step 2: Escrever os testes que falham**

Cria `tests/extratos-extrair-pdf.test.mjs`. O dublê do cliente implementa só o que o módulo usa: `beta.messages.create`.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extrairPdf, montarPedido, MODELO_PADRAO } from '../lib/extratos/extrairPdf.js';

// Dublê do cliente: implementa só beta.messages.create, que é tudo que o módulo usa.
function clienteFalso(resposta, capturar) {
  return {
    beta: {
      messages: {
        create: async pedido => {
          if (capturar) capturar(pedido);
          return resposta;
        },
      },
    },
  };
}

function respostaComFerramenta(input) {
  return {
    stop_reason: 'tool_use',
    content: [
      { type: 'text', text: 'Li o extrato.' },
      { type: 'tool_use', name: 'registrar_extrato', input },
    ],
  };
}

const EXTRATO_IA = {
  periodo_inicio: '2026-08-01',
  periodo_fim: '2026-08-31',
  saldo_inicial: 500,
  saldo_final: 1200,
  lancamentos: [
    { data: '2026-08-10', descricao: 'PIX ENVIADO BOI FORTE', valor: -750, tipo: 'saida', documento: '123' },
    { data: '2026-08-12', descricao: 'PIX RECEBIDO CLIENTE', valor: 200, tipo: 'entrada', documento: null },
  ],
};

test('pedido manda o PDF como documento e força a ferramenta', () => {
  const pedido = montarPedido({ base64: 'QUJD', tipo: 'extrato' });
  assert.equal(pedido.model, MODELO_PADRAO);
  assert.equal(pedido.tool_choice.type, 'tool');
  assert.equal(pedido.tool_choice.name, 'registrar_extrato');
  const doc = pedido.messages[0].content.find(c => c.type === 'document');
  assert.equal(doc.source.type, 'base64');
  assert.equal(doc.source.media_type, 'application/pdf');
  assert.equal(doc.source.data, 'QUJD');
});

test('modelo padrão é o mais capaz, e pode ser trocado por parâmetro', () => {
  assert.equal(MODELO_PADRAO, 'claude-opus-5');
  assert.equal(montarPedido({ base64: 'x', tipo: 'extrato', modelo: 'claude-sonnet-5' }).model,
    'claude-sonnet-5');
});

test('fatura pede o total da fatura no prompt', () => {
  const pedido = montarPedido({ base64: 'x', tipo: 'fatura_cartao' });
  const texto = pedido.messages[0].content.find(c => c.type === 'text').text;
  assert.match(texto, /fatura/i);
});

test('lê a resposta da ferramenta e normaliza sinal em tipo', async () => {
  const r = await extrairPdf({
    base64: 'x', tipo: 'extrato', cliente: clienteFalso(respostaComFerramenta(EXTRATO_IA)),
  });
  assert.equal(r.periodoInicio, '2026-08-01');
  assert.equal(r.saldoInicial, 500);
  assert.equal(r.saldoFinal, 1200);
  assert.deepEqual(r.lancamentos[0], {
    data: '2026-08-10', descricao: 'PIX ENVIADO BOI FORTE', valor: 750,
    tipo: 'saida', documento: '123', fitid: null,
  });
  assert.equal(r.lancamentos[1].tipo, 'entrada');
});

test('sinal decide o tipo quando a IA não preenche o campo', async () => {
  const r = await extrairPdf({
    base64: 'x', tipo: 'extrato',
    cliente: clienteFalso(respostaComFerramenta({
      ...EXTRATO_IA,
      lancamentos: [{ data: '2026-08-10', descricao: 'TARIFA', valor: -49.9 }],
    })),
  });
  assert.equal(r.lancamentos[0].tipo, 'saida');
  assert.equal(r.lancamentos[0].valor, 49.9);
});

test('linha sem data legível é descartada sem derrubar a importação', async () => {
  const r = await extrairPdf({
    base64: 'x', tipo: 'extrato',
    cliente: clienteFalso(respostaComFerramenta({
      ...EXTRATO_IA,
      lancamentos: [
        { data: 'sei lá', descricao: 'RUIM', valor: -10, tipo: 'saida' },
        { data: '2026-08-10', descricao: 'BOM', valor: -10, tipo: 'saida' },
      ],
    })),
  });
  assert.equal(r.lancamentos.length, 1);
  assert.equal(r.lancamentos[0].descricao, 'BOM');
});

test('sem chave da API o erro diz o que configurar', async () => {
  await assert.rejects(
    () => extrairPdf({ base64: 'x', tipo: 'extrato', apiKey: '' }),
    /ANTHROPIC_API_KEY/);
});

test('recusa do modelo vira erro em português, não "ferramenta não veio"', async () => {
  await assert.rejects(
    () => extrairPdf({
      base64: 'x', tipo: 'extrato',
      cliente: clienteFalso({ stop_reason: 'refusal', stop_details: { category: 'other' }, content: [] }),
    }),
    /recus/i);
});

test('resposta sem tool_use é erro explícito', async () => {
  await assert.rejects(
    () => extrairPdf({
      base64: 'x', tipo: 'extrato',
      cliente: clienteFalso({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'não consegui' }] }),
    }),
    /não consegui ler o PDF|não devolveu/i);
});

test('resposta truncada por max_tokens é erro, não extrato pela metade', async () => {
  await assert.rejects(
    () => extrairPdf({
      base64: 'x', tipo: 'extrato',
      cliente: clienteFalso({
        stop_reason: 'max_tokens',
        content: [{ type: 'tool_use', name: 'registrar_extrato', input: EXTRATO_IA }],
      }),
    }),
    /longo demais|truncad/i);
});

test('nenhum lançamento extraído é erro (PDF errado, página em branco)', async () => {
  await assert.rejects(
    () => extrairPdf({
      base64: 'x', tipo: 'extrato',
      cliente: clienteFalso(respostaComFerramenta({ ...EXTRATO_IA, lancamentos: [] })),
    }),
    /nenhum lançamento/i);
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

```bash
node --test tests/extratos-extrair-pdf.test.mjs 2>&1 | tail -10
```

- [ ] **Step 4: Escrever `lib/extratos/extrairPdf.js`**

```js
// Extrato em PDF é o formato que o colaborador tem na mão, e é o pior de
// todos para ler por regra fixa: cada banco tem um layout e muda sem avisar.
// A Claude API lê PDF nativamente e devolve os lançamentos por tool call com
// schema — o que chega aqui já é estrutura, não texto solto.
//
// Custo: um extrato de ~10 páginas sai por centavos. É mais barato que manter
// seis parsers de PDF.
import Anthropic from '@anthropic-ai/sdk';
import { dataIso } from './numero.js';

export const MODELO_PADRAO = 'claude-opus-5';
const BETA_FALLBACK = 'server-side-fallback-2026-07-01';

export const FERRAMENTA = {
  name: 'registrar_extrato',
  description: 'Registra os lançamentos lidos do extrato ou da fatura.',
  input_schema: {
    type: 'object',
    properties: {
      periodo_inicio: { type: 'string', description: 'Primeiro dia do período, AAAA-MM-DD.' },
      periodo_fim: { type: 'string', description: 'Último dia do período, AAAA-MM-DD.' },
      saldo_inicial: { type: ['number', 'null'], description: 'Saldo anterior, se o documento mostrar.' },
      saldo_final: { type: ['number', 'null'], description: 'Saldo final, se o documento mostrar.' },
      total_fatura: { type: ['number', 'null'], description: 'Total a pagar da fatura de cartão.' },
      lancamentos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            data: { type: 'string', description: 'AAAA-MM-DD.' },
            descricao: { type: 'string', description: 'Histórico como está no documento.' },
            valor: { type: 'number', description: 'Negativo para saída, positivo para entrada.' },
            tipo: { type: 'string', enum: ['saida', 'entrada'] },
            documento: { type: ['string', 'null'] },
          },
          required: ['data', 'descricao', 'valor', 'tipo'],
        },
      },
    },
    required: ['lancamentos'],
  },
};

function instrucao(tipo) {
  const comum = 'Leia o documento anexado e registre TODOS os lançamentos, na ordem em que '
    + 'aparecem, sem agrupar e sem pular nenhum, inclusive tarifas, impostos e estornos. '
    + 'Datas em AAAA-MM-DD. Valor negativo para dinheiro que saiu, positivo para dinheiro que '
    + 'entrou, e preencha "tipo" de acordo. Não invente linha que não está no documento e não '
    + 'inclua linhas de saldo ou de subtotal como lançamento.';
  return tipo === 'fatura_cartao'
    ? `${comum} Este documento é uma fatura de cartão de crédito: registre cada compra como `
      + `lançamento de saída e preencha total_fatura com o total a pagar da fatura.`
    : `${comum} Este documento é um extrato de conta bancária: preencha saldo_inicial e `
      + `saldo_final quando o extrato mostrar os dois.`;
}

export function montarPedido({ base64, tipo, modelo }) {
  return {
    model: modelo || MODELO_PADRAO,
    max_tokens: 16000,
    // Recusa por política refaz o pedido no modelo de fallback dentro da mesma
    // chamada, em vez de devolver um extrato vazio para o colaborador.
    betas: [BETA_FALLBACK],
    fallbacks: 'default',
    tools: [FERRAMENTA],
    tool_choice: { type: 'tool', name: FERRAMENTA.name },
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text: instrucao(tipo) },
      ],
    }],
  };
}

function normalizar(lidos) {
  const lancamentos = [];
  for (const l of lidos || []) {
    const data = dataIso(l?.data);
    const valor = Number(l?.valor);
    if (!data || !Number.isFinite(valor) || valor === 0) continue;
    const tipo = l?.tipo === 'saida' || l?.tipo === 'entrada'
      ? l.tipo
      : (valor < 0 ? 'saida' : 'entrada');
    lancamentos.push({
      data,
      descricao: String(l?.descricao || '').trim() || 'SEM DESCRIÇÃO',
      valor: Math.abs(valor),
      tipo,
      documento: l?.documento ? String(l.documento) : null,
      fitid: null,
    });
  }
  return lancamentos;
}

// Traduz erro do SDK para uma frase que o colaborador entende. Usa as classes
// tipadas do SDK — nunca comparar texto de mensagem de erro.
function erroLegivel(e) {
  if (e instanceof Anthropic.AuthenticationError) {
    return new Error('A chave da Anthropic foi recusada. Confira ANTHROPIC_API_KEY.');
  }
  if (e instanceof Anthropic.RateLimitError) {
    return new Error('A leitura automática atingiu o limite de uso. Tente de novo em alguns minutos, '
      + 'ou importe o extrato em OFX.');
  }
  if (e instanceof Anthropic.APIError) {
    return new Error(`A leitura do PDF falhou (HTTP ${e.status}). ${String(e.message).slice(0, 200)}`);
  }
  return e;
}

export async function extrairPdf({ base64, tipo, apiKey, modelo, cliente }) {
  const chave = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!cliente && !chave) {
    throw new Error('Configure ANTHROPIC_API_KEY para importar extrato em PDF '
      + '(OFX e CSV funcionam sem ela).');
  }
  const ia = cliente || new Anthropic({ apiKey: chave });

  let resposta;
  try {
    resposta = await ia.beta.messages.create(montarPedido({ base64, tipo, modelo }));
  } catch (e) {
    throw erroLegivel(e);
  }

  if (resposta.stop_reason === 'refusal') {
    throw new Error('A leitura automática deste PDF foi recusada. Importe o extrato em OFX '
      + 'pelo internet banking.');
  }
  if (resposta.stop_reason === 'max_tokens') {
    throw new Error('Este extrato é longo demais para uma leitura só e veio truncado. '
      + 'Exporte um período menor, ou importe em OFX.');
  }

  const ferramenta = (resposta.content || []).find(
    c => c.type === 'tool_use' && c.name === FERRAMENTA.name);
  if (!ferramenta?.input) {
    throw new Error('Não consegui ler o PDF: a leitura não devolveu os lançamentos. '
      + 'Tente exportar o extrato em OFX no internet banking.');
  }

  const dados = ferramenta.input;
  const lancamentos = normalizar(dados.lancamentos);
  if (!lancamentos.length) {
    throw new Error('Não achei nenhum lançamento neste PDF — confira se é mesmo o extrato '
      + 'ou a fatura do período.');
  }

  const numeroOuNulo = v => (Number.isFinite(Number(v)) ? Number(v) : null);
  const datas = lancamentos.map(l => l.data).sort();
  return {
    periodoInicio: dataIso(dados.periodo_inicio) || datas[0],
    periodoFim: dataIso(dados.periodo_fim) || datas[datas.length - 1],
    saldoInicial: numeroOuNulo(dados.saldo_inicial),
    saldoFinal: numeroOuNulo(dados.saldo_final),
    total: numeroOuNulo(dados.total_fatura),
    lancamentos,
  };
}
```

- [ ] **Step 5: Rodar e confirmar que passa**

```bash
npm test 2>&1 | tail -20
```

Nenhum teste chama a API de verdade — todos injetam `cliente`.

- [ ] **Step 6: Commit**

```bash
git add lib/extratos/extrairPdf.js tests/extratos-extrair-pdf.test.mjs package.json package-lock.json
git commit -m "feat(financeiro): extração de extrato em PDF pela Claude API"
```

---

### Task 8: Rota de importação

**Files:**
- Create: `lib/extratosServer.js`
- Create: `app/api/financeiro/extratos/upload/route.js`
- Modify: `lib/storage.js` (acrescentar `signedUrlExtrato` no fim)

**Interfaces:**
- Consumes: tudo das tasks 1 a 7.
- Produces:
  - `processarImportacao({ sb, empresaId, contaBancariaId, tipo, arquivoNome, buffer }) -> { importacaoId, total, novas, duplicadas, sugeridas, alerta }`
  - `POST /api/financeiro/extratos/upload` (multipart: `arquivo`, `empresaId`, `contaBancariaId`, `tipo`) devolvendo o mesmo objeto, ou `{ error }` com status 400/401/403/500.
  - `signedUrlExtrato(path, segundos = 300) -> string` (usado pela Task 11).

- [ ] **Step 1: Acrescentar o helper de Storage**

No fim de `lib/storage.js`:

```js
// ---------- FINANCEIRO: arquivos de extrato e fatura ----------
// O upload é feito pela rota (service role), não pelo browser — aqui só a
// leitura, para a tela abrir o arquivo importado.
export async function signedUrlExtrato(path, segundos = 300) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, segundos);
  if (error) throw error;
  return data.signedUrl;
}
```

- [ ] **Step 2: Escrever `lib/extratosServer.js`**

```js
// Orquestra a importação de um extrato ou fatura: escolhe o parser, confere a
// aritmética, sobe o arquivo, grava os lançamentos com dedupe e já pré-associa
// o que o aprendizado permite. Só as rotas importam este arquivo — ele usa
// service role.
import crypto from 'node:crypto';
import { parseOfx } from './extratos/parseOfx.js';
import { parseCsv } from './extratos/parseCsv.js';
import { extrairPdf } from './extratos/extrairPdf.js';
import { validarExtrato, validarFatura } from './extratos/validar.js';
import { normalizarDescricao } from './extratos/normalizar.js';
import { hashDedupe } from './extratos/dedupe.js';
import { escolherSugestao } from './extratos/matching.js';

const BUCKET = 'recebimentos';

export function formatoDoArquivo(nome) {
  const ext = String(nome || '').toLowerCase().split('.').pop();
  if (ext === 'ofx') return 'ofx';
  if (ext === 'csv' || ext === 'txt') return 'csv';
  if (ext === 'pdf') return 'pdf';
  throw new Error('Formato não aceito. Envie o extrato em PDF, OFX ou CSV.');
}

async function lerArquivo({ formato, buffer, tipo }) {
  if (formato === 'ofx') return parseOfx(buffer.toString('latin1'));
  if (formato === 'pdf') {
    return extrairPdf({
      base64: buffer.toString('base64'), tipo,
      apiKey: process.env.ANTHROPIC_API_KEY, modelo: process.env.EXTRATO_IA_MODELO,
    });
  }
  // CSV reconhecido sai de graça. Layout estranho não é adivinhado nem mandado
  // para a IA (o caminho da IA manda um bloco `document` de PDF, e CSV não
  // entra nele): recusa com instrução, que é honesto e não gera lançamento
  // errado no financeiro.
  const lido = parseCsv(buffer.toString('utf8'));
  if (!lido.reconhecido) {
    throw new Error('Não reconheci as colunas deste CSV. Exporte em OFX, ou envie o extrato '
      + 'em PDF — nesse formato a leitura é automática.');
  }
  return lido;
}

// Parcelas pendentes achatadas no shape que o motor de sugestão espera.
async function parcelasPendentes(sb, empresaId) {
  const { data, error } = await sb.from('contas_a_pagar_parcelas')
    .select('id, valor, vencimento, contas_a_pagar!inner(fornecedor_id)')
    .eq('empresa_id', empresaId).eq('status', 'Pendente');
  if (error) throw new Error('Não consegui ler as parcelas em aberto: ' + error.message);
  return (data || []).map(p => ({
    id: p.id, valor: Number(p.valor), vencimento: p.vencimento,
    fornecedorId: p.contas_a_pagar?.fornecedor_id || null,
  }));
}

async function mapaDePadroes(sb, empresaId) {
  const { data } = await sb.from('conciliacao_padroes')
    .select('id, padrao, fornecedor_id, categoria_conta').eq('empresa_id', empresaId);
  const mapa = new Map();
  for (const p of data || []) {
    mapa.set(p.padrao, { id: p.id, fornecedorId: p.fornecedor_id, categoriaConta: p.categoria_conta });
  }
  return mapa;
}

export async function processarImportacao({ sb, empresaId, contaBancariaId, tipo, arquivoNome, buffer }) {
  const formato = formatoDoArquivo(arquivoNome);
  const importacaoId = crypto.randomUUID();
  const caminho = `${empresaId}/extratos/${importacaoId}/${formato === 'pdf' ? 'arquivo.pdf' : `arquivo.${formato}`}`;

  const { data: conta, error: erroConta } = await sb.from('contas_bancarias')
    .select('id, empresa_id, tipo').eq('id', contaBancariaId).maybeSingle();
  if (erroConta || !conta) throw new Error('Conta bancária não encontrada.');
  if (conta.empresa_id !== empresaId) throw new Error('Conta bancária de outra empresa.');
  if (tipo === 'fatura_cartao' && conta.tipo !== 'cartao_credito') {
    throw new Error('Fatura só pode ser importada contra uma conta de cartão de crédito.');
  }

  const contentType = formato === 'pdf' ? 'application/pdf'
    : (formato === 'csv' ? 'text/csv' : 'application/x-ofx');
  const { error: erroUpload } = await sb.storage.from(BUCKET)
    .upload(caminho, buffer, { contentType, upsert: false });
  if (erroUpload) throw new Error('Não consegui guardar o arquivo: ' + erroUpload.message);

  const { error: erroImportacao } = await sb.from('extrato_importacoes').insert([{
    id: importacaoId, empresa_id: empresaId, conta_bancaria_id: contaBancariaId,
    tipo, arquivo_path: caminho, arquivo_nome: arquivoNome, formato, status: 'processando',
  }]);
  if (erroImportacao) throw new Error('Não consegui registrar a importação: ' + erroImportacao.message);

  try {
    const lido = await lerArquivo({ formato, buffer, tipo });
    const conferencia = tipo === 'fatura_cartao'
      ? validarFatura({ total: lido.total, lancamentos: lido.lancamentos })
      : validarExtrato(lido);

    const parcelas = await parcelasPendentes(sb, empresaId);
    const padroes = await mapaDePadroes(sb, empresaId);
    const jaSugeridas = new Set();

    const linhas = lido.lancamentos.map(l => {
      const descricaoNormalizada = normalizarDescricao(l.descricao);
      const padrao = padroes.get(descricaoNormalizada) || null;
      let status = l.tipo === 'entrada' ? 'ignorado' : 'pendente';
      let parcelaSugeridaId = null;

      if (l.tipo === 'saida') {
        const livres = parcelas.filter(p => !jaSugeridas.has(p.id));
        const sugestao = escolherSugestao(l, livres, padrao);
        if (sugestao) {
          parcelaSugeridaId = sugestao.parcelaId;
          jaSugeridas.add(sugestao.parcelaId);
          status = 'sugerido';
        }
      }

      return {
        importacao_id: importacaoId, empresa_id: empresaId,
        data: l.data, descricao: l.descricao, descricao_normalizada: descricaoNormalizada,
        valor: l.valor, tipo: l.tipo, documento: l.documento, status,
        parcela_sugerida_id: parcelaSugeridaId, padrao_id: padrao?.id || null,
        hash_dedupe: hashDedupe({
          contaBancariaId, data: l.data, valor: l.valor,
          descricaoNormalizada, fitid: l.fitid,
        }),
      };
    });

    // ignoreDuplicates: reimportar o mesmo período não duplica nem trava.
    const { data: inseridas, error: erroLinhas } = await sb.from('extrato_lancamentos')
      .upsert(linhas, { onConflict: 'empresa_id,hash_dedupe', ignoreDuplicates: true })
      .select('id, status');
    if (erroLinhas) throw new Error('Não consegui gravar os lançamentos: ' + erroLinhas.message);

    const novas = inseridas?.length || 0;
    const sugeridas = (inseridas || []).filter(l => l.status === 'sugerido').length;

    await sb.from('extrato_importacoes').update({
      periodo_inicio: lido.periodoInicio, periodo_fim: lido.periodoFim,
      alerta: conferencia.alerta, status: 'aguardando_conciliacao',
    }).eq('id', importacaoId);
    await sb.rpc('fn_recalcular_importacao', { p_importacao_id: importacaoId });

    return {
      importacaoId, total: linhas.length, novas, duplicadas: linhas.length - novas,
      sugeridas, alerta: conferencia.alerta,
    };
  } catch (e) {
    // Deixa a importação registrada com o erro (a tela explica o que houve),
    // mas limpa as linhas parciais para o dedupe não travar a nova tentativa.
    await sb.from('extrato_lancamentos').delete().eq('importacao_id', importacaoId);
    await sb.from('extrato_importacoes')
      .update({ status: 'erro', erro: String(e.message).slice(0, 500) }).eq('id', importacaoId);
    throw e;
  }
}
```

- [ ] **Step 3: Escrever a rota**

Cria `app/api/financeiro/extratos/upload/route.js`:

```js
import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../../../lib/pontoServer';
import { garantirEmpresa } from '../../../../../lib/nfe/autorizacao';
import { processarImportacao } from '../../../../../lib/extratosServer';

export const runtime = 'nodejs';
export const maxDuration = 300; // PDF grande passa por leitura de IA

const LIMITE = 10 * 1024 * 1024; // teto do bucket 'recebimentos'
const TIPOS = ['extrato', 'fatura_cartao'];

// POST multipart: arquivo, empresaId, contaBancariaId, tipo
export async function POST(request) {
  const { sb, user, isAdmin, erro } = await autorizarModulo(request, 'financeiro');
  if (erro) return erro;

  let form;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Envio inválido: use o botão de importar da tela.' }, { status: 400 });
  }

  const empresaId = form.get('empresaId');
  const contaBancariaId = form.get('contaBancariaId');
  const tipo = form.get('tipo');
  const arquivo = form.get('arquivo');

  try {
    await garantirEmpresa(sb, user, isAdmin, empresaId);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 403 });
  }
  if (!contaBancariaId) return NextResponse.json({ error: 'Escolha a conta bancária.' }, { status: 400 });
  if (!TIPOS.includes(tipo)) return NextResponse.json({ error: 'Tipo inválido.' }, { status: 400 });
  if (!arquivo || typeof arquivo.arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'Anexe o arquivo do extrato.' }, { status: 400 });
  }
  if (arquivo.size > LIMITE) {
    return NextResponse.json({ error: 'Arquivo acima de 10 MB. Exporte um período menor.' }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await arquivo.arrayBuffer());
    const resumo = await processarImportacao({
      sb, empresaId, contaBancariaId, tipo, arquivoNome: arquivo.name || 'extrato', buffer,
    });
    return NextResponse.json(resumo);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
```

- [ ] **Step 4: Conferir que a suíte e o build seguem de pé**

```bash
npm run verify 2>&1 | tail -20
```

Esperado: testes verdes e `next build` sem erro. O build é o que prova que os caminhos relativos de `import` da rota (cinco níveis) estão certos.

- [ ] **Step 5: Commit**

```bash
git add lib/extratosServer.js app/api/financeiro/extratos/upload/route.js lib/storage.js
git commit -m "feat(financeiro): rota de importação de extrato com dedupe e pré-associação"
```

---

### Task 9: Rotas de conciliação

**Files:**
- Create: `app/api/financeiro/conciliacao/route.js`

**Interfaces:**
- Consumes: funções SQL da Task 2, `inferirFormaPagamento` da Task 4.
- Produces: `POST /api/financeiro/conciliacao` com `{ acao, ... }`:
  - `confirmar`: `{ lancamentoId, parcelas: [{ parcelaId, valorAplicado }], fornecedorId, categoriaConta }` → `{ ok, vinculadas, baixadas }`
  - `confirmar-lote`: `{ lancamentoIds: [...] }` → `{ ok, confirmados, falhas: [{ lancamentoId, erro }] }`
  - `criar-conta`: `{ lancamentoId, descricao, categoriaConta, fornecedorId, responsavelId }` → `{ ok, contaId, parcelaId }`
  - `desfazer`: `{ lancamentoId }` → `{ ok, reabertas }`
  - `pagar-fatura`: `{ lancamentoId, faturaId, forcar }` → `{ ok, baixadas, somaFatura }`

- [ ] **Step 1: Escrever a rota**

```js
import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../../lib/pontoServer';
import { garantirEmpresa } from '../../../../lib/nfe/autorizacao';
import { inferirFormaPagamento } from '../../../../lib/extratos/matching';

export const runtime = 'nodejs';

// Carrega o lançamento e confere que quem chama tem acesso à empresa dele.
// Service role passa por cima do RLS, então esta conferência é a única que
// existe — sem ela, um id de outra empresa seria conciliado sem barreira.
async function carregarLancamento(sb, user, isAdmin, lancamentoId) {
  if (!lancamentoId) throw new Error('Informe o lançamento.');
  const { data: lanc } = await sb.from('extrato_lancamentos')
    .select('id, empresa_id, descricao, importacao_id, parcela_sugerida_id, valor, '
      + 'padrao_id, extrato_importacoes!inner(tipo)')
    .eq('id', lancamentoId).maybeSingle();
  if (!lanc) throw new Error('Lançamento não encontrado.');
  await garantirEmpresa(sb, user, isAdmin, lanc.empresa_id);
  return lanc;
}

// Linha de fatura de cartão sempre nasce como Cartão de Crédito; no extrato
// bancário a forma sai do texto do próprio lançamento.
function formaPara(lanc) {
  return lanc.extrato_importacoes?.tipo === 'fatura_cartao'
    ? 'Cartão de Crédito'
    : inferirFormaPagamento(lanc.descricao);
}

async function confirmar(sb, user, isAdmin, corpo) {
  const lanc = await carregarLancamento(sb, user, isAdmin, corpo.lancamentoId);
  const parcelas = (corpo.parcelas || []).map(p => ({
    parcela_id: p.parcelaId, valor_aplicado: p.valorAplicado ?? null,
  }));
  if (!parcelas.length) throw new Error('Escolha a parcela que este lançamento pagou.');
  const { data, error } = await sb.rpc('fn_conciliar_lancamento', {
    p_lancamento_id: lanc.id,
    p_parcelas: parcelas,
    p_forma_pagamento: formaPara(lanc),
    p_fornecedor_id: corpo.fornecedorId || null,
    p_categoria_conta: corpo.categoriaConta || null,
  });
  if (error) throw new Error(error.message);
  return { ok: true, vinculadas: data?.vinculadas ?? 0, baixadas: data?.baixadas ?? 0 };
}

// Lote: confirma cada sugestão como o colaborador confirmaria uma por uma.
// Uma falha não derruba as outras — a tela mostra quais ficaram de fora.
async function confirmarLote(sb, user, isAdmin, corpo) {
  const ids = corpo.lancamentoIds || [];
  if (!ids.length) throw new Error('Nenhuma sugestão selecionada.');
  let confirmados = 0;
  const falhas = [];
  for (const id of ids) {
    try {
      const lanc = await carregarLancamento(sb, user, isAdmin, id);
      if (!lanc.parcela_sugerida_id) throw new Error('Este lançamento não tem sugestão.');
      const { data: padrao } = lanc.padrao_id
        ? await sb.from('conciliacao_padroes').select('fornecedor_id, categoria_conta')
            .eq('id', lanc.padrao_id).maybeSingle()
        : { data: null };
      const { error } = await sb.rpc('fn_conciliar_lancamento', {
        p_lancamento_id: lanc.id,
        p_parcelas: [{ parcela_id: lanc.parcela_sugerida_id, valor_aplicado: lanc.valor }],
        p_forma_pagamento: formaPara(lanc),
        p_fornecedor_id: padrao?.fornecedor_id || null,
        p_categoria_conta: padrao?.categoria_conta || null,
      });
      if (error) throw new Error(error.message);
      confirmados++;
    } catch (e) {
      falhas.push({ lancamentoId: id, erro: e.message });
    }
  }
  return { ok: true, confirmados, falhas };
}

async function criarConta(sb, user, isAdmin, corpo) {
  const lanc = await carregarLancamento(sb, user, isAdmin, corpo.lancamentoId);
  if (!corpo.fornecedorId) throw new Error('Escolha o fornecedor.');
  if (!corpo.categoriaConta) throw new Error('Escolha a categoria da conta.');
  const { data, error } = await sb.rpc('fn_criar_conta_e_conciliar', {
    p_lancamento_id: lanc.id,
    p_descricao: corpo.descricao || null,
    p_categoria_conta: corpo.categoriaConta,
    p_fornecedor_id: corpo.fornecedorId,
    p_responsavel_id: corpo.responsavelId || null,
    p_forma_pagamento: formaPara(lanc),
  });
  if (error) throw new Error(error.message);
  return { ok: true, contaId: data?.conta_id, parcelaId: data?.parcela_id };
}

async function desfazer(sb, user, isAdmin, corpo) {
  const lanc = await carregarLancamento(sb, user, isAdmin, corpo.lancamentoId);
  const { data, error } = await sb.rpc('fn_desfazer_conciliacao', { p_lancamento_id: lanc.id });
  if (error) throw new Error(error.message);
  return { ok: true, reabertas: data?.reabertas ?? 0 };
}

async function pagarFatura(sb, user, isAdmin, corpo) {
  const lanc = await carregarLancamento(sb, user, isAdmin, corpo.lancamentoId);
  if (!corpo.faturaId) throw new Error('Escolha a fatura que este débito pagou.');
  const { data, error } = await sb.rpc('fn_conciliar_pagamento_fatura', {
    p_lancamento_id: lanc.id, p_fatura_id: corpo.faturaId, p_forcar: !!corpo.forcar,
  });
  if (error) throw new Error(error.message);
  return { ok: true, baixadas: data?.baixadas ?? 0, somaFatura: data?.soma_fatura ?? null };
}

const ACOES = {
  confirmar, 'confirmar-lote': confirmarLote, 'criar-conta': criarConta,
  desfazer, 'pagar-fatura': pagarFatura,
};

export async function POST(request) {
  const { sb, user, isAdmin, erro } = await autorizarModulo(request, 'financeiro');
  if (erro) return erro;

  let corpo;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ error: 'Requisição inválida.' }, { status: 400 });
  }

  const executar = ACOES[corpo?.acao];
  if (!executar) return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });

  try {
    return NextResponse.json(await executar(sb, user, isAdmin, corpo));
  } catch (e) {
    const status = /Sem acesso|outra empresa/i.test(e.message) ? 403 : 400;
    return NextResponse.json({ error: e.message }, { status });
  }
}
```

- [ ] **Step 2: Conferir build e suíte**

```bash
npm run verify 2>&1 | tail -20
```

- [ ] **Step 3: Commit**

```bash
git add app/api/financeiro/conciliacao/route.js
git commit -m "feat(financeiro): rotas de conciliação, criação de conta e pagamento de fatura"
```

---

### Task 10: Cadastro de contas bancárias

**Files:**
- Create: `app/financeiro/contas-bancarias/page.js`
- Modify: `lib/menu.js` (o item `financeiro` deixa de ser link e vira grupo com três itens)

**Interfaces:**
- Consumes: tabela `contas_bancarias` (Task 1).
- Produces: a tela onde as contas dos seis bancos e os cartões são cadastrados — pré-requisito da Task 11 (sem conta cadastrada não há o que importar).

- [ ] **Step 1: Transformar o item de menu em grupo**

Em `lib/menu.js`, trocar a linha 37 por:

```js
  {
    tipo: 'grupo', id: 'financeiro', label: 'Financeiro', ic: '◈', itens: [
      { label: 'Contas a Pagar', href: '/financeiro/contas-a-pagar', modulo: 'financeiro' },
      { label: 'Conciliação Bancária', href: '/financeiro/conciliacao', modulo: 'financeiro' },
      { label: 'Contas Bancárias', href: '/financeiro/contas-bancarias', modulo: 'financeiro' },
    ],
  },
```

- [ ] **Step 2: Escrever a página**

Cria `app/financeiro/contas-bancarias/page.js`:

```js
'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import AppShell from '../../../components/AppShell';
import { useEmpresaAtual } from '../../../lib/empresa';

const INSTITUICOES = ['Sicoob', 'Cresol', 'Sicredi', 'Banco do Brasil', 'Santander', 'Bradesco'];

const VAZIO = () => ({
  nome: '', instituicao: INSTITUICOES[0], tipo: 'conta_corrente', agencia: '', numero_conta: '',
});

export default function ContasBancariasPage() {
  return (
    <AppShell modulo="financeiro" titulo="Contas Bancárias"
      desc="Contas e cartões usados na conciliação dos extratos">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const { empresaAtual } = useEmpresaAtual();
  const [lista, setLista] = useState([]);
  const [form, setForm] = useState(VAZIO());
  const [salvando, setSalvando] = useState(false);
  const [loading, setLoading] = useState(true);

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    const { data, error } = await supabase.from('contas_bancarias').select('*')
      .eq('empresa_id', empresaAtual.id).order('nome');
    if (error) console.error(error);
    setLista(data || []);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  async function salvar(e) {
    e.preventDefault();
    if (!form.nome.trim()) { alert('Dê um nome para a conta (ex.: Sicoob principal).'); return; }
    setSalvando(true);
    const { error } = await supabase.from('contas_bancarias').insert([{
      empresa_id: empresaAtual.id,
      nome: form.nome.trim(),
      instituicao: form.instituicao,
      tipo: form.tipo,
      agencia: form.agencia.trim() || null,
      numero_conta: form.numero_conta.trim() || null,
    }]);
    setSalvando(false);
    if (error) { alert('Não consegui salvar: ' + error.message); return; }
    setForm(VAZIO());
    carregar();
  }

  async function alternarAtivo(conta) {
    const { error } = await supabase.from('contas_bancarias')
      .update({ ativo: !conta.ativo }).eq('id', conta.id);
    if (error) { alert('Não consegui atualizar: ' + error.message); return; }
    carregar();
  }

  return (
    <>
      <div className="panel">
        <strong>Nova conta</strong>
        <form className="form-grid" onSubmit={salvar} style={{ marginTop: 10 }}>
          <div>
            <label>Nome</label>
            <input value={form.nome} placeholder="Sicoob principal"
              onChange={e => setForm({ ...form, nome: e.target.value })} />
          </div>
          <div>
            <label>Instituição</label>
            <select value={form.instituicao}
              onChange={e => setForm({ ...form, instituicao: e.target.value })}>
              {INSTITUICOES.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>
          <div>
            <label>Tipo</label>
            <select value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })}>
              <option value="conta_corrente">Conta corrente</option>
              <option value="cartao_credito">Cartão de crédito</option>
            </select>
          </div>
          <div>
            <label>Agência</label>
            <input value={form.agencia} onChange={e => setForm({ ...form, agencia: e.target.value })} />
          </div>
          <div>
            <label>{form.tipo === 'cartao_credito' ? 'Final do cartão' : 'Número da conta'}</label>
            <input value={form.numero_conta}
              onChange={e => setForm({ ...form, numero_conta: e.target.value })} />
          </div>
          <div style={{ alignSelf: 'end' }}>
            <button className="btn" disabled={salvando}>{salvando ? 'Salvando…' : 'Cadastrar'}</button>
          </div>
        </form>
      </div>

      <div className="panel">
        <strong>Contas cadastradas</strong>
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table>
            <thead>
              <tr>
                <th>Nome</th><th>Instituição</th><th>Tipo</th><th>Agência</th>
                <th>Conta / cartão</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr className="empty-row"><td colSpan={7}>Carregando…</td></tr>}
              {!loading && !lista.length && (
                <tr className="empty-row"><td colSpan={7}>
                  Nenhuma conta cadastrada. Comece pelas contas dos bancos que você usa.
                </td></tr>
              )}
              {lista.map(c => (
                <tr key={c.id}>
                  <td>{c.nome}</td>
                  <td>{c.instituicao}</td>
                  <td>{c.tipo === 'cartao_credito' ? 'Cartão de crédito' : 'Conta corrente'}</td>
                  <td>{c.agencia || '—'}</td>
                  <td>{c.numero_conta || '—'}</td>
                  <td><span className={'tag ' + (c.ativo ? 'ok' : 'bad')}>
                    {c.ativo ? 'Ativa' : 'Inativa'}
                  </span></td>
                  <td className="row-actions">
                    <button className="btn secondary small" onClick={() => alternarAtivo(c)}>
                      {c.ativo ? 'Desativar' : 'Reativar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 3: Verificar no navegador**

Subir o dev server pelo Browser pane (`.claude/launch.json`, entrada `dev`) e abrir `/financeiro/contas-bancarias`. Conferir com `read_page` que o formulário e a tabela aparecem, cadastrar uma conta de teste, e conferir com `read_console_messages` que não há erro. **A migração 35 precisa estar aplicada no banco que o `.env.local` aponta** — se ainda não estiver, a tela mostra erro do PostgREST (`relation "contas_bancarias" does not exist`) e o teste real fica para a Task 14.

- [ ] **Step 4: Commit**

```bash
git add app/financeiro/contas-bancarias/page.js lib/menu.js
git commit -m "feat(financeiro): cadastro de contas bancárias e cartões"
```

---

### Task 11: Tela de conciliação — importar e listar

**Files:**
- Create: `lib/extratos/cliente.js`
- Create: `components/ImportarExtrato.js`
- Create: `app/financeiro/conciliacao/page.js`

**Interfaces:**
- Consumes: rota da Task 8, `signedUrlExtrato` (Task 8), tabelas da Task 1.
- Produces:
  - `chamarApi(url, opcoes) -> Response` e `enviarArquivo(url, formData) -> Response` (com Bearer da sessão)
  - `<ImportarExtrato empresaId contas onImportado />`
  - A página com o estado `importacaoSelecionada` e a lista de lançamentos. As tasks 12 e 13 penduram ações nas linhas — a assinatura que elas consomem é: cada linha recebe `lancamento` (registro de `extrato_lancamentos` com `parcela_sugerida:contas_a_pagar_parcelas(...)` embutido) e um callback `onMudou()` que recarrega a lista.

- [ ] **Step 1: Escrever o cliente HTTP**

Cria `lib/extratos/cliente.js`:

```js
'use client';
// As rotas do financeiro usam service role e exigem o token da sessão no
// header. Mesmo padrão do comToken de components/ImportarNota.js, extraído
// aqui porque agora são três telas chamando.
import { supabase } from '../supabase';

async function token() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sua sessão expirou. Saia e entre novamente.');
  return session.access_token;
}

export async function chamarApi(url, opcoes = {}) {
  return fetch(url, {
    ...opcoes,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await token()}`,
      ...(opcoes.headers || {}),
    },
  });
}

// FormData define o próprio Content-Type (com o boundary) — não sobrescrever.
export async function enviarArquivo(url, formData) {
  return fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token()}` },
    body: formData,
  });
}
```

- [ ] **Step 2: Escrever o componente de importação**

Cria `components/ImportarExtrato.js`:

```js
'use client';
import { useState } from 'react';
import { enviarArquivo } from '../lib/extratos/cliente';

// Bloco no topo da conciliação. Aceita PDF, OFX e CSV: OFX é o mais confiável
// (vem estruturado do banco), PDF é o que o colaborador tem na mão e passa
// por leitura automática, que leva alguns segundos.
export default function ImportarExtrato({ empresaId, contas, onImportado }) {
  const [contaId, setContaId] = useState('');
  const [tipo, setTipo] = useState('extrato');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');

  const contasDoTipo = (contas || []).filter(c => c.ativo !== false
    && (tipo === 'fatura_cartao' ? c.tipo === 'cartao_credito' : c.tipo === 'conta_corrente'));

  async function enviar(file) {
    if (!file) return;
    if (!contaId) { setErro('Escolha a conta antes de enviar o arquivo.'); return; }
    setErro('');
    setOcupado(true);
    try {
      const form = new FormData();
      form.append('arquivo', file);
      form.append('empresaId', empresaId);
      form.append('contaBancariaId', contaId);
      form.append('tipo', tipo);
      const r = await enviarArquivo('/api/financeiro/extratos/upload', form);
      const j = await r.json();
      if (!r.ok) { setErro(j.error || 'Não foi possível importar o arquivo.'); return; }
      onImportado(j);
    } catch (e) {
      setErro('Falha ao importar: ' + e.message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="panel">
      <strong>Importar extrato ou fatura</strong>
      <p className="muted" style={{ margin: '4px 0 10px' }}>
        PDF, OFX ou CSV. O OFX do internet banking é o mais confiável; o PDF passa por
        leitura automática e leva alguns segundos.
      </p>
      <div className="form-grid">
        <div>
          <label>Documento</label>
          <select value={tipo} disabled={ocupado}
            onChange={e => { setTipo(e.target.value); setContaId(''); }}>
            <option value="extrato">Extrato bancário</option>
            <option value="fatura_cartao">Fatura de cartão</option>
          </select>
        </div>
        <div>
          <label>Conta</label>
          <select value={contaId} disabled={ocupado} onChange={e => setContaId(e.target.value)}>
            <option value="">Escolha…</option>
            {contasDoTipo.map(c => <option key={c.id} value={c.id}>{c.nome} — {c.instituicao}</option>)}
          </select>
        </div>
        <div style={{ alignSelf: 'end' }}>
          <label className="btn">
            {ocupado ? 'Lendo o arquivo…' : 'Enviar arquivo'}
            <input type="file" accept=".pdf,.ofx,.csv,.txt,application/pdf" style={{ display: 'none' }}
              disabled={ocupado}
              onChange={e => { enviar(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        </div>
      </div>
      {!contasDoTipo.length && (
        <p className="muted" style={{ marginTop: 8 }}>
          Nenhuma conta {tipo === 'fatura_cartao' ? 'de cartão' : 'corrente'} cadastrada — cadastre
          em Financeiro › Contas Bancárias.
        </p>
      )}
      {erro && <p style={{ color: 'var(--bad, #c0392b)', marginTop: 8 }}>{erro}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Escrever a página**

Cria `app/financeiro/conciliacao/page.js`:

```js
'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { fmtMoney, fmtDate } from '../../../lib/format';
import { signedUrlExtrato } from '../../../lib/storage';
import AppShell from '../../../components/AppShell';
import ImportarExtrato from '../../../components/ImportarExtrato';
import { useEmpresaAtual } from '../../../lib/empresa';

const TAG_IMPORTACAO = {
  processando: 'warn', aguardando_conciliacao: 'warn', concluida: 'ok', erro: 'bad',
};
const ROTULO_IMPORTACAO = {
  processando: 'Processando', aguardando_conciliacao: 'A conciliar',
  concluida: 'Conciliada', erro: 'Erro',
};
const TAG_LANCAMENTO = { pendente: 'warn', sugerido: 'warn', conciliado: 'ok', ignorado: '' };
const ROTULO_LANCAMENTO = {
  pendente: 'Sem correspondência', sugerido: 'Sugerido', conciliado: 'Conciliado', ignorado: 'Entrada',
};

export default function ConciliacaoPage() {
  return (
    <AppShell modulo="financeiro" titulo="Conciliação Bancária"
      desc="Extratos e faturas importados, e a associação com o contas a pagar">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const { empresaAtual } = useEmpresaAtual();
  const [contas, setContas] = useState([]);
  const [importacoes, setImportacoes] = useState([]);
  const [selecionada, setSelecionada] = useState(null);
  const [lancamentos, setLancamentos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtroStatus, setFiltroStatus] = useState('');
  const [mostrarEntradas, setMostrarEntradas] = useState(false);

  async function carregarBase() {
    if (!empresaAtual) return;
    setLoading(true);
    const [r1, r2] = await Promise.all([
      supabase.from('contas_bancarias').select('*').eq('empresa_id', empresaAtual.id).order('nome'),
      supabase.from('extrato_importacoes')
        .select('*, contas_bancarias(nome, instituicao, tipo)')
        .eq('empresa_id', empresaAtual.id).order('created_at', { ascending: false }).limit(30),
    ]);
    if (r2.error) console.error(r2.error);
    setContas(r1.data || []);
    setImportacoes(r2.data || []);
    setLoading(false);
    return r2.data || [];
  }

  async function carregarLancamentos(importacaoId) {
    if (!importacaoId) { setLancamentos([]); return; }
    const { data, error } = await supabase.from('extrato_lancamentos')
      .select('*, parcela_sugerida:contas_a_pagar_parcelas!parcela_sugerida_id('
        + 'id, valor, vencimento, contas_a_pagar(descricao, fornecedores(nome)))')
      .eq('importacao_id', importacaoId).order('data');
    if (error) console.error(error);
    setLancamentos(data || []);
  }

  useEffect(() => { carregarBase(); }, [empresaAtual?.id]);
  useEffect(() => { carregarLancamentos(selecionada?.id); }, [selecionada?.id]);

  // Depois de qualquer ação de conciliação: a lista e os contadores mudam juntos.
  async function recarregar() {
    const lista = await carregarBase();
    if (selecionada) {
      setSelecionada(lista.find(i => i.id === selecionada.id) || null);
      await carregarLancamentos(selecionada.id);
    }
  }

  async function abrirArquivo(path) {
    try {
      window.open(await signedUrlExtrato(path), '_blank', 'noopener,noreferrer');
    } catch (e) {
      alert('Não consegui abrir o arquivo: ' + e.message);
    }
  }

  async function aposImportar(resumo) {
    const lista = await carregarBase();
    setSelecionada(lista.find(i => i.id === resumo.importacaoId) || null);
    const partes = [`${resumo.novas} lançamento(s) importado(s)`];
    if (resumo.duplicadas) partes.push(`${resumo.duplicadas} já estavam no sistema`);
    if (resumo.sugeridas) partes.push(`${resumo.sugeridas} já vieram com sugestão`);
    alert(partes.join(', ') + '.' + (resumo.alerta ? `\n\nAtenção: ${resumo.alerta}` : ''));
  }

  const visiveis = lancamentos.filter(l => {
    if (!mostrarEntradas && l.tipo === 'entrada') return false;
    if (filtroStatus && l.status !== filtroStatus) return false;
    return true;
  });

  return (
    <>
      <ImportarExtrato empresaId={empresaAtual?.id} contas={contas} onImportado={aposImportar} />

      <div className="panel">
        <strong>Importações recentes</strong>
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table>
            <thead>
              <tr>
                <th>Conta</th><th>Documento</th><th>Período</th><th>Formato</th>
                <th>Conciliados</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr className="empty-row"><td colSpan={7}>Carregando…</td></tr>}
              {!loading && !importacoes.length && (
                <tr className="empty-row"><td colSpan={7}>
                  Nenhum extrato importado ainda. Envie o primeiro arquivo acima.
                </td></tr>
              )}
              {importacoes.map(i => (
                <tr key={i.id} style={selecionada?.id === i.id
                  ? { outline: '1px solid var(--amber)' } : undefined}>
                  <td>{i.contas_bancarias?.nome || '—'}</td>
                  <td>{i.tipo === 'fatura_cartao' ? 'Fatura' : 'Extrato'}</td>
                  <td>{i.periodo_inicio ? `${fmtDate(i.periodo_inicio)} a ${fmtDate(i.periodo_fim)}` : '—'}</td>
                  <td>{String(i.formato).toUpperCase()}</td>
                  <td className="num">{i.conciliados}/{i.total_lancamentos}</td>
                  <td>
                    <span className={'tag ' + (TAG_IMPORTACAO[i.status] || '')}>
                      {ROTULO_IMPORTACAO[i.status] || i.status}
                    </span>
                  </td>
                  <td className="row-actions">
                    <button className="btn small" onClick={() => setSelecionada(i)}>Abrir</button>
                    <button className="btn secondary small" onClick={() => abrirArquivo(i.arquivo_path)}>
                      Arquivo
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {importacoes.some(i => i.alerta) && importacoes.filter(i => i.alerta).map(i => (
          <div className="banner" key={i.id} style={{ marginTop: 10 }}>{i.alerta}</div>
        ))}
        {importacoes.some(i => i.status === 'erro') && importacoes.filter(i => i.status === 'erro').map(i => (
          <div className="banner" key={'e' + i.id} style={{ marginTop: 10 }}>
            {i.arquivo_nome}: {i.erro}
          </div>
        ))}
      </div>

      {selecionada && (
        <div className="panel">
          <strong>Lançamentos — {selecionada.contas_bancarias?.nome}</strong>
          <div className="filter-bar" style={{ marginTop: 10 }}>
            <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}>
              <option value="">Todos os status</option>
              <option value="pendente">Sem correspondência</option>
              <option value="sugerido">Sugeridos</option>
              <option value="conciliado">Conciliados</option>
            </select>
            <label className="check-line">
              <input type="checkbox" checked={mostrarEntradas}
                onChange={e => setMostrarEntradas(e.target.checked)} />
              Mostrar entradas (não conciliadas nesta fase)
            </label>
          </div>
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table>
              <thead>
                <tr><th>Data</th><th>Descrição</th><th>Valor</th><th>Status</th><th>Ação</th></tr>
              </thead>
              <tbody>
                {!visiveis.length && (
                  <tr className="empty-row"><td colSpan={5}>Nenhum lançamento com esse filtro.</td></tr>
                )}
                {visiveis.map(l => (
                  <tr key={l.id}>
                    <td>{fmtDate(l.data)}</td>
                    <td>{l.descricao}</td>
                    <td className="num">{fmtMoney(l.valor)}</td>
                    <td>
                      <span className={'tag ' + (TAG_LANCAMENTO[l.status] || '')}>
                        {ROTULO_LANCAMENTO[l.status] || l.status}
                      </span>
                    </td>
                    <td>
                      {/* Task 12 monta as ações aqui */}
                      {l.status === 'sugerido' && l.parcela_sugerida && (
                        <span className="muted">
                          {l.parcela_sugerida.contas_a_pagar?.fornecedores?.nome} ·{' '}
                          {fmtMoney(l.parcela_sugerida.valor)} · vence{' '}
                          {fmtDate(l.parcela_sugerida.vencimento)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Verificar no navegador**

Abrir `/financeiro/conciliacao`. Conferir com `read_page` que o bloco de importação, a tabela de importações e o painel de lançamentos aparecem, e com `read_console_messages` que não há erro. Importar um OFX de verdade (ou o fixture `OFX_102` salvo como `.ofx`) e confirmar que as linhas aparecem com o status certo.

- [ ] **Step 5: Commit**

```bash
git add lib/extratos/cliente.js components/ImportarExtrato.js app/financeiro/conciliacao/page.js
git commit -m "feat(financeiro): tela de conciliação com importação de extrato e listagem"
```

---

### Task 12: Ações de conciliação na linha

**Files:**
- Create: `components/AcoesConciliacao.js`
- Modify: `app/financeiro/conciliacao/page.js` (carregar fornecedores/funcionários, barra de lote, montar as ações na célula `Ação`)

**Interfaces:**
- Consumes: rota da Task 9, `candidatosParaLancamento` (Task 4), `CATEGORIAS_CONTA` (`lib/financeiro.js`).
- Produces: `<AcoesConciliacao lancamento empresaId fornecedores funcionarios onMudou />` — cobre confirmar, trocar, criar conta a pagar e desfazer.

- [ ] **Step 1: Escrever o componente**

Cria `components/AcoesConciliacao.js`:

```js
'use client';
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { fmtMoney, fmtDate } from '../lib/format';
import { CATEGORIAS_CONTA } from '../lib/financeiro';
import { candidatosParaLancamento } from '../lib/extratos/matching';
import { chamarApi } from '../lib/extratos/cliente';

// Ações inline da linha do extrato. Segue o padrão da baixa de parcela em
// contas a pagar: o formulário abre dentro da própria célula, sem modal.
export default function AcoesConciliacao({ lancamento, empresaId, fornecedores, funcionarios, onMudou }) {
  const [aberto, setAberto] = useState('');   // '' | 'associar' | 'criar'
  const [ocupado, setOcupado] = useState(false);
  const [candidatos, setCandidatos] = useState([]);
  const [parcelasPorId, setParcelasPorId] = useState({});
  const [novaConta, setNovaConta] = useState(null);

  async function chamar(corpo) {
    setOcupado(true);
    try {
      const r = await chamarApi('/api/financeiro/conciliacao', {
        method: 'POST', body: JSON.stringify(corpo),
      });
      const j = await r.json();
      if (!r.ok) { alert(j.error || 'Não foi possível concluir a ação.'); return false; }
      await onMudou();
      return true;
    } catch (e) {
      alert('Falha: ' + e.message);
      return false;
    } finally {
      setOcupado(false);
    }
  }

  // Ranqueia as parcelas em aberto com a mesma régua da importação, para o
  // colaborador ver primeiro o candidato mais provável.
  async function abrirAssociar() {
    setOcupado(true);
    try {
      const [rp, rpad] = await Promise.all([
        supabase.from('contas_a_pagar_parcelas')
          .select('id, valor, vencimento, contas_a_pagar(descricao, fornecedor_id, categoria_conta, fornecedores(nome))')
          .eq('empresa_id', empresaId).eq('status', 'Pendente'),
        supabase.from('conciliacao_padroes').select('fornecedor_id, categoria_conta')
          .eq('empresa_id', empresaId).eq('padrao', lancamento.descricao_normalizada).maybeSingle(),
      ]);
      const parcelas = (rp.data || []).map(p => ({
        id: p.id, valor: Number(p.valor), vencimento: p.vencimento,
        fornecedorId: p.contas_a_pagar?.fornecedor_id || null,
      }));
      const mapa = {};
      for (const p of rp.data || []) mapa[p.id] = p;
      setParcelasPorId(mapa);
      const padrao = rpad.data
        ? { fornecedorId: rpad.data.fornecedor_id, categoriaConta: rpad.data.categoria_conta }
        : null;
      setCandidatos(candidatosParaLancamento(
        { data: lancamento.data, valor: Number(lancamento.valor), tipo: lancamento.tipo,
          descricao: lancamento.descricao },
        parcelas, padrao));
      setNovaConta({
        descricao: lancamento.descricao,
        categoriaConta: padrao?.categoriaConta || CATEGORIAS_CONTA[0],
        fornecedorId: padrao?.fornecedorId || '',
        responsavelId: '',
      });
      setAberto('associar');
    } finally {
      setOcupado(false);
    }
  }

  async function confirmarParcela(parcelaId) {
    const parcela = parcelasPorId[parcelaId];
    const ok = await chamar({
      acao: 'confirmar', lancamentoId: lancamento.id,
      parcelas: [{ parcelaId, valorAplicado: Number(lancamento.valor) }],
      fornecedorId: parcela?.contas_a_pagar?.fornecedor_id || null,
      categoriaConta: parcela?.contas_a_pagar?.categoria_conta || null,
    });
    if (ok) setAberto('');
  }

  // Confirmar a sugestão que veio da importação: os dados do fornecedor saem
  // da própria parcela sugerida, já embutida na linha.
  async function confirmarSugestao() {
    await chamar({ acao: 'confirmar-lote', lancamentoIds: [lancamento.id] });
  }

  async function criar() {
    if (!novaConta?.fornecedorId) { alert('Escolha o fornecedor.'); return; }
    const ok = await chamar({
      acao: 'criar-conta', lancamentoId: lancamento.id,
      descricao: novaConta.descricao, categoriaConta: novaConta.categoriaConta,
      fornecedorId: novaConta.fornecedorId, responsavelId: novaConta.responsavelId || null,
    });
    if (ok) setAberto('');
  }

  if (lancamento.tipo === 'entrada') {
    return <span className="muted">Entrada — fora da conciliação nesta fase</span>;
  }

  if (lancamento.status === 'conciliado') {
    return (
      <button className="btn secondary small" disabled={ocupado}
        onClick={() => { if (confirm('Desfazer esta conciliação?')) chamar({ acao: 'desfazer', lancamentoId: lancamento.id }); }}>
        {ocupado ? 'Desfazendo…' : 'Desfazer'}
      </button>
    );
  }

  return (
    <>
      <div className="row-actions">
        {lancamento.status === 'sugerido' && lancamento.parcela_sugerida && (
          <>
            <span className="muted" style={{ marginRight: 8 }}>
              {lancamento.parcela_sugerida.contas_a_pagar?.fornecedores?.nome} ·{' '}
              {fmtMoney(lancamento.parcela_sugerida.valor)} · vence{' '}
              {fmtDate(lancamento.parcela_sugerida.vencimento)}
            </span>
            <button className="btn small" disabled={ocupado} onClick={confirmarSugestao}>
              {ocupado ? '…' : 'Confirmar'}
            </button>
          </>
        )}
        <button className="btn secondary small" disabled={ocupado} onClick={abrirAssociar}>
          {lancamento.status === 'sugerido' ? 'Trocar' : 'Associar'}
        </button>
      </div>

      {aberto === 'associar' && (
        <div className="items-list" style={{ marginTop: 8 }}>
          {!candidatos.length && (
            <div className="item-line muted">
              Nenhuma parcela em aberto casa com este valor e data. Crie a conta a pagar abaixo.
            </div>
          )}
          {candidatos.map(c => {
            const p = parcelasPorId[c.parcelaId];
            return (
              <div className="item-line" key={c.parcelaId}>
                <span>
                  {p?.contas_a_pagar?.fornecedores?.nome || '—'} · {p?.contas_a_pagar?.descricao} ·{' '}
                  {fmtMoney(p?.valor)} · vence {fmtDate(p?.vencimento)}
                  <span className="muted"> — {c.motivos.join(', ')}</span>
                </span>
                <button className="btn small" disabled={ocupado}
                  onClick={() => confirmarParcela(c.parcelaId)}>Conciliar</button>
              </div>
            );
          })}

          <div className="item-line" style={{ display: 'block' }}>
            <strong>Criar conta a pagar para esta saída</strong>
            <div className="form-grid" style={{ marginTop: 8 }}>
              <div>
                <label>Descrição</label>
                <input value={novaConta?.descricao || ''}
                  onChange={e => setNovaConta({ ...novaConta, descricao: e.target.value })} />
              </div>
              <div>
                <label>Categoria</label>
                <select value={novaConta?.categoriaConta || ''}
                  onChange={e => setNovaConta({ ...novaConta, categoriaConta: e.target.value })}>
                  {CATEGORIAS_CONTA.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label>Fornecedor</label>
                <select value={novaConta?.fornecedorId || ''}
                  onChange={e => setNovaConta({ ...novaConta, fornecedorId: e.target.value })}>
                  <option value="">Escolha…</option>
                  {(fornecedores || []).filter(f => f.ativo !== false)
                    .map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
                </select>
              </div>
              <div>
                <label>Responsável</label>
                <select value={novaConta?.responsavelId || ''}
                  onChange={e => setNovaConta({ ...novaConta, responsavelId: e.target.value })}>
                  <option value="">—</option>
                  {(funcionarios || []).map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
                </select>
              </div>
              <div style={{ alignSelf: 'end' }}>
                <button className="btn" disabled={ocupado} onClick={criar}>
                  {ocupado ? 'Criando…' : 'Criar e conciliar'}
                </button>
              </div>
            </div>
            <p className="muted" style={{ marginTop: 6 }}>
              A conta nasce com uma parcela única já paga em {fmtDate(lancamento.data)}, no valor de{' '}
              {fmtMoney(lancamento.valor)}.
            </p>
          </div>

          <div className="item-line">
            <button className="btn secondary small" onClick={() => setAberto('')}>Fechar</button>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Ligar na página**

Em `app/financeiro/conciliacao/page.js`:

1. Acrescentar aos imports:

```js
import AcoesConciliacao from '../../../components/AcoesConciliacao';
```

2. Acrescentar os dois estados junto dos outros:

```js
  const [fornecedores, setFornecedores] = useState([]);
  const [funcionarios, setFuncionarios] = useState([]);
```

3. Em `carregarBase`, trocar o `Promise.all` de dois por quatro consultas e guardar os novos dados:

```js
    const [r1, r2, r3, r4] = await Promise.all([
      supabase.from('contas_bancarias').select('*').eq('empresa_id', empresaAtual.id).order('nome'),
      supabase.from('extrato_importacoes')
        .select('*, contas_bancarias(nome, instituicao, tipo)')
        .eq('empresa_id', empresaAtual.id).order('created_at', { ascending: false }).limit(30),
      supabase.from('fornecedores').select('*').eq('empresa_id', empresaAtual.id).order('nome'),
      supabase.from('funcionarios').select('id, nome').eq('empresa_id', empresaAtual.id)
        .eq('ativo', true).order('nome'),
    ]);
    if (r2.error) console.error(r2.error);
    setContas(r1.data || []);
    setImportacoes(r2.data || []);
    setFornecedores(r3.data || []);
    setFuncionarios(r4.data || []);
    setLoading(false);
    return r2.data || [];   // aposImportar e recarregar dependem deste retorno
```

4. Acrescentar a barra de lote logo acima do `table-wrap` dos lançamentos:

```js
          {(() => {
            const sugeridos = visiveis.filter(l => l.status === 'sugerido');
            if (!sugeridos.length) return null;
            return (
              <div className="banner info" style={{ marginTop: 10 }}>
                {sugeridos.length} lançamento(s) já vieram com sugestão do sistema.
                <button className="btn small" style={{ marginLeft: 10 }}
                  onClick={async () => {
                    if (!confirm(`Confirmar as ${sugeridos.length} sugestões?`)) return;
                    const r = await chamarApi('/api/financeiro/conciliacao', {
                      method: 'POST',
                      body: JSON.stringify({ acao: 'confirmar-lote',
                        lancamentoIds: sugeridos.map(l => l.id) }),
                    });
                    const j = await r.json();
                    if (!r.ok) { alert(j.error || 'Não foi possível confirmar em lote.'); return; }
                    await recarregar();
                    if (j.falhas?.length) {
                      alert(`${j.confirmados} confirmado(s). ${j.falhas.length} ficaram de fora:\n`
                        + j.falhas.map(f => '· ' + f.erro).join('\n'));
                    }
                  }}>
                  Confirmar {sugeridos.length} sugestões
                </button>
              </div>
            );
          })()}
```

E acrescentar `import { chamarApi } from '../../../lib/extratos/cliente';` aos imports.

5. Trocar o conteúdo da célula `Ação` (que na Task 11 era só o texto da sugestão) por:

```js
                    <td>
                      <AcoesConciliacao lancamento={l} empresaId={empresaAtual?.id}
                        fornecedores={fornecedores} funcionarios={funcionarios}
                        onMudou={recarregar} />
                    </td>
```

- [ ] **Step 3: Verificar no navegador**

Com a migração aplicada e um extrato importado: confirmar uma sugestão e checar em `/financeiro/contas-a-pagar` que a parcela virou `Pago` com a data do débito; desfazer e checar que voltou a `Pendente`; criar uma conta a pagar a partir de uma tarifa e conferir que ela aparece no contas a pagar já paga. `read_console_messages` sem erro.

- [ ] **Step 4: Commit**

```bash
git add components/AcoesConciliacao.js app/financeiro/conciliacao/page.js
git commit -m "feat(financeiro): confirmar, trocar, criar conta e desfazer na conciliação"
```

---

### Task 13: Pagamento de fatura de cartão

**Files:**
- Create: `components/AssociarFatura.js`
- Modify: `app/financeiro/conciliacao/page.js` (mostrar a ação nas saídas de conta corrente ainda em aberto)

**Interfaces:**
- Consumes: `acao: 'pagar-fatura'` da Task 9.
- Produces: `<AssociarFatura lancamento empresaId onMudou />`.

- [ ] **Step 1: Escrever o componente**

Cria `components/AssociarFatura.js`:

```js
'use client';
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { fmtMoney, fmtDate } from '../lib/format';
import { chamarApi } from '../lib/extratos/cliente';

// O débito da fatura no extrato bancário não é uma compra: é o pagamento de
// um monte de compras que já estão conciliadas linha a linha na fatura.
// Associar aqui baixa todas aquelas parcelas de uma vez — é o que evita
// contar a mesma despesa duas vezes.
export default function AssociarFatura({ lancamento, empresaId, onMudou }) {
  const [aberto, setAberto] = useState(false);
  const [faturas, setFaturas] = useState([]);
  const [faturaId, setFaturaId] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function abrir() {
    setOcupado(true);
    try {
      const { data } = await supabase.from('extrato_importacoes')
        .select('id, periodo_inicio, periodo_fim, total_lancamentos, conciliados, contas_bancarias(nome)')
        .eq('empresa_id', empresaId).eq('tipo', 'fatura_cartao')
        .order('created_at', { ascending: false }).limit(24);
      setFaturas(data || []);
      setAberto(true);
    } finally {
      setOcupado(false);
    }
  }

  async function associar(forcar = false) {
    if (!faturaId) { alert('Escolha a fatura que este débito pagou.'); return; }
    setOcupado(true);
    try {
      const r = await chamarApi('/api/financeiro/conciliacao', {
        method: 'POST',
        body: JSON.stringify({ acao: 'pagar-fatura', lancamentoId: lancamento.id, faturaId, forcar }),
      });
      const j = await r.json();
      if (!r.ok) {
        // Divergência entre o débito e a soma conciliada (pagamento parcial,
        // rotativo): a função devolve o texto explicando, e a baixa só sai
        // com confirmação explícita.
        if (!forcar && /não bate/i.test(j.error || '')) {
          if (confirm(`${j.error}\n\nBaixar as parcelas da fatura assim mesmo?`)) {
            // `await` aqui não é enfeite: sem ele, o `finally` desta chamada
            // roda antes de a requisição forçada responder e reabilita o botão
            // no meio da escrita, que é a janela onde um clique duplo dispara
            // uma segunda chamada sem `forcar`.
            return await associar(true);
          }
          return;
        }
        alert(j.error || 'Não foi possível associar o pagamento.');
        return;
      }
      alert(`${j.baixadas} parcela(s) da fatura baixada(s).`);
      setAberto(false);
      await onMudou();
    } finally {
      setOcupado(false);
    }
  }

  if (!aberto) {
    return (
      <button className="btn secondary small" disabled={ocupado} onClick={abrir}>
        {ocupado ? '…' : 'Associar à fatura'}
      </button>
    );
  }

  return (
    <div className="items-list" style={{ marginTop: 8 }}>
      {!faturas.length && (
        <div className="item-line muted">
          Nenhuma fatura importada. Importe a fatura do cartão antes de baixar o pagamento.
        </div>
      )}
      {!!faturas.length && (
        <div className="item-line" style={{ display: 'block' }}>
          <label>Fatura paga por este débito de {fmtMoney(lancamento.valor)}</label>
          <select value={faturaId} onChange={e => setFaturaId(e.target.value)}>
            <option value="">Escolha…</option>
            {faturas.map(f => (
              <option key={f.id} value={f.id}>
                {f.contas_bancarias?.nome} — {f.periodo_inicio ? fmtDate(f.periodo_inicio) : '?'} a{' '}
                {f.periodo_fim ? fmtDate(f.periodo_fim) : '?'} ({f.conciliados}/{f.total_lancamentos} conciliados)
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="item-line">
        <button className="btn small" disabled={ocupado || !faturaId} onClick={() => associar(false)}>
          {ocupado ? 'Baixando…' : 'Baixar parcelas da fatura'}
        </button>
        <button className="btn secondary small" onClick={() => setAberto(false)}>Fechar</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Ligar na página**

Em `app/financeiro/conciliacao/page.js`, acrescentar o import:

```js
import AssociarFatura from '../../../components/AssociarFatura';
```

E, dentro da célula `Ação`, abaixo de `<AcoesConciliacao … />`:

```js
                      {selecionada.tipo === 'extrato' && l.tipo === 'saida'
                        && l.status !== 'conciliado' && (
                        <AssociarFatura lancamento={l} empresaId={empresaAtual?.id}
                          onMudou={recarregar} />
                      )}
```

- [ ] **Step 3: Verificar no navegador**

Importar uma fatura de cartão, conciliar uma linha dela com uma conta a pagar (a parcela deve continuar `Pendente`), importar o extrato bancário do mês, associar o débito da fatura e conferir que a parcela virou `Pago` com forma `Cartão de Crédito`.

- [ ] **Step 4: Commit**

```bash
git add components/AssociarFatura.js app/financeiro/conciliacao/page.js
git commit -m "feat(financeiro): baixa em lote das parcelas no pagamento da fatura de cartão"
```

---

### Task 14: Documentação e rollout

**Files:**
- Modify: `ROADMAP.md`
- Create: `docs/conciliacao-bancaria.md`

**Interfaces:**
- Consumes: tudo.
- Produces: a documentação operacional e o passo a passo de subida.

- [ ] **Step 1: Rodar a verificação inteira**

```bash
npm run verify && tests/migracao-35/verificar.sh
```

Esperado: suíte verde, `next build` sem erro, `MIGRAÇÃO 35 OK`. **Não seguir para o step 2 sem os três verdes.**

- [ ] **Step 2: Escrever `docs/conciliacao-bancaria.md`**

```markdown
# Conciliação bancária

## O que faz

Importa extrato bancário e fatura de cartão (PDF, OFX ou CSV), lista os
lançamentos e associa cada saída a uma parcela do contas a pagar. A cada
associação confirmada o sistema aprende a relação entre a descrição do extrato
e o fornecedor, e a importação seguinte já chega sugerida.

Nesta fase só as saídas são conciliadas. As entradas entram como `ignorado`
para ficarem visíveis sem cobrar trabalho.

## Formatos

| Formato | Como é lido | Custo |
|---|---|---|
| OFX | Parser próprio (`lib/extratos/parseOfx.js`), 1.x SGML e 2.x XML | zero |
| CSV | Detecção de colunas (`lib/extratos/parseCsv.js`); layout não reconhecido é recusado com instrução para usar OFX ou PDF | zero |
| PDF | Claude API com tool de saída estruturada (`lib/extratos/extrairPdf.js`) | centavos por arquivo |

O OFX é o mais confiável — vem estruturado do banco e traz `FITID`, que faz o
dedupe ser exato. Preferir OFX sempre que o internet banking oferecer.

## Variáveis de ambiente

- `ANTHROPIC_API_KEY` — obrigatória para importar PDF. Sem ela, OFX e CSV
  continuam funcionando e o PDF devolve erro explicando o que configurar.
- `EXTRATO_IA_MODELO` — opcional; default `claude-sonnet-5`.

## Fatura de cartão

Cada compra da fatura concilia com uma conta a pagar individual, no fornecedor
real (Mercado Livre etc.), e **não baixa a parcela** — a compra ainda não saiu
do caixa. Quando o pagamento da fatura aparece no extrato bancário, o
colaborador usa "Associar à fatura" e o sistema baixa todas as parcelas
vinculadas àquela fatura de uma vez, com forma `Cartão de Crédito`. Assim a
despesa é contada uma única vez, com o fornecedor certo.

Pagamento parcial ou rotativo (débito diferente da soma conciliada) é barrado
e só passa com confirmação explícita na tela.

## Aprendizado

`conciliacao_padroes` guarda `descricao_normalizada -> fornecedor + categoria`.
Confirmar de novo o mesmo fornecedor soma um uso; confirmar outro fornecedor
sobrescreve e zera a contagem — a última confirmação do colaborador é a
verdade. O sistema **nunca** concilia sozinho: sugestão sempre passa por
confirmação.

A régua da sugestão (`lib/extratos/matching.js`): valor igual é pré-requisito
(tolerância de 1 centavo), vencimento na janela de ±7 dias pontua pela
proximidade, e o fornecedor aprendido é o desempate. Empate sem folga fica
`pendente` — um clique a mais custa menos que uma parcela baixada errada.

## Reimportar é seguro

O dedupe usa `(empresa_id, hash_dedupe)`. Reenviar o mesmo arquivo, ou um
período que se sobrepõe ao anterior, não duplica linha: o resumo da importação
mostra quantas já estavam no sistema.

## Operação

1. Cadastrar as contas em Financeiro › Contas Bancárias (as seis instituições
   e cada cartão).
2. Importar o arquivo em Financeiro › Conciliação Bancária.
3. Conferir o aviso de divergência aritmética, se houver — quando o saldo não
   fecha, alguma linha ficou de fora do arquivo.
4. Confirmar as sugestões em lote e resolver as pendentes uma a uma.
5. Saída sem conta a pagar: criar a conta na própria linha ("Associar" abre o
   formulário no fim da lista de candidatos).
```

- [ ] **Step 3: Acrescentar a seção no `ROADMAP.md`**

Ler o arquivo, achar a seção do módulo financeiro e acrescentar, no estilo já
usado nas outras entradas (marcar o que ficou pronto e o que ficou para depois):

```markdown
### Conciliação bancária (migração 35) — entregue

- Importação de extrato e fatura em PDF (Claude API), OFX e CSV, com dedupe por
  `(empresa_id, hash_dedupe)` e conferência aritmética do saldo.
- Conciliação de saídas com as parcelas do contas a pagar, N:N, atômica em
  funções Postgres; criação de conta a pagar direto da linha do extrato.
- Aprendizado por padrão (`descricao_normalizada -> fornecedor + categoria`),
  com confirmação em lote das sugestões.
- Fatura de cartão linha a linha, com baixa em lote no pagamento da fatura.
- Detalhes de operação em `docs/conciliacao-bancaria.md`.

Fases seguintes (não implementadas):

- Conciliação das entradas com recebimentos e com as vendas do PDV.
- Importação automática de OFX por integração com o banco (hoje é upload manual).
- Painel de divergências (saídas conciliadas fora do vencimento, fornecedor com
  padrão instável).
```

- [ ] **Step 4: Commit**

```bash
git add ROADMAP.md docs/conciliacao-bancaria.md
git commit -m "docs: operação e limites da conciliação bancária"
```

- [ ] **Step 5: Rollout (com o usuário)**

Nesta ordem, e **cada passo depende de confirmação explícita do usuário** —
migração e chave de API mexem em produção:

1. Aplicar a migração 35 em produção:
   ```bash
   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/atualizacao_35_conciliacao_bancaria.sql
   ```
2. Usuário cria a chave no console da Anthropic e configura `ANTHROPIC_API_KEY`
   no Vercel (produção e preview). Sem ela, só PDF fica indisponível.
3. Cadastrar as contas: Sicoob, Cresol, Sicredi, Banco do Brasil, Santander,
   Bradesco, e cada cartão de crédito.
4. Piloto: um extrato real de um banco e uma fatura real. Conferir à mão cada
   associação sugerida antes de liberar o uso geral. Se o parser de um banco
   específico errar, guardar o arquivo como fixture e acrescentar o caso ao
   teste correspondente.
5. Registrar na memória do projeto: migração 35 aplicada, data, e quais bancos
   já foram validados com arquivo real.
