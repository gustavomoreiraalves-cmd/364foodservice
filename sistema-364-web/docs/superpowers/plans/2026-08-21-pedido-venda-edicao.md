# Edição de pedido de venda — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** permitir editar um pedido de venda em `Pendente` numa rota própria, e substituir a exclusão por cancelamento com motivo.

**Architecture:** o formulário de pedido sai de `app/pedidos/page.js` para `components/PedidoForm.js` e passa a servir tanto o cadastro quanto a nova rota `app/pedidos/[id]/page.js`. A lógica que dá para testar sem navegador (permissão de edição, total, diff de itens) vive em `lib/pedidos.js`. As regras de imutabilidade são impostas por trigger e check constraint na migração `atualizacao_24_pedidos_edicao.sql`, não apenas pela tela.

**Tech Stack:** Next.js 14 (App Router, componentes client), React 18, Supabase JS v2, Postgres/Supabase, testes com `node --test` (nativo, sem framework) e testes de SQL com `psql` num banco local descartável.

**Spec:** [docs/superpowers/specs/2026-08-21-pedido-venda-edicao-design.md](../specs/2026-08-21-pedido-venda-edicao-design.md)

## Global Constraints

- Português em toda a interface, mensagens de erro e comentários de código. O projeto inteiro é em português.
- Todas as consultas ao Supabase filtram `empresa_id` a partir de `useEmpresaAtual()` (`lib/empresa.js`). Toda linha inserida grava `empresa_id`.
- `npm test` roda `node --test tests/*.test.mjs`. Só entra em `tests/*.test.mjs` lógica pura, sem React e sem rede.
- `npm run verify` roda `npm test && npm run build` — é o portão antes de cada commit que toca em código.
- **`.env.local` aponta para o Supabase de produção.** Nenhum passo deste plano roda migração contra ele. As migrações são exercitadas num Postgres local descartável; aplicar em produção é decisão do dono do sistema, fora do plano.
- **`npm run dev` e `npm run build` colidem no diretório `.next`.** Nunca rode os dois ao mesmo tempo; pare o dev server antes de `npm run verify`.
- Migrações vão em `supabase/atualizacao_NN_*.sql`, com o bloco de rollback comentado no fim do arquivo, no padrão de `atualizacao_20_rls_escopo_empresa.sql`.
- O número da próxima migração é **24**: `main` já tem 21 (`dashboard_grupo`), 22 (`nfe_documentos`) e 23 (`fornecedor_cnpj_normalizado`). Existem também dois arquivos `atualizacao_20_` no repositório (`apuracao_ajustes_fechamento` e `rls_escopo_empresa`); a colisão é anterior a este trabalho e não é corrigida aqui.
- Status de pedido são exatamente: `Pendente`, `Faturado`, `Enviado`, `Cancelado`.

---

### Task 1: `lib/pedidos.js` — lógica pura e seus testes

**Files:**
- Create: `lib/pedidos.js`
- Test: `tests/pedidos.test.mjs`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `STATUS_PEDIDO: string[]` — `['Pendente', 'Faturado', 'Enviado', 'Cancelado']`
  - `podeEditar(status: string): boolean`
  - `totalPedido(itens: {quantidade, preco_unitario}[]): number`
  - `precoDoItem(precoDigitado: string|number|null, produto: { preco_venda?: number|string }): number`
  - `diffItens(original: Item[], atual: Item[]): { inserir: Item[], atualizar: Item[], remover: string[] }`, onde `Item` é `{ id?: string, produto_id: string, quantidade: number|string, preco_unitario: number|string }`

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/pedidos.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATUS_PEDIDO, podeEditar, totalPedido, precoDoItem, diffItens } from '../lib/pedidos.js';

test('STATUS_PEDIDO: os quatro status na ordem do fluxo', () => {
  assert.deepEqual(STATUS_PEDIDO, ['Pendente', 'Faturado', 'Enviado', 'Cancelado']);
});

test('podeEditar: só Pendente edita', () => {
  assert.equal(podeEditar('Pendente'), true);
  assert.equal(podeEditar('Faturado'), false);
  assert.equal(podeEditar('Enviado'), false);
  assert.equal(podeEditar('Cancelado'), false);
});

test('podeEditar: status desconhecido do banco não libera edição', () => {
  assert.equal(podeEditar('Em separação'), false);
  assert.equal(podeEditar(null), false);
  assert.equal(podeEditar(undefined), false);
});

test('totalPedido: soma quantidade x preço', () => {
  const itens = [
    { quantidade: 2, preco_unitario: 10.5 },
    { quantidade: 3, preco_unitario: 4 },
  ];
  assert.equal(totalPedido(itens), 33);
});

test('totalPedido: numeric do Postgres chega como string', () => {
  const itens = [{ quantidade: '2.5000', preco_unitario: '10.00' }];
  assert.equal(totalPedido(itens), 25);
});

test('totalPedido: lista vazia, nula e item sem preço valem zero', () => {
  assert.equal(totalPedido([]), 0);
  assert.equal(totalPedido(null), 0);
  assert.equal(totalPedido([{ quantidade: 3, preco_unitario: null }]), 0);
});

test('precoDoItem: preço digitado vence o preço de venda do produto', () => {
  assert.equal(precoDoItem('12.34', { preco_venda: 50 }), 12.34);
});

test('precoDoItem: preço vazio cai no preço de venda do produto', () => {
  assert.equal(precoDoItem('', { preco_venda: '50.00' }), 50);
  assert.equal(precoDoItem(null, { preco_venda: 50 }), 50);
});

test('precoDoItem: produto sem preço de venda vale zero', () => {
  assert.equal(precoDoItem('', {}), 0);
  assert.equal(precoDoItem('', null), 0);
});

test('precoDoItem: zero digitado é preço zero, não cai no produto', () => {
  assert.equal(precoDoItem('0', { preco_venda: 50 }), 0);
});

const original = [
  { id: 'a', produto_id: 'p1', quantidade: 2, preco_unitario: 10 },
  { id: 'b', produto_id: 'p2', quantidade: 5, preco_unitario: 4 },
  { id: 'c', produto_id: 'p3', quantidade: 1, preco_unitario: 99 },
];

test('diffItens: item intocado não gera update', () => {
  const r = diffItens(original, original);
  assert.deepEqual(r, { inserir: [], atualizar: [], remover: [] });
});

test('diffItens: item novo entra em inserir, sem id', () => {
  const atual = [...original, { produto_id: 'p4', quantidade: 7, preco_unitario: 2.5 }];
  const r = diffItens(original, atual);
  assert.equal(r.inserir.length, 1);
  assert.equal(r.inserir[0].produto_id, 'p4');
  assert.equal(r.inserir[0].id, undefined);
  assert.deepEqual(r.atualizar, []);
  assert.deepEqual(r.remover, []);
});

