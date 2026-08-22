# Fase 2 — Ficha de defumação — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** substituir a ficha de defumação de papel por uma tela, ligando cada quilo defumado ao lote de matéria-prima que entrou — o elo que faltava entre o recebimento (Fase 1) e a embalagem (Fase 3).

**Architecture:** as tabelas `defumacoes` e `defumacao_itens` já existem em produção com quase todos os campos da ficha de papel; a migração 29 acrescenta só o `status` e o vínculo com o lote (`recebimento_item_id`). O cálculo de rendimento e a numeração da ficha viram lógica pura em `lib/defumacao.js`. A tela é mobile-first e grava incrementalmente: a ficha nasce em `rascunho` e cada item é gravado ao ser adicionado, para não perder dado se a tela do celular apagar ao lado do defumador.

**Tech Stack:** Next.js 14 (App Router, componentes client), React 18, Supabase JS v2, Postgres/Supabase, `node --test` para lógica pura, `psql` em banco local descartável para SQL.

**Design:** [docs/superpowers/specs/2026-08-20-controle-lote-rastreabilidade-design.md](../specs/2026-08-20-controle-lote-rastreabilidade-design.md) — Fase 2 das cinco.
**Ficha de papel que esta tela substitui:** `fichas-impressas/364_Fichas_Impressas_v2.pdf`, página 2.

## Global Constraints

- Português em toda a interface, mensagens de erro, comentários de código e mensagens de commit.
- Todas as consultas ao Supabase filtram `empresa_id` a partir de `useEmpresaAtual()` (`lib/empresa.js`). Toda linha inserida grava `empresa_id`.
- `npm test` roda `node --test tests/*.test.mjs`. Só entra em `tests/*.test.mjs` lógica pura, sem React e sem rede.
- `npm run verify` roda `npm test && npm run build` — portão antes de cada commit que toca em código. Se o build falhar com `PageNotFoundError`, apague `.next` e rode de novo.
- **`.env.local` aponta para o Supabase de produção.** Nenhum passo deste plano roda migração contra ele nem escreve no banco. As migrações são exercitadas em Postgres local descartável.
- **Nunca rode `npm run dev`** — a conferência na tela é do dono do sistema.
- Migrações vão em `supabase/atualizacao_NN_*.sql`, transacionais, idempotentes, com bloco de rollback comentado no fim, no padrão de `supabase/atualizacao_28_lote_recebimento.sql`.
- **O número desta migração é 29.** A branch base (`feat/lote-fase1`) tem até `atualizacao_28_lote_recebimento.sql`, já aplicada em produção. Confira `ls supabase/` antes de criar o arquivo — a numeração do projeto já colidiu duas vezes.
- Base: branch `feat/lote-fase2`, saindo de `feat/lote-fase1` (a Fase 1 está no PR #6, ainda não mergeada). A Fase 2 só vai para a `main` depois da Fase 1.
- A tela é preenchida **de celular, em pé, ao lado do defumador, possivelmente de luva**: campos grandes, teclado numérico (`inputMode="decimal"`), poucos toques.

## Estado verificado em produção (2026-08-22, via PostgREST)

Aplicado: migração 28 (`recebimento_itens.volumes`, `produtos.conservacao_texto`, `empresas.sim_numero`, `sim_municipio`) e migração 27 (`pedidos.cancelado_motivo`).

`defumacoes` já tem: `id`, `lote`, `data`, `hora_inicio`, `hora_fim`, `temperatura_c`, `responsavel_id`, `obs`, `empresa_id`, `created_at`.
`defumacao_itens` já tem: `id`, `defumacao_id`, `materia_prima_id`, `peso_bruto_kg`, `perda_limpeza_kg`, `sobra_kg`, `peso_final_kg`, `empresa_id`.

Falta só o que a migração 29 acrescenta. Nenhuma tela do sistema escreve nessas tabelas hoje (`grep` por `defumac` em `app/`, `lib/` e `components/` não devolve nada).

## Decisões desta fase

**O saldo do lote sai de `recebimento_itens` menos o que já foi defumado, não de `stock_balances`.** O design mandava ler o saldo do livro-razão `stock_balances`/`stock_movements`, que existe em produção — mas **nenhum código do repositório escreve nele**, então a lista de lotes sairia vazia. O saldo passa a ser `recebimento_itens.quantidade − soma dos pesos brutos já lançados daquele lote`. É auto-contido e não depende de tabela órfã. Unificar com o livro-razão continua como trabalho futuro, registrado no design.

**A aba `Defumação` passa a ser esta ficha.** Hoje o rótulo "Defumação" está em `/producoes/completa`, que é outra coisa: consome matéria-prima pela ficha técnica e gera produto acabado numa etapa só. Essa aba volta ao nome **Produção Completa**, que é o que ela faz, e continua servindo o que não passa pelo defumador.

**`defumacoes.lote` é o número da ficha, não o lote rastreável.** O campo já existe como `text not null`, no cabeçalho, e uma ficha pode conter vários lotes — um por item. Ele passa a ser `DEF-AAMMDD-###`, gerado pelo mesmo mecanismo de `proximosLotes` (maior sufixo + 1). O lote rastreável mora em `defumacao_itens.recebimento_item_id`.

**Rendimento abaixo de 40% avisa, não trava.** Pode ser real, e travar faria o operador ajustar o número para passar — que é pior do que registrar o rendimento ruim.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
| --- | --- |
| `lib/defumacao.js` (novo) | rendimento, classificação do alerta, saldo do lote, número da ficha — lógica pura |
| `tests/defumacao.test.mjs` (novo) | cobre os quatro |
| `supabase/atualizacao_29_ficha_defumacao.sql` (novo) | `status`, `recebimento_item_id`, checks e trava de imutabilidade |
| `tests/migracao-29/` (novo) | fixture, cenários e runner com rollback |
| `components/ProducaoTabs.js` (modificar) | "Defumação" vira "Produção Completa"; entra a aba nova |
| `app/producoes/defumacao/page.js` (novo) | lista de fichas e ficha nova |
| `app/producoes/defumacao/[id]/page.js` (novo) | a ficha em si: cabeçalho, itens, rendimento, finalizar |

---

### Task 1: `lib/defumacao.js` — rendimento, saldo e número da ficha

**Files:**
- Create: `lib/defumacao.js`
- Test: `tests/defumacao.test.mjs`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `STATUS_DEFUMACAO = ['rascunho', 'finalizada', 'cancelada']`
  - `rendimento(pesoBrutoKg, pesoFinalKg): number | null` — fração de 0 a 1; `null` quando não dá para calcular
  - `condicaoRendimento(r): { id, label, cor }` — `sem_dado`, `baixo` (< 0,40), `normal`
  - `saldoLote(recebimentoItem, itensJaDefumados): number` — quilos ainda disponíveis daquele lote
  - `pesosValidos({ peso_bruto_kg, perda_limpeza_kg, sobra_kg, peso_final_kg }): { ok: boolean, erro?: string }`
  - `proximaFicha(dataStr, fichasExistentes): string` — `DEF-AAMMDD-###`

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/defumacao.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATUS_DEFUMACAO, rendimento, condicaoRendimento,
  saldoLote, pesosValidos, proximaFicha,
} from '../lib/defumacao.js';

