# Importação de NF-e no Recebimento — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar a digitação manual do recebimento de matéria-prima, importando a NF-e do fornecedor — da caixa de entrada da SEFAZ, de uma chave digitada ou de um XML enviado à mão.

**Architecture:** Funções puras em `lib/nfe/` e `lib/sefaz/` fazem parse, de-para e montagem de envelope SOAP, e são cobertas por teste. Rotas em `app/api/nfe/*` (runtime nodejs, service role) guardam o certificado A1 cifrado, falam com a SEFAZ por mTLS e devolvem rascunhos prontos. A tela de Recebimento consome esses rascunhos e continua funcionando sem certificado.

**Tech Stack:** Next.js 14 (App Router), React 18, Supabase (Postgres + RLS + Storage), Node 18+ com `node:test`, `fast-xml-parser`, `node-forge`, `xml-crypto`, `undici`.

**Spec:** `docs/superpowers/specs/2026-08-20-nfe-recebimento-design.md`

## Global Constraints

- Toda rota nova em `app/api/nfe/*` declara `export const runtime = 'nodejs'` — mTLS e `zlib` não existem no edge runtime.
- Toda rota nova usa `autorizarModulo(request, 'recebimentos')` de `lib/pontoServer.js`, exceto o cron, que usa `CRON_SECRET`.
- Nenhum código de `lib/nfe/*` ou `lib/sefaz/*` que toque certificado pode ser importado por componente client. Componentes client só chamam as rotas.
- O material do certificado (`.pfx`, senha, chave privada em PEM) nunca é logado, nunca entra em resposta HTTP e nunca é gravado em disco.
- Toda tabela nova leva `empresa_id uuid not null references empresas(id)` e RLS no padrão do projeto: `using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()))`. Exceção: `certificados_digitais`, que é `using (false)`.
- Migrações SQL entram em `supabase/` com o próximo número livre. Já existem dois arquivos `atualizacao_20_*`; este plano usa **21** e **22**.
- Testes rodam com `npm test` (`node --test tests/*.test.mjs`). Verificação completa: `npm run verify`.
- Valores monetários arredondam para 2 casas; pesos e quantidades para 4 casas — mesmo padrão de `lib/financeiro.js`.
- Textos de interface em português, com a acentuação correta.

---

## Estrutura de arquivos

**Criar:**

| arquivo | responsabilidade |
| --- | --- |
| `lib/nfe/parseNFe.js` | XML da NF-e → objeto. Função pura, sem rede nem banco. |
| `lib/nfe/dePara.js` | Aplica o mapa fornecedor→matéria-prima e converte unidade. Pura. |
| `lib/nfe/parcelas.js` | Duplicatas da nota → parcelas do contas a pagar. Pura. |
| `lib/nfe/cripto.js` | AES-256-GCM para o certificado. Pura, só `node:crypto`. |
| `lib/nfe/certificadoServer.js` | Lê o `.pfx`, cifra/decifra e carrega o certificado ativo da empresa. Só servidor. |
| `lib/sefaz/envelopes.js` | Monta e lê envelopes SOAP do `NFeDistribuicaoDFe`. Pura. |
| `lib/sefaz/endpoints.js` | URLs e constantes de ambiente num lugar só. |
| `lib/sefaz/transporte.js` | POST mTLS para a SEFAZ. Só servidor. |
| `lib/sefaz/assinatura.js` | XMLDSig sobre `infEvento`. Só servidor. |
| `lib/sefaz/manifestacao.js` | Monta e envia o evento 210210. |
| `app/api/nfe/certificado/route.js` | Upload e leitura de metadados do A1. |
| `app/api/nfe/upload/route.js` | XML avulso → `nfe_documentos`. |
| `app/api/nfe/documentos/route.js` | Lista de documentos. |
| `app/api/nfe/documentos/[chave]/preparar/route.js` | Rascunho de recebimento pronto. |
| `app/api/nfe/sincronizar/route.js` | Varredura por NSU, ciência e download. |
| `app/api/nfe/chave/route.js` | Consulta por chave digitada. |
| `app/recebimentos/notas/page.js` | Tela "Notas fiscais" (caixa de entrada). |
| `components/RecebimentoTabs.js` | Navegação entre "Entradas" e "Notas fiscais". |
| `components/ImportarNota.js` | Bloco de importação no formulário de recebimento. |
| `supabase/atualizacao_21_nfe_documentos.sql` | Tabelas de documento, estado e de-para. |
| `supabase/atualizacao_22_certificado_digital.sql` | Tabela do certificado. |
| `tests/nfe-parse.test.mjs`, `tests/nfe-depara.test.mjs`, `tests/nfe-parcelas.test.mjs`, `tests/nfe-cripto.test.mjs`, `tests/sefaz-envelopes.test.mjs` | Testes. |
| `tests/fixtures/nfe-exemplo.xml`, `tests/fixtures/dist-retorno.xml` | Fixtures. |
| `vercel.json` | Cron da sincronização. |

**Modificar:**

| arquivo | mudança |
| --- | --- |
| `package.json` | dependências novas |
| `app/recebimentos/page.js` | bloco de importação, staging vindo da nota, parcelas da nota, gravação do de-para e da chave |

---

## Task 1: Parser de NF-e

**Files:**
- Create: `lib/nfe/parseNFe.js`
- Create: `tests/nfe-parse.test.mjs`
- Create: `tests/fixtures/nfe-exemplo.xml`
- Modify: `package.json`

**Interfaces:**
- Consumes: nada.
- Produces: `parseNFe(xml: string) -> Nota`, onde
  `Nota = { chave, modelo, tipoOperacao, numero, serie, emitidaEm, valorTotal,
  emitente: { cnpj, nome, fantasia, telefone, email, uf },
  itens: [{ indice, codigo, descricao, ncm, unidade, quantidade, valorUnitario, valorTotal }],
  duplicatas: [{ numero, vencimento, valor }] }`.
  Lança `Error` quando o XML não é NF-e ou a chave não tem 44 dígitos.

- [ ] **Step 1: Instalar o parser de XML**

```bash
npm install fast-xml-parser@^4.4.1
```

- [ ] **Step 2: Criar a fixture de NF-e**

Criar `tests/fixtures/nfe-exemplo.xml`. Note dois detalhes propositais: o item 1 vem em caixa (`uCom` = `CX`), que é o caso que exige fator de conversão, e há duas duplicatas.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe>
    <infNFe Id="NFe35260812345678000199550010000012341000012348" versao="4.00">
      <ide><cUF>35</cUF><nNF>1234</nNF><serie>1</serie><dhEmi>2026-08-18T09:12:00-03:00</dhEmi><mod>55</mod><tpNF>1</tpNF></ide>
      <emit>
        <CNPJ>12345678000199</CNPJ>
        <xNome>Frigorifico Exemplo LTDA</xNome>
        <xFant>Frigo Exemplo</xFant>
        <enderEmit><UF>SP</UF><fone>1133334444</fone></enderEmit>
      </emit>
      <dest><CNPJ>98765432000188</CNPJ><xNome>364 Food Services</xNome></dest>
      <det nItem="1">
        <prod><cProd>PC-001</cProd><xProd>PICANHA RESFRIADA CX 12KG</xProd><NCM>02013000</NCM>
        <uCom>CX</uCom><qCom>2.0000</qCom><vUnCom>780.0000</vUnCom><vProd>1560.00</vProd></prod>
      </det>
      <det nItem="2">
        <prod><cProd>FR-010</cProd><xProd>FRALDINHA RESFRIADA KG</xProd><NCM>02013000</NCM>
        <uCom>KG</uCom><qCom>30.0000</qCom><vUnCom>39.9000</vUnCom><vProd>1197.00</vProd></prod>
      </det>
      <total><ICMSTot><vNF>2757.00</vNF></ICMSTot></total>
      <cobr>
        <dup><nDup>001</nDup><dVenc>2026-09-02</dVenc><vDup>1378.50</vDup></dup>
        <dup><nDup>002</nDup><dVenc>2026-09-17</dVenc><vDup>1378.50</vDup></dup>
      </cobr>
    </infNFe>
  </NFe>
  <protNFe><infProt><chNFe>35260812345678000199550010000012341000012348</chNFe><nProt>135260000000001</nProt></infProt></protNFe>
</nfeProc>
```

- [ ] **Step 3: Escrever o teste que falha**

Criar `tests/nfe-parse.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseNFe } from '../lib/nfe/parseNFe.js';

const xml = readFileSync(new URL('./fixtures/nfe-exemplo.xml', import.meta.url), 'utf8');

test('parseNFe: cabeçalho e emitente', () => {
  const nota = parseNFe(xml);
  assert.equal(nota.chave, '35260812345678000199550010000012341000012348');
  assert.equal(nota.numero, '1234');
  assert.equal(nota.serie, '1');
  assert.equal(nota.modelo, '55');
  assert.equal(nota.valorTotal, 2757);
  assert.equal(nota.emitente.cnpj, '12345678000199');
  assert.equal(nota.emitente.nome, 'Frigorifico Exemplo LTDA');
  assert.equal(nota.emitente.telefone, '1133334444');
  assert.equal(nota.emitente.email, null);
});

test('parseNFe: itens', () => {
  const { itens } = parseNFe(xml);
  assert.equal(itens.length, 2);
  assert.deepEqual(itens[0], {
    indice: 1, codigo: 'PC-001', descricao: 'PICANHA RESFRIADA CX 12KG', ncm: '02013000',
    unidade: 'CX', quantidade: 2, valorUnitario: 780, valorTotal: 1560,
  });
  assert.equal(itens[1].codigo, 'FR-010');
  assert.equal(itens[1].quantidade, 30);
});

test('parseNFe: duplicatas', () => {
  const { duplicatas } = parseNFe(xml);
  assert.equal(duplicatas.length, 2);
  assert.deepEqual(duplicatas[0], { numero: '001', vencimento: '2026-09-02', valor: 1378.5 });
});

test('parseNFe: nota com um único item vira lista de um', () => {
  const umItem = xml.replace(/<det nItem="2">[\s\S]*?<\/det>/, '');
  assert.equal(parseNFe(umItem).itens.length, 1);
});

test('parseNFe: XML que não é NF-e falha', () => {
  assert.throws(() => parseNFe('<qualquer><coisa/></qualquer>'), /não é uma NF-e/);
});

test('parseNFe: chave fora de 44 dígitos falha', () => {
  const ruim = xml.replace('NFe35260812345678000199550010000012341000012348', 'NFe123');
  assert.throws(() => parseNFe(ruim), /Chave de acesso inválida/);
});
```

- [ ] **Step 4: Rodar o teste e confirmar que falha**

Rodar: `npm test`
Esperado: FAIL com `Cannot find module '../lib/nfe/parseNFe.js'`.

- [ ] **Step 5: Implementar o parser**

Criar `lib/nfe/parseNFe.js`:

```js
// Converte o XML de uma NF-e (procNFe ou NFe avulsa) num objeto simples.
// Função pura: sem rede, sem banco, sem estado. É a única parte do sistema
// que conhece o layout do XML — o resto trabalha só com o objeto devolvido.
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false, // números viram string; a conversão é nossa, para não perder zeros à esquerda
  trimValues: true,
});

// A NF-e omite o array quando há um só elemento (um det, uma dup).
function lista(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function digitos(v) {
  return String(v || '').replace(/\D/g, '');
}

export function parseNFe(xml) {
  const raiz = parser.parse(xml);
  const nfe = raiz?.nfeProc?.NFe || raiz?.NFe;
  const inf = nfe?.infNFe;
  if (!inf) throw new Error('XML não é uma NF-e: infNFe não encontrado.');

  const chave = String(inf['@_Id'] || '').replace(/^NFe/, '');
  if (!/^\d{44}$/.test(chave)) throw new Error('Chave de acesso inválida no XML.');

  const ide = inf.ide || {};
  const emit = inf.emit || {};

  return {
    chave,
    modelo: String(ide.mod ?? ''),
    tipoOperacao: String(ide.tpNF ?? ''), // 0 = entrada, 1 = saída, do ponto de vista do emitente
    numero: String(ide.nNF ?? ''),
    serie: String(ide.serie ?? ''),
    emitidaEm: String(ide.dhEmi ?? ide.dEmi ?? ''),
    valorTotal: num(inf.total?.ICMSTot?.vNF),
    emitente: {
      cnpj: digitos(emit.CNPJ),
      nome: String(emit.xNome ?? ''),
      fantasia: emit.xFant ? String(emit.xFant) : null,
      telefone: emit.enderEmit?.fone ? String(emit.enderEmit.fone) : null,
      // O layout 4.00 não tem e-mail obrigatório no emitente; quando não vem, fica nulo
      // e o cadastro de fornecedor é preenchido à mão.
      email: emit.email ? String(emit.email) : null,
      uf: emit.enderEmit?.UF ? String(emit.enderEmit.UF) : null,
    },
    itens: lista(inf.det).map((d, i) => ({
      indice: Number(d['@_nItem'] || i + 1),
      codigo: String(d.prod?.cProd ?? ''),
      descricao: String(d.prod?.xProd ?? ''),
      ncm: d.prod?.NCM ? String(d.prod.NCM) : null,
      unidade: String(d.prod?.uCom ?? ''),
      quantidade: num(d.prod?.qCom),
      valorUnitario: num(d.prod?.vUnCom),
      valorTotal: num(d.prod?.vProd),
    })),
    duplicatas: lista(inf.cobr?.dup).map(d => ({
      numero: String(d.nDup ?? ''),
      vencimento: String(d.dVenc ?? '').slice(0, 10),
      valor: num(d.vDup),
    })),
  };
}
```

- [ ] **Step 6: Rodar o teste e confirmar que passa**

Rodar: `npm test`
Esperado: PASS nos 6 testes de `nfe-parse`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json lib/nfe/parseNFe.js tests/nfe-parse.test.mjs tests/fixtures/nfe-exemplo.xml
git commit -m "feat(nfe): parser do XML da NF-e"
```

---

## Task 2: De-para de itens com conversão de unidade

**Files:**
- Create: `lib/nfe/dePara.js`
- Create: `tests/nfe-depara.test.mjs`

**Interfaces:**
- Consumes: `parseNFe` (Task 1) — recebe o objeto `Nota`.
- Produces: `aplicarDePara(nota, mapa) -> ItemImportado[]`, onde `mapa` é a lista de
  linhas de `fornecedor_produto_mapa` **já filtrada pelo CNPJ do emitente**, cada uma
  com `{ codigo_produto, materia_prima_id, unidade_nf, fator_conversao }`, e
  `ItemImportado = { indice, codigo, descricao, unidadeNota, quantidadeNota,
  valorUnitarioNota, valorTotalItem, materiaPrimaId, fatorConversao, pesoNotaKg,
  custoUnitario, mapeado }`.
  Também exporta `itensNaoMapeados(itens) -> ItemImportado[]`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/nfe-depara.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseNFe } from '../lib/nfe/parseNFe.js';
import { aplicarDePara, itensNaoMapeados } from '../lib/nfe/dePara.js';

const nota = parseNFe(readFileSync(new URL('./fixtures/nfe-exemplo.xml', import.meta.url), 'utf8'));

