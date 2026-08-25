// Prova do Critical 1 da revisão final do plano de fundação SEFAZ: Node 24
// linka OpenSSL 3, que recusa PKCS#12 cifrado do jeito legado (RC2-40-CBC /
// 3DES-SHA1 PBE) — exatamente como o openssl deste projeto exporta (ver
// tests/helpers/pfx.mjs) e como certificados A1 da ICP-Brasil costumam vir.
// `lib/sefaz/transporte.js` agora monta o Agent do undici com { key, cert }
// em PEM (extraídos com node-forge por extrairChaveECert), não com o .pfx
// bruto — é isso que este teste comprova, nas duas pontas.
//
// Sem chamada de rede: só monta o SecureContext, que é onde o erro do OpenSSL
// acontece (o handshake nem chega a começar).
import test from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import crypto from 'node:crypto';
import forge from 'node-forge';
import { gerarPfx } from './helpers/pfx.mjs';
import { extrairChaveECert } from '../lib/certificadoServer.js';
import { RAIZ_ICP_BRASIL_V10 } from '../lib/sefaz/icpBrasil.js';

// Fingerprint verificado (ver lib/sefaz/icpBrasil.js) via
// `openssl x509 -in icp-brasil-raiz-v10.crt -noout -fingerprint -sha256`.
const FINGERPRINT_SHA256_ESPERADO =
  '6E:0B:FF:06:9A:26:99:4C:15:DE:2C:48:88:CC:54:AF:84:88:2E:54:95:B7:FB:F6:6B:E9:CC:FF:EC:74:89:F6';

function material() {
  return gerarPfx({ cn: '364 STEAKHOUSE LTDA:37541736000187', cnpjOid: '37541736000187', senha: 'abc123' });
}

test('pfx bruto: o OpenSSL 3 do Node recusa o PKCS#12 legado — a causa do bug', () => {
  const pfx = material();
  assert.throws(
    () => tls.createSecureContext({ pfx, passphrase: 'abc123' }),
    /ERR_CRYPTO_UNSUPPORTED_OPERATION|Unsupported PKCS12|unable to load/i,
  );
});

test('PEM extraído por extrairChaveECert: o Node aceita sem ressalvas — o fix', () => {
  const pfx = material();
  const { chavePrivadaPem, certificadoCadeiaPem } = extrairChaveECert(pfx, 'abc123');
  assert.doesNotThrow(() => tls.createSecureContext({ key: chavePrivadaPem, cert: certificadoCadeiaPem }));
});

// Prova do fix da raiz ICP-Brasil v10: a SVRS (nfe-homologacao.svrs.rs.gov.br e
// nfe.svrs.rs.gov.br) apresenta uma cadeia cuja raiz não está no pacote de CAs da
// Mozilla que o Node usa por padrão — daí "unable to get local issuer certificate"
// mesmo com o certificado A1 do cliente correto. lib/sefaz/icpBrasil.js embute essa
// raiz como PEM inline (não lida de um .crt em disco, que pode não ser empacotado
// no runtime serverless da Vercel) e lib/sefaz/transporte.js soma ela ao conjunto
// padrão de CAs do Node. Estes testes não fazem nenhuma chamada de rede — só
// verificam a constante em si.
test('RAIZ_ICP_BRASIL_V10: fingerprint SHA-256 bate com o valor verificado (detecta adulteração da constante)', () => {
  const cert = forge.pki.certificateFromPem(RAIZ_ICP_BRASIL_V10);
  const der = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary');
  const fingerprint = crypto
    .createHash('sha256')
    .update(der)
    .digest('hex')
    .toUpperCase()
    .match(/.{2}/g)
    .join(':');
  assert.equal(fingerprint, FINGERPRINT_SHA256_ESPERADO);
});

test('RAIZ_ICP_BRASIL_V10: é autoassinada e está dentro da validade', () => {
  const cert = forge.pki.certificateFromPem(RAIZ_ICP_BRASIL_V10);

  const subject = cert.subject.attributes.map(a => `${a.shortName}=${a.value}`).join(',');
  const issuer = cert.issuer.attributes.map(a => `${a.shortName}=${a.value}`).join(',');
  assert.equal(subject, issuer, 'raiz autoassinada: subject deve ser igual a issuer');

  const agora = new Date();
  assert.ok(cert.validity.notBefore <= agora, 'certificado ainda não deveria ter começado a valer');
  assert.ok(cert.validity.notAfter >= agora, 'certificado não deveria estar expirado');
});
