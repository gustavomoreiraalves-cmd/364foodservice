# Configuração do Emissor Fiscal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao sistema uma tela de configuração de emissão fiscal (NF-e/NFC-e) por marca — ambiente, série, numeração e CSC — que o motor de emissão (próximo plano) vai consumir.

**Architecture:** Duas tabelas novas (`empresas_emissao_fiscal` para configuração, `fiscal_numeracao` para o contador, deliberadamente separadas), uma rota de API com service role espelhando `app/api/empresas/[id]/certificado/route.js`, e uma tela nova em `/fiscal/emissor` que fala só com essa API — nunca direto com as tabelas via client, porque `csc_token_cifrado` não tem policy de select para `authenticated`.

**Tech Stack:** Next.js (App Router, rotas `runtime = 'nodejs'`), Supabase (Postgres + RLS + service role), `node --test` para testes de função pura.

**Spec:** [docs/superpowers/specs/2026-08-25-configuracao-emissor-fiscal-design.md](../specs/2026-08-25-configuracao-emissor-fiscal-design.md)

## Global Constraints

- Série é identidade `empresa_id + modelo + ambiente` (não `empresa_id + modelo` sozinho) — homologação e produção nunca se sobrescrevem.
- Unicidade de série por CNPJ é constraint de banco (`unique (empregador_id, modelo, ambiente, serie)`), não só validação de API.
- `empregador_id` na tabela de configuração nunca vem da API — é preenchido por trigger a partir de `empresas.empregador_id`.
- CSC token é cifrado com `CSC_ENCRYPTION_KEY`, variável de ambiente **nova e separada** de `CERTIFICADO_CHAVE` — `CERTIFICADO_CHAVE` não é tocada em nenhum passo deste plano (já está em produção).
- Numeração (`fiscal_numeracao.ultimo_numero`) nunca é editada pelo formulário normal — só pela ação administrativa `ajustar-numeracao`, que exige motivo e nunca reduz.
- Toda rota de API deste plano usa `autorizarModulo(request, 'fiscal')` (não `'admin'`).
- Aplicar a migração SQL em qualquer banco (local ou produção) é uma escrita — **sempre confirmar com o usuário antes de rodar**, nunca automático.

---

## File Structure

- `supabase/atualizacao_40_emissao_fiscal.sql` — cria `empresas_emissao_fiscal`, `fiscal_numeracao`, trigger de `empregador_id`, coluna `empresas.informacoes_complementares_padrao`.
- `lib/emissaoFiscal.js` (novo) — funções puras de validação, sem I/O.
- `tests/emissao-fiscal.test.mjs` (novo) — testa `lib/emissaoFiscal.js`.
- `lib/certificadoServer.js` (modificado) — extrai `cifrarCom`/`decifrarCom` reutilizáveis, mantém `cifrar`/`decifrar` como estavam para quem já os usa.
- `lib/fiscalSecretServer.js` (novo) — `cifrarCsc`/`decifrarCsc`, chave própria.
- `app/api/empresas/[id]/emissao-fiscal/route.js` (novo) — `GET`/`PUT` da configuração por marca.
- `app/api/empresas/[id]/emissao-fiscal/ajustar-numeracao/route.js` (novo) — `POST` da ação administrativa de numeração.
- `app/fiscal/emissor/page.js` (novo) — tela.
- `lib/auth.js` (não modificado) — módulo `fiscal` já existe.

---

### Task 1: Migração — tabelas e trigger

**Files:**
- Create: `supabase/atualizacao_40_emissao_fiscal.sql`

**Interfaces:**
- Produces: tabelas `empresas_emissao_fiscal(id, empresa_id, empregador_id, modelo, ambiente, ativo, serie, csc_id, csc_token_cifrado, csc_key_version, created_at, updated_at)` e `fiscal_numeracao(id, empregador_id, modelo, ambiente, serie, ultimo_numero, updated_at)`; coluna `empresas.informacoes_complementares_padrao`.

- [ ] **Step 1: Escrever a migração**