const MAPA = [
  { codigo_produto: 'PC-001', materia_prima_id: 'mp-picanha', unidade_nf: 'CX', fator_conversao: 12 },
  { codigo_produto: 'FR-010', materia_prima_id: 'mp-fraldinha', unidade_nf: 'KG', fator_conversao: 1 },
];

test('aplicarDePara: caixa vira quilo pelo fator', () => {
  const [picanha] = aplicarDePara(nota, MAPA);
  assert.equal(picanha.materiaPrimaId, 'mp-picanha');
  assert.equal(picanha.fatorConversao, 12);
  assert.equal(picanha.pesoNotaKg, 24);       // 2 caixas x 12 kg
  assert.equal(picanha.custoUnitario, 65);    // 1560,00 / 24 kg
  assert.equal(picanha.mapeado, true);
});

test('aplicarDePara: item já em quilo mantém quantidade e custo', () => {
  const [, fraldinha] = aplicarDePara(nota, MAPA);
  assert.equal(fraldinha.pesoNotaKg, 30);
  assert.equal(fraldinha.custoUnitario, 39.9);
});

test('aplicarDePara: item sem mapa vem marcado, com fator 1', () => {
  const itens = aplicarDePara(nota, [MAPA[1]]);
  assert.equal(itens[0].mapeado, false);
  assert.equal(itens[0].materiaPrimaId, null);
  assert.equal(itens[0].fatorConversao, 1);
  assert.equal(itens[0].pesoNotaKg, 2);
  assert.equal(itensNaoMapeados(itens).length, 1);
});

test('aplicarDePara: mapa vazio não quebra', () => {
  const itens = aplicarDePara(nota, []);
  assert.equal(itens.length, 2);
  assert.equal(itensNaoMapeados(itens).length, 2);
});

