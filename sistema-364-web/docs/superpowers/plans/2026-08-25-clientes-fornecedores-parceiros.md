# Clientes/Fornecedores unificados (parceiro vinculado) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar um mesmo parceiro (ex.: Supermercado Manar) existir como cliente e fornecedor ao mesmo tempo, editado numa ficha só, sem duplicar cadastro nem deixar nome/CNPJ/telefone divergirem entre os dois lados.

**Architecture:** `clientes` e `fornecedores` continuam duas tabelas — nada muda em `pedidos.cliente_id`, `recebimentos.fornecedor_id`, `contas_a_pagar.fornecedor_id` nem `conciliacao_padroes.fornecedor_id`. Ganham colunas de vínculo 1-para-1 (`fornecedor_vinculado_id` / `cliente_vinculado_id`). Uma camada nova em `lib/parceiro.js` monta a lista mesclada e orquestra o salvamento nas duas tabelas a partir de um formulário único; `app/clientes/page.js` vira a tela única (lista + ficha), `app/fornecedores/page.js` sai, menu e permissão viram uma entrada só.

**Tech Stack:** Next.js 14 (App Router), React client components, Supabase (Postgres + supabase-js), `node --test` para os testes de `lib/*`.

**Spec:** [docs/superpowers/specs/2026-08-25-clientes-fornecedores-parceiros-design.md](../specs/2026-08-25-clientes-fornecedores-parceiros-design.md)

## Global Constraints

- Sincronismo dos campos compartilhados (`nome`, `nome_fantasia`, `cnpj`, `contato`, `telefone`) é feito na aplicação, não por trigger de banco (spec §2).
- Vínculo é sempre 1-para-1 (spec, escopo "fora").
- Nenhuma mudança em `pedidos`, `recebimentos`, `contas_a_pagar`, `conciliacao_padroes` ou nas FKs que já existem para `clientes`/`fornecedores` (spec, escopo "fora").
- Permissão unificada: uma entrada `clientes` no lugar de `clientes` + `fornecedores` (spec §5). Confirmado por leitura direto no banco em 2026-08-25: só dois usuários existem hoje (`admin@364.local`, com permissão `admin`; `francismar@364.local`, sem nenhuma permissão de módulo) — a unificação não tira acesso de ninguém.
- Migração 39 é aditiva e idempotente (`begin`/`commit`, `add column if not exists`), mesmo padrão das migrações 26 e 38 — **aplicar contra produção exige confirmação explícita do usuário antes de rodar o `psql`** (não é um passo automático).
- Nota de coordenação: uma sessão separada está corrigindo `ind_ie_dest: ''` → `null` em `FORM_VAZIO` de `app/clientes/page.js` (tarefa `task_d12e3545`, já em execução quando este plano foi escrito). A Tarefa 6 abaixo reescreve o arquivo inteiro e já define `ind_ie_dest: null` no novo `FORM_VAZIO` — se aquele commit já tiver mergeado antes da Tarefa 6 rodar, não há conflito de lógica, só um `git status` a conferir antes de sobrescrever o arquivo.

---

### Task 1: Migração 39 — colunas de vínculo

**Files:**
- Create: `supabase/atualizacao_39_parceiro_cliente_fornecedor.sql`

**Interfaces:**
- Produces: colunas `public.fornecedores.nome_fantasia` (text), `public.clientes.fornecedor_vinculado_id` (uuid, FK), `public.fornecedores.cliente_vinculado_id` (uuid, FK), e os índices únicos parciais `clientes_fornecedor_vinculado_idx` / `fornecedores_cliente_vinculado_idx` — todas as tarefas seguintes que leem/gravam vínculo dependem destas colunas existirem no banco de produção antes da Tarefa 6 ir ao ar.

- [ ] **Step 1: Escrever a migração**

```sql
-- =========================================================
-- Atualização 39 — Cliente e fornecedor vinculados
--
-- Uma empresa pode ser cliente e fornecedor do Grupo 364 ao mesmo tempo (ex.:
-- Supermercado Manar, que fornece costela e compra defumado de volta). Esta
-- migração só cria a ligação 1-para-1 entre um registro de `clientes` e um de
-- `fornecedores`; as duas tabelas continuam existindo como são hoje, e nenhuma
-- FK de `pedidos`, `recebimentos`, `contas_a_pagar` ou `conciliacao_padroes`
-- muda de lugar.
--
-- `nome_fantasia` em fornecedores só faltava para os dois lados terem os
-- mesmos campos compartilháveis que a tela de parceiro sincroniza.
--
-- Aditiva e idempotente: rodar duas vezes não quebra nada.
-- =========================================================

begin;

alter table public.fornecedores add column if not exists nome_fantasia text;

alter table public.clientes
  add column if not exists fornecedor_vinculado_id uuid references public.fornecedores(id) on delete set null;
alter table public.fornecedores
  add column if not exists cliente_vinculado_id uuid references public.clientes(id) on delete set null;

create unique index if not exists clientes_fornecedor_vinculado_idx
  on public.clientes (fornecedor_vinculado_id) where fornecedor_vinculado_id is not null;
create unique index if not exists fornecedores_cliente_vinculado_idx
  on public.fornecedores (cliente_vinculado_id) where cliente_vinculado_id is not null;

commit;
```

- [ ] **Step 2: Pedir confirmação antes de aplicar**

Esta migração grava em produção (é o único banco que existe — `SUPABASE_DB_URL` em `.env.local` aponta pra lá). **Pare aqui e peça confirmação explícita ao usuário** antes do próximo passo, do mesmo jeito que já foi feito para as migrações 36 e 38 nesta sessão.

- [ ] **Step 3: Aplicar contra produção**

Run:
```bash
set -a && source .env.local && set +a && psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/atualizacao_39_parceiro_cliente_fornecedor.sql
```
Expected: `BEGIN` / `ALTER TABLE` (x3) / `CREATE INDEX` (x2) / `COMMIT`, sem erro.

- [ ] **Step 4: Verificar por inspeção**

Run:
```bash
set -a && source .env.local && set +a && psql "$SUPABASE_DB_URL" -c "\d clientes" -c "\d fornecedores" | grep -E "vinculado|nome_fantasia"
```
Expected: as três colunas novas aparecem, uma em cada tabela conforme o SQL acima.

- [ ] **Step 5: Commit**

```bash
git add supabase/atualizacao_39_parceiro_cliente_fornecedor.sql
git commit -m "feat(cadastros): migração 39 — vínculo cliente/fornecedor"
```

---

### Task 2: `lib/fornecedores.js` ganha `nome_fantasia`; `lib/clientes.js` novo

**Files:**
- Modify: `lib/fornecedores.js`
- Modify: `tests/fornecedores.test.mjs`
- Create: `lib/clientes.js`
- Create: `tests/clientes.test.mjs`

**Interfaces:**
- Consumes: nenhuma (funções puras, sem dependência de outras tarefas).
- Produces: `fornecedorParaGravar(form)` agora inclui `nome_fantasia` no objeto de saída (mesma assinatura de antes). `clienteParaGravar(form): object` e `recorteComercial(dados): object` — a Tarefa 4 (`salvarParceiro`) importa as duas de `lib/clientes.js`, e `fornecedorParaGravar` de `lib/fornecedores.js`.

- [ ] **Step 1: Escrever os testes que falham para `fornecedorParaGravar` com `nome_fantasia`**

Editar `tests/fornecedores.test.mjs`: trocar o teste `formularioDaNota: sem sugestão nenhuma devolve formulário em branco` e adicionar um caso em `fornecedorParaGravar`.

```javascript
// troca o assert.deepEqual existente por este (form ganhou nome_fantasia):
test('formularioDaNota: sem sugestão nenhuma devolve formulário em branco', () => {
  const form = formularioDaNota(null);
  assert.deepEqual(form, { nome: '', nome_fantasia: '', cnpj: '', categoria: 'Outros', contato: '', telefone: '', email: '' });
});

// novo teste, adicionar depois de "fornecedorParaGravar: sem documento nenhum grava null, não string vazia":
test('fornecedorParaGravar: sincroniza nome_fantasia com o cliente vinculado (branco vira null)', () => {
  const gravar = fornecedorParaGravar({ nome: 'Manar', nome_fantasia: '  Comercial São João  ', cnpj: '', categoria: 'Outros' });
  assert.equal(gravar.nome_fantasia, 'Comercial São João');
  assert.equal(fornecedorParaGravar({ nome: 'Manar', nome_fantasia: '', categoria: 'Outros' }).nome_fantasia, null);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test tests/fornecedores.test.mjs`
Expected: FAIL — `nome_fantasia` não existe em `formularioDaNota`/`fornecedorParaGravar` ainda.

- [ ] **Step 3: Atualizar `lib/fornecedores.js`**

```javascript
const FORM_VAZIO = { nome: '', nome_fantasia: '', cnpj: '', categoria: 'Outros', contato: '', telefone: '', email: '' };
```

