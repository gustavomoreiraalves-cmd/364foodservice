# Cadastro de Empresas (pessoa jurídica + certificado A1) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma tela `/empresas` (admin) que cadastra a pessoa jurídica de cada CNPJ do grupo, guarda o certificado A1 cifrado e serve de fonte única para os processos lerem dados da empresa.

**Architecture:** `empregadores` (já existe, módulo ponto) vira o cadastro central da pessoa jurídica e ganha colunas fiscais/contato; `empresas` (marcas) aponta para ela por `empregador_id`. O certificado A1 mora em `certificados_digitais`, pfx e senha cifrados em AES-256-GCM por `lib/certificadoServer.js`, sem policy de leitura para o cliente; só rotas `app/api/empresas/*` com service role leem. A tela segue o padrão `useCadastro` de clientes/fornecedores.

**Tech Stack:** Next.js 14 (app router, rotas `route.js` em Node), Supabase (PostgREST + RLS + service role), `node-forge` para ler o pfx, `node --test` para testes, `psql` local para testar a migração.

**Spec:** `docs/superpowers/specs/2026-08-23-cadastro-empresas-design.md`

## Global Constraints

- Código, comentários, mensagens de erro e commits em português, no tom dos arquivos existentes (comentário explica o porquê, não o quê).
- Nunca importar `lib/certificadoServer.js` ou `lib/pontoServer.js` em componente client.
- Migração idempotente (`if not exists`, `drop ... if exists`), com bloco de rollback comentado no fim entre `-- begin;` e `-- commit;` (padrão da atualização 29).
- **Escrita no banco de produção só com ok explícito do usuário** (Task 8). Tudo antes roda em Postgres local ou em testes.
- A chave `CERTIFICADO_CHAVE` é separada de `PONTO_BIOMETRIA_CHAVE`. Nunca logar senha nem pfx.
- O caminho do projeto tem espaços e acentos: em testes usar `fileURLToPath(new URL('..', import.meta.url))`, nunca `.pathname`.
- `npm run verify` (= `npm test && npm run build`) precisa passar ao fim de cada task que toca JS.

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/atualizacao_30_empresas_pessoa_juridica.sql` | Colunas novas em `empregadores`, `empresas.empregador_id` + migração de dados, tabela `certificados_digitais` + RLS |
| `tests/migracao-30/{fixture.sql,cenarios.sql,verificar.sh}` | Prova a migração num Postgres local: idempotência, vínculo das marcas, rollback |
| `lib/certificadoServer.js` | Chave, `cifrar`/`decifrar`, `inspecionarPfx`, `obterCertificadoAtivo` (server only) |
| `tests/certificado.test.mjs` | Ida e volta da cifra, tag adulterada, leitura de pfx gerado por openssl |
| `app/api/empresas/[id]/certificado/route.js` | POST (upload) / GET (status) / DELETE (desativar) do certificado de um empregador |
| `app/api/empresas/certificados/route.js` | GET: resumo do certificado ativo de todos os empregadores (para a lista) |
| `lib/empresa.js` | + `obterPessoaJuridica(empresaId)` e `usePessoaJuridica()` |
| `lib/cnpj.js` | `formatarCnpj`, `somenteDigitos`, `cnpjValido` — puro, testável, compartilhado por client e server |
| `tests/cnpj.test.mjs` | Formatação e validação de CNPJ |
| `app/empresas/page.js` | Tela: formulário em blocos + lista |
| `components/CertificadoA1.js` | Bloco do certificado (estado local, upload, status) |
| `lib/menu.js`, `tests/menu.test.mjs` | Item "Empresas (CNPJ)" em Cadastros |
| `app/ponto/unidades/page.js` | Remove o formulário de empregador; aponta para `/empresas` |
| `app/api/nfe/upload/route.js` | Confere CNPJ via `empresas.empregador_id -> empregadores.cnpj` |
| `.env.local.example` | Documenta `CERTIFICADO_CHAVE` |
| `package.json` | `node-forge` |

---

### Task 1: Migração 30 — banco

**Files:**
- Create: `supabase/atualizacao_30_empresas_pessoa_juridica.sql`
- Create: `tests/migracao-30/fixture.sql`
- Create: `tests/migracao-30/cenarios.sql`
- Create: `tests/migracao-30/verificar.sh`

**Interfaces:**
- Produces: colunas em `empregadores` (ver tabela abaixo), `empresas.empregador_id uuid`, tabela `certificados_digitais` com colunas `id, empregador_id, pfx_cifrado, senha_cifrada, cnpj_certificado, titular, emissor, numero_serie, valido_de, valido_ate, ativo, enviado_por, created_at`.

- [ ] **Step 1: Escrever o fixture (esqueleto mínimo do banco real)**

`tests/migracao-30/fixture.sql`:

```sql
-- Esqueleto mínimo para exercitar a atualização 30 num Postgres local.
-- Reproduz o estado de produção: 4 marcas em `empresas` com só 2 CNPJs distintos
-- e 1 empregador (Steakhouse) já cadastrado pelo módulo de ponto.
create extension if not exists pgcrypto;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid
  language sql stable as $$ select nullif(current_setting('req.uid', true), '')::uuid $$;
create or replace function public.is_admin() returns boolean
  language sql stable as $$ select coalesce(current_setting('req.admin', true), '') = '1' $$;
create or replace function public.fn_set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create table grupos (id uuid primary key default gen_random_uuid(), nome text);
create table empresas (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid references grupos(id),
  nome text, slug text, cnpj text, prefixo_codigo text, ativo boolean default true
);
create table empregadores (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references grupos(id) on delete restrict,
  razao_social text not null,
  nome_fantasia text,
  cnpj text unique not null,
  inscricao_estadual text, endereco text, cidade text, uf text, cep text,
  responsavel_legal text,
  fuso text not null default 'America/Sao_Paulo',
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
alter table empregadores enable row level security;
create policy "empregadores_select" on empregadores for select using (true);
create policy "empregadores_admin_write" on empregadores for all using (public.is_admin()) with check (public.is_admin());

insert into grupos (id, nome) values ('10000000-0000-0000-0000-000000000001', 'Grupo 364');
insert into empresas (id, grupo_id, nome, slug, cnpj, prefixo_codigo) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '364 Food Service', 'food-service', '60361009000150', '0364'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '364 Steakhouse', 'steakhouse', '37.541.736/0001-87', 'STK'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '364 Burguer', 'burguer', '60361009000150', 'BURG'),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '364 Foodtruck/Afya', 'foodtruck-afya', '60361009000150', 'AFYA');
insert into empregadores (id, grupo_id, razao_social, cnpj) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '364 Steakhouse Comercio de Alimentos Ltda', '37541736000187');
```

Repare que a Steakhouse em `empresas` tem o CNPJ **com máscara** de propósito: a migração precisa normalizar antes de casar.

- [ ] **Step 2: Escrever os cenários (falham antes da migração existir)**

`tests/migracao-30/cenarios.sql`:

```sql
-- Exercita a atualização 30. Roda depois do fixture e da migração.
\set QUIET on
set client_min_messages = warning;
begin;

-- Cenário 1: sobram exatamente 2 pessoas jurídicas (uma por CNPJ distinto).
do $$
declare n int;
begin
  select count(*) into n from empregadores;
  if n <> 2 then raise exception 'FALHA 1: esperava 2 empregadores, achou %', n; end if;
  raise notice 'OK 1: um empregador por CNPJ';
end $$;

-- Cenário 2: as 4 marcas ficaram vinculadas, e a Steakhouse ao empregador que já existia.
do $$
declare sem_vinculo int; v_stk uuid;
begin
  select count(*) into sem_vinculo from empresas where empregador_id is null;
  if sem_vinculo <> 0 then raise exception 'FALHA 2: % marcas sem empregador_id', sem_vinculo; end if;
  select empregador_id into v_stk from empresas where slug = 'steakhouse';
  if v_stk <> '30000000-0000-0000-0000-000000000001' then
    raise exception 'FALHA 2: Steakhouse apontou para % em vez do empregador existente', v_stk;
  end if;
  raise notice 'OK 2: marcas vinculadas';
end $$;

-- Cenário 3: Food Service, Burguer e Foodtruck apontam para a MESMA pessoa jurídica nova.
do $$
declare n int;
begin
  select count(distinct empregador_id) into n from empresas where slug in ('food-service','burguer','foodtruck-afya');
  if n <> 1 then raise exception 'FALHA 3: as 3 marcas do CNPJ 60361009000150 apontam para % empregadores', n; end if;
  raise notice 'OK 3: CNPJ compartilhado virou uma única pessoa jurídica';
end $$;

-- Cenário 4: CNPJ com máscara é recusado em empregadores.
do $$
begin
  begin
    insert into empregadores (grupo_id, razao_social, cnpj)
      values ('10000000-0000-0000-0000-000000000001', 'X', '11.222.333/0001-81');
    raise exception 'FALHA 4: aceitou CNPJ com máscara';
  exception when check_violation then
    raise notice 'OK 4: CNPJ só dígitos';
  end;
end $$;

-- Cenário 5: regime tributário fora da lista é recusado.
do $$
begin
  begin
    update empregadores set regime_tributario = 'lucro_imaginario' where cnpj = '37541736000187';
    raise exception 'FALHA 5: aceitou regime inválido';
  exception when check_violation then
    raise notice 'OK 5: regime tributário validado';
  end;
