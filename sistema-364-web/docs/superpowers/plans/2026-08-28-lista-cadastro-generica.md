# ListaCadastro genérico Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalizar `components/ListaCadastro.js` para ganhar colunas redimensionáveis, escondíveis, ordenáveis por clique e paginação com seletor de tamanho — o controle que hoje só existe (escrito à mão) em `app/produtos/page.js` — e migrar as telas de Produtos e Clientes para usá-lo.

**Architecture:** A mecânica pura (clamp de largura, comparador de ordenação, fatiamento de página, chaves de `localStorage`, toggles de visibilidade/ordenação) vira funções puras em `lib/listaCadastro.js`, testáveis com `node:test` no mesmo padrão de `lib/fiscal.js`. `components/ListaCadastro.js` passa a ter estado próprio (largura/visibilidade/ordenação/página por coluna, namespaced por uma prop `chave`) e usa essas funções puras; o desenho de célula (`render`, `mono`, `alinhamento`, `textoPuro`) continua sendo responsabilidade de cada coluna, como já é hoje. Cada tela consumidora só define o array de colunas e passa os registros já filtrados — busca/status continuam sendo filtro de domínio da própria tela.

**Tech Stack:** Next.js 14 (App Router, client components), React hooks, `node:test`/`node:assert` para os testes de lógica pura, sem biblioteca de tabela.

**Spec:** `docs/superpowers/specs/2026-08-28-lista-cadastro-generica-design.md`

## Global Constraints

- `chave` é obrigatória em todo uso de `<ListaCadastro>` — namespacea as chaves de `localStorage` (`${chave}:colunas:largura`, `${chave}:colunas:visiveis`, `${chave}:paginacao:tamanho`).
- Toda coluna precisa de `id` estável (não usar `titulo` como chave — rótulo muda, preferência salva não pode quebrar).
- `principal` continua a única coluna flexível: nunca redimensionável, nunca escondível.
- `tamanhosPagina` default `[25, 50, 100, 200]` mais a opção "Todos" (valor `0`); default de `larguraMaxima` é `1200`.
- Barra de paginação só aparece quando há mais de 1 página (`totalPaginas > 1`) — evita poluir lista pequena.
- Sem paginação no servidor nesta fase — `.range()` do Supabase fica fora de escopo.
- Mobile: `.table-wrap{overflow-x:auto}` (padrão já existente no projeto) substitui o reflow de "cartão" específico de Produtos.

---

## Task 1: Lógica pura de `ListaCadastro` em `lib/listaCadastro.js`

**Files:**
- Create: `lib/listaCadastro.js`
- Test: `tests/listaCadastro.test.mjs`

**Interfaces:**
- Produces (usado pela Task 2):
  - `clampLargura(largura, minimo, maximo): number`
  - `larguraMaximaPadrao(largura): number`
  - `chaveLargura(chave): string`
  - `chaveVisiveis(chave): string`
  - `chaveTamanhoPagina(chave): string`
  - `colunaVisivel(colunas, colunasVisiveis, id): boolean`
  - `alternarColuna(colunasVisiveis, id): object`
  - `alternarOrdenacao(ordenacaoAtual, campo): { campo, direcao }`
  - `ordenarRegistros(registros, colunas, ordenacao): array`
  - `paginar(registros, pagina, tamanhoPagina): { linhas, paginaAtual, totalPaginas, inicio, fim, total }`

- [ ] **Step 1: Escrever os testes (falhando)**

