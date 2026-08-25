process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'chave-de-teste';
process.env.CERTIFICADO_CHAVE = Buffer.alloc(32, 7).toString('base64');

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gerarPfx } from './helpers/pfx.mjs';
const { cifrar, decifrar, inspecionarPfx, extrairChaveECert, statusCertificado, resumoCertificado } = await import('../lib/certificadoServer.js');

test('cifrar/decifrar: ida e volta, e IV diferente a cada chamada', () => {
  const plano = Buffer.from('segredo com acentuação ç');
  const a = cifrar(plano), b = cifrar(plano);
  assert.notEqual(a, b);
  assert.deepEqual(decifrar(a), plano);
  assert.equal(a.split(':').length, 3);
});

test('decifrar: tag adulterada falha', () => {
  const [iv, tag, dado] = cifrar(Buffer.from('x')).split(':');
  const tagRuim = Buffer.from(tag, 'base64'); tagRuim[0] ^= 1;
  assert.throws(() => decifrar([iv, tagRuim.toString('base64'), dado].join(':')));
});

test('inspecionarPfx: lê CNPJ pelo otherName da ICP-Brasil', () => {
  const pfx = gerarPfx({ cn: '364 STEAKHOUSE LTDA:37541736000187', cnpjOid: '37541736000187', senha: 'abc123' });
  const meta = inspecionarPfx(pfx, 'abc123');
  assert.equal(meta.cnpj, '37541736000187');
  assert.equal(meta.titular, '364 STEAKHOUSE LTDA:37541736000187');
  assert.ok(meta.validoAte > new Date());
  assert.ok(meta.numeroSerie);
});

test('inspecionarPfx: sem otherName cai para o CN', () => {
  const pfx = gerarPfx({ cn: 'EMPRESA TESTE:60361009000150', senha: 's' });
  assert.equal(inspecionarPfx(pfx, 's').cnpj, '60361009000150');
});

test('inspecionarPfx: senha errada', () => {
  const pfx = gerarPfx({ cn: 'X:60361009000150', senha: 'certa' });
  assert.throws(() => inspecionarPfx(pfx, 'errada'), /Senha do certificado incorreta/);
});

test('inspecionarPfx: arquivo que não é pfx', () => {
  assert.throws(() => inspecionarPfx(Buffer.from('nada a ver'), 'x'), /não é um certificado PKCS#12/);
});

test('statusCertificado', () => {
  const hoje = new Date('2026-08-23T12:00:00Z');
  assert.deepEqual(statusCertificado(new Date('2027-01-01T00:00:00Z'), hoje), { status: 'vigente', diasParaVencer: 130 });
  assert.equal(statusCertificado(new Date('2026-09-10T00:00:00Z'), hoje).status, 'vence_em_30_dias');
  assert.equal(statusCertificado(new Date('2026-08-01T00:00:00Z'), hoje).status, 'vencido');
});

test('resumoCertificado mapeia colunas do banco', () => {
  const r = resumoCertificado({ id: '1', titular: 'T', emissor: 'E', cnpj_certificado: '1', numero_serie: 'S',
    valido_de: '2026-01-01', valido_ate: '2099-01-01', created_at: '2026-08-23' });
  assert.equal(r.status, 'vigente');
  assert.equal(r.cnpj, '1');
});

test('extrairChaveECert devolve chave e certificado utilizáveis', async () => {
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