```sql
-- =========================================================
-- Atualização 40 — Configuração de emissão fiscal (NF-e/NFC-e)
--
-- empresas_emissao_fiscal é a config por marca (empresa_id); fiscal_numeracao
-- é o contador, chaveado por empregador_id (o CNPJ real, quem emite de
-- verdade) — separadas de propósito, ver
-- docs/superpowers/specs/2026-08-25-configuracao-emissor-fiscal-design.md.
--
-- empregador_id em empresas_emissao_fiscal nunca vem da API: o trigger abaixo
-- copia de empresas.empregador_id sempre que a linha é gravada, para a
-- constraint de série única por CNPJ nunca validar contra um valor que a API
-- mandou errado.
--
-- Rode depois de atualizacao_38_cliente_nome_fantasia.sql. Idempotente.
-- Rollback comentado no fim.
-- =========================================================
begin;

alter table public.empresas add column if not exists informacoes_complementares_padrao text;

create table if not exists public.empresas_emissao_fiscal (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  empregador_id uuid not null references public.empregadores(id),
  modelo text not null check (modelo in ('55', '65')),
  ambiente text not null default 'homologacao' check (ambiente in ('producao', 'homologacao')),
  ativo boolean not null default false,
  serie int not null check (serie > 0),
  csc_id text,
  csc_token_cifrado text,
  csc_key_version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists empresas_emissao_fiscal_marca_modelo_ambiente
  on public.empresas_emissao_fiscal(empresa_id, modelo, ambiente);
create unique index if not exists empresas_emissao_fiscal_serie_por_cnpj
  on public.empresas_emissao_fiscal(empregador_id, modelo, ambiente, serie);
create index if not exists empresas_emissao_fiscal_empregador_idx
  on public.empresas_emissao_fiscal(empregador_id);

drop trigger if exists trg_empresas_emissao_fiscal_updated_at on public.empresas_emissao_fiscal;
create trigger trg_empresas_emissao_fiscal_updated_at before update on public.empresas_emissao_fiscal
  for each row execute function public.fn_set_updated_at();

alter table public.empresas_emissao_fiscal enable row level security;
-- Sem policy de select para authenticated de propósito: csc_token_cifrado é
-- credencial (assina o QR Code da NFC-e). Só o service role, usado nas rotas
-- de app/api/empresas/[id]/emissao-fiscal/*, alcança a tabela.

create or replace function public.fn_emissao_fiscal_popular_empregador()
returns trigger
language plpgsql
as $$
begin
  select empregador_id into new.empregador_id from public.empresas where id = new.empresa_id;
  if new.empregador_id is null then
    raise exception 'A marca % não tem pessoa jurídica (empregador) vinculada — vincule em /empresas antes de configurar a emissão.', new.empresa_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_emissao_fiscal_popular_empregador on public.empresas_emissao_fiscal;
create trigger trg_emissao_fiscal_popular_empregador before insert or update
  on public.empresas_emissao_fiscal
  for each row execute function public.fn_emissao_fiscal_popular_empregador();

create table if not exists public.fiscal_numeracao (
  id uuid primary key default gen_random_uuid(),
  empregador_id uuid not null references public.empregadores(id),
  modelo text not null check (modelo in ('55', '65')),
  ambiente text not null check (ambiente in ('producao', 'homologacao')),
  serie int not null check (serie > 0),
  ultimo_numero int not null default 0 check (ultimo_numero >= 0),
  updated_at timestamptz not null default now()
);

create unique index if not exists fiscal_numeracao_chave
  on public.fiscal_numeracao(empregador_id, modelo, ambiente, serie);

drop trigger if exists trg_fiscal_numeracao_updated_at on public.fiscal_numeracao;
create trigger trg_fiscal_numeracao_updated_at before update on public.fiscal_numeracao
  for each row execute function public.fn_set_updated_at();

alter table public.fiscal_numeracao enable row level security;
-- Mesmo motivo: só service role. O número em si não é segredo, mas só o
-- pipeline de emissão (fase seguinte) e a ação administrativa devem escrever
-- aqui — nenhum client-side write.

commit;

-- ---------- rollback ----------
-- begin;
-- drop trigger if exists trg_fiscal_numeracao_updated_at on public.fiscal_numeracao;
-- drop table if exists public.fiscal_numeracao;
-- drop trigger if exists trg_emissao_fiscal_popular_empregador on public.empresas_emissao_fiscal;
-- drop function if exists public.fn_emissao_fiscal_popular_empregador();
-- drop trigger if exists trg_empresas_emissao_fiscal_updated_at on public.empresas_emissao_fiscal;
-- drop table if exists public.empresas_emissao_fiscal;
-- alter table public.empresas drop column if exists informacoes_complementares_padrao;
-- commit;
```

- [ ] **Step 2: Confirmar com o usuário e aplicar no Supabase**

Não rodar sozinho. Pedir confirmação explícita, então aplicar via MCP/psql do
projeto (mesmo caminho já usado para as migrações anteriores) contra o banco
de desenvolvimento primeiro.

- [ ] **Step 3: Commit**

```bash
git add supabase/atualizacao_40_emissao_fiscal.sql
git commit -m "feat(fiscal): criar empresas_emissao_fiscal e fiscal_numeracao"
```

---

### Task 2: `lib/emissaoFiscal.js` — validação pura

**Files:**
- Create: `lib/emissaoFiscal.js`
- Test: `tests/emissao-fiscal.test.mjs`

**Interfaces:**
- Consumes: nada (função pura, sem I/O).
- Produces:
  - `MODELOS_EMISSAO = ['55', '65']`
  - `AMBIENTES_EMISSAO = ['producao', 'homologacao']`
  - `validarConfiguracaoEmissao({ modelo, ativo, ambiente, serie, cscId, cscToken, certificadoValido }) => string[]`
  - `serieConflita(configsDoEmpregador, candidato) => boolean` — `configsDoEmpregador: { id, modelo, ambiente, serie }[]`, `candidato: { id, modelo, ambiente, serie }`
  - `podeAjustarNumero(ultimoNumeroAtual, novoNumero) => boolean` — `ultimoNumeroAtual` pode ser `null`

- [ ] **Step 1: Escrever os testes (falhando)**

