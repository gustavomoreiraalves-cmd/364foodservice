# Fase 1 — Migração 28 e etiqueta de recebimento — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** identificar cada volume de matéria-prima recebida com uma etiqueta impressa pelo sistema, carregando o lote que vai acompanhar todo o processo até a expedição.

**Architecture:** a geometria e os modelos de etiqueta saem de `components/EtiquetaPrint.js` para `lib/etiquetas.js`, e o componente passa a ser dirigido por modelo em vez de desenhar um layout fixo. O QR é gerado **antes** de abrir a impressão, como string SVG que viaja junto com os dados da etiqueta — nada assíncrono acontece depois do `window.print()`. A migração 28 acrescenta `volumes` ao item de recebimento, amplia o `check` de `etiqueta_impressoes.source_type` e ensina a RPC `registrar_impressao` a auditar impressão de recebimento.

**Tech Stack:** Next.js 14 (App Router, componentes client), React 18, Supabase JS v2, Postgres/Supabase, `node --test` para lógica pura, `psql` em banco local descartável para SQL, `qrcode` (MIT) para o QR em SVG.

**Design:** [docs/superpowers/specs/2026-08-20-controle-lote-rastreabilidade-design.md](../specs/2026-08-20-controle-lote-rastreabilidade-design.md) — esta é a Fase 1 das cinco.

## Global Constraints

- Português em toda a interface, mensagens de erro, comentários de código e mensagens de commit.
- Todas as consultas ao Supabase filtram `empresa_id` a partir de `useEmpresaAtual()` (`lib/empresa.js`). Toda linha inserida grava `empresa_id`.
- `npm test` roda `node --test tests/*.test.mjs`. Só entra em `tests/*.test.mjs` lógica pura, sem React e sem rede.
- `npm run verify` roda `npm test && npm run build` — portão antes de cada commit que toca em código. Se o build falhar com `PageNotFoundError`, apague `.next` e rode de novo: sobra de build de outra branch.
- **`.env.local` aponta para o Supabase de produção.** Nenhum passo deste plano roda migração contra ele nem escreve no banco. As migrações são exercitadas em Postgres local descartável (`psql` e `pg_isready` já verificados nesta máquina).
- **Nunca rode `npm run dev`** durante a implementação: colide com `npm run build` no diretório `.next`, e a conferência na tela é do dono do sistema.
- Migrações vão em `supabase/atualizacao_NN_*.sql`, transacionais, com bloco de rollback comentado no fim, no padrão de `supabase/atualizacao_27_pedidos_edicao.sql`.
- **O número desta migração é 28.** A `main` tem até `atualizacao_27_pedidos_edicao.sql`. A numeração do projeto já colidiu duas vezes; confira `ls supabase/` antes de criar o arquivo.
- Estado de produção verificado em 2026-08-21 pelo PostgREST: a atualização 17 **está aplicada** (`produto_regras_validade`, `etiqueta_impressoes`, `producoes_internas`, `producao_descartes` existem). Nada da cadeia de lote existe: sem `recebimento_itens.volumes`, sem `produtos.conservacao_texto`, sem `empresas.sim_numero`.
- O lote **não é renumerado em etapa nenhuma**: `recebimento_itens.lote` (`LT-AAMMDD-###`) é o identificador que as fases seguintes carregam.

## Decisões desta fase

**O QR aponta para a página pública de rastreio, que só existe na Fase 5.** É o que o design manda, e a etiqueta é impressa uma vez e vive na embalagem por meses — mudar o conteúdo depois exigiria reimprimir tudo. Até a Fase 5, ler o QR de um volume dá 404. A etiqueta de recebimento é interna (matéria-prima em câmara fria, não vai para cliente), então o 404 fica dentro de casa.

**A URL base sai de `NEXT_PUBLIC_SITE_URL`**, com `https://sistema-364.vercel.app` como padrão. Sem isso o QR de um ambiente de teste apontaria para produção.

**Só dois modelos de etiqueta entram agora:** `validade-cozinha` (o que já existe) e `recebimento`. Os modelos de produção e de despacho são das fases 3 e 4 — `lib/etiquetas.js` fica aberto para eles, sem antecipá-los.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
| --- | --- |
| `lib/etiquetas.js` (novo) | modelos, geometria do rolo, paginação em colunas, URL de rastreio — lógica pura |
| `lib/qr.js` (novo) | gera o SVG do QR a partir de um texto; único ponto que fala com o pacote `qrcode` |
| `tests/etiquetas.test.mjs` (novo) | paginação, medidas e URL |
| `tests/qr.test.mjs` (novo) | o SVG sai com dimensão e sem margem |
| `supabase/atualizacao_28_lote_recebimento.sql` (novo) | `volumes`, `conservacao_texto`, `sim_numero`/`sim_municipio`, `source_type` ampliado, RPC estendida |
| `tests/migracao-28/` (novo) | fixture, cenários e runner com rollback |
| `components/EtiquetaPrint.js` (modificar) | passa a ser dirigido por modelo; ganha o layout de recebimento |
| `components/ModalEtiquetas.js` (modificar) | passa a servir qualquer `source_type`, resolve o QR antes de imprimir |
| `app/recebimentos/page.js` (modificar) | campo `volumes` no item e impressão/reimpressão por item |
| `supabase/schema.sql` (modificar) | reflete as colunas novas |

---

### Task 1: `lib/etiquetas.js` — modelos, geometria e paginação

**Files:**
- Create: `lib/etiquetas.js`
- Test: `tests/etiquetas.test.mjs`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `MODELOS: Record<string, Modelo>` onde `Modelo` é `{ id, nome, largura_mm, altura_mm, colunas, rolo_mm, gap_coluna_mm, gap_linha_mm }`
  - `modelo(id: string): Modelo` — erro se o id não existir
  - `medidasImpressao(id: string): { paginaLargura_mm, paginaAltura_mm, margemLateral_mm, etiquetaLargura_mm, etiquetaAltura_mm, gapColuna_mm, colunas }`
  - `paginarEtiquetas(total: number, colunas: number): number[][]`
  - `urlRastreio(lote: string, base?: string): string`

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/etiquetas.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODELOS, modelo, medidasImpressao, paginarEtiquetas, urlRastreio } from '../lib/etiquetas.js';

test('MODELOS: só os dois modelos desta fase', () => {
  assert.deepEqual(Object.keys(MODELOS).sort(), ['recebimento', 'validade-cozinha']);
});

test('modelo: devolve o modelo pedido', () => {
  assert.equal(modelo('recebimento').largura_mm, 50);
  assert.equal(modelo('recebimento').colunas, 2);
});

test('modelo: id desconhecido é erro, não silêncio', () => {
  assert.throws(() => modelo('despacho'), /despacho/);
});

test('medidasImpressao: a página é uma linha do rolo', () => {
  // Rolo de 108 mm, duas etiquetas de 50 mm, vão de 2,5 mm entre colunas:
  // sobra 5,5 mm, 2,75 mm em cada borda. A página tem a altura da etiqueta
  // mais o vão entre linhas.
  const m = medidasImpressao('recebimento');
  assert.equal(m.paginaLargura_mm, 108);
  assert.equal(m.paginaAltura_mm, 32);
  assert.equal(m.margemLateral_mm, 2.75);
  assert.equal(m.colunas, 2);
});