test('STATUS_DEFUMACAO: os três status da ficha', () => {
  assert.deepEqual(STATUS_DEFUMACAO, ['rascunho', 'finalizada', 'cancelada']);
});

test('rendimento: defumado sobre bruto', () => {
  assert.equal(rendimento(100, 45), 0.45);
});

test('rendimento: numeric do Postgres chega como string', () => {
  assert.equal(rendimento('180.0000', '81.0000'), 0.45);
});

test('rendimento: sem bruto não há conta', () => {
  assert.equal(rendimento(0, 10), null);
  assert.equal(rendimento(null, 10), null);
  assert.equal(rendimento(100, null), null);
});

test('condicaoRendimento: abaixo de 40% é alerta', () => {
  assert.equal(condicaoRendimento(0.39).id, 'baixo');
});

test('condicaoRendimento: exatamente 40% não é alerta', () => {
  assert.equal(condicaoRendimento(0.40).id, 'normal');
});

test('condicaoRendimento: sem dado', () => {
  assert.equal(condicaoRendimento(null).id, 'sem_dado');
});

test('saldoLote: recebido menos o que já foi defumado', () => {
  const item = { id: 'a', quantidade: 180 };
  const jaDefumados = [
    { recebimento_item_id: 'a', peso_bruto_kg: 50 },
    { recebimento_item_id: 'a', peso_bruto_kg: 30 },
    { recebimento_item_id: 'b', peso_bruto_kg: 90 },
  ];
  assert.equal(saldoLote(item, jaDefumados), 100);
});

test('saldoLote: lote intocado devolve o recebido inteiro', () => {
  assert.equal(saldoLote({ id: 'a', quantidade: '180.0000' }, []), 180);
});

test('saldoLote: nunca devolve negativo', () => {
  const item = { id: 'a', quantidade: 10 };
  assert.equal(saldoLote(item, [{ recebimento_item_id: 'a', peso_bruto_kg: 25 }]), 0);
});

test('pesosValidos: peso defumado maior que o bruto é erro', () => {
  const r = pesosValidos({ peso_bruto_kg: 100, peso_final_kg: 120 });
  assert.equal(r.ok, false);
  assert.match(r.erro, /bruto/i);
});

test('pesosValidos: perda mais sobra não pode passar do bruto', () => {
  const r = pesosValidos({ peso_bruto_kg: 100, perda_limpeza_kg: 70, sobra_kg: 40, peso_final_kg: 10 });
  assert.equal(r.ok, false);
});

test('pesosValidos: peso bruto é obrigatório e positivo', () => {
  assert.equal(pesosValidos({ peso_bruto_kg: 0, peso_final_kg: 0 }).ok, false);
  assert.equal(pesosValidos({ peso_final_kg: 10 }).ok, false);
});

test('pesosValidos: valor negativo é erro', () => {
  assert.equal(pesosValidos({ peso_bruto_kg: 100, perda_limpeza_kg: -1, peso_final_kg: 40 }).ok, false);
});

test('pesosValidos: ficha completa e coerente passa', () => {
  const r = pesosValidos({ peso_bruto_kg: 180, perda_limpeza_kg: 20, sobra_kg: 5, peso_final_kg: 81 });
  assert.equal(r.ok, true);
});

test('pesosValidos: peso defumado ainda não informado passa (rascunho)', () => {
  assert.equal(pesosValidos({ peso_bruto_kg: 180 }).ok, true);
});

test('proximaFicha: primeira ficha do dia', () => {
  assert.equal(proximaFicha('2026-08-22', []), 'DEF-260822-001');
});

test('proximaFicha: continua do maior sufixo, não da contagem', () => {
  const existentes = [{ lote: 'DEF-260822-001' }, { lote: 'DEF-260822-003' }];
  assert.equal(proximaFicha('2026-08-22', existentes), 'DEF-260822-004');
});