```javascript
// tests/emissao-fiscal.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validarConfiguracaoEmissao, serieConflita, podeAjustarNumero,
} from '../lib/emissaoFiscal.js';

const BASE = { modelo: '55', ativo: true, ambiente: 'homologacao', serie: 1, cscId: null, cscToken: null, certificadoValido: true };

test('série <= 0 é rejeitada', () => {
  assert.ok(validarConfiguracaoEmissao({ ...BASE, serie: 0 }).some(e => /série/i.test(e)));
  assert.deepEqual(validarConfiguracaoEmissao({ ...BASE, serie: 1 }), []);
});

test('modelo 55 rejeita CSC preenchido', () => {
  const erros = validarConfiguracaoEmissao({ ...BASE, modelo: '55', cscId: '1', cscToken: 'x' });
  assert.ok(erros.some(e => /CSC/i.test(e) && /55|NF-e/i.test(e)));
});

test('modelo 65 ativo exige CSC completo', () => {
  const semCsc = validarConfiguracaoEmissao({ ...BASE, modelo: '65', ativo: true, cscId: null, cscToken: null });
  assert.ok(semCsc.some(e => /CSC/i.test(e)));

  const soId = validarConfiguracaoEmissao({ ...BASE, modelo: '65', ativo: true, cscId: '1', cscToken: null });
  assert.ok(soId.some(e => /CSC/i.test(e)));

  const completo = validarConfiguracaoEmissao({ ...BASE, modelo: '65', ativo: true, cscId: '1', cscToken: 'x' });
  assert.deepEqual(completo, []);
});

test('modelo 65 inativo não exige CSC', () => {
  assert.deepEqual(validarConfiguracaoEmissao({ ...BASE, modelo: '65', ativo: false, cscId: null, cscToken: null }), []);
});

test('ativar ambiente produção sem certificado válido é rejeitado', () => {
  const erros = validarConfiguracaoEmissao({ ...BASE, ambiente: 'producao', certificadoValido: false });
  assert.ok(erros.some(e => /certificado/i.test(e)));
  assert.deepEqual(validarConfiguracaoEmissao({ ...BASE, ambiente: 'producao', certificadoValido: true }), []);
});

test('inativo em produção não exige certificado', () => {
  assert.deepEqual(validarConfiguracaoEmissao({ ...BASE, ativo: false, ambiente: 'producao', certificadoValido: false }), []);
});

test('série duplicada no mesmo empregador+modelo+ambiente é rejeitada', () => {
  const existentes = [{ id: 'a', modelo: '55', ambiente: 'homologacao', serie: 1 }];
  assert.equal(serieConflita(existentes, { id: 'b', modelo: '55', ambiente: 'homologacao', serie: 1 }), true);
});

test('mesma série em ambiente diferente da mesma marca não conflita', () => {
  const existentes = [{ id: 'a', modelo: '55', ambiente: 'homologacao', serie: 1 }];
  assert.equal(serieConflita(existentes, { id: 'b', modelo: '55', ambiente: 'producao', serie: 1 }), false);
});

test('editar a própria linha não conflita consigo mesma', () => {
  const existentes = [{ id: 'a', modelo: '55', ambiente: 'homologacao', serie: 1 }];
  assert.equal(serieConflita(existentes, { id: 'a', modelo: '55', ambiente: 'homologacao', serie: 1 }), false);
});

test('ajuste de numeração: cria a primeira linha com qualquer valor >= 0', () => {
  assert.equal(podeAjustarNumero(null, 0), true);
  assert.equal(podeAjustarNumero(null, 847), true);
  assert.equal(podeAjustarNumero(null, -1), false);
});

test('ajuste de numeração: nunca reduz depois de existir', () => {
  assert.equal(podeAjustarNumero(847, 910), true);
  assert.equal(podeAjustarNumero(847, 847), false);
  assert.equal(podeAjustarNumero(847, 800), false);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/emissaoFiscal.js'`

- [ ] **Step 3: Implementar**