test('medidasImpressao: validade-cozinha mantém a geometria que já era impressa', () => {
  const m = medidasImpressao('validade-cozinha');
  assert.equal(m.paginaLargura_mm, 108);
  assert.equal(m.paginaAltura_mm, 32);
  assert.equal(m.margemLateral_mm, 2.75);
  assert.equal(m.etiquetaLargura_mm, 50);
  assert.equal(m.etiquetaAltura_mm, 30);
  assert.equal(m.gapColuna_mm, 2.5);
});

test('paginarEtiquetas: contagem par preenche as duas colunas', () => {
  assert.deepEqual(paginarEtiquetas(4, 2), [[0, 1], [2, 3]]);
});

test('paginarEtiquetas: contagem ímpar deixa a última coluna vazia', () => {
  assert.deepEqual(paginarEtiquetas(5, 2), [[0, 1], [2, 3], [4]]);
});

test('paginarEtiquetas: uma etiqueta é uma linha só', () => {
  assert.deepEqual(paginarEtiquetas(1, 2), [[0]]);
});

test('paginarEtiquetas: coluna única não agrupa', () => {
  assert.deepEqual(paginarEtiquetas(3, 1), [[0], [1], [2]]);
});

test('paginarEtiquetas: zero ou negativo não imprime nada', () => {
  assert.deepEqual(paginarEtiquetas(0, 2), []);
  assert.deepEqual(paginarEtiquetas(-3, 2), []);
});

test('urlRastreio: usa a base informada, sem barra dobrada', () => {
  assert.equal(urlRastreio('LT-260820-001', 'https://exemplo.test/'), 'https://exemplo.test/rastreio/LT-260820-001');
  assert.equal(urlRastreio('LT-260820-001', 'https://exemplo.test'), 'https://exemplo.test/rastreio/LT-260820-001');
});

test('urlRastreio: base padrão é a produção', () => {
  assert.equal(urlRastreio('LT-260820-001'), 'https://sistema-364.vercel.app/rastreio/LT-260820-001');
});

test('urlRastreio: lote com espaço ou barra é escapado', () => {
  assert.equal(urlRastreio('LT 260820/001', 'https://e.test'), 'https://e.test/rastreio/LT%20260820%2F001');
});
```

- [ ] **Step 2: Rodar o teste para ver falhar**

```bash
node --test tests/etiquetas.test.mjs
```

Esperado: FAIL — `Cannot find module '../lib/etiquetas.js'`.

- [ ] **Step 3: Implementar**

Criar `lib/etiquetas.js`. As constantes de geometria saem de `components/EtiquetaPrint.js`, onde hoje vivem soltas:

```js
// Modelos de etiqueta e a geometria do rolo.
//
// A impressora (Postek EM210) enxerga uma PÁGINA por linha do rolo: com rolo de
// duas colunas, cada página carrega duas etiquetas lado a lado. Por isso a
// paginação é do domínio, não da folha de estilo — e por isso ela é testada.
//
// Trocar de rolo ou de impressora se resolve mexendo só aqui.

export const MODELOS = {
  'validade-cozinha': {
    id: 'validade-cozinha',
    nome: 'Validade cozinha',
    largura_mm: 50, altura_mm: 30, colunas: 2,
    rolo_mm: 108, gap_coluna_mm: 2.5, gap_linha_mm: 2,
  },
  recebimento: {
    id: 'recebimento',
    nome: 'Recebimento',
    largura_mm: 50, altura_mm: 30, colunas: 2,
    rolo_mm: 108, gap_coluna_mm: 2.5, gap_linha_mm: 2,
  },
};

export const URL_RASTREIO_PADRAO = 'https://sistema-364.vercel.app';

export function modelo(id) {
  const m = MODELOS[id];
  if (!m) throw new Error(`Modelo de etiqueta desconhecido: ${id}`);
  return m;
}

export function medidasImpressao(id) {
  const m = modelo(id);
  const ocupado = m.largura_mm * m.colunas + m.gap_coluna_mm * (m.colunas - 1);
  return {
    paginaLargura_mm: m.rolo_mm,
    paginaAltura_mm: m.altura_mm + m.gap_linha_mm,
    // Sobra da largura dividida entre as duas bordas: o rolo é centralizado.
    margemLateral_mm: (m.rolo_mm - ocupado) / 2,
    etiquetaLargura_mm: m.largura_mm,
    etiquetaAltura_mm: m.altura_mm,
    gapColuna_mm: m.gap_coluna_mm,
    colunas: m.colunas,
  };
}

// Agrupa N etiquetas em linhas do rolo. A última linha sai incompleta quando a
// contagem não fecha as colunas — comportamento esperado, não erro.
export function paginarEtiquetas(total, colunas) {
  const n = Math.floor(Number(total) || 0);
  const c = Math.max(1, Math.floor(Number(colunas) || 1));
  const linhas = [];
  for (let i = 0; i < n; i += c) {
    linhas.push(Array.from({ length: Math.min(c, n - i) }, (_, j) => i + j));
  }
  return linhas;
}

