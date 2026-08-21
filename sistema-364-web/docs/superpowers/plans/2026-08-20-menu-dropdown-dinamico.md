# Menu de navegação por categorias — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganizar a sidebar em seis categorias com accordion, extrair o cadastro de matéria-prima para rota própria e criar as três telas de Vendas como placeholders, sem mudar nenhuma rota existente nem o modelo de permissões.

**Architecture:** Uma nova `lib/menu.js` passa a ser a fonte única da estrutura de navegação, com funções puras de filtro por permissão. `components/SidebarNav.js` renderiza o accordion e `components/AppShell.js` só o instancia. `MODULOS` em `lib/auth.js` continua intacto como catálogo de permissões da tela de Acesso.

**Tech Stack:** Next.js 14 (App Router, client components), React 18, Supabase JS, CSS puro em `app/globals.css`, testes com `node --test` sobre arquivos `.mjs`.

**Spec:** `docs/superpowers/specs/2026-08-20-menu-dropdown-dinamico-design.md`

## Global Constraints

- Nenhuma rota existente muda de URL. Só entram rotas novas.
- Nenhuma migração de banco. Nenhuma permissão nova: matérias-primas usa `produtos`, todas as telas de Vendas usam `pedidos`.
- `MODULOS` em `lib/auth.js` não muda: forma, ids e labels ficam iguais, porque `app/ponto/colaboradores/page.js:552` renderiza os checkboxes de permissão a partir dele.
- Todo texto de interface em português, seguindo o tom das telas existentes.
- Comentários de código em português, como no resto do repositório.
- O projeto não tem infraestrutura de teste de componente React. `npm test` roda só `node --test tests/*.test.mjs`, com funções puras. Tarefas de interface são verificadas por `npm run build` mais checagem manual no navegador, descrita passo a passo. Não instale framework de teste novo.
- Comando de verificação completa: `npm run verify` (roda `npm test` e depois `npm run build`).
- O caminho do projeto contém espaços e acentos. Em teste, converta `import.meta.url` com `fileURLToPath` — nunca use `.pathname` direto.

---

### Task 1: Renomear "Produção Completa" para "Defumação"

Mudança isolada de rótulo. A rota `/producoes/completa` e todo o comportamento da tela continuam iguais.

**Files:**
- Modify: `components/ProducaoTabs.js:9`
- Modify: `app/producoes/completa/page.js:19`

**Interfaces:**
- Consumes: nada.
- Produces: nada. Tarefas seguintes usam o rótulo "Defumação" no menu.

- [ ] **Step 1: Trocar o rótulo da aba**

Em `components/ProducaoTabs.js`, linha 9, trocar:

```js
  { href: '/producoes/completa', label: 'Produção Completa' },
```

por:

```js
  { href: '/producoes/completa', label: 'Defumação' },
```

- [ ] **Step 2: Trocar o título da página**

Em `app/producoes/completa/page.js`, linha 19, trocar:

```jsx
      <AppShell modulo="producoes" titulo="Produção Completa" desc="Fluxo rastreável da Food Services: matéria-prima, lotes, custo e estoque">
```

por:

```jsx
      <AppShell modulo="producoes" titulo="Defumação" desc="Fluxo rastreável da Food Services: matéria-prima, lotes, custo e estoque">
```

- [ ] **Step 3: Confirmar que não sobrou nenhuma outra ocorrência do rótulo antigo**

Run: `grep -rn "Produção Completa" app components lib`
Expected: nenhuma saída (exit code 1).

- [ ] **Step 4: Rodar a verificação**

Run: `npm run verify`
Expected: testes passam e o build termina sem erro.

- [ ] **Step 5: Commit**

```bash
git add components/ProducaoTabs.js app/producoes/completa/page.js
git commit -m "refactor(producao): renomeia Produção Completa para Defumação"
```

---

### Task 2: Extrair o cadastro de matéria-prima para `/materias-primas`

`app/produtos/page.js` tem 308 linhas e faz duas coisas. Esta tarefa move o painel de matéria-prima para uma rota própria. **Atenção:** `app/produtos/page.js` continua precisando da lista `mps` para o select de matéria-prima da ficha técnica e para `custoTeorico` — a query de `materias_primas` **não** sai de lá.