```javascript
// lib/emissaoFiscal.js
export const MODELOS_EMISSAO = ['55', '65'];
export const AMBIENTES_EMISSAO = ['producao', 'homologacao'];

export function validarConfiguracaoEmissao({ modelo, ativo, ambiente, serie, cscId, cscToken, certificadoValido }) {
  const erros = [];
  if (!(Number.isInteger(serie) && serie > 0)) erros.push('Série precisa ser um número inteiro maior que zero.');

  const temCsc = Boolean(cscId) || Boolean(cscToken);
  if (modelo === '55' && temCsc) {
    erros.push('NF-e (modelo 55) não usa CSC — esse campo é só para NFC-e.');
  }
  if (modelo === '65' && ativo && !(cscId && cscToken)) {
    erros.push('NFC-e ativa exige CSC ID e CSC Token preenchidos.');
  }

  if (ativo && ambiente === 'producao' && !certificadoValido) {
    erros.push('Não é possível ativar produção sem um certificado digital A1 válido e não vencido.');
  }

  return erros;
}

export function serieConflita(configsDoEmpregador, candidato) {
  return configsDoEmpregador.some(c =>
    c.id !== candidato.id
    && c.modelo === candidato.modelo
    && c.ambiente === candidato.ambiente
    && c.serie === candidato.serie);
}

export function podeAjustarNumero(ultimoNumeroAtual, novoNumero) {
  if (!(Number.isInteger(novoNumero) && novoNumero >= 0)) return false;
  if (ultimoNumeroAtual === null || ultimoNumeroAtual === undefined) return true;
  return novoNumero > ultimoNumeroAtual;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: todos os testes de `tests/emissao-fiscal.test.mjs` PASS

- [ ] **Step 5: Commit**

```bash
git add lib/emissaoFiscal.js tests/emissao-fiscal.test.mjs
git commit -m "feat(fiscal): validação pura da configuração de emissão"
```

---

### Task 3: Cifra do CSC — chave própria

**Files:**
- Modify: `lib/certificadoServer.js`
- Create: `lib/fiscalSecretServer.js`

**Interfaces:**
- Consumes: nada além de `crypto` (Node builtin).
- Produces: `certificadoServer.js` passa a exportar também `cifrarCom(chaveBuf, plano)` e `decifrarCom(chaveBuf, texto)`, além de manter `cifrar`/`decifrar` como já eram (mesma assinatura, mesmo comportamento externo). `fiscalSecretServer.js` exporta `cifrarCsc(plano)` e `decifrarCsc(texto)`.

- [ ] **Step 1: Extrair o núcleo reutilizável em `certificadoServer.js`**

Modificar `lib/certificadoServer.js` — as funções `cifrar`/`decifrar` atuais (linhas ~25-37) viram wrappers de duas novas funções exportadas que recebem a chave como parâmetro:

```javascript
// Buffer -> "iv:tag:cipher" (base64). IV novo a cada chamada: repetir IV em GCM
// quebra a cifra. Extraído para lib/fiscalSecretServer.js reaproveitar com
// outra chave (CSC), sem duplicar a lógica de cifra.
export function cifrarCom(chaveBuf, plano) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', chaveBuf, iv);
  const cifrado = Buffer.concat([cipher.update(plano), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), cifrado.toString('base64')].join(':');
}

export function decifrarCom(chaveBuf, texto) {
  const [ivB64, tagB64, dadoB64] = String(texto).split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', chaveBuf, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dadoB64, 'base64')), decipher.final()]);
}

export function cifrar(plano) {
  return cifrarCom(chave(), plano);
}

export function decifrar(texto) {
  return decifrarCom(chave(), texto);
}
```

Isso substitui o corpo atual de `cifrar`/`decifrar` (que hoje têm a lógica
inline) — o comportamento externo não muda para quem já chama `cifrar`/
`decifrar` (upload de certificado em `app/api/empresas/[id]/certificado/route.js`),
só passa a existir uma versão parametrizada por baixo.

- [ ] **Step 2: Criar `lib/fiscalSecretServer.js`**

```javascript
// Cifra do CSC (Código de Segurança do Contribuinte, NFC-e). Chave própria
// (CSC_ENCRYPTION_KEY), separada de CERTIFICADO_CHAVE — vazamento de uma não
// expõe a outra, mesma convenção já usada entre CERTIFICADO_CHAVE e a chave
// de biometria do ponto. Só servidor.
import { cifrarCom, decifrarCom } from './certificadoServer.js';

function chave() {
  const b64 = process.env.CSC_ENCRYPTION_KEY;
  if (!b64) throw new Error('Configure CSC_ENCRYPTION_KEY no .env.local (32 bytes em base64).');
  const k = Buffer.from(b64, 'base64');
  if (k.length !== 32) throw new Error('CSC_ENCRYPTION_KEY deve ter 32 bytes (base64).');
  return k;
}

export function cifrarCsc(plano) {
  return cifrarCom(chave(), plano);
}

export function decifrarCsc(texto) {
  return decifrarCom(chave(), texto);
}
```

- [ ] **Step 3: Escrever o teste de round-trip**

```javascript
// tests/fiscal-secret-server.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.CSC_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
const { cifrarCsc, decifrarCsc } = await import('../lib/fiscalSecretServer.js');

test('round-trip íntegro', () => {
  const original = Buffer.from('869A687D-32CB-4CD9-90B1-880846340CE0', 'utf8');
  const cifrado = cifrarCsc(original);
  assert.deepEqual(decifrarCsc(cifrado), original);
});

test('adulterar a tag quebra a decifra', () => {
  const cifrado = cifrarCsc(Buffer.from('segredo', 'utf8'));
  const [iv, tag, dado] = cifrado.split(':');
  const tagAdulterada = [iv, Buffer.from(Buffer.from(tag, 'base64').map((b, i) => i === 0 ? b ^ 1 : b)).toString('base64'), dado].join(':');
  assert.throws(() => decifrarCsc(tagAdulterada));
});
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: `tests/fiscal-secret-server.test.mjs` PASS; suíte inteira continua PASS (nenhum teste existente quebra com a extração de `cifrarCom`/`decifrarCom`)

- [ ] **Step 5: Commit**

```bash
git add lib/certificadoServer.js lib/fiscalSecretServer.js tests/fiscal-secret-server.test.mjs
git commit -m "feat(fiscal): cifra do CSC com chave própria, separada do certificado"
```

---

### Task 4: API — `GET`/`PUT` da configuração

**Files:**
- Create: `app/api/empresas/[id]/emissao-fiscal/route.js`

