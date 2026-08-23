# Fase 3 — Ficha de embalagem e etiqueta de produção — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** transformar o peso defumado em produto acabado com lote e validade, imprimir a etiqueta de controle interno de cada unidade, e fechar a porta que hoje permitiria contar o mesmo produto duas vezes no estoque.

**Architecture:** a ficha de embalagem espelha a de defumação — cabeçalho em rascunho, itens gravados a cada passo, finalização que trava tudo. A diferença é o que a finalização provoca: é ela que gera o estoque de produto acabado, através do trigger `trigger_embalagem_para_producao` que já existe no banco (e que esta fase precisa consertar antes de usar). A validade de cada item é calculada na finalização a partir de `produto_regras_validade` e **gravada**, para que mudar a regra do produto depois não altere validade já impressa.

**Tech Stack:** Next.js 14 (App Router, componentes client), React 18, Supabase JS v2, Postgres/Supabase, `node --test` para lógica pura, `psql` em banco local descartável para SQL.

**Design:** [docs/superpowers/specs/2026-08-20-controle-lote-rastreabilidade-design.md](../specs/2026-08-20-controle-lote-rastreabilidade-design.md) — Fase 3 das cinco.
**Ficha de papel que esta tela substitui:** `fichas-impressas/364_Fichas_Impressas_v2.pdf`, página 3.

## Global Constraints

- Português em toda a interface, mensagens de erro, comentários de código e mensagens de commit.
- Todas as consultas e escritas no Supabase filtram `empresa_id` via `useEmpresaAtual()`. Toda linha inserida grava `empresa_id`.
- `npm test` roda `node --test tests/*.test.mjs`. Só lógica pura ali: sem React, sem rede.
- `npm run verify` (= `npm test && npm run build`) antes de cada commit. Se o build falhar com `PageNotFoundError`, apague `.next` e rode de novo.
- **`.env.local` aponta para o Supabase de produção.** Nenhum passo roda migração contra ele nem escreve no banco. Migração se exercita em Postgres local descartável.
- **Nunca rode `npm run dev`** — a conferência na tela é do dono do sistema.
- Migrações em `supabase/atualizacao_NN_*.sql`, transacionais, idempotentes, com rollback comentado no fim, no padrão da **29**.
- **O número desta migração é 30.** A `main` tem até `atualizacao_29_ficha_defumacao.sql`, e as duas estão aplicadas em produção. Confira `ls supabase/` antes de criar o arquivo.
- A tela é preenchida de celular, na área de embalagem: campos grandes, `inputMode="decimal"`, rascunho gravado a cada passo.

## Estado verificado em produção (2026-08-22, via PostgREST)

Aplicado: migrações 28 e 29. A cadeia funciona do recebimento até a defumação.

`embalagens` já tem: `id`, `lote`, `data`, `responsavel_id`, `sobra_kg`, `obs`, `empresa_id`.
`embalagem_itens` já tem: `id`, `embalagem_id`, `produto_id`, `quantidade`, `peso_total_kg`, `empresa_id`.
Existem e serão consumidos: `produto_regras_validade`, `produtos.conservacao_texto`, `ficha_tecnica`, `producoes`.

Falta o que a migração 30 acrescenta.

## A mina que esta fase precisa desarmar antes de tudo

O banco tem o trigger `trigger_embalagem_para_producao`, que dispara ao inserir em `embalagem_itens` e cria a linha correspondente em `producoes`. **Ele nunca rodou**, porque a tela de embalagem nunca existiu — e o corpo dele lê `recebimento_itens.status_recebimento`, **coluna que não existe mais em produção** (migrou para `inspecoes_qualidade` na atualização 09). Verificado em 2026-08-22: a coluna responde `42703`.

Ou seja: sem consertar o trigger, o **primeiro item** que a tela nova salvasse quebraria com erro de coluna inexistente.

A migração 30 reescreve esse trigger, e de quebra corrige **quando** ele dispara — ver a decisão abaixo.

## Decisões desta fase

**O estoque entra na finalização, não a cada item.** Hoje o trigger dispara `after insert on embalagem_itens`, o que criaria estoque de produto acabado a partir de um rascunho — e um rascunho pode ser cancelado. O trigger passa a disparar quando `embalagens.status` vira `finalizada`, gerando as linhas de `producoes` de todos os itens da ficha de uma vez. Cancelar uma ficha finalizada desfaz o estoque.

**Para desfazer, o estoque precisa saber de onde veio.** `producoes` tem `origem = 'embalagem'` mas nenhuma ligação com a ficha. A migração acrescenta `producoes.embalagem_id`, e o cancelamento apaga exatamente as linhas daquela ficha — nada de heurística por data e produto.