// Conteúdo do QR: sempre a URL pública do lote. A página só existe a partir da
// Fase 5; a etiqueta é impressa uma vez e vive meses, então o conteúdo já nasce
// definitivo.
export function urlRastreio(lote, base = URL_RASTREIO_PADRAO) {
  return `${String(base).replace(/\/+$/, '')}/rastreio/${encodeURIComponent(lote)}`;
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
node --test tests/etiquetas.test.mjs
```

Esperado: PASS, 12 testes.

- [ ] **Step 5: Rodar a suíte inteira**

```bash
npm test
```

Esperado: nenhuma regressão.

- [ ] **Step 6: Commit**

```bash
git add lib/etiquetas.js tests/etiquetas.test.mjs
git commit -m "feat(etiquetas): modelos, geometria do rolo e paginação em colunas"
```

---

### Task 2: Migração 28 — `volumes`, campos de rótulo e auditoria de impressão

**Files:**
- Create: `supabase/atualizacao_28_lote_recebimento.sql`
- Create: `tests/migracao-28/fixture.sql`
- Create: `tests/migracao-28/cenarios.sql`
- Create: `tests/migracao-28/verificar.sh`
- Modify: `supabase/schema.sql`

**Interfaces:**
- Consumes: nada.
- Produces: `recebimento_itens.volumes`; `produtos.conservacao_texto`; `empresas.sim_numero`, `empresas.sim_municipio`; `etiqueta_impressoes.source_type` aceitando `recebimento_item`, `embalagem_item` e `expedicao_caixa`; RPC `registrar_impressao` aceitando `p_source_type = 'recebimento_item'`. As tasks 5 e 6 gravam `volumes` e chamam a RPC.

- [ ] **Step 1: Escrever o fixture**

Criar `tests/migracao-28/fixture.sql`. Espelha a forma de **produção** (que diverge do `schema.sql` do repositório — a divergência está registrada no design), com o mínimo que a migração toca:

```sql
-- Esqueleto mínimo para exercitar a atualização 28 num Postgres local.
create schema if not exists auth;
create or replace function auth.uid() returns uuid
  language sql stable as $$ select nullif(current_setting('req.uid', true), '')::uuid $$;

create table empresas (id uuid primary key, nome text);
create table fornecedores (id uuid primary key, empresa_id uuid references empresas(id), nome text);
create table materias_primas (id uuid primary key, empresa_id uuid references empresas(id), nome text);
create table produtos (id uuid primary key, empresa_id uuid references empresas(id), nome text);
create table funcionarios (id uuid primary key, empresa_id uuid references empresas(id), nome text);
create table producoes (id uuid primary key, empresa_id uuid references empresas(id));

create table recebimentos (
  id uuid primary key default gen_random_uuid(),
  data date not null default current_date,
  fornecedor_id uuid references fornecedores(id),
  nota_fiscal text,
  empresa_id uuid references empresas(id)
);

create table recebimento_itens (
  id uuid primary key default gen_random_uuid(),
  recebimento_id uuid not null references recebimentos(id) on delete cascade,
  materia_prima_id uuid not null references materias_primas(id),
  lote text not null,
  quantidade numeric(12,4) not null,
  custo_unitario numeric(12,2) not null,
  empresa_id uuid not null references empresas(id)
);

create table etiqueta_impressoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  source_type text not null check (source_type in ('producao','producao_interna')),
  source_id uuid not null,
  tipo text not null check (tipo in ('original','reimpressao')),
  quantidade int not null check (quantidade > 0),
  modelo text not null default 'validade-cozinha',
  impressora text,
  motivo text,
  usuario_id uuid,
  usuario_nome text,
  created_at timestamptz not null default now()
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  usuario_id uuid, acao text not null, recurso text, recurso_id uuid,
  valores_anteriores jsonb, valores_novos jsonb, justificativa text,
  created_at timestamptz not null default now()
);

-- Dublês das funções de permissão que a RPC usa. Os cenários controlam o
-- retorno por `req.*`, sem precisar montar RLS.
create or replace function public.empresas_permitidas() returns setof uuid
  language sql stable as $$ select id from empresas
    where coalesce(current_setting('req.empresa_bloqueada', true), '') <> id::text $$;
create or replace function public.tem_permissao(m text) returns boolean
  language sql stable as $$
  select coalesce(current_setting('req.permissoes', true), 'recebimentos,producoes') like '%' || m || '%' $$;
create or replace function public.fn_nome_usuario() returns text
  language sql stable as $$ select 'Operador de Teste' $$;
create or replace function public.fn_registrar_auditoria(
  p_recurso text, p_recurso_id uuid, p_acao text, p_empresa uuid,
  p_anteriores jsonb, p_novos jsonb, p_justificativa text)
  returns void language sql as $$
  insert into audit_logs (empresa_id, usuario_id, acao, recurso, recurso_id,
                          valores_anteriores, valores_novos, justificativa)
  values (p_empresa, auth.uid(), p_acao, p_recurso, p_recurso_id, p_anteriores, p_novos, p_justificativa) $$;

-- A RPC anterior à 28, para provar que a migração a substitui.
create or replace function public.registrar_impressao(
  p_source_type text, p_source_id uuid, p_tipo text, p_quantidade int,
  p_modelo text default 'validade-cozinha', p_impressora text default null, p_motivo text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  raise exception 'versão anterior da RPC: source_type inválido: %', p_source_type;
end $$;

insert into empresas (id, nome) values ('11111111-1111-1111-1111-111111111111', 'Food Services');
insert into fornecedores (id, empresa_id, nome) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Vale Grande');
insert into materias_primas (id, empresa_id, nome) values ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'Costela Bovina');
insert into produtos (id, empresa_id, nome) values ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'Costela Defumada 500g');
insert into recebimentos (id, empresa_id, fornecedor_id, nota_fiscal) values ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '61.379.327');
insert into recebimento_itens (id, recebimento_id, materia_prima_id, lote, quantidade, custo_unitario, empresa_id)
  values ('66666666-6666-6666-6666-666666666666', '55555555-5555-5555-5555-555555555555', '33333333-3333-3333-3333-333333333333', 'LT-260821-001', 180, 21.90, '11111111-1111-1111-1111-111111111111');
```

- [ ] **Step 2: Escrever os cenários**

Criar `tests/migracao-28/cenarios.sql`:

```sql
-- Exercita a atualização 28. Roda depois do fixture e da migração.
\set QUIET on
set client_min_messages = warning;

-- Cenário 1: as colunas novas existem e aceitam os valores esperados.
do $$
begin
  update recebimento_itens set volumes = 20 where id = '66666666-6666-6666-6666-666666666666';
  update produtos set conservacao_texto = 'MANTER CONGELADO A -12 °C' where id = '44444444-4444-4444-4444-444444444444';
  update empresas set sim_numero = '030', sim_municipio = 'Ji-Paraná' where id = '11111111-1111-1111-1111-111111111111';
  raise notice 'OK 1: colunas novas gravam';
end $$;

-- Cenário 2: volumes zero ou negativo é recusado; nulo é permitido (item antigo).
do $$
begin
  begin
    update recebimento_itens set volumes = 0 where id = '66666666-6666-6666-6666-666666666666';
    raise exception 'FALHA 2a: volumes zero aceito';
  exception when check_violation then null; end;
  begin
    update recebimento_itens set volumes = -1 where id = '66666666-6666-6666-6666-666666666666';
    raise exception 'FALHA 2b: volumes negativo aceito';
  exception when check_violation then null; end;
  update recebimento_itens set volumes = null where id = '66666666-6666-6666-6666-666666666666';
  update recebimento_itens set volumes = 20 where id = '66666666-6666-6666-6666-666666666666';
  raise notice 'OK 2: volumes validado';
end $$;

-- Cenário 3: o check de source_type aceita os três tipos novos e recusa lixo.
do $$
begin
  insert into etiqueta_impressoes (empresa_id, source_type, source_id, tipo, quantidade, modelo)
    values ('11111111-1111-1111-1111-111111111111', 'recebimento_item', '66666666-6666-6666-6666-666666666666', 'original', 20, 'recebimento');
  insert into etiqueta_impressoes (empresa_id, source_type, source_id, tipo, quantidade, modelo)
    values ('11111111-1111-1111-1111-111111111111', 'embalagem_item', gen_random_uuid(), 'original', 1, 'producao-lote');
  insert into etiqueta_impressoes (empresa_id, source_type, source_id, tipo, quantidade, modelo)
    values ('11111111-1111-1111-1111-111111111111', 'expedicao_caixa', gen_random_uuid(), 'original', 1, 'despacho');
  begin
    insert into etiqueta_impressoes (empresa_id, source_type, source_id, tipo, quantidade, modelo)
      values ('11111111-1111-1111-1111-111111111111', 'inventado', gen_random_uuid(), 'original', 1, 'x');
    raise exception 'FALHA 3: source_type inventado aceito';
  exception when check_violation then null; end;
  raise notice 'OK 3: source_type ampliado';