Crie `tests/listaCadastro.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampLargura, larguraMaximaPadrao, chaveLargura, chaveVisiveis, chaveTamanhoPagina,
  colunaVisivel, alternarColuna, alternarOrdenacao, ordenarRegistros, paginar,
} from '../lib/listaCadastro.js';

test('clampLargura mantém dentro do intervalo e corta nas pontas', () => {
  assert.equal(clampLargura(100, 40, 200), 100);
  assert.equal(clampLargura(10, 40, 200), 40);
  assert.equal(clampLargura(500, 40, 200), 200);
});

test('larguraMaximaPadrao é o triplo da largura, com teto de 400', () => {
  assert.equal(larguraMaximaPadrao(60), 180);
  assert.equal(larguraMaximaPadrao(200), 400);
});

test('chaves de localStorage são namespaced pela tela', () => {
  assert.equal(chaveLargura('produtos'), 'produtos:colunas:largura');
  assert.equal(chaveVisiveis('clientes'), 'clientes:colunas:visiveis');
  assert.equal(chaveTamanhoPagina('produtos'), 'produtos:paginacao:tamanho');
});

test('colunaVisivel: coluna não-escondível é sempre visível', () => {
  const colunas = [{ id: 'nome', escondivel: false }];
  assert.equal(colunaVisivel(colunas, { nome: false }, 'nome'), true);
});

test('colunaVisivel: coluna escondível é visível por padrão até ser desmarcada', () => {
  const colunas = [{ id: 'ncm', escondivel: true }];
  assert.equal(colunaVisivel(colunas, {}, 'ncm'), true);
  assert.equal(colunaVisivel(colunas, { ncm: false }, 'ncm'), false);
  assert.equal(colunaVisivel(colunas, { ncm: true }, 'ncm'), true);
});

test('alternarColuna liga/desliga a partir do estado atual', () => {
  const v1 = alternarColuna({}, 'ncm');
  assert.equal(v1.ncm, false);
  const v2 = alternarColuna(v1, 'ncm');
  assert.equal(v2.ncm, true);
});

test('alternarOrdenacao: primeiro clique ordena crescente', () => {
  assert.deepEqual(alternarOrdenacao({ campo: null, direcao: 'asc' }, 'nome'), { campo: 'nome', direcao: 'asc' });
});

test('alternarOrdenacao: clicar de novo na mesma coluna inverte', () => {
  assert.deepEqual(alternarOrdenacao({ campo: 'nome', direcao: 'asc' }, 'nome'), { campo: 'nome', direcao: 'desc' });
  assert.deepEqual(alternarOrdenacao({ campo: 'nome', direcao: 'desc' }, 'nome'), { campo: 'nome', direcao: 'asc' });
});

test('alternarOrdenacao: clicar em coluna diferente reseta para crescente', () => {
  assert.deepEqual(alternarOrdenacao({ campo: 'nome', direcao: 'desc' }, 'custo'), { campo: 'custo', direcao: 'asc' });
});

test('ordenarRegistros ordena string com localeCompare pt-BR', () => {
  const colunas = [{ id: 'nome', valor: r => r.nome }];
  const registros = [{ nome: 'Éclair' }, { nome: 'Bolo' }, { nome: 'Água' }];
  const asc = ordenarRegistros(registros, colunas, { campo: 'nome', direcao: 'asc' });
  assert.deepEqual(asc.map(r => r.nome), ['Água', 'Bolo', 'Éclair']);
  const desc = ordenarRegistros(registros, colunas, { campo: 'nome', direcao: 'desc' });
  assert.deepEqual(desc.map(r => r.nome), ['Éclair', 'Bolo', 'Água']);
});

test('ordenarRegistros ordena número corretamente (não como string)', () => {
  const colunas = [{ id: 'custo', valor: r => r.custo }];
  const registros = [{ custo: 9 }, { custo: 100 }, { custo: 20 }];
  const asc = ordenarRegistros(registros, colunas, { campo: 'custo', direcao: 'asc' });
  assert.deepEqual(asc.map(r => r.custo), [9, 20, 100]);
});

test('ordenarRegistros sem campo escolhido devolve a lista como veio', () => {
  const colunas = [{ id: 'nome', valor: r => r.nome }];
  const registros = [{ nome: 'B' }, { nome: 'A' }];
  const resultado = ordenarRegistros(registros, colunas, { campo: null, direcao: 'asc' });
  assert.deepEqual(resultado, registros);
});

test('ordenarRegistros em coluna sem valor() devolve a lista como veio', () => {
  const colunas = [{ id: 'fiscal' }];
  const registros = [{ fiscal: true }, { fiscal: false }];
  const resultado = ordenarRegistros(registros, colunas, { campo: 'fiscal', direcao: 'asc' });
  assert.deepEqual(resultado, registros);
});

test('paginar fatia a página certa e calcula o intervalo mostrado', () => {
  const registros = Array.from({ length: 55 }, (_, i) => ({ id: i + 1 }));
  const p1 = paginar(registros, 1, 25);
  assert.equal(p1.linhas.length, 25);
  assert.equal(p1.linhas[0].id, 1);
  assert.equal(p1.totalPaginas, 3);
  assert.equal(p1.inicio, 1);
  assert.equal(p1.fim, 25);

  const p3 = paginar(registros, 3, 25);
  assert.equal(p3.linhas.length, 5);
  assert.equal(p3.paginaAtual, 3);
  assert.equal(p3.inicio, 51);
  assert.equal(p3.fim, 55);
});

test('paginar com tamanhoPagina 0 (Todos) devolve tudo numa página só', () => {
  const registros = Array.from({ length: 55 }, (_, i) => ({ id: i + 1 }));
  const resultado = paginar(registros, 1, 0);
  assert.equal(resultado.linhas.length, 55);
  assert.equal(resultado.totalPaginas, 1);
  assert.equal(resultado.inicio, 1);
  assert.equal(resultado.fim, 55);
});

test('paginar com lista vazia não quebra e mostra intervalo 0', () => {
  const resultado = paginar([], 1, 25);
  assert.equal(resultado.linhas.length, 0);
  assert.equal(resultado.totalPaginas, 1);
  assert.equal(resultado.inicio, 0);
  assert.equal(resultado.fim, 0);
});

test('paginar corrige página fora do intervalo (ex.: filtro reduziu o total)', () => {
  const registros = Array.from({ length: 10 }, (_, i) => ({ id: i + 1 }));
  const resultado = paginar(registros, 9, 25);
  assert.equal(resultado.paginaAtual, 1);
  assert.equal(resultado.totalPaginas, 1);
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node --test tests/listaCadastro.test.mjs`
Expected: FAIL — `Cannot find module '../lib/listaCadastro.js'`

- [ ] **Step 3: Implementar `lib/listaCadastro.js`**

```js
// Mecânica pura por trás do componente ListaCadastro: redimensionar, esconder
// coluna, ordenar por clique e paginar. Fica em lib/ (não em components/)
// porque não depende de React nem do DOM — só de arrays e objetos — e assim
// dá para testar direto com node:test, no mesmo padrão de lib/fiscal.js.

export function clampLargura(largura, minimo, maximo) {
  return Math.min(maximo, Math.max(minimo, largura));
}

export function larguraMaximaPadrao(largura) {
  return Math.min(400, largura * 3);
}

export function chaveLargura(chave) {
  return `${chave}:colunas:largura`;
}

export function chaveVisiveis(chave) {
  return `${chave}:colunas:visiveis`;
}

export function chaveTamanhoPagina(chave) {
  return `${chave}:paginacao:tamanho`;
}

// Coluna sem `escondivel` (ou com escondivel:false) nunca sai de vista — é o
// caso das colunas fixas (ex.: nome). As demais ficam visíveis até alguém
// desmarcar no menu; por isso "ausente no estado" também conta como visível.
export function colunaVisivel(colunas, colunasVisiveis, id) {
  const coluna = colunas.find(c => c.id === id);
  if (!coluna || !coluna.escondivel) return true;
  return colunasVisiveis[id] !== false;
}

export function alternarColuna(colunasVisiveis, id) {
  return { ...colunasVisiveis, [id]: colunasVisiveis[id] === false ? true : false };
}

export function alternarOrdenacao(ordenacaoAtual, campo) {
  if (ordenacaoAtual.campo === campo) {
    return { campo, direcao: ordenacaoAtual.direcao === 'asc' ? 'desc' : 'asc' };
  }
  return { campo, direcao: 'asc' };
}

// `valor()` (não `render()`) é o que compara — a célula pode desenhar "R$
// 45,50" enquanto o valor comparável é o número 45.5. Coluna sem `valor()`
// não ordena: devolve a lista como veio em vez de quebrar.
export function ordenarRegistros(registros, colunas, ordenacao) {
  if (!ordenacao.campo) return registros;
  const coluna = colunas.find(c => c.id === ordenacao.campo);
  if (!coluna || !coluna.valor) return registros;
  const dir = ordenacao.direcao === 'asc' ? 1 : -1;
  return [...registros].sort((a, b) => {
    const va = coluna.valor(a);
    const vb = coluna.valor(b);
    if (typeof va === 'string' || typeof vb === 'string') {
      return String(va ?? '').localeCompare(String(vb ?? ''), 'pt-BR') * dir;
    }
    return ((va ?? 0) - (vb ?? 0)) * dir;
  });
}

// tamanhoPagina 0 = "Todos": uma página só, do tamanho da lista inteira.
// paginaAtual sempre cai dentro de [1, totalPaginas] mesmo que `pagina` peça
// uma página que não existe mais (ex.: um filtro reduziu o total enquanto a
// pessoa estava numa página adiantada).
export function paginar(registros, pagina, tamanhoPagina) {
  const total = registros.length;
  const totalPaginas = tamanhoPagina ? Math.max(1, Math.ceil(total / tamanhoPagina)) : 1;
  const paginaAtual = Math.min(Math.max(1, pagina), totalPaginas);
  const linhas = tamanhoPagina
    ? registros.slice((paginaAtual - 1) * tamanhoPagina, paginaAtual * tamanhoPagina)
    : registros;
  const inicio = total ? (tamanhoPagina ? (paginaAtual - 1) * tamanhoPagina + 1 : 1) : 0;
  const fim = tamanhoPagina ? Math.min(paginaAtual * tamanhoPagina, total) : total;
  return { linhas, paginaAtual, totalPaginas, inicio, fim, total };
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node --test tests/listaCadastro.test.mjs`
Expected: PASS (18 testes)