test('diffItens: item removido entra em remover, só o id', () => {
  const atual = original.filter(i => i.id !== 'b');
  const r = diffItens(original, atual);
  assert.deepEqual(r.remover, ['b']);
  assert.deepEqual(r.inserir, []);
  assert.deepEqual(r.atualizar, []);
});

test('diffItens: quantidade alterada entra em atualizar', () => {
  const atual = original.map(i => (i.id === 'a' ? { ...i, quantidade: 9 } : i));
  const r = diffItens(original, atual);
  assert.equal(r.atualizar.length, 1);
  assert.equal(r.atualizar[0].id, 'a');
  assert.equal(r.atualizar[0].quantidade, 9);
});

test('diffItens: preço alterado entra em atualizar', () => {
  const atual = original.map(i => (i.id === 'c' ? { ...i, preco_unitario: 88 } : i));
  const r = diffItens(original, atual);
  assert.equal(r.atualizar.length, 1);
  assert.equal(r.atualizar[0].id, 'c');
  assert.equal(r.atualizar[0].preco_unitario, 88);
});

test('diffItens: string e número com o mesmo valor não contam como alteração', () => {
  const atual = original.map(i => (i.id === 'a' ? { ...i, quantidade: '2.0000', preco_unitario: '10.00' } : i));
  assert.deepEqual(diffItens(original, atual).atualizar, []);
});

test('diffItens: trocar o produto do item conta como alteração', () => {
  const atual = original.map(i => (i.id === 'b' ? { ...i, produto_id: 'p9' } : i));
  const r = diffItens(original, atual);
  assert.equal(r.atualizar.length, 1);
  assert.equal(r.atualizar[0].produto_id, 'p9');
});

test('diffItens: pedido esvaziado remove todos', () => {
  const r = diffItens(original, []);
  assert.deepEqual(r.remover.sort(), ['a', 'b', 'c']);
});

test('diffItens: pedido novo (original vazio) só insere', () => {
  const r = diffItens([], [{ produto_id: 'p1', quantidade: 1, preco_unitario: 5 }]);
  assert.equal(r.inserir.length, 1);
  assert.deepEqual(r.remover, []);
});
```

- [ ] **Step 2: Rodar o teste para ver falhar**

```bash
node --test tests/pedidos.test.mjs
```

Esperado: FAIL — `Cannot find module '../lib/pedidos.js'`.

- [ ] **Step 3: Implementar o mínimo**

Criar `lib/pedidos.js`:

```js
// Helpers do módulo Pedidos de venda.
// Só lógica pura: as regras de imutabilidade valem de verdade no banco
// (trigger fn_pedido_bloquear_edicao, atualização 24). O que está aqui serve
// para a tela decidir o que mostrar e para montar o diff antes de gravar.

export const STATUS_PEDIDO = ['Pendente', 'Faturado', 'Enviado', 'Cancelado'];

// Pedido só é editável enquanto está Pendente. Status desconhecido vindo do
// banco não libera edição — na dúvida, tela em leitura.
export function podeEditar(status) {
  return status === 'Pendente';
}

export function totalPedido(itens) {
  return (itens || []).reduce(
    (s, i) => s + Number(i.quantidade || 0) * Number(i.preco_unitario || 0),
    0,
  );
}

// Preço vazio na tela cai no preço de venda do produto; zero digitado é zero
// de propósito (bonificação, brinde), por isso o teste é contra string vazia
// e null, e não um `||` sobre o número.
export function precoDoItem(precoDigitado, produto) {
  const digitado = precoDigitado === '' || precoDigitado === null || precoDigitado === undefined
    ? null
    : Number(precoDigitado);
  if (digitado !== null && !Number.isNaN(digitado)) return digitado;
  return Number(produto?.preco_venda || 0);
}

function mesmoItem(a, b) {
  return a.produto_id === b.produto_id
    && Number(a.quantidade) === Number(b.quantidade)
    && Number(a.preco_unitario) === Number(b.preco_unitario);
}

// Compara a lista carregada do banco com a lista da tela e devolve só o que
// mudou. Item intocado não gera update: menos escrita, menos linha no histórico.
export function diffItens(original, atual) {
  const antes = original || [];
  const depois = atual || [];
  const porId = new Map(antes.map(i => [i.id, i]));

  const inserir = depois.filter(i => !i.id);
  const atualizar = depois.filter(i => i.id && porId.has(i.id) && !mesmoItem(porId.get(i.id), i));
  const idsDepois = new Set(depois.filter(i => i.id).map(i => i.id));
  const remover = antes.filter(i => !idsDepois.has(i.id)).map(i => i.id);

  return { inserir, atualizar, remover };
}
```

- [ ] **Step 4: Rodar os testes e ver passar**

```bash
node --test tests/pedidos.test.mjs
```

Esperado: PASS, 18 testes.

- [ ] **Step 5: Rodar a suíte inteira**

```bash
npm test
```

Esperado: PASS, nenhuma regressão nos testes que já existiam.

- [ ] **Step 6: Commit**

```bash
git add lib/pedidos.js tests/pedidos.test.mjs
git commit -m "feat(pedidos): helpers de edição e diff de itens"
```

---

### Task 2: Migração 24 — colunas, checks e travas de imutabilidade

**Files:**
- Create: `supabase/atualizacao_24_pedidos_edicao.sql`
- Create: `tests/migracao-24/fixture.sql`
- Create: `tests/migracao-24/cenarios.sql`
- Create: `tests/migracao-24/verificar.sh`

**Interfaces:**
- Consumes: nada.
- Produces: colunas `pedidos.observacoes`, `pedidos.cancelado_motivo`, `pedidos.cancelado_em`, `pedidos.cancelado_por_id`, `pedidos.updated_at`; constraint `pedidos_cancelamento_motivo`; triggers `trg_pedido_itens_bloquear_edicao` e `trg_pedidos_bloquear_cabecalho`. As tasks 4 e 5 gravam nessas colunas e tratam os erros desses triggers.

- [ ] **Step 1: Escrever o fixture do banco de teste**

Criar `tests/migracao-24/fixture.sql` — esqueleto mínimo do schema de produção, no padrão de `tests/rls/fixture.sql`:

```sql
-- Esqueleto mínimo para exercitar a atualização 24 num Postgres local.
-- Só as tabelas que a migração toca, com as colunas que ela usa.
create table empresas (id uuid primary key, nome text);
create table clientes (id uuid primary key, empresa_id uuid references empresas(id), nome text);
create table funcionarios (id uuid primary key, empresa_id uuid references empresas(id), nome text);
create table produtos (id uuid primary key, empresa_id uuid references empresas(id), nome text);