**A validade é calculada na finalização e gravada** em `embalagem_itens.validade`, a partir de `embalagens.data` e da regra de conservação do produto (`produto_regras_validade`). Congelar o valor evita que mudar a regra depois altere retroativamente validade já impressa — mesmo raciocínio do `validade_calculada` de `producoes_internas`.

**Produto rastreado é marcação explícita** — decisão do dono do sistema. A migração acrescenta `produtos.rastreado`, que nasce desmarcado, e o cadastro de produto ganha o campo. Deduzir pela ficha técnica deixaria a regra implícita e mutável.

**A Produção Completa recusa lançar produto rastreado** — decisão do dono do sistema. A tela explica que o caminho é a ficha de embalagem. Continua servindo normalmente tudo que não passa pelo defumador. Sem isso, o mesmo produto entra no estoque duas vezes, por dois caminhos, e o erro só aparece quando alguém compara o saldo com a câmara fria.

**A numeração de ficha vira helper compartilhado.** `lib/defumacao.js` já deriva `DEF-AAMMDD-###` do maior sufixo; a embalagem precisa da mesma coisa com prefixo `EMB-`. Em vez de copiar oito linhas, o algoritmo sobe para `lib/format.js` e as duas fases passam a chamá-lo. Copiar seria achado de revisão, e com razão.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
| --- | --- |
| `lib/format.js` (modificar) | ganha `proximoNumeroFicha(prefixo, fichas)`, usado por defumação e embalagem |
| `lib/defumacao.js` (modificar) | `proximaFicha` passa a delegar ao helper compartilhado |
| `lib/embalagem.js` (novo) | status, número da ficha, saldo defumado por lote, validade e validações — lógica pura |
| `tests/embalagem.test.mjs` (novo) | cobre o acima |
| `supabase/atualizacao_30_ficha_embalagem.sql` (novo) | colunas novas, `produtos.rastreado`, trigger reescrito e imutabilidade |
| `tests/migracao-30/` (novo) | fixture, cenários e runner com rollback |
| `lib/etiquetas.js` (modificar) | ganha o modelo `producao-lote` (50×30 mm, duas colunas) |
| `components/EtiquetaPrint.js` (modificar) | ganha o layout da etiqueta de produção |
| `app/producoes/embalagem/page.js` (novo) | lista de fichas e ficha nova |
| `app/producoes/embalagem/[id]/page.js` (novo) | a ficha: cabeçalho, itens, finalizar, cancelar, imprimir |
| `components/ProducaoTabs.js` e `lib/menu.js` (modificar) | aba e item de menu novos |
| `app/produtos/page.js` (modificar) | campo "produto rastreado" no cadastro |
| `app/producoes/completa/page.js` (modificar) | recusa lançar produto rastreado |

---

### Task 1: Numeração compartilhada e `lib/embalagem.js`

**Files:**
- Modify: `lib/format.js`
- Modify: `lib/defumacao.js`
- Create: `lib/embalagem.js`
- Test: `tests/embalagem.test.mjs`
- Test: `tests/defumacao.test.mjs` (só conferir que segue passando)

**Interfaces:**
- Produces em `lib/format.js`: `proximoNumeroFicha(prefixo: string, fichas: {lote}[]): string` — recebe o prefixo já montado (`DEF-260822-`) e devolve o próximo número, derivando do **maior sufixo**, nunca da contagem.
- Produces em `lib/embalagem.js`:
  - `STATUS_EMBALAGEM = ['rascunho', 'finalizada', 'cancelada']`
  - `prefixoFichaEmbalagem(dataStr): string` — `EMB-AAMMDD-`
  - `proximaFichaEmbalagem(dataStr, fichas): string`
  - `saldoDefumado(loteId, itensDefumados, itensEmbalados): number` — quilos defumados ainda disponíveis daquele lote
  - `validadeDoItem(dataEmbalagem: string, regra): string | null` — data (`AAAA-MM-DD`) ou `null` quando não há regra
  - `itemEmbalagemValido({ quantidade, peso_total_kg }): { ok, erro? }`

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/embalagem.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATUS_EMBALAGEM, prefixoFichaEmbalagem, proximaFichaEmbalagem,
  saldoDefumado, validadeDoItem, itemEmbalagemValido,
} from '../lib/embalagem.js';
import { proximoNumeroFicha } from '../lib/format.js';

test('STATUS_EMBALAGEM: os três status da ficha', () => {
  assert.deepEqual(STATUS_EMBALAGEM, ['rascunho', 'finalizada', 'cancelada']);
});

test('proximoNumeroFicha: primeira do dia', () => {
  assert.equal(proximoNumeroFicha('EMB-260822-', []), 'EMB-260822-001');
});

