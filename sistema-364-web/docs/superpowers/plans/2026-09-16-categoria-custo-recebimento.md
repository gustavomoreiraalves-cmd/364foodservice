# Categoria de Custo por Item de Recebimento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir classificar cada item de recebimento de matéria-prima como Custo Fixo/Direto/Variável/Investimento, sem alterar o fluxo de `contas_a_pagar` (continua 1 conta por nota), para que o DRE em `app/relatorios/page.js` mostre as saídas de compra separadas por categoria.

**Architecture:** `recebimento_itens` ganha a coluna `categoria_conta` (mesmo enum já usado em `contas_a_pagar.categoria_conta`). `materias_primas` ganha `categoria_conta_padrao`, usada só para pré-preencher o select no recebimento. Nenhuma tabela nova: `app/relatorios/page.js` já lê `recebimento_itens` diretamente para compor `comprasTotal` — basta trazer a coluna nova e agrupar com uma função pura nova em `lib/financeiro.js`. `contas_a_pagar` e a geração de parcelas (`lib/nfe/parcelas.js`) não mudam.

**Tech Stack:** Next.js (app router, JS puro, sem TS), Supabase/Postgres, testes com `node:test` (`node --test tests/*.test.mjs`).

**Spec:** Esta conversa — decisão do usuário: manter 1 conta a pagar por nota, guardar a categoria por item e ratear "à parte" (dentro do próprio `recebimento_itens`, sem tabela extra) para o DRE.

## Global Constraints

- Categorias válidas: exatamente `['Custos Fixos', 'Custos Diretos', 'Custos Variáveis', 'Investimentos']` — a mesma lista de `lib/financeiro.js:3` (`CATEGORIAS_CONTA`). Não criar um enum novo.
- `contas_a_pagar` continua com 1 linha por nota e `categoria_conta` no header (`app/recebimentos/page.js:509`) — não tocar nesse insert nem em `lib/nfe/parcelas.js`.
- Migrations seguem o padrão do repo: arquivo novo `supabase/atualizacao_54_<nome>.sql`, comandos `alter table ... add column if not exists`, idempotente (pode rodar mais de uma vez sem erro). Nota: `atualizacao_53_condicao_pagamento.sql` já existe untracked em outra branch/worktree em andamento — não reaproveitar o número 53.
- Sem framework de UI de testes; mudanças de tela são verificadas manualmente rodando `npm run dev` e usando o formulário — `.env.local` aponta para o Supabase de **produção** (ver memória do projeto), então teste com dado de mentira e evite mexer em recebimentos reais.

---

### Task 1: Migration — colunas de categoria de custo

**Files:**
- Create: `supabase/atualizacao_54_categoria_conta_recebimento.sql`

**Interfaces:**
- Produces: coluna `materias_primas.categoria_conta_padrao` (text, nullable, check-constrained) e `recebimento_itens.categoria_conta` (text, not null, default `'Custos Diretos'`, check-constrained) — usadas pelas Tasks 2–5.

- [ ] **Step 1: Escrever a migration**

```sql
-- supabase/atualizacao_54_categoria_conta_recebimento.sql
-- Categoria de custo (Fixo/Direto/Variável/Investimento) por item de recebimento,
-- para o DRE separar compras de matéria-prima por natureza do custo.
-- Mesmo enum de contas_a_pagar.categoria_conta (ver atualizacao_16).

alter table public.materias_primas
  add column if not exists categoria_conta_padrao text;

alter table public.materias_primas
  drop constraint if exists materias_primas_categoria_conta_padrao_valida;
alter table public.materias_primas
  add constraint materias_primas_categoria_conta_padrao_valida
  check (categoria_conta_padrao is null or categoria_conta_padrao in
    ('Custos Fixos', 'Custos Diretos', 'Custos Variáveis', 'Investimentos'));

alter table public.recebimento_itens
  add column if not exists categoria_conta text not null default 'Custos Diretos';

alter table public.recebimento_itens
  drop constraint if exists recebimento_itens_categoria_conta_valida;
alter table public.recebimento_itens
  add constraint recebimento_itens_categoria_conta_valida
  check (categoria_conta in
    ('Custos Fixos', 'Custos Diretos', 'Custos Variáveis', 'Investimentos'));
```