create table pedidos (
  id uuid primary key default gen_random_uuid(),
  data date not null default current_date,
  cliente_id uuid references clientes(id),
  status text not null default 'Pendente',
  responsavel_id uuid references funcionarios(id),
  empresa_id uuid references empresas(id),
  created_at timestamptz not null default now()
);

create table pedido_itens (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references pedidos(id) on delete cascade,
  produto_id uuid not null references produtos(id),
  quantidade numeric(12,4) not null,
  preco_unitario numeric(12,2) not null,
  empresa_id uuid references empresas(id)
);

insert into empresas (id, nome) values ('11111111-1111-1111-1111-111111111111', 'Food Services');
insert into clientes (id, empresa_id, nome) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Cliente Teste');
insert into funcionarios (id, empresa_id, nome) values ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'Responsável Teste');
insert into produtos (id, empresa_id, nome) values ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'Costela Defumada 500g');
```

- [ ] **Step 2: Escrever os cenários que falham**

Criar `tests/migracao-24/cenarios.sql`. Cada bloco prova uma regra; `raise exception` derruba o script com `ON_ERROR_STOP=1`:

```sql
-- Exercita as regras da atualização 24. Roda depois do fixture e da migração.
\set QUIET on
set client_min_messages = warning;

-- Cenário 1: pedido Pendente aceita item, edição de item e edição do cabeçalho.
do $$
declare v_pedido uuid; v_item uuid;
begin
  insert into pedidos (cliente_id, empresa_id) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111')
    returning id into v_pedido;
  insert into pedido_itens (pedido_id, produto_id, quantidade, preco_unitario, empresa_id)
    values (v_pedido, '44444444-4444-4444-4444-444444444444', 2, 50, '11111111-1111-1111-1111-111111111111')
    returning id into v_item;
  update pedido_itens set quantidade = 3 where id = v_item;
  update pedidos set data = current_date - 1 where id = v_pedido;
  delete from pedido_itens where id = v_item;
  raise notice 'OK 1: Pendente permite escrita';
end $$;

-- Cenário 2: fora de Pendente, item não pode ser inserido, alterado nem removido.
do $$
declare v_pedido uuid; v_item uuid; v_erro text;
begin
  insert into pedidos (cliente_id, empresa_id) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111')
    returning id into v_pedido;
  insert into pedido_itens (pedido_id, produto_id, quantidade, preco_unitario, empresa_id)
    values (v_pedido, '44444444-4444-4444-4444-444444444444', 2, 50, '11111111-1111-1111-1111-111111111111')
    returning id into v_item;
  update pedidos set status = 'Faturado' where id = v_pedido;

  begin
    update pedido_itens set quantidade = 10 where id = v_item;
    raise exception 'FALHA 2a: update de item passou com pedido Faturado';
  exception when check_violation then null; end;

  begin
    delete from pedido_itens where id = v_item;
    raise exception 'FALHA 2b: delete de item passou com pedido Faturado';
  exception when check_violation then null; end;

  begin
    insert into pedido_itens (pedido_id, produto_id, quantidade, preco_unitario, empresa_id)
      values (v_pedido, '44444444-4444-4444-4444-444444444444', 1, 10, '11111111-1111-1111-1111-111111111111');
    raise exception 'FALHA 2c: insert de item passou com pedido Faturado';
  exception when check_violation then null; end;

  raise notice 'OK 2: fora de Pendente o item está travado';
end $$;

-- Cenário 3: fora de Pendente, cliente e data do cabeçalho estão travados,
-- mas a transição de status continua livre.
do $$
declare v_pedido uuid;
begin
  insert into pedidos (cliente_id, empresa_id) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111')
    returning id into v_pedido;
  insert into pedido_itens (pedido_id, produto_id, quantidade, preco_unitario, empresa_id)
    values (v_pedido, '44444444-4444-4444-4444-444444444444', 1, 10, '11111111-1111-1111-1111-111111111111');
  update pedidos set status = 'Faturado' where id = v_pedido;

  begin
    update pedidos set data = current_date - 5 where id = v_pedido;
    raise exception 'FALHA 3a: data mudou com pedido Faturado';
  exception when check_violation then null; end;

  update pedidos set status = 'Enviado' where id = v_pedido;
  raise notice 'OK 3: cabeçalho travado, status livre';
end $$;

-- Cenário 4: cancelar exige motivo, e Cancelado é terminal.
do $$
declare v_pedido uuid;
begin
  insert into pedidos (cliente_id, empresa_id) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111')
    returning id into v_pedido;
  insert into pedido_itens (pedido_id, produto_id, quantidade, preco_unitario, empresa_id)
    values (v_pedido, '44444444-4444-4444-4444-444444444444', 1, 10, '11111111-1111-1111-1111-111111111111');

  begin
    update pedidos set status = 'Cancelado' where id = v_pedido;
    raise exception 'FALHA 4a: cancelou sem motivo';
  exception when check_violation then null; end;

  begin
    update pedidos set status = 'Cancelado', cancelado_motivo = '   ' where id = v_pedido;
    raise exception 'FALHA 4b: cancelou com motivo em branco';
  exception when check_violation then null; end;

  update pedidos set status = 'Cancelado', cancelado_motivo = 'Cliente desistiu', cancelado_em = now(),
    cancelado_por_id = '33333333-3333-3333-3333-333333333333' where id = v_pedido;

  begin
    update pedidos set status = 'Pendente' where id = v_pedido;
    raise exception 'FALHA 4c: pedido cancelado voltou para Pendente';
  exception when check_violation then null; end;

  raise notice 'OK 4: cancelamento exige motivo e é terminal';
end $$;

-- Cenário 5: pedido sem item nenhum não sai de Pendente.
do $$
declare v_pedido uuid;
begin
  insert into pedidos (cliente_id, empresa_id) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111')
    returning id into v_pedido;
  begin
    update pedidos set status = 'Faturado' where id = v_pedido;
    raise exception 'FALHA 5: pedido sem itens foi faturado';
  exception when check_violation then null; end;
  raise notice 'OK 5: pedido vazio não sai de Pendente';
end $$;

-- Cenário 6: quantidade e preço inválidos são recusados.
do $$
declare v_pedido uuid;
begin
  insert into pedidos (cliente_id, empresa_id) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111')
    returning id into v_pedido;
  begin
    insert into pedido_itens (pedido_id, produto_id, quantidade, preco_unitario, empresa_id)
      values (v_pedido, '44444444-4444-4444-4444-444444444444', 0, 10, '11111111-1111-1111-1111-111111111111');
    raise exception 'FALHA 6a: quantidade zero aceita';
  exception when check_violation then null; end;
  begin
    insert into pedido_itens (pedido_id, produto_id, quantidade, preco_unitario, empresa_id)
      values (v_pedido, '44444444-4444-4444-4444-444444444444', 1, -1, '11111111-1111-1111-1111-111111111111');
    raise exception 'FALHA 6b: preço negativo aceito';
  exception when check_violation then null; end;
  raise notice 'OK 6: quantidade e preço validados';
