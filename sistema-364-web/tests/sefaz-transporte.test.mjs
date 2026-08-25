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
import { gerarPfx } from './helpers/pfx.mjs';
import { extrairChaveECert } from '../lib/certificadoServer.js';

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