- [ ] **Step 5: Commit**

```bash
git add lib/listaCadastro.js tests/listaCadastro.test.mjs
git commit -m "feat(lista-cadastro): lógica pura de redimensionar/esconder/ordenar/paginar coluna"
```

---

## Task 2: Generalizar `components/ListaCadastro.js`

**Files:**
- Modify: `components/ListaCadastro.js` (reescrita completa — hoje tem 59 linhas, sem estado)

**Interfaces:**
- Consumes: todas as funções de `lib/listaCadastro.js` (Task 1).
- Produces (usado pela Task 4 e Task 5):
  - Prop `chave: string` (obrigatória).
  - Formato de coluna estendido: `{ id, titulo, largura, principal, minimo, larguraMax, escondivel, ordenavel, valor(r), render(r), mono, alinhamento, textoPuro(r) }` — todos os campos além de `id`/`titulo`/`render` continuam opcionais, como já eram.
  - Props opcionais `tamanhosPagina` (default `[25, 50, 100, 200]`) e `larguraMaxima` (default `1200`).

- [ ] **Step 1: Reescrever o componente**

Substitua todo o conteúdo de `components/ListaCadastro.js`:

```jsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  clampLargura, larguraMaximaPadrao, chaveLargura, chaveVisiveis, chaveTamanhoPagina,
  colunaVisivel, alternarColuna, alternarOrdenacao, ordenarRegistros, paginar,
} from '../lib/listaCadastro';

// Lista de cadastro com cabeçalho de colunas, no padrão da tela de Produtos:
// a lista ocupa a tela e a ficha abre por cima.
//
// Cabeçalho e linha desenham a partir da MESMA definição de colunas — foi assim
// que o desalinhamento entre rótulo e valor deixou de ser possível. Largura,
// visibilidade, ordenação e página são estado do próprio componente, guardado
// em localStorage sob o prefixo `chave` — cada tela que usa isto ganha as
// quatro capacidades de graça, sem repetir a mecânica. Busca/filtro de status
// continuam sendo responsabilidade de cada tela: chegam aqui já aplicados,
// dentro de `registros`.

const TAMANHOS_PAGINA_PADRAO = [25, 50, 100, 200];

function estiloDaColuna(col, largurasColunas) {
  if (col.principal) return { flex: '1 1 0', minWidth: col.minimo || 160 };
  const largura = largurasColunas[col.id] ?? col.largura ?? 110;
  return { flex: 'none', width: largura };
}

function justificarCabecalho(alinhamento) {
  if (alinhamento === 'right') return 'flex-end';
  if (alinhamento === 'center') return 'center';
  return undefined;
}

export default function ListaCadastro({
  chave, colunas, registros, selecionado, onAbrir, vazio, rotulo = 'Registros',
  tamanhosPagina = TAMANHOS_PAGINA_PADRAO, larguraMaxima = 1200,
}) {
  const [largurasColunas, setLargurasColunas] = useState({});
  const [colunasVisiveis, setColunasVisiveis] = useState({});
  const [ordenacao, setOrdenacao] = useState({ campo: null, direcao: 'asc' });
  const [pagina, setPagina] = useState(1);
  const [tamanhoPagina, setTamanhoPagina] = useState(tamanhosPagina[0]);
  const [menuColunasAberto, setMenuColunasAberto] = useState(false);
  const hidratadoRef = useRef(false);

  // Lê preferências salvas na visita anterior. Roda só uma vez, depois do
  // primeiro render, porque no servidor não existe localStorage.
  useEffect(() => {
    try {
      const l = window.localStorage.getItem(chaveLargura(chave));
      if (l) setLargurasColunas(JSON.parse(l));
      const v = window.localStorage.getItem(chaveVisiveis(chave));
      if (v) setColunasVisiveis(JSON.parse(v));
      const t = window.localStorage.getItem(chaveTamanhoPagina(chave));
      if (t !== null) setTamanhoPagina(Number(t));
    } catch {}
    hidratadoRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  useEffect(() => {
    if (!hidratadoRef.current) return;
    try { window.localStorage.setItem(chaveLargura(chave), JSON.stringify(largurasColunas)); } catch {}
  }, [chave, largurasColunas]);

  useEffect(() => {
    if (!hidratadoRef.current) return;
    try { window.localStorage.setItem(chaveVisiveis(chave), JSON.stringify(colunasVisiveis)); } catch {}
  }, [chave, colunasVisiveis]);

  useEffect(() => {
    if (!hidratadoRef.current) return;
    try { window.localStorage.setItem(chaveTamanhoPagina(chave), String(tamanhoPagina)); } catch {}
  }, [chave, tamanhoPagina]);

  // O total mudou (busca/status filtrou diferente na tela-mãe) ou o tamanho de
  // página mudou: a página atual pode não existir mais, então volta para 1.
  useEffect(() => { setPagina(1); }, [registros.length, tamanhoPagina]);

  const registrosOrdenados = useMemo(
    () => ordenarRegistros(registros, colunas, ordenacao),
    [registros, colunas, ordenacao],
  );

  const { linhas, paginaAtual, totalPaginas, inicio, fim, total } = useMemo(
    () => paginar(registrosOrdenados, pagina, tamanhoPagina),
    [registrosOrdenados, pagina, tamanhoPagina],
  );

  function iniciarRedimensionar(e, col) {
    e.preventDefault();
    e.stopPropagation();
    const larguraAtual = largurasColunas[col.id] ?? col.largura ?? 110;
    const minimo = col.larguraMin || 40;
    const maximo = col.larguraMax || larguraMaximaPadrao(col.largura || 110);
    const xInicial = e.clientX;
    function mover(ev) {
      const nova = clampLargura(larguraAtual + (ev.clientX - xInicial), minimo, maximo);
      setLargurasColunas(l => ({ ...l, [col.id]: nova }));
    }
    function soltar() {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
    }
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  }

  // Sem o ⇅ nas colunas que ainda não foram ordenadas, nada no cabeçalho
  // avisa que o título é clicável — a seta só aparece depois do primeiro clique.
  function indicadorOrdenacao(id) {
    const ativo = ordenacao.campo === id;
    const simbolo = ativo ? (ordenacao.direcao === 'asc' ? '▲' : '▼') : '⇅';
    return <span className={'col-ordenacao' + (ativo ? ' ativo' : '')}> {simbolo}</span>;
  }

  const colunasNaTela = colunas.filter(col => colunaVisivel(colunas, colunasVisiveis, col.id));
  const colunasEscondiveis = colunas.filter(col => col.escondivel);

  if (!registros.length) {
    return <p className="muted" style={{ padding: '18px 0' }}>{vazio}</p>;
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <span className="muted" style={{ fontSize: 11.5 }}>
          {inicio}–{fim} de {total} registro{total === 1 ? '' : 's'}
        </span>
        {colunasEscondiveis.length > 0 && (
          <div style={{ position: 'relative' }}>
            <button type="button" className="btn secondary small" onClick={() => setMenuColunasAberto(a => !a)}>
              Colunas
            </button>
            {menuColunasAberto && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 29 }} onClick={() => setMenuColunasAberto(false)} />
                <div className="colunas-menu">
                  {colunasEscondiveis.map(col => (
                    <label key={col.id}>
                      <input type="checkbox" checked={colunaVisivel(colunas, colunasVisiveis, col.id)}
                             onChange={() => setColunasVisiveis(v => alternarColuna(v, col.id))} />
                      {col.titulo}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="table-wrap">
        <div className="registro-lista" role="listbox" aria-label={rotulo} style={{ maxWidth: larguraMaxima }}>
          <div className="registro-cabecalho" aria-hidden="true">
            {colunasNaTela.map(col => (
              <span key={col.id} className="col-cel"
                    style={{
                      ...estiloDaColuna(col, largurasColunas),
                      position: col.principal ? undefined : 'relative',
                      justifyContent: justificarCabecalho(col.alinhamento),
                    }}>
                {col.ordenavel
                  ? (
                    <span className="col-titulo" onClick={() => setOrdenacao(o => alternarOrdenacao(o, col.id))}>
                      <span className="col-titulo-texto">{col.titulo}</span>
                      {indicadorOrdenacao(col.id)}
                    </span>
                  )
                  : col.titulo}
                {!col.principal && (
                  <span className="col-resize-handle" onPointerDown={e => iniciarRedimensionar(e, col)} />
                )}
              </span>
            ))}
          </div>

          {linhas.map(r => (
            <button type="button" key={r.id} role="option"
                    aria-selected={selecionado === r.id}
                    className={'registro' + (r.ativo === false ? ' inativo' : '')}
                    onClick={() => onAbrir(r)}>
              {colunasNaTela.map(col => {
                const conteudo = col.render(r);
                return (
                  <span key={col.id}
                        className={col.mono ? 'mono' : undefined}
                        style={{
                          ...estiloDaColuna(col, largurasColunas),
                          textAlign: col.alinhamento || 'left',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={col.titulo + ': ' + (col.textoPuro ? col.textoPuro(r) : '')}>
                    {conteudo ?? <span className="muted">—</span>}
                  </span>
                );
              })}
            </button>
          ))}
        </div>
      </div>

      {totalPaginas > 1 && (
        <div className="paginacao">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" className="btn secondary small" disabled={paginaAtual <= 1}
                    onClick={() => setPagina(p => Math.max(1, p - 1))}>Anterior</button>
            <span className="muted">Página {paginaAtual} de {totalPaginas}</span>
            <button type="button" className="btn secondary small" disabled={paginaAtual >= totalPaginas}
                    onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))}>Próxima</button>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
            Por página
            <select value={tamanhoPagina} onChange={e => setTamanhoPagina(Number(e.target.value))}>
              {tamanhosPagina.map(n => <option key={n} value={n}>{n}</option>)}
              <option value={0}>Todos</option>
            </select>
          </label>
        </div>
      )}
    </>
  );
}
```