test('aplicarDePara: quantidade zero não gera divisão por zero', () => {
  const zerada = { ...nota, itens: [{ ...nota.itens[0], quantidade: 0, valorTotal: 0 }] };
  assert.equal(aplicarDePara(zerada, MAPA)[0].custoUnitario, 0);
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Rodar: `npm test`
Esperado: FAIL com `Cannot find module '../lib/nfe/dePara.js'`.

- [ ] **Step 3: Implementar o de-para**

Criar `lib/nfe/dePara.js`:

```js
// Liga cada item da NF-e à matéria-prima cadastrada, usando o mapa que o sistema
// aprende a cada nota. O fornecedor fatura em caixa/fardo e o estoque trabalha em
// quilo, então o fator de conversão é parte do mapa, não um detalhe opcional.
//
// `mapa` é a lista de linhas de fornecedor_produto_mapa JÁ FILTRADA pelo CNPJ do
// emitente — filtrar por CNPJ é responsabilidade de quem consulta o banco.

function arred(v, casas) {
  const f = 10 ** casas;
  return Math.round(Number(v) * f) / f;
}

export function aplicarDePara(nota, mapa) {
  const indice = new Map((mapa || []).map(m => [String(m.codigo_produto), m]));

  return (nota.itens || []).map(item => {
    const m = indice.get(String(item.codigo)) || null;
    const fator = m && Number(m.fator_conversao) > 0 ? Number(m.fator_conversao) : 1;
    const pesoNotaKg = arred(item.quantidade * fator, 4);
    // Custo por unidade de estoque (kg), e não por unidade comercial da nota.
    const custoUnitario = pesoNotaKg > 0 ? arred(item.valorTotal / pesoNotaKg, 2) : 0;

    return {
      indice: item.indice,
      codigo: item.codigo,
      descricao: item.descricao,
      unidadeNota: item.unidade,
      quantidadeNota: item.quantidade,
      valorUnitarioNota: item.valorUnitario,
      valorTotalItem: item.valorTotal,
      materiaPrimaId: m ? m.materia_prima_id : null,
      fatorConversao: fator,
      pesoNotaKg,
      custoUnitario,
      mapeado: Boolean(m),
    };
  });
}

export function itensNaoMapeados(itens) {
  return (itens || []).filter(i => !i.mapeado);
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Rodar: `npm test`
Esperado: PASS nos 5 testes de `nfe-depara`.

- [ ] **Step 5: Commit**

```bash
git add lib/nfe/dePara.js tests/nfe-depara.test.mjs
git commit -m "feat(nfe): de-para de itens com conversão de unidade"
```

---

## Task 3: Parcelas a partir das duplicatas da nota

**Files:**
- Create: `lib/nfe/parcelas.js`
- Create: `tests/nfe-parcelas.test.mjs`

**Interfaces:**
- Consumes: `gerarParcelas(dataBase, valorTotal, numeroParcelas, intervaloDias)` de `lib/financeiro.js`.
- Produces: `parcelasDoRecebimento({ duplicatas, dataBase, valorLancado, valorTotalNota, numeroParcelas, intervaloDias }) -> { origem, parcelas }`,
  com `origem` em `'nota' | 'manual' | 'manual_divergencia'` e
  `parcelas: [{ numero, valor, vencimento }]` no mesmo formato que `gerarParcelas` já devolve.

**Decisão importante:** o contas a pagar do recebimento é gerado só sobre os itens
aceitos (`totalAceito` em `app/recebimentos/page.js`). Quando um item é rejeitado, o
valor lançado deixa de bater com o total da nota e as duplicatas do fornecedor não
valem mais. Nesse caso o sistema volta para o parcelamento manual e sinaliza a
divergência, em vez de gravar vencimentos que não correspondem ao valor.

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/nfe-parcelas.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parcelasDoRecebimento } from '../lib/nfe/parcelas.js';

const DUP = [
  { numero: '001', vencimento: '2026-09-02', valor: 1378.5 },
  { numero: '002', vencimento: '2026-09-17', valor: 1378.5 },
];

test('usa as duplicatas quando o valor lançado bate com a nota', () => {
  const r = parcelasDoRecebimento({
    duplicatas: DUP, dataBase: '2026-08-18',
    valorLancado: 2757, valorTotalNota: 2757, numeroParcelas: 1, intervaloDias: 30,
  });
  assert.equal(r.origem, 'nota');
  assert.deepEqual(r.parcelas, [
    { numero: 1, valor: 1378.5, vencimento: '2026-09-02' },
    { numero: 2, valor: 1378.5, vencimento: '2026-09-17' },
  ]);
  assert.equal(r.parcelas.reduce((s, p) => s + p.valor, 0), 2757);
});

test('divergência de valor volta para o parcelamento manual', () => {
  const r = parcelasDoRecebimento({
    duplicatas: DUP, dataBase: '2026-08-18',
    valorLancado: 1560, valorTotalNota: 2757, numeroParcelas: 2, intervaloDias: 30,
  });
  assert.equal(r.origem, 'manual_divergencia');
  assert.equal(r.parcelas.length, 2);
  assert.equal(r.parcelas.reduce((s, p) => s + p.valor, 0), 1560);
});

test('nota sem duplicatas cai no gerarParcelas atual', () => {
  const r = parcelasDoRecebimento({
    duplicatas: [], dataBase: '2026-08-18',
    valorLancado: 1000, valorTotalNota: 1000, numeroParcelas: 1, intervaloDias: 30,
  });
  assert.equal(r.origem, 'manual');
  assert.deepEqual(r.parcelas, [{ numero: 1, valor: 1000, vencimento: '2026-08-18' }]);
});

test('diferença de centavo é tolerada e as duplicatas valem', () => {
  const r = parcelasDoRecebimento({
    duplicatas: DUP, dataBase: '2026-08-18',
    valorLancado: 2756.995, valorTotalNota: 2757, numeroParcelas: 1, intervaloDias: 30,
  });
  assert.equal(r.origem, 'nota');
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Rodar: `npm test`
Esperado: FAIL com `Cannot find module '../lib/nfe/parcelas.js'`.

- [ ] **Step 3: Implementar**

Criar `lib/nfe/parcelas.js`:

```js
// Escolhe entre os vencimentos reais da nota e o parcelamento manual.
//
// As duplicatas do XML só valem quando o valor lançado no contas a pagar bate com
// o total da nota. Se algum item foi rejeitado na inspeção, o valor lançado é menor
// e os vencimentos do fornecedor deixam de corresponder — nesse caso o sistema
// devolve 'manual_divergencia' para a tela avisar e usa o parcelamento informado.
import { gerarParcelas } from '../financeiro.js';

const TOLERANCIA = 0.01;

export function parcelasDoRecebimento({
  duplicatas, dataBase, valorLancado, valorTotalNota, numeroParcelas = 1, intervaloDias = 30,
}) {
  const temDuplicatas = Array.isArray(duplicatas) && duplicatas.length > 0;
  const bate = temDuplicatas
    && Math.abs(Number(valorLancado) - Number(valorTotalNota)) <= TOLERANCIA;

  if (bate) {
    return {
      origem: 'nota',
      parcelas: duplicatas.map((d, i) => ({
        numero: i + 1,
        valor: Number(d.valor),
        vencimento: String(d.vencimento).slice(0, 10),
      })),
    };
  }

  return {
    origem: temDuplicatas ? 'manual_divergencia' : 'manual',
    parcelas: gerarParcelas(dataBase, valorLancado, numeroParcelas, intervaloDias),
  };
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Rodar: `npm test`
Esperado: PASS nos 4 testes de `nfe-parcelas`.

- [ ] **Step 5: Commit**

```bash
git add lib/nfe/parcelas.js tests/nfe-parcelas.test.mjs
git commit -m "feat(nfe): parcelas do contas a pagar a partir das duplicatas"
```

---

## Task 4: Migração das tabelas de NF-e

**Files:**
- Create: `supabase/atualizacao_21_nfe_documentos.sql`

**Interfaces:**
- Consumes: `public.empresas_permitidas()` (já existe, de `atualizacao_05`).
- Produces: tabelas `nfe_documentos`, `nfe_sefaz_estado`, `fornecedor_produto_mapa`, e as colunas
  `recebimentos.nfe_chave` e `recebimentos.nfe_documento_id`.

- [ ] **Step 1: Escrever a migração**

Criar `supabase/atualizacao_21_nfe_documentos.sql`:

```sql
-- =========================================================
-- 364 — ATUALIZAÇÃO 21: NF-e NO RECEBIMENTO
-- Caixa de entrada de notas fiscais eletrônicas: documentos vistos na SEFAZ
-- (ou enviados por upload), o ponteiro de leitura por empresa e o de-para que
-- liga o código do produto do fornecedor à matéria-prima cadastrada.
--
-- O XML em si não fica no banco: vai para o bucket privado 'recebimentos',
-- em {empresa_id}/nfe/{chave}.xml, e a coluna guarda só o path.
--
-- Rode depois de atualizacao_20_rls_escopo_empresa.sql.
-- =========================================================

begin;

-- ---------- DOCUMENTOS ----------
create table if not exists public.nfe_documentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  chave text not null check (chave ~ '^[0-9]{44}$'),
  nsu text,                                   -- número sequencial da SEFAZ; nulo quando veio de upload
  modelo text,                                -- '55' = NF-e; o resto entra como ignorada
  cnpj_emitente text,
  nome_emitente text,
  numero text,
  serie text,
  emitida_em timestamptz,
  valor_total numeric(12,2),
  status text not null default 'resumo'
    check (status in ('resumo', 'manifestada', 'xml_baixado', 'vinculada', 'ignorada')),
  origem text not null default 'sefaz' check (origem in ('sefaz', 'upload')),
  xml_path text,                              -- path no bucket privado, não URL
  recebimento_id uuid references recebimentos(id) on delete set null,
  manifestada_em timestamptz,
  ultimo_erro text,
  created_at timestamptz not null default now(),
  unique (empresa_id, chave)
);
create index if not exists nfe_documentos_empresa_status_idx
  on public.nfe_documentos (empresa_id, status);
create index if not exists nfe_documentos_recebimento_idx
  on public.nfe_documentos (recebimento_id);

alter table public.nfe_documentos enable row level security;
drop policy if exists "empresa_scoped_access" on public.nfe_documentos;
create policy "empresa_scoped_access" on public.nfe_documentos for all
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()))
  with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

-- ---------- PONTEIRO DE LEITURA DA SEFAZ ----------
-- Um registro por empresa. ultima_consulta_em existe para respeitar o limite de
-- consumo da SEFAZ (retorno 656 = consumo indevido).
create table if not exists public.nfe_sefaz_estado (
  empresa_id uuid primary key references empresas(id),
  ultimo_nsu text not null default '000000000000000',
  max_nsu text not null default '000000000000000',
  ultima_consulta_em timestamptz,
  ultimo_erro text,
  atualizado_em timestamptz not null default now()
);

alter table public.nfe_sefaz_estado enable row level security;
drop policy if exists "empresa_scoped_access" on public.nfe_sefaz_estado;
create policy "empresa_scoped_access" on public.nfe_sefaz_estado for all
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()))
  with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

-- ---------- DE-PARA FORNECEDOR x MATÉRIA-PRIMA ----------
-- fator_conversao traduz a unidade comercial da nota (CX, FD) para a unidade de
-- estoque (kg). 1 significa "a nota já vem na unidade de estoque".
create table if not exists public.fornecedor_produto_mapa (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  cnpj_emitente text not null,
  codigo_produto text not null,
  materia_prima_id uuid not null references materias_primas(id) on delete cascade,
  unidade_nf text,
  fator_conversao numeric(12,4) not null default 1 check (fator_conversao > 0),
  created_at timestamptz not null default now(),
  unique (empresa_id, cnpj_emitente, codigo_produto)
);
create index if not exists fornecedor_produto_mapa_empresa_cnpj_idx
  on public.fornecedor_produto_mapa (empresa_id, cnpj_emitente);

alter table public.fornecedor_produto_mapa enable row level security;
drop policy if exists "empresa_scoped_access" on public.fornecedor_produto_mapa;
create policy "empresa_scoped_access" on public.fornecedor_produto_mapa for all
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()))
  with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

-- ---------- VÍNCULO NO RECEBIMENTO ----------
alter table public.recebimentos add column if not exists nfe_chave text;
alter table public.recebimentos add column if not exists nfe_documento_id uuid references public.nfe_documentos(id);

-- A mesma nota não pode virar dois recebimentos na mesma empresa. Índice parcial
-- porque recebimento digitado à mão continua com nfe_chave nulo.
create unique index if not exists recebimentos_empresa_nfe_chave_idx
  on public.recebimentos (empresa_id, nfe_chave) where nfe_chave is not null;

commit;
```

- [ ] **Step 2: Rodar a migração no Supabase**

Abrir o SQL Editor do projeto Supabase e executar o arquivo inteiro. Ele está numa
transação: ou tudo entra, ou nada entra.

Verificar depois, no mesmo editor:

```sql
select table_name from information_schema.tables
where table_schema = 'public'
  and table_name in ('nfe_documentos', 'nfe_sefaz_estado', 'fornecedor_produto_mapa');
```

Esperado: as três linhas.

```sql
select column_name from information_schema.columns
where table_name = 'recebimentos' and column_name in ('nfe_chave', 'nfe_documento_id');
```

Esperado: as duas linhas.

- [ ] **Step 3: Commit**

```bash
git add supabase/atualizacao_21_nfe_documentos.sql
git commit -m "feat(nfe): migração das tabelas de documento, estado e de-para"
```

---

## Task 5: Rotas de upload de XML e listagem de documentos

**Files:**
- Create: `lib/nfe/autorizacao.js`
- Create: `app/api/nfe/upload/route.js`
- Create: `app/api/nfe/documentos/route.js`

**Interfaces:**
- Consumes: `parseNFe` (Task 1), tabelas da Task 4, `autorizarModulo` de `lib/pontoServer.js`.
- Produces:
  - `garantirEmpresa(sb, user, isAdmin, empresaId) -> Promise<true>` (lança `Error` com
    mensagem pronta quando o usuário não tem a empresa);
  - `POST /api/nfe/upload` — body JSON `{ empresaId, xml }` → `{ documento }`;
  - `GET /api/nfe/documentos?empresaId=&status=` → `{ documentos: [...] }`.

- [ ] **Step 1: Criar o guarda de empresa**

Criar `lib/nfe/autorizacao.js`:

```js
// As rotas de NF-e usam service role, que passa por cima do RLS. Por isso o
// escopo de empresa precisa ser conferido na mão aqui — sem isso, um usuário
// autenticado poderia ler nota de outra empresa do grupo passando outro empresaId.
export async function garantirEmpresa(sb, user, isAdmin, empresaId) {
  if (!empresaId) throw new Error('Informe a empresa.');
  if (isAdmin) return true;
  const { data } = await sb.from('usuario_empresas')
    .select('empresa_id').eq('user_id', user.id).eq('empresa_id', empresaId).maybeSingle();
  if (!data) throw new Error('Sem acesso a esta empresa.');
  return true;
}
```

- [ ] **Step 2: Criar a rota de upload**

Criar `app/api/nfe/upload/route.js`:

```js
import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../../lib/pontoServer';
import { garantirEmpresa } from '../../../../lib/nfe/autorizacao';
import { parseNFe } from '../../../../lib/nfe/parseNFe';

export const runtime = 'nodejs';

const LIMITE_XML = 2 * 1024 * 1024; // NF-e realista não passa disso; corta abuso

// POST: registra um XML enviado à mão (fornecedor mandou por e-mail, ou o
// certificado ainda não está configurado). body: { empresaId, xml }
export async function POST(request) {
  const { sb, user, isAdmin, erro } = await autorizarModulo(request, 'recebimentos');
  if (erro) return erro;

  const { empresaId, xml } = await request.json();
  try {
    await garantirEmpresa(sb, user, isAdmin, empresaId);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 403 });
  }
  if (typeof xml !== 'string' || !xml.trim()) {
    return NextResponse.json({ error: 'Envie o conteúdo do XML.' }, { status: 400 });
  }
  if (xml.length > LIMITE_XML) {
    return NextResponse.json({ error: 'XML acima de 2 MB — confira se é mesmo uma NF-e.' }, { status: 400 });
  }

  let nota;
  try {
    nota = parseNFe(xml);
  } catch (e) {
    return NextResponse.json({ error: 'Não consegui ler este XML: ' + e.message }, { status: 400 });
  }

  const ehNFe = nota.modelo === '55';
  const path = `${empresaId}/nfe/${nota.chave}.xml`;
  const { error: errUp } = await sb.storage.from('recebimentos')
    .upload(path, Buffer.from(xml, 'utf8'), { contentType: 'application/xml', upsert: true });
  if (errUp) return NextResponse.json({ error: 'Falha ao guardar o XML: ' + errUp.message }, { status: 500 });

  const { data, error } = await sb.from('nfe_documentos').upsert([{
    empresa_id: empresaId,
    chave: nota.chave,
    modelo: nota.modelo,
    cnpj_emitente: nota.emitente.cnpj,
    nome_emitente: nota.emitente.nome,
    numero: nota.numero,
    serie: nota.serie,
    emitida_em: nota.emitidaEm || null,
    valor_total: nota.valorTotal,
    status: ehNFe ? 'xml_baixado' : 'ignorada',
    origem: 'upload',
    xml_path: path,
    ultimo_erro: null,
  }], { onConflict: 'empresa_id,chave' }).select('*').single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!ehNFe) {
    return NextResponse.json({ documento: data, aviso: 'Documento registrado, mas não é NF-e modelo 55 — não pode virar recebimento.' });
  }
  return NextResponse.json({ documento: data });
}
```

- [ ] **Step 3: Criar a rota de listagem**

Criar `app/api/nfe/documentos/route.js`:

```js
import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../../lib/pontoServer';
import { garantirEmpresa } from '../../../../lib/nfe/autorizacao';

export const runtime = 'nodejs';

const STATUS_VALIDOS = ['resumo', 'manifestada', 'xml_baixado', 'vinculada', 'ignorada'];

// GET ?empresaId=...&status=... — lista a caixa de entrada, mais recente primeiro.
export async function GET(request) {
  const { sb, user, isAdmin, erro } = await autorizarModulo(request, 'recebimentos');
  if (erro) return erro;

  const { searchParams } = new URL(request.url);
  const empresaId = searchParams.get('empresaId');
  const status = searchParams.get('status');

  try {
    await garantirEmpresa(sb, user, isAdmin, empresaId);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 403 });
  }

  let q = sb.from('nfe_documentos')
    .select('id, chave, numero, serie, cnpj_emitente, nome_emitente, emitida_em, valor_total, status, origem, recebimento_id, ultimo_erro')
    .eq('empresa_id', empresaId)
    .order('emitida_em', { ascending: false, nullsFirst: false })
    .limit(300);
  if (status && STATUS_VALIDOS.includes(status)) q = q.eq('status', status);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ documentos: data || [] });
}
```

- [ ] **Step 4: Verificar que o build passa**

Rodar: `npm run verify`
Esperado: testes PASS e build do Next sem erro.

- [ ] **Step 5: Commit**

```bash
git add lib/nfe/autorizacao.js app/api/nfe/upload/route.js app/api/nfe/documentos/route.js
git commit -m "feat(nfe): rotas de upload de XML e listagem de documentos"
```

---

## Task 6: Rota que monta o rascunho de recebimento

**Files:**
- Create: `app/api/nfe/documentos/[chave]/preparar/route.js`

**Interfaces:**
- Consumes: `parseNFe` (Task 1), `aplicarDePara` (Task 2), `garantirEmpresa` (Task 5), tabelas da Task 4.
- Produces: `GET /api/nfe/documentos/{chave}/preparar?empresaId=` →
  `{ documento, nota, fornecedor, fornecedorSugerido, itens, duplicatas, jaVinculada }`,
  onde `itens` é `ItemImportado[]` (Task 2), `fornecedor` é a linha de `fornecedores`
  casada por CNPJ (ou `null`), e `fornecedorSugerido` é o rascunho de cadastro
  `{ nome, cnpj, telefone, email }` quando o fornecedor não existe.

- [ ] **Step 1: Criar a rota**

Criar `app/api/nfe/documentos/[chave]/preparar/route.js`:

```js
import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../../../../lib/pontoServer';
import { garantirEmpresa } from '../../../../../../lib/nfe/autorizacao';
import { parseNFe } from '../../../../../../lib/nfe/parseNFe';
import { aplicarDePara } from '../../../../../../lib/nfe/dePara';

export const runtime = 'nodejs';

// GET: devolve tudo que a tela de recebimento precisa para abrir o formulário
// já preenchido. Não grava nada.
export async function GET(request, { params }) {
  const { sb, user, isAdmin, erro } = await autorizarModulo(request, 'recebimentos');
  if (erro) return erro;

  const empresaId = new URL(request.url).searchParams.get('empresaId');
  try {
    await garantirEmpresa(sb, user, isAdmin, empresaId);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 403 });
  }

  const chave = String(params.chave || '').replace(/\D/g, '');
  const { data: documento } = await sb.from('nfe_documentos')
    .select('*').eq('empresa_id', empresaId).eq('chave', chave).maybeSingle();
  if (!documento) return NextResponse.json({ error: 'Nota não encontrada.' }, { status: 404 });
  if (!documento.xml_path) {
    return NextResponse.json({ error: 'O XML desta nota ainda não foi baixado da SEFAZ.' }, { status: 409 });
  }

  const { data: arquivo, error: errDl } = await sb.storage.from('recebimentos').download(documento.xml_path);
  if (errDl) return NextResponse.json({ error: 'Falha ao ler o XML guardado: ' + errDl.message }, { status: 500 });
  const nota = parseNFe(await arquivo.text());

  const [{ data: fornecedor }, { data: mapa }, { data: recebimentoExistente }] = await Promise.all([
    sb.from('fornecedores').select('id, nome, cnpj')
      .eq('empresa_id', empresaId).eq('cnpj', nota.emitente.cnpj).maybeSingle(),
    sb.from('fornecedor_produto_mapa')
      .select('codigo_produto, materia_prima_id, unidade_nf, fator_conversao')
      .eq('empresa_id', empresaId).eq('cnpj_emitente', nota.emitente.cnpj),
    sb.from('recebimentos').select('id').eq('empresa_id', empresaId).eq('nfe_chave', chave).maybeSingle(),
  ]);

  return NextResponse.json({
    documento,
    nota: {
      chave: nota.chave, numero: nota.numero, serie: nota.serie,
      emitidaEm: nota.emitidaEm, valorTotal: nota.valorTotal, emitente: nota.emitente,
    },
    fornecedor: fornecedor || null,
    fornecedorSugerido: fornecedor ? null : {
      nome: nota.emitente.nome,
      cnpj: nota.emitente.cnpj,
      telefone: nota.emitente.telefone,
      email: nota.emitente.email,
    },
    itens: aplicarDePara(nota, mapa || []),
    duplicatas: nota.duplicatas,
    jaVinculada: Boolean(recebimentoExistente),
  });
}
```

Observação sobre o CNPJ: `fornecedores.cnpj` é texto livre no schema atual e pode
estar gravado com pontuação. Se o casamento falhar em produção por causa disso, a
correção é normalizar a coluna numa migração à parte — não invente `replace` no
`.eq()`, que o PostgREST não suporta.

- [ ] **Step 2: Verificar que o build passa**

Rodar: `npm run verify`
Esperado: testes PASS e build sem erro.

- [ ] **Step 3: Commit**

```bash
git add "app/api/nfe/documentos/[chave]/preparar/route.js"
git commit -m "feat(nfe): rota que monta o rascunho de recebimento a partir da nota"
```

---

## Task 7: Importar a nota no formulário de Recebimento

**Files:**
- Create: `components/ImportarNota.js`
- Modify: `app/recebimentos/page.js`

**Interfaces:**
- Consumes: `POST /api/nfe/upload` e `GET /api/nfe/documentos/{chave}/preparar` (Tasks 5 e 6),
  `parcelasDoRecebimento` (Task 3), tabelas da Task 4.
- Produces: `<ImportarNota empresaId onImportado />`, onde `onImportado(dados)` recebe
  exatamente o corpo devolvido por `/preparar`. Consumido também pela tela de caixa de
  entrada na Task 14, via `?chave=` na URL de `/recebimentos`.

Esta é a tarefa que entrega valor sem certificado nenhum: com o XML que o fornecedor
manda por e-mail, o recebimento já para de ser digitado.

- [ ] **Step 1: Criar o componente de importação**

Criar `components/ImportarNota.js`:

```jsx
'use client';
import { useState } from 'react';
import { supabase } from '../lib/supabase';

// Bloco no topo do formulário de recebimento. Nesta fase aceita o XML enviado à
// mão; a busca por chave e a caixa de entrada entram nas tarefas seguintes.
export default function ImportarNota({ empresaId, onImportado }) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');

  async function comToken(url, opcoes = {}) {
    const { data: { session } } = await supabase.auth.getSession();
    return fetch(url, {
      ...opcoes,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        ...(opcoes.headers || {}),
      },
    });
  }

  async function enviarXml(file) {
    if (!file) return;
    setErro('');
    setOcupado(true);
    try {
      const xml = await file.text();
      const r1 = await comToken('/api/nfe/upload', {
        method: 'POST',
        body: JSON.stringify({ empresaId, xml }),
      });
      const j1 = await r1.json();
      if (!r1.ok) { setErro(j1.error); return; }
      if (j1.aviso) { setErro(j1.aviso); return; }

      const r2 = await comToken(`/api/nfe/documentos/${j1.documento.chave}/preparar?empresaId=${empresaId}`);
      const j2 = await r2.json();
      if (!r2.ok) { setErro(j2.error); return; }
      if (j2.jaVinculada) { setErro('Esta nota já foi lançada em outro recebimento.'); return; }
      onImportado(j2);
    } catch (e) {
      setErro('Falha ao importar: ' + e.message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <strong>Importar nota fiscal</strong>
      <p className="muted" style={{ margin: '4px 0 10px' }}>
        Envie o XML da NF-e e o formulário abaixo vem preenchido.
      </p>
      <label className="btn">
        {ocupado ? 'Lendo…' : 'Enviar XML'}
        <input type="file" accept=".xml,text/xml,application/xml" style={{ display: 'none' }}
          disabled={ocupado}
          onChange={e => { enviarXml(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
      {erro && <p style={{ color: 'var(--bad, #c0392b)', marginTop: 8 }}>{erro}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Guardar a nota importada no estado da página**

Em `app/recebimentos/page.js`, dentro de `function Conteudo`, logo depois de
`const proximaKey = useRef(0);`, acrescentar:

```jsx
  const [notaImportada, setNotaImportada] = useState(null); // corpo de /preparar
  const [itensPendentes, setItensPendentes] = useState([]); // itens da nota sem de-para
```

E no topo do arquivo, junto dos demais imports:

```jsx
import ImportarNota from '../../components/ImportarNota';
import { parcelasDoRecebimento } from '../../lib/nfe/parcelas';
```

- [ ] **Step 3: Aplicar a nota importada ao formulário**

Ainda em `Conteudo`, acrescentar as duas funções abaixo (antes de `adicionarItem`):

```jsx
  // Recebe o corpo de /preparar: preenche o cabeçalho, joga os itens já mapeados
  // direto no staging e deixa os não mapeados numa fila de casamento.
  function aplicarNotaImportada(dados) {
    setNotaImportada(dados);
    setHeader(h => ({
      ...h,
      data: (dados.nota.emitidaEm || '').slice(0, 10) || h.data,
      nota_fiscal: dados.nota.numero || h.nota_fiscal,
      fornecedor_id: dados.fornecedor?.id || '',
    }));

    const mapeados = dados.itens.filter(i => i.mapeado);
    const pendentes = dados.itens.filter(i => !i.mapeado);
    setItensPendentes(pendentes.map(i => ({ ...i, materiaPrimaId: '', fatorConversao: 1 })));
    mapeados.forEach(empilharItemDaNota);

    if (!dados.fornecedor && dados.fornecedorSugerido) {
      alert(`Fornecedor ${dados.fornecedorSugerido.nome} (CNPJ ${dados.fornecedorSugerido.cnpj}) `
        + 'ainda não está cadastrado. Cadastre em Fornecedores e importe a nota de novo.');
    }
  }

  // Um item da nota vira uma linha do staging. O peso conferido fica VAZIO de
  // propósito: quem preenche é a balança, e a divergência com a nota tem que aparecer.
  function empilharItemDaNota(item) {
    const mp = mps.find(m => m.id === item.materiaPrimaId);
    if (!mp) return;
    proximaKey.current += 1;
    setItens(anteriores => [...anteriores, {
      ...ITEM_VAZIO(),
      materia_prima_id: item.materiaPrimaId,
      quantidade: '',
      peso_nota_kg: String(item.pesoNotaKg),
      custo_unitario: String(item.custoUnitario),
      _key: proximaKey.current,
      _mp: mp,
      _nfe: { codigo: item.codigo, descricao: item.descricao, unidadeNota: item.unidadeNota, fatorConversao: item.fatorConversao },
    }]);
  }

  // Casa um item pendente com a matéria-prima escolhida e o manda para o staging.
  function confirmarItemPendente(indice) {
    const item = itensPendentes.find(i => i.indice === indice);
    if (!item?.materiaPrimaId) { alert('Escolha a matéria-prima deste item.'); return; }
    const fator = Number(item.fatorConversao) > 0 ? Number(item.fatorConversao) : 1;
    const pesoNotaKg = Math.round(item.quantidadeNota * fator * 10000) / 10000;
    empilharItemDaNota({
      ...item,
      fatorConversao: fator,
      pesoNotaKg,
      custoUnitario: pesoNotaKg > 0 ? Math.round((item.valorTotalItem / pesoNotaKg) * 100) / 100 : 0,
    });
    setItensPendentes(lista => lista.filter(i => i.indice !== indice));
  }
```

- [ ] **Step 4: Renderizar o bloco de importação e a fila de pendentes**

Dentro do JSX de `Conteudo`, imediatamente antes do formulário de cabeçalho do
recebimento, inserir:

```jsx
      <ImportarNota empresaId={empresaAtual?.id} onImportado={aplicarNotaImportada} />

      {notaImportada && (
        <p className="muted">
          Nota {notaImportada.nota.numero} de {notaImportada.nota.emitente.nome} — total{' '}
          {fmtMoney(notaImportada.nota.valorTotal)}
          {notaImportada.duplicatas.length > 0
            && ` · ${notaImportada.duplicatas.length} parcela(s) na nota`}
        </p>
      )}

      {itensPendentes.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <strong>Itens da nota sem matéria-prima ({itensPendentes.length})</strong>
          <p className="muted">
            Case cada item uma vez; nas próximas notas deste fornecedor ele já vem preenchido.
          </p>
          {itensPendentes.map(item => (
            <div key={item.indice} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
              <span style={{ minWidth: 260 }}>
                {item.codigo} — {item.descricao} ({item.quantidadeNota} {item.unidadeNota})
              </span>
              <select value={item.materiaPrimaId}
                onChange={e => setItensPendentes(lista => lista.map(i =>
                  i.indice === item.indice ? { ...i, materiaPrimaId: e.target.value } : i))}>
                <option value="">Matéria-prima…</option>
                {mps.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
              </select>
              <label>
                {item.unidadeNota} → kg
                <input type="number" step="0.0001" min="0.0001" style={{ width: 90, marginLeft: 6 }}
                  value={item.fatorConversao}
                  onChange={e => setItensPendentes(lista => lista.map(i =>
                    i.indice === item.indice ? { ...i, fatorConversao: e.target.value } : i))} />
              </label>
              <button type="button" onClick={() => confirmarItemPendente(item.indice)}>Casar item</button>
            </div>
          ))}
        </div>
      )}
```

- [ ] **Step 5: Gravar a chave, o de-para e as parcelas da nota ao registrar**

Em `registrar`, três mudanças pontuais.

**(a)** No insert de `recebimentos`, acrescentar as duas colunas novas:

```jsx
      const { data: cabecalho, error: errCabecalho } = await supabase.from('recebimentos').insert([{
        data: header.data,
        fornecedor_id: header.fornecedor_id || null,
        nota_fiscal: header.nota_fiscal || null,
        responsavel_id: header.responsavel_id || null,
        empresa_id: empresaAtual.id,
        nfe_chave: notaImportada?.nota.chave || null,
        nfe_documento_id: notaImportada?.documento.id || null,
      }]).select('id').single();
```

**(b)** Trocar a geração de parcelas. Substituir estas duas linhas:

```jsx
          const numeroParcelas = header.condicao_pagamento === 'Parcelado' ? Number(header.numero_parcelas) : 1;
          const parcelas = gerarParcelas(header.data, totalAceito, numeroParcelas, Number(header.intervalo_dias));
```

por:

```jsx
          const numeroParcelas = header.condicao_pagamento === 'Parcelado' ? Number(header.numero_parcelas) : 1;
          const { origem, parcelas } = parcelasDoRecebimento({
            duplicatas: notaImportada?.duplicatas || [],
            dataBase: header.data,
            valorLancado: totalAceito,
            valorTotalNota: notaImportada?.nota.valorTotal ?? totalAceito,
            numeroParcelas,
            intervaloDias: Number(header.intervalo_dias),
          });
          if (origem === 'manual_divergencia') {
            alert('O valor aceito ficou diferente do total da nota (item rejeitado?), '
              + 'então as parcelas seguiram a condição informada, e não os vencimentos da nota.');
          }
```

`gerarParcelas` continua importado porque `parcelasDoRecebimento` o usa por baixo; o
import direto em `page.js` pode sair se nenhum outro trecho usar.

**(c)** Depois do bloco de contas a pagar, antes de `setHeader(HEADER_VAZIO())`,
gravar o de-para aprendido e marcar a nota como vinculada:

```jsx
      if (notaImportada) {
        const aprender = itens
          .filter(it => it._nfe)
          .map(it => ({
            empresa_id: empresaAtual.id,
            cnpj_emitente: notaImportada.nota.emitente.cnpj,
            codigo_produto: it._nfe.codigo,
            materia_prima_id: it.materia_prima_id,
            unidade_nf: it._nfe.unidadeNota,
            fator_conversao: it._nfe.fatorConversao,
          }));
        if (aprender.length) {
          const { error: errMapa } = await supabase.from('fornecedor_produto_mapa')
            .upsert(aprender, { onConflict: 'empresa_id,cnpj_emitente,codigo_produto' });
          if (errMapa) alert('Recebimento salvo, mas o de-para não foi gravado: ' + errMapa.message);
        }
        await supabase.from('nfe_documentos')
          .update({ status: 'vinculada', recebimento_id: cabecalho.id })
          .eq('id', notaImportada.documento.id);
      }
```

E no reset ao fim do `try`, junto de `setItens([])`:

```jsx
      setNotaImportada(null);
      setItensPendentes([]);
```

- [ ] **Step 6: Verificar**

Rodar: `npm run verify`
Esperado: testes PASS e build sem erro.

Teste manual, com o servidor de desenvolvimento: abrir Recebimento, enviar um XML de
NF-e real de fornecedor conhecido e conferir que o cabeçalho vem preenchido, que o
peso conferido está vazio, que o peso da nota bate com a quantidade convertida, e que
ao registrar o de-para é gravado. Importar uma segunda nota do mesmo fornecedor: os
itens devem vir casados sozinhos.

- [ ] **Step 7: Commit**

```bash
git add components/ImportarNota.js app/recebimentos/page.js
git commit -m "feat(recebimento): importar NF-e por XML e aprender o de-para de itens"
```

---

# Fase 2 — Certificado digital e SEFAZ

## Task 8: Cifra do certificado e migração da tabela

**Files:**
- Create: `lib/nfe/cripto.js`
- Create: `tests/nfe-cripto.test.mjs`
- Create: `supabase/atualizacao_22_certificado_digital.sql`

**Interfaces:**
- Consumes: `node:crypto`.
- Produces: `chaveMestra() -> Buffer`, `cifrar(dados: Buffer|string, chave: Buffer) -> { conteudo, iv, tag }`
  (os três em base64) e `decifrar({ conteudo, iv, tag }, chave) -> Buffer`.
  Tabela `certificados_digitais`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/nfe-cripto.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { cifrar, decifrar, chaveMestra } from '../lib/nfe/cripto.js';

const CHAVE = crypto.randomBytes(32);

test('cifrar/decifrar: round-trip de texto', () => {
  const caixa = cifrar('senha-do-certificado', CHAVE);
  assert.equal(decifrar(caixa, CHAVE).toString('utf8'), 'senha-do-certificado');
});

test('cifrar/decifrar: round-trip de binário', () => {
  const pfx = crypto.randomBytes(4096);
  const caixa = cifrar(pfx, CHAVE);
  assert.deepEqual(decifrar(caixa, CHAVE), pfx);
});

test('cada cifragem usa um IV novo', () => {
  assert.notEqual(cifrar('x', CHAVE).iv, cifrar('x', CHAVE).iv);
});

test('tag adulterada faz a decifragem falhar', () => {
  const caixa = cifrar('segredo', CHAVE);
  const outra = cifrar('outro segredo qualquer', CHAVE);
  assert.throws(() => decifrar({ ...caixa, tag: outra.tag }, CHAVE));
});

test('chave errada faz a decifragem falhar', () => {
  const caixa = cifrar('segredo', CHAVE);
  assert.throws(() => decifrar(caixa, crypto.randomBytes(32)));
});

test('chaveMestra recusa env var fora do formato', () => {
  const antes = process.env.NFE_CERT_MASTER_KEY;
  process.env.NFE_CERT_MASTER_KEY = 'curta-demais';
  assert.throws(() => chaveMestra(), /NFE_CERT_MASTER_KEY/);
  process.env.NFE_CERT_MASTER_KEY = crypto.randomBytes(32).toString('hex');
  assert.equal(chaveMestra().length, 32);
  if (antes === undefined) delete process.env.NFE_CERT_MASTER_KEY;
  else process.env.NFE_CERT_MASTER_KEY = antes;
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Rodar: `npm test`
Esperado: FAIL com `Cannot find module '../lib/nfe/cripto.js'`.

- [ ] **Step 3: Implementar a cifra**

Criar `lib/nfe/cripto.js`:

```js
// AES-256-GCM para o certificado A1. GCM porque a autenticação vem junto: se o
// ciphertext for adulterado no banco, a decifragem falha em vez de devolver lixo.
//
// A chave mestra fica em env var da Vercel, nunca no banco — quem tiver dump do
// banco ainda não tem o certificado.
import crypto from 'node:crypto';

const ALGORITMO = 'aes-256-gcm';

export function chaveMestra() {
  const hex = process.env.NFE_CERT_MASTER_KEY || '';
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('NFE_CERT_MASTER_KEY ausente ou fora do formato (64 caracteres hexadecimais).');
  }
  return Buffer.from(hex, 'hex');
}

export function cifrar(dados, chave) {
  const iv = crypto.randomBytes(12);
  const cifra = crypto.createCipheriv(ALGORITMO, chave, iv);
  const entrada = Buffer.isBuffer(dados) ? dados : Buffer.from(String(dados), 'utf8');
  const conteudo = Buffer.concat([cifra.update(entrada), cifra.final()]);
  return {
    conteudo: conteudo.toString('base64'),
    iv: iv.toString('base64'),
    tag: cifra.getAuthTag().toString('base64'),
  };
}

export function decifrar({ conteudo, iv, tag }, chave) {
  const decifra = crypto.createDecipheriv(ALGORITMO, chave, Buffer.from(iv, 'base64'));
  decifra.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decifra.update(Buffer.from(conteudo, 'base64')), decifra.final()]);
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Rodar: `npm test`
Esperado: PASS nos 6 testes de `nfe-cripto`.

- [ ] **Step 5: Escrever a migração da tabela**

Criar `supabase/atualizacao_22_certificado_digital.sql`:

```sql
-- =========================================================
-- 364 — ATUALIZAÇÃO 22: CERTIFICADO DIGITAL A1
-- Guarda o certificado da empresa cifrado (AES-256-GCM), para falar com os
-- webservices da SEFAZ por mTLS.
--
-- ATENÇÃO: esta tabela é fechada no RLS. Nem administrador lê pelo client.
-- Só o service role (rotas em app/api/nfe/*) alcança o conteúdo, e a chave de
-- decifragem fica em env var da Vercel (NFE_CERT_MASTER_KEY), fora do banco.
--
-- Rode depois de atualizacao_21_nfe_documentos.sql.
-- =========================================================

begin;

create table if not exists public.certificados_digitais (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  cnpj text not null,
  pfx_cifrado text not null,
  pfx_iv text not null,
  pfx_tag text not null,
  senha_cifrada text not null,
  senha_iv text not null,
  senha_tag text not null,
  titular text,
  valido_de timestamptz not null,
  valido_ate timestamptz not null,
  ativo boolean not null default true,
  criado_por uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Um certificado ativo por empresa. Subir um novo desativa o anterior (a rota faz
-- o update antes do insert); o histórico fica para auditoria.
create unique index if not exists certificados_digitais_ativo_idx
  on public.certificados_digitais (empresa_id) where ativo;

alter table public.certificados_digitais enable row level security;

-- Fechada de propósito: nenhuma policy permissiva. O service role passa por cima
-- do RLS e é o único caminho de leitura.
drop policy if exists "certificado_sem_acesso_client" on public.certificados_digitais;
create policy "certificado_sem_acesso_client" on public.certificados_digitais
  for all using (false) with check (false);

commit;
```

- [ ] **Step 6: Rodar a migração e conferir**

Executar o arquivo no SQL Editor do Supabase. Depois, ainda logado como usuário
comum na aplicação, confirmar no console do navegador que a tabela é inacessível:

```js
await supabase.from('certificados_digitais').select('id');
```

Esperado: lista vazia ou erro de permissão — nunca uma linha.

- [ ] **Step 7: Gerar e configurar a chave mestra**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Guardar a saída como `NFE_CERT_MASTER_KEY` no `.env.local` e nas variáveis de
ambiente da Vercel (Production e Preview). Perder essa chave significa perder o
acesso ao certificado guardado — nesse caso, subir o `.pfx` de novo.

- [ ] **Step 8: Commit**

```bash
git add lib/nfe/cripto.js tests/nfe-cripto.test.mjs supabase/atualizacao_22_certificado_digital.sql
git commit -m "feat(nfe): cifra AES-256-GCM e tabela do certificado digital"
```

---

## Task 9: Leitura, guarda e carga do certificado A1

**Files:**
- Create: `lib/nfe/certificadoServer.js`
- Create: `app/api/nfe/certificado/route.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `cifrar`/`decifrar`/`chaveMestra` (Task 8), `garantirEmpresa` (Task 5), tabela da Task 8.
- Produces:
  - `lerPfx(pfx: Buffer, senha: string) -> { certPem, keyPem, titular, cnpj, validoDe: Date, validoAte: Date }`;
  - `carregarCertificado(sb, empresaId) -> { pfx: Buffer, senha, cnpj, certPem, keyPem, validoAte }`
    (lança `Error` com mensagem pronta quando não há certificado ativo ou ele venceu);
  - `POST /api/nfe/certificado` body `{ empresaId, pfxBase64, senha }` → `{ certificado: metadados }`;
  - `GET /api/nfe/certificado?empresaId=` → `{ certificado: metadados | null }`, onde
    metadados é `{ id, cnpj, titular, valido_de, valido_ate, dias_para_vencer }`.

**Regra de manuseio:** a senha do certificado é digitada pela pessoa dona da empresa na
própria tela. Ela não entra em código, em commit, em log, em teste nem em mensagem de
erro. Quem implementar esta tarefa não precisa (e não deve) ter o `.pfx` real em mãos —
para testar, gere um PKCS#12 descartável com `openssl`.

- [ ] **Step 1: Instalar a leitura de PKCS#12**

```bash
npm install node-forge@^1.3.1
```

- [ ] **Step 2: Implementar a camada de certificado**

Criar `lib/nfe/certificadoServer.js`:

```js
// Camada de certificado A1. SÓ SERVIDOR — nunca importar em componente client.
//
// O .pfx e a senha ficam cifrados no banco; aqui eles são decifrados em memória,
// usados e descartados. Nada disso pode ser logado, serializado em resposta HTTP
// ou escrito em disco.
import forge from 'node-forge';
import { cifrar, decifrar, chaveMestra } from './cripto.js';

// Extrai certificado, chave privada e identidade de um PKCS#12 (.pfx/.p12).
export function lerPfx(pfx, senha) {
  let p12;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfx.toString('binary')));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, senha);
  } catch {
    // Mensagem genérica de propósito: não distinguir "arquivo inválido" de "senha errada"
    // e, principalmente, não ecoar nada do conteúdo.
    throw new Error('Não consegui abrir o certificado. Confira o arquivo e a senha.');
  }

  const bagsCert = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  const bagsChave = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [];
  const cert = bagsCert.map(b => b.cert).find(c => c?.privateKey || c);
  const chave = bagsChave[0]?.key;
  if (!cert || !chave) throw new Error('Certificado sem par de chaves utilizável.');

  const titular = cert.subject.getField('CN')?.value || '';
  // No padrão ICP-Brasil o CN de e-CNPJ/e-NFe termina em ":CNPJ", ex.:
  // "364 FOOD SERVICES LTDA:12345678000199".
  const cnpj = (titular.match(/(\d{14})/) || [])[1] || '';
  if (!cnpj) throw new Error('Não encontrei o CNPJ no certificado — ele é mesmo um e-CNPJ ou e-NFe?');

  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(chave),
    titular,
    cnpj,
    validoDe: cert.validity.notBefore,
    validoAte: cert.validity.notAfter,
  };
}