- [ ] **Step 2: Rodar a migration no Supabase de produção**

Abrir o SQL editor do Supabase (ou `psql "$SUPABASE_DB_URL" -f supabase/atualizacao_54_categoria_conta_recebimento.sql`) e executar. Confirmar sem erro.

- [ ] **Step 3: Verificar as colunas**

```bash
psql "$SUPABASE_DB_URL" -c "\d materias_primas" | grep categoria_conta_padrao
psql "$SUPABASE_DB_URL" -c "\d recebimento_itens" | grep categoria_conta
```
Esperado: as duas colunas aparecem, `recebimento_itens.categoria_conta` como `not null`.

- [ ] **Step 4: Commit**

```bash
git add supabase/atualizacao_54_categoria_conta_recebimento.sql
git commit -m "feat(financeiro): adiciona categoria de custo por item de recebimento"
```

---

### Task 2: Função pura de agrupamento por categoria

**Files:**
- Modify: `lib/financeiro.js`
- Test: `tests/financeiro-categoria.test.mjs`

**Interfaces:**
- Consumes: nada de tasks anteriores (função pura, sem I/O).
- Produces: `agruparPorCategoria(itens)` — `itens: Array<{categoria_conta: string, quantidade: number|string, custo_unitario: number|string}>` → `Record<string, number>` (chave = categoria, valor = soma de `quantidade * custo_unitario`, arredondado a 2 casas; categorias com total zero não entram no objeto). Usada por `app/relatorios/page.js` (Task 5) e `app/recebimentos/page.js` (Task 4, opcional para preview).

- [ ] **Step 1: Escrever o teste que falha**

```js
// tests/financeiro-categoria.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'chave-anon-de-teste';
const { agruparPorCategoria } = await import('../lib/financeiro.js');

test('soma quantidade*custo_unitario por categoria', () => {
  const itens = [
    { categoria_conta: 'Custos Variáveis', quantidade: 10, custo_unitario: 5 },
    { categoria_conta: 'Custos Variáveis', quantidade: 2, custo_unitario: 3 },
    { categoria_conta: 'Custos Fixos', quantidade: 1, custo_unitario: 120 },
  ];
  assert.deepEqual(agruparPorCategoria(itens), {
    'Custos Variáveis': 56,
    'Custos Fixos': 120,
  });
});

test('ignora itens sem categoria_conta e trata strings numéricas', () => {
  const itens = [
    { categoria_conta: null, quantidade: 10, custo_unitario: 5 },
    { categoria_conta: 'Investimentos', quantidade: '2', custo_unitario: '99.9' },
  ];
  assert.deepEqual(agruparPorCategoria(itens), { Investimentos: 199.8 });
});

test('lista vazia retorna objeto vazio', () => {
  assert.deepEqual(agruparPorCategoria([]), {});
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test tests/financeiro-categoria.test.mjs`
Expected: FAIL — `agruparPorCategoria is not a function` (ainda não exportada).

- [ ] **Step 3: Implementar em `lib/financeiro.js`**

Adicionar ao final do arquivo (depois de `isVencida`, mantendo `CATEGORIAS_CONTA` como já existe na linha 3):

```js
export function agruparPorCategoria(itens) {
  const totais = {};
  for (const item of itens || []) {
    if (!item?.categoria_conta) continue;
    const valor = Number(item.quantidade) * Number(item.custo_unitario);
    if (!valor) continue;
    totais[item.categoria_conta] = Math.round(((totais[item.categoria_conta] || 0) + valor) * 100) / 100;
  }
  return totais;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test tests/financeiro-categoria.test.mjs`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add lib/financeiro.js tests/financeiro-categoria.test.mjs
