# Financeiro (Contas a Pagar) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the standalone `/despesas` screen with a real Financeiro module —
categorias de conta fixas + Contas a Pagar, automatically generated from
Recebimento (matéria-prima) and also launchable manually (nota fiscal avulsa or
despesa sem nota), per `docs/superpowers/specs/2026-08-12-financeiro-contas-a-pagar-design.md`.

**Architecture:** Two new Postgres tables (`contas_a_pagar`, `contas_a_pagar_parcelas`)
with the same multiempresa RLS pattern already used everywhere else in this schema.
Recebimento's save flow gains a "condição de pagamento" step that generates the
payable at the application layer (not a DB trigger — the condition data isn't
persisted on `recebimentos`). A new Financeiro page lists every payable (flat by
parcela, across all three origins) and supports manual lançamento + baixa de
pagamento. `despesas` is dropped after a one-time backfill.

**Tech Stack:** Next.js 14 (App Router) + React 18 + Supabase (Postgres, Auth,
Storage). No new npm dependency.

## Global Constraints

- Every new table gets RLS via the existing `empresa_id in (select public.empresas_permitidas())` policy pattern (see `supabase/atualizacao_06_rls_multiempresa.sql`) — copy it verbatim, don't invent a new shape.
- No new Storage bucket: reuse the existing private bucket `recebimentos` (see `lib/storage.js`), just a different path prefix.
- **No test framework exists in this project** (no jest/vitest, `package.json` has no `test` script). Do not add one — that's out of scope for this plan. Verification follows the project's actual established convention instead (see every prior `ROADMAP.md` entry: "Testado no navegador..."): SQL run directly in the Supabase SQL editor for schema/migration tasks, and `npm run dev` + concrete browser steps for UI tasks. The one exception: `lib/financeiro.js`'s pure functions (no Supabase, no React) are verified with a real, exact `node` command — Node auto-detects ESM syntax even without `"type": "module"` in `package.json` (verified empirically while writing this plan), so `node --input-type=module -e "import('./lib/financeiro.js')..."` is a genuine executable check, not hand-waving.
- Follow existing file conventions exactly: `'use client'` at the top of every page, `useEmpresaAtual()` for the active company, `fmtMoney`/`fmtDate`/`hoje` from `lib/format.js`, the `panel` / `form-grid` / `table-wrap` / `tag` CSS classes already in `app/globals.css` — no new CSS file, no new component library.
- Categorias de conta are a plain JS constant array (`CATEGORIAS_CONTA`), not a database table — matches how `fornecedores.categoria` already works (`app/fornecedores/page.js`).

---

## File Structure

| File | Change |
|---|---|
| `supabase/atualizacao_16_financeiro_contas_a_pagar.sql` | Create — new tables, RLS, delete-guard trigger, `despesas` backfill + drop, permission migration |
| `lib/financeiro.js` | Create — `CATEGORIAS_CONTA`, `FORMAS_PAGAMENTO`, `gerarParcelas()`, `isVencida()` |
| `lib/storage.js` | Modify — add `uploadArquivoContaAPagar`, `signedUrlContaAPagar`, `removerAnexosContaAPagar` |
| `lib/auth.js` | Modify — `MODULOS`: `despesas` entry becomes `financeiro` |
| `app/despesas/page.js` | Modify — retire (redirect), same pattern as `app/funcionarios/page.js` |
| `app/financeiro/contas-a-pagar/page.js` | Create — the Financeiro screen: listagem, filtros, lançamento manual, baixa de pagamento |
| `app/recebimentos/page.js` | Modify — condição de pagamento no formulário, geração automática da conta a pagar, exclusão de nota reordenada para respeitar o bloqueio de conta paga |
| `app/relatorios/page.js` | Modify — troca a fonte de `despesas` para `contas_a_pagar` |

---

### Task 1: Migração SQL — `contas_a_pagar`, `contas_a_pagar_parcelas`, bloqueio, backfill

**Files:**
- Create: `supabase/atualizacao_16_financeiro_contas_a_pagar.sql`

**Interfaces:**
- Produces: tables `contas_a_pagar(id, descricao, categoria_conta, fornecedor_id, recebimento_id, nota_fiscal_numero, nota_fiscal_anexo_path, valor_total, responsavel_id, empresa_id, created_at)` and `contas_a_pagar_parcelas(id, conta_a_pagar_id, numero, valor, vencimento, status, data_pagamento, forma_pagamento, comprovante_path, empresa_id, created_at)`. Later tasks insert into both directly via the Supabase client — no RPC/function needed for writes.

- [ ] **Step 1: Write the migration file**

