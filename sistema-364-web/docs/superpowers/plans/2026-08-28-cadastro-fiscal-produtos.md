# Cadastro fiscal de produtos — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar visível e editável o que hoje impede a 364 Food Service de emitir NF-e — alíquotas de PIS/COFINS na regra, informação adicional por item no XML, e uma tela que mostra quais produtos estão bloqueados e copia a configuração fiscal de um produto para outros.

**Architecture:** Nenhuma migração: todas as colunas já existem. A concatenação "base legal — observação" ganha uma função pura (`juntarTextoFiscal`) usada tanto pela validação do cadastro quanto pelo resolver, para a regra dos 500 caracteres viver num lugar só. A lista de campos copiáveis vira função pura em `lib/fiscal.js`, testável sem banco, lida pela tela e pela rota. A rota de cópia é fina: autoriza, chama a função pura, grava, audita.

**Tech Stack:** Next.js (App Router, client components), Supabase (`@supabase/supabase-js`, PostgREST), `node:test`, Postgres.

**Spec:** `docs/superpowers/specs/2026-08-28-cadastro-fiscal-produtos-design.md`

## Global Constraints

- Todo comentário, mensagem de erro, rótulo de tela, nome de variável e texto de commit em **português**, como o resto do repositório.
- Commits seguem `tipo(escopo): descrição` — `feat`, `fix`, `docs`, `test`.
- `npm test` roda `node --test tests/*.test.mjs` e precisa ficar verde em toda tarefa. Hoje são **704 testes**.
- **Nenhuma migração nesta entrega.** `aliquota_pis`, `aliquota_cofins`, `base_legal`, `observacao_fiscal` já existem em `regras_tributarias`; os dez campos copiáveis já existem em `produtos`. Confirmado contra a produção em 28/08/2026.
- Nada roda contra a produção sem autorização explícita do usuário.
- `infAdProd` tem limite de **500 caracteres** no leiaute 4.00. Esse número aparece em três lugares (validação do cadastro, resolver, teste) e deve vir da constante exportada, nunca digitado solto.
- `aliquota_pis` e `aliquota_cofins` são `numeric(6,4)`: o teto é **99,9999**, não 100. Gravar 100 estoura a precisão e vira erro de banco.
- `ativo_fiscal` **nunca** é copiado. É declaração de conferência humana, não dado fiscal.

## Correções à spec, confirmadas no código

A spec foi escrita antes desta leitura do código e erra em dois pontos. O plano segue o código, não a spec:

1. **`base_legal` e `observacao_fiscal` já estão no formulário** — `components/RegraTributariaForm.js:226-236` — e já são gravados por `camposRegra` (`app/fiscal/tributacao/page.js:392-393`). O que falta são só as **duas alíquotas**.
2. **O formulário já foi extraído de `page.js`.** Ele vive em `components/RegraTributariaForm.js` (274 linhas); `page.js` (398 linhas) só guarda estado e grava. Não há refactor a fazer — a spec previa uma extração que já aconteceu.

Consequência: a Task 1 é menor do que a spec descreve. As alíquotas não estão em `REGRA_VAZIA`, não estão no formulário e **não estão em `camposRegra`** — ou seja, hoje elas são sempre `null`, e `resolverNota` as lê como zero (`lib/nfe/resolverNota.js:100-101`). A cadeia inteira já funciona; falta o cadastro alimentá-la.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---------|------------------|
| `lib/fiscalRegras.js` | ganha `LIMITE_INF_AD_PROD`, `juntarTextoFiscal` e a validação das alíquotas |
| `components/RegraTributariaForm.js` | dois campos de alíquota, contador de caracteres |
| `app/fiscal/tributacao/page.js` | as alíquotas entram em `REGRA_VAZIA` e `camposRegra` |
| `lib/nfe/resolverNota.js` | `resolverItem` monta `infAdProd` |
| `lib/nfe/montarXml.js` | `montarDet` emite `infAdProd` como último filho de `det` |
| `lib/fiscal.js` | `CAMPOS_COPIA_FISCAL`, `camposCopiaFiscal`, `gruposComRegra`, `situacaoFiscalProduto` |
| `lib/autorizacao.js` | `garantirProduto`, no padrão de `garantirPedido` |
| `app/api/fiscal/copiar-tributacao/route.js` | autoriza, copia, libera, audita |
| `app/fiscal/produtos/page.js` | tela de situação fiscal e cópia |
| `lib/menu.js` | item "Produtos — situação fiscal" no grupo Fiscal |
| `tests/fiscal-regras.test.mjs` | validação das alíquotas e do limite de 500 |
| `tests/fiscal.test.mjs` | payload da cópia e aviso de grupo sem regra |
| `tests/nfe-resolver.test.mjs` | `infAdProd` montado, normalizado e estourando |
| `tests/nfe-montar-xml.test.mjs` | `infAdProd` no lugar certo do `det` |
| `lib/fiscalCopia.js` | `avaliarDestino`: marca, pendências e o que gravar |
| `tests/fiscal-copiar-tributacao.test.mjs` | decisão da rota, sem banco |

---

### Task 1: Alíquotas de PIS/COFINS e o limite de 500 no cadastro de regra

**Files:**
- Modify: `lib/fiscalRegras.js` — nova constante, nova função pura, validação
- Modify: `components/RegraTributariaForm.js:175-236` — dois campos e o contador
- Modify: `app/fiscal/tributacao/page.js:16-25` (`REGRA_VAZIA`) e `:370-397` (`camposRegra`)
- Test: `tests/fiscal-regras.test.mjs`

**Interfaces:**
- Produces: `LIMITE_INF_AD_PROD = 500` e `juntarTextoFiscal(baseLegal, observacao) -> string | undefined`, exportados de `lib/fiscalRegras.js`. A Task 2 importa os dois.
- Consumes: `validarRegraTributaria(regra)` e `ehVazio`, já existentes no mesmo arquivo.

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar ao fim de `tests/fiscal-regras.test.mjs`, e incluir `LIMITE_INF_AD_PROD, juntarTextoFiscal` no `import` do topo do arquivo:

```js
test('juntarTextoFiscal põe a base legal antes da observação, separadas por travessão', () => {
  assert.equal(
    juntarTextoFiscal('RICMS-RO Anexo VI, item 84.0', 'ICMS retido por ST'),
    'RICMS-RO Anexo VI, item 84.0 — ICMS retido por ST',
  );
});

test('juntarTextoFiscal omite a parte vazia em vez de deixar o separador solto', () => {
  assert.equal(juntarTextoFiscal('só a base legal', ''), 'só a base legal');
  assert.equal(juntarTextoFiscal(null, 'só a observação'), 'só a observação');
  assert.equal(juntarTextoFiscal('  ', null), undefined,
    'espaço em branco não é texto: viraria um infAdProd vazio no XML');
  assert.equal(juntarTextoFiscal(null, null), undefined);
});

test('alíquota de PIS/COFINS acima de 99,9999 é recusada no formulário, não no banco', () => {
  // As colunas são numeric(6,4): dois dígitos inteiros, quatro decimais.
  // Gravar 100 estoura a precisão e volta como erro cru do PostgREST.
  const erros = validarRegraTributaria({ ...BASE, aliquota_pis: 100 });
  assert.ok(erros.some(e => /alíquota do PIS/i.test(e)), erros.join(' | '));
  assert.equal(validarRegraTributaria({ ...BASE, aliquota_pis: 99.9999 }).length, 0);
});

test('alíquota negativa ou não numérica é recusada', () => {
  assert.ok(validarRegraTributaria({ ...BASE, aliquota_cofins: -1 })
    .some(e => /alíquota da COFINS/i.test(e)));
  assert.ok(validarRegraTributaria({ ...BASE, aliquota_cofins: 'sete' })
    .some(e => /alíquota da COFINS/i.test(e)));
});

test('alíquota em branco é permitida — o resolver já trata nulo como zero', () => {
  assert.equal(validarRegraTributaria({ ...BASE, aliquota_pis: '', aliquota_cofins: null }).length, 0);
});

test('base legal e observação somadas não passam de 500 caracteres', () => {
  // A validação vive no cadastro porque falhar na emissão é caro: o operador
  // já escolheu o pedido e abriu a tela. Falhar aqui é de graça.
  const erros = validarRegraTributaria({
    ...BASE, base_legal: 'a'.repeat(300), observacao_fiscal: 'b'.repeat(300),
  });
  assert.ok(erros.some(e => e.includes(String(LIMITE_INF_AD_PROD))), erros.join(' | '));
  assert.equal(
    validarRegraTributaria({ ...BASE, base_legal: 'a'.repeat(200), observacao_fiscal: 'b'.repeat(200) }).length,
    0,
  );
});
```

- [ ] **Step 2: Rodar os testes e ver falharem**

Run: `node --test tests/fiscal-regras.test.mjs`
Expected: FAIL — `juntarTextoFiscal is not a function` e as validações novas não acusando nada.

- [ ] **Step 3: Escrever a implementação em `lib/fiscalRegras.js`**

Acrescentar antes de `validarRegraTributaria`:

```js
// Limite do infAdProd (informação adicional por item) no leiaute 4.00. Vive
// aqui porque quem digita o texto é o cadastro de regra, e é lá que o estouro
// tem conserto barato — na emissão, o operador já perdeu a viagem.
export const LIMITE_INF_AD_PROD = 500;

// Base legal e observação viram um texto só, nessa ordem: a citação dá o
// amparo, a observação complementa. Parte vazia é omitida — devolver
// "texto — " deixaria um separador solto no item da nota.
export function juntarTextoFiscal(baseLegal, observacao) {
  const partes = [baseLegal, observacao]
    .map(p => String(p ?? '').trim())
    .filter(p => p !== '');
  return partes.length ? partes.join(' — ') : undefined;
}
```

E acrescentar dentro de `validarRegraTributaria`, logo depois do laço que valida `cst_pis`/`cst_cofins` (por volta da linha 195), antes da validação de UF:

```js
  // numeric(6,4): dois dígitos inteiros e quatro decimais. O teto é 99,9999 —
  // 100 não cabe na coluna, e o erro do banco não explica isso a ninguém.
  for (const [campo, rotulo] of [['aliquota_pis', 'alíquota do PIS'], ['aliquota_cofins', 'alíquota da COFINS']]) {
    if (ehVazio(regra[campo])) continue;
    const valor = Number(regra[campo]);
    if (!Number.isFinite(valor) || valor < 0 || valor > 99.9999) {
      erros.push(`${rotulo} precisa ficar entre 0 e 99,9999 (a coluna é numeric(6,4))`);
    }
  }

  // Os dois textos saem juntos no infAdProd do item, então é a soma que
  // precisa caber — validar cada um por si deixaria passar 300 + 300.
  const textoDoItem = juntarTextoFiscal(regra.base_legal, regra.observacao_fiscal);
  if (textoDoItem && textoDoItem.length > LIMITE_INF_AD_PROD) {
    erros.push(
      `base legal e observação somam ${textoDoItem.length} caracteres; o limite do campo `
      + `de informação adicional do item é ${LIMITE_INF_AD_PROD}`,
    );
  }
```

- [ ] **Step 4: Rodar os testes e ver passarem**

Run: `node --test tests/fiscal-regras.test.mjs`
Expected: PASS.

- [ ] **Step 5: Pôr as alíquotas no formulário**

Em `components/RegraTributariaForm.js`, trocar o `import` do topo para incluir a função nova:

```js
import {
  ST_RESPONSAVEL, ST_RESPONSAVEL_OPCOES, CSOSN_OPCOES, MOD_BC_OPCOES, MOD_BC_ST_OPCOES,
  cfopSugerido, validarRegraTributaria, cstPisCofinsPara, regimeDoEmpregador,
  juntarTextoFiscal, LIMITE_INF_AD_PROD,
} from '../lib/fiscalRegras.js';
```

Logo depois de `const gruposCst = ...`, acrescentar:

```js
  const textoDoItem = juntarTextoFiscal(form.base_legal, form.observacao_fiscal) || '';
```

Dentro do bloco `PIS, COFINS e observações`, depois do `<div>` do "CST da COFINS" e antes do `<div>` da "Vigência (início)", acrescentar os dois campos:

```jsx
        <div>
          <label>Alíquota do PIS (%)</label>
          <input type="number" step="0.0001" min="0" max="99.9999"
                 value={form.aliquota_pis ?? ''}
                 onChange={e => set({ aliquota_pis: e.target.value })} />
        </div>
        <div>
          <label>Alíquota da COFINS (%)</label>
          <input type="number" step="0.0001" min="0" max="99.9999"
                 value={form.aliquota_cofins ?? ''}
                 onChange={e => set({ aliquota_cofins: e.target.value })} />
          <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>
            Em branco vale zero. No Simples Nacional o PIS/COFINS sai no DAS e a nota
            costuma ir com CST 49 e alíquota zerada — preencha só se o contador pedir.
          </p>
        </div>
```

E, logo abaixo do `<input>` da observação, o contador:

```jsx
          <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>
            {textoDoItem.length}/{LIMITE_INF_AD_PROD} caracteres — base legal e observação saem
            juntas na informação adicional do item, na nota.
          </p>
```

- [ ] **Step 6: Fazer as alíquotas serem gravadas**

Em `app/fiscal/tributacao/page.js`, acrescentar as duas chaves a `REGRA_VAZIA`, na linha do `cst_pis`:

```js
  aliquota_st_retido: '', cst_pis: '', cst_cofins: '',
  aliquota_pis: '', aliquota_cofins: '',
```

E em `camposRegra`, logo depois de `cst_cofins`:

```js
    aliquota_pis: numeroOuNulo(form.aliquota_pis),
    aliquota_cofins: numeroOuNulo(form.aliquota_cofins),
```