git commit -m "feat(financeiro): agrupa custos de recebimento por categoria"
```

---

### Task 3: Categoria padrão no cadastro de matéria-prima

**Files:**
- Modify: `app/materias-primas/page.js`

**Interfaces:**
- Consumes: `CATEGORIAS_CONTA` de `lib/financeiro.js` (Task 2, já existe desde antes na linha 3 do módulo).
- Produces: campo `categoria_conta_padrao` no registro de `materias_primas`, lido pela Task 4 para pré-preencher o item de recebimento.

- [ ] **Step 1: Importar `CATEGORIAS_CONTA` e adicionar o campo ao estado do formulário**

Em `app/materias-primas/page.js`, junto ao import existente do topo, adicionar:

```js
import { CATEGORIAS_CONTA } from '../../lib/financeiro';
```

Alterar a linha 9 de:
```js
const MP_VAZIA = { nome: '', categoria: '', unidade: 'kg', custo_unitario: '', preco_alvo_kg: '' };
```
para:
```js
const MP_VAZIA = { nome: '', categoria: '', unidade: 'kg', custo_unitario: '', preco_alvo_kg: '', categoria_conta_padrao: '' };
```

- [ ] **Step 2: Adicionar o select no formulário**

Logo depois do campo "Categoria" (linha 63, `<div><label>Categoria</label><input .../></div>`), inserir:

```jsx
<div>
  <label>Categoria de custo (DRE)</label>
  <select value={form.categoria_conta_padrao} onChange={e => setForm({ ...form, categoria_conta_padrao: e.target.value })}>
    <option value="">Sem padrão (escolher em cada recebimento)</option>
    {CATEGORIAS_CONTA.map(c => <option key={c} value={c}>{c}</option>)}
  </select>
</div>
```

- [ ] **Step 3: Incluir no payload gravado (`paraGravar`, linhas 41-50)**

Adicionar `categoria_conta_padrao: form.categoria_conta_padrao || null,` ao objeto retornado por `paraGravar`.

- [ ] **Step 4: Verificar manualmente**

Rodar `npm run dev`, abrir `/materias-primas`, criar/editar uma matéria-prima de teste, escolher uma categoria de custo, salvar, recarregar a página e confirmar que o select mantém o valor salvo.

- [ ] **Step 5: Commit**

```bash
git add app/materias-primas/page.js
git commit -m "feat(materias-primas): categoria de custo padrão para o DRE"
```

---

### Task 4: Categoria por item no recebimento

**Files:**
- Modify: `app/recebimentos/page.js`

**Interfaces:**
- Consumes: `mp.categoria_conta_padrao` (Task 3) para default; `header.categoria_conta_pagar` (já existe, linha 37) como fallback quando a matéria-prima não tem padrão.
- Produces: `recebimento_itens.categoria_conta` gravado por item (consumido pela Task 5 no DRE).

- [ ] **Step 1: Adicionar `categoria_conta` ao estado de cada item**

Localizar onde cada linha de item é inicializada (mesmo objeto que gera `materia_prima_id`, `quantidade`, `custo_unitario` antes do insert das linhas 415-432). Ao selecionar a matéria-prima nesse item, definir o default:

```js
categoria_conta: mpsPorId[materiaPrimaId]?.categoria_conta_padrao || header.categoria_conta_pagar,
```

(`mpsPorId` é o mapa/lista de matérias-primas já carregado pela tela — usar a mesma fonte que preenche o select de matéria-prima do item.)

- [ ] **Step 2: Adicionar o select de categoria na linha do item, na tabela de itens**

Ao lado dos campos de quantidade/custo unitário de cada item, adicionar:

```jsx
<select value={item.categoria_conta} onChange={e => atualizarItem(item.id, { categoria_conta: e.target.value })}>
  {CATEGORIAS_CONTA.map(c => <option key={c} value={c}>{c}</option>)}
