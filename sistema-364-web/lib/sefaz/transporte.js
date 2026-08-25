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
//
// Por que PEM e não `{ pfx, passphrase }` direto: o Node 24 linka OpenSSL 3, que
// recusa PKCS#12 cifrado do jeito legado (RC2-40-CBC / 3DES-SHA1 PBE) sem o
// provider legacy carregado — e é assim que certificados A1 da ICP-Brasil (e o
// .pfx que o openssl deste projeto gera para teste) costumam vir exportados.
// `tls.createSecureContext({ pfx, passphrase })` estoura
// ERR_CRYPTO_UNSUPPORTED_OPERATION nesse caso. node-forge é JS puro e decifra
// esse PKCS#12 sem passar pelo OpenSSL do Node — por isso extraímos a chave e o
// certificado com ele (extrairChaveECert) e entregamos PEM moderno ao OpenSSL,
// em vez do PKCS#12 bruto. Prova: tests/sefaz-transporte.test.mjs.
import { Agent, request } from 'undici';
import { extrairChaveECert } from '../certificadoServer.js';

const TIMEOUT_PADRAO_MS = 20000;
const TAMANHO_EXCERTO_ERRO = 300;

export async function chamarSefaz({ url, corpoXml, pfx, senha, timeoutMs = TIMEOUT_PADRAO_MS }) {
  if (!pfx) throw new Error('Certificado ausente para falar com a SEFAZ.');
  // extrairChaveECert já lança erro claro se o .pfx não trouxer a chave
  // privada ou se a senha estiver errada — não precisa de tratamento extra
  // aqui, o erro sobe como está.
  const { chavePrivadaPem, certificadoCadeiaPem } = extrairChaveECert(pfx, senha);
  const agente = new Agent({ connect: { key: chavePrivadaPem, cert: certificadoCadeiaPem } });
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
      // A SEFAZ devolve SOAP Fault com o motivo real no corpo — descartá-lo
      // deixava só o código HTTP, sem pista nenhuma do que houve. É saída da
      // própria SEFAZ, não tem material de certificado.
      const excerto = texto.slice(0, TAMANHO_EXCERTO_ERRO);
      throw new Error(`A SEFAZ respondeu HTTP ${resposta.statusCode}. ${excerto}`);
    }
    return texto;
  } finally {
    // Sem isto o socket fica aberto e o processo do Next não encerra limpo.
    await agente.close().catch(() => {});
  }
}