end $$;

-- Cenário 6: só um certificado ativo por empregador.
do $$
begin
  insert into certificados_digitais (empregador_id, pfx_cifrado, senha_cifrada, cnpj_certificado, valido_de, valido_ate)
    values ('30000000-0000-0000-0000-000000000001', 'a:b:c', 'a:b:c', '37541736000187', now(), now() + interval '1 year');
  begin
    insert into certificados_digitais (empregador_id, pfx_cifrado, senha_cifrada, cnpj_certificado, valido_de, valido_ate)
      values ('30000000-0000-0000-0000-000000000001', 'a:b:c', 'a:b:c', '37541736000187', now(), now() + interval '1 year');
    raise exception 'FALHA 6: aceitou dois certificados ativos';
  exception when unique_violation then
    raise notice 'OK 6: um certificado ativo por empregador';
  end;
  -- Desativado, um novo pode entrar.
  update certificados_digitais set ativo = false where empregador_id = '30000000-0000-0000-0000-000000000001';
  insert into certificados_digitais (empregador_id, pfx_cifrado, senha_cifrada, cnpj_certificado, valido_de, valido_ate)
    values ('30000000-0000-0000-0000-000000000001', 'a:b:c', 'a:b:c', '37541736000187', now(), now() + interval '1 year');
  raise notice 'OK 6b: substituição preserva histórico';
end $$;

-- Cenário 7: usuário authenticated (não dono) não enxerga certificados.
do $$
declare n int;
begin
  set local role authenticated;
  select count(*) into n from certificados_digitais;
  reset role;
  if n <> 0 then raise exception 'FALHA 7: authenticated leu % certificados', n; end if;
  raise notice 'OK 7: pfx invisível para o cliente';
end $$;

-- Cenário 8: updated_at muda ao editar empregador.
do $$
declare antes timestamptz; depois timestamptz;
begin
  select updated_at into antes from empregadores where cnpj = '37541736000187';
  perform pg_sleep(0.01);
  update empregadores set telefone = '11999990000' where cnpj = '37541736000187';
  select updated_at into depois from empregadores where cnpj = '37541736000187';
  if depois is null or depois <= coalesce(antes, '-infinity') then raise exception 'FALHA 8: updated_at não avançou'; end if;
  raise notice 'OK 8: updated_at';
end $$;

rollback;
```

O fixture precisa do role `authenticated` para o cenário 7. Acrescentar ao fim do fixture:

```sql
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
alter default privileges in schema public grant select on tables to authenticated;
```

- [ ] **Step 3: Escrever o runner**

`tests/migracao-30/verificar.sh`:

```bash
#!/usr/bin/env bash
# Exercita a atualização 30 (pessoa jurídica central + certificados) num Postgres
# local descartável. Não toca em produção. Requer psql no PATH e servidor local.
#
# Uso: tests/migracao-30/verificar.sh
set -euo pipefail
export PGOPTIONS='-c client_min_messages=warning'

AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
BANCO="${BANCO_TESTE_EMPRESAS:-empresas_test_364}"
MIG="$RAIZ/supabase/atualizacao_30_empresas_pessoa_juridica.sql"

command -v psql >/dev/null || { echo "psql não encontrado no PATH"; exit 1; }
pg_isready -q || { echo "nenhum Postgres local aceitando conexões"; exit 1; }

limpar() { dropdb --if-exists "$BANCO" >/dev/null 2>&1 || true; }
trap limpar EXIT
limpar
createdb "$BANCO"

psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/fixture.sql"
# Duas vezes: prova idempotência de verdade (reaplicar sobre banco onde já rodou).
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$MIG"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$MIG"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/cenarios.sql"

# Rollback comentado no fim da migração: extrai, aplica, confere que desfez.
sed -n '/^-- begin;/,/^-- commit;/p' "$MIG" | sed 's/^-- \{0,1\}//' > "$AQUI/.rollback.sql"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/.rollback.sql"
rm -f "$AQUI/.rollback.sql"