**Interfaces:**
- Consumes: `autorizarModulo` de `lib/pontoServer.js`; `validarConfiguracaoEmissao`, `serieConflita` de `lib/emissaoFiscal.js`; `cifrarCsc` de `lib/fiscalSecretServer.js`.
- Produces: `GET` devolve `{ empresa: { informacoesComplementaresPadrao }, configuracoes: [{ modelo, ativo, ambiente, serie, cscConfigurado, ultimoNumero }] }`. `PUT` aceita `{ configuracoes: [{ modelo, ativo, ambiente, serie, cscId, cscToken }], informacoesComplementaresPadrao }` e devolve o mesmo formato do `GET`.

- [ ] **Step 1: Implementar a rota**

```javascript
// app/api/empresas/[id]/emissao-fiscal/route.js
import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../../../lib/pontoServer';
import { validarConfiguracaoEmissao, serieConflita, MODELOS_EMISSAO, AMBIENTES_EMISSAO } from '../../../../../lib/emissaoFiscal';
import { cifrarCsc } from '../../../../../lib/fiscalSecretServer';

export const runtime = 'nodejs';

async function empresaOu404(sb, id) {
  const { data } = await sb.from('empresas').select('id, empregador_id').eq('id', id).maybeSingle();
  return data || null;
}

async function certificadoValido(sb, empregadorId) {
  if (!empregadorId) return false;
  const { data } = await sb.from('certificados_digitais')
    .select('valido_ate').eq('empregador_id', empregadorId).eq('ativo', true).maybeSingle();
  return Boolean(data) && new Date(data.valido_ate) > new Date();
}

async function montarResposta(sb, empresa) {
  const [{ data: config }, { data: numeracoes }, { data: emp }] = await Promise.all([
    sb.from('empresas_emissao_fiscal')
      .select('id, modelo, ambiente, ativo, serie, csc_id, csc_token_cifrado')
      .eq('empresa_id', empresa.id),
    sb.from('fiscal_numeracao')
      .select('modelo, ambiente, serie, ultimo_numero')
      .eq('empregador_id', empresa.empregador_id),
    sb.from('empresas').select('informacoes_complementares_padrao').eq('id', empresa.id).single(),
  ]);
  const configuracoes = (config || []).map(c => {
    const numeracao = (numeracoes || []).find(n => n.modelo === c.modelo && n.ambiente === c.ambiente && n.serie === c.serie);
    return {
      modelo: c.modelo, ativo: c.ativo, ambiente: c.ambiente, serie: c.serie,
      cscConfigurado: Boolean(c.csc_token_cifrado),
      ultimoNumero: numeracao ? numeracao.ultimo_numero : null,
    };
  });
  return { empresa: { informacoesComplementaresPadrao: emp?.informacoes_complementares_padrao || '' }, configuracoes };
}

export async function GET(request, { params }) {
  const { sb, erro } = await autorizarModulo(request, 'fiscal');
  if (erro) return erro;
  const empresa = await empresaOu404(sb, params.id);
  if (!empresa) return NextResponse.json({ error: 'Empresa não encontrada.' }, { status: 404 });
  return NextResponse.json(await montarResposta(sb, empresa));
}

export async function PUT(request, { params }) {
  const { sb, erro } = await autorizarModulo(request, 'fiscal');
  if (erro) return erro;
  const empresa = await empresaOu404(sb, params.id);
  if (!empresa) return NextResponse.json({ error: 'Empresa não encontrada.' }, { status: 404 });
  if (!empresa.empregador_id) {
    return NextResponse.json({ error: 'Esta marca não tem pessoa jurídica vinculada. Vincule em /empresas antes.' }, { status: 400 });
  }

  const body = await request.json();
  const entradas = Array.isArray(body.configuracoes) ? body.configuracoes : [];

  const { data: existentesEmpregador } = await sb.from('empresas_emissao_fiscal')
    .select('id, empresa_id, modelo, ambiente, serie').eq('empregador_id', empresa.empregador_id);
  const { data: existentesMarca } = await sb.from('empresas_emissao_fiscal')
    .select('id, modelo, ambiente').eq('empresa_id', empresa.id);

  const certValido = await certificadoValido(sb, empresa.empregador_id);

  for (const entrada of entradas) {
    if (!MODELOS_EMISSAO.includes(entrada.modelo)) {
      return NextResponse.json({ error: `Modelo inválido: ${entrada.modelo}.` }, { status: 400 });
    }
    if (!AMBIENTES_EMISSAO.includes(entrada.ambiente)) {
      return NextResponse.json({ error: `Ambiente inválido: ${entrada.ambiente}.` }, { status: 400 });
    }
    const linhaAtual = (existentesMarca || []).find(l => l.modelo === entrada.modelo && l.ambiente === entrada.ambiente);
    const erros = validarConfiguracaoEmissao({
      modelo: entrada.modelo, ativo: entrada.ativo, ambiente: entrada.ambiente, serie: entrada.serie,
      cscId: entrada.cscId, cscToken: entrada.cscToken, certificadoValido: certValido,
    });
    if (erros.length) return NextResponse.json({ error: erros.join(' ') }, { status: 400 });

    const outrasDoEmpregador = (existentesEmpregador || [])
      .filter(l => l.empresa_id !== empresa.id)
      .map(l => ({ id: l.id, modelo: l.modelo, ambiente: l.ambiente, serie: l.serie }));
    if (serieConflita(outrasDoEmpregador, { id: linhaAtual?.id, modelo: entrada.modelo, ambiente: entrada.ambiente, serie: entrada.serie })) {
      return NextResponse.json({
        error: `A série ${entrada.serie} do modelo ${entrada.modelo} em ${entrada.ambiente} já está em uso por outra marca deste CNPJ.`,
      }, { status: 400 });
    }

    const linha = {
      empresa_id: empresa.id, modelo: entrada.modelo, ambiente: entrada.ambiente,
      ativo: Boolean(entrada.ativo), serie: entrada.serie,
      csc_id: entrada.modelo === '65' ? (entrada.cscId || null) : null,
    };
    // CSC token só é recifrado se veio valor novo — campo vazio no PUT
    // mantém o cifrado atual, mesmo comportamento do certificado A1.
    if (entrada.modelo === '65' && entrada.cscToken) {
      linha.csc_token_cifrado = cifrarCsc(Buffer.from(entrada.cscToken, 'utf8'));
    }

    const { error } = await sb.from('empresas_emissao_fiscal')
      .upsert([linha], { onConflict: 'empresa_id,modelo,ambiente' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if ('informacoesComplementaresPadrao' in body) {
    const { error } = await sb.from('empresas')
      .update({ informacoes_complementares_padrao: body.informacoesComplementaresPadrao || null })
      .eq('id', empresa.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(await montarResposta(sb, empresa));
}
```