```sql
-- =========================================================
-- 364 — ATUALIZAÇÃO 16: FINANCEIRO (CATEGORIAS DE CONTA + CONTAS A PAGAR)
-- Substitui a tela solta de Despesas por Contas a Pagar: toda saída
-- financeira (compra de matéria-prima via Recebimento, nota fiscal
-- avulsa ou despesa manual) vira uma única entidade, categorizada,
-- com vencimento/parcelas e rastreável até a origem.
--
-- Categorias de conta (Custos Fixos/Diretos/Variáveis, Investimentos) são
-- uma lista fixa no código (lib/financeiro.js), não uma tabela — check
-- constraint abaixo é a única validação no banco.
--
-- Rode depois de atualizacao_15_unificar_colaboradores.sql.
-- =========================================================

-- ---------- CONTAS A PAGAR ----------
create table contas_a_pagar (
  id uuid primary key default gen_random_uuid(),
  descricao text not null,
  categoria_conta text not null
    check (categoria_conta in ('Custos Fixos', 'Custos Diretos', 'Custos Variáveis', 'Investimentos')),
  fornecedor_id uuid not null references fornecedores(id),
  recebimento_id uuid references recebimentos(id) on delete cascade,
  nota_fiscal_numero text,
  nota_fiscal_anexo_path text,
  valor_total numeric(12,2) not null,
  responsavel_id uuid references funcionarios(id),
  empresa_id uuid not null references empresas(id),
  created_at timestamptz not null default now()
);
create index contas_a_pagar_empresa_id_idx on contas_a_pagar (empresa_id);
create index contas_a_pagar_recebimento_id_idx on contas_a_pagar (recebimento_id);
create index contas_a_pagar_fornecedor_id_idx on contas_a_pagar (fornecedor_id);

alter table contas_a_pagar enable row level security;
create policy "empresa_scoped_access" on contas_a_pagar for all
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()))
  with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

-- ---------- PARCELAS ----------
create table contas_a_pagar_parcelas (
  id uuid primary key default gen_random_uuid(),
  conta_a_pagar_id uuid not null references contas_a_pagar(id) on delete cascade,
  numero int not null,
  valor numeric(12,2) not null,
  vencimento date not null,
  status text not null default 'Pendente' check (status in ('Pendente', 'Pago')),
  data_pagamento date,
  forma_pagamento text,
  comprovante_path text,
  empresa_id uuid not null references empresas(id),
  created_at timestamptz not null default now(),
  unique (conta_a_pagar_id, numero)
);
create index contas_a_pagar_parcelas_conta_id_idx on contas_a_pagar_parcelas (conta_a_pagar_id);
create index contas_a_pagar_parcelas_empresa_id_idx on contas_a_pagar_parcelas (empresa_id);

alter table contas_a_pagar_parcelas enable row level security;
create policy "empresa_scoped_access" on contas_a_pagar_parcelas for all
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()))
  with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

-- ---------- BLOQUEIO: não apagar recebimento com conta já paga ----------
-- Sem parcela paga, a FK recebimento_id acima (on delete cascade) já limpa
-- a conta a pagar junto. Com parcela paga, bloqueia — o usuário precisa
-- resolver isso em Financeiro antes de mexer no recebimento.
create or replace function public.bloquear_exclusao_recebimento_pago()
returns trigger language plpgsql as $function$
begin
  if exists (
    select 1 from contas_a_pagar cp
    join contas_a_pagar_parcelas pc on pc.conta_a_pagar_id = cp.id
    where cp.recebimento_id = old.id and pc.status = 'Pago'
  ) then
    raise exception 'Não é possível excluir: esta nota já tem parcela paga na Conta a Pagar. Ajuste em Financeiro antes.';
  end if;
  return old;
end;
$function$;

drop trigger if exists trg_bloquear_exclusao_recebimento_pago on recebimentos;
create trigger trg_bloquear_exclusao_recebimento_pago
  before delete on recebimentos
  for each row execute function public.bloquear_exclusao_recebimento_pago();

-- ---------- BACKFILL: despesas → contas_a_pagar ----------
-- Fornecedor genérico por empresa, pra cobrir despesas antigas sem
-- fornecedor real (o campo passa a ser obrigatório daqui pra frente).
insert into fornecedores (nome, categoria, empresa_id)
select 'Diversos (despesas migradas)', 'Outros', e.id
from empresas e
where exists (select 1 from despesas d where d.empresa_id = e.id)
  and not exists (
    select 1 from fornecedores f where f.empresa_id = e.id and f.nome = 'Diversos (despesas migradas)'
  );

-- Cada despesa vira 1 conta a pagar (categoria "Custos Fixos") + 1 parcela
-- já paga na própria data do lançamento antigo (dado histórico: já
-- aconteceu, não tinha conceito de pendente/pago).
do $$
declare
  d record;
  fornecedor_generico_id uuid;
  nova_conta_id uuid;
begin
  for d in select * from despesas loop
    select id into fornecedor_generico_id from fornecedores
      where empresa_id = d.empresa_id and nome = 'Diversos (despesas migradas)';

    insert into contas_a_pagar (descricao, categoria_conta, fornecedor_id, valor_total, responsavel_id, empresa_id, created_at)
    values (d.descricao, 'Custos Fixos', fornecedor_generico_id, d.valor, d.responsavel_id, d.empresa_id, d.created_at)
    returning id into nova_conta_id;

    insert into contas_a_pagar_parcelas (conta_a_pagar_id, numero, valor, vencimento, status, data_pagamento, empresa_id)
    values (nova_conta_id, 1, d.valor, d.data, 'Pago', d.data, d.empresa_id);
  end loop;
end $$;

drop table despesas;

-- ---------- MÓDULO 'financeiro': quem tinha 'despesas' ganha 'financeiro' ----------
insert into permissoes (user_id, modulo)
select p.user_id, 'financeiro'
from permissoes p
where p.modulo = 'despesas'
  and not exists (select 1 from permissoes p2 where p2.user_id = p.user_id and p2.modulo = 'financeiro');

delete from permissoes where modulo = 'despesas';
```

- [ ] **Step 2: Antes de rodar, anote o baseline no SQL Editor do Supabase**

Run: `select count(*) from despesas;`
Anote o número — vai ser comparado com `count(*) from contas_a_pagar` depois do backfill.

- [ ] **Step 3: Rodar a migração inteira no SQL Editor do Supabase**

Cole o arquivo inteiro (Step 1) e execute. Deve rodar sem erro.

- [ ] **Step 4: Verificar as tabelas e RLS**

Run:
```sql
select table_name from information_schema.tables where table_name in ('contas_a_pagar', 'contas_a_pagar_parcelas');
select policyname, tablename from pg_policies where tablename in ('contas_a_pagar', 'contas_a_pagar_parcelas');
select to_regclass('public.despesas');
```
Expected: as duas tabelas aparecem na primeira query; `empresa_scoped_access` aparece pras duas na segunda; a terceira retorna `null` (despesas foi dropada).

- [ ] **Step 5: Verificar o backfill**

Run:
```sql
select count(*) from contas_a_pagar where recebimento_id is null and nota_fiscal_numero is null;
```
Expected: mesmo número anotado no Step 2 (toda despesa antiga virou 1 conta sem `recebimento_id` nem `nota_fiscal_numero` — só descrição/fornecedor/categoria).

```sql
select count(*) from contas_a_pagar cp
join contas_a_pagar_parcelas p on p.conta_a_pagar_id = cp.id
where cp.recebimento_id is null and (p.status <> 'Pago' or p.data_pagamento is null);
```
Expected: `0` (toda conta migrada tem exatamente 1 parcela, já paga).

- [ ] **Step 6: Testar o bloqueio de exclusão de recebimento pago**

Pegue o `id` de qualquer recebimento existente (`select id, fornecedor_id, empresa_id from recebimentos limit 1;`) e rode:

```sql
-- monta uma conta a pagar de teste, já paga, ligada a esse recebimento
with r as (select id, fornecedor_id, empresa_id from recebimentos limit 1),
nova as (
  insert into contas_a_pagar (descricao, categoria_conta, fornecedor_id, recebimento_id, valor_total, empresa_id)
  select 'TESTE bloqueio', 'Custos Diretos', r.fornecedor_id, r.id, 10, r.empresa_id from r
  returning id
)
insert into contas_a_pagar_parcelas (conta_a_pagar_id, numero, valor, vencimento, status, data_pagamento, empresa_id)
select nova.id, 1, 10, current_date, 'Pago', current_date, r.empresa_id from nova, r;

-- tenta excluir o recebimento — TEM que falhar
delete from recebimentos where id = (select id from recebimentos limit 1);
```
Expected: o `delete` final falha com o erro `Não é possível excluir: esta nota já tem parcela paga...`.