Nota sobre comportamento: com `conteudo ?? <span className="muted">—</span>` (linha que já existia no componente original), qualquer coluna cujo `render()` devolva `null`/`undefined` mostra um traço — isso já valia para Clientes hoje. Ao migrar Produtos (Task 5), colunas que antes ficavam em branco quando vazias (categoria sem valor, fiscal indisponível) passam a mostrar "—", ficando consistentes com o resto do sistema.

- [ ] **Step 2: Rodar o build para pegar erro de sintaxe/import**

Run: `npx next build --no-lint 2>&1 | head -60` (interrompa com Ctrl+C assim que "Compiled" ou o primeiro erro aparecer — não precisa esperar o build completo; isto só valida sintaxe/imports, não substitui o teste manual no browser das Tasks 4 e 5).
Expected: sem erro de compilação relacionado a `ListaCadastro.js` (o build pode falhar mais adiante por causa da Task 4/5 ainda não terem sido feitas — se `app/clientes/page.js` ainda usa o formato antigo de coluna sem `id`, o React vai reclamar em runtime, não em build; ignore isso por ora, é resolvido na Task 4).

- [ ] **Step 3: Commit**

```bash
git add components/ListaCadastro.js
git commit -m "feat(lista-cadastro): componente ganha redimensionar/esconder/ordenar coluna e paginação"
```