export function cifrarCertificado(pfx, senha) {
  const chave = chaveMestra();
  const caixaPfx = cifrar(pfx, chave);
  const caixaSenha = cifrar(senha, chave);
  return {
    pfx_cifrado: caixaPfx.conteudo, pfx_iv: caixaPfx.iv, pfx_tag: caixaPfx.tag,
    senha_cifrada: caixaSenha.conteudo, senha_iv: caixaSenha.iv, senha_tag: caixaSenha.tag,
  };
}

// Carrega o certificado ativo da empresa, pronto para uso em mTLS e assinatura.
export async function carregarCertificado(sb, empresaId) {
  const { data } = await sb.from('certificados_digitais')
    .select('*').eq('empresa_id', empresaId).eq('ativo', true).maybeSingle();
  if (!data) throw new Error('Nenhum certificado digital configurado para esta empresa.');
  if (new Date(data.valido_ate) < new Date()) {
    throw new Error(`O certificado venceu em ${new Date(data.valido_ate).toLocaleDateString('pt-BR')}. Suba o novo A1.`);
  }

  const chave = chaveMestra();
  const pfx = decifrar({ conteudo: data.pfx_cifrado, iv: data.pfx_iv, tag: data.pfx_tag }, chave);
  const senha = decifrar({ conteudo: data.senha_cifrada, iv: data.senha_iv, tag: data.senha_tag }, chave).toString('utf8');
  const { certPem, keyPem } = lerPfx(pfx, senha);

  return { pfx, senha, cnpj: data.cnpj, certPem, keyPem, validoAte: data.valido_ate };
}
```

- [ ] **Step 3: Criar a rota do certificado**

Criar `app/api/nfe/certificado/route.js`:

```js
import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../../lib/pontoServer';
import { garantirEmpresa } from '../../../../lib/nfe/autorizacao';
import { lerPfx, cifrarCertificado } from '../../../../lib/nfe/certificadoServer';