test('proximoNumeroFicha: deriva do maior sufixo, não da contagem', () => {
  const fichas = [{ lote: 'EMB-260822-001' }, { lote: 'EMB-260822-003' }];
  assert.equal(proximoNumeroFicha('EMB-260822-', fichas), 'EMB-260822-004');
});

test('proximoNumeroFicha: ignora prefixo alheio e sufixo não numérico', () => {
  const fichas = [{ lote: 'DEF-260822-009' }, { lote: 'EMB-260822-00X' }, { lote: 'EMB-260822-002' }];
  assert.equal(proximoNumeroFicha('EMB-260822-', fichas), 'EMB-260822-003');
});

test('prefixoFichaEmbalagem: monta a partir da data', () => {
  assert.equal(prefixoFichaEmbalagem('2026-08-22'), 'EMB-260822-');
});

test('proximaFichaEmbalagem: junta prefixo e sufixo', () => {
  assert.equal(proximaFichaEmbalagem('2026-08-22', [{ lote: 'EMB-260822-001' }]), 'EMB-260822-002');
});

const defumados = [
  { recebimento_item_id: 'lote-a', peso_final_kg: 81, defumacoes: { status: 'finalizada' } },
  { recebimento_item_id: 'lote-a', peso_final_kg: 10, defumacoes: { status: 'rascunho' } },
  { recebimento_item_id: 'lote-b', peso_final_kg: 40, defumacoes: { status: 'finalizada' } },
];

test('saldoDefumado: só conta defumação finalizada', () => {
  assert.equal(saldoDefumado('lote-a', defumados, []), 81);
});

test('saldoDefumado: desconta o que já foi embalado daquele lote', () => {
  const embalados = [
    { recebimento_item_id: 'lote-a', peso_total_kg: 30, embalagens: { status: 'finalizada' } },
    { recebimento_item_id: 'lote-a', peso_total_kg: 6, embalagens: { status: 'rascunho' } },
  ];
  assert.equal(saldoDefumado('lote-a', defumados, embalados), 45);
});

test('saldoDefumado: ficha de embalagem cancelada devolve o peso ao lote', () => {
  const embalados = [
    { recebimento_item_id: 'lote-a', peso_total_kg: 30, embalagens: { status: 'cancelada' } },
  ];
  assert.equal(saldoDefumado('lote-a', defumados, embalados), 81);
});

test('saldoDefumado: nunca devolve negativo', () => {
  const embalados = [{ recebimento_item_id: 'lote-b', peso_total_kg: 90, embalagens: { status: 'finalizada' } }];
  assert.equal(saldoDefumado('lote-b', defumados, embalados), 0);
});

test('saldoDefumado: lote sem defumação nenhuma', () => {
  assert.equal(saldoDefumado('lote-z', defumados, []), 0);
});

test('validadeDoItem: dias somam à data da embalagem', () => {
  const regra = { permitido: true, validade_valor: 120, validade_unidade: 'dias' };
  assert.equal(validadeDoItem('2026-08-22', regra), '2026-12-20');
});

test('validadeDoItem: horas arredondam para o dia', () => {
  const regra = { permitido: true, validade_valor: 48, validade_unidade: 'horas' };
  assert.equal(validadeDoItem('2026-08-22', regra), '2026-08-24');
});

test('validadeDoItem: sem regra, sem validade', () => {
  assert.equal(validadeDoItem('2026-08-22', null), null);
  assert.equal(validadeDoItem('2026-08-22', { permitido: false, validade_valor: 30, validade_unidade: 'dias' }), null);
});

test('itemEmbalagemValido: quantidade precisa ser inteira e positiva', () => {
  assert.equal(itemEmbalagemValido({ quantidade: 0, peso_total_kg: 10 }).ok, false);
  assert.equal(itemEmbalagemValido({ quantidade: 2.5, peso_total_kg: 10 }).ok, false);
  assert.equal(itemEmbalagemValido({ quantidade: 50, peso_total_kg: 25 }).ok, true);
});

