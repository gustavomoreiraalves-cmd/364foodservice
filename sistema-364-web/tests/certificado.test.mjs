process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'chave-de-teste';
process.env.CERTIFICADO_CHAVE = Buffer.alloc(32, 7).toString('base64');

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const { cifrar, decifrar, inspecionarPfx, statusCertificado, resumoCertificado } = await import('../lib/certificadoServer.js');

// Gera um pfx autoassinado com openssl, no formato que a ICP-Brasil usa:
// CN "NOME:CNPJ" e otherName 2.16.76.1.3.3 com o CNPJ.
// O openssl do macOS é LibreSSL 3.3.6: não aceita `-legacy` (flag do OpenSSL 3),
// e o export padrão dele (RC2/3DES) é lido pelo node-forge sem ajuste — por isso
// aqui não há nem `-legacy` nem `-keypbe/-certpbe`.
function gerarPfx({ cn, cnpjOid, senha, dias = 365 }) {
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