```javascript
export function formularioDaNota(sugestao) {
  if (!sugestao) return { ...FORM_VAZIO };
  return {
    ...FORM_VAZIO,
    nome: sugestao.nome || '',
    cnpj: soDigitos(sugestao.documento),
    telefone: sugestao.telefone || '',
    email: sugestao.email || '',
  };
}
```

```javascript
export function fornecedorParaGravar(form) {
  return {
    nome: String(form.nome || '').trim(),
    nome_fantasia: ouNulo(form.nome_fantasia),
    cnpj: soDigitos(form.cnpj) || null,
    categoria: form.categoria || 'Outros',
    contato: ouNulo(form.contato),
    telefone: ouNulo(form.telefone),
    email: ouNulo(form.email),
  };
}
```

(`ouNulo` já existe no arquivo — não muda.)

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test tests/fornecedores.test.mjs`
Expected: PASS, todos os testes.

- [ ] **Step 5: Escrever os testes de `lib/clientes.js`**

Create `tests/clientes.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clienteParaGravar, recorteComercial } from '../lib/clientes.js';

test('clienteParaGravar: normaliza nome e reduz campos opcionais vazios a null', () => {
  const saida = clienteParaGravar({
    nome: '  Supermercado Manar  ', nome_fantasia: '', cnpj: '09.057.435/0001-47',
    tipo: 'Revenda', contato: '', telefone: '(69) 99841-4082',
    tipo_pessoa: 'J', cpf: '', ie: '', ind_ie_dest: '', consumidor_final: null,
    logradouro: '', numero: '', complemento: '', bairro: '',
    codigo_municipio_ibge: '', municipio: '', uf: '', cep: '', email_nfe: '',
  });
  assert.equal(saida.nome, 'Supermercado Manar');
  assert.equal(saida.nome_fantasia, null);
  assert.equal(saida.cnpj, '09057435000147');
  assert.equal(saida.contato, null);
  assert.equal(saida.telefone, '69998414082');
  assert.equal(saida.ind_ie_dest, null);
});

test('clienteParaGravar: converte ind_ie_dest para número quando preenchido', () => {
  const saida = clienteParaGravar({ nome: 'X', tipo_pessoa: 'J', ind_ie_dest: '1' });
  assert.equal(saida.ind_ie_dest, 1);
  assert.equal(typeof saida.ind_ie_dest, 'number');
});

test('clienteParaGravar: ind_ie_dest null continua null (não quebra o insert numa coluna smallint)', () => {
  assert.equal(clienteParaGravar({ nome: 'X', ind_ie_dest: null }).ind_ie_dest, null);
  assert.equal(clienteParaGravar({ nome: 'X', ind_ie_dest: undefined }).ind_ie_dest, null);
});

test('clienteParaGravar: mantém consumidor_final como veio (bool ou null)', () => {
  assert.equal(clienteParaGravar({ nome: 'X', consumidor_final: true }).consumidor_final, true);
  assert.equal(clienteParaGravar({ nome: 'X', consumidor_final: null }).consumidor_final, null);
});

test('clienteParaGravar: uf maiúscula só com letras, cep só com dígitos', () => {
  const saida = clienteParaGravar({ nome: 'X', uf: 'ro', cep: '76908-408' });
  assert.equal(saida.uf, 'RO');
  assert.equal(saida.cep, '76908408');
});

test('recorteComercial: mantém só os campos comerciais, sem o bloco fiscal', () => {
  const completo = clienteParaGravar({
    nome: 'X', nome_fantasia: 'Y', cnpj: '12345678000199', tipo: 'Revenda',
    contato: 'A', telefone: '69999999999', uf: 'RO', cep: '76900000', ie: '123',
  });
  const cortado = recorteComercial(completo);
  assert.deepEqual(Object.keys(cortado).sort(), ['cnpj', 'contato', 'nome', 'nome_fantasia', 'telefone', 'tipo'].sort());
  assert.equal(cortado.nome, 'X');
});
```

- [ ] **Step 6: Rodar e confirmar que falha**

Run: `node --test tests/clientes.test.mjs`
Expected: FAIL — `../lib/clientes.js` ainda não existe (`ERR_MODULE_NOT_FOUND`).

- [ ] **Step 7: Escrever `lib/clientes.js`**

```javascript
// Regras de cadastro de cliente: sanitização de campos antes de gravar, e o
// recorte comercial usado quando a atualização 36 (bloco fiscal) ainda não
// rodou no banco. Função pura: sem rede, sem Supabase, sem React.

const soDigitos = v => String(v || '').replace(/\D/g, '');
const ouNulo = v => (String(v || '').trim() || null);

export function clienteParaGravar(form) {
  return {
    nome: String(form.nome || '').trim(),
    nome_fantasia: ouNulo(form.nome_fantasia),
    cnpj: soDigitos(form.cnpj) || null,
    tipo: form.tipo || null,
    contato: ouNulo(form.contato),
    telefone: soDigitos(form.telefone) || null,
    tipo_pessoa: form.tipo_pessoa || 'J',
    cpf: soDigitos(form.cpf) || null,
    ie: soDigitos(form.ie) || null,
    ind_ie_dest: form.ind_ie_dest === '' || form.ind_ie_dest === null || form.ind_ie_dest === undefined
      ? null : Number(form.ind_ie_dest),
    consumidor_final: form.consumidor_final === undefined ? null : form.consumidor_final,
    logradouro: ouNulo(form.logradouro),
    numero: ouNulo(form.numero),
    complemento: ouNulo(form.complemento),
    bairro: ouNulo(form.bairro),
    codigo_municipio_ibge: soDigitos(form.codigo_municipio_ibge) || null,
    municipio: ouNulo(form.municipio),
    uf: (form.uf || '').toUpperCase().replace(/[^A-Z]/g, '') || null,
    cep: soDigitos(form.cep) || null,
    email_nfe: ouNulo(form.email_nfe),
  };
}

// Antes da atualização 36 o cadastro só tinha o recorte comercial; mandar as
// colunas do bloco dest para um banco sem elas derruba o insert inteiro.
export function recorteComercial(dados) {
  const { nome, nome_fantasia, cnpj, tipo, contato, telefone } = dados;
  return { nome, nome_fantasia, cnpj, tipo, contato, telefone };
}
```

- [ ] **Step 8: Rodar e confirmar que passa**

Run: `node --test tests/clientes.test.mjs tests/fornecedores.test.mjs`
Expected: PASS, todos os testes.

- [ ] **Step 9: Rodar a suíte inteira (nada mais deve quebrar)**

Run: `npm test`
Expected: PASS em todos os testes (nenhum arquivo além dos dois desta tarefa foi tocado).

- [ ] **Step 10: Commit**

```bash
git add lib/fornecedores.js lib/clientes.js tests/fornecedores.test.mjs tests/clientes.test.mjs
git commit -m "feat(cadastros): nome_fantasia em fornecedores e lib/clientes.js"
```

---

### Task 3: `lib/parceiro.js` — `montarListaParceiros`

**Files:**
- Create: `lib/parceiro.js`
- Create: `tests/parceiro.test.mjs`

**Interfaces:**
- Consumes: nenhuma.
- Produces: `montarListaParceiros(clientes: object[], fornecedores: object[]): object[]`. Cada item do retorno tem o formato:
  ```
  {
    id: string,                          // "c:<uuid>" | "f:<uuid>" | "c:<uuid>+f:<uuid>" — é o que ListaCadastro usa como key/seleção
    clienteId: string|null, fornecedorId: string|null,
    papeis: ('cliente'|'fornecedor')[],
    nome, nome_fantasia, cnpj, contato, telefone,   // campos compartilhados
    cpf, tipo, municipio, uf,                        // vêm só de `cliente`, string vazia se não há cliente
    categoria, email,                                 // vêm só de `fornecedor`, string vazia se não há fornecedor
    cliente: object|null, fornecedor: object|null,   // linhas originais completas, pra edição
    ativo: boolean,
  }
  ```
  A Tarefa 6 (`app/clientes/page.js`) consome este formato diretamente para montar `COLUNAS` e para abrir a ficha de edição.

- [ ] **Step 1: Escrever os testes que falham**

Create `tests/parceiro.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarListaParceiros } from '../lib/parceiro.js';

const CLIENTE_SOLTO = { id: 'c1', nome: 'Açougue Central', nome_fantasia: null, cnpj: '111', contato: 'A', telefone: '1', tipo: 'Revenda', municipio: 'Ji-Paraná', uf: 'RO', ativo: true, fornecedor_vinculado_id: null };
const FORNECEDOR_SOLTO = { id: 'f1', nome: 'Distribuidora XYZ', nome_fantasia: null, cnpj: '222', contato: 'B', telefone: '2', categoria: 'Embalagens', email: 'xyz@ex.com', ativo: true, cliente_vinculado_id: null };

test('montarListaParceiros: cliente sem vínculo vira uma linha com papel só cliente', () => {
  const lista = montarListaParceiros([CLIENTE_SOLTO], []);
  assert.equal(lista.length, 1);
  assert.deepEqual(lista[0].papeis, ['cliente']);
  assert.equal(lista[0].id, 'c:c1');
  assert.equal(lista[0].clienteId, 'c1');
  assert.equal(lista[0].fornecedorId, null);
  assert.equal(lista[0].nome, 'Açougue Central');
  assert.equal(lista[0].categoria, '');
});