end $$;

-- Cenário 4: a RPC registra impressão de item de recebimento.
do $$
declare v_qtd int;
begin
  perform set_config('req.uid', '77777777-7777-7777-7777-777777777777', true);
  perform public.registrar_impressao('recebimento_item', '66666666-6666-6666-6666-666666666666',
                                     'original', 20, 'recebimento', 'EM210', null);
  select quantidade into v_qtd from etiqueta_impressoes
    where source_type = 'recebimento_item' and tipo = 'original' and impressora = 'EM210';
  if v_qtd is distinct from 20 then raise exception 'FALHA 4a: impressão não registrada'; end if;
  if not exists (select 1 from audit_logs where acao = 'IMPRESSAO' and recurso = 'etiqueta_impressoes') then
    raise exception 'FALHA 4b: auditoria não registrada';
  end if;
  raise notice 'OK 4: RPC aceita recebimento_item';
end $$;

-- Cenário 5: reimpressão sem motivo é recusada; com motivo passa e fica auditada.
do $$
begin
  begin
    perform public.registrar_impressao('recebimento_item', '66666666-6666-6666-6666-666666666666',
                                       'reimpressao', 1, 'recebimento', null, '   ');
    raise exception 'FALHA 5a: reimpressão sem motivo aceita';
  exception when others then
    if sqlerrm like 'FALHA%' then raise; end if;
  end;
  perform public.registrar_impressao('recebimento_item', '66666666-6666-6666-6666-666666666666',
                                     'reimpressao', 1, 'recebimento', null, 'Etiqueta danificada');
  if not exists (select 1 from audit_logs where acao = 'REIMPRESSAO' and justificativa = 'Etiqueta danificada') then
    raise exception 'FALHA 5b: motivo não auditado';
  end if;
  raise notice 'OK 5: reimpressão exige motivo';
end $$;

-- Cenário 6: item inexistente e empresa fora do alcance são recusados.
do $$
begin
  begin
    perform public.registrar_impressao('recebimento_item', gen_random_uuid(), 'original', 1, 'recebimento', null, null);
    raise exception 'FALHA 6a: item inexistente aceito';
  exception when others then
    if sqlerrm like 'FALHA%' then raise; end if;
  end;

  perform set_config('req.empresa_bloqueada', '11111111-1111-1111-1111-111111111111', true);
  begin
    perform public.registrar_impressao('recebimento_item', '66666666-6666-6666-6666-666666666666', 'original', 1, 'recebimento', null, null);
    raise exception 'FALHA 6b: empresa fora do alcance aceita';
  exception when others then
    if sqlerrm like 'FALHA%' then raise; end if;
  end;
  perform set_config('req.empresa_bloqueada', '', true);
  raise notice 'OK 6: empresa e existência validadas';
end $$;

-- Cenário 7: sem o módulo `recebimentos` a impressão é recusada.
do $$
begin
  perform set_config('req.permissoes', 'producoes', true);
  begin
    perform public.registrar_impressao('recebimento_item', '66666666-6666-6666-6666-666666666666', 'original', 1, 'recebimento', null, null);
    raise exception 'FALHA 7: imprimiu sem o módulo recebimentos';
  exception when others then
    if sqlerrm like 'FALHA%' then raise; end if;
  end;
  perform set_config('req.permissoes', 'recebimentos,producoes', true);
  raise notice 'OK 7: permissão de módulo exigida';
end $$;

-- Cenário 8: o caminho antigo (produção) continua funcionando.
do $$
begin
  insert into producoes (id, empresa_id) values ('88888888-8888-8888-8888-888888888888', '11111111-1111-1111-1111-111111111111');
  perform public.registrar_impressao('producao', '88888888-8888-8888-8888-888888888888', 'original', 2, 'validade-cozinha', null, null);
  if not exists (select 1 from etiqueta_impressoes where source_type = 'producao' and quantidade = 2) then
    raise exception 'FALHA 8: caminho antigo quebrou';
  end if;
  raise notice 'OK 8: produção continua imprimindo';
end $$;
```

- [ ] **Step 3: Escrever o runner e ver falhar**

Criar `tests/migracao-28/verificar.sh`, no padrão de `tests/migracao-27/verificar.sh`:

```bash
#!/usr/bin/env bash
# Exercita a atualização 28 (lote no recebimento + etiqueta) num Postgres local
# descartável. Não toca em produção. Requer psql no PATH e um servidor local.
#
# Uso: tests/migracao-28/verificar.sh
set -euo pipefail

export PGOPTIONS='-c client_min_messages=warning'

AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
BANCO="${BANCO_TESTE_LOTE:-lote_test_364}"

command -v psql >/dev/null || { echo "psql não encontrado no PATH"; exit 1; }
pg_isready -q || { echo "nenhum Postgres local aceitando conexões"; exit 1; }

limpar() { dropdb --if-exists "$BANCO" >/dev/null 2>&1 || true; }
trap limpar EXIT

limpar
createdb "$BANCO"

psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/fixture.sql"
# A migração sob teste é o arquivo real que vai para produção.
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$RAIZ/supabase/atualizacao_28_lote_recebimento.sql"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/cenarios.sql"

# O rollback vive comentado no fim da migração; extrai e aplica para provar que
# é SQL válido e que desfaz o que a migração criou.
sed -n '/^-- begin;/,/^-- commit;/p' "$RAIZ/supabase/atualizacao_28_lote_recebimento.sql" | sed 's/^-- \{0,1\}//' > "$AQUI/.rollback.sql"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/.rollback.sql"
rm -f "$AQUI/.rollback.sql"