**Files:**
- Create: `app/materias-primas/page.js`
- Modify: `app/produtos/page.js` (remove `MP_VAZIA`, o estado `formMP`, `addMP`, `delMP` e o primeiro `<div className="panel">` do JSX)

**Interfaces:**
- Consumes: `AppShell` de `components/AppShell.js`, `useEmpresaAtual` de `lib/empresa.js`, `fmtMoney` de `lib/format.js`, `supabase` de `lib/supabase.js` — todos já existentes.
- Produces: a rota `/materias-primas`, referenciada pelo MENU na Task 4.

- [ ] **Step 1: Criar a nova página**

Criar `app/materias-primas/page.js` com exatamente este conteúdo:

```jsx
'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { fmtMoney } from '../../lib/format';
import AppShell from '../../components/AppShell';
import { useEmpresaAtual } from '../../lib/empresa';

const MP_VAZIA = { nome: '', categoria: '', unidade: 'kg', custo_unitario: '', preco_alvo_kg: '' };

export default function MateriasPrimasPage() {
  return (
    <AppShell modulo="produtos" titulo="Matéria-prima e insumos" desc="Cadastro de insumos, custo padrão e preço-alvo">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const { empresaAtual } = useEmpresaAtual();
  const [mps, setMps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formMP, setFormMP] = useState(MP_VAZIA);

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    const { data } = await supabase.from('materias_primas').select('*').eq('empresa_id', empresaAtual.id).order('nome');
    setMps(data || []);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  async function addMP(e) {
    e.preventDefault();
    const { error } = await supabase.from('materias_primas').insert([{
      nome: formMP.nome,
      categoria: formMP.categoria || null,
      unidade: formMP.unidade,
      custo_unitario: Number(formMP.custo_unitario),
      preco_alvo_kg: formMP.preco_alvo_kg ? Number(formMP.preco_alvo_kg) : null,
      empresa_id: empresaAtual.id,
    }]);
    if (error) { alert('Erro ao salvar: ' + error.message); return; }
    setFormMP(MP_VAZIA);
    carregar();
  }

  async function delMP(id) {
    if (!confirm('Excluir esta matéria-prima?')) return;
    const { error } = await supabase.from('materias_primas').delete().eq('id', id);
    if (error) alert('Não foi possível excluir (ela pode estar em uso em fichas técnicas ou recebimentos): ' + error.message);
    carregar();
  }

  if (loading) return <p className="muted">Carregando…</p>;

  return (
    <div className="panel">
      <h3>Matérias-primas cadastradas</h3>
      <form onSubmit={addMP} className="form-grid">
        <div><label>Nome</label><input required value={formMP.nome} onChange={e => setFormMP({ ...formMP, nome: e.target.value })} /></div>
        <div><label>Categoria</label><input placeholder="Carnes, Temperos, Embalagens..." value={formMP.categoria} onChange={e => setFormMP({ ...formMP, categoria: e.target.value })} /></div>
        <div><label>Unidade</label>
          <select value={formMP.unidade} onChange={e => setFormMP({ ...formMP, unidade: e.target.value })}>
            <option value="kg">kg</option><option value="g">g</option><option value="un">un</option><option value="L">L</option>
          </select>
        </div>
        <div><label>Custo unitário padrão (R$)</label><input type="number" step="0.01" required value={formMP.custo_unitario} onChange={e => setFormMP({ ...formMP, custo_unitario: e.target.value })} /></div>
        <div><label>Preço-alvo (R$/kg)</label><input type="number" step="0.01" placeholder="Opcional" value={formMP.preco_alvo_kg} onChange={e => setFormMP({ ...formMP, preco_alvo_kg: e.target.value })} /></div>
        <div><button className="btn" type="submit">Adicionar matéria-prima</button></div>
      </form>
      <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
        O preço-alvo é usado no Recebimento para avisar quando o custo do lote vier acima do esperado.
      </p>
      <div className="table-wrap" style={{ marginTop: 14 }}>
        <table>
          <thead><tr><th>Nome</th><th>Categoria</th><th>Unidade</th><th>Custo padrão</th><th>Preço-alvo</th><th></th></tr></thead>
          <tbody>
            {mps.length ? mps.map(m => (
              <tr key={m.id}>
                <td>{m.nome}</td>
                <td className="muted">{m.categoria || '—'}</td>
                <td>{m.unidade}</td>
                <td className="num">{fmtMoney(m.custo_unitario)}</td>
                <td className="num">{m.preco_alvo_kg != null ? fmtMoney(m.preco_alvo_kg) : '—'}</td>
                <td><button className="btn danger" onClick={() => delMP(m.id)}>Excluir</button></td>
              </tr>
            )) : <tr className="empty-row"><td colSpan={6}>Nenhuma matéria-prima.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Remover a constante `MP_VAZIA` de `app/produtos/page.js`**

Apagar a linha 9:

```js
const MP_VAZIA = { nome: '', categoria: '', unidade: 'kg', custo_unitario: '', preco_alvo_kg: '' };
```

- [ ] **Step 3: Remover o estado `formMP` de `app/produtos/page.js`**

Apagar a linha (dentro de `function Conteudo`):

```js
  const [formMP, setFormMP] = useState(MP_VAZIA);