`numeroOuNulo` já existe no arquivo (linha 359) e devolve `null` para vazio, que é o que o resolver espera.

- [ ] **Step 7: Rodar a suíte inteira**

Run: `npm test`
Expected: tudo verde.

- [ ] **Step 8: Commit**

```bash
git add lib/fiscalRegras.js components/RegraTributariaForm.js app/fiscal/tributacao/page.js tests/fiscal-regras.test.mjs
git commit -m "feat(fiscal): alíquotas de PIS/COFINS no cadastro de regra tributária"
```

---

### Task 2: `infAdProd` no resolver

**Files:**
- Modify: `lib/nfe/resolverNota.js` — import novo e `resolverItem` (linha 69-127)
- Test: `tests/nfe-resolver.test.mjs`

**Interfaces:**
- Consumes: `juntarTextoFiscal`, `LIMITE_INF_AD_PROD` (Task 1); `normalizarTexto(valor, max, descricaoCampo)`, privada do próprio arquivo (linha 37).
- Produces: cada item de `nota.itens` ganha `infAdProd: string | undefined`. A Task 3 consome esse campo.

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar ao fim de `tests/nfe-resolver.test.mjs`:

```js
function comRegra(extra) {
  return { ...ENTRADA, itens: [{ ...ITEM, regra: { ...ITEM.regra, ...extra } }] };
}

test('infAdProd junta base legal e observação, nessa ordem', () => {
  const nota = resolverNota(comRegra({
    base_legal: 'RICMS-RO Anexo VI, Tabela XVII, item 84.0',
    observacao_fiscal: 'ICMS retido por substituição tributária',
  }));
  assert.equal(
    nota.itens[0].infAdProd,
    'RICMS-RO Anexo VI, Tabela XVII, item 84.0 — ICMS retido por substituição tributária',
  );
});

test('infAdProd sai com só uma das duas, sem separador solto', () => {
  assert.equal(comRegraResolvida({ base_legal: 'RICMS-RO art. 1º' }), 'RICMS-RO art. 1º');
  assert.equal(comRegraResolvida({ observacao_fiscal: 'Mercadoria de produção própria' }),
    'Mercadoria de produção própria');
});

function comRegraResolvida(extra) {
  return resolverNota(comRegra(extra)).itens[0].infAdProd;
}

test('regra sem base legal e sem observação não produz infAdProd', () => {
  assert.equal(resolverNota(ENTRADA).itens[0].infAdProd, undefined,
    'undefined é o que faz montarXml omitir a tag; string vazia viraria <infAdProd></infAdProd>');
});

test('quebra de linha crua vinda da tela é normalizada antes de virar XML', () => {
  const nota = resolverNota(comRegra({ base_legal: 'RICMS-RO\nart. 1º   §2º' }));
  assert.equal(nota.itens[0].infAdProd, 'RICMS-RO art. 1º §2º');
});

test('texto acima de 500 caracteres para a emissão no resolver, antes de queimar número', () => {
  // resolverNota roda em lib/nfe/emitir.js:339; reservar_numero_fiscal só em
  // :429. Falhar aqui é falhar antes de gastar numeração — que é o motivo de
  // toda a normalização de texto viver no resolver e não no serializador.
  assert.throws(
    () => resolverNota(comRegra({ base_legal: 'a'.repeat(501) })),
    /500 caracteres/,
  );
});
```

- [ ] **Step 2: Rodar os testes e ver falharem**

Run: `node --test tests/nfe-resolver.test.mjs`
Expected: FAIL — `infAdProd` sai `undefined` em todos os casos e o texto de 501 não lança.

- [ ] **Step 3: Escrever a implementação**

Em `lib/nfe/resolverNota.js`, acrescentar ao bloco de imports do topo:

```js
import { juntarTextoFiscal, LIMITE_INF_AD_PROD } from '../fiscalRegras.js';
```

E, no objeto devolvido por `resolverItem`, logo depois de `regraTributariaId: regra.id,`:

```js
    // Informação adicional POR ITEM. Nota com ST retido que não diz no item de
    // onde vem a retenção gera questionamento fiscal e cliente sem como se
    // creditar. O rodapé (infCpl) é da nota inteira e não serve para isso.
    infAdProd: normalizarTexto(
      juntarTextoFiscal(regra.base_legal, regra.observacao_fiscal),
      LIMITE_INF_AD_PROD,
      `informação adicional do item "${nome}" (infAdProd)`,
    ),
```

`normalizarTexto` devolve o próprio valor quando ele é `null`/`undefined`, então regra sem texto continua produzindo `undefined` — sem `if`.

- [ ] **Step 4: Rodar os testes e ver passarem**

Run: `node --test tests/nfe-resolver.test.mjs`
Expected: PASS.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test`
Expected: tudo verde.

- [ ] **Step 6: Commit**

```bash
git add lib/nfe/resolverNota.js tests/nfe-resolver.test.mjs
git commit -m "feat(fiscal): base legal e observação da regra viram infAdProd do item"
```

---

### Task 3: `infAdProd` no XML

**Files:**
- Modify: `lib/nfe/montarXml.js:189-215` (`montarDet`)
- Test: `tests/nfe-montar-xml.test.mjs`

**Interfaces:**
- Consumes: `item.infAdProd` (Task 2); `tag(nome, valor)`, privada do arquivo, que já omite a tag quando o valor é `undefined`/`null`/`''`.
- Produces: nada que outra tarefa consuma.

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar ao fim de `tests/nfe-montar-xml.test.mjs`:

```js
function notaComTexto(extra) {
  return resolverNota({
    pedido: { id: 'ped1' }, cliente: CLIENTE,
    itens: [{ ...ITEM, regra: { ...ITEM.regra, ...extra } }],
    emitente: EMITENTE, naturezaOperacao: { id: 'n1', descricao: 'Venda de mercadoria' },
    ambiente: 'homologacao',
  });
}

test('infAdProd é o último filho de det, depois de imposto', () => {
  // Posição do leiaute 4.00: prod, imposto, [impostoDevol], [infAdProd].
  // Fora de ordem é Rejeição 215 de schema, tão opaca quanto qualquer outra.
  const { xml } = montarXmlNFe(notaComTexto({ base_legal: 'RICMS-RO art. 1º' }), OPCOES);
  assert.match(xml, /<\/imposto><infAdProd>RICMS-RO art\. 1º<\/infAdProd><\/det>/);
});

test('item sem texto não emite a tag vazia', () => {
  const { xml } = montarXmlNFe(notaBase(), OPCOES);
  assert.ok(!xml.includes('<infAdProd>'),
    'tag vazia é lida pela SEFAZ como valor vazio, não como campo ausente');
});