export const runtime = 'nodejs';

const LIMITE_PFX = 512 * 1024;

function metadados(linha) {
  if (!linha) return null;
  return {
    id: linha.id,
    cnpj: linha.cnpj,
    titular: linha.titular,
    valido_de: linha.valido_de,
    valido_ate: linha.valido_ate,
    dias_para_vencer: Math.ceil((new Date(linha.valido_ate) - new Date()) / 86400000),
  };
}

// GET: metadados do certificado ativo. Nunca devolve material criptográfico.
export async function GET(request) {
  const { sb, user, isAdmin, erro } = await autorizarModulo(request, 'recebimentos');
  if (erro) return erro;

  const empresaId = new URL(request.url).searchParams.get('empresaId');
  try {
    await garantirEmpresa(sb, user, isAdmin, empresaId);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 403 });
  }

  const { data } = await sb.from('certificados_digitais')
    .select('id, cnpj, titular, valido_de, valido_ate')
    .eq('empresa_id', empresaId).eq('ativo', true).maybeSingle();
  return NextResponse.json({ certificado: metadados(data) });
}

// POST: sobe um novo A1. Só admin — é a credencial fiscal da empresa inteira.
export async function POST(request) {
  const { sb, user, isAdmin, erro } = await autorizarModulo(request, 'recebimentos');
  if (erro) return erro;
  if (!isAdmin) {
    return NextResponse.json({ error: 'Só administrador pode configurar o certificado digital.' }, { status: 403 });
  }

  const { empresaId, pfxBase64, senha } = await request.json();
  try {
    await garantirEmpresa(sb, user, isAdmin, empresaId);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 403 });
  }
  if (!pfxBase64 || !senha) {
    return NextResponse.json({ error: 'Envie o arquivo .pfx e a senha.' }, { status: 400 });
  }

  const pfx = Buffer.from(pfxBase64, 'base64');
  if (pfx.length > LIMITE_PFX) {
    return NextResponse.json({ error: 'Arquivo grande demais para ser um certificado A1.' }, { status: 400 });
  }

  let lido;
  try {
    lido = lerPfx(pfx, senha);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  if (lido.validoAte < new Date()) {
    return NextResponse.json({ error: 'Este certificado já venceu.' }, { status: 400 });
  }

  const { data: empresa } = await sb.from('empresas').select('cnpj, nome').eq('id', empresaId).maybeSingle();
  const cnpjEmpresa = String(empresa?.cnpj || '').replace(/\D/g, '');
  if (cnpjEmpresa && cnpjEmpresa !== lido.cnpj) {
    return NextResponse.json({
      error: `O certificado é do CNPJ ${lido.cnpj}, mas a empresa ${empresa.nome} está cadastrada com ${cnpjEmpresa}.`,
    }, { status: 400 });
  }

  let cifrado;
  try {
    cifrado = cifrarCertificado(pfx, senha);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

  // Desativa o anterior antes de inserir: o índice único parcial exige um só ativo.
  await sb.from('certificados_digitais').update({ ativo: false })
    .eq('empresa_id', empresaId).eq('ativo', true);

  const { data, error } = await sb.from('certificados_digitais').insert([{
    empresa_id: empresaId,
    cnpj: lido.cnpj,
    titular: lido.titular,
    valido_de: lido.validoDe.toISOString(),
    valido_ate: lido.validoAte.toISOString(),
    ativo: true,
    criado_por: user.id,
    ...cifrado,
  }]).select('id, cnpj, titular, valido_de, valido_ate').single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ certificado: metadados(data) });
}
```

- [ ] **Step 4: Verificar com um certificado descartável**

Gerar um PKCS#12 de teste, com CN no formato ICP-Brasil:

```bash
openssl req -x509 -newkey rsa:2048 -keyout /tmp/t.key -out /tmp/t.crt -days 30 -nodes -subj "/CN=EMPRESA TESTE LTDA:12345678000199"
```

```bash
openssl pkcs12 -export -inkey /tmp/t.key -in /tmp/t.crt -out /tmp/t.pfx -passout pass:teste123
```

Com `npm run dev` rodando e logado como admin, subir pela rota (o token sai de
`(await supabase.auth.getSession()).data.session.access_token` no console do navegador)
e confirmar que a resposta traz `titular`, `cnpj` e `valido_ate`, e nenhum campo com
material do certificado. Depois conferir no Supabase que `pfx_cifrado` não se parece
com o arquivo original.

Rodar também: `npm run verify` — testes PASS e build sem erro.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json lib/nfe/certificadoServer.js app/api/nfe/certificado/route.js
git commit -m "feat(nfe): guarda cifrada e carga do certificado digital A1"
```

---

## Task 10: Envelopes e transporte do NFeDistribuicaoDFe

**Files:**
- Create: `lib/sefaz/endpoints.js`
- Create: `lib/sefaz/envelopes.js`
- Create: `lib/sefaz/transporte.js`
- Create: `tests/sefaz-envelopes.test.mjs`
- Create: `tests/fixtures/dist-retorno.xml` (gerado por script, ver Step 2)
- Modify: `package.json`

**Interfaces:**
- Consumes: nada de outras tasks.
- Produces:
  - `montarEnvelopeDistribuicao({ cnpj, ufAutor, ambiente, ultNSU, chave }) -> string`;
  - `lerRetornoDistribuicao(xml) -> { cStat, xMotivo, ultNSU, maxNSU, documentos: [{ nsu, schema, xml }] }`;
  - `chamarSefaz({ url, envelope, pfx, senha }) -> Promise<string>`;
  - constantes `URLS.distribuicao`, `URLS.recepcaoEvento`, `AMBIENTE.producao = '1'`.

- [ ] **Step 1: Instalar o cliente HTTP com mTLS**

```bash
npm install undici@^6.19.8
```

O `fetch` embutido do Node não aceita agente TLS customizado, então a chamada com
certificado precisa do `undici` explícito.

- [ ] **Step 2: Gerar a fixture de retorno**

O `docZip` da SEFAZ vem em base64 de um gzip. Gerar a fixture com um script, para o
conteúdo bater de verdade com o que o código vai descompactar:

```bash
node -e "
const zlib=require('zlib'),fs=require('fs');
const resumo='<resNFe versao=\"1.01\"><chNFe>35260812345678000199550010000012341000012348</chNFe><CNPJ>12345678000199</CNPJ><xNome>Frigorifico Exemplo LTDA</xNome><vNF>2757.00</vNF></resNFe>';
const zip=zlib.gzipSync(Buffer.from(resumo,'utf8')).toString('base64');
fs.writeFileSync('tests/fixtures/dist-retorno.xml',
'<?xml version=\"1.0\" encoding=\"utf-8\"?>'+
'<soap:Envelope xmlns:soap=\"http://www.w3.org/2003/05/soap-envelope\"><soap:Body>'+
'<nfeDistDFeInteresseResponse xmlns=\"http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe\">'+
'<nfeDistDFeInteresseResult><retDistDFeInt xmlns=\"http://www.portalfiscal.inf.br/nfe\" versao=\"1.01\">'+
'<tpAmb>1</tpAmb><verAplic>1.0</verAplic><cStat>138</cStat><xMotivo>Documento localizado</xMotivo>'+
'<ultNSU>000000000000042</ultNSU><maxNSU>000000000000090</maxNSU>'+
'<loteDistDFeInt><docZip NSU=\"000000000000042\" schema=\"resNFe_v1.01.xsd\">'+zip+'</docZip></loteDistDFeInt>'+
'</retDistDFeInt></nfeDistDFeInteresseResult></nfeDistDFeInteresseResponse></soap:Body></soap:Envelope>');
console.log('fixture gerada');
"
```

- [ ] **Step 3: Escrever o teste que falha**

Criar `tests/sefaz-envelopes.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { montarEnvelopeDistribuicao, lerRetornoDistribuicao } from '../lib/sefaz/envelopes.js';

test('envelope por NSU: consulta incremental com ultNSU preenchido com zeros', () => {
  const env = montarEnvelopeDistribuicao({ cnpj: '98765432000188', ufAutor: '35', ambiente: '1', ultNSU: 42 });
  assert.match(env, /<distNSU><ultNSU>000000000000042<\/ultNSU><\/distNSU>/);
  assert.match(env, /<CNPJ>98765432000188<\/CNPJ>/);
  assert.match(env, /<tpAmb>1<\/tpAmb>/);
  assert.match(env, /versao="1.01"/);
  assert.ok(!env.includes('consChNFe'));
});

test('envelope por chave: consulta pontual', () => {
  const chave = '35260812345678000199550010000012341000012348';
  const env = montarEnvelopeDistribuicao({ cnpj: '98765432000188', ufAutor: '35', ambiente: '1', chave });
  assert.match(env, new RegExp(`<consChNFe><chNFe>${chave}</chNFe></consChNFe>`));
  assert.ok(!env.includes('distNSU'));
});

test('envelope: chave inválida é recusada antes de sair para a rede', () => {
  assert.throws(
    () => montarEnvelopeDistribuicao({ cnpj: '98765432000188', ufAutor: '35', ambiente: '1', chave: '123' }),
    /Chave/,
  );
});

test('lerRetornoDistribuicao: status, ponteiros e docZip descompactado', () => {
  const xml = readFileSync(new URL('./fixtures/dist-retorno.xml', import.meta.url), 'utf8');
  const r = lerRetornoDistribuicao(xml);
  assert.equal(r.cStat, '138');
  assert.equal(r.ultNSU, '000000000000042');
  assert.equal(r.maxNSU, '000000000000090');
  assert.equal(r.documentos.length, 1);
  assert.equal(r.documentos[0].nsu, '000000000000042');
  assert.match(r.documentos[0].schema, /^resNFe/);
  assert.match(r.documentos[0].xml, /<chNFe>35260812345678000199550010000012341000012348<\/chNFe>/);
});

test('lerRetornoDistribuicao: lote vazio (cStat 137) devolve lista vazia', () => {
  const xml = readFileSync(new URL('./fixtures/dist-retorno.xml', import.meta.url), 'utf8')
    .replace(/<loteDistDFeInt>[\s\S]*?<\/loteDistDFeInt>/, '')
    .replace('<cStat>138</cStat>', '<cStat>137</cStat>');
  const r = lerRetornoDistribuicao(xml);
  assert.equal(r.cStat, '137');
  assert.deepEqual(r.documentos, []);
});
```

- [ ] **Step 4: Rodar o teste e confirmar que falha**

Rodar: `npm test`
Esperado: FAIL com `Cannot find module '../lib/sefaz/envelopes.js'`.

- [ ] **Step 5: Implementar endpoints, envelopes e transporte**

Criar `lib/sefaz/endpoints.js`:

```js
// URLs e constantes dos webservices da SEFAZ, num lugar só.
//
// A distribuição de DF-e e a recepção de eventos de manifestação ficam no
// Ambiente Nacional: endpoint único, sem variação por UF.
//
// ANTES DE IR PARA PRODUÇÃO: conferir estas URLs e a versão dos serviços contra
// o Manual de Orientação do Contribuinte vigente e a lista de webservices do
// Portal da NF-e. Elas mudam de versão de tempos em tempos.
export const AMBIENTE = { producao: '1', homologacao: '2' };

export const URLS = {
  distribuicao: 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
  recepcaoEvento: 'https://www1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
};

// Códigos de retorno que o fluxo trata explicitamente.
export const C_STAT = {
  nenhumDocumento: '137',
  documentoLocalizado: '138',
  consumoIndevido: '656',
};

// Código do Ambiente Nacional, usado como cOrgao nos eventos de manifestação.
export const ORGAO_AN = '91';
```

Criar `lib/sefaz/envelopes.js`:

```js
// Montagem e leitura dos envelopes SOAP do NFeDistribuicaoDFe.
// Puro: sem rede, sem certificado. É o que os testes cobrem.
import zlib from 'node:zlib';
import { XMLParser } from 'fast-xml-parser';

const NS_NFE = 'http://www.portalfiscal.inf.br/nfe';
const NS_SERVICO = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  removeNSPrefix: true, // a resposta vem com prefixos variáveis (soap:, soap12:)
  trimValues: true,
});

function lista(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

// A SEFAZ espera o NSU com 15 dígitos, zeros à esquerda inclusive.
function nsu15(v) {
  return String(v ?? 0).replace(/\D/g, '').padStart(15, '0').slice(-15);
}

export function montarEnvelopeDistribuicao({ cnpj, ufAutor, ambiente, ultNSU, chave }) {
  let consulta;
  if (chave) {
    if (!/^\d{44}$/.test(String(chave))) throw new Error('Chave de acesso deve ter 44 dígitos.');
    consulta = `<consChNFe><chNFe>${chave}</chNFe></consChNFe>`;
  } else {
    consulta = `<distNSU><ultNSU>${nsu15(ultNSU)}</ultNSU></distNSU>`;
  }

  const dist = `<distDFeInt xmlns="${NS_NFE}" versao="1.01">`
    + `<tpAmb>${ambiente}</tpAmb>`
    + `<cUFAutor>${ufAutor}</cUFAutor>`
    + `<CNPJ>${String(cnpj).replace(/\D/g, '')}</CNPJ>`
    + `${consulta}`
    + `</distDFeInt>`;

  return '<?xml version="1.0" encoding="utf-8"?>'
    + '<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body>'
    + `<nfeDistDFeInteresse xmlns="${NS_SERVICO}"><nfeDadosMsg>${dist}</nfeDadosMsg></nfeDistDFeInteresse>`
    + '</soap12:Body></soap12:Envelope>';
}

// Procura uma tag em qualquer profundidade — o encaixe exato do retorno varia
// entre implementações do serviço, e não vale a pena depender do caminho.
function achar(no, nome) {
  if (!no || typeof no !== 'object') return null;
  if (nome in no) return no[nome];
  for (const valor of Object.values(no)) {
    const achado = achar(valor, nome);
    if (achado) return achado;
  }
  return null;
}

export function lerRetornoDistribuicao(xml) {
  const ret = achar(parser.parse(xml), 'retDistDFeInt');
  if (!ret) throw new Error('Resposta da SEFAZ sem retDistDFeInt: ' + String(xml).slice(0, 200));

  return {
    cStat: String(ret.cStat ?? ''),
    xMotivo: String(ret.xMotivo ?? ''),
    ultNSU: String(ret.ultNSU ?? '0'),
    maxNSU: String(ret.maxNSU ?? '0'),
    documentos: lista(ret.loteDistDFeInt?.docZip).map(d => ({
      nsu: String(d['@_NSU'] ?? ''),
      schema: String(d['@_schema'] ?? ''),
      xml: zlib.gunzipSync(Buffer.from(String(d['#text'] ?? d), 'base64')).toString('utf8'),
    })),
  };
}
```

Criar `lib/sefaz/transporte.js`:

```js
// POST autenticado por certificado (mTLS) para os webservices da SEFAZ.
// SÓ SERVIDOR. O fetch nativo do Node não aceita agente TLS, por isso undici.
import { Agent, fetch as fetchTls } from 'undici';

const TIMEOUT_MS = 30000;

export async function chamarSefaz({ url, envelope, pfx, senha }) {
  const agente = new Agent({
    connect: { pfx, passphrase: senha },
    headersTimeout: TIMEOUT_MS,
    bodyTimeout: TIMEOUT_MS,
  });

  try {
    const resposta = await fetchTls(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' },
      body: envelope,
      dispatcher: agente,
    });
    const texto = await resposta.text();
    if (!resposta.ok) {
      // Recorta a resposta: o corpo de erro da SEFAZ é longo e não deve inundar o log.
      throw new Error(`SEFAZ respondeu HTTP ${resposta.status}: ${texto.slice(0, 300)}`);
    }
    return texto;
  } finally {
    await agente.close();
  }
}
```

- [ ] **Step 6: Rodar o teste e confirmar que passa**

Rodar: `npm test`
Esperado: PASS nos 5 testes de `sefaz-envelopes`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json lib/sefaz/ tests/sefaz-envelopes.test.mjs tests/fixtures/dist-retorno.xml
git commit -m "feat(sefaz): envelopes do NFeDistribuicaoDFe e transporte mTLS"
```

---

## Task 11: Assinatura XMLDSig e manifestação de ciência

**Files:**
- Create: `lib/sefaz/assinatura.js`
- Create: `lib/sefaz/manifestacao.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `certPem`/`keyPem` de `carregarCertificado` (Task 9), `chamarSefaz`, `URLS`, `ORGAO_AN` (Task 10).
- Produces:
  - `assinarEvento(xmlEvento, { keyPem, certPem, id }) -> string`;
  - `montarEventoCiencia({ chave, cnpj, ambiente, dataHora, sequencia }) -> { xml, id }`;
  - `manifestarCiencia({ chave, cnpj, ambiente, dataHora, pfx, senha, keyPem, certPem }) -> Promise<{ cStat, xMotivo }>`.

Ciência da Operação (`210210`) apenas declara que a empresa tomou conhecimento da nota.
Não confirma a compra e não impede recusa posterior.

- [ ] **Step 1: Instalar a biblioteca de assinatura**

```bash
npm install xml-crypto@^6.0.0
```

- [ ] **Step 2: Implementar a assinatura**

Criar `lib/sefaz/assinatura.js`:

```js
// Assinatura XMLDSig exigida pelos eventos da NF-e: enveloped, RSA-SHA1, C14N,
// referência ao Id do infEvento. SÓ SERVIDOR.
//
// A API do xml-crypto mudou entre versões maiores; este código é da linha 6.x.
// Se atualizar a dependência, revalidar contra a SEFAZ em homologação.
import { SignedXml } from 'xml-crypto';

const RSA_SHA1 = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';
const SHA1 = 'http://www.w3.org/2000/09/xmldsig#sha1';
const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';

export function assinarEvento(xmlEvento, { keyPem, certPem, id }) {
  if (!id) throw new Error('Id do infEvento é obrigatório para assinar.');

  const assinador = new SignedXml({
    privateKey: keyPem,
    publicCert: certPem,
    signatureAlgorithm: RSA_SHA1,
    canonicalizationAlgorithm: C14N,
  });

  assinador.addReference({
    xpath: "//*[local-name(.)='infEvento']",
    transforms: [ENVELOPED, C14N],
    digestAlgorithm: SHA1,
    uri: `#${id}`,
  });

  assinador.computeSignature(xmlEvento, {
    location: { reference: "//*[local-name(.)='infEvento']", action: 'after' },
  });

  return assinador.getSignedXml();
}
```

- [ ] **Step 3: Implementar a manifestação**

Criar `lib/sefaz/manifestacao.js`:

```js
// Evento 210210 — Ciência da Operação. É o que libera o XML completo da nota
// emitida por terceiro no NFeDistribuicaoDFe. SÓ SERVIDOR.
import { XMLParser } from 'fast-xml-parser';
import { assinarEvento } from './assinatura.js';
import { chamarSefaz } from './transporte.js';
import { URLS, ORGAO_AN } from './endpoints.js';

const NS_NFE = 'http://www.portalfiscal.inf.br/nfe';
const NS_SERVICO = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4';
const TP_EVENTO_CIENCIA = '210210';

const parser = new XMLParser({ removeNSPrefix: true, parseTagValue: false });

function achar(no, nome) {
  if (!no || typeof no !== 'object') return null;
  if (nome in no) return no[nome];
  for (const valor of Object.values(no)) {
    const achado = achar(valor, nome);
    if (achado) return achado;
  }
  return null;
}

export function montarEventoCiencia({ chave, cnpj, ambiente, dataHora, sequencia = 1 }) {
  if (!/^\d{44}$/.test(String(chave))) throw new Error('Chave de acesso deve ter 44 dígitos.');
  const documento = String(cnpj).replace(/\D/g, '');
  const id = `ID${TP_EVENTO_CIENCIA}${chave}${String(sequencia).padStart(2, '0')}`;

  const xml = `<evento xmlns="${NS_NFE}" versao="1.00">`
    + `<infEvento Id="${id}">`
    + `<cOrgao>${ORGAO_AN}</cOrgao><tpAmb>${ambiente}</tpAmb>`
    + `<CNPJ>${documento}</CNPJ><chNFe>${chave}</chNFe>`
    + `<dhEvento>${dataHora}</dhEvento>`
    + `<tpEvento>${TP_EVENTO_CIENCIA}</tpEvento><nSeqEvento>${sequencia}</nSeqEvento>`
    + `<verEvento>1.00</verEvento>`
    + `<detEvento versao="1.00"><descEvento>Ciencia da Operacao</descEvento></detEvento>`
    + `</infEvento></evento>`;

  return { xml, id };
}

export async function manifestarCiencia({ chave, cnpj, ambiente, dataHora, pfx, senha, keyPem, certPem }) {
  const { xml, id } = montarEventoCiencia({ chave, cnpj, ambiente, dataHora });
  const assinado = assinarEvento(xml, { keyPem, certPem, id });

  const lote = `<envEvento xmlns="${NS_NFE}" versao="1.00"><idLote>1</idLote>${assinado}</envEvento>`;
  const envelope = '<?xml version="1.0" encoding="utf-8"?>'
    + '<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body>'
    + `<nfeRecepcaoEvento xmlns="${NS_SERVICO}"><nfeDadosMsg>${lote}</nfeDadosMsg></nfeRecepcaoEvento>`
    + '</soap12:Body></soap12:Envelope>';

  const resposta = await chamarSefaz({ url: URLS.recepcaoEvento, envelope, pfx, senha });
  const arvore = parser.parse(resposta);
  const retorno = achar(arvore, 'infEvento') || achar(arvore, 'retEnvEvento') || {};

  return { cStat: String(retorno.cStat ?? ''), xMotivo: String(retorno.xMotivo ?? '') };
}
```

- [ ] **Step 4: Verificar**

Rodar: `npm run verify`
Esperado: testes PASS e build sem erro.

Estas duas funções só são exercidas de verdade contra o webservice. A validação real
acontece na Task 12, em ambiente de homologação, com o certificado carregado.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json lib/sefaz/assinatura.js lib/sefaz/manifestacao.js
git commit -m "feat(sefaz): assinatura XMLDSig e manifestação de ciência (210210)"
```

---

## Task 12: Sincronização com a SEFAZ

**Files:**
- Create: `lib/nfe/parseResumo.js`
- Create: `tests/nfe-resumo.test.mjs`
- Create: `app/api/nfe/sincronizar/route.js`

**Interfaces:**
- Consumes: Tasks 4, 5, 9, 10, 11 e `parseNFe` (Task 1).
- Produces:
  - `parseResumoNFe(xml) -> { chave, cnpjEmitente, nomeEmitente, valorTotal, emitidaEm, numero, serie }`;
  - `POST /api/nfe/sincronizar` body `{ empresaId }` →
    `{ novos, manifestados, baixados, ultimoNsu, maxNsu, mensagem }`.

- [ ] **Step 1: Escrever o teste do resumo**

