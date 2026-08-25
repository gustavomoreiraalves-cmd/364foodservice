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
