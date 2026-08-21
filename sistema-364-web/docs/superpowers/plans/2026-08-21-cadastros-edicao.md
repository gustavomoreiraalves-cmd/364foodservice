# Edição e desativação nos cadastros — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar às quatro telas de cadastro — clientes, fornecedores, produtos e matérias-primas — a capacidade de corrigir um registro existente e de desativá-lo em vez de depender de uma exclusão que quase sempre falha.

**Architecture:** Uma peça compartilhada em `lib/cadastro.js` concentra o comportamento repetido (carregar o registro no formulário, alternar entre inserir e atualizar, ativar/desativar), e cada tela consome essa peça mantendo os próprios campos. Nenhuma consulta passa a filtrar inativos: o filtro acontece na montagem das opções do `<select>`, para não esconder registro de tela histórica.

**Tech Stack:** Next.js 14 (App Router), React 18, Supabase (Postgres + RLS), Node 18+ com `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-21-cadastros-edicao-design.md`

## Global Constraints

- Textos de interface em português, com acentuação correta.
- Toda tabela continua com RLS no padrão do projeto; esta entrega não altera policy nenhuma.
- Migrações SQL entram em `supabase/` com o próximo número livre. Hoje o maior é `atualizacao_23_fornecedor_cnpj_normalizado.sql`, então esta é a **24**.
- O código do produto (`0364-XXX`) nunca é editável: é a chave impressa em etiqueta.
- Editar um cadastro não altera lançamento já feito — recebimento, pedido e produção guardam os próprios valores no momento em que foram gravados.
- Inativo **some da lista de seleção, nunca do histórico**. O filtro vai onde as `<option>` são montadas, nunca na consulta ao banco.
- Testes rodam com `npm test` (`node --test tests/*.test.mjs`). Verificação completa: `npm run verify`.
- A raiz do projeto npm é `sistema-364-web/`.

---

## Estrutura de arquivos

**Criar:**

| arquivo | responsabilidade |
| --- | --- |
| `lib/cadastro.js` | `camposDoFormulario` (pura) e o hook `useCadastro`, com o comportamento repetido das quatro telas. |
| `tests/cadastro.test.mjs` | Testes de `camposDoFormulario`. |
| `supabase/atualizacao_26_cadastros_ativo.sql` | Coluna `ativo` em clientes, fornecedores e produtos. |

**Modificar:**

| arquivo | mudança |
| --- | --- |
| `app/clientes/page.js` | editar, desativar, filtro de inativos |
| `app/fornecedores/page.js` | idem |
| `app/materias-primas/page.js` | idem |
| `app/produtos/page.js` | editar campos-base, desativar, filtro de inativos |
| `app/pedidos/page.js` | esconder cliente e produto inativos do `<select>` |
| `app/producoes/nova/page.js` | esconder produto inativo |
| `app/producoes/completa/page.js` | esconder produto e matéria-prima inativos |
| `app/financeiro/contas-a-pagar/page.js` | esconder fornecedor inativo |

---

## Task 1: Migração da coluna `ativo`

**Files:**
- Create: `supabase/atualizacao_26_cadastros_ativo.sql`

**Interfaces:**
- Consumes: nada.
- Produces: coluna `ativo boolean not null default true` em `clientes`, `fornecedores` e `produtos`.

`materias_primas` já tem a coluna — não mexa nela.

- [ ] **Step 1: Escrever a migração**

Criar `supabase/atualizacao_26_cadastros_ativo.sql`:

```sql
-- =========================================================
-- 364 — ATUALIZAÇÃO 24: SITUAÇÃO NOS CADASTROS
-- Clientes, fornecedores e produtos ganham `ativo`, para que um cadastro que
-- já tem movimento possa sair das listas de seleção sem ser apagado.
--
-- Excluir continua existindo para cadastro criado por engano, e continua
-- falhando quando há vínculo — é justamente esse caso que `ativo` resolve.
--
-- `materias_primas` já tinha a coluna e não é tocada aqui.
--
-- Aditiva e idempotente: rodar duas vezes não quebra nada, e todo registro
-- existente nasce ativo.
--
-- Rode depois de atualizacao_23_fornecedor_cnpj_normalizado.sql.
-- =========================================================

begin;

alter table public.clientes     add column if not exists ativo boolean not null default true;
alter table public.fornecedores add column if not exists ativo boolean not null default true;
alter table public.produtos     add column if not exists ativo boolean not null default true;

commit;
```

- [ ] **Step 2: Conferir que nada quebrou nos testes**

Rodar: `npm test`
Esperado: a suíte atual passando, sem alteração (a migração não é exercitada por teste — o repositório não tem harness de SQL).

- [ ] **Step 3: Commit**