end $$;

-- Cenário 7: apagar o pedido em cascata não é bloqueado pelo trigger do item.
-- Não há botão de excluir na tela, mas manutenção pelo SQL não pode travar.
do $$
declare v_pedido uuid;
begin
  insert into pedidos (cliente_id, empresa_id) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111')
    returning id into v_pedido;
  insert into pedido_itens (pedido_id, produto_id, quantidade, preco_unitario, empresa_id)
    values (v_pedido, '44444444-4444-4444-4444-444444444444', 1, 10, '11111111-1111-1111-1111-111111111111');
  update pedidos set status = 'Faturado' where id = v_pedido;
  delete from pedidos where id = v_pedido;
  raise notice 'OK 7: delete em cascata passa';
end $$;

-- Cenário 8: updated_at é tocado a cada update do cabeçalho.
do $$
declare v_pedido uuid; v_antes timestamptz; v_depois timestamptz;
begin
  insert into pedidos (cliente_id, empresa_id) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111')
    returning id into v_pedido;
  select updated_at into v_antes from pedidos where id = v_pedido;
  perform pg_sleep(0.01);
  update pedidos set observacoes = 'entregar antes das 10h' where id = v_pedido;
  select updated_at into v_depois from pedidos where id = v_pedido;
  if v_depois <= v_antes then
    raise exception 'FALHA 8: updated_at não avançou';
  end if;
  raise notice 'OK 8: updated_at avança';
end $$;
```

- [ ] **Step 3: Escrever o runner e ver os cenários falharem**

Criar `tests/migracao-24/verificar.sh`, no padrão de `tests/rls/verificar.sh`:

```bash
#!/usr/bin/env bash
# Exercita a atualização 24 (edição de pedido de venda) num Postgres local
# descartável. Não toca em produção. Requer psql no PATH e um servidor local.
#
# Uso: tests/migracao-24/verificar.sh
set -euo pipefail

export PGOPTIONS='-c client_min_messages=warning'

AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
BANCO="${BANCO_TESTE_PEDIDOS:-pedidos_test_364}"

command -v psql >/dev/null || { echo "psql não encontrado no PATH"; exit 1; }
pg_isready -q || { echo "nenhum Postgres local aceitando conexões"; exit 1; }

limpar() { dropdb --if-exists "$BANCO" >/dev/null 2>&1 || true; }
trap limpar EXIT

limpar
createdb "$BANCO"

psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/fixture.sql"
# A migração sob teste é o arquivo real que vai para produção.
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$RAIZ/supabase/atualizacao_24_pedidos_edicao.sql"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/cenarios.sql"

# O bloco de rollback vive comentado no fim da migração; extrai e aplica para
# provar que ele é SQL válido e desfaz o que a migração criou.
sed -n '/^-- begin;/,/^-- commit;/p' "$RAIZ/supabase/atualizacao_24_pedidos_edicao.sql" | sed 's/^-- \{0,1\}//' > "$AQUI/.rollback.sql"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/.rollback.sql"
rm -f "$AQUI/.rollback.sql"

sobraram=$(psql -tAq -d "$BANCO" -c "select count(*) from pg_trigger where tgname in ('trg_pedido_itens_bloquear_edicao','trg_pedidos_bloquear_cabecalho');")
[ "$sobraram" = "0" ] || { echo "rollback não removeu os triggers (achou $sobraram)"; exit 1; }
echo "OK: rollback desfaz a migração"
```

Tornar executável e rodar:

```bash
chmod +x tests/migracao-24/verificar.sh && tests/migracao-24/verificar.sh
```

Esperado: FAIL — `psql: error: ... supabase/atualizacao_24_pedidos_edicao.sql: No such file or directory`.

- [ ] **Step 4: Escrever a migração**

Criar `supabase/atualizacao_24_pedidos_edicao.sql`:

```sql
-- Edição de pedido de venda: colunas de cancelamento e travas de imutabilidade.
--
-- Até aqui o pedido lançado só podia ser excluído, e o `delete` levava os itens
-- junto por cascata, sem deixar motivo nem autor. A tela passa a editar pedido
-- em `Pendente` e a cancelar com motivo no lugar de excluir; estas regras valem
-- no banco para que continuem valendo quando alguém escrever por fora da tela.
--
-- `vw_estoque_produto` já ignora pedido `Cancelado` no saldo, então cancelar
-- devolve estoque sem nenhuma mudança de view.
--
-- Idempotente: `add column if not exists`, `drop constraint if exists` e
-- `drop trigger if exists` antes de cada criação. Não altera dados existentes.
-- O rollback está comentado no fim do arquivo.
--
-- Antes de aplicar em produção, confira que nenhuma linha viola os novos checks:
--   select count(*) from pedido_itens where quantidade <= 0 or preco_unitario < 0;
--   select count(*) from pedidos where status = 'Cancelado';
-- A primeira precisa dar 0. Se a segunda for maior que 0, os cancelados antigos
-- não têm motivo: preencha com 'Cancelado antes da atualização 24' antes de
-- criar a constraint.

begin;

-- ---------- COLUNAS ----------

alter table public.pedidos
  add column if not exists observacoes text,
  add column if not exists cancelado_motivo text,
  add column if not exists cancelado_em timestamptz,
  add column if not exists cancelado_por_id uuid references public.funcionarios(id),
  add column if not exists updated_at timestamptz not null default now();

comment on column public.pedidos.cancelado_motivo is
  'Motivo do cancelamento. Obrigatório quando status = Cancelado.';

-- ---------- CHECKS ----------

alter table public.pedidos drop constraint if exists pedidos_cancelamento_motivo;
alter table public.pedidos add constraint pedidos_cancelamento_motivo
  check (status <> 'Cancelado' or (cancelado_motivo is not null and btrim(cancelado_motivo) <> ''));

alter table public.pedido_itens drop constraint if exists pedido_itens_quantidade_positiva;
alter table public.pedido_itens add constraint pedido_itens_quantidade_positiva
  check (quantidade > 0);

alter table public.pedido_itens drop constraint if exists pedido_itens_preco_nao_negativo;
alter table public.pedido_itens add constraint pedido_itens_preco_nao_negativo
  check (preco_unitario >= 0);

-- ---------- ITENS: só mudam com o pedido Pendente ----------

create or replace function public.fn_pedido_bloquear_edicao() returns trigger
language plpgsql as $$
declare
  v_pedido uuid;
  v_status text;