test('montarListaParceiros: fornecedor sem vínculo vira uma linha com papel só fornecedor', () => {
  const lista = montarListaParceiros([], [FORNECEDOR_SOLTO]);
  assert.equal(lista.length, 1);
  assert.deepEqual(lista[0].papeis, ['fornecedor']);
  assert.equal(lista[0].id, 'f:f1');
  assert.equal(lista[0].clienteId, null);
  assert.equal(lista[0].fornecedorId, 'f1');
  assert.equal(lista[0].categoria, 'Embalagens');
  assert.equal(lista[0].tipo, '');
});

test('montarListaParceiros: par vinculado vira uma linha só, com os dois papéis', () => {
  const cliente = { ...CLIENTE_SOLTO, id: 'c2', nome: 'Manar', fornecedor_vinculado_id: 'f2' };
  const fornecedor = { ...FORNECEDOR_SOLTO, id: 'f2', nome: 'Manar', cliente_vinculado_id: 'c2' };
  const lista = montarListaParceiros([cliente], [fornecedor]);
  assert.equal(lista.length, 1);
  assert.deepEqual(lista[0].papeis, ['cliente', 'fornecedor']);
  assert.equal(lista[0].id, 'c:c2+f:f2');
  assert.equal(lista[0].clienteId, 'c2');
  assert.equal(lista[0].fornecedorId, 'f2');
  assert.equal(lista[0].nome, 'Manar');
  assert.equal(lista[0].categoria, 'Embalagens'); // veio do lado fornecedor
  assert.equal(lista[0].tipo, 'Revenda'); // veio do lado cliente
});

test('montarListaParceiros: vínculo quebrado (aponta pra id que não existe na lista) trata como solto', () => {
  const cliente = { ...CLIENTE_SOLTO, id: 'c3', fornecedor_vinculado_id: 'nao-existe' };
  const lista = montarListaParceiros([cliente], []);
  assert.equal(lista.length, 1);
  assert.deepEqual(lista[0].papeis, ['cliente']);
});

test('montarListaParceiros: ativo é true só se os dois lados vinculados estiverem ativos', () => {
  const cliente = { ...CLIENTE_SOLTO, id: 'c4', fornecedor_vinculado_id: 'f4', ativo: true };
  const fornecedor = { ...FORNECEDOR_SOLTO, id: 'f4', cliente_vinculado_id: 'c4', ativo: false };
  const lista = montarListaParceiros([cliente], [fornecedor]);
  assert.equal(lista[0].ativo, false);
});

test('montarListaParceiros: ordena por nome (pt-BR, ignora maiúscula/acento)', () => {
  const lista = montarListaParceiros(
    [{ ...CLIENTE_SOLTO, id: 'c5', nome: 'Zebra' }, { ...CLIENTE_SOLTO, id: 'c6', nome: 'Água' }],
    [],
  );
  assert.deepEqual(lista.map(p => p.nome), ['Água', 'Zebra']);
});