```bash
git add supabase/atualizacao_26_cadastros_ativo.sql
git commit -m "feat(cadastros): coluna ativo em clientes, fornecedores e produtos"
```

**Rodar no Supabase é passo do dono do sistema, não desta task.** Registre no relatório que a migração fica pendente. As telas das tasks seguintes toleram a coluna ausente ao ler (`c.ativo !== false`), mas o botão Desativar só funciona depois que ela existir.

---

## Task 2: A peça compartilhada

**Files:**
- Create: `lib/cadastro.js`
- Create: `tests/cadastro.test.mjs`

**Interfaces:**
- Consumes: `lib/supabase.js` (cliente já existente).
- Produces:
  - `camposDoFormulario(registro, formVazio) -> objeto` com exatamente as chaves de `formVazio`;
  - `useCadastro({ tabela, formVazio, empresaId, aoTerminar, paraGravar }) -> { form, setForm, editando, salvando, iniciarEdicao, cancelarEdicao, salvar, alternarAtivo, excluir }`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/cadastro.test.mjs`. Só a função pura é testada — o hook depende de React e o repositório não tem harness de componente.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { camposDoFormulario } from '../lib/cadastro.js';

const FORM_VAZIO = { nome: '', categoria: 'Carnes', validade_dias: 90, producao_interna: false };

test('camposDoFormulario: copia os campos que o formulário conhece', () => {
  const r = camposDoFormulario(
    { id: 'x', nome: 'Picanha', categoria: 'Bovinos', validade_dias: 30, producao_interna: true },
    FORM_VAZIO,
  );
  assert.deepEqual(r, { nome: 'Picanha', categoria: 'Bovinos', validade_dias: 30, producao_interna: true });
});

test('camposDoFormulario: ignora coluna que não está no formulário', () => {
  const r = camposDoFormulario({ nome: 'Picanha', empresa_id: 'e1', created_at: 'ontem' }, FORM_VAZIO);
  assert.deepEqual(Object.keys(r).sort(), ['categoria', 'nome', 'producao_interna', 'validade_dias']);
});

test('camposDoFormulario: null vira o padrão do formulário, não string vazia', () => {
  const r = camposDoFormulario({ nome: 'X', categoria: null, validade_dias: null }, FORM_VAZIO);
  assert.equal(r.categoria, 'Carnes');
  assert.equal(r.validade_dias, 90);
});

test('camposDoFormulario: chave ausente no registro cai no padrão', () => {
  assert.equal(camposDoFormulario({ nome: 'X' }, FORM_VAZIO).categoria, 'Carnes');
});

test('camposDoFormulario: false e 0 são preservados, não confundidos com vazio', () => {
  const r = camposDoFormulario({ nome: '', categoria: '', validade_dias: 0, producao_interna: false }, FORM_VAZIO);
  assert.equal(r.validade_dias, 0);
  assert.equal(r.producao_interna, false);
  assert.equal(r.categoria, '');
  assert.equal(r.nome, '');
});

test('camposDoFormulario: registro nulo devolve o formulário vazio', () => {
  assert.deepEqual(camposDoFormulario(null, FORM_VAZIO), FORM_VAZIO);
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Rodar: `npm test`
Esperado: FAIL com `Cannot find module '../lib/cadastro.js'`.

- [ ] **Step 3: Implementar**

Criar `lib/cadastro.js`:

```js
'use client';
import { useState } from 'react';
import { supabase } from './supabase';

// Pega do registro só as chaves que o formulário conhece.
//
// Duas armadilhas que isto evita: uma coluna a mais (empresa_id, created_at)
// iria junto no update e o PostgREST recusaria; e `value={null}` transforma um
// input controlado em não-controlado no meio do caminho, que o React reclama
// no console e faz o campo parar de responder.
//
// `null` cai no padrão do formulário — não em string vazia — porque campos como
// `unidade: 'kg'` ou `validade_dias: 90` têm um padrão que faz sentido. `false`
// e `0` são valores legítimos e passam intactos.
export function camposDoFormulario(registro, formVazio) {
  const saida = {};
  for (const chave of Object.keys(formVazio)) {
    const valor = registro?.[chave];
    saida[chave] = valor === null || valor === undefined ? formVazio[chave] : valor;
  }
  return saida;
}