Criar `tests/nfe-resumo.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResumoNFe } from '../lib/nfe/parseResumo.js';

const RESUMO = '<resNFe versao="1.01">'
  + '<chNFe>35260812345678000199550010000012341000012348</chNFe>'
  + '<CNPJ>12345678000199</CNPJ><xNome>Frigorifico Exemplo LTDA</xNome>'
  + '<dhEmi>2026-08-18T09:12:00-03:00</dhEmi><vNF>2757.00</vNF><nProt>1</nProt>'
  + '</resNFe>';

test('parseResumoNFe: extrai identificação e valor', () => {
  const r = parseResumoNFe(RESUMO);
  assert.equal(r.chave, '35260812345678000199550010000012341000012348');
  assert.equal(r.cnpjEmitente, '12345678000199');
  assert.equal(r.nomeEmitente, 'Frigorifico Exemplo LTDA');
  assert.equal(r.valorTotal, 2757);
  assert.equal(r.emitidaEm, '2026-08-18T09:12:00-03:00');
});

test('parseResumoNFe: número e série saem da chave quando não vêm no resumo', () => {
  // Posições 25-34 da chave são a série (3) e o número (9).
  const r = parseResumoNFe(RESUMO);
  assert.equal(r.serie, '1');
  assert.equal(r.numero, '1234');
});

test('parseResumoNFe: XML que não é resumo falha', () => {
  assert.throws(() => parseResumoNFe('<outra><coisa/></outra>'), /resNFe/);
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Rodar: `npm test`
Esperado: FAIL com `Cannot find module '../lib/nfe/parseResumo.js'`.

- [ ] **Step 3: Implementar o parser de resumo**

Criar `lib/nfe/parseResumo.js`:

```js
// O resNFe é o resumo que a SEFAZ devolve antes da manifestação: identifica a
// nota e o emitente, mas não traz itens. Serve para montar a caixa de entrada.
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({ removeNSPrefix: true, parseTagValue: false, trimValues: true });

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function parseResumoNFe(xml) {
  const resumo = parser.parse(xml)?.resNFe;
  if (!resumo) throw new Error('XML não é um resNFe.');

  const chave = String(resumo.chNFe || '').replace(/\D/g, '');
  return {
    chave,
    cnpjEmitente: String(resumo.CNPJ || resumo.CPF || '').replace(/\D/g, ''),
    nomeEmitente: String(resumo.xNome || ''),
    emitidaEm: String(resumo.dhEmi || ''),
    valorTotal: num(resumo.vNF),
    // O resumo não traz nNF nem série; a própria chave carrega os dois:
    // posições 22-24 = série, 25-33 = número.
    serie: chave ? String(Number(chave.slice(22, 25))) : '',
    numero: chave ? String(Number(chave.slice(25, 34))) : '',
  };
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Rodar: `npm test`
Esperado: PASS nos 3 testes de `nfe-resumo`.

- [ ] **Step 5: Criar a rota de sincronização**

Criar `app/api/nfe/sincronizar/route.js`:

```js
import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../../lib/pontoServer';
import { garantirEmpresa } from '../../../../lib/nfe/autorizacao';
import { carregarCertificado } from '../../../../lib/nfe/certificadoServer';
import { montarEnvelopeDistribuicao, lerRetornoDistribuicao } from '../../../../lib/sefaz/envelopes';
import { chamarSefaz } from '../../../../lib/sefaz/transporte';
import { manifestarCiencia } from '../../../../lib/sefaz/manifestacao';
import { URLS, AMBIENTE, C_STAT } from '../../../../lib/sefaz/endpoints';
import { parseResumoNFe } from '../../../../lib/nfe/parseResumo';
import { parseNFe } from '../../../../lib/nfe/parseNFe';

export const runtime = 'nodejs';
export const maxDuration = 60;

const INTERVALO_MINIMO_MS = 60 * 60 * 1000; // a SEFAZ pune consulta em excesso (cStat 656)
const MAX_PAGINAS = 10;                     // trava contra laço infinito de paginação
const MAX_MANIFESTACOES = 20;               // por execução, para caber no tempo da função

// UF do autor da consulta, no código do IBGE. Todas as empresas do grupo são de
// São Paulo. Se um dia houver empresa de outra UF, isto vira coluna em `empresas`
// numa migração própria — não consultar coluna que não existe.
const UF_AUTOR = '35';

async function guardarXml(sb, empresaId, chave, xml) {
  const path = `${empresaId}/nfe/${chave}.xml`;
  const { error } = await sb.storage.from('recebimentos')
    .upload(path, Buffer.from(xml, 'utf8'), { contentType: 'application/xml', upsert: true });
  if (error) throw new Error('Falha ao guardar o XML: ' + error.message);
  return path;
}

export async function POST(request) {
  const { sb, user, isAdmin, erro } = await autorizarModulo(request, 'recebimentos');
  if (erro) return erro;

  const { empresaId } = await request.json();
  try {
    await garantirEmpresa(sb, user, isAdmin, empresaId);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 403 });
  }

  const { data: estado } = await sb.from('nfe_sefaz_estado')
    .select('*').eq('empresa_id', empresaId).maybeSingle();

  const desde = estado?.ultima_consulta_em ? Date.now() - new Date(estado.ultima_consulta_em).getTime() : Infinity;
  if (desde < INTERVALO_MINIMO_MS) {
    const faltam = Math.ceil((INTERVALO_MINIMO_MS - desde) / 60000);
    return NextResponse.json({
      error: `A SEFAZ limita a frequência de consulta. Tente de novo em ${faltam} minuto(s).`,
    }, { status: 429 });
  }

  let certificado;
  try {
    certificado = await carregarCertificado(sb, empresaId);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  const ufAutor = UF_AUTOR;
  const ambiente = AMBIENTE.producao;

  let ultNSU = estado?.ultimo_nsu || '000000000000000';
  let maxNSU = estado?.max_nsu || '000000000000000';
  let novos = 0;
  let paginas = 0;
  let motivo = '';

  try {
    // ---- 1) varredura incremental por NSU ----
    while (paginas < MAX_PAGINAS) {
      paginas += 1;
      const envelope = montarEnvelopeDistribuicao({ cnpj: certificado.cnpj, ufAutor, ambiente, ultNSU });
      const resposta = await chamarSefaz({
        url: URLS.distribuicao, envelope, pfx: certificado.pfx, senha: certificado.senha,
      });
      const retorno = lerRetornoDistribuicao(resposta);
      motivo = retorno.xMotivo;
      maxNSU = retorno.maxNSU || maxNSU;

      if (retorno.cStat === C_STAT.consumoIndevido) {
        await sb.from('nfe_sefaz_estado').upsert([{
          empresa_id: empresaId, ultimo_nsu: ultNSU, max_nsu: maxNSU,
          ultima_consulta_em: new Date().toISOString(),
          ultimo_erro: 'Consumo indevido (656): aguardar 1 hora.', atualizado_em: new Date().toISOString(),
        }]);
        return NextResponse.json({ error: 'A SEFAZ recusou por consumo indevido. Aguarde 1 hora.' }, { status: 429 });
      }

      for (const doc of retorno.documentos) {
        if (!doc.schema.startsWith('resNFe') && !doc.schema.startsWith('procNFe')) continue;

        if (doc.schema.startsWith('procNFe')) {
          const nota = parseNFe(doc.xml);
          const path = await guardarXml(sb, empresaId, nota.chave, doc.xml);
          await sb.from('nfe_documentos').upsert([{
            empresa_id: empresaId, chave: nota.chave, nsu: doc.nsu, modelo: nota.modelo,
            cnpj_emitente: nota.emitente.cnpj, nome_emitente: nota.emitente.nome,
            numero: nota.numero, serie: nota.serie, emitida_em: nota.emitidaEm || null,
            valor_total: nota.valorTotal, status: nota.modelo === '55' ? 'xml_baixado' : 'ignorada',
            origem: 'sefaz', xml_path: path, ultimo_erro: null,
          }], { onConflict: 'empresa_id,chave' });
        } else {
          const resumo = parseResumoNFe(doc.xml);
          // Não sobrescreve nota que já tem XML: o upsert de resumo só cria.
          const { data: existente } = await sb.from('nfe_documentos')
            .select('id, status').eq('empresa_id', empresaId).eq('chave', resumo.chave).maybeSingle();
          if (existente) continue;
          await sb.from('nfe_documentos').insert([{
            empresa_id: empresaId, chave: resumo.chave, nsu: doc.nsu, modelo: '55',
            cnpj_emitente: resumo.cnpjEmitente, nome_emitente: resumo.nomeEmitente,
            numero: resumo.numero, serie: resumo.serie, emitida_em: resumo.emitidaEm || null,
            valor_total: resumo.valorTotal, status: 'resumo', origem: 'sefaz',
          }]);
        }
        novos += 1;
      }

      ultNSU = retorno.ultNSU || ultNSU;
      if (retorno.cStat !== C_STAT.documentoLocalizado) break;
      if (Number(ultNSU) >= Number(maxNSU)) break;
    }

    // ---- 2) ciência automática + download do XML completo ----
    const { data: pendentes } = await sb.from('nfe_documentos')
      .select('id, chave').eq('empresa_id', empresaId).eq('status', 'resumo')
      .eq('modelo', '55').limit(MAX_MANIFESTACOES);

    let manifestados = 0;
    let baixados = 0;

    for (const documento of pendentes || []) {
      try {
        const evento = await manifestarCiencia({
          chave: documento.chave, cnpj: certificado.cnpj, ambiente,
          dataHora: new Date().toISOString(),
          pfx: certificado.pfx, senha: certificado.senha,
          keyPem: certificado.keyPem, certPem: certificado.certPem,
        });
        // 135 = evento registrado, 573 = evento já registrado antes. Os dois liberam o XML.
        if (!['135', '573'].includes(evento.cStat)) {
          await sb.from('nfe_documentos')
            .update({ ultimo_erro: `Ciência recusada (${evento.cStat}): ${evento.xMotivo}` })
            .eq('id', documento.id);
          continue;
        }
        manifestados += 1;
        await sb.from('nfe_documentos')
          .update({ status: 'manifestada', manifestada_em: new Date().toISOString(), ultimo_erro: null })
          .eq('id', documento.id);

        const envelope = montarEnvelopeDistribuicao({
          cnpj: certificado.cnpj, ufAutor, ambiente, chave: documento.chave,
        });
        const resposta = await chamarSefaz({
          url: URLS.distribuicao, envelope, pfx: certificado.pfx, senha: certificado.senha,
        });
        const retorno = lerRetornoDistribuicao(resposta);
        const completo = retorno.documentos.find(d => d.schema.startsWith('procNFe'));
        if (!completo) continue;

        const nota = parseNFe(completo.xml);
        const path = await guardarXml(sb, empresaId, nota.chave, completo.xml);
        await sb.from('nfe_documentos').update({
          status: 'xml_baixado', xml_path: path, numero: nota.numero, serie: nota.serie,
          valor_total: nota.valorTotal, emitida_em: nota.emitidaEm || null, ultimo_erro: null,
        }).eq('id', documento.id);
        baixados += 1;
      } catch (e) {
        await sb.from('nfe_documentos').update({ ultimo_erro: e.message }).eq('id', documento.id);
      }
    }

    await sb.from('nfe_sefaz_estado').upsert([{
      empresa_id: empresaId, ultimo_nsu: ultNSU, max_nsu: maxNSU,
      ultima_consulta_em: new Date().toISOString(), ultimo_erro: null,
      atualizado_em: new Date().toISOString(),
    }]);

    return NextResponse.json({
      novos, manifestados, baixados, ultimoNsu: ultNSU, maxNsu: maxNSU,
      mensagem: novos ? `${novos} documento(s) novo(s).` : (motivo || 'Nenhum documento novo.'),
    });
  } catch (e) {
    await sb.from('nfe_sefaz_estado').upsert([{
      empresa_id: empresaId, ultimo_nsu: ultNSU, max_nsu: maxNSU,
      ultima_consulta_em: new Date().toISOString(), ultimo_erro: e.message,
      atualizado_em: new Date().toISOString(),
    }]);
    return NextResponse.json({ error: 'Falha ao falar com a SEFAZ: ' + e.message }, { status: 502 });
  }
}
```

**Sobre a UF do autor:** `cUFAutor` é o código IBGE da UF de quem consulta, e o
Ambiente Nacional aceita a UF do destinatário. A constante `UF_AUTOR = '35'` cobre o
grupo inteiro hoje. Se entrar empresa de outra UF, aí sim vale uma coluna em
`empresas` numa migração `atualizacao_23`, com `default '35'`.

- [ ] **Step 6: Verificar em homologação**

Rodar: `npm run verify` — testes PASS e build sem erro.

Depois, com o certificado carregado e `AMBIENTE.homologacao` temporariamente no lugar
de `AMBIENTE.producao`, chamar a rota e conferir: o retorno traz `cStat` conhecido, o
estado é gravado em `nfe_sefaz_estado`, e uma segunda chamada dentro da mesma hora
devolve 429. Só depois disso voltar para produção.

- [ ] **Step 7: Commit**

```bash
git add lib/nfe/parseResumo.js tests/nfe-resumo.test.mjs app/api/nfe/sincronizar/route.js
git commit -m "feat(nfe): sincronização com a SEFAZ com ciência automática"
```

---

## Task 13: Consulta por chave digitada

**Files:**
- Create: `app/api/nfe/chave/route.js`
- Modify: `components/ImportarNota.js`

**Interfaces:**
- Consumes: Tasks 9, 10, 11, 12.
- Produces: `POST /api/nfe/chave` body `{ empresaId, chave }` → `{ documento }`, com o
  XML já guardado quando a SEFAZ o entrega. No componente, um campo de chave ao lado
  do botão de XML.

- [ ] **Step 1: Criar a rota**

Criar `app/api/nfe/chave/route.js`:

```js
import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../../lib/pontoServer';
import { garantirEmpresa } from '../../../../lib/nfe/autorizacao';
import { carregarCertificado } from '../../../../lib/nfe/certificadoServer';
import { montarEnvelopeDistribuicao, lerRetornoDistribuicao } from '../../../../lib/sefaz/envelopes';
import { chamarSefaz } from '../../../../lib/sefaz/transporte';
import { manifestarCiencia } from '../../../../lib/sefaz/manifestacao';
import { URLS, AMBIENTE } from '../../../../lib/sefaz/endpoints';
import { parseNFe } from '../../../../lib/nfe/parseNFe';

export const runtime = 'nodejs';
export const maxDuration = 60;

// POST: busca uma nota específica pela chave. Se a SEFAZ ainda não entrega o XML
// completo, manifesta ciência e tenta de novo — uma vez só.
export async function POST(request) {
  const { sb, user, isAdmin, erro } = await autorizarModulo(request, 'recebimentos');
  if (erro) return erro;

  const corpo = await request.json();
  const empresaId = corpo.empresaId;
  const chave = String(corpo.chave || '').replace(/\D/g, '');

  try {
    await garantirEmpresa(sb, user, isAdmin, empresaId);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 403 });
  }
  if (!/^\d{44}$/.test(chave)) {
    return NextResponse.json({ error: 'A chave de acesso tem 44 dígitos.' }, { status: 400 });
  }

  const { data: jaTemos } = await sb.from('nfe_documentos')
    .select('*').eq('empresa_id', empresaId).eq('chave', chave).maybeSingle();
  if (jaTemos?.xml_path) return NextResponse.json({ documento: jaTemos });

  let certificado;
  try {
    certificado = await carregarCertificado(sb, empresaId);
  } catch (e) {
    return NextResponse.json({
      error: e.message + ' Enquanto isso, envie o XML da nota pelo botão ao lado.',
    }, { status: 400 });
  }

  const ambiente = AMBIENTE.producao;
  const ufAutor = '35';

  async function consultar() {
    const envelope = montarEnvelopeDistribuicao({ cnpj: certificado.cnpj, ufAutor, ambiente, chave });
    const resposta = await chamarSefaz({
      url: URLS.distribuicao, envelope, pfx: certificado.pfx, senha: certificado.senha,
    });
    return lerRetornoDistribuicao(resposta);
  }

  try {
    let retorno = await consultar();
    let completo = retorno.documentos.find(d => d.schema.startsWith('procNFe'));

    if (!completo) {
      const evento = await manifestarCiencia({
        chave, cnpj: certificado.cnpj, ambiente, dataHora: new Date().toISOString(),
        pfx: certificado.pfx, senha: certificado.senha,
        keyPem: certificado.keyPem, certPem: certificado.certPem,
      });
      if (!['135', '573'].includes(evento.cStat)) {
        return NextResponse.json({
          error: `A SEFAZ recusou a manifestação (${evento.cStat}): ${evento.xMotivo}`,
        }, { status: 409 });
      }
      retorno = await consultar();
      completo = retorno.documentos.find(d => d.schema.startsWith('procNFe'));
    }

    if (!completo) {
      return NextResponse.json({
        error: 'A SEFAZ não devolveu o XML desta chave. Confira se a nota é mesmo para o CNPJ desta empresa.',
      }, { status: 404 });
    }

    const nota = parseNFe(completo.xml);
    const path = `${empresaId}/nfe/${nota.chave}.xml`;
    const { error: errUp } = await sb.storage.from('recebimentos')
      .upload(path, Buffer.from(completo.xml, 'utf8'), { contentType: 'application/xml', upsert: true });
    if (errUp) return NextResponse.json({ error: 'Falha ao guardar o XML: ' + errUp.message }, { status: 500 });

    const { data, error } = await sb.from('nfe_documentos').upsert([{
      empresa_id: empresaId, chave: nota.chave, modelo: nota.modelo,
      cnpj_emitente: nota.emitente.cnpj, nome_emitente: nota.emitente.nome,
      numero: nota.numero, serie: nota.serie, emitida_em: nota.emitidaEm || null,
      valor_total: nota.valorTotal,
      status: nota.modelo === '55' ? 'xml_baixado' : 'ignorada',
      origem: 'sefaz', xml_path: path, ultimo_erro: null,
    }], { onConflict: 'empresa_id,chave' }).select('*').single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ documento: data });
  } catch (e) {
    return NextResponse.json({ error: 'Falha ao falar com a SEFAZ: ' + e.message }, { status: 502 });
  }
}
```

- [ ] **Step 2: Adicionar o campo de chave ao componente**

Em `components/ImportarNota.js`, acrescentar o estado e a função:

```jsx
  const [chave, setChave] = useState('');
```

```jsx
  async function buscarPorChave() {
    const limpa = chave.replace(/\D/g, '');
    if (limpa.length !== 44) { setErro('A chave de acesso tem 44 dígitos.'); return; }
    setErro('');
    setOcupado(true);
    try {
      const r1 = await comToken('/api/nfe/chave', {
        method: 'POST',
        body: JSON.stringify({ empresaId, chave: limpa }),
      });
      const j1 = await r1.json();
      if (!r1.ok) { setErro(j1.error); return; }

      const r2 = await comToken(`/api/nfe/documentos/${limpa}/preparar?empresaId=${empresaId}`);
      const j2 = await r2.json();
      if (!r2.ok) { setErro(j2.error); return; }
      if (j2.jaVinculada) { setErro('Esta nota já foi lançada em outro recebimento.'); return; }
      setChave('');
      onImportado(j2);
    } catch (e) {
      setErro('Falha ao buscar: ' + e.message);
    } finally {
      setOcupado(false);
    }
  }
```

E no JSX, ao lado do botão de XML:

```jsx
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
        <input value={chave} onChange={e => setChave(e.target.value)} disabled={ocupado}
          placeholder="Chave de acesso (44 dígitos)" style={{ minWidth: 340 }} inputMode="numeric" />
        <button type="button" onClick={buscarPorChave} disabled={ocupado}>
          {ocupado ? 'Buscando…' : 'Buscar na SEFAZ'}
        </button>
      </div>
```

- [ ] **Step 3: Verificar**

Rodar: `npm run verify` — testes PASS e build sem erro.

Teste manual: colar a chave de uma nota real emitida contra o CNPJ da empresa e
confirmar que o formulário abre preenchido. Colar uma chave de nota de outra empresa e
confirmar que a mensagem de erro é clara, sem quebrar a tela.

- [ ] **Step 4: Commit**

```bash
git add app/api/nfe/chave/route.js components/ImportarNota.js
git commit -m "feat(nfe): consulta de nota por chave de acesso"
```

---

# Fase 3 — Caixa de entrada e automação

## Task 14: Tela de Notas fiscais

**Files:**
- Create: `components/RecebimentoTabs.js`
- Create: `app/recebimentos/notas/page.js`
- Modify: `app/recebimentos/page.js`

**Interfaces:**
- Consumes: `GET /api/nfe/documentos`, `POST /api/nfe/sincronizar`, `GET|POST /api/nfe/certificado`.
- Produces: rota `/recebimentos/notas`; navegação por `?chave=` para `/recebimentos`,
  que abre o formulário já com a nota importada.

- [ ] **Step 1: Criar as abas**

Criar `components/RecebimentoTabs.js`, no mesmo padrão de `components/PontoTabs.js`:

```jsx
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ABAS = [
  { href: '/recebimentos', label: 'Entradas' },
  { href: '/recebimentos/notas', label: 'Notas fiscais' },
];

export default function RecebimentoTabs() {
  const pathname = usePathname();
  return (
    <div className="ponto-tabs">
      {ABAS.map(a => (
        <Link key={a.href} href={a.href}
          className={'ponto-tab' + (pathname === a.href ? ' ativo' : '')}>
          {a.label}
        </Link>
      ))}
    </div>
  );
}
```

O `pathname === a.href` é proposital: com `startsWith`, a aba "Entradas" ficaria
marcada também dentro de `/recebimentos/notas`.

- [ ] **Step 2: Criar a tela de notas**

Criar `app/recebimentos/notas/page.js`:

```jsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';
import { fmtMoney, fmtDate } from '../../../lib/format';
import AppShell from '../../../components/AppShell';
import RecebimentoTabs from '../../../components/RecebimentoTabs';
import { useEmpresaAtual } from '../../../lib/empresa';
import { useAuth } from '../../../lib/auth';

const STATUS_LABEL = {
  resumo: 'Aguardando XML',
  manifestada: 'Ciência enviada',
  xml_baixado: 'Pronta para lançar',
  vinculada: 'Já lançada',
  ignorada: 'Ignorada',
};

export default function NotasFiscaisPage() {
  return (
    <AppShell modulo="recebimentos" titulo="Notas fiscais" desc="Notas emitidas contra a empresa, direto da SEFAZ">
      <RecebimentoTabs />
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const { empresaAtual } = useEmpresaAtual();
  const { isAdmin } = useAuth('recebimentos');
  const router = useRouter();
  const [documentos, setDocumentos] = useState([]);
  const [certificado, setCertificado] = useState(null);
  const [filtro, setFiltro] = useState('xml_baixado');
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState('');

  async function comToken(url, opcoes = {}) {
    const { data: { session } } = await supabase.auth.getSession();
    return fetch(url, {
      ...opcoes,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        ...(opcoes.headers || {}),
      },
    });
  }

  async function carregar() {
    if (!empresaAtual) return;
    const [r1, r2] = await Promise.all([
      comToken(`/api/nfe/documentos?empresaId=${empresaAtual.id}${filtro ? `&status=${filtro}` : ''}`),
      comToken(`/api/nfe/certificado?empresaId=${empresaAtual.id}`),
    ]);
    const j1 = await r1.json();
    const j2 = await r2.json();
    setDocumentos(r1.ok ? j1.documentos : []);
    setCertificado(r2.ok ? j2.certificado : null);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id, filtro]);

  async function sincronizar() {
    setOcupado(true);
    setAviso('');
    try {
      const r = await comToken('/api/nfe/sincronizar', {
        method: 'POST', body: JSON.stringify({ empresaId: empresaAtual.id }),
      });
      const j = await r.json();
      setAviso(r.ok
        ? `${j.mensagem} ${j.baixados ? `${j.baixados} XML baixado(s).` : ''}`
        : j.error);
      if (r.ok) carregar();
    } finally {
      setOcupado(false);
    }
  }

  async function enviarCertificado(file, senha) {
    // Buffer não existe no navegador; base64 sai do próprio btoa.
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binario = '';
    for (const b of bytes) binario += String.fromCharCode(b);
    const pfxBase64 = btoa(binario);
    const r = await comToken('/api/nfe/certificado', {
      method: 'POST', body: JSON.stringify({ empresaId: empresaAtual.id, pfxBase64, senha }),
    });
    const j = await r.json();
    setAviso(r.ok ? 'Certificado atualizado.' : j.error);
    if (r.ok) setCertificado(j.certificado);
  }

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" onClick={sincronizar} disabled={ocupado || !certificado}>
            {ocupado ? 'Consultando a SEFAZ…' : 'Sincronizar com SEFAZ'}
          </button>
          <select value={filtro} onChange={e => setFiltro(e.target.value)}>
            <option value="xml_baixado">Prontas para lançar</option>
            <option value="resumo">Aguardando XML</option>
            <option value="vinculada">Já lançadas</option>
            <option value="">Todas</option>
          </select>
          <span className="muted">
            {certificado
              ? `Certificado de ${certificado.titular} — vence em ${certificado.dias_para_vencer} dia(s)`
              : 'Sem certificado configurado: só o envio de XML funciona.'}
          </span>
        </div>
        {certificado && certificado.dias_para_vencer <= 30 && (
          <p style={{ color: 'var(--warn, #b7791f)', marginTop: 8 }}>
            O certificado vence em {certificado.dias_para_vencer} dia(s). Providencie a renovação.
          </p>
        )}
        {aviso && <p style={{ marginTop: 8 }}>{aviso}</p>}
        {isAdmin && <FormCertificado onEnviar={enviarCertificado} />}
      </div>

      <table>
        <thead>
          <tr>
            <th>Emitida</th><th>Emitente</th><th>Nota</th><th>Valor</th><th>Situação</th><th></th>
          </tr>
        </thead>
        <tbody>
          {documentos.map(d => (
            <tr key={d.chave}>
              <td>{fmtDate(d.emitida_em)}</td>
              <td>{d.nome_emitente}</td>
              <td>{d.numero}/{d.serie}</td>
              <td>{fmtMoney(d.valor_total)}</td>
              <td>{STATUS_LABEL[d.status] || d.status}{d.ultimo_erro ? ` — ${d.ultimo_erro}` : ''}</td>
              <td>
                {d.status === 'xml_baixado' && (
                  <button type="button" onClick={() => router.push(`/recebimentos?chave=${d.chave}`)}>
                    Registrar recebimento
                  </button>
                )}
              </td>
            </tr>
          ))}
          {!documentos.length && <tr><td colSpan={6} className="muted">Nenhuma nota neste filtro.</td></tr>}
        </tbody>
      </table>
    </>
  );
}

// Upload do A1. A senha é digitada aqui pela pessoa responsável e vai direto para a
// rota — não fica em estado global, não é logada e não volta em resposta nenhuma.
function FormCertificado({ onEnviar }) {
  const [arquivo, setArquivo] = useState(null);
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function enviar(e) {
    e.preventDefault();
    if (!arquivo || !senha) return;
    setEnviando(true);
    try {
      await onEnviar(arquivo, senha);
      setArquivo(null);
      setSenha('');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <input type="file" accept=".pfx,.p12" onChange={e => setArquivo(e.target.files?.[0] || null)} />
      <input type="password" value={senha} onChange={e => setSenha(e.target.value)}
        placeholder="Senha do certificado" autoComplete="off" />
      <button type="submit" disabled={enviando || !arquivo || !senha}>
        {enviando ? 'Enviando…' : 'Salvar certificado A1'}
      </button>
    </form>
  );
}
```

Conferir a assinatura de `useAuth` em `lib/auth.js` antes de usar `isAdmin`: se o
retorno tiver outro nome, ajustar aqui em vez de mudar o hook.

- [ ] **Step 3: Abrir o formulário direto pela chave da URL**

Em `app/recebimentos/page.js`, importar `useSearchParams` de `next/navigation` e
`RecebimentoTabs`, renderizar as abas antes de `<ImportarNota .../>`, e acrescentar em
`Conteudo`:

```jsx
  const searchParams = useSearchParams();

  // Chegou de /recebimentos/notas com uma nota escolhida: já importa.
  useEffect(() => {
    const chave = searchParams.get('chave');
    if (!chave || !empresaAtual || notaImportada) return;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch(`/api/nfe/documentos/${chave}/preparar?empresaId=${empresaAtual.id}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const j = await r.json();
      if (!r.ok) { alert(j.error); return; }
      if (j.jaVinculada) { alert('Esta nota já foi lançada em outro recebimento.'); return; }
      aplicarNotaImportada(j);
    })();
  }, [searchParams, empresaAtual?.id]);