- [ ] **Step 7: Limpar os dados de teste do Step 6**

```sql
delete from contas_a_pagar where descricao = 'TESTE bloqueio';
```
Expected: 1 linha removida (a parcela some junto via cascade).

- [ ] **Step 8: Commit**

```bash
git add supabase/atualizacao_16_financeiro_contas_a_pagar.sql
git commit -m "feat: add contas_a_pagar/parcelas schema, backfill despesas, block paid-receipt deletion"
```

---

### Task 2: `lib/financeiro.js` — categorias, formas de pagamento, cálculo de parcelas

**Files:**
- Create: `lib/financeiro.js`

**Interfaces:**
- Consumes: `hoje()` from `lib/format.js` (`export function hoje()` returning `YYYY-MM-DD`).
- Produces: `CATEGORIAS_CONTA: string[]`, `FORMAS_PAGAMENTO: string[]`, `gerarParcelas(dataBase: string, valorTotal: number, numeroParcelas?: number, intervaloDias?: number): {numero: number, valor: number, vencimento: string}[]`, `isVencida(parcela: {status: string, vencimento: string}): boolean` — used by Task 6 (Financeiro page) and Task 7 (Recebimento).

- [ ] **Step 1: Write the file**

```js
import { hoje } from './format';

export const CATEGORIAS_CONTA = ['Custos Fixos', 'Custos Diretos', 'Custos Variáveis', 'Investimentos'];

export const FORMAS_PAGAMENTO = ['Pix', 'Boleto', 'Transferência', 'Dinheiro'];

function somarDias(dataStr, dias) {
  const d = new Date(dataStr);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// Divide um valor total em N parcelas com vencimentos espaçados por
// `intervaloDias`, contando a partir de `dataBase` (data da nota/lançamento).
// N=1 é "à vista": vence na própria dataBase, `intervaloDias` é ignorado.
// A última parcela absorve o resto do arredondamento de centavos, pra soma
// bater exatamente com `valorTotal`.
export function gerarParcelas(dataBase, valorTotal, numeroParcelas = 1, intervaloDias = 30) {
  const n = Math.max(1, Number(numeroParcelas) || 1);
  const valorParcela = Math.round((Number(valorTotal) / n) * 100) / 100;
  const parcelas = [];
  let somaAnteriores = 0;
  for (let i = 1; i <= n; i++) {
    const valor = i < n ? valorParcela : Math.round((Number(valorTotal) - somaAnteriores) * 100) / 100;
    somaAnteriores += valor;
    const vencimento = n === 1 ? dataBase : somarDias(dataBase, i * Number(intervaloDias));
    parcelas.push({ numero: i, valor, vencimento });
  }
  return parcelas;
}

// Uma parcela pendente cujo vencimento já passou é "vencida" — não é um
// status gravado no banco (evita depender de job agendado pra atualizar
// linha), é derivado aqui a partir da data de hoje.
export function isVencida(parcela) {
  return parcela.status === 'Pendente' && parcela.vencimento < hoje();
}
```

- [ ] **Step 2: Verificar `gerarParcelas` com o node real (sem framework de teste)**

Run:
```bash
node --input-type=module -e "
import('./lib/financeiro.js').then(m => {
  console.log(JSON.stringify(m.gerarParcelas('2026-08-12', 300, 3, 30)));
  console.log(JSON.stringify(m.gerarParcelas('2026-08-12', 250, 1)));
  console.log(JSON.stringify(m.gerarParcelas('2026-08-12', 100, 3, 30)));
});
"
```
Expected (ignore o warning `MODULE_TYPELESS_PACKAGE_JSON`, é só aviso de performance):
```
[{"numero":1,"valor":100,"vencimento":"2026-09-11"},{"numero":2,"valor":100,"vencimento":"2026-10-11"},{"numero":3,"valor":100,"vencimento":"2026-11-10"}]
[{"numero":1,"valor":250,"vencimento":"2026-08-12"}]
[{"numero":1,"valor":33.33,"vencimento":"2026-09-11"},{"numero":2,"valor":33.33,"vencimento":"2026-10-11"},{"numero":3,"valor":33.34,"vencimento":"2026-11-10"}]
```
A terceira linha confirma que o arredondamento bate: `33.33 + 33.33 + 33.34 = 100.00`, não `99.99`.

- [ ] **Step 3: Verificar `isVencida`**

Run:
```bash
node --input-type=module -e "
import('./lib/financeiro.js').then(m => {
  console.log(m.isVencida({ status: 'Pendente', vencimento: '2020-01-01' }));
  console.log(m.isVencida({ status: 'Pago', vencimento: '2020-01-01' }));
});
"
```
Expected: `true` depois `false` (uma parcela paga nunca é "vencida", não importa o vencimento).

- [ ] **Step 4: Commit**

```bash
git add lib/financeiro.js
git commit -m "feat: add categorias de conta, formas de pagamento e cálculo de parcelas"
```

---

### Task 3: `lib/storage.js` — anexos de Contas a Pagar

**Files:**
- Modify: `lib/storage.js`

**Interfaces:**
- Consumes: `BUCKET = 'recebimentos'` (already defined at the top of the file), `supabase` client, `extensaoSegura()` (already defined in the file).
- Produces: `uploadArquivoContaAPagar(empresaId, registroId, prefixo, file): Promise<string>` (path), `signedUrlContaAPagar(path, segundos?): Promise<string>`, `removerAnexosContaAPagar(paths): Promise<void>` — used by Task 6.

- [ ] **Step 1: Add the three functions at the end of the file**

Append to `lib/storage.js` (after the existing `signedUrlColaborador` function):

```js
// ---------- FINANCEIRO: anexos de Contas a Pagar (nota fiscal avulsa, comprovante de pagamento) ----------
// Reaproveita o bucket privado 'recebimentos' — mesma policy de signed URL
// (o primeiro segmento do path continua sendo o empresa_id), só muda o
// prefixo pra não colidir com os anexos de recebimento.

export async function uploadArquivoContaAPagar(empresaId, registroId, prefixo, file) {
  const ext = extensaoSegura(file.name);
  const path = `${empresaId}/contas-a-pagar/${registroId}/${prefixo}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) throw error;
  return path;
}

export async function signedUrlContaAPagar(path, segundos = 300) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, segundos);
  if (error) throw error;
  return data.signedUrl;
}

