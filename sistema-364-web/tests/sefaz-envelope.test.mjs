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

// Um retEnviNFe real repete cStat/xMotivo em dois níveis: o do lote
// (envelope) e o da nota (dentro de protNFe/infProt). Sem escopo, o primeiro
// match no documento é sempre o do lote — o que já foi Finding 4 da revisão
// final: uma nota rejeitada podia sair marcada como autorizada.
const RET_ENVI_NFE = `<retEnviNFe><cStat>104</cStat><xMotivo>Lote processado</xMotivo>`
  + `<protNFe><infProt><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo>`
  + `<nProt>111250000000001</nProt></infProt></protNFe></retEnviNFe>`;

test('lerCampos com dentroDe lê o campo de dentro do elemento indicado, não o do nível externo', () => {
  assert.deepEqual(
    lerCampos(RET_ENVI_NFE, ['cStat', 'xMotivo', 'nProt'], { dentroDe: 'infProt' }),
    { cStat: '100', xMotivo: 'Autorizado o uso da NF-e', nProt: '111250000000001' },
  );
});

test('lerCampos sem dentroDe mantém o comportamento de sempre (primeiro match, nível do lote)', () => {
  assert.deepEqual(lerCampos(RET_ENVI_NFE, ['cStat', 'xMotivo']), { cStat: '104', xMotivo: 'Lote processado' });
});

test('lerCampos com dentroDe ausente no documento devolve tudo null, não cai para o match externo', () => {
  const semProtNFe = `<retConsStatServ><cStat>107</cStat><xMotivo>Servico em Operacao</xMotivo></retConsStatServ>`;
  assert.deepEqual(
    lerCampos(semProtNFe, ['cStat', 'xMotivo'], { dentroDe: 'infProt' }),
    { cStat: null, xMotivo: null },
  );
});