test('proximaFicha: ignora ficha de outro dia e sufixo não numérico', () => {
  const existentes = [{ lote: 'DEF-260821-009' }, { lote: 'DEF-260822-00X' }, { lote: 'DEF-260822-002' }];
  assert.equal(proximaFicha('2026-08-22', existentes), 'DEF-260822-003');
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
node --test tests/defumacao.test.mjs
```

Esperado: FAIL — `Cannot find module '../lib/defumacao.js'`.

- [ ] **Step 3: Implementar**

Criar `lib/defumacao.js`. O `proximaFicha` segue o mesmo raciocínio já corrigido em `lib/format.js` (`proximosLotes`): **maior sufixo + 1, nunca contagem de linhas** — contagem quebra assim que alguém apaga uma ficha.

```js
// Helpers da ficha de defumação (Fase 2 do controle de lote).
//
// A ficha de papel que esta tela substitui está em
// fichas-impressas/364_Fichas_Impressas_v2.pdf, página 2. O rendimento é a
// conta que o defumador acompanha ao vivo: peso defumado dividido pelo peso
// bruto que entrou.

export const STATUS_DEFUMACAO = ['rascunho', 'finalizada', 'cancelada'];

const num = v => (v === null || v === undefined || v === '' ? null : Number(v));

// Fração de 0 a 1. Sem peso bruto não existe conta — devolve null em vez de
// fingir zero, para a tela mostrar "—" em lugar de "0%".
export function rendimento(pesoBrutoKg, pesoFinalKg) {
  const bruto = num(pesoBrutoKg);
  const final = num(pesoFinalKg);
  if (!bruto || bruto <= 0 || final === null || Number.isNaN(final)) return null;
  return final / bruto;
}

// Abaixo de 40% o sistema avisa, mas deixa salvar: pode ser real, e travar
// faria o operador ajustar o número para passar.
export function condicaoRendimento(r) {
  if (r === null || r === undefined || Number.isNaN(r)) {
    return { id: 'sem_dado', label: '—', cor: '#888' };
  }
  if (r < 0.40) return { id: 'baixo', label: 'Rendimento baixo', cor: '#c0392b' };
  return { id: 'normal', label: 'Rendimento normal', cor: '#2e7d32' };
}

// Quilos ainda disponíveis do lote: o que foi recebido menos o peso bruto já
// lançado em fichas de defumação daquele mesmo item de recebimento.
//
// O saldo NÃO sai de stock_balances: a tabela existe em produção mas nenhum
// código escreve nela, então a lista de lotes sairia vazia.
export function saldoLote(recebimentoItem, itensJaDefumados) {
  const recebido = num(recebimentoItem?.quantidade) || 0;
  const usado = (itensJaDefumados || [])
    .filter(i => i.recebimento_item_id === recebimentoItem?.id)
    .reduce((s, i) => s + (num(i.peso_bruto_kg) || 0), 0);
  return Math.max(0, recebido - usado);
}

export function pesosValidos({ peso_bruto_kg, perda_limpeza_kg, sobra_kg, peso_final_kg } = {}) {
  const bruto = num(peso_bruto_kg);
  const perda = num(perda_limpeza_kg) || 0;
  const sobra = num(sobra_kg) || 0;
  const final = num(peso_final_kg);

  if (bruto === null || Number.isNaN(bruto) || bruto <= 0) {
    return { ok: false, erro: 'Informe o peso bruto que entrou na manipulação.' };
  }
  if (perda < 0 || sobra < 0 || (final !== null && final < 0)) {
    return { ok: false, erro: 'Peso negativo não existe.' };
  }
  if (final !== null && final > bruto) {
    return { ok: false, erro: 'O peso defumado não pode ser maior que o peso bruto.' };
  }
  if (perda + sobra > bruto) {
    return { ok: false, erro: 'Perda e sobra somadas passam do peso bruto.' };
  }
  return { ok: true };
}

// Número da ficha: DEF-AAMMDD-###. Deriva do maior sufixo já usado no dia,
// nunca da contagem de fichas — contagem repete número assim que uma some.
export function proximaFicha(dataStr, fichasExistentes) {
  const prefixo = `DEF-${dataStr.slice(2, 4)}${dataStr.slice(5, 7)}${dataStr.slice(8, 10)}-`;
  const maior = (fichasExistentes || []).reduce((max, f) => {
    const lote = String(f?.lote || '');
    if (!lote.startsWith(prefixo)) return max;
    const sufixo = lote.slice(prefixo.length);
    if (!/^\d+$/.test(sufixo)) return max;
    return Math.max(max, parseInt(sufixo, 10));
  }, 0);
  return prefixo + String(maior + 1).padStart(3, '0');
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
node --test tests/defumacao.test.mjs
```

Esperado: PASS, 18 testes.

- [ ] **Step 5: Suíte inteira**

```bash
npm test
```

Esperado: 153 + 18 = 171, sem regressão.

- [ ] **Step 6: Commit**

```bash
git add lib/defumacao.js tests/defumacao.test.mjs
git commit -m "feat(defumacao): rendimento, saldo do lote e número da ficha"
```

---

### Task 2: Migração 29 — status da ficha e vínculo com o lote

**Files:**
- Create: `supabase/atualizacao_29_ficha_defumacao.sql`
- Create: `tests/migracao-29/fixture.sql`
- Create: `tests/migracao-29/cenarios.sql`
- Create: `tests/migracao-29/verificar.sh`
- Modify: `supabase/schema.sql`

**Interfaces:**
- Consumes: nada.
- Produces: `defumacoes.status` (`rascunho`/`finalizada`/`cancelada`), `defumacoes.cancelada_motivo`, `cancelada_em`, `cancelada_por_id`, `updated_at`; `defumacao_itens.recebimento_item_id`; `unique (empresa_id, lote)` em `defumacoes`; trigger que trava ficha finalizada. As tasks 3 a 5 gravam nessas colunas.

- [ ] **Step 1: Fixture**

Criar `tests/migracao-29/fixture.sql`, espelhando a forma real de produção (verificada em 2026-08-22) — no padrão de `tests/migracao-28/fixture.sql`:

```sql
-- Esqueleto mínimo para exercitar a atualização 29 num Postgres local.
create schema if not exists auth;
create or replace function auth.uid() returns uuid
  language sql stable as $$ select nullif(current_setting('req.uid', true), '')::uuid $$;

create table empresas (id uuid primary key, nome text);
create table funcionarios (id uuid primary key, empresa_id uuid references empresas(id), nome text);
create table materias_primas (id uuid primary key, empresa_id uuid references empresas(id), nome text);
create table recebimentos (id uuid primary key default gen_random_uuid(), data date not null default current_date, empresa_id uuid references empresas(id));
create table recebimento_itens (
  id uuid primary key default gen_random_uuid(),
  recebimento_id uuid not null references recebimentos(id) on delete cascade,
  materia_prima_id uuid not null references materias_primas(id),
  lote text not null,
  quantidade numeric(12,4) not null,
  custo_unitario numeric(12,2) not null,
  volumes int,
  empresa_id uuid not null references empresas(id),
  unique (empresa_id, lote)
);

create table defumacoes (
  id uuid primary key default gen_random_uuid(),
  lote text not null,
  data date not null default current_date,
  hora_inicio time,
  hora_fim time,
  temperatura_c numeric(6,2),
  responsavel_id uuid references funcionarios(id),
  obs text,
  empresa_id uuid not null references empresas(id),
  created_at timestamptz not null default now()
);

create table defumacao_itens (
  id uuid primary key default gen_random_uuid(),
  defumacao_id uuid not null references defumacoes(id) on delete cascade,
  materia_prima_id uuid not null references materias_primas(id),
  peso_bruto_kg numeric(12,4),
  perda_limpeza_kg numeric(12,4),
  sobra_kg numeric(12,4),
  peso_final_kg numeric(12,4),
  empresa_id uuid not null references empresas(id)
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  usuario_id uuid, acao text not null, recurso text, recurso_id uuid,
  valores_anteriores jsonb, valores_novos jsonb, justificativa text,
  created_at timestamptz not null default now()
);

insert into empresas (id, nome) values ('11111111-1111-1111-1111-111111111111', 'Food Services');
insert into funcionarios (id, empresa_id, nome) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Defumador Teste');
insert into materias_primas (id, empresa_id, nome) values ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'Costela Bovina');
insert into recebimentos (id, empresa_id) values ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111');
insert into recebimento_itens (id, recebimento_id, materia_prima_id, lote, quantidade, custo_unitario, volumes, empresa_id)
  values ('55555555-5555-5555-5555-555555555555', '44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333', 'LT-260822-001', 180, 21.90, 20, '11111111-1111-1111-1111-111111111111');

-- Ficha legada, anterior à 29: sem status e sem lote de origem. Prova que a
-- migração não quebra o que já está em produção.
insert into defumacoes (id, lote, empresa_id) values ('66666666-6666-6666-6666-666666666666', 'DEF-LEGADO-001', '11111111-1111-1111-1111-111111111111');
insert into defumacao_itens (defumacao_id, materia_prima_id, peso_bruto_kg, peso_final_kg, empresa_id)
  values ('66666666-6666-6666-6666-666666666666', '33333333-3333-3333-3333-333333333333', 100, 45, '11111111-1111-1111-1111-111111111111');
```

- [ ] **Step 2: Cenários**

Criar `tests/migracao-29/cenarios.sql`. Cada bloco prova uma regra; ancore cada asserção na **mensagem esperada**, como `tests/migracao-28/cenarios.sql` faz — `exception when others` sem checar a mensagem engole o erro errado e dá falso verde:

```sql
-- Exercita a atualização 29. Roda depois do fixture e da migração.
\set QUIET on
set client_min_messages = warning;
begin;

-- Cenário 1: a ficha legada sobreviveu e ganhou status padrão.
do $$
declare v_status text;
begin
  select status into v_status from defumacoes where id = '66666666-6666-6666-6666-666666666666';
  if v_status is distinct from 'rascunho' then
    raise exception 'FALHA 1: ficha legada ficou com status %', v_status;
  end if;
  raise notice 'OK 1: ficha legada preservada';
end $$;

-- Cenário 2: ficha nova grava com lote de origem no item.
do $$
declare v_ficha uuid;
begin
  insert into defumacoes (lote, data, hora_inicio, hora_fim, temperatura_c, responsavel_id, empresa_id)
    values ('DEF-260822-001', current_date, '08:00', '14:00', 92.5,
            '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111')
    returning id into v_ficha;
  insert into defumacao_itens (defumacao_id, materia_prima_id, recebimento_item_id,
                               peso_bruto_kg, perda_limpeza_kg, sobra_kg, peso_final_kg, empresa_id)
    values (v_ficha, '33333333-3333-3333-3333-333333333333', '55555555-5555-5555-5555-555555555555',
            180, 20, 5, 81, '11111111-1111-1111-1111-111111111111');
  raise notice 'OK 2: ficha com lote de origem';
end $$;

-- Cenário 3: peso defumado maior que o bruto é recusado pelo banco.
do $$
declare v_ficha uuid;
begin
  select id into v_ficha from defumacoes where lote = 'DEF-260822-001';
  begin
    insert into defumacao_itens (defumacao_id, materia_prima_id, recebimento_item_id,
                                 peso_bruto_kg, peso_final_kg, empresa_id)
      values (v_ficha, '33333333-3333-3333-3333-333333333333', '55555555-5555-5555-5555-555555555555',
              100, 120, '11111111-1111-1111-1111-111111111111');
    raise exception 'FALHA 3: peso defumado maior que o bruto foi aceito';
  exception when check_violation then null; end;
  raise notice 'OK 3: peso defumado limitado pelo bruto';
end $$;

-- Cenário 4: peso negativo é recusado.
do $$
declare v_ficha uuid;
begin
  select id into v_ficha from defumacoes where lote = 'DEF-260822-001';
  begin
    insert into defumacao_itens (defumacao_id, materia_prima_id, peso_bruto_kg, peso_final_kg, empresa_id)
      values (v_ficha, '33333333-3333-3333-3333-333333333333', -5, 1, '11111111-1111-1111-1111-111111111111');
    raise exception 'FALHA 4: peso negativo aceito';
  exception when check_violation then null; end;
  raise notice 'OK 4: peso negativo recusado';
end $$;

-- Cenário 5: número de ficha repetido na mesma empresa é recusado;
-- em outra empresa, passa.
do $$
begin
  begin
    insert into defumacoes (lote, empresa_id)
      values ('DEF-260822-001', '11111111-1111-1111-1111-111111111111');
    raise exception 'FALHA 5a: número de ficha repetido aceito';
  exception when unique_violation then null; end;

  insert into empresas (id, nome) values ('99999999-9999-9999-9999-999999999999', 'Steakhouse');
  insert into defumacoes (lote, empresa_id)
    values ('DEF-260822-001', '99999999-9999-9999-9999-999999999999');
  raise notice 'OK 5: número de ficha único por empresa';
end $$;

-- Cenário 6: ficha finalizada é imutável — cabeçalho e itens.
do $$
declare v_ficha uuid; v_item uuid;
begin
  select id into v_ficha from defumacoes where lote = 'DEF-260822-001'
    and empresa_id = '11111111-1111-1111-1111-111111111111';
  select id into v_item from defumacao_itens where defumacao_id = v_ficha limit 1;
  update defumacoes set status = 'finalizada' where id = v_ficha;

  begin
    update defumacoes set temperatura_c = 100 where id = v_ficha;
    raise exception 'FALHA 6a: cabeçalho de ficha finalizada mudou';
  exception when others then
    if sqlerrm not like '%finalizada%' then raise; end if;
  end;

  begin
    update defumacao_itens set peso_final_kg = 90 where id = v_item;
    raise exception 'FALHA 6b: item de ficha finalizada mudou';
  exception when others then
    if sqlerrm not like '%finalizada%' then raise; end if;
  end;

  begin
    insert into defumacao_itens (defumacao_id, materia_prima_id, peso_bruto_kg, empresa_id)
      values (v_ficha, '33333333-3333-3333-3333-333333333333', 10, '11111111-1111-1111-1111-111111111111');
    raise exception 'FALHA 6c: item novo entrou em ficha finalizada';
  exception when others then
    if sqlerrm not like '%finalizada%' then raise; end if;
  end;

  raise notice 'OK 6: ficha finalizada é imutável';
end $$;

-- Cenário 7: cancelar exige motivo, e cancelada é terminal.
do $$
declare v_ficha uuid;
begin
  select id into v_ficha from defumacoes where lote = 'DEF-260822-001'
    and empresa_id = '11111111-1111-1111-1111-111111111111';
  begin
    update defumacoes set status = 'cancelada' where id = v_ficha;
    raise exception 'FALHA 7a: cancelou sem motivo';
  exception when check_violation then null; end;

  update defumacoes set status = 'cancelada', cancelada_motivo = 'Erro de digitação no peso',
    cancelada_em = now(), cancelada_por_id = '22222222-2222-2222-2222-222222222222'
    where id = v_ficha;

  begin
    update defumacoes set status = 'rascunho' where id = v_ficha;
    raise exception 'FALHA 7b: ficha cancelada voltou para rascunho';
  exception when others then
    if sqlerrm not like '%cancelada%' then raise; end if;
  end;
  raise notice 'OK 7: cancelamento exige motivo e é terminal';
end $$;

-- Cenário 8: apagar a ficha em cascata não é bloqueado pelo trigger do item.
do $$
declare v_ficha uuid;
begin
  insert into defumacoes (lote, empresa_id) values ('DEF-260822-777', '11111111-1111-1111-1111-111111111111')
    returning id into v_ficha;
  insert into defumacao_itens (defumacao_id, materia_prima_id, peso_bruto_kg, empresa_id)
    values (v_ficha, '33333333-3333-3333-3333-333333333333', 10, '11111111-1111-1111-1111-111111111111');
  update defumacoes set status = 'finalizada' where id = v_ficha;
  delete from defumacoes where id = v_ficha;
  raise notice 'OK 8: delete em cascata passa';
end $$;

commit;
```

- [ ] **Step 3: Runner, rodando e falhando**

Criar `tests/migracao-29/verificar.sh` copiando `tests/migracao-28/verificar.sh` e trocando: o nome do banco (`BANCO_TESTE_DEFUMACAO:-defumacao_test_364`), o arquivo da migração, e a asserção pós-rollback — que deve conferir que `defumacoes.status` e `defumacao_itens.recebimento_item_id` sumiram. Mantenha as duas coisas que a 28 provou valerem a pena: **aplicar a migração duas vezes** antes dos cenários (prova de idempotência) e extrair o rollback comentado por `sed` para executá-lo.

```bash
chmod +x tests/migracao-29/verificar.sh && tests/migracao-29/verificar.sh
```

Esperado: FAIL — arquivo da migração não existe.

- [ ] **Step 4: Escrever a migração**

Criar `supabase/atualizacao_29_ficha_defumacao.sql`. As colunas de processo já existem em produção; esta migração só acrescenta o que falta e impõe as regras:

```sql
-- Fase 2 do controle de lote: a ficha de defumação sai do papel.
--
-- As tabelas `defumacoes` e `defumacao_itens` já existem desde a atualização 08
-- e foram modeladas quase campo a campo a partir da ficha impressa (hora de
-- início, hora de fim, temperatura, peso bruto, perda na limpeza, sobra e peso
-- defumado). Nunca ganharam tela: até aqui a ficha era preenchida à mão.
--
-- Falta o que liga a ficha ao lote e o que a torna confiável:
--   • `defumacao_itens.recebimento_item_id` — o lote de matéria-prima que
--     entrou. É o elo entre a Fase 1 (recebimento) e a Fase 3 (embalagem).
--   • `defumacoes.status` — a ficha nasce em rascunho e é finalizada pelo
--     responsável; depois disso não muda mais.
--
-- `defumacoes.lote` passa a ser o NÚMERO DA FICHA (DEF-AAMMDD-###), não o lote
-- rastreável: uma ficha pode conter vários lotes, um por item. O lote
-- rastreável mora em `defumacao_itens.recebimento_item_id`.
--
-- Idempotente: `add column if not exists`, `drop constraint if exists` e
-- `create or replace`. Fichas já lançadas nascem em `rascunho` e com
-- `recebimento_item_id` nulo — nulo significa "ficha anterior à rastreabilidade".
--
-- Antes de aplicar, confira que não há número de ficha repetido na mesma
-- empresa, senão a constraint de unicidade falha:
--   select empresa_id, lote, count(*) from defumacoes group by 1,2 having count(*) > 1;

begin;

-- ---------- CABEÇALHO DA FICHA ----------

alter table public.defumacoes
  add column if not exists status text not null default 'rascunho',
  add column if not exists cancelada_motivo text,
  add column if not exists cancelada_em timestamptz,
  add column if not exists cancelada_por_id uuid references public.funcionarios(id),
  add column if not exists updated_at timestamptz not null default now();

alter table public.defumacoes drop constraint if exists defumacoes_status_valido;
alter table public.defumacoes add constraint defumacoes_status_valido
  check (status in ('rascunho', 'finalizada', 'cancelada'));

alter table public.defumacoes drop constraint if exists defumacoes_cancelamento_motivo;
alter table public.defumacoes add constraint defumacoes_cancelamento_motivo
  check (status <> 'cancelada' or (cancelada_motivo is not null and btrim(cancelada_motivo) <> ''));

-- O número da ficha é único dentro da empresa. Sem isso, duas fichas do mesmo
-- dia podem receber o mesmo número e o rastro fica ambíguo.
alter table public.defumacoes drop constraint if exists defumacoes_lote_unico_por_empresa;
alter table public.defumacoes add constraint defumacoes_lote_unico_por_empresa
  unique (empresa_id, lote);

comment on column public.defumacoes.lote is
  'Número da ficha de defumação (DEF-AAMMDD-###). O lote rastreável fica em defumacao_itens.recebimento_item_id.';

-- ---------- ITENS: o lote que entrou ----------

alter table public.defumacao_itens
  add column if not exists recebimento_item_id uuid references public.recebimento_itens(id);

create index if not exists defumacao_itens_recebimento_item_idx
  on public.defumacao_itens (recebimento_item_id);

comment on column public.defumacao_itens.recebimento_item_id is
  'Lote de matéria-prima que entrou nesta defumação. Nulo = ficha anterior à atualização 29.';

alter table public.defumacao_itens drop constraint if exists defumacao_itens_pesos_coerentes;
alter table public.defumacao_itens add constraint defumacao_itens_pesos_coerentes
  check (
    (peso_bruto_kg is null or peso_bruto_kg > 0)
    and (perda_limpeza_kg is null or perda_limpeza_kg >= 0)
    and (sobra_kg is null or sobra_kg >= 0)
    and (peso_final_kg is null or peso_final_kg >= 0)
    -- O peso defumado nunca supera o peso bruto que entrou.
    and (peso_final_kg is null or peso_bruto_kg is null or peso_final_kg <= peso_bruto_kg)
  );

-- ---------- IMUTABILIDADE ----------
-- Mesmo padrão da atualização 27 (pedidos): ficha finalizada não muda mais;
-- correção exige cancelar com motivo e refazer.

create or replace function public.fn_defumacao_bloquear_edicao() returns trigger
language plpgsql as $$
declare
  v_ficha uuid;
  v_status text;
begin
  v_ficha := coalesce(new.defumacao_id, old.defumacao_id);
  select status into v_status from public.defumacoes where id = v_ficha;
  -- Ficha já apagada: é a cascata do `on delete cascade`, deixa passar.
  if not found then
    return coalesce(new, old);
  end if;
  if v_status <> 'rascunho' then
    raise exception 'A ficha de defumação está % — os itens não podem ser alterados. Cancele com motivo e refaça.', v_status
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_defumacao_itens_bloquear_edicao on public.defumacao_itens;
create trigger trg_defumacao_itens_bloquear_edicao
  before insert or update or delete on public.defumacao_itens
  for each row execute function public.fn_defumacao_bloquear_edicao();

create or replace function public.fn_defumacao_cabecalho() returns trigger
language plpgsql as $$
begin
  new.updated_at := clock_timestamp();

  if old.status = 'cancelada' and new.status is distinct from 'cancelada' then
    raise exception 'Ficha cancelada não volta para %.', new.status
      using errcode = 'check_violation';
  end if;

  if old.status <> 'rascunho'
     and (new.data is distinct from old.data
          or new.hora_inicio is distinct from old.hora_inicio
          or new.hora_fim is distinct from old.hora_fim
          or new.temperatura_c is distinct from old.temperatura_c
          or new.responsavel_id is distinct from old.responsavel_id) then
    raise exception 'A ficha de defumação está % — o cabeçalho não pode ser alterado.', old.status
      using errcode = 'check_violation';
  end if;

  if old.status = 'rascunho' and new.status = 'finalizada'
     and not exists (select 1 from public.defumacao_itens where defumacao_id = new.id) then
    raise exception 'Ficha sem nenhuma matéria-prima lançada não pode ser finalizada.'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists trg_defumacoes_cabecalho on public.defumacoes;
create trigger trg_defumacoes_cabecalho
  before update on public.defumacoes
  for each row execute function public.fn_defumacao_cabecalho();

commit;

-- ---------- ROLLBACK ----------
-- Derruba o que a migração criou. Nenhum dado de processo é perdido: as
-- colunas de peso e de horário são anteriores a esta migração.
--
-- begin;
--
-- drop trigger if exists trg_defumacao_itens_bloquear_edicao on public.defumacao_itens;
-- drop trigger if exists trg_defumacoes_cabecalho on public.defumacoes;
-- drop function if exists public.fn_defumacao_bloquear_edicao();
-- drop function if exists public.fn_defumacao_cabecalho();
--
-- alter table public.defumacao_itens drop constraint if exists defumacao_itens_pesos_coerentes;
-- drop index if exists public.defumacao_itens_recebimento_item_idx;
-- alter table public.defumacao_itens drop column if exists recebimento_item_id;
--
-- alter table public.defumacoes drop constraint if exists defumacoes_lote_unico_por_empresa;
-- alter table public.defumacoes drop constraint if exists defumacoes_cancelamento_motivo;
-- alter table public.defumacoes drop constraint if exists defumacoes_status_valido;
-- alter table public.defumacoes
--   drop column if exists status,
--   drop column if exists cancelada_motivo,
--   drop column if exists cancelada_em,
--   drop column if exists cancelada_por_id,
--   drop column if exists updated_at;
--
-- commit;
```

- [ ] **Step 5: Rodar os cenários e ver passar**

```bash
tests/migracao-29/verificar.sh
```

Esperado: exit 0, terminando em `OK: rollback desfaz a migração`.

- [ ] **Step 6: Refletir em `supabase/schema.sql`**

Acrescentar as colunas novas nas definições de `defumacoes` e `defumacao_itens`, se elas existirem naquele arquivo. **Confira antes** — `schema.sql` está defasado em relação a produção, e várias tabelas não estão lá; se não estiverem, não invente as tabelas, só registre no relatório.

- [ ] **Step 7: Commit**

```bash
git add supabase/atualizacao_29_ficha_defumacao.sql supabase/schema.sql tests/migracao-29
git commit -m "feat(defumacao): migração 29 com status da ficha e vínculo com o lote"
```

---

### Task 3: Abas e rota da ficha

**Files:**
- Modify: `components/ProducaoTabs.js`
- Create: `app/producoes/defumacao/page.js`

**Interfaces:**
- Consumes: `proximaFicha`, `STATUS_DEFUMACAO` (Task 1); colunas da Task 2.
- Produces: a rota `/producoes/defumacao` com a lista de fichas e o botão de ficha nova. A Task 4 constrói a ficha em si, em `[id]`.

- [ ] **Step 1: Ajustar as abas**

Em `components/ProducaoTabs.js`, o rótulo de `/producoes/completa` volta a ser **"Produção Completa"** — hoje ele está como "Defumação", que passa a ser a ficha nova. Acrescentar a aba `{ href: '/producoes/defumacao', label: 'Defumação' }` logo depois de "Nova Produção".

Nenhuma rota é renomeada: `/producoes/completa` continua existindo com o mesmo caminho, só muda o texto da aba.

- [ ] **Step 2: Lista de fichas**

Criar `app/producoes/defumacao/page.js`, no padrão das outras telas do módulo (`AppShell modulo="producoes"` + `<ProducaoTabs />`):

1. Carrega, filtrando `empresa_id`: `defumacoes` (com `funcionarios(nome)` e `defumacao_itens(peso_bruto_kg, peso_final_kg)`), ordenadas por `data` decrescente.
2. Tabela: número da ficha, data, horário (`hora_inicio`–`hora_fim`), temperatura, responsável, quantidade de matérias-primas, rendimento da ficha inteira (soma dos pesos finais ÷ soma dos brutos, via `rendimento` da Task 1) com a cor de `condicaoRendimento`, e o status.
3. Botão **Nova ficha de defumação**: gera o número com `proximaFicha(hoje(), fichasDoDia)`, insere `defumacoes` com `status: 'rascunho'`, `empresa_id`, `data: hoje()`, e navega para `/producoes/defumacao/<id>`.
4. Linha da tabela leva à ficha.

A ficha nasce no banco antes de ter itens **de propósito**: quem preenche está de celular ao lado do defumador, e um rascunho gravado sobrevive à tela apagando.

- [ ] **Step 3: Verificar**

```bash
npm run verify
```

- [ ] **Step 4: Commit**

```bash
git add components/ProducaoTabs.js app/producoes/defumacao/page.js
git commit -m "feat(defumacao): aba própria e lista de fichas"
```

---

### Task 4: A ficha — cabeçalho, itens e rendimento ao vivo

**Files:**
- Create: `app/producoes/defumacao/[id]/page.js`

**Interfaces:**
- Consumes: `rendimento`, `condicaoRendimento`, `saldoLote`, `pesosValidos` (Task 1); as colunas e travas da Task 2.
- Produces: a tela de preenchimento. A Task 5 acrescenta finalizar, cancelar e imprimir nesta mesma página.

- [ ] **Step 1: Cabeçalho**

Criar `app/producoes/defumacao/[id]/page.js`. Carrega a ficha pelo id **filtrando `empresa_id`** — é o que impede alcançar ficha de outra empresa adivinhando o uuid; ficha de outra empresa devolve "não encontrada", sem revelar que o id existe. Trate o erro das consultas: falha de carga precisa aparecer como falha, não como "ficha não encontrada" (foi um achado real na Fase 1).

Campos do cabeçalho, exatamente os da ficha de papel (página 2 do PDF):

| Campo | Coluna |
| --- | --- |
| Data da produção | `data` |
| Início da defumação (hora) | `hora_inicio` |
| Fim da defumação (hora) | `hora_fim` |
| Temperatura (°C) | `temperatura_c` |
| Responsável pela defumação | `responsavel_id` |
| Observações | `obs` |

Salvamento incremental: cada campo grava no `onBlur`, com o filtro de empresa na escrita. Enquanto a ficha estiver em `rascunho` os campos são editáveis; fora disso, leitura.

- [ ] **Step 2: Itens — escolher o lote**

Abaixo do cabeçalho, "Matérias-primas defumadas nesta ficha". O formulário de item tem:

1. **Lote** — lista dos `recebimento_itens` da empresa com saldo, mostrando `LT-260822-001 · Costela Bovina · receb. 22/08 · 180 kg disponíveis`. O saldo vem de `saldoLote(item, itensJaDefumados)`, onde `itensJaDefumados` são todos os `defumacao_itens` da empresa. Escolher o lote define a matéria-prima — grave `materia_prima_id` **e** `recebimento_item_id`.
2. Peso bruto (kg), Perda na limpeza (kg), Sobra aproveitável (kg), Peso defumado (kg) — todos `type="number"` com `inputMode="decimal"` e `step="0.001"`.
3. Rendimento calculado ao vivo enquanto digita, com a cor de `condicaoRendimento` e o texto do alerta quando fica abaixo de 40%. **Avisa, não bloqueia.**
4. `pesosValidos` roda antes de gravar; erro aparece em português e o item não entra.

Lote sem saldo aparece **desabilitado na lista, com o motivo visível** — some sem explicação gera chamado. Lote com inspeção de qualidade reprovada não aparece: a condição sanitária mora em `inspecoes_qualidade`, então traga `inspecoes_qualidade(status)` na consulta e use os helpers que já existem em `lib/qualidade.js` (`statusInspecao`/`inspecaoAprovada`).

Cada item é gravado no banco ao ser adicionado. A lista mostra os itens já lançados com o rendimento de cada um, e um botão para remover enquanto a ficha estiver em rascunho.

- [ ] **Step 3: Rendimento da ficha**

No rodapé do painel de itens: peso bruto total, peso defumado total e o rendimento da ficha inteira, com a mesma classificação de cor.

- [ ] **Step 4: Verificar**

```bash
npm run verify
```

- [ ] **Step 5: Commit**

```bash
git add app/producoes/defumacao/[id]/page.js
git commit -m "feat(defumacao): ficha com lote de origem e rendimento ao vivo"
```

---

### Task 5: Finalizar, cancelar e imprimir

**Files:**
- Modify: `app/producoes/defumacao/[id]/page.js`
- Modify: `app/producoes/defumacao/page.js`

**Interfaces:**
- Consumes: tudo das tasks anteriores.
- Produces: nada consumido por tasks seguintes. Última task da fase.

- [ ] **Step 1: Finalizar**

Botão **Finalizar ficha**, visível só em `rascunho`. Confirma com um resumo (quantas matérias-primas, peso bruto total, peso defumado total, rendimento) e grava `status = 'finalizada'`. Depois disso a tela vira leitura — o banco recusa qualquer alteração, então trate o erro do trigger mostrando a mensagem e recarregando o estado real.

Ficha sem item nenhum não finaliza; o banco também recusa.

- [ ] **Step 2: Cancelar com motivo**

Botão **Cancelar ficha**, com campo de motivo obrigatório, no mesmo padrão do cancelamento de pedido (`app/pedidos/[id]/page.js`): grava `status`, `cancelada_motivo`, `cancelada_em` e `cancelada_por_id`.

`cancelada_por_id` é **quem está cancelando**, não o responsável pela defumação: use `useAuth()` para pegar `session.user.id` e resolva o funcionário por `funcionarios.user_id`, como `app/producoes/nova/page.js` já faz. Se não houver funcionário correspondente, grave `null` — melhor vazio que errado — e não bloqueie o cancelamento.

Ficha cancelada mostra tarja com motivo e data, e não oferece cancelar de novo.

- [ ] **Step 3: Imprimir a ficha**

Botão **Imprimir ficha**, usando `FichaPrint`/`imprimirFicha` como as outras telas, com os campos do cabeçalho e a tabela de itens (lote, matéria-prima, peso bruto, perda, sobra, peso defumado, rendimento). Serve para arquivar em papel o que antes era preenchido à mão.

Atenção ao `@page`: `EtiquetaPrint` declara página de 108×32 mm e `FichaPrint` é A4. Se as duas coisas convivessem montadas na mesma tela, a ficha sairia no tamanho da etiqueta — foi um defeito real corrigido na Fase 1. Esta tela **não** imprime etiqueta, então só monte `FichaPrint`.

- [ ] **Step 4: Status na lista**

Na lista de fichas, mostrar o status com tag colorida (rascunho, finalizada, cancelada) e o motivo do cancelamento no título quando houver.

- [ ] **Step 5: Verificar**

```bash
npm run verify
```

- [ ] **Step 6: Commit**

```bash
git add app/producoes/defumacao
git commit -m "feat(defumacao): finalizar, cancelar com motivo e imprimir a ficha"
```

---

## Conferência manual (dono do sistema)

Depois de aplicar a migração 29 no Supabase, conferir na tela:

1. A aba **Defumação** abre a lista de fichas; a aba antiga voltou a se chamar **Produção Completa** e continua funcionando como antes.
2. Criar ficha nova: o número sai como `DEF-AAMMDD-001` e a ficha aparece em rascunho.
3. Preencher o cabeçalho de celular: data, início, fim, temperatura e responsável gravam sozinhos ao sair do campo.
4. Lançar um item escolhendo um lote de recebimento: a matéria-prima vem junto e o saldo do lote diminui na lista.
5. Digitar peso bruto 180 e peso defumado 81: o rendimento aparece 45%, em verde. Trocar para 60: fica vermelho, com aviso, **mas deixa salvar**.
6. Tentar peso defumado maior que o bruto: a tela recusa em português.
7. Finalizar: os campos travam. Tentar editar mostra a mensagem do banco em português.
8. Cancelar exige motivo; a ficha cancelada mostra motivo e data e não volta atrás.
9. Imprimir a ficha em A4 e conferir se sai no tamanho certo.

## Ordem de deploy

**Migração 29 primeiro, depois o código.** A tela grava `status` e `recebimento_item_id` em toda ficha; sem as colunas, o PostgREST devolve `PGRST204` e o lançamento quebra.

E esta fase **só vai para a `main` depois da Fase 1** (PR #6): a numeração das migrações depende disso, e a 28 já está aplicada em produção.

## Depois desta fase

Fase 3 — ficha de embalagem (página 3 do mesmo PDF): consome o peso defumado por lote, gera os produtos acabados com validade calculada, imprime a etiqueta de produção 50×30 mm e bloqueia o lançamento manual desses produtos na Produção Completa. A migração será a **30**.