export async function removerAnexosContaAPagar(paths) {
  const validos = (paths || []).filter(Boolean);
  if (!validos.length) return;
  await supabase.storage.from(BUCKET).remove(validos);
}
```

- [ ] **Step 2: Verificar visualmente que o arquivo ficou consistente**

Run: `grep -n "^export" lib/storage.js`
Expected: mostra as 5 funções antigas (`uploadArquivoRecebimento`, `signedUrlRecebimento`, `removerAnexosRecebimento`, `uploadFotoColaborador`, `signedUrlColaborador`) mais as 3 novas.

- [ ] **Step 3: Commit**

```bash
git add lib/storage.js
git commit -m "feat: add storage helpers for contas a pagar attachments"
```

---

### Task 4: `lib/auth.js` — módulo `financeiro` no lugar de `despesas`

**Files:**
- Modify: `lib/auth.js:17`

**Interfaces:**
- Produces: `MODULOS` entry `{ id: 'financeiro', label: 'Financeiro', href: '/financeiro/contas-a-pagar', ic: '◈', desc: 'Categorias de conta e contas a pagar' }` — consumed by `components/AppShell.js` (sidebar) and by `useAuth('financeiro')` in Task 6's page.

- [ ] **Step 1: Replace the `despesas` entry**

In `lib/auth.js`, replace:
```js
  { id: 'despesas', label: 'Despesas', href: '/despesas', ic: '◇', desc: 'Despesas operacionais' },
```
with:
```js
  { id: 'financeiro', label: 'Financeiro', href: '/financeiro/contas-a-pagar', ic: '◈', desc: 'Categorias de conta e contas a pagar' },
```

- [ ] **Step 2: Verificar que não sobrou nenhuma referência a `despesas` em `MODULOS`**

Run: `grep -n "despesas" lib/auth.js`
Expected: nenhuma linha (o `grep` não retorna nada / sai com código 1).

- [ ] **Step 3: Commit**

```bash
git add lib/auth.js
git commit -m "feat: replace despesas module with financeiro in sidebar"
```

---

### Task 5: Aposentar `/despesas`

**Files:**
- Modify: `app/despesas/page.js` (substitui o conteúdo inteiro)

**Interfaces:**
- Consumes: nada de outra task (é um redirect puro, mesmo padrão de `app/funcionarios/page.js` e `app/usuarios/page.js`).

- [ ] **Step 1: Substituir o conteúdo do arquivo**

```js
'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Despesas foi unificado ao módulo Financeiro (Contas a Pagar). Esta rota
// permanece só para não quebrar links/bookmarks antigos.
export default function DespesasPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/financeiro/contas-a-pagar'); }, [router]);
  return <p style={{ padding: 30 }} className="muted">As despesas agora ficam em Financeiro → Contas a Pagar. Redirecionando…</p>;
}
```

- [ ] **Step 2: Testar no navegador**

Run: `npm run dev`, faça login, acesse `http://localhost:3000/despesas` diretamente pela URL.
Expected: a página redireciona sozinha (não precisa estar linkada na sidebar ainda — essa mudança já aconteceu na Task 4).

- [ ] **Step 3: Commit**

```bash
git add app/despesas/page.js
git commit -m "feat: retire /despesas, redirect to /financeiro/contas-a-pagar"
```

---

### Task 6: Tela Financeiro — Contas a Pagar (listagem, filtros, lançamento manual, baixa)

**Files:**
- Create: `app/financeiro/contas-a-pagar/page.js`

**Interfaces:**
- Consumes: `CATEGORIAS_CONTA`, `FORMAS_PAGAMENTO`, `gerarParcelas`, `isVencida` from `lib/financeiro.js` (Task 2); `uploadArquivoContaAPagar`, `signedUrlContaAPagar` from `lib/storage.js` (Task 3); `fmtMoney`, `fmtDate`, `hoje` from `lib/format.js`; `useEmpresaAtual` from `lib/empresa.js`; `AppShell` from `components/AppShell.js`; `MODULOS` entry `financeiro` (Task 4) is what makes this route reachable from the sidebar.
- Produces: nothing consumed by later tasks in this plan (this is the leaf UI).

- [ ] **Step 1: Write the page**