test('caractere que exige escape XML sai escapado no infAdProd', () => {
  const { xml } = montarXmlNFe(notaComTexto({ base_legal: 'Convênio ICMS 52/91 <art. 1º & 2º>' }), OPCOES);
  assert.match(xml, /<infAdProd>Convênio ICMS 52\/91 &lt;art\. 1º &amp; 2º&gt;<\/infAdProd>/);
});
```

- [ ] **Step 2: Rodar os testes e ver falharem**

Run: `node --test tests/nfe-montar-xml.test.mjs`
Expected: FAIL — nenhum `infAdProd` no XML. O teste da tag vazia passa desde já; é a rede de segurança para o passo seguinte.

- [ ] **Step 3: Escrever a implementação**

Em `lib/nfe/montarXml.js`, trocar o `return` de `montarDet`:

```js
  // infAdProd é o último filho opcional de det, depois de imposto e do
  // impostoDevol que este sistema não emite. tag() omite quando não há texto.
  return `<det nItem="${item.numeroItem}">${prod}${imposto}${tag('infAdProd', item.infAdProd)}</det>`;
```

- [ ] **Step 4: Rodar os testes e ver passarem**

Run: `node --test tests/nfe-montar-xml.test.mjs`
Expected: PASS.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test`
Expected: tudo verde.

- [ ] **Step 6: Commit**

```bash
git add lib/nfe/montarXml.js tests/nfe-montar-xml.test.mjs
git commit -m "feat(fiscal): infAdProd por item no XML da NF-e"
```

---

### Task 4: Campos copiáveis e aviso de grupo sem regra

**Files:**
- Modify: `lib/fiscal.js` — quatro exports novos, ao lado de `pendenciasFiscaisProduto`
- Test: `tests/fiscal.test.mjs`

**Interfaces:**
- Produces, de `lib/fiscal.js`:
  - `CAMPOS_COPIA_FISCAL: string[]` — os dez nomes de coluna, em ordem;
  - `camposCopiaFiscal(produtoFonte) -> object` com exatamente essas dez chaves;
  - `gruposComRegra(regras) -> Set<string>` a partir de linhas `{ grupo_tributario_id, ativo }`;
  - `situacaoFiscalProduto(produto, gruposComRegraSet) -> { pendencias, grupoSemRegra, liberado }`.
- Consumido pela Task 5 (rota) e pela Task 6 (tela).

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar ao fim de `tests/fiscal.test.mjs`, incluindo `CAMPOS_COPIA_FISCAL, camposCopiaFiscal, gruposComRegra, situacaoFiscalProduto` no `import` de `../lib/fiscal.js`:

```js
const FONTE = {
  id: 'p1', codigo: '0364-001', nome: 'Costela Defumada 500g', unidade: 'KG',
  ncm: '02102000', ex_tipi: null, cest: '1708300', origem_mercadoria: 0,
  unidade_tributavel: 'KG', fator_conversao_tributavel: 1,
  grupo_tributario_id: 'g1', ind_escala: 'S', cnpj_fabricante: null,
  cst_ibs_cbs: null, ativo_fiscal: true,
  gtin: '7891234567895', gtin_tributavel: '7891234567895',
  peso_liquido_kg: 0.5, peso_bruto_kg: 0.55, sujeito_st: true,
};

test('o payload da cópia leva os dez campos fiscais previstos', () => {
  const payload = camposCopiaFiscal(FONTE);
  assert.deepEqual(Object.keys(payload).sort(), [...CAMPOS_COPIA_FISCAL].sort());
  assert.equal(CAMPOS_COPIA_FISCAL.length, 10);
  assert.equal(payload.ncm, '02102000');
  assert.equal(payload.grupo_tributario_id, 'g1');
});

test('o payload não leva identidade do produto nem declaração de conferência', () => {
  const payload = camposCopiaFiscal(FONTE);
  // Código de barras é único por produto; peso e unidade de venda são do item,
  // não da classificação; ativo_fiscal é assinatura de quem conferiu.
  for (const proibido of ['gtin', 'gtin_tributavel', 'unidade', 'peso_liquido_kg',
    'peso_bruto_kg', 'ativo_fiscal', 'id', 'codigo', 'nome']) {
    assert.ok(!(proibido in payload), `${proibido} não pode ser copiado`);
  }
});

test('campo nulo na fonte é copiado como nulo, não omitido', () => {
  // Copiar é espelhar, inclusive o vazio. Mesclar produziria um produto que
  // não é igual a nenhum dos dois e que ninguém conferiu.
  const payload = camposCopiaFiscal({ ...FONTE, cest: null });
  assert.ok('cest' in payload);
  assert.equal(payload.cest, null);
});

test('campo ausente na fonte também vira nulo explícito', () => {
  const payload = camposCopiaFiscal({ ncm: '02102000' });
  assert.equal(payload.cest, null);
  assert.equal(payload.grupo_tributario_id, null);
});

test('gruposComRegra conta só as regras ativas', () => {
  const grupos = gruposComRegra([
    { grupo_tributario_id: 'g1', ativo: true },
    { grupo_tributario_id: 'g2', ativo: false },
    { grupo_tributario_id: null, ativo: true },
  ]);
  assert.ok(grupos.has('g1'));
  assert.ok(!grupos.has('g2'), 'regra desativada não habilita o grupo');
  assert.equal(grupos.size, 1, 'regra por produto ou por NCM não tem grupo e não entra');
});

test('regra sem a coluna ativo conta como ativa', () => {
  // O select da tela pode não trazer a coluna; ausência não é desativação.
  assert.ok(gruposComRegra([{ grupo_tributario_id: 'g1' }]).has('g1'));
});

test('produto cujo grupo não tem regra ativa recebe o aviso', () => {
  const s = situacaoFiscalProduto({ ...FONTE, grupo_tributario_id: 'g9' }, gruposComRegra([]));
  assert.equal(s.grupoSemRegra, true);
});

test('produto cujo grupo tem regra ativa não recebe o aviso', () => {
  const s = situacaoFiscalProduto(FONTE, gruposComRegra([{ grupo_tributario_id: 'g1', ativo: true }]));
  assert.equal(s.grupoSemRegra, false);
  assert.deepEqual(s.pendencias, []);
  assert.equal(s.liberado, true);
});

test('produto sem grupo nenhum tem a pendência, não o aviso — são coisas diferentes', () => {
  // "sem grupo" é cadastro incompleto e aparece em pendenciasFiscaisProduto.
  // "grupo sem regra" é cadastro completo que ainda assim vai ser recusado na
  // emissão. Misturar os dois esconde um dos dois problemas.
  const s = situacaoFiscalProduto({ ...FONTE, grupo_tributario_id: null }, gruposComRegra([]));
  assert.equal(s.grupoSemRegra, false);
  assert.ok(s.pendencias.some(p => /grupo tributário/i.test(p)), s.pendencias.join(' | '));
});
```

- [ ] **Step 2: Rodar os testes e ver falharem**

Run: `node --test tests/fiscal.test.mjs`
Expected: FAIL — `camposCopiaFiscal is not a function`.

- [ ] **Step 3: Escrever a implementação em `lib/fiscal.js`**

Acrescentar logo depois de `pendenciasFiscaisProduto`:

```js
// Os campos que uma cópia de configuração fiscal leva de um produto a outro.
// Lista única, lida pela tela e pela rota — duas listas divergiriam no primeiro
// campo novo que alguém acrescentasse ao cadastro.
//
// Fora daqui, de propósito: gtin e gtin_tributavel (código de barras é único
// por produto), unidade (é a unidade de venda, não dado fiscal), peso líquido
// e bruto (atributo físico do item) e ativo_fiscal — que não é dado, é a
// declaração de que alguém conferiu a classificação.
export const CAMPOS_COPIA_FISCAL = [
  'ncm', 'ex_tipi', 'cest', 'origem_mercadoria',
  'unidade_tributavel', 'fator_conversao_tributavel',
  'grupo_tributario_id', 'ind_escala', 'cnpj_fabricante', 'cst_ibs_cbs',
];

// Copiar é espelhar, inclusive o vazio: se a fonte está sem CEST, o destino
// fica sem CEST. Por isso campo ausente vira `null` explícito e não some do
// payload — sumir seria mesclar, e mesclar produz um produto que não é igual a
// nenhum dos dois e que ninguém conferiu.
export function camposCopiaFiscal(produtoFonte = {}) {
  const payload = {};
  for (const campo of CAMPOS_COPIA_FISCAL) {
    payload[campo] = produtoFonte[campo] ?? null;
  }
  return payload;
}

// Quais grupos tributários têm ao menos uma regra ativa.
//
// Não é simulação de fn_resolver_regra_tributaria: a resolução real depende de
// natureza da operação, UF de destino e perfil do destinatário, que só existem
// na hora de emitir. "Zero regras" é certeza de falha na emissão; "tem regra"
// não é garantia de sucesso — e a tela precisa dizer isso nesses termos.
export function gruposComRegra(regras = []) {
  const comRegra = new Set();
  for (const regra of regras) {
    if (regra?.ativo === false) continue;
    if (regra?.grupo_tributario_id) comRegra.add(regra.grupo_tributario_id);
  }
  return comRegra;
}

// A linha da tela de situação fiscal, derivada fora da tela para ser testável.
//
// `grupoSemRegra` só existe para produto QUE TEM grupo: produto sem grupo já
// aparece na lista de pendências, e marcar os dois avisos esconderia um deles.
export function situacaoFiscalProduto(produto = {}, gruposComRegraSet = new Set()) {
  const pendencias = pendenciasFiscaisProduto(produto);
  return {
    pendencias,
    grupoSemRegra: Boolean(produto.grupo_tributario_id)
      && !gruposComRegraSet.has(produto.grupo_tributario_id),
    liberado: pendencias.length === 0,
  };
}
```

- [ ] **Step 4: Rodar os testes e ver passarem**

Run: `node --test tests/fiscal.test.mjs`
Expected: PASS.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test`
Expected: tudo verde.

- [ ] **Step 6: Commit**

```bash
git add lib/fiscal.js tests/fiscal.test.mjs
git commit -m "feat(fiscal): campos copiáveis do cadastro fiscal e aviso de grupo sem regra"
```

---

### Task 5: Rota de cópia

**Files:**
- Modify: `lib/autorizacao.js` — `garantirProduto`, no padrão dos irmãos
- Create: `lib/fiscalCopia.js` — a decisão sobre cada destino, pura
- Create: `app/api/fiscal/copiar-tributacao/route.js`
- Test: `tests/fiscal-copiar-tributacao.test.mjs`

**Interfaces:**
- Consumes: `camposCopiaFiscal`, `pendenciasFiscaisProduto` (`lib/fiscal.js`); `garantirLinhaDaEmpresa` (`lib/autorizacao.js`, privada — o export novo a reusa); `autorizarModulo` (`lib/pontoServer.js`).
- Produces:
  - `garantirProduto(sb, user, isAdmin, produtoId, campos?) -> produto` — lança `{ status }` como os irmãos;
  - `avaliarDestino({ origem, destino, payload, liberar }) -> { ok, erro?, gravar?, liberado?, pendencias? }`, de `lib/fiscalCopia.js`;
  - `POST /api/fiscal/copiar-tributacao` com corpo `{ origemId, destinoIds: [], liberar: boolean }` e resposta `{ resultados: [{ produtoId, copiado, liberado, pendencias }] }`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/fiscal-copiar-tributacao.test.mjs`:

```js
// O que a rota decide sobre cada destino é lógica pura, testada aqui sem banco
// e sem Next. A rota fica fina de propósito: autoriza, chama isto, grava.
//
// Fora do alcance destes testes, e sem cobertura automatizada: a checagem de
// módulo (autorizarModulo), o acesso por empresa (garantirProduto) e a gravação
// em audit_logs. Os três são exercidos no passo de verificação manual da
// entrega — dizer isso aqui é melhor do que fingir que estão cobertos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { avaliarDestino } from '../lib/fiscalCopia.js';
import { camposCopiaFiscal } from '../lib/fiscal.js';

const ORIGEM = { id: 'p1', nome: 'Costela Defumada 500g', empresa_id: 'e1' };

const FONTE_COMPLETA = {
  ncm: '02102000', ex_tipi: null, cest: '1708300', origem_mercadoria: 0,
  unidade_tributavel: 'KG', fator_conversao_tributavel: 1,
  grupo_tributario_id: 'g1', ind_escala: 'S', cnpj_fabricante: null, cst_ibs_cbs: null,
};

const DESTINO = {
  id: 'p2', nome: 'Cupim Defumado 500g', empresa_id: 'e1', unidade: 'KG',
  gtin: null, gtin_tributavel: null, sujeito_st: true, ativo_fiscal: false,
};

const avaliar = (extra = {}, opcoes = {}) => avaliarDestino({
  origem: ORIGEM,
  destino: { ...DESTINO, ...(opcoes.destino || {}) },
  payload: camposCopiaFiscal({ ...FONTE_COMPLETA, ...extra }),
  liberar: opcoes.liberar ?? true,
});

test('destino de outra marca é recusado', () => {
  // grupo_tributario_id pertence a uma empresa: propagá-lo entre CNPJs produz
  // regra que nunca resolve e leva configuração fiscal de um estabelecimento
  // para outro.
  const r = avaliar({}, { destino: { empresa_id: 'e2' } });
  assert.equal(r.ok, false);
  assert.match(r.erro, /outra marca/i);
  assert.equal(r.gravar, undefined, 'destino recusado não pode ter nada a gravar');
});

test('destino que fica completo depois da cópia é liberado', () => {
  const r = avaliar();
  assert.equal(r.ok, true);
  assert.equal(r.liberado, true);
  assert.deepEqual(r.pendencias, []);
  assert.equal(r.gravar.ativo_fiscal, true);
});

test('a decisão olha o produto DEPOIS da cópia, não antes', () => {
  // O destino chega sem NCM nenhum; é a cópia que o completa. Avaliar o estado
  // anterior recusaria toda liberação e a ação nunca apareceria na tela.
  assert.equal(DESTINO.ncm, undefined);
  assert.equal(avaliar().liberado, true);
});

test('sem pedir liberação, ativo_fiscal não é tocado', () => {
  const r = avaliar({}, { liberar: false });
  assert.equal(r.liberado, false);
  assert.ok(!('ativo_fiscal' in r.gravar),
    'copiar não pode assinar embaixo de uma classificação que ninguém olhou');
});

test('destino que continua incompleto não é liberado e diz o que falta', () => {
  const r = avaliar({ ncm: null });
  assert.equal(r.liberado, false);
  assert.ok(!('ativo_fiscal' in r.gravar));
  assert.ok(r.pendencias.some(p => /NCM/i.test(p)), r.pendencias.join(' | '));
});

test('pendência que a cópia não resolve continua barrando', () => {
  // Código de barras inválido é do produto, não da classificação — a cópia não
  // toca nele, e ele impede a emissão do mesmo jeito.
  const r = avaliar({}, { destino: { gtin: '123' } });
  assert.equal(r.liberado, false);
  assert.ok(r.pendencias.some(p => /barras/i.test(p)), r.pendencias.join(' | '));
});

test('produto sujeito a ST sem CEST na fonte não é liberado', () => {
  const r = avaliar({ cest: null });
  assert.equal(r.liberado, false);
  assert.ok(r.pendencias.some(p => /CEST/i.test(p)), r.pendencias.join(' | '));
});

test('o payload gravado espelha a fonte, inclusive o vazio', () => {
  const r = avaliar({ cest: null }, { liberar: false });
  assert.ok('cest' in r.gravar);
  assert.equal(r.gravar.cest, null, 'copiar é substituir, não mesclar');
});
```