- [ ] **Step 2: Verificar manualmente**

Run: `npm run dev`, depois (com uma marca já vinculada a empregador e sessão
válida):

```bash
curl -X PUT http://localhost:3000/api/empresas/<empresa_id>/emissao-fiscal \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"configuracoes":[{"modelo":"55","ativo":true,"ambiente":"homologacao","serie":1}]}'
```

Expected: `200` com `configuracoes` incluindo a linha do modelo 55, `cscConfigurado: false`, `ultimoNumero: null`.

- [ ] **Step 3: Commit**

```bash
git add "app/api/empresas/[id]/emissao-fiscal/route.js"
git commit -m "feat(fiscal): API de configuração de emissão por marca"
```

---

### Task 5: API — ajuste administrativo de numeração

**Files:**
- Create: `app/api/empresas/[id]/emissao-fiscal/ajustar-numeracao/route.js`

**Interfaces:**
- Consumes: `autorizarModulo`; `podeAjustarNumero` de `lib/emissaoFiscal.js`; RPC `fn_registrar_auditoria` já existente (`atualizacao_17_producao_interna.sql`).
- Produces: `POST` aceita `{ modelo, ambiente, novoNumero, motivo }`, devolve `{ modelo, ambiente, serie, ultimoNumero }`.

- [ ] **Step 1: Implementar a rota**

```javascript
// app/api/empresas/[id]/emissao-fiscal/ajustar-numeracao/route.js
import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../../../../lib/pontoServer';
import { podeAjustarNumero } from '../../../../../../lib/emissaoFiscal';

export const runtime = 'nodejs';

export async function POST(request, { params }) {
  const { sb, user, erro } = await autorizarModulo(request, 'fiscal');
  if (erro) return erro;

  const { data: empresa } = await sb.from('empresas').select('id, empregador_id').eq('id', params.id).maybeSingle();
  if (!empresa) return NextResponse.json({ error: 'Empresa não encontrada.' }, { status: 404 });

  const { modelo, ambiente, novoNumero, motivo } = await request.json();
  if (!motivo || !motivo.trim()) {
    return NextResponse.json({ error: 'Informe o motivo do ajuste.' }, { status: 400 });
  }

  const { data: config } = await sb.from('empresas_emissao_fiscal')
    .select('serie').eq('empresa_id', empresa.id).eq('modelo', modelo).eq('ambiente', ambiente).maybeSingle();
  if (!config) {
    return NextResponse.json({ error: 'Configure a série deste modelo/ambiente antes de ajustar a numeração.' }, { status: 400 });
  }

  const { data: atual } = await sb.from('fiscal_numeracao')
    .select('id, ultimo_numero')
    .eq('empregador_id', empresa.empregador_id).eq('modelo', modelo).eq('ambiente', ambiente).eq('serie', config.serie)
    .maybeSingle();

  const ultimoAtual = atual ? atual.ultimo_numero : null;
  if (!podeAjustarNumero(ultimoAtual, novoNumero)) {
    return NextResponse.json({
      error: ultimoAtual === null
        ? 'Número inicial inválido — precisa ser um inteiro maior ou igual a zero.'
        : `O novo número (${novoNumero}) precisa ser maior que o atual (${ultimoAtual}) — numeração fiscal nunca retrocede.`,
    }, { status: 400 });
  }

  const { data: gravado, error } = atual
    ? await sb.from('fiscal_numeracao').update({ ultimo_numero: novoNumero }).eq('id', atual.id).select('id').single()
    : await sb.from('fiscal_numeracao').insert([{
        empregador_id: empresa.empregador_id, modelo, ambiente, serie: config.serie, ultimo_numero: novoNumero,
      }]).select('id').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await sb.rpc('fn_registrar_auditoria', {
    p_entidade: 'fiscal_numeracao', p_entidade_id: gravado.id, p_acao: 'ajuste',
    p_empresa_id: empresa.id,
    p_antes: { ultimo_numero: ultimoAtual }, p_depois: { ultimo_numero: novoNumero },
    p_motivo: motivo,
  });

  return NextResponse.json({ modelo, ambiente, serie: config.serie, ultimoNumero: novoNumero });
}
```