```js
'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { fmtMoney, fmtDate, hoje } from '../../../lib/format';
import { CATEGORIAS_CONTA, FORMAS_PAGAMENTO, gerarParcelas, isVencida } from '../../../lib/financeiro';
import { uploadArquivoContaAPagar, signedUrlContaAPagar } from '../../../lib/storage';
import AppShell from '../../../components/AppShell';
import { useEmpresaAtual } from '../../../lib/empresa';

const LANCAMENTO_VAZIO = () => ({
  descricao: '', categoria_conta: CATEGORIAS_CONTA[0], fornecedor_id: '',
  nota_fiscal_numero: '', notaFiscalArquivo: null,
  data: hoje(), valor_total: '', responsavel_id: '',
  condicao_pagamento: 'À vista', numero_parcelas: 2, intervalo_dias: 30,
});

export default function ContasAPagarPage() {
  return (
    <AppShell modulo="financeiro" titulo="Financeiro" desc="Categorias de conta e contas a pagar">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const { empresaAtual } = useEmpresaAtual();
  const [lista, setLista] = useState([]);
  const [fornecedores, setFornecedores] = useState([]);
  const [funcionarios, setFuncionarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [lancamento, setLancamento] = useState(LANCAMENTO_VAZIO());
  const [baixaAtiva, setBaixaAtiva] = useState(null);

  const [filtroStatus, setFiltroStatus] = useState('');
  const [filtroCategoria, setFiltroCategoria] = useState('');
  const [filtroFornecedor, setFiltroFornecedor] = useState('');

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    const [r1, r2, r3] = await Promise.all([
      supabase.from('contas_a_pagar')
        .select('*, fornecedores(nome), responsavel:funcionarios(nome), recebimentos(data, nota_fiscal), contas_a_pagar_parcelas(*)')
        .eq('empresa_id', empresaAtual.id)
        .order('created_at', { ascending: false }),
      supabase.from('fornecedores').select('id, nome').eq('empresa_id', empresaAtual.id).order('nome'),
      supabase.from('funcionarios').select('id, nome').eq('empresa_id', empresaAtual.id).eq('ativo', true).order('nome'),
    ]);
    if (r1.error) console.error(r1.error);
    setLista(r1.data || []);
    setFornecedores(r2.data || []);
    setFuncionarios(r3.data || []);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  function origemConta(c) {
    if (c.recebimento_id) return 'Recebimento';
    if (c.nota_fiscal_numero) return 'Nota fiscal avulsa';
    return 'Despesa manual';
  }

  async function registrarConta(e) {
    e.preventDefault();
    if (!lancamento.descricao || !lancamento.fornecedor_id || !lancamento.valor_total) {
      alert('Preencha descrição, fornecedor e valor.');
      return;
    }
    setSalvando(true);
    try {
      const { data: conta, error } = await supabase.from('contas_a_pagar').insert([{
        descricao: lancamento.descricao,
        categoria_conta: lancamento.categoria_conta,
        fornecedor_id: lancamento.fornecedor_id,
        nota_fiscal_numero: lancamento.nota_fiscal_numero || null,
        valor_total: Number(lancamento.valor_total),
        responsavel_id: lancamento.responsavel_id || null,
        empresa_id: empresaAtual.id,
      }]).select('id').single();

      if (error) { alert('Erro ao salvar: ' + error.message); return; }

      if (lancamento.notaFiscalArquivo) {
        try {
          const path = await uploadArquivoContaAPagar(empresaAtual.id, conta.id, 'nota-fiscal', lancamento.notaFiscalArquivo);
          await supabase.from('contas_a_pagar').update({ nota_fiscal_anexo_path: path }).eq('id', conta.id);
        } catch (upErr) {
          alert('Conta salva, mas o anexo da nota fiscal falhou: ' + upErr.message);
        }
      }

      const numeroParcelas = lancamento.condicao_pagamento === 'Parcelado' ? Number(lancamento.numero_parcelas) : 1;
      const parcelas = gerarParcelas(lancamento.data, Number(lancamento.valor_total), numeroParcelas, Number(lancamento.intervalo_dias));
      const { error: e2 } = await supabase.from('contas_a_pagar_parcelas').insert(
        parcelas.map(p => ({
          conta_a_pagar_id: conta.id, numero: p.numero, valor: p.valor, vencimento: p.vencimento,
          empresa_id: empresaAtual.id,
        }))
      );
      if (e2) { alert('Conta criada, mas houve erro ao gerar as parcelas: ' + e2.message); }

      setLancamento(LANCAMENTO_VAZIO());
      carregar();
    } finally {
      setSalvando(false);
    }
  }

  function abrirBaixa(parcela) {
    setBaixaAtiva({ parcelaId: parcela.id, data_pagamento: hoje(), forma_pagamento: FORMAS_PAGAMENTO[0], comprovanteArquivo: null });
  }

  async function confirmarBaixa() {
    const { parcelaId, data_pagamento, forma_pagamento, comprovanteArquivo } = baixaAtiva;
    let comprovante_path = null;
    if (comprovanteArquivo) {
      try {
        comprovante_path = await uploadArquivoContaAPagar(empresaAtual.id, parcelaId, 'comprovante', comprovanteArquivo);
      } catch (upErr) {
        alert('Erro ao enviar comprovante: ' + upErr.message);
        return;
      }
    }
    const { error } = await supabase.from('contas_a_pagar_parcelas').update({
      status: 'Pago', data_pagamento, forma_pagamento, comprovante_path,
    }).eq('id', parcelaId);
    if (error) { alert('Erro ao dar baixa: ' + error.message); return; }
    setBaixaAtiva(null);
    carregar();
  }

  async function verAnexo(path) {
    if (!path) return;
    try {
      const url = await signedUrlContaAPagar(path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      alert('Não foi possível abrir o anexo: ' + err.message);
    }
  }

  if (loading) return <p className="muted">Carregando…</p>;

  if (!fornecedores.length) {
    return (
      <div className="banner info">
        Cadastre ao menos um <b>fornecedor</b> antes de lançar uma conta a pagar.
      </div>
    );
  }

  const parcelasFlat = lista.flatMap(c => (c.contas_a_pagar_parcelas || []).map(p => ({ ...p, conta: c })));
  const parcelasFiltradas = parcelasFlat
    .filter(p => {
      const vencida = isVencida(p);
      if (filtroStatus === 'Vencida' && !vencida) return false;
      if (filtroStatus === 'Pendente' && (p.status !== 'Pendente' || vencida)) return false;
      if (filtroStatus === 'Pago' && p.status !== 'Pago') return false;
      if (filtroCategoria && p.conta.categoria_conta !== filtroCategoria) return false;
      if (filtroFornecedor && p.conta.fornecedor_id !== filtroFornecedor) return false;
      return true;
    })
    .sort((a, b) => (a.vencimento < b.vencimento ? -1 : 1));

  return (
    <>
      <div className="panel">
        <h3>Lançar conta a pagar</h3>
        <form onSubmit={registrarConta} className="form-grid">
          <div><label>Descrição</label>
            <input required placeholder="Aluguel, energia, serviço..." value={lancamento.descricao}
              onChange={e => setLancamento({ ...lancamento, descricao: e.target.value })} />
          </div>
          <div><label>Categoria</label>
            <select value={lancamento.categoria_conta} onChange={e => setLancamento({ ...lancamento, categoria_conta: e.target.value })}>
              {CATEGORIAS_CONTA.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div><label>Fornecedor</label>
            <select required value={lancamento.fornecedor_id} onChange={e => setLancamento({ ...lancamento, fornecedor_id: e.target.value })}>
              <option value="">Selecione…</option>
              {fornecedores.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </div>
          <div><label>Nota fiscal (nº, opcional)</label>
            <input value={lancamento.nota_fiscal_numero} onChange={e => setLancamento({ ...lancamento, nota_fiscal_numero: e.target.value })} />
          </div>
          <div><label>Anexo da nota fiscal (opcional)</label>
            <input type="file" accept="application/pdf,image/*" onChange={e => setLancamento({ ...lancamento, notaFiscalArquivo: e.target.files?.[0] || null })} />
          </div>
          <div><label>Data</label>
            <input type="date" value={lancamento.data} onChange={e => setLancamento({ ...lancamento, data: e.target.value })} />
          </div>
          <div><label>Valor total (R$)</label>
            <input type="number" step="0.01" required value={lancamento.valor_total} onChange={e => setLancamento({ ...lancamento, valor_total: e.target.value })} />
          </div>
          <div><label>Responsável</label>
            <select value={lancamento.responsavel_id} onChange={e => setLancamento({ ...lancamento, responsavel_id: e.target.value })}>
              <option value="">Selecione…</option>
              {funcionarios.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </div>
          <div><label>Condição de pagamento</label>
            <select value={lancamento.condicao_pagamento} onChange={e => setLancamento({ ...lancamento, condicao_pagamento: e.target.value })}>
              <option>À vista</option>
              <option>Parcelado</option>
            </select>
          </div>
          {lancamento.condicao_pagamento === 'Parcelado' && (
            <>
              <div><label>Nº de parcelas</label>
                <input type="number" min="2" value={lancamento.numero_parcelas} onChange={e => setLancamento({ ...lancamento, numero_parcelas: e.target.value })} />
              </div>
              <div><label>Intervalo entre parcelas (dias)</label>
                <input type="number" min="1" value={lancamento.intervalo_dias} onChange={e => setLancamento({ ...lancamento, intervalo_dias: e.target.value })} />
              </div>
            </>
          )}
          <div><button className="btn" type="submit" disabled={salvando}>{salvando ? 'Lançando…' : 'Lançar conta'}</button></div>
        </form>
      </div>

      <div className="panel">
        <h3>Contas a pagar ({parcelasFiltradas.length})</h3>
        <div className="form-grid" style={{ marginBottom: 12 }}>
          <div><label>Status</label>
            <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}>
              <option value="">Todas</option>
              <option value="Pendente">Pendente</option>
              <option value="Vencida">Vencida</option>
              <option value="Pago">Pago</option>
            </select>
          </div>
          <div><label>Categoria</label>
            <select value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value)}>
              <option value="">Todas</option>
              {CATEGORIAS_CONTA.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div><label>Fornecedor</label>
            <select value={filtroFornecedor} onChange={e => setFiltroFornecedor(e.target.value)}>
              <option value="">Todos</option>
              {fornecedores.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Vencimento</th><th>Descrição</th><th>Fornecedor</th><th>Categoria</th><th>Origem</th><th>Parcela</th><th>Valor</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {parcelasFiltradas.length ? parcelasFiltradas.map(p => {
                const vencida = isVencida(p);
                const tagStatus = p.status === 'Pago' ? 'ok' : vencida ? 'bad' : 'warn';
                const totalParcelas = (p.conta.contas_a_pagar_parcelas || []).length;
                return (
                  <tr key={p.id}>
                    <td>{fmtDate(p.vencimento)}</td>
                    <td>{p.conta.descricao}</td>
                    <td className="muted">{p.conta.fornecedores?.nome || '—'}</td>
                    <td className="muted">{p.conta.categoria_conta}</td>
                    <td className="muted">{origemConta(p.conta)}</td>
                    <td className="num">{p.numero}/{totalParcelas}</td>
                    <td className="num">{fmtMoney(p.valor)}</td>
                    <td><span className={`tag ${tagStatus}`}>{p.status === 'Pago' ? 'Pago' : vencida ? 'Vencida' : 'Pendente'}</span></td>
                    <td>
                      <div className="row-actions">
                        {p.status === 'Pendente' && (
                          <button className="btn secondary small" onClick={() => abrirBaixa(p)}>Dar baixa</button>
                        )}
                        <button className="btn secondary small" disabled={!p.conta.nota_fiscal_anexo_path} onClick={() => verAnexo(p.conta.nota_fiscal_anexo_path)}>Ver NF</button>
                        <button className="btn secondary small" disabled={!p.comprovante_path} onClick={() => verAnexo(p.comprovante_path)}>Ver comprovante</button>
                      </div>
                      {baixaAtiva?.parcelaId === p.id && (
                        <div className="items-list" style={{ marginTop: 8 }}>
                          <div className="form-grid">
                            <div><label>Data do pagamento</label>
                              <input type="date" value={baixaAtiva.data_pagamento} onChange={e => setBaixaAtiva({ ...baixaAtiva, data_pagamento: e.target.value })} />
                            </div>
                            <div><label>Forma de pagamento</label>
                              <select value={baixaAtiva.forma_pagamento} onChange={e => setBaixaAtiva({ ...baixaAtiva, forma_pagamento: e.target.value })}>
                                {FORMAS_PAGAMENTO.map(f => <option key={f}>{f}</option>)}
                              </select>
                            </div>
                            <div><label>Comprovante (opcional)</label>
                              <input type="file" accept="application/pdf,image/*" onChange={e => setBaixaAtiva({ ...baixaAtiva, comprovanteArquivo: e.target.files?.[0] || null })} />
                            </div>
                            <div className="row-actions">
                              <button className="btn small" onClick={confirmarBaixa}>Confirmar pagamento</button>
                              <button className="btn secondary small" onClick={() => setBaixaAtiva(null)}>Cancelar</button>
                            </div>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              }) : <tr className="empty-row"><td colSpan={9}>Nenhuma conta a pagar encontrada.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Testar no navegador — lançamento manual (despesa sem nota)**

Run: `npm run dev`, faça login como admin, acesse Financeiro na sidebar (o link já deve aparecer — Task 4).
Preencha "Lançar conta a pagar" com uma despesa manual (ex: "Aluguel agosto", categoria "Custos Fixos", um fornecedor qualquer, sem nota fiscal, à vista, valor 1500).
Expected: a conta aparece na listagem logo abaixo com Origem "Despesa manual", status "Pendente", vencimento igual à data escolhida.

- [ ] **Step 3: Testar no navegador — nota fiscal avulsa parcelada**

Lance outra conta preenchendo o número da nota fiscal e "Parcelado", 3 parcelas, intervalo 30 dias.
Expected: aparecem 3 linhas na listagem (mesma descrição, parcela 1/3, 2/3, 3/3), Origem "Nota fiscal avulsa", vencimentos espaçados por 30 dias a partir da data escolhida, soma dos 3 valores bate com o valor total lançado.

- [ ] **Step 4: Testar no navegador — dar baixa**

Clique "Dar baixa" numa parcela pendente, preencha data e forma de pagamento, confirme.
Expected: status vira "Pago" (tag verde), some o botão "Dar baixa" dessa linha.

- [ ] **Step 5: Testar filtros**

Use os três filtros (Status, Categoria, Fornecedor) isoladamente e combinados.
Expected: a tabela reduz corretamente em cada caso; filtro "Vencida" só mostra parcelas com `status = Pendente` e `vencimento` no passado.

- [ ] **Step 6: Commit**

```bash
git add app/financeiro/contas-a-pagar/page.js
git commit -m "feat: add Financeiro (Contas a Pagar) screen"
```

---

### Task 7: Recebimento gera Conta a Pagar automaticamente

**Files:**
- Modify: `app/recebimentos/page.js`

**Interfaces:**
- Consumes: `CATEGORIAS_CONTA`, `gerarParcelas` from `lib/financeiro.js` (Task 2); the existing `registrarNota()` and `excluirNota()` functions in this file, and the existing `CABECALHO_VAZIO()` factory.
- Produces: `contas_a_pagar` + `contas_a_pagar_parcelas` rows on every new recebimento with at least one accepted item — no other file consumes this directly (verified via SQL / Financeiro screen).

- [ ] **Step 1: Add the import**

At the top of `app/recebimentos/page.js`, add:
```js
import { CATEGORIAS_CONTA, gerarParcelas } from '../../lib/financeiro';
```

- [ ] **Step 2: Add payment-condition fields to `CABECALHO_VAZIO`**

Replace:
```js
const CABECALHO_VAZIO = () => ({
  data: hoje(), fornecedor_id: '', nota_fiscal: '', responsavel_id: '',
  temperatura_c: '', notaFiscalArquivo: null,
});
```
with:
```js
const CABECALHO_VAZIO = () => ({
  data: hoje(), fornecedor_id: '', nota_fiscal: '', responsavel_id: '',
  temperatura_c: '', notaFiscalArquivo: null,
  condicao_pagamento: 'À vista', numero_parcelas: 2, intervalo_dias: 30,
  categoria_conta_pagar: 'Custos Diretos',
});
```

- [ ] **Step 3: Add the payment-condition block to the form**

In the header `form-grid` (right after the "Anexo da nota fiscal" field, still inside the same `<div className="form-grid">`), add:
```jsx
          <div><label>Condição de pagamento</label>
            <select value={cabecalho.condicao_pagamento} onChange={e => setCabecalho({ ...cabecalho, condicao_pagamento: e.target.value })}>
              <option>À vista</option>
              <option>Parcelado</option>
            </select>
          </div>
          {cabecalho.condicao_pagamento === 'Parcelado' && (
            <>
              <div><label>Nº de parcelas</label>
                <input type="number" min="2" value={cabecalho.numero_parcelas} onChange={e => setCabecalho({ ...cabecalho, numero_parcelas: e.target.value })} />
              </div>
              <div><label>Intervalo entre parcelas (dias)</label>
                <input type="number" min="1" value={cabecalho.intervalo_dias} onChange={e => setCabecalho({ ...cabecalho, intervalo_dias: e.target.value })} />
              </div>
            </>
          )}
          <div><label>Categoria da conta a pagar</label>
            <select value={cabecalho.categoria_conta_pagar} onChange={e => setCabecalho({ ...cabecalho, categoria_conta_pagar: e.target.value })}>
              {CATEGORIAS_CONTA.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
```

- [ ] **Step 4: Generate the payable inside `registrarNota`**

In `registrarNota`, right after the `for (const item of itensDraft) { ... }` loop finishes (still inside the `try` block, before `setCabecalho(CABECALHO_VAZIO())`), add:
```js
      const totalAceito = itensDraft
        .filter(it => ['Aceito', 'Aceito com ressalva'].includes(it.status_recebimento))
        .reduce((s, it) => s + Number(it.quantidade) * Number(it.custo_unitario), 0);

      if (totalAceito > 0) {
        const nomeFornecedor = fornecedores.find(f => f.id === cabecalho.fornecedor_id)?.nome || '';
        const { data: conta, error: e3 } = await supabase.from('contas_a_pagar').insert([{
          descricao: `Nota ${cabecalho.nota_fiscal || nota.id.slice(0, 8)} — ${nomeFornecedor}`,
          categoria_conta: cabecalho.categoria_conta_pagar,
          fornecedor_id: cabecalho.fornecedor_id,
          recebimento_id: nota.id,
          valor_total: totalAceito,
          responsavel_id: cabecalho.responsavel_id || null,
          empresa_id: empresaAtual.id,
        }]).select('id').single();

        if (e3) {
          alert('Nota registrada, mas houve erro ao gerar a conta a pagar: ' + e3.message);
        } else {
          const numeroParcelas = cabecalho.condicao_pagamento === 'Parcelado' ? Number(cabecalho.numero_parcelas) : 1;
          const parcelas = gerarParcelas(cabecalho.data, totalAceito, numeroParcelas, Number(cabecalho.intervalo_dias));
          const { error: e4 } = await supabase.from('contas_a_pagar_parcelas').insert(
            parcelas.map(p => ({ conta_a_pagar_id: conta.id, numero: p.numero, valor: p.valor, vencimento: p.vencimento, empresa_id: empresaAtual.id }))
          );
          if (e4) alert('Conta a pagar criada, mas houve erro ao gerar as parcelas: ' + e4.message);
        }
      }
```

- [ ] **Step 5: Reorder `excluirNota` so storage cleanup only happens after a successful delete**

Replace:
```js
  async function excluirNota(r) {
    if (!confirm('Excluir esta nota inteira (todos os itens)? O saldo de estoque será recalculado.')) return;
    const fotos = (r.recebimento_itens || []).map(it => it.foto_produto_url);
    await removerAnexosRecebimento([r.nota_fiscal_arquivo_url, ...fotos]);
    const { error } = await supabase.from('recebimentos').delete().eq('id', r.id);
    if (error) alert('Erro ao excluir: ' + error.message);
    carregar();
  }
```
with:
```js
  async function excluirNota(r) {
    if (!confirm('Excluir esta nota inteira (todos os itens)? O saldo de estoque será recalculado.')) return;
    const { error } = await supabase.from('recebimentos').delete().eq('id', r.id);
    if (error) {
      alert(error.message.includes('parcela paga')
        ? 'Não é possível excluir: esta nota já tem uma parcela paga em Contas a Pagar. Ajuste em Financeiro antes.'
        : 'Erro ao excluir: ' + error.message);
      return;
    }
    const fotos = (r.recebimento_itens || []).map(it => it.foto_produto_url);
    await removerAnexosRecebimento([r.nota_fiscal_arquivo_url, ...fotos]);
    carregar();
  }
```
(Note: storage cleanup now runs only when the delete actually succeeds — before this change, attachments could be wiped even if the DB delete failed for any reason.)

- [ ] **Step 6: Testar no navegador — geração à vista**

Run: `npm run dev`, vá em Recebimento, registre uma nota com 1 item "Aceito", condição "À vista", categoria padrão "Custos Diretos".
Expected: nota salva normalmente. Vá em Financeiro → Contas a Pagar: aparece 1 parcela, Origem "Recebimento", vencimento igual à data da nota, valor igual a `quantidade × custo_unitário` do item.

- [ ] **Step 7: Testar no navegador — geração parcelada com item rejeitado**

Registre outra nota com 2 itens: um "Aceito" (valor A) e um "Rejeitado" (valor B), condição "Parcelado", 2 parcelas, intervalo 15 dias.
Expected: em Financeiro, aparecem 2 parcelas somando exatamente o valor A (o item rejeitado não entra), vencimentos espaçados por 15 dias a partir da data da nota.

- [ ] **Step 8: Testar no navegador — nota 100% rejeitada não gera conta**

Registre uma nota com 1 item "Rejeitado".
Expected: nota salva, mas nenhuma conta a pagar nova aparece em Financeiro pra essa nota.

- [ ] **Step 9: Testar no navegador — bloqueio de exclusão**

Na nota do Step 6, vá em Financeiro e dê baixa na parcela gerada. Volte em Recebimento e tente "Excluir nota" nessa mesma nota.
Expected: alerta "Não é possível excluir: esta nota já tem uma parcela paga...", a nota continua na lista.

- [ ] **Step 10: Commit**

```bash
git add app/recebimentos/page.js
git commit -m "feat: generate contas a pagar from recebimento, block deletion when paid"
```

---

### Task 8: Relatórios — trocar fonte de `despesas` para `contas_a_pagar`

**Files:**
- Modify: `app/relatorios/page.js`

**Interfaces:**
- Consumes: `contas_a_pagar` table (Task 1), column `valor_total`.

- [ ] **Step 1: Trocar a query**

Replace:
```js
      const [pedidos, producoes, recebimentos, despesas, fornecedores, fichas, mps] = await Promise.all([
        supabase.from('pedidos').select('status, pedido_itens(produto_id, quantidade, preco_unitario)').eq('empresa_id', eid),
        supabase.from('producoes').select('*, produtos(nome)').eq('empresa_id', eid).order('data'),
        supabase.from('recebimento_itens').select('materia_prima_id, quantidade, custo_unitario, status_recebimento, recebimentos(fornecedor_id)').eq('empresa_id', eid),
        supabase.from('despesas').select('valor').eq('empresa_id', eid),
        supabase.from('fornecedores').select('id, nome').eq('empresa_id', eid).order('nome'),
        supabase.from('ficha_tecnica').select('*').eq('empresa_id', eid),
        supabase.from('materias_primas').select('*').eq('empresa_id', eid),
      ]);
      setD({
        pedidos: pedidos.data || [],
        producoes: producoes.data || [],
        recebimentos: recebimentos.data || [],
        despesas: despesas.data || [],
        fornecedores: fornecedores.data || [],
        fichas: fichas.data || [],
        mps: mps.data || [],
      });
```
with:
```js
      const [pedidos, producoes, recebimentos, contasAPagar, fornecedores, fichas, mps] = await Promise.all([
        supabase.from('pedidos').select('status, pedido_itens(produto_id, quantidade, preco_unitario)').eq('empresa_id', eid),
        supabase.from('producoes').select('*, produtos(nome)').eq('empresa_id', eid).order('data'),
        supabase.from('recebimento_itens').select('materia_prima_id, quantidade, custo_unitario, status_recebimento, recebimentos(fornecedor_id)').eq('empresa_id', eid),
        supabase.from('contas_a_pagar').select('valor_total').eq('empresa_id', eid),
        supabase.from('fornecedores').select('id, nome').eq('empresa_id', eid).order('nome'),
        supabase.from('ficha_tecnica').select('*').eq('empresa_id', eid),
        supabase.from('materias_primas').select('*').eq('empresa_id', eid),
      ]);
      setD({
        pedidos: pedidos.data || [],
        producoes: producoes.data || [],
        recebimentos: recebimentos.data || [],
        contasAPagar: contasAPagar.data || [],
        fornecedores: fornecedores.data || [],
        fichas: fichas.data || [],
        mps: mps.data || [],
      });
```

- [ ] **Step 2: Renomear o total derivado**

Replace:
```js
  const despesasTotal = d.despesas.reduce((s, x) => s + Number(x.valor), 0);
```
with:
```js
  const despesasTotal = d.contasAPagar.reduce((s, x) => s + Number(x.valor_total), 0);
```
(A variável `despesasTotal` continua com esse nome de propósito — é o que já aparece nos rótulos "Despesas operacionais" do DRE, sem mudar a UI deste relatório neste ciclo.)

- [ ] **Step 3: Testar no navegador**

Run: `npm run dev`, acesse Relatórios com uma empresa que já tenha contas a pagar lançadas (Task 6/7).
Expected: "DRE simplificado" e "Fluxo de caixa" mostram a soma de `valor_total` de todas as contas a pagar dessa empresa em "Despesas operacionais" — confira manualmente somando os valores mostrados em Financeiro.

- [ ] **Step 4: Commit**

```bash
git add app/relatorios/page.js
git commit -m "feat: source Relatórios despesas total from contas_a_pagar"
```

---

## Self-Review

**Spec coverage:**
- Categorias de conta fixas → `lib/financeiro.js` (`CATEGORIAS_CONTA`), check constraint no banco. ✓
- `contas_a_pagar` + `contas_a_pagar_parcelas`, campos exatos do spec → Task 1. ✓
- Fornecedor e categoria obrigatórios em toda conta → `not null` no schema + `required` nos dois formulários (manual e Recebimento). ✓
- Três origens (Recebimento / nota avulsa / despesa manual) na mesma listagem → `origemConta()` em Task 6. ✓
- Geração automática ao salvar Recebimento, só itens Aceito/Aceito com ressalva, categoria sugerida editável → Task 7. ✓
- Condição de pagamento capturada no formulário de Recebimento, não persistida em `recebimentos` → confirmado, `cabecalho.condicao_pagamento` só existe no estado do React, nunca é inserido em `recebimentos`. ✓
- Parcelamento, vencimento, status, data/forma de pagamento, comprovante → schema + UI de baixa em Task 6. ✓
- Bloqueio de exclusão de recebimento com parcela paga; cascade quando não paga → trigger + FK `on delete cascade` em Task 1. ✓
- Migração de `despesas` → `contas_a_pagar`, aposentadoria da tela → Task 1 (SQL) + Task 5 (redirect) + Task 4 (sidebar). ✓
- Impacto em Relatórios → Task 8. ✓
- Fora de escopo (Pedido de Compra, subcategorias, recálculo automático em edição posterior) → nenhuma task tenta isso; confirmado que não vazou pro plano.

**Placeholder scan:** nenhum "TBD"/"implementar depois" — todo passo tem código ou comando exato e o output esperado por extenso.

**Type consistency:** `gerarParcelas` retorna `{numero, valor, vencimento}` em `lib/financeiro.js` (Task 2) e é consumido com esses três campos exatos em Task 6 e Task 7 (`p.numero`, `p.valor`, `p.vencimento`). `isVencida(parcela)` espera `{status, vencimento}` — as duas chamadas (Task 6, listagem) passam objetos de `contas_a_pagar_parcelas` que têm ambos os campos. `CATEGORIAS_CONTA` é usado idêntico nos dois formulários (Task 6 e Task 7) e bate com o `check` constraint do banco (Task 1) — os 4 valores são textualmente idênticos nos três lugares.

---

## Próximos passos (fora deste plano)

Pedido de Compra, subcategorias de conta, e os outros 5 módulos da análise de requisitos (Compras avançado, Produção, Relatórios avançado, Vendas, Pessoas) ficam para ciclos de brainstorming + plano separados, como já vinha acontecendo neste projeto módulo a módulo.