```

Não mexa em `const [mps, setMps] = useState([]);` — ele continua sendo usado.

- [ ] **Step 4: Remover `addMP` e `delMP` de `app/produtos/page.js`**

Apagar as duas funções inteiras. Elas ficam logo antes de `async function addProduto` (nos números de linha do arquivo original, entre 50 e 70 — os passos anteriores já deslocaram isso, então localize pelo conteúdo):

```js
  async function addMP(e) { ... }

  async function delMP(id) { ... }
```

- [ ] **Step 5: Remover o painel de matéria-prima do JSX de `app/produtos/page.js`**

No `return`, apagar o primeiro `<div className="panel">` inteiro — o que começa com `<h3>Matérias-primas cadastradas</h3>` e termina no `</div>` imediatamente antes de `<div className="panel">` com `<h3>Novo produto</h3>`. O `return` passa a começar direto no painel "Novo produto".

- [ ] **Step 6: Confirmar que não sobrou referência morta**

Run: `grep -n "formMP\|MP_VAZIA\|addMP\|delMP" app/produtos/page.js`
Expected: nenhuma saída (exit code 1).

Run: `grep -n "materias_primas\|mps" app/produtos/page.js`
Expected: aparece a query `supabase.from('materias_primas')`, o estado `mps` e os usos em `custoTeorico` e no select da ficha técnica. Se sumiu, você removeu demais — restaure.

- [ ] **Step 7: Rodar a verificação**

Run: `npm run verify`
Expected: testes passam e o build termina sem erro.

- [ ] **Step 8: Checagem manual no navegador**

Run: `npm run dev`

1. Abrir `/materias-primas`. Cadastrar uma matéria-prima de teste e confirmar que ela aparece na tabela.
2. Abrir `/produtos`. Confirmar que o painel de matéria-prima não está mais lá e que a página começa em "Novo produto".
3. Ainda em `/produtos`, num produto existente, abrir o formulário de ficha técnica e confirmar que o select de matéria-prima lista a que você acabou de criar.
4. Adicionar essa matéria-prima à ficha técnica e confirmar que o custo teórico do produto é calculado.
5. Voltar em `/materias-primas` e excluir a matéria-prima de teste (ela vai recusar se estiver em uso na ficha — remova da ficha antes).

- [ ] **Step 9: Commit**

```bash
git add app/materias-primas/page.js app/produtos/page.js
git commit -m "refactor(cadastros): extrai cadastro de matéria-prima para rota própria"
```

---

### Task 3: Criar as três telas stub de Vendas

Placeholders navegáveis. Cada uma diz o que a tela vai fazer, para o menu já refletir o desenho final. A implementação real de cada uma é spec própria.

**Files:**
- Create: `app/vendas/importacao/page.js`
- Create: `app/vendas/buffet/page.js`
- Create: `app/vendas/burguer/page.js`

**Interfaces:**
- Consumes: `AppShell` de `components/AppShell.js`.
- Produces: as rotas `/vendas/importacao`, `/vendas/buffet` e `/vendas/burguer`, referenciadas pelo MENU na Task 4.

- [ ] **Step 1: Criar `app/vendas/importacao/page.js`**

```jsx
'use client';
import AppShell from '../../../components/AppShell';

