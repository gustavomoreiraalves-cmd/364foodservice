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

test('elemento repetido é recusado, em vez de assinar só o primeiro e deixar o resto sem Signature', () => {
  const { chavePrivadaPem, certificadoPem } = material();
  const doisEventos = `<?xml version="1.0" encoding="UTF-8"?>`
    + `<envEvento xmlns="http://www.portalfiscal.inf.br/nfe">`
    + `<evento><infEvento Id="ID1102000001112025000000015511100000001101"><tpEvento>110111</tpEvento></infEvento></evento>`
    + `<evento><infEvento Id="ID1102000001112025000000015511100000001102"><tpEvento>110111</tpEvento></infEvento></evento>`
    + `</envEvento>`;
  assert.throws(
    () => assinarXml(doisEventos, { chavePrivadaPem, certificadoPem, tagReferencia: 'infEvento' }),
    /infEvento.*2|2 elemento/i,
  );
});