// Comportamento comum das telas de cadastro: o mesmo formulário do topo serve
// para criar e para editar, e `editando` é o que decide entre insert e update.
//
// `paraGravar` é o ponto de extensão de cada tela — é onde número vira número e
// campo opcional em branco vira null. Sem ele, grava-se o form como está.
export function useCadastro({ tabela, formVazio, empresaId, aoTerminar, paraGravar }) {
  const [form, setForm] = useState(formVazio);
  const [editando, setEditando] = useState(null);
  const [salvando, setSalvando] = useState(false);

  function iniciarEdicao(registro) {
    setForm(camposDoFormulario(registro, formVazio));
    setEditando(registro.id);
    // O formulário fica no topo; sem rolar até ele, o clique em Editar numa
    // lista longa parece não ter feito nada.
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelarEdicao() {
    setForm(formVazio);
    setEditando(null);
  }

  async function salvar(e) {
    e.preventDefault();
    if (salvando) return;
    setSalvando(true);
    try {
      const dados = paraGravar ? paraGravar(form) : form;
      const { error } = editando
        ? await supabase.from(tabela).update(dados).eq('id', editando)
        : await supabase.from(tabela).insert([{ ...dados, empresa_id: empresaId }]);
      if (error) {
        alert((editando ? 'Erro ao salvar as alterações: ' : 'Erro ao salvar: ') + error.message);
        return;
      }
      cancelarEdicao();
      await aoTerminar();
    } finally {
      setSalvando(false);
    }
  }

  async function alternarAtivo(registro) {
    const { error } = await supabase.from(tabela)
      .update({ ativo: !(registro.ativo !== false) }).eq('id', registro.id);
    if (error) { alert('Não foi possível mudar a situação: ' + error.message); return; }
    await aoTerminar();
  }

  async function excluir(registro, pergunta) {
    if (!confirm(pergunta)) return;
    const { error } = await supabase.from(tabela).delete().eq('id', registro.id);
    if (error) {
      alert('Não foi possível excluir: ' + error.message
        + '\n\nSe este cadastro já tem movimento, use Desativar em vez de Excluir.');
      return;
    }
    if (editando === registro.id) cancelarEdicao();
    await aoTerminar();
  }

  return { form, setForm, editando, salvando, iniciarEdicao, cancelarEdicao, salvar, alternarAtivo, excluir };
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Rodar: `npm test`
Esperado: PASS nos 6 testes de `cadastro`.

- [ ] **Step 5: Commit**

```bash
git add lib/cadastro.js tests/cadastro.test.mjs
git commit -m "feat(cadastros): peca compartilhada de edicao e situacao"
```

---

## Task 3: Clientes

**Files:**
- Modify: `app/clientes/page.js`

**Interfaces:**
- Consumes: `useCadastro` e `camposDoFormulario` (Task 2), coluna `ativo` (Task 1).
- Produces: o padrão visual que as Tasks 4, 5 e 6 repetem — título do painel que muda em edição, botão "Salvar alterações" com "Cancelar" ao lado, caixa "Mostrar inativos", e a trinca Editar / Desativar / Excluir na linha.

Esta é a primeira tela a consumir a peça compartilhada; é ela que prova o desenho.

- [ ] **Step 1: Trocar o estado local pelo hook**

Em `app/clientes/page.js`, acrescentar o import:

```jsx
import { useCadastro } from '../../lib/cadastro';
```

Dentro de `Conteudo`, remover `const [form, setForm] = useState(FORM_VAZIO);` e as funções `adicionar` e `excluir` inteiras, e pôr no lugar (depois de `carregar` estar declarada):

```jsx
  const [mostrarInativos, setMostrarInativos] = useState(false);
  const { form, setForm, editando, salvando, iniciarEdicao, cancelarEdicao, salvar, alternarAtivo, excluir } =
    useCadastro({ tabela: 'clientes', formVazio: FORM_VAZIO, empresaId: empresaAtual?.id, aoTerminar: carregar });

  const emEdicao = editando ? lista.find(c => c.id === editando) : null;
  const visiveis = mostrarInativos ? lista : lista.filter(c => c.ativo !== false);
```

O `c.ativo !== false` — e não `c.ativo === true` — é proposital: enquanto a migração 26 não rodar, a coluna não existe, `c.ativo` é `undefined`, e a tela precisa continuar mostrando todo mundo em vez de esvaziar.

- [ ] **Step 2: Trocar o formulário**

Substituir o painel do formulário inteiro por:

```jsx
      <div className="panel">
        <h3>{emEdicao ? `Editando: ${emEdicao.nome}` : 'Novo cliente'}</h3>
        <form onSubmit={salvar} className="form-grid">
          <div><label>Nome / Razão social</label><input required value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} /></div>
          <div><label>CNPJ/CPF</label><input value={form.cnpj} onChange={e => setForm({ ...form, cnpj: e.target.value })} /></div>
          <div><label>Tipo</label>
            <select value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })}>
              {TIPOS.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div><label>Contato</label><input value={form.contato} onChange={e => setForm({ ...form, contato: e.target.value })} /></div>
          <div><label>Telefone</label><input value={form.telefone} onChange={e => setForm({ ...form, telefone: e.target.value })} /></div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <button className="btn" type="submit" disabled={salvando}>
              {salvando ? 'Salvando…' : (editando ? 'Salvar alterações' : 'Adicionar cliente')}
            </button>
            {editando && <button className="btn secondary" type="button" onClick={cancelarEdicao}>Cancelar</button>}
          </div>
        </form>
      </div>
```

- [ ] **Step 3: Trocar a tabela**

Substituir o painel da lista por:

```jsx
      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h3>Clientes cadastrados ({visiveis.length})</h3>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={mostrarInativos} onChange={e => setMostrarInativos(e.target.checked)} />
            Mostrar inativos
          </label>
        </div>
        {loading ? <p className="muted">Carregando…</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Nome</th><th>Tipo</th><th>CNPJ/CPF</th><th>Contato</th><th>Telefone</th><th></th></tr></thead>
              <tbody>
                {visiveis.length ? visiveis.map(c => {
                  const inativo = c.ativo === false;
                  return (
                    <tr key={c.id} style={inativo ? { opacity: 0.55 } : undefined}>
                      <td>{c.nome} {inativo && <span className="tag warn">inativo</span>}</td>
                      <td>{c.tipo || '—'}</td>
                      <td className="muted">{c.cnpj || '—'}</td>
                      <td>{c.contato || '—'}</td>
                      <td className="muted">{c.telefone || '—'}</td>
                      <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button className="btn secondary" onClick={() => iniciarEdicao(c)}>Editar</button>
                        <button className="btn secondary" onClick={() => alternarAtivo(c)}>{inativo ? 'Reativar' : 'Desativar'}</button>
                        <button className="btn danger" onClick={() => excluir(c, `Excluir o cliente ${c.nome}?`)}>Excluir</button>
                      </td>
                    </tr>
                  );
                }) : <tr className="empty-row"><td colSpan={6}>Nenhum cliente {mostrarInativos ? 'cadastrado' : 'ativo'}.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
```

- [ ] **Step 4: Verificar**

Rodar: `npm run verify`
Esperado: testes passando e build do Next sem erro.

- [ ] **Step 5: Commit**

```bash
git add app/clientes/page.js
git commit -m "feat(clientes): editar e desativar cadastro"
```

---

## Task 4: Fornecedores

**Files:**
- Modify: `app/fornecedores/page.js`

**Interfaces:**
- Consumes: `useCadastro` (Task 2), coluna `ativo` (Task 1).
- Produces: nada que outra task consuma.

Esta tela tem um detalhe que as outras não têm: o CNPJ é gravado **só com dígitos**, porque é por igualdade exata que a importação de NF-e encontra o fornecedor da nota. O `soDigitos` e o `|| null` já existem no arquivo e precisam continuar valendo também na edição — por isso o `paraGravar`.

- [ ] **Step 1: Trocar o estado local pelo hook**

Acrescentar o import:

```jsx
import { useCadastro } from '../../lib/cadastro';
```

Dentro de `Conteudo`, remover `const [form, setForm] = useState(FORM_VAZIO);` e as funções `adicionar` e `excluir` inteiras, e pôr no lugar, depois de `carregar`:

```jsx
  const [mostrarInativos, setMostrarInativos] = useState(false);
  const { form, setForm, editando, salvando, iniciarEdicao, cancelarEdicao, salvar, alternarAtivo, excluir } =
    useCadastro({
      tabela: 'fornecedores',
      formVazio: FORM_VAZIO,
      empresaId: empresaAtual?.id,
      aoTerminar: carregar,
      // CNPJ em branco vai como null: a coluna é opcional e string vazia não
      // passa no check de "só dígitos" da migração 23.
      paraGravar: f => ({ ...f, cnpj: soDigitos(f.cnpj) || null }),
    });

  const emEdicao = editando ? lista.find(f => f.id === editando) : null;
  const visiveis = mostrarInativos ? lista : lista.filter(f => f.ativo !== false);
```

O `f.ativo !== false` — e não `f.ativo === true` — é proposital: enquanto a migração 26 não rodar, a coluna não existe, `f.ativo` é `undefined`, e a tela precisa continuar mostrando todo mundo em vez de esvaziar.

Mantenha `soDigitos` e o `onChange` do campo CNPJ exatamente como estão.

- [ ] **Step 2: Trocar o formulário**

Substituir o painel do formulário inteiro por:

```jsx
      <div className="panel">
        <h3>{emEdicao ? `Editando: ${emEdicao.nome}` : 'Novo fornecedor'}</h3>
        <form onSubmit={salvar} className="form-grid">
          <div><label>Nome / Razão social</label><input required value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} /></div>
          <div><label>CNPJ</label>
            <input inputMode="numeric" maxLength={14} placeholder="Só números"
              value={form.cnpj} onChange={e => setForm({ ...form, cnpj: soDigitos(e.target.value) })} />
          </div>
          <div><label>Categoria</label>
            <select value={form.categoria} onChange={e => setForm({ ...form, categoria: e.target.value })}>
              {CATEGORIAS.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div><label>Contato</label><input value={form.contato} onChange={e => setForm({ ...form, contato: e.target.value })} /></div>
          <div><label>Telefone</label><input value={form.telefone} onChange={e => setForm({ ...form, telefone: e.target.value })} /></div>
          <div><label>E-mail</label><input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <button className="btn" type="submit" disabled={salvando}>
              {salvando ? 'Salvando…' : (editando ? 'Salvar alterações' : 'Adicionar fornecedor')}
            </button>
            {editando && <button className="btn secondary" type="button" onClick={cancelarEdicao}>Cancelar</button>}
          </div>
        </form>
      </div>
```

- [ ] **Step 3: Trocar a tabela**

Substituir o painel da lista por:

```jsx
      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h3>Fornecedores cadastrados ({visiveis.length})</h3>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={mostrarInativos} onChange={e => setMostrarInativos(e.target.checked)} />
            Mostrar inativos
          </label>
        </div>
        {loading ? <p className="muted">Carregando…</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Nome</th><th>Categoria</th><th>CNPJ</th><th>Contato</th><th>Telefone</th><th>E-mail</th><th></th></tr></thead>
              <tbody>
                {visiveis.length ? visiveis.map(f => {
                  const inativo = f.ativo === false;
                  return (
                    <tr key={f.id} style={inativo ? { opacity: 0.55 } : undefined}>
                      <td>{f.nome} {inativo && <span className="tag warn">inativo</span>}</td>
                      <td>{f.categoria || '—'}</td>
                      <td className="muted">{f.cnpj || '—'}</td>
                      <td>{f.contato || '—'}</td>
                      <td className="muted">{f.telefone || '—'}</td>
                      <td className="muted">{f.email || '—'}</td>
                      <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button className="btn secondary" onClick={() => iniciarEdicao(f)}>Editar</button>
                        <button className="btn secondary" onClick={() => alternarAtivo(f)}>{inativo ? 'Reativar' : 'Desativar'}</button>
                        <button className="btn danger" onClick={() => excluir(f, `Excluir o fornecedor ${f.nome}?`)}>Excluir</button>
                      </td>
                    </tr>
                  );
                }) : <tr className="empty-row"><td colSpan={7}>Nenhum fornecedor {mostrarInativos ? 'cadastrado' : 'ativo'}.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
```

- [ ] **Step 4: Verificar**

Rodar: `npm run verify`
Esperado: testes passando e build sem erro.

Confira à mão no código, antes de commitar, que editar um fornecedor com CNPJ digitado com pontuação grava só os dígitos — é o `paraGravar` que garante isso, e é o que mantém a importação de NF-e funcionando.

- [ ] **Step 5: Commit**

```bash
git add app/fornecedores/page.js
git commit -m "feat(fornecedores): editar e desativar cadastro"
```

---

## Task 5: Matérias-primas

**Files:**
- Modify: `app/materias-primas/page.js`

**Interfaces:**
- Consumes: `useCadastro` (Task 2). A coluna `ativo` já existia nesta tabela — a Task 1 não a toca.
- Produces: nada que outra task consuma.

Atenção: o Recebimento já filtra matéria-prima por `ativo` na consulta (`app/recebimentos/page.js`), então desativar aqui tem efeito imediato lá. Não altere aquela consulta nesta task.

- [ ] **Step 1: Trocar o estado local pelo hook**

Acrescentar o import:

```jsx
import { useCadastro } from '../../lib/cadastro';
```

Dentro de `Conteudo`, remover `const [formMP, setFormMP] = useState(MP_VAZIA);` e as funções `addMP` e `delMP` inteiras, e pôr no lugar, depois de `carregar`:

```jsx
  const [mostrarInativos, setMostrarInativos] = useState(false);
  const { form, setForm, editando, salvando, iniciarEdicao, cancelarEdicao, salvar, alternarAtivo, excluir } =
    useCadastro({
      tabela: 'materias_primas',
      formVazio: MP_VAZIA,
      empresaId: empresaAtual?.id,
      aoTerminar: carregar,
      paraGravar: f => ({
        nome: f.nome,
        categoria: f.categoria || null,
        unidade: f.unidade,
        custo_unitario: Number(f.custo_unitario),
        preco_alvo_kg: f.preco_alvo_kg ? Number(f.preco_alvo_kg) : null,
      }),
    });

  const emEdicao = editando ? mps.find(m => m.id === editando) : null;
  const visiveis = mostrarInativos ? mps : mps.filter(m => m.ativo !== false);
```

Esta tabela já tinha `ativo`, então aqui o filtro funciona desde já — mas mantenha `m.ativo !== false` mesmo assim, para a tela se comportar igual às outras três.

Mantenha o `if (loading) return <p className="muted">Carregando…</p>;` que já existe antes do return principal.

- [ ] **Step 2: Trocar o formulário**

O formulário e a tabela desta tela vivem dentro de um mesmo `div.panel`. Substituir o `<h3>` e o `<form>` por:

```jsx
      <h3>{emEdicao ? `Editando: ${emEdicao.nome}` : 'Nova matéria-prima'}</h3>
      <form onSubmit={salvar} className="form-grid">
        <div><label>Nome</label><input required value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} /></div>
        <div><label>Categoria</label><input placeholder="Carnes, Temperos, Embalagens..." value={form.categoria} onChange={e => setForm({ ...form, categoria: e.target.value })} /></div>
        <div><label>Unidade</label>
          <select value={form.unidade} onChange={e => setForm({ ...form, unidade: e.target.value })}>
            <option value="kg">kg</option><option value="g">g</option><option value="un">un</option><option value="L">L</option>
          </select>
        </div>
        <div><label>Custo unitário padrão (R$)</label><input type="number" step="0.01" required value={form.custo_unitario} onChange={e => setForm({ ...form, custo_unitario: e.target.value })} /></div>
        <div><label>Preço-alvo (R$/kg)</label><input type="number" step="0.01" placeholder="Opcional" value={form.preco_alvo_kg} onChange={e => setForm({ ...form, preco_alvo_kg: e.target.value })} /></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <button className="btn" type="submit" disabled={salvando}>
            {salvando ? 'Salvando…' : (editando ? 'Salvar alterações' : 'Adicionar matéria-prima')}
          </button>
          {editando && <button className="btn secondary" type="button" onClick={cancelarEdicao}>Cancelar</button>}
        </div>
      </form>
```

O parágrafo `muted` sobre o preço-alvo que vem logo abaixo continua onde está.

- [ ] **Step 3: Trocar a tabela**

Substituir o `div.table-wrap` inteiro por:

```jsx
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={mostrarInativos} onChange={e => setMostrarInativos(e.target.checked)} />
          Mostrar inativas
        </label>
      </div>
      <div className="table-wrap" style={{ marginTop: 8 }}>
        <table>
          <thead><tr><th>Nome</th><th>Categoria</th><th>Unidade</th><th>Custo padrão</th><th>Preço-alvo</th><th></th></tr></thead>
          <tbody>
            {visiveis.length ? visiveis.map(m => {
              const inativa = m.ativo === false;
              return (
                <tr key={m.id} style={inativa ? { opacity: 0.55 } : undefined}>
                  <td>{m.nome} {inativa && <span className="tag warn">inativa</span>}</td>
                  <td className="muted">{m.categoria || '—'}</td>
                  <td>{m.unidade}</td>
                  <td className="num">{fmtMoney(m.custo_unitario)}</td>
                  <td className="num">{m.preco_alvo_kg != null ? fmtMoney(m.preco_alvo_kg) : '—'}</td>
                  <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button className="btn secondary" onClick={() => iniciarEdicao(m)}>Editar</button>
                    <button className="btn secondary" onClick={() => alternarAtivo(m)}>{inativa ? 'Reativar' : 'Desativar'}</button>
                    <button className="btn danger" onClick={() => excluir(m, `Excluir a matéria-prima ${m.nome}?`)}>Excluir</button>
                  </td>
                </tr>
              );
            }) : <tr className="empty-row"><td colSpan={6}>Nenhuma matéria-prima {mostrarInativos ? 'cadastrada' : 'ativa'}.</td></tr>}
          </tbody>
        </table>
      </div>
```

Atenção ao efeito imediato: o Recebimento já filtra matéria-prima por `ativo` na própria consulta, então desativar aqui tira a matéria-prima da tela de Recebimento na hora. Não altere aquela consulta nesta task.

- [ ] **Step 4: Verificar**

Rodar: `npm run verify`
Esperado: testes passando e build sem erro.

- [ ] **Step 5: Commit**

```bash
git add app/materias-primas/page.js
git commit -m "feat(materias-primas): editar e desativar cadastro"
```

---

## Task 6: Produtos

**Files:**
- Modify: `app/produtos/page.js`

**Interfaces:**
- Consumes: `camposDoFormulario` (Task 2), coluna `ativo` (Task 1).
- Produces: nada que outra task consuma.

Esta tela é diferente das outras três e **não usa o hook inteiro**. Ela já tem ficha técnica, custo por `prompt`, regras de validade e o toggle de produção interna, tudo com estado próprio. Aqui a mudança é cirúrgica: tornar editáveis os campos-base, e acrescentar desativar.

O catálogo não é uma `<table>`, é uma lista de blocos — os botões vão no cabeçalho de cada bloco, junto do que já existe ali.

- [ ] **Step 1: Estado de edição e visibilidade**

Acrescentar o import e, dentro de `Conteudo`, o estado:

```jsx
import { camposDoFormulario } from '../../lib/cadastro';
```

```jsx
  const [editandoProduto, setEditandoProduto] = useState(null);
  const [mostrarInativos, setMostrarInativos] = useState(false);

  const produtoEmEdicao = editandoProduto ? produtos.find(p => p.id === editandoProduto) : null;
  const produtosVisiveis = mostrarInativos ? produtos : produtos.filter(p => p.ativo !== false);
```

- [ ] **Step 2: Salvar alteração além de criar**

Renomear `addProduto` para `salvarProduto` e fazer o insert virar update quando há edição. O código gerado (`proximoCodigoProduto`) só é chamado na criação — o código do produto não muda nunca:

```jsx
  async function salvarProduto(e) {
    e.preventDefault();
    const custo = parseCustoUnitario(formProd.custo_unitario);
    if (custo === null) { alert(CUSTO_INVALIDO); return; }

    const campos = {
      nome: formProd.nome,
      categoria: formProd.categoria || null,
      unidade: formProd.unidade,
      custo_unitario: custo,
      preco_venda: Number(formProd.preco_venda),
      validade_dias: Number(formProd.validade_dias) || 90,
      producao_interna: !!formProd.producao_interna,
    };

    let error;
    if (editandoProduto) {
      ({ error } = await supabase.from('produtos').update(campos).eq('id', editandoProduto));
    } else {
      const codigo = await proximoCodigoProduto(empresaAtual.id, empresaAtual.prefixo_codigo);
      ({ error } = await supabase.from('produtos').insert([{ ...campos, codigo, empresa_id: empresaAtual.id }]));
    }
    if (error) { alert('Erro ao salvar: ' + error.message); return; }
    cancelarEdicaoProduto();
    carregar();
  }

  function iniciarEdicaoProduto(p) {
    setFormProd(camposDoFormulario(p, PROD_VAZIO));
    setEditandoProduto(p.id);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelarEdicaoProduto() {
    setFormProd(PROD_VAZIO);
    setEditandoProduto(null);
  }

  async function alternarAtivoProduto(p) {
    const { error } = await supabase.from('produtos')
      .update({ ativo: !(p.ativo !== false) }).eq('id', p.id);
    if (error) { alert('Não foi possível mudar a situação: ' + error.message); return; }
    carregar();
  }
```

Trocar o `onSubmit={addProduto}` do formulário por `onSubmit={salvarProduto}`.

- [ ] **Step 3: Formulário que anuncia a edição**

Trocar o `<h3>Novo produto</h3>` por:

```jsx
        <h3>{produtoEmEdicao ? `Editando: ${produtoEmEdicao.codigo} — ${produtoEmEdicao.nome}` : 'Novo produto'}</h3>
```

E o botão do formulário por:

```jsx
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <button className="btn" type="submit">{editandoProduto ? 'Salvar alterações' : 'Adicionar produto'}</button>
            {editandoProduto && <button className="btn secondary" type="button" onClick={cancelarEdicaoProduto}>Cancelar</button>}
          </div>
```

- [ ] **Step 4: Botões e filtro no catálogo**

No painel do catálogo, trocar o `<h3>` por um cabeçalho com a caixa de inativos, e trocar `produtos.map` por `produtosVisiveis.map` (e `produtos.length` por `produtosVisiveis.length` na contagem):

```jsx
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h3>Catálogo de produtos ({produtosVisiveis.length})</h3>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={mostrarInativos} onChange={e => setMostrarInativos(e.target.checked)} />
            Mostrar inativos
          </label>
        </div>
```

No cabeçalho de cada bloco de produto, ao lado do botão de excluir que já existe ali, acrescentar:

```jsx
                  <button className="btn secondary" onClick={() => iniciarEdicaoProduto(p)}>Editar</button>
                  <button className="btn secondary" onClick={() => alternarAtivoProduto(p)}>{p.ativo === false ? 'Reativar' : 'Desativar'}</button>
```

E marcar visualmente o bloco inativo, aplicando `style={{ opacity: 0.55 }}` no `div.items-list` quando `p.ativo === false`, e acrescentando a tag ao lado do nome:

```jsx
                  {p.ativo === false && <span className="tag warn" style={{ marginLeft: 8 }}>inativo</span>}
```

- [ ] **Step 5: Verificar**

Rodar: `npm run verify`
Esperado: testes passando e build sem erro.

- [ ] **Step 6: Commit**

```bash
git add app/produtos/page.js
git commit -m "feat(produtos): editar campos-base e desativar produto"
```

---

## Task 7: Esconder o inativo das listas de seleção

**Files:**
- Modify: `app/pedidos/page.js`
- Modify: `app/producoes/nova/page.js`
- Modify: `app/producoes/completa/page.js`
- Modify: `app/financeiro/contas-a-pagar/page.js`

**Interfaces:**
- Consumes: coluna `ativo` (Task 1) e os cadastros que agora sabem desativar (Tasks 3 a 6).
- Produces: nada.

**A regra desta task, e o motivo dela.** O filtro vai **onde as `<option>` são montadas**, nunca na consulta ao banco. A consulta continua trazendo tudo.

O motivo é concreto: o Recebimento filtra matéria-prima por `ativo` na própria consulta, e foi exatamente isso que, na revisão da fase 1 da NF-e, fez um item da nota desaparecer da tela sem aviso nenhum — a matéria-prima estava desativada, o de-para continuava apontando para ela, e o item sumiu entre a montagem e a exibição. Filtrar na consulta esconde o registro também de onde ele precisa aparecer.

Não altere a consulta de matéria-prima do Recebimento nesta task; ela é anterior e mexer nela sai do escopo.

Pela mesma razão, **não acrescente filtro de `ativo` em `app/api/nfe/documentos/[chave]/preparar/route.js`**. Aquela rota casa fornecedor por CNPJ, e um fornecedor desativado precisa continuar sendo encontrado — se não for, a tela manda cadastrar de novo e produz o fornecedor duplicado que a migração 23 acabou de limpar.

- [ ] **Step 1: Aplicar o padrão em cada `<select>`**

Em cada arquivo, ache o `<select>` que lista a entidade e filtre na hora de montar as opções. O padrão é este — mantendo a opção do próprio registro quando ele já está selecionado, para que um pedido antigo apontando para um produto desativado não perca a seleção ao ser reaberto:

```jsx
{produtos.filter(p => p.ativo !== false || p.id === valorSelecionado)
        .map(p => <option key={p.id} value={p.id}>{p.codigo} — {p.nome}</option>)}
```

Onde aplicar:

| arquivo | entidade | consulta que já existe (não mexer) |
| --- | --- | --- |
| `app/pedidos/page.js` | clientes | linha com `from('clientes').select('id, nome')` |
| `app/pedidos/page.js` | produtos | linha com `from('produtos').select('*')` |
| `app/producoes/nova/page.js` | produtos | linha com `from('produtos').select('id, codigo, nome, unidade, modelo_etiqueta')` |
| `app/producoes/completa/page.js` | produtos | linha com `from('produtos').select('*')` |
| `app/producoes/completa/page.js` | matérias-primas | linha com `from('materias_primas').select('*')` |
| `app/financeiro/contas-a-pagar/page.js` | fornecedores | linha com `from('fornecedores').select('id, nome')` |
| `app/produtos/page.js` | matérias-primas na ficha técnica | linha com `from('materias_primas').select('*')` |

- [ ] **Step 2: Conferir que nenhuma tela histórica perdeu nome**

Antes de commitar, procure em cada arquivo alterado se o mesmo array também é usado para **exibir** registro já gravado — tipicamente um `.find(x => x.id === algumId)?.nome` no meio de uma tabela de histórico. Se for o caso, esse ponto deve continuar buscando na lista completa, não na filtrada. Nomeie no relatório cada arquivo onde isso acontecia e o que você fez.

- [ ] **Step 3: Verificar**

Rodar: `npm run verify`
Esperado: testes passando e build sem erro.

- [ ] **Step 4: Commit**

```bash
git add app/pedidos/page.js app/producoes/nova/page.js app/producoes/completa/page.js app/financeiro/contas-a-pagar/page.js app/produtos/page.js
git commit -m "feat(cadastros): esconder registro inativo das listas de selecao"
```

---

## Verificação final

- [ ] `npm run verify` passa: os 6 testes novos de `cadastro` mais os que já existiam, e o build sem erro.
- [ ] A migração 26 está aplicada no Supabase.
- [ ] Editar um cliente, um fornecedor, uma matéria-prima e um produto muda o registro e não cria duplicado.
- [ ] Cancelar a edição devolve o formulário ao estado de cadastro novo.
- [ ] Desativar tira o registro do `<select>` correspondente e o mantém no histórico e nos relatórios.
- [ ] Editar um fornecedor com CNPJ pontuado grava só dígitos, e a importação de NF-e continua casando esse fornecedor.
- [ ] O código do produto continua o mesmo depois de editar o produto.
