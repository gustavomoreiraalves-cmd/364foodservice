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