sobraram=$(psql -tAq -d "$BANCO" -c "select count(*) from information_schema.columns
  where (table_name = 'empregadores' and column_name in ('regime_tributario','cnae_principal','telefone','contador_nome','updated_at'))
     or (table_name = 'empresas' and column_name = 'empregador_id');")
[ "$sobraram" = "0" ] || { echo "rollback não removeu todas as colunas novas (achou $sobraram)"; exit 1; }
tabela=$(psql -tAq -d "$BANCO" -c "select count(*) from information_schema.tables where table_name = 'certificados_digitais';")
[ "$tabela" = "0" ] || { echo "rollback não removeu certificados_digitais"; exit 1; }
echo "OK: rollback desfaz a migração"
```

`chmod +x tests/migracao-30/verificar.sh`.

- [ ] **Step 4: Rodar o runner e ver falhar**

Run: `tests/migracao-30/verificar.sh`
Expected: falha em `psql ... -f "$MIG"` com `No such file or directory`.

- [ ] **Step 5: Escrever a migração**

`supabase/atualizacao_30_empresas_pessoa_juridica.sql`:

```sql
-- Cadastro central da pessoa jurídica + certificado digital A1.
--
-- O sistema tinha duas tabelas que pareciam "empresa": `empresas` é a marca /
-- operação (eixo do RLS e de todo empresa_id) e `empregadores` é o CNPJ de
-- verdade, criado para o eSocial. Em produção, três marcas compartilham o mesmo
-- CNPJ copiado em `empresas.cnpj`, e o upload de NF-e conferia a nota contra
-- essa cópia. Aqui `empregadores` vira a fonte única da pessoa jurídica e cada
-- marca aponta para ela por `empregador_id`. Mantivemos o nome `empregadores`
-- porque quatro tabelas do ponto já o referenciam; a tela chama de "Empresas (CNPJ)".
--
-- O certificado A1 (.pfx + senha) fica em `certificados_digitais`, cifrado pela
-- aplicação (AES-256-GCM, chave CERTIFICADO_CHAVE). A tabela não tem policy de
-- select para `authenticated`: só a API com service role lê.
--
-- Idempotente. Rollback comentado no fim.

-- ---------- empregadores: campos fiscais, contato, responsáveis ----------
alter table public.empregadores add column if not exists regime_tributario text;
alter table public.empregadores add column if not exists cnae_principal text;
alter table public.empregadores add column if not exists inscricao_municipal text;
alter table public.empregadores add column if not exists numero text;
alter table public.empregadores add column if not exists complemento text;
alter table public.empregadores add column if not exists bairro text;
alter table public.empregadores add column if not exists codigo_municipio_ibge text;
alter table public.empregadores add column if not exists telefone text;
alter table public.empregadores add column if not exists email text;
alter table public.empregadores add column if not exists email_fiscal text;
alter table public.empregadores add column if not exists responsavel_legal_cpf text;
alter table public.empregadores add column if not exists responsavel_legal_email text;
alter table public.empregadores add column if not exists responsavel_legal_telefone text;
alter table public.empregadores add column if not exists contador_nome text;
alter table public.empregadores add column if not exists contador_crc text;
alter table public.empregadores add column if not exists contador_email text;
alter table public.empregadores add column if not exists contador_telefone text;
alter table public.empregadores add column if not exists observacoes text;
alter table public.empregadores add column if not exists updated_at timestamptz not null default now();

comment on column public.empregadores.endereco is 'Logradouro. Número, complemento e bairro têm colunas próprias (atualização 30).';

-- Normaliza antes do check: cadastro antigo pode ter máscara.
update public.empregadores set cnpj = regexp_replace(cnpj, '\D', '', 'g') where cnpj ~ '\D';

alter table public.empregadores drop constraint if exists empregadores_cnpj_digitos;
alter table public.empregadores add constraint empregadores_cnpj_digitos check (cnpj ~ '^\d{14}$') not valid;
alter table public.empregadores validate constraint empregadores_cnpj_digitos;

alter table public.empregadores drop constraint if exists empregadores_regime_tributario_valido;
alter table public.empregadores add constraint empregadores_regime_tributario_valido
  check (regime_tributario is null or regime_tributario in ('simples', 'presumido', 'real', 'mei'));

drop trigger if exists trg_empregadores_updated_at on public.empregadores;
create trigger trg_empregadores_updated_at before update on public.empregadores
  for each row execute function public.fn_set_updated_at();

-- ---------- empresas -> empregadores ----------
alter table public.empresas add column if not exists empregador_id uuid references public.empregadores(id) on delete restrict;
create index if not exists empresas_empregador_id_idx on public.empresas(empregador_id);

-- Marca cujo CNPJ já tem pessoa jurídica: vincula.
update public.empresas e set empregador_id = p.id
  from public.empregadores p
 where e.empregador_id is null and e.cnpj is not null
   and p.cnpj = regexp_replace(e.cnpj, '\D', '', 'g');

-- CNPJ sem pessoa jurídica: cria uma por CNPJ distinto, com razão social
-- provisória para o administrador completar na tela.
insert into public.empregadores (grupo_id, razao_social, nome_fantasia, cnpj)
select distinct on (regexp_replace(e.cnpj, '\D', '', 'g'))
       e.grupo_id, e.nome || ' (completar razão social)', e.nome, regexp_replace(e.cnpj, '\D', '', 'g')
  from public.empresas e
 where e.empregador_id is null and e.cnpj is not null and regexp_replace(e.cnpj, '\D', '', 'g') ~ '^\d{14}$'
   and not exists (select 1 from public.empregadores p where p.cnpj = regexp_replace(e.cnpj, '\D', '', 'g'))
 order by regexp_replace(e.cnpj, '\D', '', 'g'), e.nome;

update public.empresas e set empregador_id = p.id
  from public.empregadores p
 where e.empregador_id is null and e.cnpj is not null
   and p.cnpj = regexp_replace(e.cnpj, '\D', '', 'g');

-- ---------- certificados digitais ----------
create table if not exists public.certificados_digitais (
  id uuid primary key default gen_random_uuid(),
  empregador_id uuid not null references public.empregadores(id) on delete cascade,
  pfx_cifrado text not null,        -- "iv:tag:cipher" base64, AES-256-GCM (lib/certificadoServer.js)
  senha_cifrada text not null,      -- mesmo formato
  cnpj_certificado text not null,   -- extraído do certificado; bate com empregadores.cnpj
  titular text,
  emissor text,
  numero_serie text,
  valido_de timestamptz not null,
  valido_ate timestamptz not null,
  ativo boolean not null default true,
  enviado_por uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create unique index if not exists certificados_digitais_um_ativo_por_empregador
  on public.certificados_digitais(empregador_id) where ativo;
create index if not exists certificados_digitais_empregador_idx on public.certificados_digitais(empregador_id);

alter table public.certificados_digitais enable row level security;
-- Sem policy para authenticated de propósito: nenhum cliente lê o pfx.
-- Service role ignora RLS e é o único caminho (app/api/empresas/*).

-- ---------- rollback ----------
-- begin;
-- drop table if exists public.certificados_digitais;
-- alter table public.empresas drop column if exists empregador_id;
-- drop trigger if exists trg_empregadores_updated_at on public.empregadores;
-- alter table public.empregadores drop constraint if exists empregadores_regime_tributario_valido;
-- alter table public.empregadores drop constraint if exists empregadores_cnpj_digitos;
-- alter table public.empregadores
--   drop column if exists regime_tributario, drop column if exists cnae_principal,
--   drop column if exists inscricao_municipal, drop column if exists numero,
--   drop column if exists complemento, drop column if exists bairro,
--   drop column if exists codigo_municipio_ibge, drop column if exists telefone,
--   drop column if exists email, drop column if exists email_fiscal,
--   drop column if exists responsavel_legal_cpf, drop column if exists responsavel_legal_email,
--   drop column if exists responsavel_legal_telefone, drop column if exists contador_nome,
--   drop column if exists contador_crc, drop column if exists contador_email,
--   drop column if exists contador_telefone, drop column if exists observacoes,
--   drop column if exists updated_at;
-- comment on column public.empregadores.endereco is null;
-- commit;
```

Nota: o rollback **não** apaga as pessoas jurídicas criadas pela migração de dados (não há como distinguir com segurança depois que o administrador editou). Documentar isso no cabeçalho se preferir; o runner não exige.

- [ ] **Step 6: Rodar o runner até passar**

Run: `tests/migracao-30/verificar.sh`
Expected: `OK 1` … `OK 8`, depois `OK: rollback desfaz a migração`.

- [ ] **Step 7: Commit**

```bash
git add supabase/atualizacao_30_empresas_pessoa_juridica.sql tests/migracao-30
git commit -m "feat(db): empregadores como pessoa jurídica central e certificados digitais (atualização 30)"
```

---

### Task 2: `lib/cnpj.js` — utilitário puro de CNPJ

**Files:**
- Create: `lib/cnpj.js`
- Create: `tests/cnpj.test.mjs`
- Modify: `lib/ponto.js:21` (passa a reexportar de `lib/cnpj.js`)

**Interfaces:**
- Produces: `somenteDigitos(v: string) -> string`, `formatarCnpj(v: string) -> string` ('00.000.000/0000-00' progressivo, como o atual de `lib/ponto.js`), `cnpjValido(digitos: string) -> boolean` (dígitos verificadores).

- [ ] **Step 1: Teste**

`tests/cnpj.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { somenteDigitos, formatarCnpj, cnpjValido } from '../lib/cnpj.js';

test('somenteDigitos remove máscara', () => {
  assert.equal(somenteDigitos('37.541.736/0001-87'), '37541736000187');
  assert.equal(somenteDigitos(null), '');
});

test('formatarCnpj aplica máscara progressiva', () => {
  assert.equal(formatarCnpj('37541736000187'), '37.541.736/0001-87');
  assert.equal(formatarCnpj('3754'), '37.54');
  assert.equal(formatarCnpj(''), '');
});

test('cnpjValido confere dígitos verificadores', () => {
  assert.equal(cnpjValido('37541736000187'), true);
  assert.equal(cnpjValido('60361009000150'), true);
  assert.equal(cnpjValido('37541736000188'), false);
  assert.equal(cnpjValido('11111111111111'), false);
  assert.equal(cnpjValido('123'), false);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/cnpj.test.mjs`
Expected: `Cannot find module '../lib/cnpj.js'`.

- [ ] **Step 3: Implementar**

Primeiro copie o corpo atual de `formatarCnpj` de `lib/ponto.js:21` (leia o arquivo) para preservar o comportamento exato. `lib/cnpj.js`:

```js
// Utilitários de CNPJ sem dependência de React ou Supabase: servem tanto às
// telas quanto às rotas de API e aos testes.

export function somenteDigitos(v) {
  return String(v || '').replace(/\D/g, '');
}

// Máscara progressiva: funciona enquanto o usuário digita.
export function formatarCnpj(v) {
  const d = somenteDigitos(v).slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

export function cnpjValido(digitos) {
  const d = somenteDigitos(digitos);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (base, pesos) => {
    const soma = base.split('').reduce((acc, n, i) => acc + Number(n) * pesos[i], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const p2 = [6, ...p1];
  const dv1 = calc(d.slice(0, 12), p1);
  const dv2 = calc(d.slice(0, 12) + dv1, p2);
  return d.endsWith(`${dv1}${dv2}`);
}
```

Se o `formatarCnpj` de `lib/ponto.js` tiver comportamento diferente do acima para entradas parciais, ajuste o teste ao comportamento existente — o objetivo é não mudar a tela de unidades.

Em `lib/ponto.js`, substituir a função `formatarCnpj` por:

```js
export { formatarCnpj } from './cnpj.js';
```

- [ ] **Step 4: Rodar testes**

Run: `npm test`
Expected: tudo verde, incluindo `tests/cnpj.test.mjs`.

- [ ] **Step 5: Commit**

```bash
git add lib/cnpj.js lib/ponto.js tests/cnpj.test.mjs
git commit -m "refactor: utilitário de CNPJ compartilhado (lib/cnpj.js)"
```

---

### Task 3: `lib/certificadoServer.js` — cifra e leitura do pfx

**Files:**
- Create: `lib/certificadoServer.js`
- Create: `tests/certificado.test.mjs`
- Modify: `package.json` (dependência `node-forge`)
- Modify: `.env.local.example` (documenta `CERTIFICADO_CHAVE`)

**Interfaces:**
- Consumes: `somenteDigitos` de `lib/cnpj.js`; `clienteAdmin()` de `lib/pontoServer.js`.
- Produces:
  - `cifrar(buffer: Buffer) -> string` ('iv:tag:cipher' base64)
  - `decifrar(texto: string) -> Buffer`
  - `inspecionarPfx(buffer: Buffer, senha: string) -> { cnpj, titular, emissor, numeroSerie, validoDe: Date, validoAte: Date }` — lança `Error('Senha do certificado incorreta.')` ou `Error('Arquivo não é um certificado PKCS#12 válido.')`
  - `statusCertificado(validoAte: Date|string, agora?: Date) -> { status: 'vigente'|'vence_em_30_dias'|'vencido', diasParaVencer: number }`
  - `obterCertificadoAtivo(empregadorId: string) -> Promise<{ pfx: Buffer, senha: string, meta } | null>`

- [ ] **Step 1: Instalar dependência**

Run: `npm install node-forge@^1.3.1`

- [ ] **Step 2: Teste**

`tests/certificado.test.mjs`:

```js
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'chave-de-teste';
process.env.CERTIFICADO_CHAVE = Buffer.alloc(32, 7).toString('base64');

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const { cifrar, decifrar, inspecionarPfx, statusCertificado } = await import('../lib/certificadoServer.js');

// Gera um pfx autoassinado com openssl, no formato que a ICP-Brasil usa:
// CN "NOME:CNPJ" e otherName 2.16.76.1.3.3 com o CNPJ.
function gerarPfx({ cn, cnpjOid, senha, dias = 365 }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfx-'));
  const cfg = path.join(dir, 'openssl.cnf');
  fs.writeFileSync(cfg, [
    '[req]', 'distinguished_name=dn', 'x509_extensions=ext', 'prompt=no',
    '[dn]', `CN=${cn}`,
    '[ext]', cnpjOid ? `subjectAltName=otherName:2.16.76.1.3.3;UTF8:${cnpjOid}` : 'basicConstraints=CA:FALSE',
  ].join('\n'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', String(dias),
    '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-config', cfg]);
  execFileSync('openssl', ['pkcs12', '-export', '-inkey', path.join(dir, 'k.pem'), '-in', path.join(dir, 'c.pem'),
    '-out', path.join(dir, 'c.pfx'), '-passout', `pass:${senha}`, '-legacy']);
  return fs.readFileSync(path.join(dir, 'c.pfx'));
}

test('cifrar/decifrar: ida e volta, e IV diferente a cada chamada', () => {
  const plano = Buffer.from('segredo com acentuação ç');
  const a = cifrar(plano), b = cifrar(plano);
  assert.notEqual(a, b);
  assert.deepEqual(decifrar(a), plano);
  assert.equal(a.split(':').length, 3);
});

test('decifrar: tag adulterada falha', () => {
  const [iv, tag, dado] = cifrar(Buffer.from('x')).split(':');
  const tagRuim = Buffer.from(tag, 'base64'); tagRuim[0] ^= 1;
  assert.throws(() => decifrar([iv, tagRuim.toString('base64'), dado].join(':')));
});

test('inspecionarPfx: lê CNPJ pelo otherName da ICP-Brasil', () => {
  const pfx = gerarPfx({ cn: '364 STEAKHOUSE LTDA:37541736000187', cnpjOid: '37541736000187', senha: 'abc123' });
  const meta = inspecionarPfx(pfx, 'abc123');
  assert.equal(meta.cnpj, '37541736000187');
  assert.equal(meta.titular, '364 STEAKHOUSE LTDA:37541736000187');
  assert.ok(meta.validoAte > new Date());
  assert.ok(meta.numeroSerie);
});

test('inspecionarPfx: sem otherName cai para o CN', () => {
  const pfx = gerarPfx({ cn: 'EMPRESA TESTE:60361009000150', senha: 's' });
  assert.equal(inspecionarPfx(pfx, 's').cnpj, '60361009000150');
});

test('inspecionarPfx: senha errada', () => {
  const pfx = gerarPfx({ cn: 'X:60361009000150', senha: 'certa' });
  assert.throws(() => inspecionarPfx(pfx, 'errada'), /Senha do certificado incorreta/);
});

test('inspecionarPfx: arquivo que não é pfx', () => {
  assert.throws(() => inspecionarPfx(Buffer.from('nada a ver'), 'x'), /não é um certificado PKCS#12/);
});

test('statusCertificado', () => {
  const hoje = new Date('2026-08-23T12:00:00Z');
  assert.deepEqual(statusCertificado(new Date('2027-01-01T00:00:00Z'), hoje), { status: 'vigente', diasParaVencer: 130 });
  assert.equal(statusCertificado(new Date('2026-09-10T00:00:00Z'), hoje).status, 'vence_em_30_dias');
  assert.equal(statusCertificado(new Date('2026-08-01T00:00:00Z'), hoje).status, 'vencido');
});
```

Se o `openssl` do macOS (LibreSSL) recusar `-legacy`, remova a flag; o teste só precisa de um pfx que o forge abra. Registre no comentário do teste qual variante funcionou.

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test tests/certificado.test.mjs`
Expected: `Cannot find module '../lib/certificadoServer.js'`.

- [ ] **Step 4: Implementar**

`lib/certificadoServer.js`:

```js
// Certificado digital A1: cifra, decifra e lê o .pfx. Só servidor (rotas de
// app/api/empresas/*): usa a chave CERTIFICADO_CHAVE e crypto do Node.
// Nunca importar em componente client.
//
// CERTIFICADO_CHAVE: 32 bytes em base64, separada da chave de biometria para
// que o vazamento de uma não exponha a outra. Gerar com:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
// ATENÇÃO: perder a chave = certificados irrecuperáveis (reenviar os .pfx).
import crypto from 'crypto';
import forge from 'node-forge';
import { clienteAdmin } from './pontoServer.js';
import { somenteDigitos } from './cnpj.js';

const OID_CNPJ_ICP_BRASIL = '2.16.76.1.3.3';

function chave() {
  const b64 = process.env.CERTIFICADO_CHAVE;
  if (!b64) throw new Error('Configure CERTIFICADO_CHAVE no .env.local (32 bytes em base64).');
  const k = Buffer.from(b64, 'base64');
  if (k.length !== 32) throw new Error('CERTIFICADO_CHAVE deve ter 32 bytes (base64).');
  return k;
}

// Buffer -> "iv:tag:cipher" (base64). IV novo a cada chamada: repetir IV em GCM
// quebra a cifra.
export function cifrar(plano) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', chave(), iv);
  const cifrado = Buffer.concat([cipher.update(plano), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), cifrado.toString('base64')].join(':');
}

export function decifrar(texto) {
  const [ivB64, tagB64, dadoB64] = String(texto).split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', chave(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dadoB64, 'base64')), decipher.final()]);
}

// O CNPJ no certificado ICP-Brasil vem no otherName 2.16.76.1.3.3 do
// subjectAltName; alguns emissores só põem no CN ("RAZAO SOCIAL:CNPJ").
function cnpjDoCertificado(cert) {
  const ext = cert.getExtension('subjectAltName');
  if (ext?.value) {
    const seq = forge.asn1.fromDer(forge.util.createBuffer(ext.value));
    for (const gn of seq.value) {
      // otherName = [0] { OID, [0] EXPLICIT valor }
      if (gn.tagClass !== forge.asn1.Class.CONTEXT_SPECIFIC || gn.type !== 0 || !Array.isArray(gn.value)) continue;
      const [oidNode, valorNode] = gn.value;
      if (!oidNode || forge.asn1.derToOid(oidNode.value) !== OID_CNPJ_ICP_BRASIL) continue;
      const folha = Array.isArray(valorNode?.value) ? valorNode.value[0] : valorNode;
      const digitos = somenteDigitos(folha?.value);
      if (digitos.length >= 14) return digitos.slice(0, 14);
    }
  }
  const cn = cert.subject.getField('CN')?.value || '';
  const m = cn.match(/(\d{14})\s*$/);
  return m ? m[1] : '';
}

export function inspecionarPfx(buffer, senha) {
  let p12;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(buffer.toString('binary')));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, senha || '');
  } catch (e) {
    const msg = String(e?.message || e);
    if (/Invalid password|MAC|authenticate|PKCS#12 MAC/i.test(msg)) throw new Error('Senha do certificado incorreta.');
    throw new Error('Arquivo não é um certificado PKCS#12 válido.');
  }
  const bags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  const chaves = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [];
  // O certificado do titular é o que casa com a chave privada; o resto é cadeia.
  const idChave = chaves[0]?.attributes?.localKeyId?.[0];
  const bag = bags.find(b => idChave && b.attributes?.localKeyId?.[0] === idChave)
    || bags.find(b => b.cert && !b.cert.isIssuer(b.cert))
    || bags[0];
  if (!bag?.cert) throw new Error('Arquivo não é um certificado PKCS#12 válido.');
  const cert = bag.cert;
  return {
    cnpj: cnpjDoCertificado(cert),
    titular: cert.subject.getField('CN')?.value || '',
    emissor: cert.issuer.getField('CN')?.value || '',
    numeroSerie: cert.serialNumber,
    validoDe: cert.validity.notBefore,
    validoAte: cert.validity.notAfter,
  };
}

export function statusCertificado(validoAte, agora = new Date()) {
  const fim = new Date(validoAte);
  const diasParaVencer = Math.floor((fim - agora) / 86400000);
  const status = diasParaVencer < 0 ? 'vencido' : diasParaVencer <= 30 ? 'vence_em_30_dias' : 'vigente';
  return { status, diasParaVencer };
}

// Única porta de saída do pfx decifrado. As fases 2 e 3 da NF-e (assinatura e
// consulta à SEFAZ) chamam isto e usam o buffer em memória.
export async function obterCertificadoAtivo(empregadorId) {
  const sb = clienteAdmin();
  const { data, error } = await sb.from('certificados_digitais').select('*')
    .eq('empregador_id', empregadorId).eq('ativo', true).maybeSingle();
  if (error) throw new Error('Falha ao buscar o certificado: ' + error.message);
  if (!data) return null;
  const { pfx_cifrado, senha_cifrada, ...meta } = data;
  return { pfx: decifrar(pfx_cifrado), senha: decifrar(senha_cifrada).toString('utf8'), meta };
}
```

Se `forge.pkcs12.pkcs12FromAsn1` lançar mensagem diferente para senha errada, rode o teste, leia a mensagem real e ajuste a regex — o teste "senha errada" é a fonte de verdade. Se a navegação do otherName não bater com a estrutura que o forge entrega (ver o teste "otherName"), imprima `JSON.stringify(seq, null, 1)` uma vez para ver a árvore e corrija o caminho; não deixe o fallback por CN mascarar a falha — o teste do otherName usa CN **com** CNPJ igual, então troque temporariamente o CN do teste para um sem CNPJ ao depurar.

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test tests/certificado.test.mjs`
Expected: 7 testes passando.

- [ ] **Step 6: Documentar a variável**

Em `.env.local.example`, logo após `PONTO_BIOMETRIA_CHAVE=`:

```
# Cifra o certificado digital A1 (.pfx + senha) guardado em certificados_digitais.
# 32 bytes em base64, DIFERENTE da chave de biometria:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# Perder esta chave = reenviar todos os certificados na tela Empresas.
CERTIFICADO_CHAVE=
```

- [ ] **Step 7: Verificar e commitar**

Run: `npm run verify`
Expected: testes verdes, build ok.

```bash
git add lib/certificadoServer.js tests/certificado.test.mjs package.json package-lock.json .env.local.example
git commit -m "feat: cifra e leitura do certificado A1 (lib/certificadoServer.js)"
```

---

### Task 4: API do certificado

**Files:**
- Create: `app/api/empresas/[id]/certificado/route.js`
- Create: `app/api/empresas/certificados/route.js`

**Interfaces:**
- Consumes: `autorizarModulo(request, 'admin')` de `lib/pontoServer.js` (retorna `{ sb, user, isAdmin, erro }`); `inspecionarPfx`, `cifrar`, `statusCertificado` de `lib/certificadoServer.js`; `somenteDigitos` de `lib/cnpj.js`.
- Produces:
  - `POST /api/empresas/{id}/certificado` multipart `arquivo` + `senha` → 200 `{ certificado: Resumo, aviso?: string }`
  - `GET /api/empresas/{id}/certificado` → 200 `{ certificado: Resumo | null }`
  - `DELETE /api/empresas/{id}/certificado` → 200 `{ ok: true }`
  - `GET /api/empresas/certificados` → 200 `{ porEmpregador: { [empregadorId]: Resumo } }`
  - `Resumo = { id, titular, emissor, cnpj, numeroSerie, validoDe, validoAte, status, diasParaVencer, criadoEm }`

- [ ] **Step 1: Rota por empregador**

`app/api/empresas/[id]/certificado/route.js`:

```js
import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../../../lib/pontoServer';
import { inspecionarPfx, cifrar, statusCertificado } from '../../../../../lib/certificadoServer';
import { somenteDigitos } from '../../../../../lib/cnpj';

export const runtime = 'nodejs';

// Um A1 real tem 3–6 KB; 64 KB corta upload errado (alguém mandando um PDF).
const LIMITE_PFX = 64 * 1024;

export function resumo(linha) {
  const { status, diasParaVencer } = statusCertificado(linha.valido_ate);
  return {
    id: linha.id, titular: linha.titular, emissor: linha.emissor, cnpj: linha.cnpj_certificado,
    numeroSerie: linha.numero_serie, validoDe: linha.valido_de, validoAte: linha.valido_ate,
    status, diasParaVencer, criadoEm: linha.created_at,
  };
}

async function empregadorOu404(sb, id) {
  const { data } = await sb.from('empregadores').select('id, cnpj, razao_social').eq('id', id).maybeSingle();
  return data || null;
}

export async function GET(request, { params }) {
  const { sb, erro } = await autorizarModulo(request, 'admin');
  if (erro) return erro;
  const { data, error } = await sb.from('certificados_digitais')
    .select('id, titular, emissor, cnpj_certificado, numero_serie, valido_de, valido_ate, created_at')
    .eq('empregador_id', params.id).eq('ativo', true).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ certificado: data ? resumo(data) : null });
}

export async function POST(request, { params }) {
  const { sb, user, erro } = await autorizarModulo(request, 'admin');
  if (erro) return erro;

  const empregador = await empregadorOu404(sb, params.id);
  if (!empregador) return NextResponse.json({ error: 'Empresa não encontrada.' }, { status: 404 });

  const form = await request.formData();
  const arquivo = form.get('arquivo');
  const senha = String(form.get('senha') || '');
  if (!arquivo || typeof arquivo.arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'Envie o arquivo .pfx do certificado.' }, { status: 400 });
  }
  if (arquivo.size > LIMITE_PFX) {
    return NextResponse.json({ error: 'Arquivo acima de 64 KB — confira se é mesmo o .pfx do certificado A1.' }, { status: 400 });
  }
  if (!senha) return NextResponse.json({ error: 'Informe a senha do certificado.' }, { status: 400 });

  const pfx = Buffer.from(await arquivo.arrayBuffer());
  let meta;
  try {
    meta = inspecionarPfx(pfx, senha);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  const cnpjEmpresa = somenteDigitos(empregador.cnpj);
  if (!meta.cnpj) {
    return NextResponse.json({ error: 'Não encontrei o CNPJ dentro do certificado. Confira se é um A1 de pessoa jurídica (e-CNPJ).' }, { status: 400 });
  }
  if (meta.cnpj !== cnpjEmpresa) {
    return NextResponse.json({
      error: `Este certificado é do CNPJ ${meta.cnpj}, e a empresa ${empregador.razao_social} tem o CNPJ ${cnpjEmpresa}. Confira se o arquivo é da empresa certa.`,
    }, { status: 400 });
  }
  const agora = new Date();
  if (meta.validoAte < agora) {
    return NextResponse.json({ error: `Este certificado venceu em ${meta.validoAte.toLocaleDateString('pt-BR')}. Envie um certificado vigente.` }, { status: 400 });
  }
  const aviso = meta.validoDe > agora
    ? `Atenção: o certificado só passa a valer em ${meta.validoDe.toLocaleDateString('pt-BR')}.` : undefined;

  let pfxCifrado, senhaCifrada;
  try {
    pfxCifrado = cifrar(pfx);
    senhaCifrada = cifrar(Buffer.from(senha, 'utf8'));
  } catch (e) {
    // Chave ausente na Vercel: a mensagem já diz o que configurar.
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

  // Substituição = desativa o anterior e insere o novo; o histórico fica.
  const { error: errDesativa } = await sb.from('certificados_digitais')
    .update({ ativo: false }).eq('empregador_id', params.id).eq('ativo', true);
  if (errDesativa) return NextResponse.json({ error: errDesativa.message }, { status: 500 });

  const { data, error } = await sb.from('certificados_digitais').insert([{
    empregador_id: params.id,
    pfx_cifrado: pfxCifrado,
    senha_cifrada: senhaCifrada,
    cnpj_certificado: meta.cnpj,
    titular: meta.titular,
    emissor: meta.emissor,
    numero_serie: meta.numeroSerie,
    valido_de: meta.validoDe.toISOString(),
    valido_ate: meta.validoAte.toISOString(),
    enviado_por: user.id,
  }]).select('id, titular, emissor, cnpj_certificado, numero_serie, valido_de, valido_ate, created_at').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ certificado: resumo(data), aviso });
}

export async function DELETE(request, { params }) {
  const { sb, erro } = await autorizarModulo(request, 'admin');
  if (erro) return erro;
  const { error } = await sb.from('certificados_digitais')
    .update({ ativo: false }).eq('empregador_id', params.id).eq('ativo', true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

Next.js não permite exportar `resumo` de um `route.js` (só handlers e configs). Mova `resumo` para `lib/certificadoServer.js` como `export function resumoCertificado(linha)` e importe nas duas rotas. Atualize o teste de Task 3 com um caso:

```js
test('resumoCertificado mapeia colunas do banco', async () => {
  const { resumoCertificado } = await import('../lib/certificadoServer.js');
  const r = resumoCertificado({ id: '1', titular: 'T', emissor: 'E', cnpj_certificado: '1', numero_serie: 'S',
    valido_de: '2026-01-01', valido_ate: '2099-01-01', created_at: '2026-08-23' });
  assert.equal(r.status, 'vigente');
  assert.equal(r.cnpj, '1');
});
```

- [ ] **Step 2: Rota de resumo geral**

`app/api/empresas/certificados/route.js`:

```js
import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../../lib/pontoServer';
import { resumoCertificado } from '../../../../lib/certificadoServer';

export const runtime = 'nodejs';

// Uma chamada para a lista inteira da tela Empresas, em vez de um GET por linha.
export async function GET(request) {
  const { sb, erro } = await autorizarModulo(request, 'admin');
  if (erro) return erro;
  const { data, error } = await sb.from('certificados_digitais')
    .select('id, empregador_id, titular, emissor, cnpj_certificado, numero_serie, valido_de, valido_ate, created_at')
    .eq('ativo', true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const porEmpregador = {};
  for (const linha of data || []) porEmpregador[linha.empregador_id] = resumoCertificado(linha);
  return NextResponse.json({ porEmpregador });
}
```

- [ ] **Step 3: Teste manual com curl contra o dev server**

Não há banco local com a migração 30 aplicada ao dev server (`.env.local` aponta para produção e a migração ainda não foi aplicada lá — Task 8). Nesta task, valide só que o build compila e que a rota recusa sem token:

Run: `npm run build`
Expected: build ok, rotas `/api/empresas/[id]/certificado` e `/api/empresas/certificados` listadas como `ƒ (Dynamic)`.

O teste funcional de upload acontece na Task 8, depois da migração em produção.

- [ ] **Step 4: Commit**

```bash
git add app/api/empresas lib/certificadoServer.js tests/certificado.test.mjs
git commit -m "feat(api): upload, status e remoção do certificado A1 por empresa"
```

---

### Task 5: Menu + `lib/empresa.js` + upload de NF-e lendo o CNPJ pelo vínculo

**Files:**
- Modify: `lib/menu.js` (grupo `cadastros`)
- Modify: `tests/menu.test.mjs` (aceitar `modulo: 'admin'`)
- Modify: `lib/empresa.js`
- Modify: `app/api/nfe/upload/route.js:56-57`

**Interfaces:**
- Produces: `obterPessoaJuridica(empresaId) -> Promise<Empregador|null>` e `usePessoaJuridica() -> { pessoaJuridica, carregando }` em `lib/empresa.js`.

- [ ] **Step 1: Teste de menu**

Em `tests/menu.test.mjs`, no teste `'MENU: todo modulo citado existe em MODULOS'`, trocar:

```js
  const validos = idsDePermissao();
```
por
```js
  // 'admin' é o módulo especial (lib/auth.js:7): não está em MODULOS, mas é válido.
  const validos = [...idsDePermissao(), 'admin'];
```

E acrescentar:

```js
test('menuVisivel: Empresas (CNPJ) só aparece para admin', () => {
  const semAdmin = todosItens(menuVisivel(['clientes'], false)).map(i => i.href);
  assert.ok(!semAdmin.includes('/empresas'));
  const comAdmin = todosItens(menuVisivel([], true)).map(i => i.href);
  assert.ok(comAdmin.includes('/empresas'));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/menu.test.mjs`
Expected: o teste novo falha (`/empresas` ausente para admin).

- [ ] **Step 3: Item de menu**

Em `lib/menu.js`, no grupo `cadastros`, após `Matéria-prima / Insumos`:

```js
      { label: 'Empresas (CNPJ)', href: '/empresas', modulo: 'admin' },
```

O teste `'MENU: todo href tem uma page.js'` vai falhar até a Task 6 criar `app/empresas/page.js`. Para não deixar a suíte vermelha entre tasks, crie agora o esqueleto:

`app/empresas/page.js`:

```js
'use client';
import AppShell from '../../components/AppShell';

export default function EmpresasPage() {
  return (
    <AppShell modulo="admin" titulo="Empresas" desc="Pessoas jurídicas do grupo, certificados e responsáveis">
      <p className="muted">Em construção.</p>
    </AppShell>
  );
}
```

Run: `node --test tests/menu.test.mjs` → verde.

- [ ] **Step 4: Helpers em `lib/empresa.js`**

Substituir o conteúdo por:

```js
'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from './supabase.js';

// Empresa selecionada no momento (364 Steakhouse, Food Service, Burguer, Foodtruck/Afya).
// Provido por components/AppShell.js — toda página de negócio já está dentro dele.
export const EmpresaContext = createContext({ empresaAtual: null, empresas: [], setEmpresaAtual: () => {} });

export function useEmpresaAtual() {
  return useContext(EmpresaContext);
}

// A marca (empresas) aponta para a pessoa jurídica (empregadores) por
// empregador_id. É daqui que impressões e processos leem razão social, CNPJ e
// endereço — nunca de texto fixo. Cache por sessão: o cadastro muda raramente.
const cachePJ = new Map();

export async function obterPessoaJuridica(empresaId) {
  if (!empresaId) return null;
  if (cachePJ.has(empresaId)) return cachePJ.get(empresaId);
  const { data, error } = await supabase.from('empresas')
    .select('empregador_id, empregadores(*)').eq('id', empresaId).maybeSingle();
  if (error) throw new Error('Falha ao buscar a pessoa jurídica: ' + error.message);
  const pj = data?.empregadores || null;
  cachePJ.set(empresaId, pj);
  return pj;
}

export function limparCachePessoaJuridica() {
  cachePJ.clear();
}

export function usePessoaJuridica() {
  const { empresaAtual } = useEmpresaAtual();
  const [pessoaJuridica, setPessoaJuridica] = useState(null);
  const [carregando, setCarregando] = useState(true);
  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    obterPessoaJuridica(empresaAtual?.id)
      .then(pj => { if (ativo) setPessoaJuridica(pj); })
      .catch(() => { if (ativo) setPessoaJuridica(null); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [empresaAtual?.id]);
  return { pessoaJuridica, carregando };
}
```

O join `empregadores(*)` depende da FK `empresas.empregador_id` (migração 30) — o PostgREST descobre sozinho. A tela de empresas chama `limparCachePessoaJuridica()` após salvar.

- [ ] **Step 5: Upload de NF-e**

Em `app/api/nfe/upload/route.js`, trocar as linhas 56–57:

```js
    const { data: empresa, error: errEmpresa } = await sb.from('empresas')
      .select('cnpj').eq('id', empresaId).maybeSingle();
```
por
```js
    // O CNPJ mora na pessoa jurídica (empregadores); a marca só aponta para ela.
    // Marca sem vínculo cai em cnpjEmpresa vazio e segue sem a conferência, como
    // já acontecia quando o cadastro da empresa não tinha CNPJ.
    const { data: empresa, error: errEmpresa } = await sb.from('empresas')
      .select('empregador_id, empregadores(cnpj)').eq('id', empresaId).maybeSingle();
```
e a linha seguinte:
```js
    const cnpjEmpresa = String(empresa?.cnpj || '').replace(/\D/g, '');
```
por
```js
    const cnpjEmpresa = String(empresa?.empregadores?.cnpj || '').replace(/\D/g, '');
```

Confira se `tests/nfe-*.test.mjs` exercita esse trecho (grep por `from('empresas')` nos testes); se houver mock do select, atualize-o para devolver `{ empregadores: { cnpj } }`.

- [ ] **Step 6: Verificar e commitar**

Run: `npm run verify`
Expected: verde.

```bash
git add lib/menu.js tests/menu.test.mjs lib/empresa.js app/api/nfe/upload/route.js app/empresas/page.js
git commit -m "feat: menu Empresas (CNPJ), helper de pessoa jurídica e NF-e conferindo CNPJ pelo vínculo"
```

---

### Task 6: Tela `/empresas`

**Files:**
- Modify: `app/empresas/page.js` (substitui o esqueleto)
- Create: `components/CertificadoA1.js`

**Interfaces:**
- Consumes: `useCadastro` de `lib/cadastro.js` (`{ form, setForm, editando, salvando, iniciarEdicao, cancelarEdicao, salvar, alternarAtivo }`); `formatarCnpj`, `somenteDigitos`, `cnpjValido` de `lib/cnpj.js`; `limparCachePessoaJuridica` de `lib/empresa.js`; rotas da Task 4.
- Produces: componente `<CertificadoA1 empregadorId resumoInicial aoMudar />`.

- [ ] **Step 1: Bloco do certificado**

`components/CertificadoA1.js`:

```js
'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const ROTULO = {
  vigente: { texto: 'Vigente', classe: 'ok' },
  vence_em_30_dias: { texto: 'Vence em breve', classe: 'warn' },
  vencido: { texto: 'Vencido', classe: 'bad' },
};

async function cabecalhoAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${session?.access_token || ''}` };
}

export function BadgeCertificado({ resumo }) {
  if (!resumo) return <span className="tag">Sem certificado</span>;
  const r = ROTULO[resumo.status] || ROTULO.vigente;
  return <span className={`tag ${r.classe}`}>{r.texto}</span>;
}

// Arquivo e senha vivem aqui, fora do useCadastro: não podem ir no update de
// empregadores nem ficar no estado depois do envio.
export default function CertificadoA1({ empregadorId, resumoInicial, aoMudar }) {
  const [resumo, setResumo] = useState(resumoInicial || null);
  const [arquivo, setArquivo] = useState(null);
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState('');

  useEffect(() => { setResumo(resumoInicial || null); }, [resumoInicial?.id, empregadorId]);

  async function enviar(e) {
    e.preventDefault();
    if (!arquivo || !senha || enviando) return;
    setEnviando(true); setMensagem('');
    try {
      const corpo = new FormData();
      corpo.append('arquivo', arquivo);
      corpo.append('senha', senha);
      const r = await fetch(`/api/empresas/${empregadorId}/certificado`, { method: 'POST', headers: await cabecalhoAuth(), body: corpo });
      const json = await r.json();
      if (!r.ok) { setMensagem(json.error || 'Falha ao enviar.'); return; }
      setResumo(json.certificado);
      setMensagem(json.aviso || 'Certificado salvo.');
      setArquivo(null); setSenha('');
      e.target.reset();
      aoMudar?.(json.certificado);
    } finally {
      setEnviando(false);
    }
  }

  async function remover() {
    if (!confirm('Remover o certificado ativo? Ele deixa de ser usado, mas fica no histórico.')) return;
    const r = await fetch(`/api/empresas/${empregadorId}/certificado`, { method: 'DELETE', headers: await cabecalhoAuth() });
    const json = await r.json();
    if (!r.ok) { setMensagem(json.error || 'Falha ao remover.'); return; }
    setResumo(null); setMensagem('Certificado removido.');
    aoMudar?.(null);
  }

  return (
    <fieldset className="panel" style={{ marginTop: 12 }}>
      <legend><strong>Certificado digital A1</strong></legend>
      <p style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <BadgeCertificado resumo={resumo} />
        {resumo && (
          <span className="muted">
            {resumo.titular} · emitido por {resumo.emissor || '—'} · válido até {new Date(resumo.validoAte).toLocaleDateString('pt-BR')}
            {resumo.status !== 'vencido' && ` (${resumo.diasParaVencer} dias)`}
          </span>
        )}
      </p>
      <form onSubmit={enviar} className="form-grid">
        <div><label>Arquivo .pfx / .p12</label><input type="file" accept=".pfx,.p12" onChange={e => setArquivo(e.target.files?.[0] || null)} /></div>
        <div><label>Senha do certificado</label><input type="password" autoComplete="off" value={senha} onChange={e => setSenha(e.target.value)} /></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <button className="btn" type="submit" disabled={!arquivo || !senha || enviando}>
            {enviando ? 'Enviando…' : (resumo ? 'Substituir certificado' : 'Enviar certificado')}
          </button>
          {resumo && <button className="btn danger" type="button" onClick={remover}>Remover</button>}
        </div>
      </form>
      {mensagem && <p className="muted" style={{ marginTop: 8 }}>{mensagem}</p>}
    </fieldset>
  );
}
```

- [ ] **Step 2: A tela**

`app/empresas/page.js`:

```js
'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import AppShell from '../../components/AppShell';
import CertificadoA1, { BadgeCertificado } from '../../components/CertificadoA1';
import { useEmpresaAtual, limparCachePessoaJuridica } from '../../lib/empresa';
import { useCadastro } from '../../lib/cadastro';
import { formatarCnpj, somenteDigitos, cnpjValido } from '../../lib/cnpj';

const FORM_VAZIO = {
  razao_social: '', nome_fantasia: '', cnpj: '', inscricao_estadual: '', inscricao_municipal: '',
  regime_tributario: '', cnae_principal: '',
  endereco: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '', cep: '', codigo_municipio_ibge: '',
  fuso: 'America/Sao_Paulo',
  telefone: '', email: '', email_fiscal: '',
  responsavel_legal: '', responsavel_legal_cpf: '', responsavel_legal_email: '', responsavel_legal_telefone: '',
  contador_nome: '', contador_crc: '', contador_email: '', contador_telefone: '',
  observacoes: '',
};
const REGIMES = [['', '—'], ['simples', 'Simples Nacional'], ['presumido', 'Lucro Presumido'], ['real', 'Lucro Real'], ['mei', 'MEI']];
const SELECT_LISTA = 'id, razao_social, nome_fantasia, cnpj, regime_tributario, cidade, uf, ativo';

export default function EmpresasPage() {
  return (
    <AppShell modulo="admin" titulo="Empresas" desc="Pessoas jurídicas do grupo, certificados e responsáveis">
      <Conteudo />
    </AppShell>
  );
}

async function cabecalhoAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${session?.access_token || ''}` };
}

function Conteudo() {
  const { empresaAtual, empresas } = useEmpresaAtual();
  const [lista, setLista] = useState([]);
  const [marcas, setMarcas] = useState([]);
  const [certificados, setCertificados] = useState({});
  const [loading, setLoading] = useState(true);
  const [mostrarInativos, setMostrarInativos] = useState(false);

  async function carregar() {
    setLoading(true);
    const [{ data: emps }, { data: mcs }] = await Promise.all([
      supabase.from('empregadores').select('*').order('razao_social'),
      supabase.from('empresas').select('id, nome, empregador_id').order('nome'),
    ]);
    setLista(emps || []);
    setMarcas(mcs || []);
    try {
      const r = await fetch('/api/empresas/certificados', { headers: await cabecalhoAuth() });
      const json = await r.json();
      if (r.ok) setCertificados(json.porEmpregador || {});
    } catch { /* lista continua sem o badge; o bloco do certificado mostra o erro real */ }
    limparCachePessoaJuridica();
    setLoading(false);
  }

  useEffect(() => { carregar(); }, []);

  // empregadores não tem empresa_id: o insert precisa do grupo, que vem da
  // empresa selecionada. `empresa_id: undefined` some no JSON e o PostgREST não vê.
  function paraGravar(f) {
    const grupo_id = empresaAtual?.grupo_id || empresas?.[0]?.grupo_id;
    const vazioVira = v => (typeof v === 'string' && v.trim() === '' ? null : v);
    const saida = { ...f, grupo_id };
    for (const k of Object.keys(saida)) saida[k] = vazioVira(saida[k]);
    saida.cnpj = somenteDigitos(f.cnpj);
    saida.cep = somenteDigitos(f.cep) || null;
    saida.cnae_principal = somenteDigitos(f.cnae_principal) || null;
    saida.codigo_municipio_ibge = somenteDigitos(f.codigo_municipio_ibge) || null;
    saida.responsavel_legal_cpf = somenteDigitos(f.responsavel_legal_cpf) || null;
    saida.uf = (f.uf || '').toUpperCase() || null;
    saida.fuso = f.fuso || 'America/Sao_Paulo';
    return saida;
  }

  const { form, setForm, editando, salvando, iniciarEdicao, cancelarEdicao, salvar, alternarAtivo } =
    useCadastro({ tabela: 'empregadores', formVazio: FORM_VAZIO, empresaId: undefined, aoTerminar: carregar, paraGravar });

  function aoSubmeter(e) {
    if (!cnpjValido(form.cnpj)) { e.preventDefault(); alert('CNPJ inválido: confira os dígitos.'); return; }
    return salvar(e);
  }

  async function vincularMarca(marcaId, empregadorId) {
    const { error } = await supabase.from('empresas').update({ empregador_id: empregadorId || null }).eq('id', marcaId);
    if (error) { alert('Não foi possível vincular: ' + error.message); return; }
    await carregar();
  }

  const emEdicao = editando ? lista.find(x => x.id === editando) : null;
  const visiveis = mostrarInativos ? lista : lista.filter(x => x.ativo !== false);
  const campo = (k, label, props = {}) => (
    <div><label>{label}</label><input value={form[k] ?? ''} onChange={e => setForm({ ...form, [k]: e.target.value })} {...props} /></div>
  );

  return (
    <>
      <div className="panel">
        <h3>{emEdicao ? `Editando: ${emEdicao.razao_social}` : 'Nova empresa (pessoa jurídica)'}</h3>
        <form onSubmit={aoSubmeter}>
          <fieldset className="form-grid">
            <legend><strong>Dados fiscais</strong></legend>
            {campo('razao_social', 'Razão social', { required: true })}
            {campo('nome_fantasia', 'Nome fantasia')}
            <div><label>CNPJ</label><input required value={formatarCnpj(form.cnpj)} onChange={e => setForm({ ...form, cnpj: e.target.value })} placeholder="00.000.000/0000-00" /></div>
            {campo('inscricao_estadual', 'Inscrição estadual')}
            {campo('inscricao_municipal', 'Inscrição municipal')}
            <div><label>Regime tributário</label>
              <select value={form.regime_tributario || ''} onChange={e => setForm({ ...form, regime_tributario: e.target.value })}>
                {REGIMES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </div>
            {campo('cnae_principal', 'CNAE principal', { placeholder: '5611201' })}
            {campo('endereco', 'Logradouro')}
            {campo('numero', 'Número')}
            {campo('complemento', 'Complemento')}
            {campo('bairro', 'Bairro')}
            {campo('cidade', 'Cidade')}
            {campo('uf', 'UF', { maxLength: 2 })}
            {campo('cep', 'CEP')}
            {campo('codigo_municipio_ibge', 'Código IBGE do município', { placeholder: '3550308' })}
            {campo('fuso', 'Fuso horário')}
          </fieldset>

          <fieldset className="form-grid" style={{ marginTop: 12 }}>
            <legend><strong>Contato e responsáveis</strong></legend>
            {campo('telefone', 'Telefone')}
            {campo('email', 'E-mail', { type: 'email' })}
            {campo('email_fiscal', 'E-mail fiscal (NF-e, intimações)', { type: 'email' })}
            {campo('responsavel_legal', 'Responsável legal')}
            {campo('responsavel_legal_cpf', 'CPF do responsável')}
            {campo('responsavel_legal_email', 'E-mail do responsável', { type: 'email' })}
            {campo('responsavel_legal_telefone', 'Telefone do responsável')}
            {campo('contador_nome', 'Contador(a)')}
            {campo('contador_crc', 'CRC')}
            {campo('contador_email', 'E-mail do contador', { type: 'email' })}
            {campo('contador_telefone', 'Telefone do contador')}
            <div style={{ gridColumn: '1 / -1' }}><label>Observações</label>
              <textarea rows={3} value={form.observacoes ?? ''} onChange={e => setForm({ ...form, observacoes: e.target.value })} />
            </div>
          </fieldset>

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn" type="submit" disabled={salvando}>
              {salvando ? 'Salvando…' : (editando ? 'Salvar alterações' : 'Adicionar empresa')}
            </button>
            {editando && <button className="btn secondary" type="button" onClick={cancelarEdicao}>Cancelar</button>}
          </div>
        </form>

        {emEdicao && (
          <>
            <CertificadoA1
              empregadorId={emEdicao.id}
              resumoInicial={certificados[emEdicao.id]}
              aoMudar={r => setCertificados(c => ({ ...c, [emEdicao.id]: r || undefined }))}
            />
            <fieldset className="panel" style={{ marginTop: 12 }}>
              <legend><strong>Operações vinculadas</strong></legend>
              <ul>
                {marcas.filter(m => m.empregador_id === emEdicao.id).map(m => (
                  <li key={m.id}>{m.nome} <button className="btn secondary small" type="button" onClick={() => vincularMarca(m.id, null)}>Desvincular</button></li>
                ))}
              </ul>
              {marcas.some(m => !m.empregador_id) && (
                <div className="form-grid">
                  <div><label>Vincular marca sem pessoa jurídica</label>
                    <select defaultValue="" onChange={e => { if (e.target.value) vincularMarca(e.target.value, emEdicao.id); }}>
                      <option value="">Selecione…</option>
                      {marcas.filter(m => !m.empregador_id).map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
                    </select>
                  </div>
                </div>
              )}
            </fieldset>
          </>
        )}
        {!emEdicao && <p className="muted" style={{ marginTop: 8 }}>Salve a empresa e clique em Editar para enviar o certificado A1 e vincular as operações.</p>}
      </div>

      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h3>Empresas cadastradas ({visiveis.length})</h3>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={mostrarInativos} onChange={e => setMostrarInativos(e.target.checked)} /> Mostrar inativas
          </label>
        </div>
        {loading ? <p className="muted">Carregando…</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Razão social</th><th>CNPJ</th><th>Regime</th><th>Certificado A1</th><th>Operações</th><th>Situação</th><th></th></tr></thead>
              <tbody>
                {visiveis.length ? visiveis.map(p => {
                  const inativo = p.ativo === false;
                  const n = marcas.filter(m => m.empregador_id === p.id).length;
                  return (
                    <tr key={p.id} style={inativo ? { opacity: 0.55 } : undefined}>
                      <td>{p.razao_social}{p.nome_fantasia ? <span className="muted"> ({p.nome_fantasia})</span> : null}</td>
                      <td className="muted">{formatarCnpj(p.cnpj)}</td>
                      <td className="muted">{REGIMES.find(r => r[0] === (p.regime_tributario || ''))?.[1] || '—'}</td>
                      <td><BadgeCertificado resumo={certificados[p.id]} /></td>
                      <td className="muted">{n}</td>
                      <td>{inativo ? <span className="tag bad">Inativa</span> : <span className="tag ok">Ativa</span>}</td>
                      <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button className="btn secondary" onClick={() => iniciarEdicao(p)}>Editar</button>
                        <button className="btn secondary" onClick={() => {
                          if (!inativo && n > 0 && !confirm(`${n} operação(ões) apontam para esta empresa. Inativar mesmo assim?`)) return;
                          alternarAtivo(p);
                        }}>{inativo ? 'Reativar' : 'Inativar'}</button>
                      </td>
                    </tr>
                  );
                }) : <tr className="empty-row"><td colSpan={7}>Nenhuma empresa {mostrarInativos ? 'cadastrada' : 'ativa'}.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        {marcas.some(m => !m.empregador_id) && (
          <p className="muted" style={{ marginTop: 8 }}>
            Operações sem pessoa jurídica: {marcas.filter(m => !m.empregador_id).map(m => m.nome).join(', ')}. Edite a empresa certa e vincule.
          </p>
        )}
      </div>
    </>
  );
}
```

Dois pontos a confirmar ao implementar:
- `useEmpresaAtual()` precisa expor `grupo_id` na `empresaAtual`. Leia `components/AppShell.js` e `lib/auth.js:44` — se o `select` de empresas não traz `grupo_id`, acrescente a coluna ao select (não muda comportamento).
- O `useCadastro` só chama `paraGravar` com o form; o erro 23505 (CNPJ duplicado) chega via `alert('Erro ao salvar: ...')`. Para a mensagem em português, trate antes do submit: em `aoSubmeter`, se `!editando && lista.some(x => x.cnpj === somenteDigitos(form.cnpj))`, `alert('Já existe uma empresa com este CNPJ.')` e retorne.

- [ ] **Step 3: Verificar no preview**

A tela depende da migração 30 em produção (o `.env.local` aponta para lá). Se a Task 8 ainda não rodou, valide só `npm run verify` e a renderização do formulário vazio (abrir `/empresas` no preview; a lista mostra erro de coluna ausente, esperado). A verificação funcional completa fica na Task 8.

Run: `npm run verify` → verde.

- [ ] **Step 4: Commit**

```bash
git add app/empresas/page.js components/CertificadoA1.js components/AppShell.js lib/auth.js
git commit -m "feat: tela Empresas (CNPJ) com dados fiscais, contato, certificado A1 e operações vinculadas"
```

---

### Task 7: `/ponto/unidades` deixa de criar empregador

**Files:**
- Modify: `app/ponto/unidades/page.js:9,29,49-57,95-110`

- [ ] **Step 1: Remover o formulário**

Em `app/ponto/unidades/page.js`:
- Apagar `EMPREGADOR_VAZIO` (linha 9), o estado `fEmp` (linha 29) e a função `addEmpregador` (linhas 49–57).
- Substituir o bloco `{isAdmin && (<form onSubmit={addEmpregador} ...</form>)}` (linhas ~97–110) por:

```jsx
        {isAdmin && (
          <p className="muted" style={{ fontSize: 11.5, marginBottom: 12 }}>
            Cadastro, dados fiscais e certificado A1 ficam em <a href="/empresas">Cadastros → Empresas (CNPJ)</a>.
          </p>
        )}
```
- Manter a tabela de empregadores e o botão Inativar/Reativar (o ponto ainda precisa ver a situação).
- Ajustar o texto da linha vazia: `Nenhum empregador cadastrado.{isAdmin ? ' Cadastre em Empresas (CNPJ).' : ''}`.

- [ ] **Step 2: Verificar**

Run: `npm run verify` → verde. Abrir `/ponto/unidades` no preview: lista de empregadores aparece, formulário de novo empregador não, link para `/empresas` presente.

- [ ] **Step 3: Commit**

```bash
git add app/ponto/unidades/page.js
git commit -m "refactor(ponto): cadastro de empregador migra para a tela Empresas"
```

---

### Task 8: Produção — migração, chave e verificação ponta a ponta

**Files:**
- Modify (memória): `~/.claude/.../memory/migracoes-aplicadas-producao.md`, `deploy-364foodservice.md`

**Pré-requisito:** ok explícito do usuário para escrever no banco de produção. Parar e perguntar antes do Step 2.

- [ ] **Step 1: Conferir o estado de produção antes**

```bash
psql "$SUPABASE_DB_URL" -Atc "select id, nome, cnpj from empresas; select id, razao_social, cnpj from empregadores; select count(*) from information_schema.columns where table_name='empresas' and column_name='empregador_id';"
```
Expected: 4 marcas, 1 empregador, `0`.

- [ ] **Step 2: Aplicar a migração (com ok do usuário)**

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/atualizacao_30_empresas_pessoa_juridica.sql
```

Conferir:
```bash
psql "$SUPABASE_DB_URL" -Atc "select e.nome, p.razao_social, p.cnpj from empresas e left join empregadores p on p.id = e.empregador_id order by 1;"
```
Expected: 4 linhas, nenhuma com `razao_social` nula; Steakhouse → Ltda existente; as outras 3 → `364 Food Service (completar razão social)`.

- [ ] **Step 3: `CERTIFICADO_CHAVE` na Vercel e no `.env.local`**

Gerar: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
Adicionar ao `.env.local` (`CERTIFICADO_CHAVE=...`) e na Vercel (projeto `364foodservice`, Production + Preview, sensível):

```bash
printf '%s' "$VALOR" | vercel env add CERTIFICADO_CHAVE production --sensitive
```

Guardar o valor em lugar seguro fora do repo (mesma regra da `PONTO_BIOMETRIA_CHAVE`: não pode ser regerada sem reenviar os certificados).

- [ ] **Step 4: Verificação funcional no preview**

Subir o dev server pelo painel do navegador, logar como admin, abrir `/empresas`:
1. Lista mostra 2 empresas; badge "Sem certificado".
2. Editar a Food Service: completar razão social, salvar; lista atualiza.
3. Enviar um pfx de teste com CNPJ diferente → erro com os dois CNPJs.
4. Enviar pfx com senha errada → "Senha do certificado incorreta."
5. Enviar pfx válido (se o usuário tiver o A1 real, com ele; senão gerar um com o `gerarPfx` do teste com o CNPJ da empresa) → badge "Vigente", validade exibida.
6. Remover → "Sem certificado".
7. `/ponto/unidades` lista os 2 empregadores.
8. Upload de XML de NF-e em Recebimento continua conferindo o CNPJ (testar com um XML de outra empresa → mensagem de CNPJ divergente).

Capturar screenshot da lista com o badge e anexar ao relatório.

- [ ] **Step 5: Deploy e memória**

```bash
git push origin main
```
Confirmar deploy na Vercel. Atualizar a memória `migracoes-aplicadas-producao.md` (30 aplicada em 2026-08-23) e `deploy-364foodservice.md` (nova env `CERTIFICADO_CHAVE`, não regerável).

---

## Self-review

- **Cobertura da spec:** banco (T1), criptografia e pfx (T3), API (T4), tela com 4 blocos (T6), helpers e upload NF-e (T5), `/ponto/unidades` (T7), env e memória (T3, T8), testes de migração/unitários/manual (T1, T3, T8). Menu em T5. Tradução do 23505 em T6 Step 2.
- **Placeholders:** nenhum "TBD". Pontos incertos (mensagem do forge para senha errada, árvore ASN.1 do otherName, flag `-legacy`) têm instrução concreta de como resolver.
- **Consistência de nomes:** `resumoCertificado` (lib) usado em ambas as rotas; `statusCertificado` em lib e teste; `obterPessoaJuridica`/`usePessoaJuridica`/`limparCachePessoaJuridica` em `lib/empresa.js` e na tela; `somenteDigitos`/`formatarCnpj`/`cnpjValido` em `lib/cnpj.js`, teste, API e tela; rota `/api/empresas/[id]/certificado` igual em `CertificadoA1.js` e na API.