- [ ] **Step 2: Rodar os testes e ver falharem**

Run: `node --test tests/fiscal-copiar-tributacao.test.mjs`
Expected: FAIL — `Cannot find module '../lib/fiscalCopia.js'`.

- [ ] **Step 3: Escrever `lib/fiscalCopia.js`**

```js
// O que a rota decide sobre um destino da cópia, separado dela para poder ser
// testado sem banco.
//
// A avaliação das pendências é sobre o produto DEPOIS da cópia: é a cópia que
// completa o cadastro, e olhar o estado anterior recusaria toda liberação.
// Campos que a cópia não toca (código de barras, unidade de venda) entram na
// conta assim mesmo — eles impedem a emissão do mesmo jeito.
import { pendenciasFiscaisProduto } from './fiscal.js';

export function avaliarDestino({ origem = {}, destino = {}, payload = {}, liberar = false }) {
  // grupo_tributario_id pertence a uma empresa. Propagá-lo entre CNPJs produz
  // uma regra que nunca resolve e leva a configuração fiscal de um
  // estabelecimento para outro.
  if (destino.empresa_id !== origem.empresa_id) {
    return {
      ok: false,
      erro: `"${destino.nome || destino.id}" é de outra marca; a configuração fiscal não atravessa CNPJ.`,
    };
  }

  const pendencias = pendenciasFiscaisProduto({ ...destino, ...payload });
  const liberado = Boolean(liberar) && pendencias.length === 0;
  // ativo_fiscal só entra no update quando a liberação foi pedida E o cadastro
  // ficou completo. Fora disso a chave nem aparece: mandar `false` apagaria a
  // liberação de um produto que já estava conferido.
  const gravar = liberado ? { ...payload, ativo_fiscal: true } : { ...payload };
  return { ok: true, gravar, liberado, pendencias };
}
```

- [ ] **Step 4: Rodar os testes e ver passarem**

Run: `node --test tests/fiscal-copiar-tributacao.test.mjs`
Expected: PASS.

- [ ] **Step 5: Acrescentar `garantirProduto` a `lib/autorizacao.js`**

Depois de `garantirPedido` (linha 93), no mesmo formato:

```js
export async function garantirProduto(sb, user, isAdmin, produtoId,
  campos = 'id, nome, codigo, empresa_id') {
  return garantirLinhaDaEmpresa(sb, user, isAdmin, {
    tabela: 'produtos', id: produtoId, campos,
    rotulo: { artigo: 'o', nome: 'produto', titulo: 'Produto' },
    naoEncontrado: 'Produto não encontrado.',
  });
}
```

`garantirLinhaDaEmpresa` já devolve a mesma recusa para "não existe" e "existe em outra empresa" — é o que a spec pede ao exigir `garantirEmpresa` em cada destino, sem transformar a rota num oráculo de enumeração.

- [ ] **Step 6: Escrever a rota**

Criar `app/api/fiscal/copiar-tributacao/route.js`:

```js
import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../../lib/pontoServer';
import { garantirProduto } from '../../../../lib/autorizacao';
import { camposCopiaFiscal } from '../../../../lib/fiscal';
import { avaliarDestino } from '../../../../lib/fiscalCopia';

export const runtime = 'nodejs';

// POST body: { origemId, destinoIds: [], liberar: boolean }
//
// Copia a configuração fiscal de um produto para outros, um a um. Não é
// transação única sobre todos os destinos: um destino que falhe não desfaz os
// que deram certo, e o retorno diz o que aconteceu com cada um. A operação é
// idempotente — reaplicar a mesma cópia dá o mesmo resultado — e um lote de dez
// parando inteiro por causa de um é pior do que nove entrarem.
export async function POST(request) {
  const { sb, user, isAdmin, erro } = await autorizarModulo(request, 'fiscal');
  if (erro) return erro;

  let corpo;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 });
  }
  const { origemId, destinoIds, liberar } = corpo;
  if (!origemId || !Array.isArray(destinoIds) || destinoIds.length === 0) {
    return NextResponse.json({ error: 'Informe origemId e ao menos um destino.' }, { status: 400 });
  }

  // A origem precisa de todos os campos copiáveis; garantirProduto valida a
  // forma do id e o acesso à empresa antes de qualquer leitura útil.
  let origem;
  try {
    origem = await garantirProduto(sb, user, isAdmin, origemId,
      'id, nome, codigo, empresa_id, ncm, ex_tipi, cest, origem_mercadoria, unidade_tributavel, '
      + 'fator_conversao_tributavel, grupo_tributario_id, ind_escala, cnpj_fabricante, cst_ibs_cbs');
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 404 });
  }

  const payload = camposCopiaFiscal(origem);
  const resultados = [];

  for (const destinoId of destinoIds) {
    let destino;
    try {
      destino = await garantirProduto(sb, user, isAdmin, destinoId,
        'id, nome, codigo, empresa_id, unidade, gtin, gtin_tributavel, sujeito_st, ativo_fiscal');
    } catch (e) {
      resultados.push({ produtoId: destinoId, copiado: false, liberado: false, erro: e.message });
      continue;
    }

    // A checagem de marca é separada da de acesso e vem depois dela: um usuário
    // pode alcançar as duas empresas do grupo e ainda assim não poder levar
    // configuração fiscal de uma para a outra.
    const avaliacao = avaliarDestino({ origem, destino, payload, liberar });
    if (!avaliacao.ok) {
      resultados.push({ produtoId: destinoId, copiado: false, liberado: false, erro: avaliacao.erro });
      continue;
    }

    const { error } = await sb.from('produtos').update(avaliacao.gravar).eq('id', destinoId);
    if (error) {
      resultados.push({ produtoId: destinoId, copiado: false, liberado: false, erro: error.message });
      continue;
    }
    resultados.push({
      produtoId: destinoId, nome: destino.nome, copiado: true,
      liberado: avaliacao.liberado, pendencias: avaliacao.pendencias,
    });
  }

  // Auditoria por inserção direta, não pela RPC fn_registrar_auditoria: ela
  // preenche usuario_id com auth.uid(), sempre nulo no client service-role que
  // as rotas usam — auditar por ela daqui grava linha órfã.
  await sb.from('audit_logs').insert([{
    usuario_id: user.id,
    empresa_id: origem.empresa_id,
    acao: 'fiscal.copiar_tributacao',
    tabela: 'produtos',
    registro_id: origem.id,
    detalhes: {
      origem: origem.codigo || origem.id,
      destinos: resultados.map(r => ({ id: r.produtoId, copiado: r.copiado, liberado: r.liberado })),
      liberacaoPedida: Boolean(liberar),
    },
  }]);

  return NextResponse.json({ resultados });
}
```