```

`useSearchParams` obriga a página a ficar sob um `<Suspense>` no build estático do
Next 14. Como `app/recebimentos/page.js` já é `'use client'` e renderiza dentro de
`AppShell`, envolver `<Conteudo />` em `<Suspense fallback={null}>` resolve, se o
build reclamar.

- [ ] **Step 4: Verificar**

Rodar: `npm run verify` — testes PASS e build sem erro.

Teste manual: abrir `/recebimentos/notas`, conferir que a lista carrega, que o botão de
sincronizar fica desabilitado sem certificado, que o aviso de vencimento aparece quando
faltam 30 dias ou menos, e que "Registrar recebimento" leva para o formulário já
preenchido.

- [ ] **Step 5: Commit**

```bash
git add components/RecebimentoTabs.js app/recebimentos/notas/page.js app/recebimentos/page.js
git commit -m "feat(recebimento): caixa de entrada de notas fiscais"
```

---

## Task 15: Sincronização agendada

**Files:**
- Create: `vercel.json`
- Modify: `app/api/nfe/sincronizar/route.js`

**Interfaces:**
- Consumes: `POST /api/nfe/sincronizar` (Task 12).
- Produces: `GET /api/nfe/sincronizar` autenticado por `CRON_SECRET`, que roda a
  varredura para todas as empresas com certificado ativo.

- [ ] **Step 1: Aceitar a chamada do cron**

Em `app/api/nfe/sincronizar/route.js`, extrair o corpo da função `POST` para uma função
`sincronizarEmpresa(sb, empresaId)` que devolve o mesmo objeto de resultado, fazer o
`POST` chamá-la, e acrescentar ao fim do arquivo:

```js
import { clienteAdmin } from '../../../../lib/pontoServer';

// GET: chamado pelo cron da Vercel. Não usa sessão de usuário — autentica pelo
// segredo compartilhado e varre todas as empresas que têm certificado ativo.
export async function GET(request) {
  const segredo = process.env.CRON_SECRET;
  const enviado = (request.headers.get('authorization') || '').replace('Bearer ', '');
  if (!segredo || enviado !== segredo) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  }

  const sb = clienteAdmin();
  const { data: certificados } = await sb.from('certificados_digitais')
    .select('empresa_id').eq('ativo', true);

  const resultados = [];
  for (const { empresa_id } of certificados || []) {
    try {
      resultados.push({ empresa_id, ...(await sincronizarEmpresa(sb, empresa_id)) });
    } catch (e) {
      resultados.push({ empresa_id, erro: e.message });
    }
  }
  return NextResponse.json({ resultados });
}
```

`sincronizarEmpresa` precisa devolver o objeto de resultado em vez de `NextResponse`, e
lançar `Error` nos casos de falha; o `POST` traduz isso para HTTP. O limite de uma
consulta por hora vale para os dois caminhos — o cron simplesmente pula a empresa que
ainda está no intervalo, registrando isso no resultado.

- [ ] **Step 2: Configurar o agendamento**

Criar `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/nfe/sincronizar",
      "schedule": "0 9,13,17,21 * * *"
    }
  ]
}
```

Quatro execuções por dia, em horário comercial. **No plano Hobby a Vercel aceita
apenas uma execução diária por cron** — se o projeto estiver nesse plano, o deploy
falha ou o agendamento é reduzido. Nesse caso, deixar `"schedule": "0 13 * * *"` e
tratar o botão manual da tela de Notas fiscais como o caminho principal.

Configurar `CRON_SECRET` nas variáveis de ambiente da Vercel (a plataforma envia esse
valor no header `Authorization` automaticamente para rotas de cron).

- [ ] **Step 3: Verificar**

Rodar: `npm run verify` — testes PASS e build sem erro.

Chamar localmente com o segredo configurado:

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/nfe/sincronizar
```

Esperado: JSON com um resultado por empresa que tem certificado. Chamar sem o header
deve devolver 401.

- [ ] **Step 4: Commit**

```bash
git add vercel.json app/api/nfe/sincronizar/route.js
git commit -m "feat(nfe): sincronização agendada com a SEFAZ"
```

---

## Verificação final

- [ ] `npm run verify` passa: os 29 testes novos (6 parse + 5 de-para + 4 parcelas + 6 cripto + 5 envelopes + 3 resumo), mais os que já existiam, e o build do Next sem erro.
- [ ] As migrações 21 e 22 estão aplicadas no Supabase de produção.
- [ ] `NFE_CERT_MASTER_KEY` e `CRON_SECRET` estão configurados na Vercel.
- [ ] Uma nota real foi importada por XML, uma por chave e uma pela caixa de entrada.
- [ ] A segunda nota do mesmo fornecedor veio com os itens já casados.
- [ ] Tentar lançar a mesma nota duas vezes é bloqueado.
- [ ] Um usuário comum não consegue ler `certificados_digitais` pelo client.
