# Fundação SEFAZ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provar, ponta a ponta, que o certificado A1 da 364 assina um XML no formato que a NF-e exige e que a SEFAZ responde ao sistema — sem emitir nota nenhuma.

**Architecture:** Uma camada nova `lib/sefaz/` com quatro peças isoladas e testáveis: resolução de endpoint por serviço/ambiente, extração de chave e certificado do `.pfx`, assinatura XMLDSig, e transporte SOAP sobre mTLS. Em cima delas, o serviço mais leve da SEFAZ (`NFeStatusServico4`, que não emite nem altera nada) exposto como um botão "Testar conexão" na tela `/fiscal/emissor` já existente.

**Tech Stack:** Next.js (App Router, `runtime = 'nodejs'`), `xml-crypto@^6.1.2` (assinatura XMLDSig), `undici@^8` (mTLS — o `fetch` do Node não aceita `https.Agent`), `node-forge` (já instalado, lê o PKCS#12), `node --test` para os testes.

**Spec:** [docs/superpowers/specs/2026-08-25-motor-emissao-nfe-design.md](../specs/2026-08-25-motor-emissao-nfe-design.md) — este plano cobre a fundação técnica que aquele spec assumiu existir; o motor de emissão em si (XML da nota, numeração, máquina de estados, eventos, DANFE) é o plano seguinte.

## Por que este plano existe

O spec do motor afirma que a assinatura XMLDSig e o transporte mTLS "reaproveitam o que já existe e está em produção no lado de entrada". **Isso é falso e foi verificado:** um grep no repositório inteiro não encontra XMLDSig, nem `xml-crypto`, nem `undici`, nem qualquer chamada a webservice da SEFAZ; `lib/sefaz/` não existe. O projeto de NF-e de entrada entregou apenas a fase 1 (parser de XML enviado por e-mail) — as fases 2 e 3, que construiriam essa fundação, foram planejadas e nunca executadas.

O que de fato existe e é reaproveitado aqui: `obterCertificadoAtivo(empregadorId)` em `lib/certificadoServer.js`, que já devolve `{ pfx: Buffer, senha: string, meta }` decifrados.

## Global Constraints

- **Nada neste plano emite documento fiscal.** O único serviço da SEFAZ chamado é `NFeStatusServico4`, que é read-only e não consome numeração.
- **Nenhuma migração de banco.** Este plano é código, uma rota de API e um botão — não há DDL, não há nada para aplicar em produção antes do deploy.
- Toda rota de API usa `autorizarModulo(request, 'fiscal')` **e** `garantirEmpresa(sb, user, isAdmin, <empresaId>)` de `lib/autorizacao.js` antes de qualquer leitura ou escrita — `autorizarModulo` sozinho não escopa por empresa, e foi exatamente essa lacuna que gerou um IDOR na fase anterior.
- O material do certificado (`pfx`, senha, chave privada em PEM) **nunca** entra em resposta HTTP, log, mensagem de erro ou estado de client. Vive só em memória, dentro da requisição.
- Endpoints da SEFAZ ficam em **um único arquivo de constantes**, nunca espalhados — o Manual de Integração muda e a UF pode migrar de ambiente virtual.
- Rondônia autoriza pela **SVRS** (Sefaz Virtual do RS), não por SEFAZ própria. `cUF` de RO é `11`.
- A NF-e exige **C14N inclusiva** (`http://www.w3.org/TR/2001/REC-xml-c14n-20010315`), não exclusiva. Trocar por `xml-exc-c14n#` gera assinatura que a SEFAZ rejeita.

---

## File Structure

- `package.json` (modificado) — acrescenta `xml-crypto` e `undici`.
- `lib/sefaz/endpoints.js` (novo) — URLs por serviço e ambiente, `cUF`, conversão `ambiente` → `tpAmb`.
- `lib/certificadoServer.js` (modificado) — extrai um `abrirPfx` interno reutilizável e acrescenta `extrairChaveECert`; `inspecionarPfx` passa a usar o mesmo helper, sem mudança de comportamento externo.
- `tests/helpers/pfx.mjs` (novo) — `gerarPfx`, hoje duplicado dentro de `tests/certificado.test.mjs`, vira helper compartilhado.
- `lib/sefaz/assinatura.js` (novo) — `assinarXml`.
- `lib/sefaz/envelope.js` (novo) — monta o envelope SOAP e extrai o corpo da resposta. Puro, sem rede.
- `lib/sefaz/transporte.js` (novo) — `chamarSefaz`, o único lugar com rede.
- `lib/sefaz/statusServico.js` (novo) — `consultarStatusServico`.
- `app/api/fiscal/testar-conexao/route.js` (novo) — `POST`.
- `app/fiscal/emissor/page.js` (modificado) — botão por ambiente.
- Testes: `tests/sefaz-endpoints.test.mjs`, `tests/sefaz-assinatura.test.mjs`, `tests/sefaz-envelope.test.mjs`.

**O que os testes cobrem e o que não cobrem:** a assinatura é verificada criptograficamente por teste automatizado, offline e determinístico. A conectividade só se prova contra a SEFAZ de verdade, e é isso que o botão faz. Nenhum dos dois cobre o outro — o botão **não** exercita a assinatura, porque `consStatServ` não é um documento assinado. Não confundir os dois quando for validar.

---

### Task 1: Dependências e endpoints da SVRS

**Files:**
- Modify: `package.json`
- Create: `lib/sefaz/endpoints.js`
- Test: `tests/sefaz-endpoints.test.mjs`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `CUF_RONDONIA = '11'`
  - `tpAmb(ambiente)` — `'producao' → '1'`, `'homologacao' → '2'`; qualquer outro valor lança.
  - `endpointSefaz(servico, ambiente)` — `servico` ∈ `'statusServico' | 'autorizacao' | 'retAutorizacao' | 'recepcaoEvento'`; devolve a URL; serviço ou ambiente desconhecido lança.

- [ ] **Step 1: Instalar as dependências**

```bash
npm install xml-crypto@^6.1.2 undici@^8
```

- [ ] **Step 2: Escrever o teste (falhando)**

```javascript
// tests/sefaz-endpoints.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { endpointSefaz, tpAmb, CUF_RONDONIA } from '../lib/sefaz/endpoints.js';

test('cUF de Rondônia', () => {
  assert.equal(CUF_RONDONIA, '11');
});

test('tpAmb traduz o ambiente da configuração para o código do XML', () => {
  assert.equal(tpAmb('producao'), '1');
  assert.equal(tpAmb('homologacao'), '2');
});

test('tpAmb recusa ambiente desconhecido em vez de devolver undefined', () => {
  assert.throws(() => tpAmb('teste'), /ambiente/i);
  assert.throws(() => tpAmb(undefined), /ambiente/i);
});

test('produção e homologação são hosts diferentes', () => {
  const prod = endpointSefaz('statusServico', 'producao');
  const homo = endpointSefaz('statusServico', 'homologacao');
  assert.notEqual(prod, homo);
  assert.match(prod, /^https:\/\/nfe\.svrs\.rs\.gov\.br\//);
  assert.match(homo, /^https:\/\/nfe-homologacao\.svrs\.rs\.gov\.br\//);
});

test('os quatro serviços têm endpoint nos dois ambientes', () => {
  for (const servico of ['statusServico', 'autorizacao', 'retAutorizacao', 'recepcaoEvento']) {
    for (const ambiente of ['producao', 'homologacao']) {
      assert.match(endpointSefaz(servico, ambiente), /^https:\/\/.+\.asmx$/, `${servico}/${ambiente}`);
    }
  }
});

test('serviço desconhecido lança em vez de devolver undefined', () => {
  assert.throws(() => endpointSefaz('inexistente', 'producao'), /servi/i);
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test tests/sefaz-endpoints.test.mjs`
Expected: FAIL — `Cannot find module '../lib/sefaz/endpoints.js'`

- [ ] **Step 4: Implementar**

```javascript
// lib/sefaz/endpoints.js
//
// Endereços dos webservices da NF-e. Rondônia não tem SEFAZ própria para NF-e:
// autoriza pela SVRS (Sefaz Virtual do Rio Grande do Sul). Por isso os hosts
// abaixo são svrs.rs.gov.br e não sefaz.ro.gov.br.
//
// Fonte: portal da SVRS (dfe-portal.svrs.rs.gov.br/NFE/Servicos), consultado em
// 2026-08-25. O Manual de Integração muda de tempos em tempos e uma UF pode
// migrar de ambiente virtual — quando a comunicação parar de funcionar sem que
// o código tenha mudado, é aqui que se olha primeiro. A tela /fiscal/emissor
// tem um botão "Testar conexão" justamente para essa conferência.

export const CUF_RONDONIA = '11';

const BASE = {
  producao: 'https://nfe.svrs.rs.gov.br/ws',
  homologacao: 'https://nfe-homologacao.svrs.rs.gov.br/ws',
};

const CAMINHO = {
  statusServico: 'NfeStatusServico/NfeStatusServico4.asmx',
  autorizacao: 'NfeAutorizacao/NFeAutorizacao4.asmx',
  retAutorizacao: 'NfeRetAutorizacao/NFeRetAutorizacao4.asmx',
  recepcaoEvento: 'recepcaoevento/recepcaoevento4.asmx',
};

// A configuração guarda 'producao'/'homologacao'; o XML da NF-e usa tpAmb 1/2.
// Traduzir num só lugar evita que os dois vocabulários se misturem no resto do
// código — trocar os dois valores por engano manda nota de teste para produção.
export function tpAmb(ambiente) {
  if (ambiente === 'producao') return '1';
  if (ambiente === 'homologacao') return '2';
  throw new Error(`Ambiente inválido: ${ambiente}. Use 'producao' ou 'homologacao'.`);
}

export function endpointSefaz(servico, ambiente) {
  const base = BASE[ambiente];
  if (!base) throw new Error(`Ambiente inválido: ${ambiente}. Use 'producao' ou 'homologacao'.`);
  const caminho = CAMINHO[servico];
  if (!caminho) throw new Error(`Serviço desconhecido: ${servico}.`);
  return `${base}/${caminho}`;
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test tests/sefaz-endpoints.test.mjs` e depois `npm test`
Expected: novos testes PASS, suíte inteira continua verde.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json lib/sefaz/endpoints.js tests/sefaz-endpoints.test.mjs
git commit -m "feat(sefaz): endpoints da SVRS e tradução de ambiente"
```

---

### Task 2: Extrair chave privada e certificado do .pfx

**Files:**
- Modify: `lib/certificadoServer.js`
- Modify: `tests/certificado.test.mjs` (passa a importar o helper extraído)
- Create: `tests/helpers/pfx.mjs`
- Test: `tests/certificado.test.mjs` (acrescenta casos)

**Interfaces:**
- Consumes: `node-forge` (já instalado).
- Produces: `extrairChaveECert(buffer, senha)` → `{ chavePrivadaPem: string, certificadoPem: string, certificadoBase64: string }`. `certificadoBase64` é o DER em base64 **sem** cabeçalho PEM nem quebras de linha — é o formato que vai dentro de `<X509Certificate>`.

**Contexto:** `inspecionarPfx` já faz o trabalho difícil de achar o bag certo dentro do PKCS#12 (o certificado do titular, não os da cadeia), mas devolve só metadados. Assinar e falar mTLS precisam da chave e do certificado em si. Em vez de duplicar a lógica de bags, extraia um helper interno e faça as duas funções usarem o mesmo — duplicação verbatim de bloco lógico é defeito que a revisão pega.

- [ ] **Step 1: Extrair o helper de teste `gerarPfx`**

`tests/certificado.test.mjs` tem uma função `gerarPfx` que gera um `.pfx` autoassinado com openssl. A Task 3 precisa dela também. Mova-a, **sem alterar seu corpo**, para `tests/helpers/pfx.mjs`:

```javascript
// tests/helpers/pfx.mjs
//
// Gera um pfx autoassinado no formato que a ICP-Brasil usa: CN "NOME:CNPJ" e
// otherName 2.16.76.1.3.3 com o CNPJ. Compartilhado entre os testes de
// certificado e os de assinatura.
//
// O openssl do macOS é LibreSSL 3.3.6: não aceita `-legacy` (flag do OpenSSL 3),
// e o export padrão dele (RC2/3DES) é lido pelo node-forge sem ajuste — por isso
// aqui não há nem `-legacy` nem `-keypbe/-certpbe`.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function gerarPfx({ cn, cnpjOid, senha, dias = 365 }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfx-'));
  const cfg = path.join(dir, 'openssl.cnf');
  fs.writeFileSync(cfg, [
    '[req]', 'distinguished_name=dn', 'x509_extensions=ext', 'prompt=no',
    '[dn]', `CN=${cn}`,
    '[ext]', cnpjOid ? `subjectAltName=otherName:2.16.76.1.3.3;UTF8:${cnpjOid}` : 'basicConstraints=CA:FALSE',
  ].join('\n'));
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', String(dias),
      '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-config', cfg], { stdio: 'pipe' });
    execFileSync('openssl', ['pkcs12', '-export', '-inkey', path.join(dir, 'k.pem'), '-in', path.join(dir, 'c.pem'),
      '-out', path.join(dir, 'c.pfx'), '-passout', `pass:${senha}`], { stdio: 'pipe' });
    return fs.readFileSync(path.join(dir, 'c.pfx'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
```

Em `tests/certificado.test.mjs`, remova a definição local e importe: `import { gerarPfx } from './helpers/pfx.mjs';`. O glob da suíte é `tests/*.test.mjs`, então `tests/helpers/pfx.mjs` não é coletado como teste — confirme rodando `npm test` e vendo a contagem subir só pelos casos novos.

- [ ] **Step 2: Escrever o teste (falhando)**

Acrescente ao fim de `tests/certificado.test.mjs`:

```javascript
test('extrairChaveECert devolve chave e certificado utilizáveis', async () => {
  const { extrairChaveECert } = await import('../lib/certificadoServer.js');
  const pfx = gerarPfx({ cn: '364 STEAKHOUSE LTDA:37541736000187', cnpjOid: '37541736000187', senha: 'abc123' });
  const { chavePrivadaPem, certificadoPem, certificadoBase64 } = extrairChaveECert(pfx, 'abc123');

  assert.match(chavePrivadaPem, /^-----BEGIN (RSA )?PRIVATE KEY-----/);
  assert.match(certificadoPem, /^-----BEGIN CERTIFICATE-----/);
  // O conteúdo de <X509Certificate> é o DER em base64, sem cabeçalho nem quebras.
  assert.doesNotMatch(certificadoBase64, /BEGIN|\n/);
  assert.ok(certificadoBase64.length > 100);

  // A chave precisa de fato assinar: sem isto o teste só confere formato.
  const { createSign, createVerify } = await import('node:crypto');
  const assinatura = createSign('RSA-SHA256').update('conteúdo').sign(chavePrivadaPem);
  assert.ok(createVerify('RSA-SHA256').update('conteúdo').verify(certificadoPem, assinatura),
    'a chave privada extraída não corresponde ao certificado extraído');
});

test('extrairChaveECert recusa senha errada com a mesma mensagem de inspecionarPfx', () => {
  const pfx = gerarPfx({ cn: 'X:60361009000150', senha: 'certa' });
  assert.throws(() => extrairChaveECert(pfx, 'errada'), /Senha do certificado incorreta/);
});
```

Ajuste o `import` no topo do arquivo para trazer `extrairChaveECert` junto dos demais, se preferir, em vez do import dinâmico dentro do teste — o que já estiver no estilo do arquivo.

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test tests/certificado.test.mjs`
Expected: FAIL — `extrairChaveECert is not a function`

- [ ] **Step 4: Implementar**

Em `lib/certificadoServer.js`, extraia de `inspecionarPfx` o miolo que abre o PKCS#12 e acha o bag do titular, e faça as duas funções usarem:

```javascript
// Abre o PKCS#12 e devolve o certificado do titular com a chave que casa com
// ele. Compartilhado por inspecionarPfx (metadados) e extrairChaveECert
// (material para assinar) — a lógica de achar o bag certo é a mesma e não deve
// existir em duas cópias.
function abrirPfx(buffer, senha) {
  let p12;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(buffer.toString('binary')));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, senha || '');
  } catch (e) {
    const msg = String(e?.message || e);
    if (/MAC could not be verified|Invalid password/i.test(msg)) throw new Error('Senha do certificado incorreta.');
    throw new Error('Arquivo não é um certificado PKCS#12 válido.');
  }
  const bags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  const chaves = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [];
  const idChave = chaves[0]?.attributes?.localKeyId?.[0];
  const bag = bags.find(b => idChave && b.attributes?.localKeyId?.[0] === idChave)
    || bags.find(b => b.cert && !b.cert.isIssuer(b.cert))
    || bags[0];
  if (!bag?.cert) throw new Error('Arquivo não é um certificado PKCS#12 válido.');
  return { cert: bag.cert, chave: chaves[0]?.key || null };
}
```

`inspecionarPfx` passa a ser:

```javascript
export function inspecionarPfx(buffer, senha) {
  const { cert } = abrirPfx(buffer, senha);
  return {
    cnpj: cnpjDoCertificado(cert),
    titular: cert.subject.getField('CN')?.value || '',
    emissor: cert.issuer.getField('CN')?.value || '',
    numeroSerie: cert.serialNumber,
    validoDe: cert.validity.notBefore,
    validoAte: cert.validity.notAfter,
  };
}
```

E a função nova:

```javascript
// Material para assinar (XMLDSig) e para o handshake mTLS. Nunca serializar
// nada disto em resposta HTTP nem em log: é a chave privada da empresa.
export function extrairChaveECert(buffer, senha) {
  const { cert, chave } = abrirPfx(buffer, senha);
  if (!chave) throw new Error('O certificado não traz a chave privada — confira se o arquivo é o A1 completo.');
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  return {
    chavePrivadaPem: forge.pki.privateKeyToPem(chave),
    certificadoPem: forge.pki.certificateToPem(cert),
    certificadoBase64: forge.util.encode64(der),
  };
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test`
Expected: os casos novos PASS; os que já existiam para `inspecionarPfx` continuam passando (o comportamento externo dele não mudou).

- [ ] **Step 6: Commit**

```bash
git add lib/certificadoServer.js tests/certificado.test.mjs tests/helpers/pfx.mjs
git commit -m "feat(sefaz): extrair chave e certificado do pfx para assinatura"
```

---

### Task 3: Assinatura XMLDSig

**Files:**
- Create: `lib/sefaz/assinatura.js`
- Test: `tests/sefaz-assinatura.test.mjs`

**Interfaces:**
- Consumes: `extrairChaveECert` (Task 2); `xml-crypto` (Task 1); `gerarPfx` de `tests/helpers/pfx.mjs` no teste.
- Produces: `assinarXml(xml, { chavePrivadaPem, certificadoPem, tagReferencia })` → string com o XML assinado. `tagReferencia` é o nome local do elemento que carrega o atributo `Id` a ser referenciado (`'infNFe'` para a nota, `'infEvento'` para eventos). A `<Signature>` é inserida **logo após** esse elemento, como irmã dele.

**O que a NF-e exige** (e por que trocar qualquer um destes quebra a autorização):

| item | valor |
| --- | --- |
| tipo | enveloped |
| canonicalização | `http://www.w3.org/TR/2001/REC-xml-c14n-20010315` — C14N **inclusiva**; a exclusiva (`xml-exc-c14n#`) é rejeitada |
| assinatura | `http://www.w3.org/2000/09/xmldsig#rsa-sha1` |
| digest | `http://www.w3.org/2000/09/xmldsig#sha1` |
| transforms | enveloped-signature, depois C14N inclusiva |
| Reference URI | `#` + o valor do atributo `Id` do elemento referenciado |
| KeyInfo | precisa trazer `<X509Certificate>` com o DER em base64 |

SHA-1 aqui não é escolha: é o que o leiaute 4.00 especifica.

- [ ] **Step 1: Escrever o teste (falhando)**

```javascript
// tests/sefaz-assinatura.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { gerarPfx } from './helpers/pfx.mjs';
import { extrairChaveECert } from '../lib/certificadoServer.js';
import { assinarXml } from '../lib/sefaz/assinatura.js';

const CHAVE = '11260837541736000187550010000000011000000017';

function notaDeTeste() {
  return `<?xml version="1.0" encoding="UTF-8"?>`
    + `<NFe xmlns="http://www.portalfiscal.inf.br/nfe">`
    + `<infNFe versao="4.00" Id="NFe${CHAVE}"><ide><cUF>11</cUF></ide></infNFe>`
    + `</NFe>`;
}

function material() {
  const pfx = gerarPfx({ cn: '364 STEAKHOUSE LTDA:37541736000187', cnpjOid: '37541736000187', senha: 'abc123' });
  return extrairChaveECert(pfx, 'abc123');
}

test('assina referenciando o Id do infNFe', () => {
  const { chavePrivadaPem, certificadoPem } = material();
  const assinado = assinarXml(notaDeTeste(), { chavePrivadaPem, certificadoPem, tagReferencia: 'infNFe' });
  assert.match(assinado, new RegExp(`URI="#NFe${CHAVE}"`));
});

test('usa exatamente os algoritmos que o leiaute 4.00 exige', () => {
  const { chavePrivadaPem, certificadoPem } = material();
  const assinado = assinarXml(notaDeTeste(), { chavePrivadaPem, certificadoPem, tagReferencia: 'infNFe' });
  assert.match(assinado, /Algorithm="http:\/\/www\.w3\.org\/TR\/2001\/REC-xml-c14n-20010315"/);
  assert.match(assinado, /Algorithm="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#rsa-sha1"/);
  assert.match(assinado, /Algorithm="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#sha1"/);
  assert.match(assinado, /Algorithm="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#enveloped-signature"/);
  // A exclusiva é a rejeitada pela SEFAZ — garantir que não vazou para cá.
  assert.doesNotMatch(assinado, /xml-exc-c14n/);
});

test('embute o certificado em X509Certificate, sem cabeçalho PEM', () => {
  const { chavePrivadaPem, certificadoPem, certificadoBase64 } = material();
  const assinado = assinarXml(notaDeTeste(), { chavePrivadaPem, certificadoPem, tagReferencia: 'infNFe' });
  assert.match(assinado, /<X509Certificate>/);
  assert.ok(assinado.includes(certificadoBase64), 'o X509Certificate não traz o mesmo certificado extraído do pfx');
});

test('a Signature fica dentro de NFe, como irmã de infNFe — não dentro de infNFe', () => {
  const { chavePrivadaPem, certificadoPem } = material();
  const assinado = assinarXml(notaDeTeste(), { chavePrivadaPem, certificadoPem, tagReferencia: 'infNFe' });
  const fimInfNFe = assinado.indexOf('</infNFe>');
  const inicioSig = assinado.search(/<(\w+:)?Signature[\s>]/);
  assert.ok(inicioSig > fimInfNFe, 'a Signature precisa vir depois do fechamento de infNFe');
  assert.ok(inicioSig < assinado.indexOf('</NFe>'), 'a Signature precisa estar dentro de NFe');
});

test('a assinatura confere criptograficamente', async () => {
  const { chavePrivadaPem, certificadoPem } = material();
  const assinado = assinarXml(notaDeTeste(), { chavePrivadaPem, certificadoPem, tagReferencia: 'infNFe' });

  const { SignedXml } = await import('xml-crypto');
  const { DOMParser } = await import('@xmldom/xmldom');
  const doc = new DOMParser().parseFromString(assinado, 'text/xml');
  const nó = doc.getElementsByTagName('Signature')[0] || doc.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature')[0];
  assert.ok(nó, 'não encontrei o nó Signature no XML assinado');

  const verificador = new SignedXml({ publicCert: certificadoPem });
  verificador.loadSignature(nó);
  assert.equal(verificador.checkSignature(assinado), true, 'assinatura inválida');
});

test('XML sem o Id esperado falha explicando, em vez de gerar assinatura inútil', () => {
  const { chavePrivadaPem, certificadoPem } = material();
  const semId = `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe versao="4.00"><ide/></infNFe></NFe>`;
  assert.throws(() => assinarXml(semId, { chavePrivadaPem, certificadoPem, tagReferencia: 'infNFe' }), /Id/);
});
```

`@xmldom/xmldom` entra junto com `xml-crypto` (é dependência dele) — se por acaso não estiver resolvível, use o parser que o próprio `xml-crypto` expõe ou instale-o explicitamente e registre no relatório.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/sefaz-assinatura.test.mjs`
Expected: FAIL — `Cannot find module '../lib/sefaz/assinatura.js'`

- [ ] **Step 3: Implementar**

```javascript
// lib/sefaz/assinatura.js
//
// Assinatura XMLDSig no formato que o leiaute 4.00 da NF-e exige. Os algoritmos
// abaixo não são preferência: são o que a SEFAZ valida. Em especial, a
// canonicalização é a C14N INCLUSIVA — a exclusiva (xml-exc-c14n) produz
// assinatura que a SEFAZ rejeita, e o erro que ela devolve não diz isso.
//
// SHA-1 é o especificado pelo leiaute, não uma escolha de segurança nossa.
//
// Só servidor: recebe a chave privada da empresa em PEM.
import { SignedXml } from 'xml-crypto';

const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const RSA_SHA1 = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';
const SHA1 = 'http://www.w3.org/2000/09/xmldsig#sha1';
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';

export function assinarXml(xml, { chavePrivadaPem, certificadoPem, tagReferencia }) {
  if (!chavePrivadaPem || !certificadoPem) throw new Error('Assinatura exige chave privada e certificado.');
  if (!tagReferencia) throw new Error('Informe a tag de referência da assinatura (infNFe ou infEvento).');

  // A SEFAZ referencia o elemento pelo atributo Id. Sem ele a assinatura sai
  // com URI vazia e a nota é rejeitada por assinatura inválida — erro que só
  // aparece na transmissão. Barrar aqui economiza uma ida à SEFAZ.
  const temId = new RegExp(`<${tagReferencia}[^>]*\\bId="[^"]+"`).test(xml);
  if (!temId) throw new Error(`O elemento <${tagReferencia}> precisa do atributo Id para ser assinado.`);

  const caminho = `//*[local-name(.)='${tagReferencia}']`;
  const sig = new SignedXml({
    privateKey: chavePrivadaPem,
    publicCert: certificadoPem,
    signatureAlgorithm: RSA_SHA1,
    canonicalizationAlgorithm: C14N,
  });
  sig.addReference({
    xpath: caminho,
    transforms: [ENVELOPED, C14N],
    digestAlgorithm: SHA1,
  });
  // A Signature é irmã do elemento assinado, logo depois dele — dentro de NFe,
  // nunca dentro de infNFe.
  sig.computeSignature(xml, { location: { reference: caminho, action: 'after' } });
  return sig.getSignedXml();
}
```

**Se a API do `xml-crypto` instalado divergir do acima** (a assinatura do construtor mudou entre as versões 3, 4 e 6): os testes do Step 1 são o contrato — mantenha-os intactos e adapte a chamada até passarem. Não relaxe uma asserção para acomodar a biblioteca; se algo parecer impossível de satisfazer, pare e relate.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/sefaz-assinatura.test.mjs` e depois `npm test`
Expected: todos PASS, incluindo a verificação criptográfica.

- [ ] **Step 5: Commit**

```bash
git add lib/sefaz/assinatura.js tests/sefaz-assinatura.test.mjs package.json package-lock.json
git commit -m "feat(sefaz): assinatura XMLDSig no formato do leiaute 4.00"
```

---

### Task 4: Envelope SOAP

**Files:**
- Create: `lib/sefaz/envelope.js`
- Test: `tests/sefaz-envelope.test.mjs`

**Interfaces:**
- Consumes: nada (puro, sem rede).
- Produces:
  - `envelopeSoap(corpoXml)` → string com o envelope SOAP 1.2 completo.
  - `extrairCorpoResposta(xmlResposta)` → string com o conteúdo de dentro de `<soap:Body>`, sem o envelope.
  - `lerCampos(xml, ['cStat', 'xMotivo'])` → `{ cStat: '107', xMotivo: '...' }`; campo ausente vira `null`.

- [ ] **Step 1: Escrever o teste (falhando)**

```javascript
// tests/sefaz-envelope.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { envelopeSoap, extrairCorpoResposta, lerCampos } from '../lib/sefaz/envelope.js';

test('envelopa o corpo em SOAP 1.2', () => {
  const env = envelopeSoap('<consStatServ versao="4.00"><tpAmb>2</tpAmb></consStatServ>');
  assert.match(env, /http:\/\/www\.w3\.org\/2003\/05\/soap-envelope/);
  assert.match(env, /<consStatServ versao="4\.00">/);
  assert.ok(env.indexOf('<consStatServ') > env.indexOf('Body'), 'o corpo precisa estar dentro do Body');
});

test('extrai o corpo da resposta, descartando o envelope', () => {
  const resposta = `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">`
    + `<soap:Body><nfeResultMsg><retConsStatServ versao="4.00"><cStat>107</cStat>`
    + `<xMotivo>Servico em Operacao</xMotivo></retConsStatServ></nfeResultMsg></soap:Body></soap:Envelope>`;
  const corpo = extrairCorpoResposta(resposta);
  assert.match(corpo, /<retConsStatServ/);
  assert.doesNotMatch(corpo, /Envelope/);
});

test('lê campos do retorno', () => {
  const xml = `<retConsStatServ><cStat>107</cStat><xMotivo>Servico em Operacao</xMotivo></retConsStatServ>`;
  assert.deepEqual(lerCampos(xml, ['cStat', 'xMotivo']), { cStat: '107', xMotivo: 'Servico em Operacao' });
});

test('campo ausente vira null em vez de undefined silencioso', () => {
  assert.deepEqual(lerCampos('<ret><cStat>108</cStat></ret>', ['cStat', 'xMotivo']), { cStat: '108', xMotivo: null });
});

test('lê campo mesmo com prefixo de namespace no retorno', () => {
  const xml = `<ns2:retConsStatServ xmlns:ns2="x"><ns2:cStat>107</ns2:cStat></ns2:retConsStatServ>`;
  assert.equal(lerCampos(xml, ['cStat']).cStat, '107');
});

test('resposta sem Body não quebra: devolve o que veio', () => {
  assert.equal(extrairCorpoResposta('<qualquer/>'), '<qualquer/>');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/sefaz-envelope.test.mjs`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

```javascript
// lib/sefaz/envelope.js
//
// Envelope SOAP 1.2 e leitura do retorno. Puro: sem rede, sem certificado.
//
// A leitura é por regex de tag, não por parser de XML completo, de propósito:
// o que se lê aqui são campos escalares curtos (cStat, xMotivo, nRec, nProt) de
// respostas pequenas, e o retorno da SEFAZ vem ora com prefixo de namespace ora
// sem. Documento de verdade (o XML da nota) continua sendo lido com
// fast-xml-parser, como já faz lib/nfe/parseNFe.js.

export function envelopeSoap(corpoXml) {
  return '<?xml version="1.0" encoding="UTF-8"?>'
    + '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">'
    + '<soap:Body>' + corpoXml + '</soap:Body>'
    + '</soap:Envelope>';
}

export function extrairCorpoResposta(xmlResposta) {
  const m = String(xmlResposta).match(/<(?:\w+:)?Body[^>]*>([\s\S]*)<\/(?:\w+:)?Body>/i);
  return m ? m[1].trim() : String(xmlResposta).trim();
}

export function lerCampos(xml, campos) {
  const texto = String(xml);
  const saida = {};
  for (const campo of campos) {
    const m = texto.match(new RegExp(`<(?:\\w+:)?${campo}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${campo}>`, 'i'));
    saida[campo] = m ? m[1].trim() : null;
  }
  return saida;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/sefaz-envelope.test.mjs` e depois `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sefaz/envelope.js tests/sefaz-envelope.test.mjs
git commit -m "feat(sefaz): envelope SOAP e leitura do retorno"
```

---

### Task 5: Transporte mTLS e consulta de status

**Files:**
- Create: `lib/sefaz/transporte.js`
- Create: `lib/sefaz/statusServico.js`
- Create: `app/api/fiscal/testar-conexao/route.js`

**Interfaces:**
- Consumes: `endpointSefaz`, `tpAmb`, `CUF_RONDONIA` (Task 1); `extrairChaveECert` não é necessário aqui — o `undici` aceita o `.pfx` direto; `envelopeSoap`, `extrairCorpoResposta`, `lerCampos` (Task 4); `obterCertificadoAtivo` de `lib/certificadoServer.js`; `autorizarModulo` de `lib/pontoServer.js`; `garantirEmpresa` de `lib/autorizacao.js`.
- Produces:
  - `chamarSefaz({ url, corpoXml, pfx, senha, timeoutMs })` → string com o XML de resposta.
  - `consultarStatusServico({ ambiente, pfx, senha })` → `{ cStat, xMotivo, ambiente }`.
  - `POST /api/fiscal/testar-conexao` — corpo `{ empresaId, ambiente }`, devolve `{ ok, cStat, xMotivo }`.

**Por que `undici` e não `fetch`:** o `fetch` do Node não aceita `https.Agent`, então não há como anexar o certificado cliente. O `undici.Agent` com `connect: { pfx, passphrase }` faz o handshake mTLS que a SEFAZ exige.

- [ ] **Step 1: Implementar o transporte**

```javascript
// lib/sefaz/transporte.js
//
// Único lugar deste módulo que fala com a rede. mTLS: a SEFAZ exige que o
// cliente se apresente com o certificado da empresa no handshake TLS — não é
// autenticação por header, é a própria conexão.
//
// `fetch` do Node não aceita https.Agent, por isso o undici explícito. Rotas que
// usam este arquivo precisam de `export const runtime = 'nodejs'`.
//
// O pfx e a senha ficam só em memória, dentro da chamada.
import { Agent, request } from 'undici';

const TIMEOUT_PADRAO_MS = 20000;

export async function chamarSefaz({ url, corpoXml, pfx, senha, timeoutMs = TIMEOUT_PADRAO_MS }) {
  if (!pfx) throw new Error('Certificado ausente para falar com a SEFAZ.');
  const agente = new Agent({ connect: { pfx, passphrase: senha } });
  try {
    const resposta = await request(url, {
      method: 'POST',
      body: corpoXml,
      headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' },
      dispatcher: agente,
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
    });
    const texto = await resposta.body.text();
    if (resposta.statusCode >= 400) {
      throw new Error(`A SEFAZ respondeu HTTP ${resposta.statusCode}.`);
    }
    return texto;
  } finally {
    // Sem isto o socket fica aberto e o processo do Next não encerra limpo.
    await agente.close().catch(() => {});
  }
}
```

- [ ] **Step 2: Implementar a consulta de status**

```javascript
// lib/sefaz/statusServico.js
//
// NFeStatusServico4: o serviço mais leve da SEFAZ. Não emite, não consome
// numeração, não altera nada — só responde se está no ar. É por isso que ele é
// o "testar conexão": prova certificado, handshake mTLS e alcance da SEFAZ sem
// nenhum efeito colateral fiscal.
//
// Atenção: consStatServ NÃO é assinado. Este caminho não exercita a assinatura
// XMLDSig — quem cobre isso é tests/sefaz-assinatura.test.mjs.
import { endpointSefaz, tpAmb, CUF_RONDONIA } from './endpoints.js';
import { envelopeSoap, extrairCorpoResposta, lerCampos } from './envelope.js';
import { chamarSefaz } from './transporte.js';

export async function consultarStatusServico({ ambiente, pfx, senha }) {
  const corpo = '<consStatServ xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">'
    + `<tpAmb>${tpAmb(ambiente)}</tpAmb>`
    + `<cUF>${CUF_RONDONIA}</cUF>`
    + '<xServ>STATUS</xServ>'
    + '</consStatServ>';

  const resposta = await chamarSefaz({
    url: endpointSefaz('statusServico', ambiente),
    corpoXml: envelopeSoap(corpo),
    pfx,
    senha,
  });

  const { cStat, xMotivo } = lerCampos(extrairCorpoResposta(resposta), ['cStat', 'xMotivo']);
  return { cStat, xMotivo, ambiente };
}
```

- [ ] **Step 3: Implementar a rota**

```javascript
// app/api/fiscal/testar-conexao/route.js
import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../../lib/pontoServer';
import { garantirEmpresa } from '../../../../lib/autorizacao';
import { obterCertificadoAtivo } from '../../../../lib/certificadoServer';
import { consultarStatusServico } from '../../../../lib/sefaz/statusServico';

export const runtime = 'nodejs';

// cStat 107 = "Serviço em Operação". Qualquer outro valor é a SEFAZ dizendo que
// está fora do ar ou em manutenção — não é erro de configuração nossa.
const SERVICO_EM_OPERACAO = '107';

export async function POST(request) {
  const { sb, user, isAdmin, erro } = await autorizarModulo(request, 'fiscal');
  if (erro) return erro;

  const { empresaId, ambiente } = await request.json();

  try {
    await garantirEmpresa(sb, user, isAdmin, empresaId);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 403 });
  }

  const { data: empresa, error: erroEmpresa } = await sb.from('empresas')
    .select('empregador_id').eq('id', empresaId).maybeSingle();
  if (erroEmpresa) return NextResponse.json({ error: erroEmpresa.message }, { status: 500 });
  if (!empresa?.empregador_id) {
    return NextResponse.json({ error: 'Esta marca não tem pessoa jurídica vinculada. Vincule em /empresas antes.' }, { status: 400 });
  }

  let certificado;
  try {
    certificado = await obterCertificadoAtivo(empresa.empregador_id);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
  if (!certificado) {
    return NextResponse.json({ error: 'Nenhum certificado A1 ativo para o CNPJ desta marca. Envie o certificado em /empresas.' }, { status: 400 });
  }

  try {
    const { cStat, xMotivo } = await consultarStatusServico({
      ambiente, pfx: certificado.pfx, senha: certificado.senha,
    });
    return NextResponse.json({ ok: cStat === SERVICO_EM_OPERACAO, cStat, xMotivo });
  } catch (e) {
    // Falha de rede/TLS/timeout: a mensagem do undici é técnica, mas é a única
    // pista real de por que não conectou. Nunca inclui material do certificado.
    return NextResponse.json({ error: `Não foi possível falar com a SEFAZ: ${e.message}` }, { status: 502 });
  }
}
```

- [ ] **Step 4: Conferir sem rede**

Não há teste automatizado para esta task — o transporte só se prova contra a SEFAZ de verdade, e é o que a Task 6 vai fazer pela tela. Confira por leitura: cada import resolve na profundidade relativa certa (`app/api/fiscal/testar-conexao/` está a quatro níveis da raiz, logo `../../../../lib/...`), `runtime = 'nodejs'` está presente, e nenhum campo do certificado aparece na resposta.

Run: `npm test`
Expected: suíte continua verde (esta task não mexe em nada testado).

- [ ] **Step 5: Commit**

```bash
git add lib/sefaz/transporte.js lib/sefaz/statusServico.js "app/api/fiscal/testar-conexao/route.js"
git commit -m "feat(sefaz): transporte mTLS e consulta de status do serviço"
```

---

### Task 6: Botão "Testar conexão" na tela do emissor

**Files:**
- Modify: `app/fiscal/emissor/page.js`

**Interfaces:**
- Consumes: `POST /api/fiscal/testar-conexao` (Task 5).
- Produces: nada que outra task consuma.

**Contexto:** a tela já existe e tem quatro seções, uma por par modelo×ambiente, com estado indexado por `${modelo}_${ambiente}`. Leia o arquivo como está antes de editar — ele passou por uma reestruturação na revisão final da fase anterior.

- [ ] **Step 1: Acrescentar o botão**

O teste de conexão depende do **ambiente**, não do modelo (é a mesma SEFAZ para NF-e e NFC-e). Coloque **um botão por ambiente**, não um por seção, para não sugerir que testam coisas diferentes. Estado local novo:

```javascript
const [conexao, setConexao] = useState({}); // { homologacao: {...}, producao: {...} }
const [testando, setTestando] = useState('');

async function testarConexao(ambiente) {
  setTestando(ambiente);
  setConexao(c => ({ ...c, [ambiente]: null }));
  try {
    const r = await fetch('/api/fiscal/testar-conexao', {
      method: 'POST',
      headers: await cabecalhoAuth(),
      body: JSON.stringify({ empresaId: selecionada, ambiente }),
    });
    const json = await r.json();
    setConexao(c => ({
      ...c,
      [ambiente]: r.ok
        ? { ok: json.ok, texto: `${json.cStat} — ${json.xMotivo}` }
        : { ok: false, texto: json.error || 'Falha ao testar.' },
    }));
  } catch (e) {
    setConexao(c => ({ ...c, [ambiente]: { ok: false, texto: e.message } }));
  } finally {
    setTestando('');
  }
}
```

E, na renderização, um bloco por ambiente (fora das seções de modelo):

```jsx
<fieldset className="form-grid" style={{ marginTop: 12 }}>
  <legend><strong>Conexão com a SEFAZ</strong></legend>
  {['homologacao', 'producao'].map(amb => (
    <div key={amb} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <button className="btn secondary" type="button" disabled={testando === amb} onClick={() => testarConexao(amb)}>
        {testando === amb ? 'Testando…' : `Testar ${amb === 'producao' ? 'produção' : 'homologação'}`}
      </button>
      {conexao[amb] && (
        <span className={`tag ${conexao[amb].ok ? 'ok' : 'bad'}`}>{conexao[amb].texto}</span>
      )}
    </div>
  ))}
  <p className="muted" style={{ gridColumn: '1 / -1' }}>
    Consulta o status do serviço da SEFAZ com o certificado desta marca. Não emite nota nem consome numeração.
  </p>
</fieldset>
```

Ajuste as classes e a estrutura ao que o arquivo já usa — o acima segue o padrão de `panel`/`form-grid`/`tag ok|bad` do resto do sistema, mas confira contra o arquivo real.

- [ ] **Step 2: Conferir na tela**

Run: `npm run dev`, abrir `/fiscal/emissor` logado com permissão `fiscal`, escolher a marca 364 Food Service e clicar em **Testar homologação**.

Expected: `107 — Servico em Operacao` (ou o texto que a SVRS devolver). Se vier erro de certificado, confirme que o CNPJ dessa marca tem A1 ativo em `/empresas`. Se vier erro de rede/TLS, o endpoint em `lib/sefaz/endpoints.js` é o primeiro suspeito — este botão existe justamente para essa conferência.

**Não teste produção antes da homologação responder.** Produção com certificado válido também deve responder 107, mas homologação é o ambiente certo para descobrir problema de configuração.

- [ ] **Step 3: Commit**

```bash
git add "app/fiscal/emissor/page.js"
git commit -m "feat(sefaz): botão de teste de conexão na tela do emissor"
```

---

## Self-Review

**Cobertura:** o objetivo do plano (provar assinatura e conectividade) é coberto por Task 3 (assinatura, verificada criptograficamente offline) e Tasks 5-6 (conectividade, verificada contra a SVRS). As Tasks 1, 2 e 4 são as peças que as duas precisam. Nada do motor de emissão propriamente dito (XML da nota, numeração, máquina de estados, eventos, DANFE) entra aqui — é o plano seguinte, e o spec do motor continua valendo para ele.

**Placeholders:** nenhum passo diz "implementar depois" ou "adicionar tratamento adequado"; todo passo de código traz o código.

**Consistência de tipos:** `endpointSefaz`/`tpAmb`/`CUF_RONDONIA` (Task 1) usados com a mesma assinatura na Task 5; `extrairChaveECert` (Task 2) consumido na Task 3 com as três chaves que produz; `envelopeSoap`/`extrairCorpoResposta`/`lerCampos` (Task 4) usados na Task 5 como definidos; `chamarSefaz` (Task 5) recebe `pfx`/`senha` no formato que `obterCertificadoAtivo` já devolve.

**Risco conhecido e deliberado:** a API do `xml-crypto` mudou entre versões maiores. A Task 3 fixa a versão e usa os testes como contrato, com instrução explícita de adaptar a chamada — nunca a asserção — se a API instalada divergir.

---

Plan complete and saved to `docs/superpowers/plans/2026-08-25-fundacao-sefaz.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