- [ ] **Step 2: Verificar manualmente**

```bash
curl -X POST http://localhost:3000/api/empresas/<empresa_id>/emissao-fiscal/ajustar-numeracao \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"modelo":"55","ambiente":"homologacao","novoNumero":0,"motivo":"início de operação"}'
```

Expected: `200` com `ultimoNumero: 0`. Repetir com `novoNumero: 0` de novo
deve devolver `400` (não reduz/repete).

- [ ] **Step 3: Commit**

```bash
git add "app/api/empresas/[id]/emissao-fiscal/ajustar-numeracao/route.js"
git commit -m "feat(fiscal): ajuste administrativo auditado de numeração fiscal"
```

---

### Task 6: Tela `/fiscal/emissor`

**Files:**
- Create: `app/fiscal/emissor/page.js`

**Interfaces:**
- Consumes: `GET`/`PUT /api/empresas/[id]/emissao-fiscal`, `POST .../ajustar-numeracao` (Task 4 e 5); `useEmpresaAtual` de `lib/empresa.js` (padrão já usado em `/empresas`) só para listar marcas — a config em si nunca é lida via `supabase.from(...)` direto, sempre pela API.

- [ ] **Step 1: Implementar a tela**

```javascript
// app/fiscal/emissor/page.js
'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import AppShell from '../../../components/AppShell';

const MODELOS = [['55', 'NF-e'], ['65', 'NFC-e']];

async function cabecalhoAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${session?.access_token || ''}`, 'Content-Type': 'application/json' };
}