---

## Task 3: Remover o hack de mobile específico de Produtos do `globals.css`

**Files:**
- Modify: `app/globals.css:482-508`

**Interfaces:**
- Consumes: nenhuma (CSS puro).
- Produces: nenhuma — `.table-wrap{overflow-x:auto}` (já existe em `app/globals.css`, não precisa ser criada) passa a ser o único mecanismo de rolagem horizontal em telas estreitas para qualquer `<ListaCadastro>`.

- [ ] **Step 1: Remover o bloco de reflow em grid**

Dentro do `@media(max-width:900px){...}` (que começa em `app/globals.css:458`), remova estas linhas (hoje em `app/globals.css:482-508`) — o comentário e as sete regras abaixo dele:

```css
  /* Com a linha em duas alturas o cabeçalho deixaria de apontar para as colunas
     certas, então ele sai — no celular cada valor carrega seu próprio title. */
  .registro-cabecalho{display:none;}

  /* A ficha vira tela cheia: 96vw dentro de 375px deixa uma moldura inútil e
     encolhe justamente o formulário que a pessoa veio preencher. */
  .modal-backdrop{padding:0;}
  .modal-box.wide{
    width:100vw; max-width:100vw; height:100dvh; max-height:100dvh;
    border-radius:0; border:0;
  }
  .modal-box.wide .tabs{padding:0 16px !important; top:53px;}
  .modal-body{padding:14px 16px 18px;}
  .modal-head,.modal-foot{padding:12px 16px;}

  /* A linha do produto passa a ocupar duas: nome em cima, números embaixo.
     Antes os valores saíam pela direita da tela e ninguém os via. */
  .registro{
    display:grid; grid-template-columns:auto 1fr auto; grid-template-areas:'cod nome tag' 'val val val';
    gap:4px 8px; padding:11px 12px;
  }
  .registro .codigo{grid-area:cod;}
  .registro .nome{grid-area:nome; white-space:normal;}
  .registro .tag.categoria{grid-area:nome; justify-self:end; align-self:center; max-width:96px;}
  .registro .tag{grid-area:tag;}
  .registro .valores{grid-area:val; justify-content:flex-start; gap:16px;}
  .registro .valores span{min-width:0; text-align:left;}
```

**Cuidado:** este bloco tem regras de `.modal-backdrop`/`.modal-box.wide`/`.modal-body`/`.modal-head,.modal-foot` misturadas — **essas ficam** (é o modal de ficha virando tela cheia no celular, sem relação com a lista). Remova só o comentário+regra de `.registro-cabecalho{display:none;}` do início e o bloco de `.registro{display:grid...}` até `.registro .valores span{...}` do fim — mantendo as regras de modal no meio intactas.

Depois da remoção, o trecho deve ficar assim (substituindo as linhas 482-508 originais):

```css
  /* A ficha vira tela cheia: 96vw dentro de 375px deixa uma moldura inútil e
     encolhe justamente o formulário que a pessoa veio preencher. */
  .modal-backdrop{padding:0;}
  .modal-box.wide{
    width:100vw; max-width:100vw; height:100dvh; max-height:100dvh;
    border-radius:0; border:0;
  }
  .modal-box.wide .tabs{padding:0 16px !important; top:53px;}
  .modal-body{padding:14px 16px 18px;}
  .modal-head,.modal-foot{padding:12px 16px;}
```

- [ ] **Step 2: Conferir que o CSS ainda fecha certo**

Run: `python3 -c "s=open('app/globals.css').read(); print('open', s.count('{'), 'close', s.count('}'))"`
Expected: os dois números batem (mesmo valor de antes da remoção, menos zero — só removemos regras completas, número de `{` e `}` continuam iguais entre si).

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "refactor(css): troca reflow de grid mobile específico de Produtos por scroll horizontal genérico"
```

---

## Task 4: Migrar `app/clientes/page.js`

**Files:**
- Modify: `app/clientes/page.js:173-236`

**Interfaces:**
- Consumes: `<ListaCadastro chave="clientes" colunas={...} .../>` (Task 2).

- [ ] **Step 1: Adicionar `id` e `escondivel` às colunas, remover a contagem manual, passar `chave`**

Substitua o bloco de `app/clientes/page.js:173-204` (array `COLUNAS`):

```jsx
  const COLUNAS = [
    { id: 'nome', titulo: 'Nome', principal: true, minimo: 200, render: p => p.nome_fantasia || p.nome, textoPuro: p => p.nome_fantasia || p.nome },
    {
      id: 'papel', titulo: 'Papel', largura: 150, escondivel: true,
      render: p => (
        <span style={{ display: 'flex', gap: 4 }}>
          {p.papeis.includes('cliente') && <span className="tag categoria">Cliente</span>}
          {p.papeis.includes('fornecedor') && <span className="tag categoria">Fornecedor</span>}
        </span>
      ),
      textoPuro: p => p.papeis.map(x => (x === 'cliente' ? 'Cliente' : 'Fornecedor')).join(' e '),
    },
    {
      id: 'documento', titulo: 'CNPJ / CPF', largura: 132, mono: true, escondivel: true,
      render: p => docFormatado(p) || null, textoPuro: p => docFormatado(p),
    },
    { id: 'municipio', titulo: 'Município', largura: 130, escondivel: true, render: p => (p.municipio ? `${p.municipio}/${p.uf || ''}` : null), textoPuro: p => p.municipio || '' },
    { id: 'contato', titulo: 'Contato', largura: 140, escondivel: true, render: p => p.contato || null, textoPuro: p => p.contato || '' },
    {
      id: 'telefone', titulo: 'Telefone', largura: 118, mono: true, escondivel: true,
      render: p => (p.telefone ? formatarTelefone(p.telefone) : null),
      textoPuro: p => (p.telefone ? formatarTelefone(p.telefone) : ''),
    },
    {
      id: 'nota', titulo: 'Nota', largura: 66, alinhamento: 'center', escondivel: true,
      render: p => (!fiscalDisponivel || !p.papeis.includes('cliente') ? null
        : pendenciasFiscaisCliente(p.cliente).length
          ? <span className="tag warn">falta</span>
          : <span className="tag ok">ok</span>),
      textoPuro: p => (!p.papeis.includes('cliente') ? '' : pendenciasFiscaisCliente(p.cliente).length ? 'faltam dados para emitir' : 'pronto para emitir'),
    },
  ];