- [ ] **Step 7: Conferir as colunas de `audit_logs` antes de confiar no insert**

Run: `psql "$SUPABASE_DB_URL" -c "\d audit_logs"` — a partir de `sistema-364-web`, com `set -a; . ./.env.local; set +a` antes.
Expected: as colunas usadas acima existem. Se algum nome divergir, ajustar o insert ao schema real — o schema manda, não este plano.

- [ ] **Step 8: Rodar a suíte inteira**

Run: `npm test`
Expected: tudo verde.

- [ ] **Step 9: Commit**

```bash
git add lib/autorizacao.js lib/fiscalCopia.js app/api/fiscal/copiar-tributacao/route.js tests/fiscal-copiar-tributacao.test.mjs
git commit -m "feat(fiscal): rota de cópia de configuração fiscal entre produtos"
```

---

### Task 6: Tela de situação fiscal dos produtos

**Files:**
- Create: `app/fiscal/produtos/page.js`
- Modify: `lib/menu.js:46-49`
- Test: nenhum automatizado — a verificação é no navegador, no passo 4.

**Interfaces:**
- Consumes: `situacaoFiscalProduto`, `camposCopiaFiscal`, `CAMPOS_COPIA_FISCAL`, `gruposComRegra` (`lib/fiscal.js`); `POST /api/fiscal/copiar-tributacao` (Task 5); `AppShell`, `useEmpresaAtual`, `supabase`, no padrão de `app/fiscal/tributacao/page.js`.
- Produces: nada que outra tarefa consuma.

- [ ] **Step 1: Pôr o item no menu**

Em `lib/menu.js`, entre "Tributação" e "Emissor":

```js
      { label: 'Produtos — situação fiscal', href: '/fiscal/produtos', modulo: 'fiscal' },
```

- [ ] **Step 2: Escrever a tela**

Criar `app/fiscal/produtos/page.js`:

```jsx
'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import AppShell from '../../../components/AppShell';
import { useEmpresaAtual } from '../../../lib/empresa';
import { situacaoFiscalProduto, camposCopiaFiscal, CAMPOS_COPIA_FISCAL, gruposComRegra } from '../../../lib/fiscal';

// Quais produtos ainda não conseguem emitir nota — pergunta que hoje não tem
// resposta em tela nenhuma, e que é o impedimento atual da linha Food Service.
// A cópia de configuração vive aqui porque é a ação que a resposta pede.

export default function ProdutosFiscalPage() {
  return (
    <AppShell modulo="fiscal" titulo="Produtos — situação fiscal"
              desc="O que falta em cada produto para ele poder entrar numa nota">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const { empresaAtual } = useEmpresaAtual();
  const [loading, setLoading] = useState(true);
  const [produtos, setProdutos] = useState([]);
  const [grupos, setGrupos] = useState([]);
  const [comRegra, setComRegra] = useState(new Set());
  const [origemId, setOrigemId] = useState('');
  const [destinos, setDestinos] = useState([]);
  const [aplicando, setAplicando] = useState(false);
  const [resultado, setResultado] = useState(null);

  useEffect(() => { if (empresaAtual?.id) carregar(); }, [empresaAtual?.id]);

  async function carregar() {
    setLoading(true);
    const [p, g, r] = await Promise.all([
      supabase.from('produtos')
        .select('id, codigo, nome, unidade, ncm, ex_tipi, cest, origem_mercadoria, unidade_tributavel, '
          + 'fator_conversao_tributavel, grupo_tributario_id, ind_escala, cnpj_fabricante, cst_ibs_cbs, '
          + 'gtin, gtin_tributavel, sujeito_st, ativo_fiscal')
        .eq('empresa_id', empresaAtual.id).eq('ativo', true).order('codigo'),
      supabase.from('grupos_tributarios').select('id, codigo').eq('empresa_id', empresaAtual.id),
      supabase.from('regras_tributarias').select('grupo_tributario_id, ativo').eq('empresa_id', empresaAtual.id),
    ]);
    setProdutos(p.data || []);
    setGrupos(g.data || []);
    setComRegra(gruposComRegra(r.data || []));
    setLoading(false);
  }

  // situacaoFiscalProduto também marca `grupoSemRegra`: pendenciasFiscaisProduto
  // confere que existe grupo, não que exista regra para ele. Um produto pode
  // passar em todas as pendências, ser liberado, e ainda assim ser recusado na
  // emissão com "Não há regra tributária para…".
  const linhas = useMemo(() => produtos.map(p => ({
    ...p,
    ...situacaoFiscalProduto(p, comRegra),
    grupoCodigo: grupos.find(g => g.id === p.grupo_tributario_id)?.codigo || '—',
  })), [produtos, grupos, comRegra]);

  const fonte = produtos.find(p => p.id === origemId) || null;
  const payload = fonte ? camposCopiaFiscal(fonte) : null;

  function alternarDestino(id) {
    setDestinos(d => (d.includes(id) ? d.filter(x => x !== id) : [...d, id]));
  }

  async function aplicar(liberar) {
    setAplicando(true);
    setResultado(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resposta = await fetch('/api/fiscal/copiar-tributacao', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ origemId, destinoIds: destinos, liberar }),
      });
      const corpo = await resposta.json();
      if (!resposta.ok) { setResultado({ erro: corpo.error || 'Falha ao copiar.' }); return; }
      setResultado(corpo);
      setDestinos([]);
      await carregar();
    } finally {
      setAplicando(false);
    }
  }

  if (loading) return <p className="muted">Carregando…</p>;

  return (
    <>
      <table className="tabela">
        <thead>
          <tr>
            <th></th><th>Código</th><th>Produto</th><th>NCM</th><th>CEST</th>
            <th>Grupo</th><th>Situação</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map(l => (
            <tr key={l.id}>
              <td>
                <input type="checkbox" checked={destinos.includes(l.id)}
                       disabled={l.id === origemId}
                       onChange={() => alternarDestino(l.id)} />
              </td>
              <td>{l.codigo}</td>
              <td>{l.nome}</td>
              <td>{l.ncm || '—'}</td>
              <td>{l.cest || '—'}</td>
              <td>{l.grupoCodigo}</td>
              <td>
                {l.pendencias.length === 0 && !l.grupoSemRegra && l.ativo_fiscal
                  ? <span>Liberado para emissão</span>
                  : (
                    <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
                      {l.pendencias.map(p => <li key={p}>{p}</li>)}
                      {l.grupoSemRegra && (
                        <li>
                          o grupo {l.grupoCodigo} não tem nenhuma regra ativa — sem ela a emissão
                          é recusada mesmo com o cadastro completo
                        </li>
                      )}
                      {l.pendencias.length === 0 && !l.ativo_fiscal && (
                        <li>cadastro completo, falta liberar para emissão</li>
                      )}
                    </ul>
                  )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 style={{ marginTop: 24 }}>Copiar configuração fiscal</h3>
      <div className="form-grid">
        <div>
          <label>Produto de origem</label>
          <select value={origemId} onChange={e => { setOrigemId(e.target.value); setDestinos([]); }}>
            <option value="">Escolha…</option>
            {produtos.map(p => <option key={p.id} value={p.id}>{p.codigo} — {p.nome}</option>)}
          </select>
        </div>
      </div>

      {fonte && destinos.length > 0 && (
        <>
          <p className="muted" style={{ marginTop: 12 }}>
            O que muda em cada destino. Copiar é espelhar: campo vazio na origem apaga o valor do destino.
          </p>
          <table className="tabela">
            <thead><tr><th>Destino</th><th>Campo</th><th>Hoje</th><th>Fica</th></tr></thead>
            <tbody>
              {destinos.flatMap(id => {
                const destino = produtos.find(p => p.id === id);
                return CAMPOS_COPIA_FISCAL
                  .filter(campo => String(destino?.[campo] ?? '') !== String(payload[campo] ?? ''))
                  .map(campo => {
                    const tinha = destino?.[campo] ?? null;
                    const fica = payload[campo];
                    const apaga = tinha !== null && tinha !== '' && (fica === null || fica === '');
                    return (
                      <tr key={`${id}-${campo}`}>
                        <td>{destino?.codigo}</td>
                        <td>{campo}</td>
                        <td style={apaga ? { color: 'var(--red, #d66)' } : undefined}>{String(tinha ?? '—')}</td>
                        <td>{String(fica ?? '—')}</td>
                      </tr>
                    );
                  });
              })}
            </tbody>
          </table>

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn" disabled={aplicando} onClick={() => aplicar(false)}>
              {aplicando ? 'Aplicando…' : `Copiar para ${destinos.length} produto(s)`}
            </button>
            <button className="btn secondary" disabled={aplicando} onClick={() => aplicar(true)}>
              Copiar e liberar os que ficarem completos
            </button>
          </div>
          <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
            Liberar para emissão é declarar que alguém conferiu a classificação. NCM errado
            classifica errado a operação inteira — carne salgada e farofa não têm o mesmo NCM.
          </p>
        </>
      )}

      {resultado?.erro && <p className="muted" style={{ marginTop: 12 }}>{resultado.erro}</p>}
      {resultado?.resultados && (
        <ul style={{ marginTop: 12, fontSize: 13 }}>
          {resultado.resultados.map(r => (
            <li key={r.produtoId}>
              {r.nome || r.produtoId}: {r.erro
                ? `não entrou — ${r.erro}`
                : `copiado${r.liberado ? ' e liberado' : ''}`}
              {!r.erro && !r.liberado && r.pendencias?.length
                ? ` (ainda falta: ${r.pendencias.join('; ')})`
                : ''}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
```

- [ ] **Step 3: Rodar a suíte inteira**

Run: `npm test`
Expected: tudo verde — a tela não tem teste automatizado, mas nada pode ter quebrado.

- [ ] **Step 4: Verificar no navegador**

Subir o preview e abrir `/fiscal/produtos`. Conferir, com a marca 364 Food Service selecionada:

1. os dez produtos aparecem, e os que estão sem NCM mostram a pendência;
2. `0364-001` aparece com o aviso de grupo sem regra, porque `DEFUMADO_BOVINO_ST` só tem uma regra e é a única que existe — se ela estiver ativa, o aviso não aparece nele e aparece nos produtos dos grupos `PDV …`;
3. escolher `0364-001` como origem e marcar `0364-004 Cupim Defumado` mostra a prévia campo a campo antes de qualquer gravação;
4. **não aplicar a cópia neste passo** — a gravação é contra a produção e depende de autorização do usuário.

- [ ] **Step 5: Commit**

```bash
git add app/fiscal/produtos/page.js lib/menu.js
git commit -m "feat(fiscal): tela de situação fiscal dos produtos com cópia de configuração"
```

---

## Entrega

Depois da Task 6, **parar e falar com o usuário**. Nada roda contra a produção sem autorização, e há três decisões que são dele ou do contador:

1. **Quais produtos recebem a cópia.** `0210.20.00` é carne bovina salgada, seca ou defumada. Farofa, geleia, escondidinho, croquete e hambúrguer **não** são isso — preparação de carne é capítulo 16. A ferramenta aplica a classificação; não a decide.
2. **A regra tributária vigente está com CSOSN 101 e CFOP 5405**, par incoerente — o CSOSN que corresponde a 5405 é 500, e o serializador recusa 101 de propósito. Correção de cadastro, não de código.
3. **Quatro grupos tributários novos (`PDV 5101/102`, `PDV 5102/102`, `PDV 5102/400`, `PDV 5405/500`) estão sem nenhuma regra**, criados pela importação do PDV de 28/08. A tela desta entrega torna a lacuna visível; cadastrar as regras é trabalho de contador, uma por grupo.

## Pendências que este plano não resolve

- **`sujeito_st` não está entre os campos copiados** e a spec não o inclui. Isso permite um destino com `sujeito_st = true` receber `cest = null` de uma origem não sujeita a ST — o `avaliarDestino` barra a liberação (o teste "produto sujeito a ST sem CEST na fonte não é liberado" cobre exatamente isso), então não gera nota errada, mas gera confusão de cadastro. Levar ao usuário antes de decidir incluir.
- **`ICMSSN500` sai com `orig` e `CSOSN` apenas**, sem `vBCSTRet`/`pST`/`vICMSSubstituto`/`vICMSSTRet`. Válido no schema, suficiente para homologação; para produção, confirmar com o contador se o cliente precisa desses valores para se creditar.
- **Gerenciador de notas fiscais e eventos de SEFAZ** são as specs 2 e 3 da série, fora deste plano.