sobrou=$(psql -tAq -d "$BANCO" -c "select count(*) from information_schema.columns where table_name = 'recebimento_itens' and column_name = 'volumes';")
[ "$sobrou" = "0" ] || { echo "rollback não removeu a coluna volumes"; exit 1; }
echo "OK: rollback desfaz a migração"
```

```bash
chmod +x tests/migracao-28/verificar.sh && tests/migracao-28/verificar.sh
```

Esperado: FAIL — `supabase/atualizacao_28_lote_recebimento.sql: No such file or directory`.

- [ ] **Step 4: Escrever a migração**

Criar `supabase/atualizacao_28_lote_recebimento.sql`:

```sql
-- Fase 1 do controle de lote: o volume recebido ganha etiqueta impressa.
--
-- O lote nasce em `recebimento_itens.lote` (LT-AAMMDD-###) e, até aqui, morria
-- ali. Esta migração dá ao item o número de volumes que chegaram — que define
-- quantas etiquetas imprimir — e ensina a auditoria de impressão, criada na
-- atualização 17, a registrar etiqueta de recebimento.
--
-- Também entram os dois campos que a etiqueta de despacho vai imprimir na Fase
-- 4 e que são cadastro, não processo: o dizer de conservação por produto e o
-- registro no Serviço de Inspeção Municipal por empresa. Ficam aqui porque são
-- `alter table` de uma linha e porque quem cadastra produto já vai preenchê-los.
--
-- Idempotente: `add column if not exists`, `drop constraint if exists` e
-- `create or replace` em tudo. Não altera dado existente: `volumes` nasce nulo
-- nos itens já recebidos, e nulo significa "não sei quantos volumes eram".
--
-- Antes de aplicar, confira que a atualização 17 está aplicada (ela cria
-- `etiqueta_impressoes` e `registrar_impressao`, que esta migração altera):
--   select count(*) from information_schema.tables where table_name = 'etiqueta_impressoes';
-- Precisa dar 1.

begin;

-- ---------- RECEBIMENTO: quantos volumes chegaram ----------

alter table public.recebimento_itens
  add column if not exists volumes int;

alter table public.recebimento_itens drop constraint if exists recebimento_itens_volumes_positivo;
alter table public.recebimento_itens add constraint recebimento_itens_volumes_positivo
  check (volumes is null or volumes > 0);

comment on column public.recebimento_itens.volumes is
  'Quantas caixas/volumes deste lote chegaram. Define quantas etiquetas imprimir. Nulo = item anterior à atualização 28.';

-- ---------- CADASTRO: dizeres do rótulo ----------

alter table public.produtos
  add column if not exists conservacao_texto text;
comment on column public.produtos.conservacao_texto is
  'Dizer de conservação impresso na etiqueta de despacho, igual ao rótulo da gráfica. Ex.: MANTER CONGELADO A -12 °C.';

alter table public.empresas
  add column if not exists sim_numero text,
  add column if not exists sim_municipio text;
comment on column public.empresas.sim_numero is
  'Número do registro no Serviço de Inspeção Municipal, impresso no selo da etiqueta de despacho.';

-- ---------- AUDITORIA DE IMPRESSÃO: novos tipos de origem ----------
-- `embalagem_item` e `expedicao_caixa` entram junto porque o check é um só e
-- ampliá-lo agora poupa uma migração em cada fase seguinte. Nada os usa ainda.

alter table public.etiqueta_impressoes drop constraint if exists etiqueta_impressoes_source_type_check;
alter table public.etiqueta_impressoes add constraint etiqueta_impressoes_source_type_check
  check (source_type in ('producao', 'producao_interna', 'recebimento_item', 'embalagem_item', 'expedicao_caixa'));

create or replace function public.registrar_impressao(
  p_source_type text, p_source_id uuid, p_tipo text, p_quantidade int,
  p_modelo text default 'validade-cozinha', p_impressora text default null, p_motivo text default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_empresa uuid;
  v_status text;
  v_codigo text;
  v_modulo text;
begin
  if p_source_type = 'producao_interna' then
    v_modulo := 'producoes';
    select empresa_id, status, codigo into v_empresa, v_status, v_codigo
      from producoes_internas where id = p_source_id;
    if not found then raise exception 'Produção interna não encontrada.'; end if;
    if v_status <> 'finalizada' then
      raise exception 'Etiquetas só podem ser impressas para produção finalizada (% está "%").', v_codigo, v_status;
    end if;
  elsif p_source_type = 'producao' then
    v_modulo := 'producoes';
    select empresa_id into v_empresa from producoes where id = p_source_id;
    if not found then raise exception 'Produção não encontrada.'; end if;
  elsif p_source_type = 'recebimento_item' then
    -- Fase 1 do controle de lote: a etiqueta identifica o volume recebido.
    v_modulo := 'recebimentos';
    select empresa_id, lote into v_empresa, v_codigo
      from recebimento_itens where id = p_source_id;
    if not found then raise exception 'Item de recebimento não encontrado.'; end if;
  else
    raise exception 'source_type inválido: %', p_source_type;
  end if;

  if v_empresa not in (select public.empresas_permitidas()) then
    raise exception 'Sem acesso à empresa desta impressão.';
  end if;
  if not public.tem_permissao(v_modulo) then
    raise exception 'Sem permissão para imprimir etiquetas de %.', v_modulo;
  end if;
  if p_tipo = 'reimpressao' and (p_motivo is null or btrim(p_motivo) = '') then
    raise exception 'Informe o motivo da reimpressão.';
  end if;

  insert into etiqueta_impressoes (empresa_id, source_type, source_id, tipo, quantidade, modelo, impressora, motivo, usuario_id, usuario_nome)
  values (v_empresa, p_source_type, p_source_id, p_tipo, p_quantidade, p_modelo, p_impressora, p_motivo, auth.uid(), public.fn_nome_usuario());

  perform public.fn_registrar_auditoria('etiqueta_impressoes', p_source_id,
                                        case when p_tipo = 'reimpressao' then 'REIMPRESSAO' else 'IMPRESSAO' end,
                                        v_empresa, null,
                                        jsonb_build_object('source_type', p_source_type, 'quantidade', p_quantidade,
                                                           'modelo', p_modelo, 'impressora', p_impressora),
                                        p_motivo);
end $$;

commit;

-- ---------- ROLLBACK ----------
-- Devolve o check ao estado da atualização 17 e derruba as colunas novas.
-- A RPC volta ao original reaplicando `atualizacao_17_producao_interna.sql`,
-- que é idempotente — não vale duplicar cem linhas de SQL aqui.
--
-- begin;
--
-- delete from etiqueta_impressoes where source_type in ('recebimento_item','embalagem_item','expedicao_caixa');
--
-- alter table public.etiqueta_impressoes drop constraint if exists etiqueta_impressoes_source_type_check;
-- alter table public.etiqueta_impressoes add constraint etiqueta_impressoes_source_type_check
--   check (source_type in ('producao', 'producao_interna'));
--
-- alter table public.recebimento_itens drop constraint if exists recebimento_itens_volumes_positivo;
-- alter table public.recebimento_itens drop column if exists volumes;
-- alter table public.produtos drop column if exists conservacao_texto;
-- alter table public.empresas drop column if exists sim_numero;
-- alter table public.empresas drop column if exists sim_municipio;
--
-- commit;
```

- [ ] **Step 5: Rodar os cenários e ver passar**

```bash
tests/migracao-28/verificar.sh
```

Esperado: sai limpo, terminando em `OK: rollback desfaz a migração`. Os `OK n:` ficam suprimidos por `client_min_messages=warning` — o portão é o exit code, como nas migrações anteriores. Para vê-los enquanto depura:

```bash
psql -d lote_test_364 -c "set client_min_messages = notice" -f tests/migracao-28/cenarios.sql
```

- [ ] **Step 6: Refletir em `supabase/schema.sql`**

Acrescentar `volumes int` em `recebimento_itens`, `conservacao_texto text` em `produtos` e `sim_numero text` / `sim_municipio text` em `empresas`, com o mesmo comentário curto da migração.

- [ ] **Step 7: Commit**

```bash
git add supabase/atualizacao_28_lote_recebimento.sql supabase/schema.sql tests/migracao-28
git commit -m "feat(lote): migração 28 com volumes no recebimento e auditoria de etiqueta"
```

---

### Task 3: QR em SVG — dependência e wrapper

**Files:**
- Modify: `package.json` (dependência `qrcode`)
- Create: `lib/qr.js`
- Test: `tests/qr.test.mjs`

**Interfaces:**
- Consumes: `urlRastreio` de `lib/etiquetas.js` (Task 1) — só nos testes desta task.
- Produces: `qrSvg(texto: string, tamanhoMm?: number): Promise<string>` — devolve a marcação SVG pronta para injeção, sem margem e com o tamanho pedido em milímetros.

Por que assíncrono e resolvido antes: `window.print()` é síncrono e a impressão dispara ~150 ms depois de renderizar. Gerar o QR dentro do componente criaria corrida entre a promessa e a impressão, e uma etiqueta sairia sem QR de vez em quando. O SVG é gerado **antes**, e viaja pronto nos dados da etiqueta.

- [ ] **Step 1: Instalar a dependência**

```bash
npm install qrcode@^1.5.4
```

Esperado: `package.json` ganha `"qrcode": "^1.5.4"` em `dependencies`, e `package-lock.json` é atualizado.

- [ ] **Step 2: Escrever o teste que falha**

Criar `tests/qr.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qrSvg } from '../lib/qr.js';
import { urlRastreio } from '../lib/etiquetas.js';

test('qrSvg: devolve um SVG com o tamanho pedido em milímetros', async () => {
  const svg = await qrSvg(urlRastreio('LT-260821-001'), 12);
  assert.match(svg, /^<svg /);
  assert.match(svg, /width="12mm"/);
  assert.match(svg, /height="12mm"/);
  assert.match(svg, /<\/svg>$/);
});

test('qrSvg: sem margem — a etiqueta é pequena e o quiet zone come área útil', async () => {
  const svg = await qrSvg('https://exemplo.test/rastreio/LT-1', 10);
  const vb = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  assert.ok(vb, 'o SVG precisa ter viewBox');
  assert.equal(vb[1], vb[2]);
});

test('qrSvg: conteúdos diferentes geram desenhos diferentes', async () => {
  const a = await qrSvg('https://exemplo.test/rastreio/LT-1', 10);
  const b = await qrSvg('https://exemplo.test/rastreio/LT-2', 10);
  assert.notEqual(a, b);
});

test('qrSvg: texto vazio é erro — etiqueta com QR ilegível é pior que sem QR', async () => {
  await assert.rejects(() => qrSvg('', 10), /vazio/);
});
```

- [ ] **Step 3: Rodar e ver falhar**

```bash
node --test tests/qr.test.mjs
```

Esperado: FAIL — `Cannot find module '../lib/qr.js'`.

- [ ] **Step 4: Implementar**

Criar `lib/qr.js`:

```js
// Geração do QR das etiquetas. Único ponto do sistema que fala com o pacote
// `qrcode`.
//
// Devolve SVG (não PNG) porque a etiqueta é impressa em 203 dpi numa área de
// poucos milímetros: vetor sai nítido em qualquer resolução, e não depende de
// canvas nem de rede. O QR é resolvido ANTES da impressão — `window.print()` é
// síncrono e não espera promessa nenhuma.
import QRCode from 'qrcode';

export async function qrSvg(texto, tamanhoMm = 12) {
  if (!texto || !String(texto).trim()) {
    throw new Error('QR sem conteúdo: texto vazio.');
  }
  const svg = await QRCode.toString(String(texto), {
    type: 'svg',
    // Sem quiet zone: a margem padrão de 4 módulos comeria metade da área útil
    // numa etiqueta de 50×30 mm. O espaço em branco ao redor vem do layout.
    margin: 0,
    // M tolera ~15% de dano — suficiente para etiqueta em câmara fria, sem
    // inflar a matriz como o nível H faria.
    errorCorrectionLevel: 'M',
  });
  return svg
    .replace(/width="[^"]*"/, `width="${tamanhoMm}mm"`)
    .replace(/height="[^"]*"/, `height="${tamanhoMm}mm"`)
    .trim();
}
```

- [ ] **Step 5: Rodar e ver passar**

```bash
node --test tests/qr.test.mjs
```

Esperado: PASS, 4 testes. Se o SVG do pacote vier sem `viewBox` ou com os atributos em ordem diferente, ajuste **o `replace`**, não o teste — o teste descreve o que a etiqueta precisa.

- [ ] **Step 6: Verificar tudo**

```bash
npm run verify
```

Esperado: suíte inteira passando e build limpo com a dependência nova.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json lib/qr.js tests/qr.test.mjs
git commit -m "feat(etiquetas): QR em SVG gerado antes da impressão"
```

---

### Task 4: `EtiquetaPrint` dirigido por modelo, com o layout de recebimento

**Files:**
- Modify: `components/EtiquetaPrint.js`

**Interfaces:**
- Consumes: `medidasImpressao`, `paginarEtiquetas` (Task 1); o SVG pronto de `qrSvg` (Task 3), recebido nos dados.
- Produces: `EtiquetaPrint` continua `export default` e `imprimirEtiquetas(setEtiqueta, dados)` continua exportada com a mesma assinatura. `dados` ganha:
  - `modelo: 'validade-cozinha' | 'recebimento'` (padrão `'validade-cozinha'`)
  - para `recebimento`: `{ lote, materiaPrima, recebidoEm, fornecedor, notaFiscal, qrSvg }`
  - `copias` continua governando quantas etiquetas saem.

As telas de produção usam este componente hoje e **não podem mudar de comportamento**: sem `modelo`, o layout impresso é o mesmo de antes, com a mesma geometria.

- [ ] **Step 1: Reescrever o componente**

Substituir `components/EtiquetaPrint.js`. As constantes de geometria saem daqui (foram para `lib/etiquetas.js` na Task 1) e o corpo passa a escolher o layout pelo modelo:

```jsx
'use client';
import { fmtDateTime, conservacaoLabel } from '../lib/producao';
import { fmtDate } from '../lib/format';
import { medidasImpressao, paginarEtiquetas } from '../lib/etiquetas';

// Etiquetas em rolo, impressas por `window.print()` com medidas em milímetro
// exato. Cada página de impressão é uma LINHA do rolo: com duas colunas, duas
// etiquetas lado a lado. A geometria mora em lib/etiquetas.js.
//
// Dois modelos hoje:
//   validade-cozinha — produção completa e interna (comportamento original)
//   recebimento      — volume de matéria-prima, com lote e QR
//
// Os dados vêm SEMPRE do registro de origem — nunca redigitados. O QR chega
// pronto em `qrSvg`, gerado antes da impressão.
export default function EtiquetaPrint({ etiqueta }) {
  if (!etiqueta) return null;

  const modeloId = etiqueta.modelo || 'validade-cozinha';
  const m = medidasImpressao(modeloId);
  const copias = Math.max(1, Number(etiqueta.copias) || 1);
  const linhas = paginarEtiquetas(copias, m.colunas);

  return (
    <div className="print-area etiquetas-print">
      <style>{`
        @media print {
          @page { size: ${m.paginaLargura_mm}mm ${m.paginaAltura_mm}mm; margin: 0; }
          .etiquetas-print .et-fileira { page-break-after: always; }
          .etiquetas-print .et-fileira:last-child { page-break-after: auto; }
        }
        .etiquetas-print .et-fileira {
          width: ${m.paginaLargura_mm}mm; height: ${m.etiquetaAltura_mm}mm; box-sizing: border-box;
          padding: 0 ${m.margemLateral_mm}mm; display: flex; gap: ${m.gapColuna_mm}mm;
        }
        .etiquetas-print .etiqueta {
          width: ${m.etiquetaLargura_mm}mm; height: ${m.etiquetaAltura_mm}mm;
          box-sizing: border-box; overflow: hidden;
          padding: 1.5mm 2mm; color: #000; background: #fff;
          font-family: Arial, Helvetica, sans-serif; line-height: 1.15;
          display: flex; flex-direction: column;
        }
        .etiquetas-print .et-empresa { font-size: 6pt; text-transform: uppercase; letter-spacing: .3px; white-space: nowrap; overflow: hidden; }
        .etiquetas-print .et-produto { font-size: 9pt; font-weight: 700; text-transform: uppercase; margin: .5mm 0; }
        .etiquetas-print .et-linha { font-size: 6.5pt; }
        .etiquetas-print .et-linha b { font-size: 7pt; }
        .etiquetas-print .et-conservacao { font-size: 7pt; font-weight: 700; text-transform: uppercase; margin-top: .3mm; }
        .etiquetas-print .et-codigo { font-family: 'Courier New', monospace; font-size: 6.5pt; margin-top: auto; }
        /* recebimento: coluna de texto à esquerda, QR fixo à direita */
        .etiquetas-print .et-receb { display: flex; gap: 1.5mm; height: 100%; width: 100%; }
        .etiquetas-print .et-receb-texto { flex: 1; min-width: 0; display: flex; flex-direction: column; }
        .etiquetas-print .et-receb-qr { width: 14mm; display: flex; align-items: center; justify-content: center; }
        .etiquetas-print .et-receb-qr svg { display: block; }
        .etiquetas-print .et-lote { font-family: 'Courier New', monospace; font-size: 8pt; font-weight: 700; }
        .etiquetas-print .et-mp { font-size: 8pt; font-weight: 700; text-transform: uppercase; margin: .3mm 0; overflow: hidden; }
        .etiquetas-print .et-rodape { margin-top: auto; display: flex; justify-content: space-between; gap: 1mm; font-size: 6.5pt; }
        .etiquetas-print .et-vol { font-weight: 700; white-space: nowrap; }
      `}</style>
      {linhas.map((linha, i) => (
        <div className="et-fileira" key={i}>
          {linha.map(n => (
            <div className="etiqueta" key={n}>
              {modeloId === 'recebimento'
                ? <Recebimento etiqueta={etiqueta} indice={n} copias={copias} />
                : <ValidadeCozinha etiqueta={etiqueta} />}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ValidadeCozinha({ etiqueta }) {
  return (
    <>
      <div className="et-empresa">{etiqueta.empresa}{etiqueta.unidade ? ` · ${etiqueta.unidade}` : ''}</div>
      <div className="et-produto">{etiqueta.produto}</div>
      <div className="et-linha">Produção: <b>{fmtDateTime(etiqueta.producao)}</b></div>
      <div className="et-linha">Validade: <b>{fmtDateTime(etiqueta.validade)}</b></div>
      {etiqueta.conservacao && <div className="et-conservacao">{conservacaoLabel(etiqueta.conservacao)}</div>}
      <div className="et-linha">Resp.: {etiqueta.responsavel || '—'}</div>
      <div className="et-codigo">
        {etiqueta.codigo}{etiqueta.lote ? ` · Lote ${etiqueta.lote}` : ''}
      </div>
    </>
  );
}

// Uma etiqueta por volume: o número do volume muda a cada cópia, o resto não.
function Recebimento({ etiqueta, indice, copias }) {
  return (
    <div className="et-receb">
      <div className="et-receb-texto">
        <div className="et-lote">LOTE {etiqueta.lote}</div>
        <div className="et-mp">{etiqueta.materiaPrima}</div>
        <div className="et-linha">Receb. {fmtDate(etiqueta.recebidoEm)}</div>
        <div className="et-linha">Forn. {etiqueta.fornecedor || '—'}</div>
        <div className="et-rodape">
          <span>NF {etiqueta.notaFiscal || '—'}</span>
          <span className="et-vol">vol. {indice + 1}/{copias}</span>
        </div>
      </div>
      <div className="et-receb-qr" dangerouslySetInnerHTML={{ __html: etiqueta.qrSvg || '' }} />
    </div>
  );
}

// Renderiza as etiquetas e abre a impressão. A falha ou o cancelamento da
// impressão física não desfaz nada — o registro e a impressão são independentes.
export function imprimirEtiquetas(setEtiqueta, dados) {
  setEtiqueta(dados);
  setTimeout(() => window.print(), 150);
}
```

> `dangerouslySetInnerHTML` aqui é seguro e necessário: o conteúdo é SVG gerado localmente por `lib/qr.js` a partir de uma URL montada pelo próprio sistema, nunca texto vindo do usuário ou do banco.

- [ ] **Step 2: Verificar**

```bash
npm run verify
```

Esperado: suíte passando (ela não cobre componentes) e build limpo. O build acusa se algum import ficou para trás.

- [ ] **Step 3: Conferir que a produção não mudou**

Localizar as chamadas de `imprimirEtiquetas` e de `EtiquetaPrint` em `app/producoes/` e confirmar que nenhuma passa `modelo` — todas caem no padrão `validade-cozinha`, com a mesma geometria de antes. Registrar no relatório os arquivos conferidos.

- [ ] **Step 4: Commit**

```bash
git add components/EtiquetaPrint.js
git commit -m "feat(etiquetas): EtiquetaPrint dirigido por modelo e layout de recebimento"
```

---

### Task 5: Campo `volumes` no item de recebimento

**Files:**
- Modify: `app/recebimentos/page.js`

**Interfaces:**
- Consumes: coluna `recebimento_itens.volumes` (Task 2).
- Produces: itens de recebimento gravados com `volumes`. A Task 6 usa esse número como quantidade de etiquetas.

- [ ] **Step 1: Acrescentar o campo ao formulário do item**

Em `app/recebimentos/page.js`:

1. No estado inicial do item (a constante que já tem `validade`, `numero_lote_fornecedor`, `condicao_embalagem`, `status_qualidade`), acrescentar `volumes: ''`.
2. No formulário do item, ao lado do campo de quantidade, acrescentar:

```jsx
<div>
  <label>Volumes (caixas)</label>
  <input
    type="number" min="1" step="1" value={itemForm.volumes}
    placeholder="quantas caixas chegaram"
    onChange={e => setItemForm({ ...itemForm, volumes: e.target.value })}
  />
</div>
```

3. Na montagem do item gravado (onde `lote: lotes[i]` é atribuído), acrescentar:

```js
volumes: it.volumes ? Number(it.volumes) : null,
```

4. Na tabela de itens já lançados (onde `it.lote` é exibido), acrescentar uma coluna **Volumes** mostrando `it.volumes ?? '—'`, com o cabeçalho correspondente.

O campo é opcional: nota antiga e item sem contagem continuam gravando `null`, e o banco aceita (`volumes is null or volumes > 0`).

- [ ] **Step 2: Verificar**

```bash
npm run verify
```

Esperado: testes passando e build limpo.

- [ ] **Step 3: Commit**

```bash
git add app/recebimentos/page.js
git commit -m "feat(recebimentos): número de volumes por item"
```

---

### Task 6: Impressão e reimpressão das etiquetas do volume

**Files:**
- Modify: `components/ModalEtiquetas.js`
- Modify: `app/recebimentos/page.js`

**Interfaces:**
- Consumes: `qrSvg` (Task 3), `urlRastreio` (Task 1), `EtiquetaPrint` com modelo `recebimento` (Task 4), RPC `registrar_impressao` com `source_type = 'recebimento_item'` (Task 2), coluna `volumes` (Task 5).
- Produces: nada consumido por tasks seguintes. Última task da fase.

- [ ] **Step 1: Generalizar `ModalEtiquetas`**

`components/ModalEtiquetas.js` hoje assume produção: monta `dadosEtiqueta` com produto, validade e conservação, e sugere `copias` a partir de `producao.recipientes`. Generalizar sem quebrar as telas de produção que já o usam:

1. Acrescentar as props `modelo = 'validade-cozinha'`, `dados` (os dados já montados da etiqueta, opcional) e `titulo` (opcional).
2. Quando `dados` vier preenchido, usar `dados` no lugar do `dadosEtiqueta` montado internamente, e `dados.copias` como sugestão inicial de cópias.
3. Passar `modelo` adiante nos dados entregues a `imprimirEtiquetas` e em `p_modelo` da RPC.
4. Manter tudo o que já existe: seleção de impressora, motivo obrigatório na reimpressão (`MOTIVOS_REIMPRESSAO`), botão "Agora não" que não desfaz nada, e a chamada a `registrar_impressao` **antes** de imprimir — se a auditoria falhar, não se imprime.

O resumo no topo do modal também passa a depender do modelo: para `recebimento`, mostrar lote, matéria-prima, fornecedor e nota fiscal em vez de produto, validade e recipientes.

- [ ] **Step 2: Chamar da tela de recebimentos**

Em `app/recebimentos/page.js`:

1. Importar `EtiquetaPrint`, `ModalEtiquetas`, `qrSvg` e `urlRastreio`; criar os estados `const [etiqueta, setEtiqueta] = useState(null);` e `const [etiquetaItem, setEtiquetaItem] = useState(null);`.
2. Renderizar `<EtiquetaPrint etiqueta={etiqueta} />` junto do `<FichaPrint …>` que já existe no componente de topo.
3. Na tabela de itens, acrescentar por linha os botões **Imprimir etiquetas** e **Reimprimir**, desabilitados quando `!it.volumes`, com `title` explicando: `Informe os volumes do item para imprimir as etiquetas`.
4. Ao clicar, montar os dados — o QR é resolvido **antes** de abrir o modal:

```js
async function abrirEtiquetas(item, grupo, tipo = 'original') {
  try {
    const svg = await qrSvg(urlRastreio(item.lote, process.env.NEXT_PUBLIC_SITE_URL), 12);
    setEtiquetaItem({
      tipo,
      item,
      dados: {
        modelo: 'recebimento',
        lote: item.lote,
        materiaPrima: item.materias_primas?.nome || '—',
        recebidoEm: grupo.data,
        fornecedor: grupo.fornecedores?.nome || '—',
        notaFiscal: grupo.nota_fiscal || '—',
        qrSvg: svg,
        copias: Number(item.volumes) || 1,
      },
    });
  } catch (e) {
    // Etiqueta de recebimento sem QR não serve para o rastreio: não abre.
    alert('Não foi possível gerar o QR do lote: ' + e.message);
  }
}
```

5. Renderizar o modal quando houver item selecionado:

```jsx
{etiquetaItem && (
  <ModalEtiquetas
    producao={{ id: etiquetaItem.item.id, modelo: 'recebimento' }}
    dados={etiquetaItem.dados}
    modelo="recebimento"
    titulo={etiquetaItem.tipo === 'reimpressao' ? 'Reimprimir etiquetas do volume' : 'Etiquetas do volume'}
    tipo={etiquetaItem.tipo}
    sourceType="recebimento_item"
    empresaNome={empresaAtual?.nome}
    setEtiqueta={setEtiqueta}
    onFechar={() => setEtiquetaItem(null)}
  />
)}
```

- [ ] **Step 3: Verificar**

```bash
npm run verify
```

Esperado: testes passando e build limpo.

- [ ] **Step 4: Conferir que a produção continua imprimindo**

Localizar as chamadas de `ModalEtiquetas` em `app/producoes/` e confirmar que nenhuma passa `dados` nem `modelo` — elas seguem pelo caminho antigo, com `producao.recipientes` sugerindo as cópias. Registrar os arquivos conferidos no relatório.

- [ ] **Step 5: Commit**

```bash
git add components/ModalEtiquetas.js app/recebimentos/page.js
git commit -m "feat(recebimentos): imprime e reimprime as etiquetas do volume com QR do lote"
```

---

## Conferência manual (dono do sistema)

Nenhum subagente roda o dev server: o `.env.local` aponta para produção. Depois de aplicar a migração 28 no Supabase, conferir na tela:

1. Lançar um recebimento com **volumes = 3** num item; a coluna Volumes aparece na lista.
2. **Imprimir etiquetas**: a pré-visualização mostra 3 etiquetas, numeradas `vol. 1/3`, `vol. 2/3`, `vol. 3/3`, cada uma com lote, matéria-prima, data, fornecedor e NF.
3. Imprimir **na EM210 com o rolo BOPP de duas colunas**: conferir o alinhamento das duas colunas e o avanço entre linhas. É o teste que justifica esta fase ser curta — errar aqui é ajustar `rolo_mm` / `gap_linha_mm` em `lib/etiquetas.js`, não reescrever nada.
4. Ler o QR com o celular: deve abrir `…/rastreio/LT-…` (404 até a Fase 5 — esperado).
5. **Reimprimir** exige motivo; conferir a linha correspondente em `etiqueta_impressoes` e em `audit_logs`.
6. Item sem volumes mantém os botões desabilitados.

## Depois desta fase

Fase 2 — ficha de defumação (`/producoes/defumacao`), com `defumacao_itens.recebimento_item_id` ligando o lote ao processo e o rendimento calculado ao vivo. A próxima migração será a **29**, salvo nova colisão: confira `ls supabase/` antes.