export default function EmissorFiscalPage() {
  return (
    <AppShell modulo="fiscal" titulo="Emissão fiscal" desc="Ambiente, série, numeração e CSC por marca">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const [marcas, setMarcas] = useState([]);
  const [selecionada, setSelecionada] = useState('');
  const [dados, setDados] = useState(null);
  const [form, setForm] = useState({});
  const [mensagem, setMensagem] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    supabase.from('empresas').select('id, nome, empregador_id').order('nome')
      .then(({ data }) => { setMarcas(data || []); if (data?.[0]) setSelecionada(data[0].id); });
  }, []);

  async function carregar(empresaId) {
    setMensagem('');
    const r = await fetch(`/api/empresas/${empresaId}/emissao-fiscal`, { headers: await cabecalhoAuth() });
    const json = await r.json();
    if (!r.ok) { setMensagem(json.error || 'Falha ao carregar.'); return; }
    setDados(json);
    const porModelo = {};
    for (const [m] of MODELOS) {
      const existente = json.configuracoes.find(c => c.modelo === m);
      porModelo[m] = existente
        ? { ativo: existente.ativo, ambiente: existente.ambiente, serie: existente.serie, cscId: '', cscToken: '', cscConfigurado: existente.cscConfigurado, ultimoNumero: existente.ultimoNumero }
        : { ativo: false, ambiente: 'homologacao', serie: 1, cscId: '', cscToken: '', cscConfigurado: false, ultimoNumero: null };
    }
    setForm({ modelos: porModelo, informacoesComplementaresPadrao: json.empresa.informacoesComplementaresPadrao });
  }

  useEffect(() => { if (selecionada) carregar(selecionada); }, [selecionada]);

  async function salvar(e) {
    e.preventDefault();
    setSalvando(true); setMensagem('');
    try {
      const corpo = {
        configuracoes: MODELOS.map(([m]) => ({
          modelo: m,
          ativo: form.modelos[m].ativo,
          ambiente: form.modelos[m].ambiente,
          serie: Number(form.modelos[m].serie),
          cscId: form.modelos[m].cscId || undefined,
          cscToken: form.modelos[m].cscToken || undefined,
        })),
        informacoesComplementaresPadrao: form.informacoesComplementaresPadrao,
      };
      const r = await fetch(`/api/empresas/${selecionada}/emissao-fiscal`, {
        method: 'PUT', headers: await cabecalhoAuth(), body: JSON.stringify(corpo),
      });
      const json = await r.json();
      if (!r.ok) { setMensagem(json.error || 'Falha ao salvar.'); return; }
      setMensagem('Configuração salva.');
      await carregar(selecionada);
    } finally {
      setSalvando(false);
    }
  }

  async function ajustarNumero(modelo) {
    const atual = form.modelos[modelo].ultimoNumero;
    const novo = prompt(`Novo último número (atual: ${atual ?? 'não configurado'}):`);
    if (novo === null) return;
    const motivo = prompt('Motivo do ajuste:');
    if (!motivo) { alert('Motivo é obrigatório.'); return; }
    const r = await fetch(`/api/empresas/${selecionada}/emissao-fiscal/ajustar-numeracao`, {
      method: 'POST', headers: await cabecalhoAuth(),
      body: JSON.stringify({ modelo, ambiente: form.modelos[modelo].ambiente, novoNumero: Number(novo), motivo }),
    });
    const json = await r.json();
    if (!r.ok) { alert(json.error || 'Falha ao ajustar.'); return; }
    await carregar(selecionada);
  }

  function campoModelo(modelo, chave, valor) {
    setForm(f => ({ ...f, modelos: { ...f.modelos, [modelo]: { ...f.modelos[modelo], [chave]: valor } } }));
  }

  if (!marcas.length) return <p className="muted">Carregando marcas…</p>;

  return (
    <div className="panel">
      <div className="form-grid">
        <div>
          <label>Marca</label>
          <select value={selecionada} onChange={e => setSelecionada(e.target.value)}>
            {marcas.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
        </div>
      </div>

      {marcas.find(m => m.id === selecionada && !m.empregador_id) && (
        <p className="muted">Esta marca não tem pessoa jurídica (CNPJ) vinculada — vincule em /empresas antes.</p>
      )}

      {form.modelos && (
        <form onSubmit={salvar}>
          {MODELOS.map(([m, label]) => (
            <fieldset className="form-grid" key={m} style={{ marginTop: 12 }}>
              <legend><strong>{label}</strong></legend>
              <div>
                <label>Ativo</label>
                <input type="checkbox" checked={form.modelos[m].ativo} onChange={e => campoModelo(m, 'ativo', e.target.checked)} />
              </div>
              <div>
                <label>Ambiente</label>
                <select value={form.modelos[m].ambiente} onChange={e => campoModelo(m, 'ambiente', e.target.value)}>
                  <option value="homologacao">Homologação</option>
                  <option value="producao">Produção</option>
                </select>
              </div>
              <div>
                <label>Série</label>
                <input type="number" min="1" value={form.modelos[m].serie} onChange={e => campoModelo(m, 'serie', e.target.value)} />
              </div>
              <div>
                <label>Último número utilizado</label>
                <input readOnly value={form.modelos[m].ultimoNumero ?? 'não configurado'} />
                <button className="btn secondary small" type="button" onClick={() => ajustarNumero(m)}>Ajustar numeração</button>
              </div>
              {m === '65' && (
                <>
                  <div>
                    <label>Identificador do CSC (ID Token)</label>
                    <input value={form.modelos[m].cscId} onChange={e => campoModelo(m, 'cscId', e.target.value)} placeholder={form.modelos[m].cscConfigurado ? 'já configurado — deixe em branco para manter' : ''} />
                  </div>
                  <div>
                    <label>CSC / Código de Segurança</label>
                    <input type="password" autoComplete="off" value={form.modelos[m].cscToken} onChange={e => campoModelo(m, 'cscToken', e.target.value)} placeholder={form.modelos[m].cscConfigurado ? 'já configurado — deixe em branco para manter' : ''} />
                  </div>
                </>
              )}
            </fieldset>
          ))}

          <div style={{ marginTop: 12 }}>
            <label>Informações complementares (texto seu — não substitui avisos fiscais automáticos)</label>
            <textarea rows={3} value={form.informacoesComplementaresPadrao || ''} onChange={e => setForm(f => ({ ...f, informacoesComplementaresPadrao: e.target.value }))} />
          </div>

          <button className="btn" type="submit" disabled={salvando} style={{ marginTop: 12 }}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </form>
      )}
      {mensagem && <p className="muted" style={{ marginTop: 8 }}>{mensagem}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Verificar no browser**

Run: `npm run dev`, abrir `/fiscal/emissor` logado como usuário com permissão
`fiscal`. Selecionar marca, ativar NF-e em homologação com série 1, salvar,
recarregar e confirmar que o valor persiste. Tentar ativar NFC-e sem CSC e
confirmar a mensagem de erro vinda da API.

- [ ] **Step 3: Commit**

```bash
git add "app/fiscal/emissor/page.js"
git commit -m "feat(fiscal): tela de configuração de emissão em /fiscal/emissor"
```

---

## Self-Review

**Cobertura da spec:** granularidade da série (marca dentro do CNPJ) →
Task 1 (`empregador_id` + constraint); ambiente na identidade → Task 1
(`unique(empresa_id, modelo, ambiente)`); CSC cifrado com chave própria →
Task 3; numeração como tabela separada, nunca editável livremente → Task 1 +
Task 5; checklist "pronto para emitir" (certificado válido bloqueando
produção) → Task 2 (`certificadoValido`) + Task 4; rótulos "Identificador do
CSC" vs "CSC/Código de Segurança" → Task 6. Reserva atômica de número fica
para o plano do motor de emissão, como o spec já registrava.

**Placeholders:** nenhum "TODO"/"implementar depois" — todo passo tem código
completo.

**Consistência de tipos:** `validarConfiguracaoEmissao`, `serieConflita` e
`podeAjustarNumero` usados em Task 2 com as mesmas assinaturas nas Tasks 4 e
5; `cifrarCsc`/`decifrarCsc` de Task 3 usados em Task 4 com a assinatura
definida lá.

---

Plan complete and saved to `docs/superpowers/plans/2026-08-25-configuracao-emissor-fiscal.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