test('itemEmbalagemValido: peso precisa ser positivo', () => {
  const r = itemEmbalagemValido({ quantidade: 50, peso_total_kg: 0 });
  assert.equal(r.ok, false);
  assert.match(r.erro, /peso/i);
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
node --test tests/embalagem.test.mjs
```

Esperado: FAIL — `Cannot find module '../lib/embalagem.js'`.

- [ ] **Step 3: Extrair o helper de numeração**

Em `lib/format.js`, acrescentar — o corpo é o mesmo que hoje está em `proximaFicha` de `lib/defumacao.js`:

```js
// Próximo número de ficha a partir do MAIOR sufixo já usado, nunca da
// contagem de fichas: contagem repete número assim que alguém apaga uma
// linha, e com unique (empresa_id, lote) isso trava o lançamento em loop.
// Foi bug real, corrigido em proximosLotes e replicado aqui de propósito.
export function proximoNumeroFicha(prefixo, fichas) {
  const maior = (fichas || []).reduce((max, f) => {
    const lote = String(f?.lote || '');
    if (!lote.startsWith(prefixo)) return max;
    const sufixo = lote.slice(prefixo.length);
    return /^\d+$/.test(sufixo) ? Math.max(max, Number(sufixo)) : max;
  }, 0);
  return prefixo + String(maior + 1).padStart(3, '0');
}
```

Em `lib/defumacao.js`, `proximaFicha` passa a delegar, mantendo a assinatura que a Fase 2 já usa:

```js
import { proximoNumeroFicha } from './format.js';

export function proximaFicha(dataStr, fichasExistentes) {
  return proximoNumeroFicha(prefixoFicha(dataStr), fichasExistentes);
}
```

`tests/defumacao.test.mjs` **não muda** e precisa continuar passando — é a prova de que a extração não alterou comportamento.

- [ ] **Step 4: Implementar `lib/embalagem.js`**

```js
// Helpers da ficha de embalagem (Fase 3 do controle de lote).
//
// A ficha de papel que esta tela substitui está em
// fichas-impressas/364_Fichas_Impressas_v2.pdf, página 3. A embalagem é onde o
// peso defumado vira produto acabado com lote e validade.

import { proximoNumeroFicha } from './format.js';

export const STATUS_EMBALAGEM = ['rascunho', 'finalizada', 'cancelada'];

const num = v => (v === null || v === undefined || v === '' ? null : Number(v));

export function prefixoFichaEmbalagem(dataStr) {
  return `EMB-${dataStr.slice(2, 4)}${dataStr.slice(5, 7)}${dataStr.slice(8, 10)}-`;
}

export function proximaFichaEmbalagem(dataStr, fichas) {
  return proximoNumeroFicha(prefixoFichaEmbalagem(dataStr), fichas);
}

// Quilos defumados ainda disponíveis de um lote: o que saiu das fichas de
// defumação FINALIZADAS menos o que já foi embalado em fichas que não estão
// canceladas. Rascunho de defumação não conta como disponível — o peso ainda
// pode mudar; ficha de embalagem cancelada devolve o peso ao lote.
export function saldoDefumado(loteId, itensDefumados, itensEmbalados) {
  const defumado = (itensDefumados || [])
    .filter(i => i.recebimento_item_id === loteId && i.defumacoes?.status === 'finalizada')
    .reduce((s, i) => s + (num(i.peso_final_kg) || 0), 0);
  const embalado = (itensEmbalados || [])
    .filter(i => i.recebimento_item_id === loteId
      && i.embalagens?.status && i.embalagens.status !== 'cancelada')
    .reduce((s, i) => s + (num(i.peso_total_kg) || 0), 0);
  return Math.max(0, defumado - embalado);
}

// Validade gravada no item, calculada a partir da data da embalagem e da regra
// de conservação do produto. Fica congelada: mudar a regra depois não altera
// validade já impressa em etiqueta.
export function validadeDoItem(dataEmbalagem, regra) {
  if (!regra || !regra.permitido) return null;
  const valor = num(regra.validade_valor);
  if (!valor || valor <= 0) return null;
  const dias = regra.validade_unidade === 'horas' ? Math.ceil(valor / 24) : valor;
  const d = new Date(`${dataEmbalagem}T12:00:00`);
  d.setDate(d.getDate() + dias);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function itemEmbalagemValido({ quantidade, peso_total_kg } = {}) {
  const qtd = num(quantidade);
  const peso = num(peso_total_kg);
  if (qtd === null || !Number.isInteger(qtd) || qtd <= 0) {
    return { ok: false, erro: 'A quantidade embalada precisa ser um número inteiro de unidades, maior que zero.' };
  }
  if (peso === null || Number.isNaN(peso) || peso <= 0) {
    return { ok: false, erro: 'Informe o peso final dos produtos embalados.' };
  }
  return { ok: true };
}
```

- [ ] **Step 5: Rodar e ver passar**

```bash
npm test
```

Esperado: os testes novos passam e `tests/defumacao.test.mjs` continua passando sem alteração.

- [ ] **Step 6: Commit**

```bash
git add lib/format.js lib/defumacao.js lib/embalagem.js tests/embalagem.test.mjs
git commit -m "feat(embalagem): numeração compartilhada, saldo defumado e validade do item"
```

---

### Task 2: Migração 30 — colunas, trigger reescrito e imutabilidade

**Files:**
- Create: `supabase/atualizacao_30_ficha_embalagem.sql`
- Create: `tests/migracao-30/fixture.sql`
- Create: `tests/migracao-30/cenarios.sql`
- Create: `tests/migracao-30/verificar.sh`

**Interfaces:**
- Produces: `embalagens.status`, `cancelada_motivo`, `cancelada_em`, `cancelada_por_id`, `updated_at`, `unique (empresa_id, lote)`; `embalagem_itens.recebimento_item_id`, `embalagem_itens.validade`; `produtos.rastreado`; `producoes.embalagem_id`; `trigger_embalagem_para_producao` reescrito para disparar na finalização e ler `inspecoes_qualidade`; RPC `registrar_impressao` aceitando `source_type = 'embalagem_item'`.

Leia antes de escrever: `supabase/atualizacao_29_ficha_defumacao.sql` (o padrão de imutabilidade que esta migração repete), `supabase/atualizacao_10_recebimento_itens.sql:76-115` (o corpo atual do trigger, que lê a coluna morta) e `supabase/atualizacao_28_lote_recebimento.sql` (a RPC de impressão que ganha mais um ramo).

- [ ] **Step 1: Fixture**

Criar `tests/migracao-30/fixture.sql`, no padrão do fixture da 29 e espelhando a forma real de produção. Precisa conter, no mínimo: `empresas`, `funcionarios`, `materias_primas`, `produtos`, `recebimentos`, `recebimento_itens`, `inspecoes_qualidade`, `defumacoes`, `defumacao_itens`, `embalagens`, `embalagem_itens`, `ficha_tecnica`, `producoes`, `etiqueta_impressoes`, `audit_logs`, e os dublês de `empresas_permitidas`, `tem_permissao`, `fn_nome_usuario`, `fn_registrar_auditoria` e `auth.uid()`.

Inclua **a versão antiga do trigger**, lendo `recebimento_itens.status_recebimento` numa tabela que **não** tem essa coluna — é o que prova que a migração conserta a mina em vez de contorná-la. E inclua uma ficha de embalagem legada, sem `status`, para provar que ela sobrevive.

- [ ] **Step 2: Cenários**

Criar `tests/migracao-30/cenarios.sql`. Ancore cada asserção em `check_violation` (ou no sqlstate específico), nunca em `when others` casando texto — na 29 esse padrão produziu quatro falsos verdes. Cubra:

1. Ficha de embalagem legada sobrevive e ganha `status = 'rascunho'`.
2. **A mina desarmada:** inserir item numa ficha em rascunho funciona — com a versão antiga do trigger isso falharia com `42703` (coluna `status_recebimento`).
3. Item em rascunho **não** gera linha em `producoes`.
4. Finalizar a ficha gera as linhas em `producoes`, uma por produto, com `embalagem_id` preenchido e `origem = 'embalagem'`.
5. Cancelar a ficha finalizada, com motivo, **apaga** as linhas de `producoes` daquela ficha — e não toca em linhas de outras fichas.
6. Ficha fora de `rascunho` recusa alteração de cabeçalho, insert, update e delete de item; de `finalizada` só se sai para `cancelada`.
7. `delete` de ficha finalizada é recusado; de ficha em rascunho passa, levando os itens em cascata.
8. Item com `empresa_id` divergente da ficha pai é recusado; idem `recebimento_item_id` de outra empresa.
9. Número de ficha repetido na mesma empresa é recusado; em outra empresa, passa.
10. `quantidade` não inteira ou não positiva é recusada; `peso_total_kg` não positivo idem.
11. A RPC `registrar_impressao` aceita `embalagem_item`, exige o módulo `producoes`, e recusa reimpressão sem motivo.
12. **Positivo:** ficha em rascunho continua editável — update de cabeçalho e delete de item passam. Sem isso, inverter a guarda deixaria todos os cenários verdes e a tela sem gravar.

- [ ] **Step 3: Runner, rodando e falhando**

Criar `tests/migracao-30/verificar.sh` copiando o da 29: banco descartável próprio, **migração aplicada duas vezes** antes dos cenários (idempotência de verdade), rollback extraído por `sed` e executado, e asserções pós-rollback conferindo que as colunas, os triggers e as funções sumiram.

- [ ] **Step 4: Escrever a migração**

Criar `supabase/atualizacao_30_ficha_embalagem.sql`. Estrutura obrigatória:

**Cabeçalho** explicando: o que a fase entrega; que o trigger existente lê uma coluna que não existe mais e por isso nunca poderia ter rodado; que o estoque passa a entrar na finalização; e as pré-checagens a rodar antes:

```sql
-- select empresa_id, lote, count(*) from embalagens group by 1,2 having count(*) > 1;
-- select id, quantidade, peso_total_kg from embalagem_itens
--  where quantidade <= 0 or quantidade <> floor(quantidade) or peso_total_kg <= 0;
```

**Colunas:**

```sql
alter table public.embalagens
  add column if not exists status text not null default 'rascunho',
  add column if not exists cancelada_motivo text,
  add column if not exists cancelada_em timestamptz,
  add column if not exists cancelada_por_id uuid references public.funcionarios(id),
  add column if not exists updated_at timestamptz not null default now();

alter table public.embalagem_itens
  add column if not exists recebimento_item_id uuid references public.recebimento_itens(id),
  add column if not exists validade date;

alter table public.produtos
  add column if not exists rastreado boolean not null default false;

alter table public.producoes
  add column if not exists embalagem_id uuid references public.embalagens(id);
```

`produtos.rastreado` ganha `comment on column` dizendo que produto marcado só entra no estoque pela ficha de embalagem, e que a Produção Completa o recusa.

**Constraints:** status válido; cancelamento exige motivo; `unique (empresa_id, lote)` em `embalagens`; `quantidade` inteira e positiva e `peso_total_kg` positivo em `embalagem_itens`.

**Imutabilidade:** repita o desenho da 29, incluindo tudo que a revisão dela cobrou — `security definer set search_path = public` nas funções (as tabelas estão sob RLS por empresa, e como *invoker* a policy esconderia a ficha pai e o trigger liberaria a escrita); `is distinct from` na leitura do status; trava de `delete` da ficha fora de `rascunho`; `finalizada` só sai para `cancelada`; `lote`, `obs`, `empresa_id` e os campos de cancelamento na lista congelada; carimbo de `cancelada_em` no trigger, dentro e fora de update.

**O trigger reescrito**, que é o centro desta migração:

```sql
-- Reescrito. A versão anterior disparava `after insert on embalagem_itens` e
-- lia `recebimento_itens.status_recebimento`, coluna que deixou de existir na
-- atualização 09 (o status migrou para `inspecoes_qualidade`). Como a tela de
-- embalagem nunca existiu, o trigger nunca chegou a rodar e o erro ficou
-- adormecido — o primeiro item salvo pela tela nova quebraria.
--
-- Agora dispara na FINALIZAÇÃO da ficha, não a cada item: rascunho pode ser
-- cancelado, e estoque de produto acabado não pode nascer de rascunho.
create or replace function public.fn_embalagem_gerar_producao() ...
```

Regras do corpo: ao passar para `finalizada`, para cada item da ficha, calcular o custo médio da matéria-prima **lendo `inspecoes_qualidade`** (aprovado ou aprovado com ressalva, usando o mesmo critério de `lib/qualidade.js`) e inserir em `producoes` com `embalagem_id`, `origem = 'embalagem'` e o `lote` da ficha. Ao passar para `cancelada`, apagar as linhas de `producoes` daquela `embalagem_id`.

Derrube o trigger antigo por nome (`drop trigger if exists ... on embalagem_itens`) e deixe a função antiga inerte ou removida — diga no comentário qual escolheu e por quê.

**A RPC** `registrar_impressao` ganha o ramo `embalagem_item`, exigindo o módulo `producoes` e validando empresa, no mesmo formato do ramo `recebimento_item` que a 28 criou.

**Rollback comentado** no fim, desfazendo colunas, constraints, triggers e funções, e dizendo em comentário que a versão anterior do trigger volta reaplicando a atualização 10.

- [ ] **Step 5: Rodar os cenários e ver passar**

```bash
tests/migracao-30/verificar.sh
```

- [ ] **Step 6: Commit**

```bash
git add supabase/atualizacao_30_ficha_embalagem.sql tests/migracao-30
git commit -m "feat(embalagem): migração 30 com estoque na finalização e trigger consertado"
```

---

### Task 3: Modelo de etiqueta de produção

**Files:**
- Modify: `lib/etiquetas.js`
- Modify: `components/EtiquetaPrint.js`
- Modify: `tests/etiquetas.test.mjs`

**Interfaces:**
- Produces: modelo `producao-lote` em `MODELOS` (50×30 mm, 2 colunas, mesmo rolo de 108 mm dos outros, `qr_mm` como os demais) e o layout correspondente em `EtiquetaPrint`, dirigido por `modelo: 'producao-lote'`.

O conteúdo, conforme o design — uma etiqueta por unidade embalada:

```
COSTELA DEFUMADA 500g     ▓▓▓
LOTE LT-260820-001        ▓QR▓
Fab. 20/08/2026           ▓▓▓
VAL 18/12/2026
```

- [ ] **Step 1: Acrescentar o modelo com teste**

Em `tests/etiquetas.test.mjs`, o teste que hoje afirma "só os dois modelos desta fase" passa a esperar três. Acrescente também um teste de `medidasImpressao('producao-lote')` travando a geometria, como os outros.

- [ ] **Step 2: Layout no componente**

Em `components/EtiquetaPrint.js`, acrescentar o ramo do modelo novo. Reaproveite o que a etiqueta de recebimento já resolveu: `min-height: 0` nos textos, `flex-shrink: 0` no rodapé, `overflow: hidden` — sem isso, produto de nome longo empurra a validade para fora e ela some da etiqueta impressa.

Campos esperados em `dados`: `{ produto, lote, fabricacao, validade, qrSvg, copias }`. O QR chega pronto, como nas outras.

**Não toque nos modelos `validade-cozinha` e `recebimento`** — os dois imprimem em produção hoje.

- [ ] **Step 3: Verificar e commitar**

```bash
npm run verify
git add lib/etiquetas.js components/EtiquetaPrint.js tests/etiquetas.test.mjs
git commit -m "feat(etiquetas): modelo de produção com lote, fabricação e validade"
```

---

### Task 4: Aba, lista de fichas e cadastro do produto rastreado

**Files:**
- Modify: `components/ProducaoTabs.js`, `lib/menu.js`
- Create: `app/producoes/embalagem/page.js`
- Modify: `app/produtos/page.js`

**Interfaces:**
- Consumes: `proximaFichaEmbalagem`, `STATUS_EMBALAGEM` (Task 1); colunas da Task 2.
- Produces: a rota `/producoes/embalagem` com lista e criação em rascunho; o campo `rastreado` no cadastro de produto.

- [ ] **Step 1: Aba e menu**

Aba **Embalagem** em `ProducaoTabs`, depois de "Defumação", apontando para `/producoes/embalagem`. Item correspondente em `lib/menu.js` — a Fase 2 esqueceu isso e a tela ficou alcançável só pela faixa de abas até a revisão pegar.

- [ ] **Step 2: Lista de fichas**

`app/producoes/embalagem/page.js`, espelhando `app/producoes/defumacao/page.js`, que já resolveu os problemas desta tela: consulta filtrada por empresa com erro tratado (falha de carga não pode virar lista vazia), número da ficha buscado **pelo prefixo** (`.like('lote', 'EMB-260822-%')`), não pela data — a data é editável e ancorar nela trava a numeração —, e retry tratando `23505` com mensagem em português.

Colunas: número, data, responsável, produtos embalados, unidades, peso total, status.

- [ ] **Step 3: Campo no cadastro de produto**

Em `app/produtos/page.js`, acrescentar a marcação **Produto rastreado (entra no estoque pela ficha de embalagem)**, gravando `produtos.rastreado`. Deixe visível na lista de produtos também, para o operador saber quais estão marcados sem abrir cada um.

- [ ] **Step 4: Verificar e commitar**

```bash
npm run verify
git add components/ProducaoTabs.js lib/menu.js app/producoes/embalagem/page.js app/produtos/page.js
git commit -m "feat(embalagem): aba, lista de fichas e marcação de produto rastreado"
```

---

### Task 5: A ficha de embalagem

**Files:**
- Create: `app/producoes/embalagem/[id]/page.js`

**Interfaces:**
- Consumes: tudo das tasks 1, 2 e 4.
- Produces: a tela de preenchimento. A Task 6 acrescenta finalizar, cancelar, imprimir e a etiqueta.

Campos do cabeçalho, exatamente os da ficha de papel (página 3):

| Campo | Coluna |
| --- | --- |
| Data da embalagem | `data` |
| Responsável pela manipulação | `responsavel_id` |
| Sobra de material (kg) | `sobra_kg` |
| Observações | `obs` |

- [ ] **Step 1: Cabeçalho**

Espelhe `app/producoes/defumacao/[id]/page.js`: carga filtrando `empresa_id` (ficha de outra empresa devolve "não encontrada"), erro de carga distinto de "não encontrada", salvamento incremental no `onBlur`, e leitura fora de `rascunho`.

- [ ] **Step 2: Itens**

Cada item da ficha é: **lote → produto → quantidade embalada (un) → peso final (kg)**.

1. **Lote** — lista dos lotes com saldo defumado, via `saldoDefumado(loteId, itensDefumados, itensEmbalados)`. Mostre `LT-260822-001 · Costela Bovina · 81 kg defumados disponíveis`. Lote sem saldo aparece **desabilitado com o motivo visível**, não some.
2. **Produto** — o que vai ser embalado a partir daquele lote. Um lote vira vários produtos (costela defumada, desfiada, costelinha), então o produto é escolha livre entre os produtos da empresa.
3. Quantidade e peso, validados por `itemEmbalagemValido` antes de gravar.
4. O peso não pode passar do saldo defumado do lote — mesma regra da Fase 2, com mensagem dizendo quanto resta.
5. A **validade prevista** aparece na tela enquanto o operador digita, calculada por `validadeDoItem` com a regra do produto. É só previsão: o valor gravado é congelado na finalização (Task 6).

Ao carregar os itens já defumados e já embalados, use o padrão que a Fase 2 acabou de consolidar: buscar os lotes primeiro e os itens **pelos ids dos lotes**, em blocos de 100, com `order` e `limit` explícitos e aviso quando algum bloco vier no teto. Copiar `carregarItensDeDefumacaoDosLotes` de `app/producoes/defumacao/[id]/page.js` é o caminho — se ficarem iguais, extraia para `lib/`.

- [ ] **Step 3: Verificar e commitar**

```bash
npm run verify
git add app/producoes/embalagem/[id]/page.js
git commit -m "feat(embalagem): ficha com lote de origem, saldo defumado e validade prevista"
```

---

### Task 6: Finalizar, cancelar, imprimir e bloquear a Produção Completa

**Files:**
- Modify: `app/producoes/embalagem/[id]/page.js`
- Modify: `app/producoes/completa/page.js`

**Interfaces:**
- Consumes: tudo o que veio antes. Última task da fase.

- [ ] **Step 1: Finalizar**

Botão **Finalizar ficha**, só em `rascunho`, com resumo (quantos produtos, unidades, peso total). Antes de gravar o status, **calcule e grave a validade de cada item** com `validadeDoItem`, a partir de `embalagens.data` e da regra de conservação do produto. Item sem regra fica com validade nula, e o resumo avisa quais ficaram sem — validade em branco na etiqueta é problema de rótulo.

Ao gravar `status = 'finalizada'`, o banco gera o estoque. Trate o erro do trigger mostrando a mensagem e recarregando.

- [ ] **Step 2: Cancelar com motivo**

Igual à Fase 2, inclusive `cancelada_por_id` sendo **quem cancela** (via `useAuth()` + `funcionarios.user_id`), não o responsável pela manipulação. O aviso de confirmação precisa dizer que cancelar **remove o estoque gerado** por aquela ficha.

- [ ] **Step 3: Etiquetas de produção**

Botão **Imprimir etiquetas** por item, com a quantidade sugerida igual à quantidade embalada (50 unidades embaladas = 50 etiquetas). Reaproveite `ModalEtiquetas` com `sourceType: 'embalagem_item'` e `modelo: 'producao-lote'`, resolvendo o QR **antes** de abrir o modal, e derivando o tipo (original/reimpressão) do histórico de `etiqueta_impressoes` — os dois padrões vieram de defeitos reais da Fase 1.

Só oferecer impressão com a ficha **finalizada**: etiqueta de rascunho é etiqueta de dado que ainda pode mudar.

- [ ] **Step 4: Imprimir a ficha**

**Imprimir ficha** em A4 com `FichaPrint`, trazendo cabeçalho e a tabela de itens (lote, produto, quantidade, peso, validade). Monte os campos a partir do estado **ao vivo**, não do que foi carregado — na Fase 2 a ficha saía impressa em branco por ler o estado velho.

- [ ] **Step 5: Bloquear produto rastreado na Produção Completa**

Em `app/producoes/completa/page.js`: produto com `rastreado = true` não pode ser lançado. Recuse com mensagem em português explicando que o caminho é a ficha de embalagem, e deixe o produto visível na lista, desabilitado com o motivo — sumir sem explicação gera chamado.

- [ ] **Step 6: Verificar e commitar**

```bash
npm run verify
git add app/producoes/embalagem/[id]/page.js app/producoes/completa/page.js
git commit -m "feat(embalagem): finalizar gera estoque, cancelar desfaz, etiqueta de produção"
```

---

## Conferência manual (dono do sistema)

Depois de aplicar a migração 30:

1. Marcar um produto como **rastreado** no cadastro.
2. Tentar lançá-lo na **Produção Completa**: recusa, explicando o caminho.
3. Criar ficha de embalagem, escolher um lote com saldo defumado, lançar 50 unidades e o peso.
4. Conferir a validade prevista na tela contra a regra de conservação do produto.
5. **Finalizar** e conferir que o estoque do produto subiu (`/estoque` ou a lista de produtos).
6. Imprimir as etiquetas de produção: 50 etiquetas, com produto, lote, fabricação e validade; conferir o QR e o alinhamento no rolo.
7. **Cancelar** a ficha com motivo e conferir que o estoque voltou ao que era.
8. Conferir que a ficha finalizada não aceita mais edição.

## Ordem de deploy

**Migração 30 primeiro, depois o código** — a tela grava `status`, `recebimento_item_id` e `validade`, e o cadastro de produto grava `rastreado`.

## Depois desta fase

Fase 4 — expedição: romaneio com os lotes, caixas de no máximo 2 produtos e 12 unidades, sugestão FEFO a partir do saldo de produto acabado por lote, etiqueta de despacho 101×50 mm e o campo da NF-e. É a fase que fecha o pedido de venda, e a que você pediu no começo. A migração será a **31**.