begin
  v_pedido := coalesce(new.pedido_id, old.pedido_id);
  select status into v_status from public.pedidos where id = v_pedido;
  -- Pedido já apagado: é a cascata do `on delete cascade`, deixa passar.
  if not found then
    return coalesce(new, old);
  end if;
  if v_status is distinct from 'Pendente' then
    raise exception 'Pedido % está % — os itens não podem ser alterados. Cancele o pedido com motivo e lance outro.', v_pedido, v_status
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_pedido_itens_bloquear_edicao on public.pedido_itens;
create trigger trg_pedido_itens_bloquear_edicao
  before insert or update or delete on public.pedido_itens
  for each row execute function public.fn_pedido_bloquear_edicao();

-- ---------- CABEÇALHO: cliente e data travados, status livre ----------

create or replace function public.fn_pedido_bloquear_cabecalho() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();

  if old.status = 'Cancelado' and new.status is distinct from 'Cancelado' then
    raise exception 'Pedido cancelado não volta para %.', new.status
      using errcode = 'check_violation';
  end if;

  if old.status is distinct from 'Pendente'
     and (new.cliente_id is distinct from old.cliente_id or new.data is distinct from old.data) then
    raise exception 'Pedido % está % — cliente e data não podem ser alterados.', old.id, old.status
      using errcode = 'check_violation';
  end if;

  if old.status = 'Pendente' and new.status is distinct from 'Pendente'
     and not exists (select 1 from public.pedido_itens where pedido_id = new.id) then
    raise exception 'Pedido sem itens não pode sair de Pendente.'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists trg_pedidos_bloquear_cabecalho on public.pedidos;
create trigger trg_pedidos_bloquear_cabecalho
  before update on public.pedidos
  for each row execute function public.fn_pedido_bloquear_cabecalho();

commit;

-- ---------- ROLLBACK ----------
-- begin;
--
-- drop trigger if exists trg_pedido_itens_bloquear_edicao on public.pedido_itens;
-- drop trigger if exists trg_pedidos_bloquear_cabecalho on public.pedidos;
-- drop function if exists public.fn_pedido_bloquear_edicao();
-- drop function if exists public.fn_pedido_bloquear_cabecalho();
--
-- alter table public.pedido_itens drop constraint if exists pedido_itens_quantidade_positiva;
-- alter table public.pedido_itens drop constraint if exists pedido_itens_preco_nao_negativo;
-- alter table public.pedidos drop constraint if exists pedidos_cancelamento_motivo;
--
-- -- As colunas são novas; derrubá-las devolve o schema anterior e descarta
-- -- apenas motivo, autor e data de cancelamento gravados depois da migração.
-- alter table public.pedidos
--   drop column if exists observacoes,
--   drop column if exists cancelado_motivo,
--   drop column if exists cancelado_em,
--   drop column if exists cancelado_por_id,
--   drop column if exists updated_at;
--
-- commit;
```

- [ ] **Step 5: Rodar os cenários e ver passar**

```bash
tests/migracao-24/verificar.sh
```

Esperado: os oito `OK n:` na saída, seguidos de `OK: rollback desfaz a migração`. Se `pg_isready` falhar, suba um Postgres local antes — o teste nunca aponta para produção.

- [ ] **Step 6: Refletir a migração em `supabase/schema.sql`**

`schema.sql` é a planta do banco. Acrescentar as colunas novas na definição de `create table pedidos` (`observacoes text`, `cancelado_motivo text`, `cancelado_em timestamptz`, `cancelado_por_id uuid references funcionarios(id)`, `updated_at timestamptz not null default now()`), mantendo o comentário de status que já existe na linha do `status`.

- [ ] **Step 7: Commit**

```bash
git add supabase/atualizacao_24_pedidos_edicao.sql supabase/schema.sql tests/migracao-24
git commit -m "feat(pedidos): migração 24 com cancelamento e travas de imutabilidade"
```

---

### Task 3: Extrair `components/PedidoForm.js` sem mudar comportamento

**Files:**
- Create: `components/PedidoForm.js`
- Modify: `app/pedidos/page.js`

**Interfaces:**
- Consumes: `totalPedido` de `lib/pedidos.js` (Task 1).
- Produces: `PedidoForm` — componente client, `export default`, com as props:
  - `cabecalho: { data: string, cliente_id: string, responsavel_id: string, observacoes?: string }`
  - `setCabecalho: (c) => void`
  - `itens: Item[]` e `setItens: (itens) => void` — `Item` é `{ id?, produto_id, quantidade, preco_unitario }`
  - `clientes`, `produtos`, `funcionarios`: arrays vindos do Supabase
  - `saldoProduto: (produtoId: string) => number`
  - `somenteLeitura?: boolean` — padrão `false`

Esta task é refactor puro: a tela `/pedidos` faz exatamente o que já fazia.

- [ ] **Step 1: Criar o componente**

Criar `components/PedidoForm.js`. O conteúdo sai de `app/pedidos/page.js` — o `div.form-grid` do cabeçalho, o `form` de item e a `div.items-list`:

```jsx
'use client';
import { useState } from 'react';
import { fmtMoney } from '../lib/format';
import { precoDoItem, totalPedido } from '../lib/pedidos';