</select>
```

(usar a função existente de atualização de item da própria tela; `CATEGORIAS_CONTA` já é importado em `page.js` para o select do header, linha ~838-842 — confirmar o import e reaproveitar.)

- [ ] **Step 3: Incluir `categoria_conta` no insert de `recebimento_itens` (linhas 415-432)**

Adicionar `categoria_conta: it.categoria_conta,` ao objeto inserido.

- [ ] **Step 4: Incluir `categoria_conta` no array `inseridos` (linhas 460-468)**

Adicionar `categoriaConta: it.categoria_conta,` (ou nome equivalente já usado no restante do arquivo) para ficar disponível caso a tela precise mostrar um resumo por categoria antes de finalizar — sem alterar o cálculo de `totalAceito` (linhas 498-503), que continua somando tudo independente da categoria.

- [ ] **Step 5: Verificar manualmente**

Rodar `npm run dev`, abrir `/recebimentos`, criar um recebimento de teste com 2+ itens (uma matéria-prima com categoria padrão definida na Task 3, outra sem), confirmar que:
- o item com padrão vem pré-selecionado com a categoria certa;
- o item sem padrão vem com a categoria do header;
- dá pra trocar a categoria de um item individualmente antes de salvar;
- ao finalizar, só 1 `contas_a_pagar` é criada (comportamento inalterado).

- [ ] **Step 6: Commit**

```bash
git add app/recebimentos/page.js
git commit -m "feat(recebimentos): categoria de custo por item"
```

---

### Task 5: DRE — compras separadas por categoria

**Files:**
- Modify: `app/relatorios/page.js`

**Interfaces:**
- Consumes: `agruparPorCategoria` de `lib/financeiro.js` (Task 2); coluna `recebimento_itens.categoria_conta` (Task 1/4).

- [ ] **Step 1: Trazer a coluna na query**

Em `app/relatorios/page.js:28`, mudar:
```js
supabase.from('recebimento_itens').select('materia_prima_id, quantidade, custo_unitario, recebimentos!inner(fornecedor_id, data), inspecoes_qualidade(status)').eq('empresa_id', eid),
```
para:
```js
supabase.from('recebimento_itens').select('materia_prima_id, quantidade, custo_unitario, categoria_conta, recebimentos!inner(fornecedor_id, data), inspecoes_qualidade(status)').eq('empresa_id', eid),
```

- [ ] **Step 2: Carregar `categoria_conta` no mapeamento (linhas 39-44)**

O spread `...r` já traz o campo novo automaticamente (é um `select('*, categoria_conta, ...')` implícito via spread) — nenhuma mudança extra necessária aqui, só confirmar visualmente que `categoria_conta` aparece nos objetos de `recebimentos` depois do map.

- [ ] **Step 3: Importar `agruparPorCategoria` e calcular o breakdown**

No topo do arquivo, junto ao import de `custoMedioMP`:
```js
import { agruparPorCategoria } from '../../lib/financeiro';
```

Logo após a linha 88 (`const comprasTotal = ...`), adicionar:
```js
const comprasPorCategoria = agruparPorCategoria(
  recebimentosValidos.map(r => ({ categoria_conta: r.categoria_conta, quantidade: r.quantidade, custo_unitario: r.custo_unitario }))
);
```

- [ ] **Step 4: Exibir o breakdown no painel "Fluxo de caixa"**

Depois da linha 144 (`<tr><td>Saídas (compras de matéria-prima)</td>...`), adicionar uma linha por categoria presente:
```jsx
{Object.entries(comprasPorCategoria).map(([categoria, valor]) => (
  <tr key={categoria} className="muted">
    <td style={{ paddingLeft: 24 }}>↳ {categoria}</td>
    <td className="num">{fmtMoney(valor)}</td>
  </tr>
))}
```

- [ ] **Step 5: Verificar manualmente**

Rodar `npm run dev`, abrir `/relatorios`, confirmar que abaixo de "Saídas (compras de matéria-prima)" aparecem as sub-linhas por categoria e que a soma delas bate com o total (usar os recebimentos de teste criados na Task 4).

- [ ] **Step 6: Rodar a suíte de testes completa**

Run: `npm test`
Expected: todos os testes passam, incluindo `tests/financeiro-categoria.test.mjs`.

- [ ] **Step 7: Commit**

```bash
git add app/relatorios/page.js
git commit -m "feat(relatorios): DRE mostra compras de matéria-prima por categoria de custo"
```

---

## Self-Review

**Cobertura do spec:** captura de categoria por item (Tasks 1, 3, 4) ✓; `contas_a_pagar` inalterado, 1 linha por nota (nenhuma task toca nele) ✓; rateio "à parte" sem tabela nova, lido direto de `recebimento_itens` (Tasks 2, 5) ✓; DRE mais assertivo (Task 5) ✓.

**Placeholders:** nenhum "TBD"/"similar a task N" — cada step tem código completo.

**Consistência de tipos:** `agruparPorCategoria` definida na Task 2 com a mesma assinatura usada nas Tasks 4 e 5 (`{categoria_conta, quantidade, custo_unitario}[] → Record<string, number>`); nome de coluna `categoria_conta` idêntico em migration, insert e select.