test('montarListaParceiros: listas vazias não quebram', () => {
  assert.deepEqual(montarListaParceiros([], []), []);
  assert.deepEqual(montarListaParceiros(null, undefined), []);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test tests/parceiro.test.mjs`
Expected: FAIL — `../lib/parceiro.js` não existe (`ERR_MODULE_NOT_FOUND`).

- [ ] **Step 3: Escrever `montarListaParceiros` em `lib/parceiro.js`**

```javascript
// Junta `clientes` e `fornecedores` numa lista só de "parceiros" — usada pela
// tela unificada em app/clientes/page.js. Função pura: sem rede, sem Supabase.
// A lógica de gravação (criar/editar/desvincular) fica em salvarParceiro, logo
// abaixo neste mesmo arquivo.

function linhaParceiro({ id, clienteId, fornecedorId, papeis, cliente, fornecedor }) {
  const principal = cliente || fornecedor;
  return {
    id, clienteId, fornecedorId, papeis,
    nome: principal.nome, nome_fantasia: principal.nome_fantasia || '',
    cnpj: principal.cnpj || '', contato: principal.contato || '', telefone: principal.telefone || '',
    cpf: cliente?.cpf || '', tipo: cliente?.tipo || '', municipio: cliente?.municipio || '', uf: cliente?.uf || '',
    categoria: fornecedor?.categoria || '', email: fornecedor?.email || '',
    cliente: cliente || null, fornecedor: fornecedor || null,
    ativo: (cliente ? cliente.ativo !== false : true) && (fornecedor ? fornecedor.ativo !== false : true),
  };
}

export function montarListaParceiros(clientes, fornecedores) {
  const fornecedoresPorId = new Map((fornecedores || []).map(f => [f.id, f]));
  const clientesVinculados = new Set();
  const fornecedoresVinculados = new Set();

  const linhas = [];

  for (const c of clientes || []) {
    if (!c.fornecedor_vinculado_id) continue;
    const f = fornecedoresPorId.get(c.fornecedor_vinculado_id);
    if (!f) continue;
    clientesVinculados.add(c.id);
    fornecedoresVinculados.add(f.id);
    linhas.push(linhaParceiro({
      id: `c:${c.id}+f:${f.id}`, clienteId: c.id, fornecedorId: f.id,
      papeis: ['cliente', 'fornecedor'], cliente: c, fornecedor: f,
    }));
  }

  for (const c of clientes || []) {
    if (clientesVinculados.has(c.id)) continue;
    linhas.push(linhaParceiro({ id: `c:${c.id}`, clienteId: c.id, fornecedorId: null, papeis: ['cliente'], cliente: c, fornecedor: null }));
  }

  for (const f of fornecedores || []) {
    if (fornecedoresVinculados.has(f.id)) continue;
    linhas.push(linhaParceiro({ id: `f:${f.id}`, clienteId: null, fornecedorId: f.id, papeis: ['fornecedor'], cliente: null, fornecedor: f }));
  }

  return linhas.sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test tests/parceiro.test.mjs`
Expected: PASS, todos os 7 testes.

- [ ] **Step 5: Commit**

```bash
git add lib/parceiro.js tests/parceiro.test.mjs
git commit -m "feat(cadastros): montarListaParceiros junta clientes e fornecedores vinculados"
```

---

### Task 4: `lib/parceiro.js` — `salvarParceiro`, `excluirParceiro`, `alternarAtivoParceiro`

**Files:**
- Modify: `lib/parceiro.js`
- Modify: `tests/parceiro.test.mjs`

**Interfaces:**
- Consumes: `clienteParaGravar`, `recorteComercial` de `lib/clientes.js` (Tarefa 2); `fornecedorParaGravar` de `lib/fornecedores.js` (Tarefa 2); o formato de linha de `montarListaParceiros` (Tarefa 3) para `excluirParceiro`/`alternarAtivoParceiro`.
- Produces:
  - `salvarParceiro(sb, { form, papeis, clienteExistente, fornecedorExistente, empresaId, fiscalDisponivel }): Promise<{ error: string|null }>`
  - `excluirParceiro(sb, parceiro): Promise<{ error: string|null }>`
  - `alternarAtivoParceiro(sb, parceiro): Promise<{ error: string|null }>`

  As três recebem `sb` como primeiro argumento (cliente Supabase real, ou o dublê usado nos testes) — a Tarefa 6 (`app/clientes/page.js`) chama as três passando o `supabase` importado de `lib/supabase.js`.

- [ ] **Step 1: Escrever o dublê de `sb` e os testes que falham**

Adicionar ao topo de `tests/parceiro.test.mjs` (depois dos imports existentes) o dublê e os novos testes:

```javascript
import { salvarParceiro, excluirParceiro, alternarAtivoParceiro } from '../lib/parceiro.js';

// Dublê mínimo de supabase-js pra estas três funções: cobre só
// insert/update/delete/select/eq/single, que é tudo que salvarParceiro usa.
// `banco` é { clientes: [...], fornecedores: [...] } — mutado em memória.
function criarSb(banco, { falharAoExcluir = new Set() } = {}) {
  let proximoId = 1;
  function builder(tabela) {
    const estado = {};
    const chain = {
      insert: linhas => { estado.op = 'insert'; estado.linhas = linhas; return chain; },
      update: valores => { estado.op = 'update'; estado.valores = valores; return chain; },
      delete: () => { estado.op = 'delete'; return chain; },
      eq: (campo, valor) => { estado.eqCampo = campo; estado.eqValor = valor; return chain; },
      select: () => chain,
      single: () => executar(),
      then: (resolve, reject) => executar().then(resolve, reject),
    };
    async function executar() {
      const linhas = banco[tabela];
      if (estado.op === 'insert') {
        const linha = { id: `novo-${proximoId++}`, ...estado.linhas[0] };
        linhas.push(linha);
        return { data: linha, error: null };
      }
      if (estado.op === 'update') {
        const alvo = linhas.find(l => l[estado.eqCampo] === estado.eqValor);
        if (alvo) Object.assign(alvo, estado.valores);
        return { data: alvo || null, error: null };
      }
      if (estado.op === 'delete') {
        if (falharAoExcluir.has(estado.eqValor)) {
          return { data: null, error: { message: 'update or delete on table violates foreign key constraint' } };
        }
        const i = linhas.findIndex(l => l[estado.eqCampo] === estado.eqValor);
        if (i >= 0) linhas.splice(i, 1);
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }
    return chain;
  }
  return { from: builder };
}

test('salvarParceiro: cria só cliente quando só o papel cliente está marcado', async () => {
  const banco = { clientes: [], fornecedores: [] };
  const sb = criarSb(banco);
  const { error } = await salvarParceiro(sb, {
    form: { nome: 'Açougue Central', cnpj: '111', tipo: 'Revenda', tipo_pessoa: 'J' },
    papeis: ['cliente'], clienteExistente: null, fornecedorExistente: null, empresaId: 'e1', fiscalDisponivel: true,
  });
  assert.equal(error, null);
  assert.equal(banco.clientes.length, 1);
  assert.equal(banco.fornecedores.length, 0);
  assert.equal(banco.clientes[0].nome, 'Açougue Central');
  assert.equal(banco.clientes[0].fornecedor_vinculado_id, null);
});

test('salvarParceiro: cria os dois lados vinculados quando os dois papéis estão marcados', async () => {
  const banco = { clientes: [], fornecedores: [] };
  const sb = criarSb(banco);
  const { error } = await salvarParceiro(sb, {
    form: { nome: 'Manar', cnpj: '222', tipo: 'Revenda', tipo_pessoa: 'J', categoria: 'Carnes' },
    papeis: ['cliente', 'fornecedor'], clienteExistente: null, fornecedorExistente: null, empresaId: 'e1', fiscalDisponivel: true,
  });
  assert.equal(error, null);
  assert.equal(banco.clientes.length, 1);
  assert.equal(banco.fornecedores.length, 1);
  assert.equal(banco.clientes[0].fornecedor_vinculado_id, banco.fornecedores[0].id);
  assert.equal(banco.fornecedores[0].cliente_vinculado_id, banco.clientes[0].id);
  assert.equal(banco.clientes[0].nome, 'Manar');
  assert.equal(banco.fornecedores[0].nome, 'Manar');
});

test('salvarParceiro: editar um par existente sincroniza os campos compartilhados nos dois lados', async () => {
  const banco = {
    clientes: [{ id: 'c1', nome: 'Manar', cnpj: '222', tipo: 'Revenda', tipo_pessoa: 'J', fornecedor_vinculado_id: 'f1' }],
    fornecedores: [{ id: 'f1', nome: 'Manar', cnpj: '222', categoria: 'Carnes', cliente_vinculado_id: 'c1' }],
  };
  const sb = criarSb(banco);
  const { error } = await salvarParceiro(sb, {
    form: { nome: 'Manar Atacado', cnpj: '222', tipo: 'Revenda', tipo_pessoa: 'J', categoria: 'Carnes' },
    papeis: ['cliente', 'fornecedor'], clienteExistente: banco.clientes[0], fornecedorExistente: banco.fornecedores[0],
    empresaId: 'e1', fiscalDisponivel: true,
  });
  assert.equal(error, null);
  assert.equal(banco.clientes[0].nome, 'Manar Atacado');
  assert.equal(banco.fornecedores[0].nome, 'Manar Atacado');
});

test('salvarParceiro: adicionar papel fornecedor a um cliente existente cria e vincula o novo lado', async () => {
  const banco = { clientes: [{ id: 'c1', nome: 'Manar', cnpj: '222', tipo: 'Revenda', tipo_pessoa: 'J', fornecedor_vinculado_id: null }], fornecedores: [] };
  const sb = criarSb(banco);
  const { error } = await salvarParceiro(sb, {
    form: { nome: 'Manar', cnpj: '222', tipo: 'Revenda', tipo_pessoa: 'J', categoria: 'Carnes' },
    papeis: ['cliente', 'fornecedor'], clienteExistente: banco.clientes[0], fornecedorExistente: null,
    empresaId: 'e1', fiscalDisponivel: true,
  });
  assert.equal(error, null);
  assert.equal(banco.fornecedores.length, 1);
  assert.equal(banco.clientes[0].fornecedor_vinculado_id, banco.fornecedores[0].id);
  assert.equal(banco.fornecedores[0].cliente_vinculado_id, 'c1');
});

test('salvarParceiro: desmarcar um papel exclui aquele lado e não apaga o outro', async () => {
  const banco = {
    clientes: [{ id: 'c1', nome: 'Manar', fornecedor_vinculado_id: 'f1' }],
    fornecedores: [{ id: 'f1', nome: 'Manar', cliente_vinculado_id: 'c1' }],
  };
  const sb = criarSb(banco);
  const { error } = await salvarParceiro(sb, {
    form: { nome: 'Manar', tipo_pessoa: 'J' },
    papeis: ['cliente'], clienteExistente: banco.clientes[0], fornecedorExistente: banco.fornecedores[0],
    empresaId: 'e1', fiscalDisponivel: true,
  });
  assert.equal(error, null);
  assert.equal(banco.fornecedores.length, 0);
  assert.equal(banco.clientes.length, 1);
});

test('salvarParceiro: desmarcar um papel com movimento vinculado falha e não grava nada', async () => {
  const banco = {
    clientes: [{ id: 'c1', nome: 'Manar', fornecedor_vinculado_id: 'f1' }],
    fornecedores: [{ id: 'f1', nome: 'Manar', cliente_vinculado_id: 'c1' }],
  };
  const sb = criarSb(banco, { falharAoExcluir: new Set(['f1']) });
  const { error } = await salvarParceiro(sb, {
    form: { nome: 'Manar Novo Nome', tipo_pessoa: 'J' },
    papeis: ['cliente'], clienteExistente: banco.clientes[0], fornecedorExistente: banco.fornecedores[0],
    empresaId: 'e1', fiscalDisponivel: true,
  });
  assert.match(error, /fornecedor/);
  assert.equal(banco.fornecedores.length, 1); // não foi excluído
  assert.equal(banco.clientes[0].nome, 'Manar'); // e o cliente não foi atualizado, o save parou antes
});

test('salvarParceiro: recusa salvar sem nenhum papel marcado', async () => {
  const sb = criarSb({ clientes: [], fornecedores: [] });
  const { error } = await salvarParceiro(sb, { form: { nome: 'X' }, papeis: [], clienteExistente: null, fornecedorExistente: null, empresaId: 'e1' });
  assert.match(error, /papel/i);
});

test('salvarParceiro: sem fiscalDisponivel usa o recorte comercial (não manda coluna do bloco fiscal)', async () => {
  const banco = { clientes: [], fornecedores: [] };
  const sb = criarSb(banco);
  await salvarParceiro(sb, {
    form: { nome: 'X', tipo: 'Revenda', tipo_pessoa: 'J', uf: 'RO', cep: '76900000' },
    papeis: ['cliente'], clienteExistente: null, fornecedorExistente: null, empresaId: 'e1', fiscalDisponivel: false,
  });
  assert.equal('uf' in banco.clientes[0], false);
  assert.equal(banco.clientes[0].nome, 'X');
});

test('excluirParceiro: exclui os dois lados de um par vinculado', async () => {
  const banco = { clientes: [{ id: 'c1', nome: 'Manar' }], fornecedores: [{ id: 'f1', nome: 'Manar' }] };
  const sb = criarSb(banco);
  const { error } = await excluirParceiro(sb, { clienteId: 'c1', fornecedorId: 'f1' });
  assert.equal(error, null);
  assert.equal(banco.clientes.length, 0);
  assert.equal(banco.fornecedores.length, 0);
});

test('excluirParceiro: erro num dos lados relata os dois nomes na mensagem', async () => {
  const banco = { clientes: [{ id: 'c1', nome: 'Manar' }], fornecedores: [{ id: 'f1', nome: 'Manar' }] };
  const sb = criarSb(banco, { falharAoExcluir: new Set(['f1']) });
  const { error } = await excluirParceiro(sb, { clienteId: 'c1', fornecedorId: 'f1' });
  assert.match(error, /fornecedor/);
  assert.equal(banco.clientes.length, 0); // o lado cliente foi excluído normalmente
});

test('alternarAtivoParceiro: desativa os dois lados de um par vinculado', async () => {
  const banco = { clientes: [{ id: 'c1', nome: 'Manar', ativo: true }], fornecedores: [{ id: 'f1', nome: 'Manar', ativo: true }] };
  const sb = criarSb(banco);
  const { error } = await alternarAtivoParceiro(sb, { clienteId: 'c1', fornecedorId: 'f1', ativo: true });
  assert.equal(error, null);
  assert.equal(banco.clientes[0].ativo, false);
  assert.equal(banco.fornecedores[0].ativo, false);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test tests/parceiro.test.mjs`
Expected: FAIL — `salvarParceiro`, `excluirParceiro`, `alternarAtivoParceiro` não existem em `lib/parceiro.js` ainda.

- [ ] **Step 3: Adicionar as três funções em `lib/parceiro.js`**

Adicionar no topo do arquivo, junto aos outros imports:

```javascript
import { clienteParaGravar, recorteComercial } from './clientes.js';
import { fornecedorParaGravar } from './fornecedores.js';
```

E ao final do arquivo:

```javascript
/**
 * Grava um parceiro (cliente e/ou fornecedor vinculados) a partir de um único
 * formulário. `papeis` decide quais tabelas recebem linha; campos
 * compartilhados saem idênticos nas duas quando os dois papéis estão
 * marcados. Um papel que existia e some desta vez tenta excluir aquele lado —
 * se a FK barrar (movimento vinculado), o salvamento inteiro para ali, sem
 * gravar nada mais.
 */
export async function salvarParceiro(sb, { form, papeis, clienteExistente, fornecedorExistente, empresaId, fiscalDisponivel = true }) {
  const querCliente = papeis.includes('cliente');
  const querFornecedor = papeis.includes('fornecedor');
  if (!querCliente && !querFornecedor) return { error: 'Marque pelo menos um papel: cliente ou fornecedor.' };

  if (!querCliente && clienteExistente) {
    const { error } = await sb.from('clientes').delete().eq('id', clienteExistente.id);
    if (error) return { error: mensagemDeExclusaoDePapel(error, 'cliente') };
  }
  if (!querFornecedor && fornecedorExistente) {
    const { error } = await sb.from('fornecedores').delete().eq('id', fornecedorExistente.id);
    if (error) return { error: mensagemDeExclusaoDePapel(error, 'fornecedor') };
  }

  let clienteId = querCliente ? clienteExistente?.id : null;
  let fornecedorId = querFornecedor ? fornecedorExistente?.id : null;

  // Fornecedor primeiro: se os dois lados são novos, o cliente precisa do id
  // dele pra gravar o vínculo já na própria criação.
  if (querFornecedor) {
    const dados = fornecedorParaGravar(form);
    if (fornecedorId) {
      const { error } = await sb.from('fornecedores').update(dados).eq('id', fornecedorId);
      if (error) return { error: 'Não foi possível salvar o fornecedor: ' + error.message };
    } else {
      const { data, error } = await sb.from('fornecedores')
        .insert([{ ...dados, empresa_id: empresaId }]).select('*').single();
      if (error) return { error: 'Não foi possível criar o fornecedor: ' + error.message };
      fornecedorId = data.id;
    }
  }

  if (querCliente) {
    const base = fiscalDisponivel ? clienteParaGravar(form) : recorteComercial(clienteParaGravar(form));
    const dados = { ...base, fornecedor_vinculado_id: querFornecedor ? fornecedorId : null };
    if (clienteId) {
      const { error } = await sb.from('clientes').update(dados).eq('id', clienteId);
      if (error) return { error: 'Não foi possível salvar o cliente: ' + error.message };
    } else {
      const { data, error } = await sb.from('clientes')
        .insert([{ ...dados, empresa_id: empresaId }]).select('*').single();
      if (error) return { error: 'Não foi possível criar o cliente: ' + error.message };
      clienteId = data.id;
    }
  }

  if (querFornecedor && querCliente) {
    const { error } = await sb.from('fornecedores')
      .update({ cliente_vinculado_id: clienteId }).eq('id', fornecedorId);
    if (error) return { error: 'Não foi possível vincular o fornecedor ao cliente: ' + error.message };
  }

  return { error: null };
}

function mensagemDeExclusaoDePapel(erro, lado) {
  return `Não foi possível remover o papel de ${lado}: ${erro.message}. Se este cadastro já `
    + 'tem movimento (pedido, recebimento, conta a pagar), desmarcar não é possível — desative em vez de remover o papel.';
}

// Exclui os lados que existirem. Usado pelo botão "Excluir" da ficha de
// parceiro — o mesmo bloqueio de FK de sempre vale por lado.
export async function excluirParceiro(sb, parceiro) {
  const erros = [];
  if (parceiro.clienteId) {
    const { error } = await sb.from('clientes').delete().eq('id', parceiro.clienteId);
    if (error) erros.push('cliente: ' + error.message);
  }
  if (parceiro.fornecedorId) {
    const { error } = await sb.from('fornecedores').delete().eq('id', parceiro.fornecedorId);
    if (error) erros.push('fornecedor: ' + error.message);
  }
  if (erros.length) {
    return { error: 'Não foi possível excluir (' + erros.join('; ') + '). Se já tem movimento, use Desativar em vez de Excluir.' };
  }
  return { error: null };
}

// Ativa/desativa os lados que existirem, sempre pro mesmo valor.
export async function alternarAtivoParceiro(sb, parceiro) {
  const novoAtivo = !(parceiro.ativo !== false);
  const erros = [];
  if (parceiro.clienteId) {
    const { error } = await sb.from('clientes').update({ ativo: novoAtivo }).eq('id', parceiro.clienteId);
    if (error) erros.push('cliente: ' + error.message);
  }
  if (parceiro.fornecedorId) {
    const { error } = await sb.from('fornecedores').update({ ativo: novoAtivo }).eq('id', parceiro.fornecedorId);
    if (error) erros.push('fornecedor: ' + error.message);
  }
  if (erros.length) return { error: 'Não foi possível mudar a situação (' + erros.join('; ') + ').' };
  return { error: null };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test tests/parceiro.test.mjs`
Expected: PASS, todos os testes (7 da Tarefa 3 + 11 novos).

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS em tudo.

- [ ] **Step 6: Commit**

```bash
git add lib/parceiro.js tests/parceiro.test.mjs
git commit -m "feat(cadastros): salvarParceiro, excluirParceiro e alternarAtivoParceiro"
```

---

### Task 5: `components/FichaParceiro.js`

**Files:**
- Create: `components/FichaParceiro.js`

**Interfaces:**
- Consumes: `formatarCnpj`, `cnpjValido` de `lib/cnpj.js`; `formatarTelefone`, `capitalizarNome` de `lib/formatacao.js`; `soDigitos` de `lib/fiscal.js`; `CATEGORIAS_FORNECEDOR` de `lib/fornecedores.js`.
- Produces: componente React `<FichaParceiro form setForm papeis setPapeis fiscalDisponivel pendencias consultandoCnpj erroConsultaCnpj situacaoCnpj onConsultarCnpj cnpjCopiado onConsultarIe />` que devolve o `<div className="modal-body">`. A Tarefa 6 usa este componente dentro do `<form onSubmit={salvar}>` da ficha.

Sem teste automatizado — é componente de UI, e o padrão do repositório (`tests/*.test.mjs`) não cobre `app/*/page.js` nem `components/*.js`, só `lib/*.js`. A verificação é visual, na Tarefa 8.

- [ ] **Step 1: Criar o componente**

```javascript
'use client';
import { formatarCnpj, cnpjValido } from '../lib/cnpj';
import { formatarTelefone, capitalizarNome } from '../lib/formatacao';
import { soDigitos } from '../lib/fiscal';
import { CATEGORIAS_FORNECEDOR } from '../lib/fornecedores';

const TIPOS_CLIENTE = ['Revenda', 'Distribuidor', 'Food Service', 'Consumidor Final'];

// Corpo da ficha de parceiro (cliente e/ou fornecedor) — sem a tag <form> nem
// o rodapé de botões, que ficam em app/clientes/page.js (só quem sabe salvar,
// excluir e desativar). Este componente só desenha os campos.
export default function FichaParceiro({
  form, setForm, papeis, setPapeis, fiscalDisponivel, pendencias,
  consultandoCnpj, erroConsultaCnpj, situacaoCnpj, onConsultarCnpj,
  cnpjCopiado, onConsultarIe,
}) {
  const querCliente = papeis.includes('cliente');
  const querFornecedor = papeis.includes('fornecedor');

  function alternarPapel(papel) {
    setPapeis(atual => (atual.includes(papel) ? atual.filter(p => p !== papel) : [...atual, papel]));
  }

  return (
    <div className="modal-body">
      <div className="form-grid">
        <div className="secao">Papel</div>
        <div className="largo" style={{ display: 'flex', gap: 16 }}>
          <label className="check-line">
            <input type="checkbox" checked={querCliente} onChange={() => alternarPapel('cliente')} />
            Cliente
          </label>
          <label className="check-line">
            <input type="checkbox" checked={querFornecedor} onChange={() => alternarPapel('fornecedor')} />
            Fornecedor
          </label>
        </div>
      </div>

      {querCliente && fiscalDisponivel && (
        <div className={'pendencias' + (pendencias.length ? '' : ' completo')}>
          {pendencias.length ? (
            <>
              <b>Falta para emitir nota para este cliente:</b>
              <ul>{pendencias.map(p => <li key={p}>{p}</li>)}</ul>
            </>
          ) : <span className="tag ok">Pronto para receber nota fiscal</span>}
        </div>
      )}

      <div className="form-grid">
        <div className="secao">Identificação</div>
        <div className="largo">
          <label htmlFor="p-nome">Nome / Razão social</label>
          <input id="p-nome" required autoFocus value={form.nome}
                 onChange={e => setForm({ ...form, nome: e.target.value })}
                 onBlur={e => setForm(f => ({ ...f, nome: capitalizarNome(e.target.value) }))} />
        </div>
        <div className="largo">
          <label htmlFor="p-fantasia">Nome fantasia</label>
          <input id="p-fantasia" value={form.nome_fantasia || ''}
                 onChange={e => setForm({ ...form, nome_fantasia: e.target.value })}
                 onBlur={e => setForm(f => ({ ...f, nome_fantasia: capitalizarNome(e.target.value) }))} />
        </div>
        <div>
          <label htmlFor="p-pessoa">Pessoa</label>
          <select id="p-pessoa" value={form.tipo_pessoa || 'J'}
                  onChange={e => setForm({ ...form, tipo_pessoa: e.target.value })}>
            <option value="J">Jurídica</option><option value="F">Física</option>
          </select>
        </div>
        <div>
          <label htmlFor="p-doc">{form.tipo_pessoa === 'F' ? 'CPF' : 'CNPJ'}</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input id="p-doc" inputMode="numeric" style={{ flex: 1 }}
                   value={form.tipo_pessoa === 'F' ? (form.cpf || '') : formatarCnpj(form.cnpj)}
                   onChange={e => setForm(form.tipo_pessoa === 'F'
                     ? { ...form, cpf: soDigitos(e.target.value).slice(0, 11) }
                     : { ...form, cnpj: soDigitos(e.target.value).slice(0, 14) })} />
            {form.tipo_pessoa === 'J' && (
              <button type="button" className="btn secondary small" disabled={!cnpjValido(form.cnpj) || consultandoCnpj}
                      onClick={onConsultarCnpj}>
                {consultandoCnpj ? 'Consultando…' : 'Consultar'}
              </button>
            )}
          </div>
          {erroConsultaCnpj && <p className="ajuda erro">{erroConsultaCnpj}</p>}
          {situacaoCnpj && (
            <p className="ajuda">
              Situação na Receita: {situacaoCnpj}. Inscrição estadual não vem nessa consulta — confira na SEFIN.
            </p>
          )}
        </div>
        <div>
          <label htmlFor="p-contato">Contato</label>
          <input id="p-contato" value={form.contato} onChange={e => setForm({ ...form, contato: e.target.value })} />
        </div>
        <div>
          <label htmlFor="p-fone">Telefone</label>
          <input id="p-fone" inputMode="numeric" value={formatarTelefone(form.telefone)}
                 onChange={e => setForm({ ...form, telefone: soDigitos(e.target.value).slice(0, 11) })} />
        </div>
      </div>

      {querCliente && (
        <div className="form-grid">
          <div className="secao">Dados de cliente</div>
          <div>
            <label htmlFor="p-tipo">Tipo de cliente</label>
            <select id="p-tipo" value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })}>
              {TIPOS_CLIENTE.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>

          {fiscalDisponivel && (
            <>
              <div>
                <label htmlFor="p-indie">Inscrição estadual</label>
                <select id="p-indie" value={form.ind_ie_dest ?? ''}
                        onChange={e => setForm({
                          ...form,
                          ind_ie_dest: e.target.value === '' ? null : Number(e.target.value),
                          ie: e.target.value === '1' ? form.ie : '',
                        })}>
                  <option value="">Selecione…</option>
                  <option value="1">Contribuinte de ICMS</option>
                  <option value="2">Isento de inscrição</option>
                  <option value="9">Não contribuinte</option>
                </select>
              </div>
              {Number(form.ind_ie_dest) === 1 && (
                <div>
                  <label htmlFor="p-ie">Número da inscrição</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input id="p-ie" inputMode="numeric" style={{ flex: 1 }} value={form.ie || ''}
                           onChange={e => setForm({ ...form, ie: soDigitos(e.target.value) })} />
                    <button type="button" className="btn secondary small" onClick={onConsultarIe}>
                      Consultar IE
                    </button>
                  </div>
                  {cnpjCopiado && <p className="ajuda">CNPJ copiado — cole no campo da consulta.</p>}
                </div>
              )}
              <div>
                <label htmlFor="p-final">Compra para</label>
                <select id="p-final" value={form.consumidor_final === null || form.consumidor_final === undefined ? '' : String(form.consumidor_final)}
                        onChange={e => setForm({ ...form, consumidor_final: e.target.value === '' ? null : e.target.value === 'true' })}>
                  <option value="">Selecione…</option>
                  <option value="false">Revender</option>
                  <option value="true">Consumo próprio</option>
                </select>
              </div>
              <div>
                <label htmlFor="p-email-nfe">E-mail para a nota</label>
                <input id="p-email-nfe" type="email" value={form.email_nfe || ''}
                       onChange={e => setForm({ ...form, email_nfe: e.target.value })} />
              </div>

              <div className="secao">Endereço</div>
              <div className="largo">
                <label htmlFor="p-log">Logradouro</label>
                <input id="p-log" value={form.logradouro || ''}
                       onChange={e => setForm({ ...form, logradouro: e.target.value })} />
              </div>
              <div>
                <label htmlFor="p-num">Número</label>
                <input id="p-num" value={form.numero || ''} onChange={e => setForm({ ...form, numero: e.target.value })} />
              </div>
              <div>
                <label htmlFor="p-comp">Complemento</label>
                <input id="p-comp" value={form.complemento || ''} onChange={e => setForm({ ...form, complemento: e.target.value })} />
              </div>
              <div>
                <label htmlFor="p-bairro">Bairro</label>
                <input id="p-bairro" value={form.bairro || ''} onChange={e => setForm({ ...form, bairro: e.target.value })} />
              </div>
              <div>
                <label htmlFor="p-cep">CEP</label>
                <input id="p-cep" inputMode="numeric" maxLength={8} value={form.cep || ''}
                       onChange={e => setForm({ ...form, cep: soDigitos(e.target.value) })} />
              </div>
              <div>
                <label htmlFor="p-mun">Município</label>
                <input id="p-mun" value={form.municipio || ''} onChange={e => setForm({ ...form, municipio: e.target.value })} />
              </div>
              <div>
                <label htmlFor="p-ibge">Código IBGE</label>
                <input id="p-ibge" inputMode="numeric" maxLength={7} value={form.codigo_municipio_ibge || ''}
                       onChange={e => setForm({ ...form, codigo_municipio_ibge: soDigitos(e.target.value) })} />
                <p className="ajuda">Ji-Paraná é 1100122; Porto Velho, 1100205.</p>
              </div>
              <div>
                <label htmlFor="p-uf">UF</label>
                <input id="p-uf" maxLength={2} value={form.uf || ''}
                       onChange={e => setForm({ ...form, uf: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} />
              </div>
            </>
          )}
        </div>
      )}

      {querFornecedor && (
        <div className="form-grid">
          <div className="secao">Dados de fornecedor</div>
          <div>
            <label htmlFor="p-categoria">Categoria</label>
            <select id="p-categoria" value={form.categoria || 'Outros'}
                    onChange={e => setForm({ ...form, categoria: e.target.value })}>
              {CATEGORIAS_FORNECEDOR.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="p-email">E-mail</label>
            <input id="p-email" type="email" value={form.email || ''}
                   onChange={e => setForm({ ...form, email: e.target.value })} />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/FichaParceiro.js
git commit -m "feat(cadastros): componente FichaParceiro (ficha compartilhada de cliente/fornecedor)"
```

---

### Task 6: `app/clientes/page.js` vira a tela única

**Files:**
- Modify: `app/clientes/page.js` (reescrita quase completa)

**Interfaces:**
- Consumes: `montarListaParceiros`, `salvarParceiro`, `excluirParceiro`, `alternarAtivoParceiro` de `lib/parceiro.js` (Tarefas 3-4); `<FichaParceiro>` de `components/FichaParceiro.js` (Tarefa 5); `camposDoFormulario` de `lib/cadastro.js` (já existe).
- Produces: a página em `/clientes` passa a listar e editar clientes, fornecedores e vinculados. Nenhuma outra tarefa depende de algo exportado daqui.

Antes de começar: `git status` — se o commit da correção de `ind_ie_dest` (tarefa `task_d12e3545`, rodando numa sessão separada) já tiver entrado, não precisa fazer nada especial: o `FORM_VAZIO` escrito no Step 1 abaixo já usa `ind_ie_dest: null` e substitui o arquivo inteiro.

Sem teste automatizado (é `app/*/page.js`, fora do padrão de testes do repo). Verificação manual na Tarefa 8.

- [ ] **Step 1: Substituir `app/clientes/page.js` inteiro**

```javascript
'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import AppShell from '../../components/AppShell';
import Icone from '../../components/Icone';
import ListaCadastro from '../../components/ListaCadastro';
import FichaModal from '../../components/FichaModal';
import FichaParceiro from '../../components/FichaParceiro';
import { useEmpresaAtual } from '../../lib/empresa';
import { camposDoFormulario } from '../../lib/cadastro';
import { filtrarRegistros } from '../../lib/listaCadastro';
import { pendenciasFiscaisCliente, soDigitos } from '../../lib/fiscal';
import { montarListaParceiros, salvarParceiro, excluirParceiro, alternarAtivoParceiro } from '../../lib/parceiro';
import { formatarCnpj } from '../../lib/cnpj';
import { formatarCpf } from '../../lib/ponto';
import { formatarTelefone } from '../../lib/formatacao';

// Sem fonte nacional gratuita para inscrição estadual (SINTEGRA é por estado
// e a consulta pública do RO exige captcha, não dá pra automatizar) — o botão
// abaixo só leva o usuário até o portal para conferir manualmente.
const URL_SEFIN_RO = 'https://portalcontribuinte.sefin.ro.gov.br/Publico/parametropublica.jsp';

const FORM_VAZIO = {
  nome: '', nome_fantasia: '', cnpj: '', contato: '', telefone: '',
  tipo: 'Revenda',
  // Bloco <dest> da NF-e (atualização 36). Sem ele não se emite nota para
  // este cliente, por mais completo que esteja o cadastro comercial.
  tipo_pessoa: 'J', cpf: '', ie: '', ind_ie_dest: null, consumidor_final: null,
  logradouro: '', numero: '', complemento: '', bairro: '',
  codigo_municipio_ibge: '', municipio: '', uf: '', cep: '', email_nfe: '',
  categoria: 'Carnes', email: '',
};
const CAMPOS_BUSCA = ['nome', 'nome_fantasia', 'cnpj', 'cpf', 'tipo', 'municipio', 'categoria', 'email', 'contato'];

export default function ClientesPage() {
  return (
    <AppShell modulo="clientes" titulo="Clientes/Fornecedores" desc="Cadastro de clientes, fornecedores e revendas, com dados para nota fiscal">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const { empresaAtual } = useEmpresaAtual();
  const [listaParceiros, setListaParceiros] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [mostrarInativos, setMostrarInativos] = useState(false);
  const [fiscalDisponivel, setFiscalDisponivel] = useState(true);

  const [selecionado, setSelecionado] = useState(null);
  const [criando, setCriando] = useState(false);
  const [form, setForm] = useState(FORM_VAZIO);
  const [papeis, setPapeis] = useState(['cliente']);
  const [salvando, setSalvando] = useState(false);

  const [consultandoCnpj, setConsultandoCnpj] = useState(false);
  const [erroConsultaCnpj, setErroConsultaCnpj] = useState('');
  const [situacaoCnpj, setSituacaoCnpj] = useState('');
  const [cnpjCopiado, setCnpjCopiado] = useState(false);

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    const [{ data: clientesData }, { data: fornecedoresData }] = await Promise.all([
      supabase.from('clientes').select('*').eq('empresa_id', empresaAtual.id).order('nome'),
      supabase.from('fornecedores').select('*').eq('empresa_id', empresaAtual.id).order('nome'),
    ]);
    setListaParceiros(montarListaParceiros(clientesData || [], fornecedoresData || []));
    // Sem a atualização 36 as colunas do bloco dest não existem, e gravá-las
    // faria o PostgREST recusar o registro inteiro.
    setFiscalDisponivel(!clientesData?.length || 'uf' in (clientesData[0] || {}));
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  const visiveis = useMemo(
    () => filtrarRegistros(listaParceiros, { campos: CAMPOS_BUSCA, busca, mostrarInativos }),
    [listaParceiros, busca, mostrarInativos],
  );
  const pendencias = fiscalDisponivel && papeis.includes('cliente') ? pendenciasFiscaisCliente(form) : [];
  const aberto = criando || !!selecionado;

  function limparConsultaCnpj() { setErroConsultaCnpj(''); setSituacaoCnpj(''); setCnpjCopiado(false); }

  function abrirNovo() {
    setSelecionado(null); setCriando(true); setForm(FORM_VAZIO); setPapeis(['cliente']); limparConsultaCnpj();
  }
  function fechar() {
    setSelecionado(null); setCriando(false); setForm(FORM_VAZIO); setPapeis(['cliente']); limparConsultaCnpj();
  }
  function abrir(p) {
    setCriando(false); setSelecionado(p);
    setForm(camposDoFormulario({ ...(p.fornecedor || {}), ...(p.cliente || {}) }, FORM_VAZIO));
    setPapeis(p.papeis);
    limparConsultaCnpj();
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function salvar(e) {
    e.preventDefault();
    if (salvando) return;
    setSalvando(true);
    try {
      const { error } = await salvarParceiro(supabase, {
        form, papeis,
        clienteExistente: selecionado?.cliente || null,
        fornecedorExistente: selecionado?.fornecedor || null,
        empresaId: empresaAtual?.id,
        fiscalDisponivel,
      });
      if (error) { alert(error); return; }
      await carregar();
      fechar();
    } finally {
      setSalvando(false);
    }
  }

  async function excluirSelecionado() {
    if (!selecionado) return;
    if (!confirm(`Excluir ${selecionado.nome}?`)) return;
    const { error } = await excluirParceiro(supabase, selecionado);
    if (error) { alert(error); return; }
    await carregar();
    fechar();
  }

  async function alternarAtivoSelecionado() {
    if (!selecionado) return;
    const { error } = await alternarAtivoParceiro(supabase, selecionado);
    if (error) { alert(error); return; }
    await carregar();
  }

  // O formulário da SEFIN-RO é POST com token CSRF por sessão e captcha —
  // não existe link que abra a página já preenchida. O que dá pra fazer é
  // copiar o CNPJ pra área de transferência antes de abrir, pra só colar lá.
  async function abrirConsultaIe() {
    // window.open primeiro: depois de um await, alguns navegadores (Safari)
    // não reconhecem mais o clique como gesto do usuário e bloqueiam o popup.
    window.open(URL_SEFIN_RO, '_blank', 'noopener,noreferrer');
    try {
      await navigator.clipboard.writeText(formatarCnpj(form.cnpj));
      setCnpjCopiado(true);
    } catch {
      setCnpjCopiado(false);
    }
  }

  async function consultarCnpj() {
    setConsultandoCnpj(true);
    limparConsultaCnpj();
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch(`/api/cnpj/${soDigitos(form.cnpj)}`, {
        headers: { Authorization: `Bearer ${session?.access_token || ''}` },
      });
      const dados = await r.json();
      if (!r.ok) { setErroConsultaCnpj(dados.error || 'Não foi possível consultar o CNPJ.'); return; }
      const { situacaoCadastral, ...camposForm } = dados;
      setForm(f => ({ ...f, ...camposForm }));
      setSituacaoCnpj(situacaoCadastral);
    } catch {
      setErroConsultaCnpj('Não foi possível consultar o CNPJ.');
    } finally {
      setConsultandoCnpj(false);
    }
  }

  const COLUNAS = [
    { titulo: 'Nome', principal: true, minimo: 200, render: p => p.nome, textoPuro: p => p.nome },
    {
      titulo: 'Papel', largura: 150,
      render: p => (
        <span style={{ display: 'flex', gap: 4 }}>
          {p.papeis.includes('cliente') && <span className="tag categoria">Cliente</span>}
          {p.papeis.includes('fornecedor') && <span className="tag categoria">Fornecedor</span>}
        </span>
      ),
      textoPuro: p => p.papeis.map(x => (x === 'cliente' ? 'Cliente' : 'Fornecedor')).join(' e '),
    },
    {
      titulo: 'CNPJ / CPF', largura: 132, mono: true,
      render: p => docFormatado(p) || null, textoPuro: p => docFormatado(p),
    },
    { titulo: 'Município', largura: 130, render: p => (p.municipio ? `${p.municipio}/${p.uf || ''}` : null), textoPuro: p => p.municipio || '' },
    { titulo: 'Contato', largura: 140, render: p => p.contato || null, textoPuro: p => p.contato || '' },
    {
      titulo: 'Telefone', largura: 118, mono: true,
      render: p => (p.telefone ? formatarTelefone(p.telefone) : null),
      textoPuro: p => (p.telefone ? formatarTelefone(p.telefone) : ''),
    },
    {
      titulo: 'Nota', largura: 66, alinhamento: 'center',
      render: p => (!fiscalDisponivel || !p.papeis.includes('cliente') ? null
        : pendenciasFiscaisCliente(p.cliente).length
          ? <span className="tag warn">falta</span>
          : <span className="tag ok">ok</span>),
      textoPuro: p => (!p.papeis.includes('cliente') ? '' : pendenciasFiscaisCliente(p.cliente).length ? 'faltam dados para emitir' : 'pronto para emitir'),
    },
  ];

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

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span className="muted" style={{ fontSize: 11.5 }}>
            {visiveis.length} de {listaParceiros.length} parceiro{listaParceiros.length === 1 ? '' : 's'}
          </span>
          <label className="check-line" style={{ fontSize: 12 }}>
            <input type="checkbox" checked={mostrarInativos} onChange={e => setMostrarInativos(e.target.checked)} />
            Mostrar inativos
          </label>
        </div>

        <ListaCadastro
          colunas={COLUNAS} registros={visiveis} selecionado={selecionado?.id} onAbrir={abrir}
          rotulo="Clientes/Fornecedores"
          vazio={busca ? 'Nenhum parceiro encontrado para essa busca.' : 'Nenhum cliente ou fornecedor cadastrado ainda.'} />
      </section>

      {aberto && (
        <FichaModal
          titulo={selecionado ? selecionado.nome : 'Novo parceiro'}
          subtitulo={selecionado ? (docFormatado(selecionado) || null) : null}
          onFechar={fechar}>
          <form onSubmit={salvar}>
            <FichaParceiro
              form={form} setForm={setForm} papeis={papeis} setPapeis={setPapeis}
              fiscalDisponivel={fiscalDisponivel} pendencias={pendencias}
              consultandoCnpj={consultandoCnpj} erroConsultaCnpj={erroConsultaCnpj}
              situacaoCnpj={situacaoCnpj} onConsultarCnpj={consultarCnpj}
              cnpjCopiado={cnpjCopiado} onConsultarIe={abrirConsultaIe}
            />
            <div className="modal-foot">
              <button className="btn" type="submit" disabled={salvando}>
                {salvando ? 'Salvando…' : (selecionado ? 'Salvar alterações' : 'Criar parceiro')}
              </button>
              <button className="btn secondary" type="button" onClick={fechar}>Cancelar</button>
              {selecionado && (
                <>
                  <button className="btn secondary small" type="button" style={{ marginLeft: 'auto' }}
                          onClick={alternarAtivoSelecionado}>
                    {selecionado.ativo === false ? 'Reativar' : 'Desativar'}
                  </button>
                  <button className="btn danger" type="button" onClick={excluirSelecionado}>
                    <Icone nome="lixeira" tamanho={13} /> Excluir
                  </button>
                </>
              )}
            </div>
          </form>
        </FichaModal>
      )}
    </>
  );
}

function docFormatado(p) {
  if (p.cliente?.tipo_pessoa === 'F' && p.cliente?.cpf) return formatarCpf(p.cliente.cpf);
  if (p.cnpj) return formatarCnpj(p.cnpj);
  return '';
}
```

- [ ] **Step 2: Verificar que o arquivo compila**

Este repo não tem `eslint.config.*` — `npx next lint` pergunta interativamente como configurar e trava esperando resposta; não usar. E não rodar `npm run build`/`npm run dev` soltos via shell se já houver um dev server de outra sessão de pé (colide no `.next`, ver `dev-local-sistema-364-web` na memória do projeto).

A verificação real de sintaxe/import é o próprio compile do dev server: abrir (ou reaproveitar) o preview do harness em `/clientes` e olhar os logs (`preview_logs`) depois da troca de arquivo — `Compiled /clientes in ...` sem erro é a confirmação. Isso já é o primeiro passo da Tarefa 8; se for mais prático, adiante esse passo pra cá antes de commitar.

- [ ] **Step 3: Commit**

```bash
git add app/clientes/page.js
git commit -m "feat(cadastros): app/clientes/page.js vira a tela única de parceiros"
```

---

### Task 7: Remover `app/fornecedores`; unificar menu e permissão

**Files:**
- Delete: `app/fornecedores/page.js`
- Modify: `lib/menu.js`
- Modify: `lib/auth.js`

**Interfaces:**
- Consumes: nada de tarefas anteriores além da rota `/clientes` já existir (Tarefa 6).
- Produces: nada consumido por tarefas seguintes — é a última mudança de código antes da verificação final.

- [ ] **Step 1: Apagar a página antiga**

```bash
git rm app/fornecedores/page.js
```

- [ ] **Step 2: Unificar a entrada em `lib/menu.js`**

Trocar (a entrada de `Clientes` e a de `Fornecedores` viram uma só):

```javascript
      { label: 'Clientes', href: '/clientes', modulo: 'clientes' },
      { label: 'Fornecedores', href: '/fornecedores', modulo: 'fornecedores' },
```

por:

```javascript
      { label: 'Clientes/Fornecedores', href: '/clientes', modulo: 'clientes' },
```

- [ ] **Step 3: Unificar a entrada em `lib/auth.js`**

Trocar (dentro do array `MODULOS`):

```javascript
  { id: 'fornecedores', label: 'Fornecedores', href: '/fornecedores', ic: '▤', desc: 'Cadastro de fornecedores e categorias' },
```

removendo esta linha inteira, e trocar a linha de `clientes` (que continua na mesma posição relativa do array):

```javascript
  { id: 'clientes', label: 'Clientes', href: '/clientes', ic: '▦', desc: 'Cadastro de clientes e revendas' },
```

por:

```javascript
  { id: 'clientes', label: 'Clientes/Fornecedores', href: '/clientes', ic: '▦', desc: 'Cadastro de clientes, fornecedores e revendas' },
```

- [ ] **Step 4: Conferir que nada mais referencia `/fornecedores` ou o módulo `fornecedores`**

Run:
```bash
grep -rn "'/fornecedores'\|\"fornecedores\"" app/ components/ lib/ --include="*.js" | grep -v "from '\.\./\.\./lib/fornecedores'" | grep -v "from '\.\./lib/fornecedores'"
```
Expected: nenhuma linha (as únicas ocorrências de `'fornecedores'` restantes devem ser `.from('fornecedores')` — nomes de tabela, que não mudam — e os `import ... from '../lib/fornecedores'`, que também não mudam).

- [ ] **Step 5: Commit**

```bash
git add lib/menu.js lib/auth.js
git commit -m "feat(cadastros): remove tela de fornecedores separada, unifica menu e permissão"
```

---

### Task 8: Regressão completa

**Files:** nenhum (só verificação).

**Interfaces:** nenhuma — última tarefa do plano.

- [ ] **Step 1: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS em todos os testes (os desta feature e todos os pré-existentes).

- [ ] **Step 2: Subir o dev server e abrir `/clientes`**

Usar o preview do harness (nunca `npm run dev` solto via Bash — colide com o `.next` de outra sessão, ver nota em `dev-local-sistema-364-web` na memória). Logar como usuário admin (login é manual — não digitar senha por ninguém, pedir pro usuário se for preciso).

- [ ] **Step 3: Checklist manual (compara com a spec, seção "Escopo")**

- [ ] Menu mostra uma entrada só, "Clientes/Fornecedores", sem "Fornecedores" separado.
- [ ] Lista mostra clientes antigos, fornecedores antigos e (se algum já tiver sido criado como par nesta feature) vinculados, todos juntos, coluna "Papel" mostrando as tags certas.
- [ ] "Novo parceiro" com só "Cliente" marcado: formulário mostra bloco fiscal, esconde categoria/email; salvar cria 1 linha em `clientes`, nenhuma em `fornecedores`.
- [ ] "Novo parceiro" com só "Fornecedor" marcado: esconde bloco fiscal, mostra categoria/email; salvar cria 1 linha em `fornecedores`.
- [ ] "Novo parceiro" com os dois marcados (ex.: "Supermercado Manar", igual ao caso do dono do sistema): salvar cria as duas linhas, com `fornecedor_vinculado_id`/`cliente_vinculado_id` preenchidos um pro outro (conferir com `psql` se quiser: `select nome, fornecedor_vinculado_id from clientes where nome ilike '%manar%';`).
- [ ] Reabrir esse parceiro: os dois checkboxes já vêm marcados, os dois blocos de campo aparecem preenchidos.
- [ ] Editar o nome desse parceiro e salvar: o novo nome aparece nos dois lados (conferir `fornecedores.nome` também mudou).
- [ ] Desmarcar "Fornecedor" nesse parceiro (sem movimento vinculado ainda) e salvar: a linha de fornecedor some, a de cliente permanece, o parceiro na lista passa a mostrar só a tag "Cliente".
- [ ] Botão "Consultar" (CNPJ na Receita) continua funcionando igual à sessão anterior, inclusive com só "Fornecedor" marcado (a spec pede isso — antes só existia com cliente).
- [ ] Botão "Consultar IE" (SEFIN-RO) continua abrindo a aba e copiando o CNPJ, igual à sessão anterior.
- [ ] Buscar por um trecho do nome, do CNPJ (com ou sem máscara) e da categoria de um fornecedor solto: os três encontram o registro certo.
- [ ] "Desativar" um parceiro vinculado: os dois lados saem da lista padrão; marcar "Mostrar inativos" traz os dois de volta.

- [ ] **Step 4: Screenshot do fluxo "Manar" (criar vinculado + editar) pro usuário**

Usar o Browser pane pra capturar a tela com o parceiro "Supermercado Manar" mostrando os dois papéis marcados, como prova visual de que o caso motivador da spec funciona.

- [ ] **Step 5: Reportar ao usuário**

Resumo do checklist (o que passou, o que não pôde ser testado — ex.: se não houver dado real suficiente pra algum caso) e o print do Step 4.