```

Substitua o bloco de `app/clientes/page.js:206-236` (a partir de `if (loading)` até o fechamento de `</section>`):

```jsx
  if (loading) return <p className="muted">Carregando…</p>;

  return (
    <>
      <section className="panel">
        <div className="filter-bar" style={{ marginBottom: 10 }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label htmlFor="busca-parceiro">Buscar</label>
            <input id="busca-parceiro" value={busca} placeholder="nome, CNPJ, CPF, categoria ou município"
                   onChange={e => setBusca(e.target.value)} />
          </div>
          <button className="btn" type="button" onClick={abrirNovo}>
            <Icone nome="mais" tamanho={14} /> Novo parceiro
          </button>
        </div>

        <label className="check-line" style={{ fontSize: 12, marginBottom: 8 }}>
          <input type="checkbox" checked={mostrarInativos} onChange={e => setMostrarInativos(e.target.checked)} />
          Mostrar inativos
        </label>

        <ListaCadastro
          chave="clientes"
          colunas={COLUNAS} registros={visiveis} selecionado={selecionado?.id} onAbrir={abrir}
          rotulo="Clientes/Fornecedores"
          vazio={busca ? 'Nenhum parceiro encontrado para essa busca.' : 'Nenhum cliente ou fornecedor cadastrado ainda.'} />
      </section>
```

(A contagem "`{visiveis.length} de {listaParceiros.length} parceiro(s)`" que ficava numa linha própria some daqui — o `ListaCadastro` agora mostra a própria contagem, com intervalo de página incluído.)

- [ ] **Step 2: Verificar manualmente no browser**

Suba o dev server do projeto (`npm run dev`, ou reaproveite um já rodando), faça login e abra `/clientes`. Confirme:
- A lista aparece, com a contagem "X–Y de Z registros" no lugar de onde estava o texto antigo.
- Clicar em "Colunas" abre um menu com Papel/CNPJ-CPF/Município/Contato/Telefone/Nota, todas marcadas.
- Desmarcar uma delas some com a coluna; marcar de novo traz de volta.
- Arrastar a borda direita de uma coluna (ex.: CNPJ/CPF) muda a largura dela.
- Clicar no título "Nome" ordena a lista; clicar de novo inverte.
- Recarregar a página mantém a largura/visibilidade escolhidas (persistiu em `localStorage`, chave `clientes:colunas:largura` etc. — confira no DevTools se quiser).

- [ ] **Step 3: Commit**

```bash
git add app/clientes/page.js
git commit -m "refactor(clientes): migra para o ListaCadastro genérico (redimensionar/esconder/ordenar coluna)"
```

---

## Task 5: Migrar `app/produtos/page.js` para o `ListaCadastro` genérico

**Files:**
- Modify: `app/produtos/page.js`

**Interfaces:**
- Consumes: `<ListaCadastro chave="produtos" colunas={...} .../>` (Task 2).

Esta task remove a implementação escrita à mão nesta mesma sessão (redimensionar, esconder, ordenar, paginar — tudo isso passa a vir do componente) e mantém só a lógica de domínio: busca, filtro de status, cálculo de custo/margem por produto.

- [ ] **Step 1: Import**

Em `app/produtos/page.js:2`, troque:

```js
import { useEffect, useMemo, useRef, useState } from 'react';
```

por (sem `useRef`, que só era usado pelo hidratador removido nesta task):

```js
import { useEffect, useMemo, useState } from 'react';
```

Adicione, junto dos demais imports de componentes (perto da linha 6-11):

```js
import ListaCadastro from '../../components/ListaCadastro';
```

- [ ] **Step 2: Remover as constantes de coluna no escopo do módulo**

Remova de `app/produtos/page.js:28-54` (do comentário `// Colunas da lista...` até `const LS_TAMANHO_PAGINA = ...`) — o array `COLUNAS_PRODUTOS` antigo (formato `{id, titulo, escondivel, ordenavel}`, sem `render`) e as constantes `LARGURAS_PADRAO_COLUNAS`, `LIMITES_LARGURA_COLUNAS`, `TAMANHOS_PAGINA`, `LS_LARGURAS_COLUNAS`, `LS_COLUNAS_VISIVEIS`, `LS_TAMANHO_PAGINA`. Nenhuma delas é usada fora do que as próximas steps também removem.

- [ ] **Step 3: Remover o estado de UI da lista**

Em `app/produtos/page.js`, o bloco de `useState`/`useRef` (linhas 115-124) hoje é:

```js
  const [statusFiltro, setStatusFiltro] = useState('ativos'); // 'ativos' | 'inativos' | 'todos'
  const [largurasColunas, setLargurasColunas] = useState({});
  const [colunasVisiveis, setColunasVisiveis] = useState({});
  const [menuColunasAberto, setMenuColunasAberto] = useState(false);
  const [ordenacao, setOrdenacao] = useState({ campo: null, direcao: 'asc' });
  const [pagina, setPagina] = useState(1);
  const [tamanhoPagina, setTamanhoPagina] = useState(50);
  // Guarda contra sobrescrever o localStorage com os valores padrão antes de
  // termos lido o que já estava salvo — sem isto o primeiro render some com a
  // preferência da visita anterior.
  const hidratadoRef = useRef(false);
```

Troque por (só o filtro de domínio continua):

```js
  const [statusFiltro, setStatusFiltro] = useState('ativos'); // 'ativos' | 'inativos' | 'todos'
```

- [ ] **Step 4: Remover os efeitos de hidratação/persistência e o reset de página**

Remova de `app/produtos/page.js:196-227` (do comentário `// Lê preferências salvas...` até o `useEffect` de `setPagina(1)` inclusive) — os quatro `useEffect` de `localStorage` mais o `useEffect(() => { setPagina(1); }, [busca, statusFiltro, tamanhoPagina]);`. O `useEffect` de `carregar()` (linha 184) e o de Esc (linhas 186-194), que vêm antes deste bloco, **continuam intactos**.

- [ ] **Step 5: Achatar `linhas` para o formato que o `ListaCadastro` espera**

`ListaCadastro` lê `r.id` e `r.ativo` direto no registro (é o mesmo contrato que Clientes já usa). Troque o `useMemo` de `linhas` (hoje envolvendo `{ produto, custoEfetivo, margem }`):

```js
  const linhas = useMemo(() => visiveis.map(p => {
    const custoT = custoTeorico(p.id);
    const custoEfetivo = Number(p.custo_unitario) > 0 ? Number(p.custo_unitario) : custoT;
    const margem = Number(p.preco_venda)
      ? ((Number(p.preco_venda) - custoEfetivo) / Number(p.preco_venda) * 100) : 0;
    return { produto: p, custoEfetivo, margem };
  }), [visiveis, fichas, mps]);
```

por uma versão achatada (todos os campos do produto direto no objeto, mais `custoEfetivo`/`margem`):

```js
  // custoEfetivo/margem entram junto dos campos do produto (não aninhados) —
  // é o formato que ListaCadastro espera (r.id, r.ativo direto no registro).
  const linhas = useMemo(() => visiveis.map(p => {
    const custoT = custoTeorico(p.id);
    const custoEfetivo = Number(p.custo_unitario) > 0 ? Number(p.custo_unitario) : custoT;
    const margem = Number(p.preco_venda)
      ? ((Number(p.preco_venda) - custoEfetivo) / Number(p.preco_venda) * 100) : 0;
    return { ...p, custoEfetivo, margem };
  }), [visiveis, fichas, mps]);
```

- [ ] **Step 6: Remover ordenação/paginação/visibilidade/redimensionamento manuais**

Remova de `app/produtos/page.js:261-354` (de `const VALOR_ORDENACAO = {` até o fechamento de `celulaCabecalho`, função por função: `VALOR_ORDENACAO`, `linhasOrdenadas`, `alternarOrdenacao`, `indicadorOrdenacao`, `colunaVisivel`, `alternarColuna`, `iniciarRedimensionar`, `celulaCabecalho`). Tudo isso agora vive dentro do `ListaCadastro` (Task 2). A função `abrir(p)` (hoje logo depois) continua intacta, junto com todas as outras funções de domínio até `salvarRegra`.

- [ ] **Step 7: Remover os cálculos de paginação antes do `return` e definir `COLUNAS_PRODUTOS`**

Troque (hoje logo antes do `return (`):

```js
  if (loading) return <p className="muted">Carregando…</p>;

  const fichaAberta = criando || !!produtoSelecionado;
  const pendencias = fiscalDisponivel ? pendenciasFiscaisProduto(formProd) : [];

  // tamanhoPagina 0 = "Todos": uma página só, do tamanho do total filtrado.
  const totalPaginas = tamanhoPagina ? Math.max(1, Math.ceil(linhas.length / tamanhoPagina)) : 1;
  const paginaAtual = Math.min(pagina, totalPaginas);
  const linhasPagina = tamanhoPagina
    ? linhasOrdenadas.slice((paginaAtual - 1) * tamanhoPagina, paginaAtual * tamanhoPagina)
    : linhasOrdenadas;
  const inicioIntervalo = linhas.length ? (tamanhoPagina ? (paginaAtual - 1) * tamanhoPagina + 1 : 1) : 0;
  const fimIntervalo = tamanhoPagina ? Math.min(paginaAtual * tamanhoPagina, linhas.length) : linhas.length;
  const custoVendaMargemVisivel = colunaVisivel('custo') || colunaVisivel('venda') || colunaVisivel('margem');

  return (
```

por (as colunas entram aqui — não no escopo do módulo — porque `fiscal`/`status` precisam fechar sobre `fiscalDisponivel`):

```js
  if (loading) return <p className="muted">Carregando…</p>;

  const fichaAberta = criando || !!produtoSelecionado;
  const pendencias = fiscalDisponivel ? pendenciasFiscaisProduto(formProd) : [];

  // Código e nome ficam sempre visíveis (sem `escondivel`) — sem nome a linha
  // vira uma sequência de números sem referência para clicar. Fiscal e status
  // não têm `valor()` de propósito: são rótulo de estado, não dado ordenável.
  const COLUNAS_PRODUTOS = [
    {
      id: 'codigo', titulo: 'Código', largura: 58, mono: true, ordenavel: true,
      valor: r => r.codigo || '', render: r => r.codigo,
    },
    {
      id: 'nome', titulo: 'Produto', principal: true, minimo: 200, ordenavel: true,
      valor: r => r.nome || '', render: r => r.nome, textoPuro: r => r.nome,
    },
    {
      id: 'categoria', titulo: 'Categoria', largura: 86, escondivel: true, ordenavel: true,
      valor: r => r.categoria || '',
      render: r => (r.categoria ? <span className="tag categoria">{r.categoria}</span> : null),
      textoPuro: r => r.categoria || '',
    },
    {
      id: 'ncm', titulo: 'NCM', largura: 84, mono: true, escondivel: true, ordenavel: true,
      valor: r => r.ncm || '',
      render: r => r.ncm || null, textoPuro: r => (r.ncm ? 'NCM ' + r.ncm : 'sem NCM'),
    },
    {
      id: 'custo', titulo: 'Custo', largura: 62, mono: true, alinhamento: 'right', escondivel: true, ordenavel: true,
      valor: r => r.custoEfetivo, render: r => fmtMoney(r.custoEfetivo), textoPuro: () => 'Custo',
    },
    {
      id: 'venda', titulo: 'Venda', largura: 62, mono: true, alinhamento: 'right', escondivel: true, ordenavel: true,
      valor: r => Number(r.preco_venda) || 0, render: r => fmtMoney(r.preco_venda), textoPuro: () => 'Preço de venda',
    },
    {
      id: 'margem', titulo: 'Margem', largura: 56, mono: true, alinhamento: 'right', escondivel: true, ordenavel: true,
      valor: r => r.margem,
      render: r => <span className={r.margem < 0 ? 'erro' : ''}>{r.margem.toFixed(0)}%</span>,
      textoPuro: () => 'Margem',
    },
    {
      id: 'fiscal', titulo: 'Situação fiscal', largura: 78, escondivel: true,
      render: r => (!fiscalDisponivel ? null : r.ativo_fiscal
        ? <span className="tag ok">fiscal ok</span>
        : <span className="tag warn">fiscal</span>),
      textoPuro: r => (!fiscalDisponivel ? '' : r.ativo_fiscal ? 'fiscal ok' : 'fiscal'),
    },
    {
      id: 'status', titulo: 'Status', largura: 70, escondivel: true,
      render: r => (r.ativo === false ? <span className="tag neutro">inativo</span> : null),
      textoPuro: r => (r.ativo === false ? 'inativo' : 'ativo'),
    },
  ];

  return (
```

- [ ] **Step 8: Simplificar a barra de ferramentas (tira contagem e botão "Colunas" manuais)**

Troque o bloco (hoje `app/produtos/page.js:552-586`, a `<div>` de contagem/status/colunas logo depois da `filter-bar`):

```jsx
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <span className="muted" style={{ fontSize: 11.5 }}>
            {inicioIntervalo}–{fimIntervalo} de {visiveis.length} produto{visiveis.length === 1 ? '' : 's'}
            {visiveis.length !== produtos.length ? ` (${produtos.length} no total)` : ''}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, fontSize: 12 }}>
              Status
              <select value={statusFiltro} onChange={e => setStatusFiltro(e.target.value)}
                      style={{ width: 'auto', padding: '5px 8px', fontSize: 12 }}>
                <option value="ativos">Ativos</option>
                <option value="inativos">Inativos</option>
                <option value="todos">Todos</option>
              </select>
            </label>
            <div style={{ position: 'relative' }}>
              <button type="button" className="btn secondary small" onClick={() => setMenuColunasAberto(a => !a)}>
                Colunas
              </button>
              {menuColunasAberto && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 29 }} onClick={() => setMenuColunasAberto(false)} />
                  <div className="colunas-menu">
                    {COLUNAS_PRODUTOS.filter(c => c.escondivel).map(c => (
                      <label key={c.id}>
                        <input type="checkbox" checked={colunaVisivel(c.id)} onChange={() => alternarColuna(c.id)} />
                        {c.titulo}
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
```

por (só o filtro de status, que é domínio da tela — a contagem e o botão "Colunas" agora são o `ListaCadastro` da próxima step):

```jsx
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 12 }}>
          Status
          <select value={statusFiltro} onChange={e => setStatusFiltro(e.target.value)}
                  style={{ width: 'auto', padding: '5px 8px', fontSize: 12 }}>
            <option value="ativos">Ativos</option>
            <option value="inativos">Inativos</option>
            <option value="todos">Todos</option>
          </select>
        </label>
```

- [ ] **Step 9: Trocar a lista e a paginação escritas à mão pelo `ListaCadastro`**

Troque tudo entre o comentário `{/* Sem o teto de largura... */}` e o fechamento de `</section>` (hoje `app/produtos/page.js:588-673` — o bloco `{visiveis.length ? (...) : (...)}` da lista **e** o bloco `{visiveis.length > 0 && (<div className="paginacao">...)}`) por:

```jsx
        <ListaCadastro
          chave="produtos"
          colunas={COLUNAS_PRODUTOS} registros={linhas} selecionado={selecionado} onAbrir={abrir}
          rotulo="Produtos"
          vazio={busca ? 'Nenhum produto encontrado para essa busca.' : 'Nenhum produto cadastrado ainda.'} />
      </section>
```

- [ ] **Step 10: Rodar os testes de lib (não tocamos em lógica de domínio, mas é rápido conferir que nada quebrou)**

Run: `node --test tests/*.test.mjs`
Expected: PASS (inclui os testes de `tests/fiscal.test.mjs` e os novos de `tests/listaCadastro.test.mjs`)

- [ ] **Step 11: Verificar manualmente no browser**

Suba o dev server, faça login, abra `/produtos`. Confirme, comparando com o comportamento de antes desta task:
- Lista aparece com código, nome, categoria, NCM, custo, venda, margem, situação fiscal — visual igual ao que já estava (a menos das células vazias, que agora mostram "—" em vez de espaço em branco — ver nota da Task 2).
- "Colunas" esconde/mostra Categoria/NCM/Custo/Venda/Margem/Situação fiscal/Status.
- Arrastar a borda de uma coluna redimensiona.
- Clicar em Código/Produto/Categoria/NCM/Custo/Venda/Margem ordena crescente/decrescente.
- Trocar "Por página" e navegar Anterior/Próxima funciona; "Todos" mostra a lista inteira numa página.
- Trocar o filtro "Status" entre Ativos/Inativos/Todos filtra a lista.
- Clicar num produto ainda abre a ficha (modal) normalmente — nada na ficha em si foi tocado nesta task.
- Recarregar a página mantém largura/visibilidade/página escolhidas (chaves `produtos:colunas:largura` etc. no `localStorage`).

- [ ] **Step 12: Commit**

```bash
git add app/produtos/page.js
git commit -m "refactor(produtos): migra para o ListaCadastro genérico, remove mecânica de coluna duplicada"
```

---

## Task 6: Conferência final

**Files:** nenhum (task de verificação, sem código novo)

- [ ] **Step 1: Rodar toda a suíte de testes**

Run: `node --test tests/*.test.mjs`
Expected: PASS — todos os arquivos, incluindo `tests/listaCadastro.test.mjs`.

- [ ] **Step 2: Revisão visual lado a lado**

No browser, com Produtos e Clientes: confirme que nenhuma das duas telas ficou com o vão gigante no meio que existia antes do teto de largura (`larguraMaxima`), que o menu "Colunas" fecha ao clicar fora, e que reduzir a janela do navegador (ou usar o modo responsivo) faz a lista rolar horizontalmente em vez de quebrar em duas linhas.

- [ ] **Step 3: Commit final (se sobrar algo solto)**

```bash
git status
```

Se houver qualquer mudança não commitada das tasks anteriores, revise e commit antes de encerrar. Não deve haver nada pendente se cada task já commitou o próprio trabalho.