// Cabeçalho e itens do pedido de venda. Usado pelo cadastro em /pedidos e pela
// edição em /pedidos/[id]. Não fala com o Supabase: quem chama é que grava.
export default function PedidoForm({
  cabecalho, setCabecalho, itens, setItens,
  clientes, produtos, funcionarios, saldoProduto,
  somenteLeitura = false,
}) {
  const [novoItem, setNovoItem] = useState({ produto_id: '', quantidade: '', preco_unitario: '' });

  function addItem(e) {
    e.preventDefault();
    const prod = produtos.find(p => p.id === novoItem.produto_id);
    if (!prod) return;
    const preco = precoDoItem(novoItem.preco_unitario, prod);
    setItens([...itens, { produto_id: prod.id, quantidade: Number(novoItem.quantidade), preco_unitario: preco }]);
    setNovoItem({ produto_id: '', quantidade: '', preco_unitario: '' });
  }

  function removerItem(idx) {
    setItens(itens.filter((_, i) => i !== idx));
  }

  const excedeSaldo = it => Number(it.quantidade) > saldoProduto(it.produto_id);

  return (
    <>
      <div className="form-grid">
        <div><label>Data</label>
          <input type="date" disabled={somenteLeitura} value={cabecalho.data}
            onChange={e => setCabecalho({ ...cabecalho, data: e.target.value })} />
        </div>
        <div><label>Cliente</label>
          <select disabled={somenteLeitura} value={cabecalho.cliente_id}
            onChange={e => setCabecalho({ ...cabecalho, cliente_id: e.target.value })}>
            <option value="">Selecione…</option>
            {clientes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </div>
        <div><label>Responsável</label>
          <select disabled={somenteLeitura} value={cabecalho.responsavel_id}
            onChange={e => setCabecalho({ ...cabecalho, responsavel_id: e.target.value })}>
            <option value="">Selecione…</option>
            {funcionarios.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
        </div>
        <div><label>Observações</label>
          <input type="text" disabled={somenteLeitura} value={cabecalho.observacoes || ''}
            placeholder="Ex.: entregar antes das 10h"
            onChange={e => setCabecalho({ ...cabecalho, observacoes: e.target.value })} />
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <label>Itens do pedido</label>
        {!somenteLeitura && (
          <form className="form-grid" onSubmit={addItem}>
            <div><label>Produto</label>
              <select required value={novoItem.produto_id}
                onChange={e => setNovoItem({ ...novoItem, produto_id: e.target.value })}>
                <option value="">Selecione…</option>
                {produtos.map(p => <option key={p.id} value={p.id}>{p.codigo} — {p.nome} (saldo: {saldoProduto(p.id).toFixed(1)})</option>)}
              </select>
            </div>
            <div><label>Quantidade</label>
              <input type="number" step="0.001" min="0.001" required value={novoItem.quantidade}
                onChange={e => setNovoItem({ ...novoItem, quantidade: e.target.value })} />
            </div>
            <div><label>Preço unit. (R$ — vazio usa o preço de venda)</label>
              <input type="number" step="0.01" min="0" value={novoItem.preco_unitario}
                onChange={e => setNovoItem({ ...novoItem, preco_unitario: e.target.value })} />
            </div>
            <div><button className="btn secondary" type="submit">Adicionar item</button></div>
          </form>
        )}

        <div className="items-list">
          {itens.length ? itens.map((it, idx) => {
            const prod = produtos.find(p => p.id === it.produto_id);
            return (
              <div className="item-line" key={it.id || `novo-${idx}`}>
                <span>
                  {prod?.nome || '—'}
                  {excedeSaldo(it) && <span className="tag warn" style={{ marginLeft: 8 }}>acima do saldo</span>}
                </span>
                <span className="num">{Number(it.quantidade)} × {fmtMoney(it.preco_unitario)}</span>
                {!somenteLeitura && <button className="btn danger small" type="button" onClick={() => removerItem(idx)}>×</button>}
              </div>
            );
          }) : <p className="muted" style={{ fontSize: 12 }}>Nenhum item adicionado ainda.</p>}
          {itens.length > 0 && <div className="subtotal">Total: {fmtMoney(totalPedido(itens))}</div>}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Trocar o formulário de `/pedidos` pelo componente**

Em `app/pedidos/page.js`:

1. Acrescentar `import PedidoForm from '../../components/PedidoForm';` e `import { totalPedido } from '../../lib/pedidos';`.
2. Apagar o estado `novoItem` e a função `addItem` — foram para o componente.
3. Trocar todo o miolo do painel "Novo pedido de venda" (do `div.form-grid` até o fim da `div.items-list`) por:

```jsx
<PedidoForm
  cabecalho={cabecalho} setCabecalho={setCabecalho}
  itens={itens} setItens={setItens}
  clientes={clientes} produtos={produtos} funcionarios={funcionarios}
  saldoProduto={saldoProduto}
/>
```

4. Acrescentar `observacoes: ''` ao estado inicial de `cabecalho` e ao reset feito no fim de `finalizar()`, e gravar `observacoes: cabecalho.observacoes || null` no `insert` de `pedidos`.
5. Trocar a definição local `const totalPedido = p => …` pelo uso do helper: `const totalDoPedido = p => totalPedido(p.pedido_itens);` e ajustar as duas chamadas na tabela e na impressão.

- [ ] **Step 3: Verificar**

```bash
npm run verify
```

Esperado: testes PASS e build sem erro. Se o dev server estiver rodando, pare antes — `dev` e `build` disputam `.next`.

- [ ] **Step 4: Conferir na tela**

```bash
npm run dev
```

Abrir `http://localhost:3000/pedidos`, lançar um pedido de teste com dois itens e conferir: total confere, remover item funciona, "Finalizar pedido" grava e a lista recarrega. **A base é a de produção** — use um cliente de teste e cancele o pedido depois, na Task 5.

- [ ] **Step 5: Commit**

```bash
git add components/PedidoForm.js app/pedidos/page.js
git commit -m "refactor(pedidos): extrai PedidoForm compartilhado entre cadastro e edição"
```

---

### Task 4: Rota `/pedidos/[id]` com edição em Pendente

**Files:**
- Create: `app/pedidos/[id]/page.js`
- Modify: `app/pedidos/page.js`

**Interfaces:**
- Consumes: `PedidoForm` (Task 3); `podeEditar`, `totalPedido`, `diffItens` (Task 1); triggers da migração 24 (Task 2).
- Produces: a rota `/pedidos/<uuid>`. A Task 5 acrescenta o cancelamento a esta mesma página.

- [ ] **Step 1: Criar a página**

Criar `app/pedidos/[id]/page.js`:

```jsx
'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';
import { fmtMoney, fmtDate } from '../../../lib/format';
import AppShell from '../../../components/AppShell';
import PedidoForm from '../../../components/PedidoForm';
import FichaPrint, { imprimirFicha } from '../../../components/FichaPrint';
import { useEmpresaAtual } from '../../../lib/empresa';
import { podeEditar, totalPedido, diffItens, STATUS_PEDIDO } from '../../../lib/pedidos';

export default function PedidoPage() {
  const [ficha, setFicha] = useState(null);
  return (
    <>
      <AppShell modulo="pedidos" titulo="Pedido de Venda" desc="Detalhe, edição e cancelamento do pedido">
        <Conteudo setFicha={setFicha} />
      </AppShell>
      <FichaPrint ficha={ficha} />
    </>
  );
}

function Conteudo({ setFicha }) {
  const { id } = useParams();
  const router = useRouter();
  const { empresaAtual } = useEmpresaAtual();

  const [pedido, setPedido] = useState(null);
  const [cabecalho, setCabecalho] = useState({ data: '', cliente_id: '', responsavel_id: '', observacoes: '' });
  const [itensOriginais, setItensOriginais] = useState([]);
  const [itens, setItens] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [funcionarios, setFuncionarios] = useState([]);
  const [estoqueProd, setEstoqueProd] = useState([]);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    setErro('');
    const eid = empresaAtual.id;
    const [r1, r2, r3, r4, r5] = await Promise.all([
      // O filtro por empresa_id é o que impede alcançar pedido de outra marca
      // do grupo adivinhando o uuid da URL.
      supabase.from('pedidos')
        .select('*, clientes(nome, cnpj, telefone), funcionarios(nome), pedido_itens(id, produto_id, quantidade, preco_unitario, produtos(codigo, nome, unidade))')
        .eq('id', id).eq('empresa_id', eid).maybeSingle(),
      supabase.from('clientes').select('id, nome').eq('empresa_id', eid).order('nome'),
      supabase.from('produtos').select('*').eq('empresa_id', eid).order('codigo'),
      supabase.from('funcionarios').select('id, nome').eq('empresa_id', eid).eq('ativo', true).order('nome'),
      supabase.from('vw_estoque_produto').select('*').eq('empresa_id', eid),
    ]);
    setClientes(r2.data || []);
    setProdutos(r3.data || []);
    setFuncionarios(r4.data || []);
    setEstoqueProd(r5.data || []);

    const p = r1.data;
    setPedido(p || null);
    if (p) {
      setCabecalho({
        data: p.data,
        cliente_id: p.cliente_id || '',
        responsavel_id: p.responsavel_id || '',
        observacoes: p.observacoes || '',
      });
      const lista = (p.pedido_itens || []).map(i => ({
        id: i.id, produto_id: i.produto_id,
        quantidade: Number(i.quantidade), preco_unitario: Number(i.preco_unitario),
      }));
      setItensOriginais(lista);
      setItens(lista);
    }
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id, id]);

  function saldoProduto(pid) {
    return Number(estoqueProd.find(e => e.produto_id === pid)?.saldo || 0);
  }

  async function salvar() {
    if (!itens.length) { alert('O pedido precisa de ao menos um item.'); return; }
    if (!cabecalho.cliente_id) { alert('Selecione o cliente.'); return; }
    setSalvando(true);
    setErro('');
    const eid = empresaAtual.id;

    const { error: eCab } = await supabase.from('pedidos').update({
      data: cabecalho.data,
      cliente_id: cabecalho.cliente_id,
      responsavel_id: cabecalho.responsavel_id || null,
      observacoes: cabecalho.observacoes || null,
    }).eq('id', id).eq('empresa_id', eid);
    if (eCab) { setSalvando(false); setErro(eCab.message); carregar(); return; }

    const { inserir, atualizar, remover } = diffItens(itensOriginais, itens);

    if (remover.length) {
      const { error } = await supabase.from('pedido_itens').delete().in('id', remover);
      if (error) { setSalvando(false); setErro(error.message); carregar(); return; }
    }
    for (const it of atualizar) {
      const { error } = await supabase.from('pedido_itens')
        .update({ produto_id: it.produto_id, quantidade: it.quantidade, preco_unitario: it.preco_unitario })
        .eq('id', it.id);
      if (error) { setSalvando(false); setErro(error.message); carregar(); return; }
    }
    if (inserir.length) {
      const { error } = await supabase.from('pedido_itens').insert(
        inserir.map(it => ({
          pedido_id: id, empresa_id: eid, produto_id: it.produto_id,
          quantidade: it.quantidade, preco_unitario: it.preco_unitario,
        })),
      );
      if (error) { setSalvando(false); setErro(error.message); carregar(); return; }
    }

    setSalvando(false);
    await carregar();
  }

  async function mudarStatus(status) {
    const { error } = await supabase.from('pedidos').update({ status }).eq('id', id).eq('empresa_id', empresaAtual.id);
    if (error) setErro(error.message);
    carregar();
  }

  function imprimir() {
    imprimirFicha(setFicha, {
      titulo: 'Pedido de Venda',
      numero: `Pedido ${String(pedido.id).slice(0, 8).toUpperCase()} · ${fmtDate(pedido.data)}`,
      campos: [
        { rot: 'Data', valor: fmtDate(pedido.data) },
        { rot: 'Status', valor: pedido.status },
        { rot: 'Cliente', valor: pedido.clientes?.nome },
        { rot: 'CNPJ/CPF', valor: pedido.clientes?.cnpj },
        { rot: 'Telefone', valor: pedido.clientes?.telefone },
        { rot: 'Responsável', valor: pedido.funcionarios?.nome },
        { rot: 'Observações', valor: pedido.observacoes },
      ],
      itens: {
        headers: ['Código', 'Produto', 'Qtd', 'Preço unit.', 'Subtotal'],
        rows: (pedido.pedido_itens || []).map(i => [
          i.produtos?.codigo || '—',
          i.produtos?.nome || '—',
          `${Number(i.quantidade)} ${i.produtos?.unidade || ''}`,
          fmtMoney(i.preco_unitario),
          fmtMoney(Number(i.quantidade) * Number(i.preco_unitario)),
        ]),
      },
      totais: `Total do pedido: ${fmtMoney(totalPedido(pedido.pedido_itens))}`,
      assinaturas: ['Vendedor', 'Cliente'],
    });
  }

  if (loading) return <p className="muted">Carregando…</p>;
  if (!pedido) {
    return (
      <div className="banner info">
        Pedido não encontrado nesta empresa. <button className="btn secondary small" onClick={() => router.push('/pedidos')}>Voltar para a lista</button>
      </div>
    );
  }

  const editavel = podeEditar(pedido.status);

  return (
    <>
      {erro && <div className="banner bad">Não foi possível salvar: {erro}</div>}

      <div className="panel">
        <div className="row-actions" style={{ justifyContent: 'space-between' }}>
          <h3>Pedido {String(pedido.id).slice(0, 8).toUpperCase()}</h3>
          <div className="row-actions">
            <select style={{ width: 'auto' }} value={pedido.status}
              onChange={e => mudarStatus(e.target.value)}
              disabled={pedido.status === 'Cancelado'}>
              {STATUS_PEDIDO.filter(s => s !== 'Cancelado').map(s => <option key={s}>{s}</option>)}
              {pedido.status === 'Cancelado' && <option>Cancelado</option>}
            </select>
            <button className="btn secondary small" onClick={imprimir}>Imprimir pedido</button>
            <button className="btn secondary small" onClick={() => router.push('/pedidos')}>Voltar</button>
          </div>
        </div>

        {!editavel && (
          <div className="banner info">
            Pedido {pedido.status.toLowerCase()} — somente leitura. Para corrigir, cancele com motivo e lance outro pedido.
          </div>
        )}

        <PedidoForm
          cabecalho={cabecalho} setCabecalho={setCabecalho}
          itens={itens} setItens={setItens}
          clientes={clientes} produtos={produtos} funcionarios={funcionarios}
          saldoProduto={saldoProduto} somenteLeitura={!editavel}
        />

        {editavel && (
          <button className="btn" style={{ marginTop: 12 }} onClick={salvar} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar alterações'}
          </button>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Trocar as ações da lista pelo botão Abrir**

Em `app/pedidos/page.js`, na tabela de "Pedidos lançados": acrescentar `import { useRouter } from 'next/navigation';` e o `const router = useRouter();` dentro de `Conteudo`, e trocar a célula de ações por:

```jsx
<td>
  <div className="row-actions">
    <button className="btn secondary small" onClick={() => router.push(`/pedidos/${p.id}`)}>Abrir</button>
  </div>
</td>
```

A função `imprimir` e o `<FichaPrint>` da lista saem — a impressão passa a viver na página do pedido. Remover também os imports que ficarem sem uso (`FichaPrint`, `imprimirFicha`).

O `select` de status na coluna Status permanece: mudar status pela lista continua funcionando. Trocar a
constante local `const STATUS = ['Pendente', 'Faturado', 'Enviado', 'Cancelado'];` do topo do arquivo pelo
`STATUS_PEDIDO` de `lib/pedidos.js`, para não existirem duas listas de status no projeto — o import passa a
ser `import { totalPedido, STATUS_PEDIDO } from '../../lib/pedidos';` e o `.map` da coluna usa `STATUS_PEDIDO`.

- [ ] **Step 3: Verificar**

```bash
npm run verify
```

Esperado: testes PASS e build sem erro. O build acusa import quebrado se algo ficou para trás na limpeza.

- [ ] **Step 4: Conferir na tela**

```bash
npm run dev
```

Com um pedido de teste em `Pendente`:
1. `/pedidos` → **Abrir** leva a `/pedidos/<uuid>`.
2. Trocar quantidade de um item, remover outro, acrescentar um terceiro, mudar o cliente, salvar. Recarregar a página: os três resultados persistiram.
3. Salvar sem mudar nada: não dá erro.
4. Passar o pedido para `Faturado`: a tela vira leitura, sem "Salvar alterações", com o aviso de somente leitura.
5. Trocar a URL para um uuid inventado: aparece "Pedido não encontrado nesta empresa", não um erro de aplicação.

- [ ] **Step 5: Commit**

```bash
git add app/pedidos/[id]/page.js app/pedidos/page.js
git commit -m "feat(pedidos): rota de detalhe com edição de pedido pendente"
```

---

### Task 5: Cancelamento com motivo no lugar da exclusão

**Files:**
- Modify: `app/pedidos/[id]/page.js`
- Modify: `app/pedidos/page.js`

**Interfaces:**
- Consumes: colunas `cancelado_motivo`, `cancelado_em`, `cancelado_por_id` e a constraint `pedidos_cancelamento_motivo` (Task 2); a página da Task 4.
- Produces: nada consumido por tasks seguintes. Última task do plano.

- [ ] **Step 1: Remover o botão Excluir da lista**

Em `app/pedidos/page.js`, apagar a função `excluir` inteira e qualquer botão que a chame. Nenhum caminho da interface faz `delete` em `pedidos`.

- [ ] **Step 2: Acrescentar o cancelamento à página do pedido**

Em `app/pedidos/[id]/page.js`, acrescentar `import { fmtDateTime } from '../../../lib/producao';` — o
cancelamento tem hora, e `fmtDate` corta a string em dez caracteres. Depois, dentro de `Conteudo`:

```jsx
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState('');

  async function cancelar() {
    if (!motivo.trim()) { alert('Informe o motivo do cancelamento.'); return; }
    setSalvando(true);
    setErro('');
    const { error } = await supabase.from('pedidos').update({
      status: 'Cancelado',
      cancelado_motivo: motivo.trim(),
      cancelado_em: new Date().toISOString(),
      cancelado_por_id: cabecalho.responsavel_id || null,
    }).eq('id', id).eq('empresa_id', empresaAtual.id);
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    setCancelando(false);
    setMotivo('');
    carregar();
  }
```

No JSX, dentro do painel, depois do bloco de `PedidoForm`:

```jsx
        {pedido.status === 'Cancelado' && (
          <div className="banner bad" style={{ marginTop: 12 }}>
            <b>Pedido cancelado</b> em {fmtDateTime(pedido.cancelado_em)} — {pedido.cancelado_motivo}
          </div>
        )}

        {pedido.status !== 'Cancelado' && (
          cancelando ? (
            <div className="panel" style={{ marginTop: 12 }}>
              <label>Motivo do cancelamento</label>
              <input type="text" value={motivo} autoFocus
                placeholder="Ex.: cliente desistiu da compra"
                onChange={e => setMotivo(e.target.value)} />
              <p className="muted" style={{ fontSize: 12 }}>
                O pedido cancelado devolve o saldo dos produtos ao estoque e não volta para Pendente.
              </p>
              <div className="row-actions">
                <button className="btn danger" onClick={cancelar} disabled={salvando}>
                  {salvando ? 'Cancelando…' : 'Confirmar cancelamento'}
                </button>
                <button className="btn secondary" onClick={() => { setCancelando(false); setMotivo(''); }}>Voltar</button>
              </div>
            </div>
          ) : (
            <button className="btn danger" style={{ marginTop: 12 }} onClick={() => setCancelando(true)}>
              Cancelar pedido
            </button>
          )
        )}
```

- [ ] **Step 3: Verificar**

```bash
npm run verify
```

Esperado: testes PASS e build sem erro.

- [ ] **Step 4: Conferir na tela**

```bash
npm run dev
```

1. Em `/pedidos`, não existe mais botão Excluir.
2. Abrir o pedido de teste, clicar **Cancelar pedido**, tentar confirmar com o campo vazio: bloqueia com aviso.
3. Preencher o motivo e confirmar: o pedido fica `Cancelado`, com a tarja vermelha, motivo e data.
4. Em `/estoque` (ou na lista de produtos de um novo pedido), o saldo do produto voltou — `vw_estoque_produto` ignora pedido cancelado.
5. Tentar voltar o pedido cancelado para `Pendente` pelo select: o banco recusa e o erro aparece na tarja.

- [ ] **Step 5: Commit**

```bash
git add app/pedidos/page.js app/pedidos/[id]/page.js
git commit -m "feat(pedidos): cancelamento com motivo no lugar da exclusão"
```

---

## Depois deste plano

A rota `/pedidos/[id]` é onde a Fase 4 do design de rastreabilidade se pluga: um painel **Expedição** com o botão **Gerar romaneio**, apontando para `/expedicao?pedido=…`. Nada deste plano precisa ser refeito para isso.

A cadeia até o romaneio, na ordem acordada, com o pré-requisito que continua aberto:

0. Aplicar a **atualização 17** no Supabase de produção — verificado como não aplicado em 2026-08-20.
1. Migração de rastreabilidade e etiqueta de recebimento.
2. Ficha de defumação.
3. Ficha de embalagem e etiqueta de produção.
4. Expedição: romaneio com os lotes, caixas, FEFO, etiqueta 101×50 e campo da NF-e.