export default function ImportacaoVendasPage() {
  return (
    <AppShell modulo="pedidos" titulo="Importação de vendas" desc="364 Steakhouse e 364 Foodtruck/Afya">
      <div className="panel">
        <h3>Em construção</h3>
        <p className="muted">
          Esta tela vai importar as vendas da 364 Steakhouse e da 364 Foodtruck/Afya a partir
          do arquivo exportado pelo PDV, casando cada item com o catálogo de produtos e dando
          baixa no estoque.
        </p>
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 2: Criar `app/vendas/buffet/page.js`**

```jsx
'use client';
import AppShell from '../../../components/AppShell';

export default function VendasBuffetPage() {
  return (
    <AppShell modulo="pedidos" titulo="Vendas Buffet" desc="Lançamento manual das vendas da 364 Buffet">
      <div className="panel">
        <h3>Em construção</h3>
        <p className="muted">
          Esta tela vai receber o lançamento manual das vendas da 364 Buffet, com data, evento,
          itens vendidos e baixa de estoque. A empresa 364 Buffet ainda precisa ser cadastrada.
        </p>
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 3: Criar `app/vendas/burguer/page.js`**

```jsx
'use client';
import AppShell from '../../../components/AppShell';

export default function VendasBurguerPage() {
  return (
    <AppShell modulo="pedidos" titulo="Vendas Burguer" desc="364 Burguer — loja exclusiva iFood">
      <div className="panel">
        <h3>Em construção</h3>
        <p className="muted">
          Esta tela vai receber as vendas da 364 Burguer, hoje uma loja exclusiva do iFood,
          com o lançamento dos pedidos e a baixa dos insumos consumidos.
        </p>
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 4: Rodar a verificação**

Run: `npm run verify`
Expected: testes passam e o build termina sem erro. Na saída do build, confirmar que as três rotas `/vendas/...` aparecem na listagem de rotas.

- [ ] **Step 5: Checagem manual no navegador**

Run: `npm run dev`

Abrir `/vendas/importacao`, `/vendas/buffet` e `/vendas/burguer`. Cada uma deve carregar dentro do AppShell (sidebar, seletor de empresa, topbar) e mostrar o card "Em construção". Um usuário sem a permissão `pedidos` deve ser redirecionado para `/`.

- [ ] **Step 6: Commit**

```bash
git add app/vendas
git commit -m "feat(vendas): cria telas placeholder de importação, buffet e burguer"
```

---

### Task 4: `lib/menu.js` com as funções puras de navegação

Fonte única da estrutura do menu, separada do catálogo de permissões. Tudo aqui é função pura, então dá para testar de verdade com `node --test`.

**Files:**
- Create: `lib/menu.js`
- Test: `tests/menu.test.mjs`

**Interfaces:**
- Consumes: as rotas criadas nas tasks 2 e 3 — o teste de existência de rota falha sem elas.
- Produces:
  - `MENU: Array<Entrada>` onde `Entrada` é `{ tipo: 'link', id, label, href, ic, modulo?, exato? }` ou `{ tipo: 'grupo', id, label, ic, itens: Item[] }`, e `Item` é `{ label, href, modulo, exato? }`.
  - `menuVisivel(permissoes: string[], isAdmin: boolean) => Entrada[]`
  - `itemAtivo(item: {href, exato?}, pathname: string) => boolean`
  - `grupoDaRota(pathname: string) => string | null`

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/menu.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MENU, menuVisivel, itemAtivo, grupoDaRota } from '../lib/menu.js';

// O caminho do projeto tem espaços e acentos: fileURLToPath, nunca .pathname.
const RAIZ = fileURLToPath(new URL('..', import.meta.url));

const ids = menu => menu.map(e => e.id);
const todosItens = menu => menu.flatMap(e => (e.tipo === 'grupo' ? e.itens : [e]));

// lib/auth.js importa react e next/navigation; para o teste ficar hermético,
// lemos os ids do catálogo de permissões direto do texto do arquivo.
function idsDePermissao() {
  const src = fs.readFileSync(path.join(RAIZ, 'lib/auth.js'), 'utf8');
  const inicio = src.indexOf('export const MODULOS');
  const bloco = src.slice(inicio, src.indexOf('\n];', inicio));
  return [...bloco.matchAll(/\bid: '([^']+)'/g)].map(m => m[1]);
}

test('menuVisivel: usuário só com producoes vê o grupo Produção e o Dashboard', () => {
  const visivel = menuVisivel(['producoes'], false);
  assert.deepEqual(ids(visivel), ['dashboard', 'producao']);
  const labels = visivel.find(e => e.id === 'producao').itens.map(i => i.label);
  assert.deepEqual(labels, [
    'Visão Geral', 'Defumação', 'Produção Interna',
    'Relatório de Validades', 'Histórico de Produção',
  ]);
  assert.ok(!labels.includes('Recebimento'));
  assert.ok(!labels.includes('Estoque'));
});

test('menuVisivel: sem a permissão pedidos, o grupo Vendas não aparece', () => {
  const visivel = menuVisivel(['clientes', 'produtos'], false);
  assert.ok(!ids(visivel).includes('vendas'));
  assert.ok(ids(visivel).includes('cadastros'));
});

test('menuVisivel: admin vê todos os grupos e todos os itens', () => {
  const visivel = menuVisivel([], true);
  assert.deepEqual(ids(visivel), ids(MENU));
  assert.equal(todosItens(visivel).length, todosItens(MENU).length);
});

test('menuVisivel: sem permissão nenhuma sobra só o Dashboard', () => {
  assert.deepEqual(ids(menuVisivel([], false)), ['dashboard']);
});

test('MENU: todo href tem uma page.js correspondente em app/', () => {
  for (const item of todosItens(MENU)) {
    const rota = item.href === '/' ? 'app/page.js' : `app${item.href}/page.js`;
    assert.ok(fs.existsSync(path.join(RAIZ, rota)), `rota inexistente para ${item.href}: ${rota}`);
  }
});

test('MENU: todo modulo citado existe em MODULOS', () => {
  const validos = idsDePermissao();
  assert.ok(validos.length > 0, 'não consegui ler os ids de MODULOS');
  for (const item of todosItens(MENU)) {
    if (!item.modulo) continue;
    assert.ok(validos.includes(item.modulo), `modulo desconhecido: ${item.modulo}`);
  }
});

test('itemAtivo: exato distingue /producoes de /producoes/completa', () => {
  const visaoGeral = { href: '/producoes', exato: true };
  const defumacao = { href: '/producoes/completa' };
  assert.equal(itemAtivo(visaoGeral, '/producoes'), true);
  assert.equal(itemAtivo(visaoGeral, '/producoes/completa'), false);
  assert.equal(itemAtivo(defumacao, '/producoes/completa'), true);
});

test('grupoDaRota: acha o grupo da rota atual e devolve null fora do menu', () => {
  assert.equal(grupoDaRota('/producoes/completa'), 'producao');
  assert.equal(grupoDaRota('/ponto/escalas'), 'rh');
  assert.equal(grupoDaRota('/materias-primas'), 'cadastros');
  assert.equal(grupoDaRota('/login'), null);
});
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

Run: `npm test`
Expected: FALHA com erro de módulo não encontrado — `Cannot find module .../lib/menu.js`.

- [ ] **Step 3: Escrever `lib/menu.js`**

```js
// Estrutura da navegação lateral. Separada de MODULOS (lib/auth.js), que continua
// sendo o catálogo de permissões usado nos checkboxes da tela de Acesso.
// Item sem `modulo` é visível para qualquer usuário logado.
// `exato: true` quando o href é prefixo de outras rotas (caso de /producoes).
export const MENU = [
  { tipo: 'link', id: 'dashboard', label: 'Dashboard', href: '/', ic: '◆', exato: true },
  {
    tipo: 'grupo', id: 'cadastros', label: 'Cadastros', ic: '▤', itens: [
      { label: 'Clientes', href: '/clientes', modulo: 'clientes' },
      { label: 'Fornecedores', href: '/fornecedores', modulo: 'fornecedores' },
      { label: 'Produtos', href: '/produtos', modulo: 'produtos' },
      { label: 'Matéria-prima / Insumos', href: '/materias-primas', modulo: 'produtos' },
    ],
  },
  {
    tipo: 'grupo', id: 'producao', label: 'Produção', ic: '▨', itens: [
      { label: 'Visão Geral', href: '/producoes', modulo: 'producoes', exato: true },
      { label: 'Recebimento', href: '/recebimentos', modulo: 'recebimentos' },
      { label: 'Defumação', href: '/producoes/completa', modulo: 'producoes' },
      { label: 'Produção Interna', href: '/producoes/internas', modulo: 'producoes' },
      { label: 'Estoque', href: '/estoque', modulo: 'estoque' },
      { label: 'Relatório de Validades', href: '/producoes/validades', modulo: 'producoes' },
      { label: 'Histórico de Produção', href: '/producoes/historico', modulo: 'producoes' },
    ],
  },
  {
    tipo: 'grupo', id: 'vendas', label: 'Vendas', ic: '▩', itens: [
      { label: 'Pedidos (Food Services)', href: '/pedidos', modulo: 'pedidos' },
      { label: 'Importação Steakhouse/Afya', href: '/vendas/importacao', modulo: 'pedidos' },
      { label: 'Vendas Buffet', href: '/vendas/buffet', modulo: 'pedidos' },
      { label: 'Vendas Burguer (iFood)', href: '/vendas/burguer', modulo: 'pedidos' },
    ],
  },
  { tipo: 'link', id: 'financeiro', label: 'Financeiro', href: '/financeiro/contas-a-pagar', ic: '◈', modulo: 'financeiro' },
  {
    tipo: 'grupo', id: 'rh', label: 'RH', ic: '◔', itens: [
      { label: 'Painel do gestor', href: '/ponto/painel', modulo: 'ponto' },
      { label: 'Colaboradores', href: '/ponto/colaboradores', modulo: 'ponto' },
      { label: 'Marcações', href: '/ponto/marcacoes', modulo: 'ponto' },
      { label: 'Escalas', href: '/ponto/escalas', modulo: 'ponto' },
      { label: 'Apuração', href: '/ponto/apuracao', modulo: 'ponto' },
      { label: 'Fechamento', href: '/ponto/fechamento', modulo: 'ponto' },
      { label: 'Unidades e empregadores', href: '/ponto/unidades', modulo: 'ponto' },
      { label: 'Dispositivos', href: '/ponto/dispositivos', modulo: 'ponto' },
    ],
  },
  { tipo: 'link', id: 'relatorios', label: 'Relatórios', href: '/relatorios', ic: '▢', modulo: 'relatorios' },
];

function podeVer(modulo, permissoes, isAdmin) {
  if (isAdmin) return true;
  if (!modulo) return true;
  return permissoes.includes(modulo);
}

// Devolve o MENU filtrado pelas permissões. Grupo que ficou sem item some inteiro,
// para não sobrar cabeçalho órfão na sidebar.
export function menuVisivel(permissoes = [], isAdmin = false) {
  const saida = [];
  for (const entrada of MENU) {
    if (entrada.tipo === 'link') {
      if (podeVer(entrada.modulo, permissoes, isAdmin)) saida.push(entrada);
      continue;
    }
    const itens = entrada.itens.filter(i => podeVer(i.modulo, permissoes, isAdmin));
    if (itens.length) saida.push({ ...entrada, itens });
  }
  return saida;
}

export function itemAtivo(item, pathname) {
  return item.exato ? pathname === item.href : pathname.startsWith(item.href);
}

// Qual grupo contém a rota atual. Ganha o href mais longo, para o item mais
// específico vencer quando dois casam por prefixo.
export function grupoDaRota(pathname) {
  let melhor = null;
  for (const grupo of MENU) {
    if (grupo.tipo !== 'grupo') continue;
    for (const item of grupo.itens) {
      if (!itemAtivo(item, pathname)) continue;
      if (!melhor || item.href.length > melhor.href.length) melhor = { href: item.href, id: grupo.id };
    }
  }
  return melhor ? melhor.id : null;
}
```

- [ ] **Step 4: Rodar os testes para confirmar que passam**

Run: `npm test`
Expected: PASS nos oito testes de `tests/menu.test.mjs`, e os testes já existentes continuam passando.

- [ ] **Step 5: Commit**

```bash
git add lib/menu.js tests/menu.test.mjs
git commit -m "feat(menu): estrutura de navegação por categorias com filtro por permissão"
```

---

### Task 5: Accordion na sidebar

Substitui o `<nav>` inline do AppShell por um componente próprio. `MODULOS` sai do AppShell mas continua exportado de `lib/auth.js` para a tela de Acesso.

**Files:**
- Create: `components/SidebarNav.js`
- Modify: `components/AppShell.js:4` (import), `:36` (remove `abas`), `:56-64` (bloco `<nav>`)
- Modify: `app/globals.css` (acrescenta regras depois da linha 48)

**Interfaces:**
- Consumes: `menuVisivel`, `itemAtivo` e `grupoDaRota` de `lib/menu.js` (Task 4).
- Produces: `SidebarNav({ permissoes: string[], isAdmin: boolean })` — default export de `components/SidebarNav.js`.

- [ ] **Step 1: Criar `components/SidebarNav.js`**

```jsx
'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { menuVisivel, itemAtivo, grupoDaRota } from '../lib/menu';

const LS_KEY = 'menuGruposAbertos';

export default function SidebarNav({ permissoes, isAdmin }) {
  const pathname = usePathname();
  const [abertos, setAbertos] = useState([]);

  // localStorage só depois da hidratação: se lêssemos durante a renderização,
  // o HTML do servidor e o do cliente divergiriam.
  useEffect(() => {
    let salvos = [];
    try { salvos = JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch { salvos = []; }
    if (!Array.isArray(salvos)) salvos = [];
    const atual = grupoDaRota(pathname);
    setAbertos(atual && !salvos.includes(atual) ? [...salvos, atual] : salvos);
  }, [pathname]);

  function alternar(id) {
    setAbertos(prev => {
      const novo = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      localStorage.setItem(LS_KEY, JSON.stringify(novo));
      return novo;
    });
  }

  return (
    <nav>
      {menuVisivel(permissoes, isAdmin).map(entrada => {
        if (entrada.tipo === 'link') {
          return (
            <a key={entrada.id} href={entrada.href} className={itemAtivo(entrada, pathname) ? 'active' : ''}>
              <span className="ic">{entrada.ic}</span>{entrada.label}
            </a>
          );
        }
        const aberto = abertos.includes(entrada.id);
        const temAtivo = entrada.itens.some(i => itemAtivo(i, pathname));
        return (
          <div key={entrada.id} className="nav-grupo">
            <button
              type="button"
              className={'nav-grupo-toggle' + (!aberto && temAtivo ? ' tem-ativo' : '')}
              aria-expanded={aberto}
              aria-controls={`nav-sub-${entrada.id}`}
              onClick={() => alternar(entrada.id)}
            >
              <span className="ic">{entrada.ic}</span>
              <span className="nav-grupo-label">{entrada.label}</span>
              <span className="chevron" aria-hidden="true">▸</span>
            </button>
            {aberto && (
              <div className="nav-sub" id={`nav-sub-${entrada.id}`}>
                {entrada.itens.map(item => (
                  <a key={item.href} href={item.href} className={itemAtivo(item, pathname) ? 'active' : ''}>
                    {item.label}
                  </a>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Acrescentar o CSS**

Em `app/globals.css`, logo depois da linha 48 (`.sidebar nav a.active{...}`), inserir:

```css
.nav-grupo{display:flex; flex-direction:column;}
.nav-grupo-toggle{
  background:none; border:0; font:inherit; text-align:left; cursor:pointer; width:100%;
  padding:9px 10px; border-radius:var(--radius);
  color:var(--paper-dim); font-size:13px; display:flex; align-items:center; gap:9px;
}
.nav-grupo-toggle .ic{width:16px; text-align:center; opacity:.8;}
.nav-grupo-toggle .nav-grupo-label{flex:1;}
.nav-grupo-toggle .chevron{font-size:10px; opacity:.6; transition:transform .15s;}
.nav-grupo-toggle[aria-expanded="true"] .chevron{transform:rotate(90deg);}
.nav-grupo-toggle:hover{background:var(--char3); color:var(--paper);}
.nav-grupo-toggle.tem-ativo{color:var(--amber-bright);}
.nav-sub{display:flex; flex-direction:column; gap:1px; margin:1px 0 4px;}
.sidebar nav .nav-sub a{padding-left:35px; font-size:12.5px;}
```

A última regra usa `.sidebar nav .nav-sub a` de propósito: `.nav-sub a` sozinho perde em especificidade para `.sidebar nav a` e o recuo não aplicaria.

- [ ] **Step 3: Trocar o import em `components/AppShell.js`**

Linha 4, trocar:

```js
import { useAuth, sair, MODULOS } from '../lib/auth';
```

por:

```js
import { useAuth, sair } from '../lib/auth';
```

E acrescentar, depois da linha 5 (`import { EmpresaContext } from '../lib/empresa';`):

```js
import SidebarNav from './SidebarNav';
```

- [ ] **Step 4: Remover a constante `abas`**

Apagar a linha 36:

```js
  const abas = MODULOS.filter(m => isAdmin || permissoes.includes(m.id));
```

- [ ] **Step 5: Substituir o bloco `<nav>`**

Trocar o bloco inteiro:

```jsx
        <nav>
          <a href="/" className={pathname === '/' ? 'active' : ''}><span className="ic">◆</span>Dashboard</a>
          {abas.map(m => (
            <a key={m.id} href={m.href} className={pathname === m.href ? 'active' : ''}>
              <span className="ic">{m.ic}</span>{m.label}
            </a>
          ))}
          {/* Gestão de usuários migrou para Ponto → Colaboradores (painel "Acesso") */}
        </nav>
```

por:

```jsx
        <SidebarNav permissoes={permissoes} isAdmin={isAdmin} />
```

- [ ] **Step 6: Remover o `pathname`, que ficou sem uso**

Quem usava `pathname` no AppShell era só o `<nav>` que acabou de sair. Apagar a linha:

```js
  const pathname = usePathname();
```

E trocar o import da linha 3:

```js
import { usePathname, useRouter } from 'next/navigation';
```

por:

```js
import { useRouter } from 'next/navigation';
```

Run: `grep -n "pathname\|usePathname" components/AppShell.js`
Expected: nenhuma saída (exit code 1).

- [ ] **Step 7: Confirmar que `MODULOS` continua exportado e em uso na tela de Acesso**

Run: `grep -rn "MODULOS" lib components app`
Expected: exatamente duas ocorrências — a definição em `lib/auth.js` e o uso em `app/ponto/colaboradores/page.js`. Nenhuma em `components/`.

- [ ] **Step 8: Rodar a verificação**

Run: `npm run verify`
Expected: testes passam e o build termina sem erro.

- [ ] **Step 9: Checagem manual no navegador**

Run: `npm run dev`

1. Logar como admin. A sidebar deve mostrar: Dashboard, Cadastros, Produção, Vendas, Financeiro, RH, Relatórios.
2. Clicar em "Cadastros": expande com Clientes, Fornecedores, Produtos e Matéria-prima / Insumos. Clicar de novo: recolhe.
3. Deixar Cadastros e Vendas abertos, recarregar a página (F5): os dois continuam abertos.
4. Navegar direto para `/ponto/escalas` pela barra de endereço: o grupo RH abre sozinho e "Escalas" fica destacado.
5. Ir para `/producoes`: "Visão Geral" fica destacado. Ir para `/producoes/completa`: "Defumação" fica destacado e "Visão Geral" **não**.
6. Fechar o grupo Produção estando em `/producoes/completa`: o toggle "Produção" fica em âmbar, sinalizando que a rota ativa está lá dentro.
7. Navegar pelo teclado: Tab até o toggle de um grupo, Enter ou Espaço expande, Tab continua pelos itens.
8. Logar com um usuário não-admin que só tenha a permissão `ponto`: a sidebar deve mostrar só Dashboard e RH.

- [ ] **Step 10: Commit**

```bash
git add components/SidebarNav.js components/AppShell.js app/globals.css
git commit -m "feat(menu): sidebar com categorias em accordion"
```

---

## Verificação final

- [ ] Run: `npm run verify` — testes e build limpos.
- [ ] Run: `git log --oneline -5` — cinco commits, um por tarefa.
- [ ] Conferir no navegador que as rotas antigas ainda respondem: `/despesas`, `/funcionarios` e `/usuarios` continuam redirecionando.
