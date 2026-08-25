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
//
// A validação do certificado do SERVIDOR (lado oposto do mTLS) também precisa de
// ajuda: a cadeia da SVRS termina na raiz ICP-Brasil v10, que não está no pacote
// de CAs da Mozilla que o Node usa por padrão — sem isso o handshake falha com
// "unable to get local issuer certificate" mesmo com o certificado do cliente
// correto. Ver lib/sefaz/icpBrasil.js para os detalhes e a prova.
import { Agent, request } from 'undici';
import tls from 'node:tls';
import { extrairChaveECert } from '../certificadoServer.js';
import { RAIZ_ICP_BRASIL_V10 } from './icpBrasil.js';

const TIMEOUT_PADRAO_MS = 20000;
// 300 já cortou o SOAP Fault da própria SEFAZ no meio do <soap:Reason>,
// escondendo a única frase que explicava a causa (foi assim que se
// descobriu que faltava o nfeDadosMsg). ~2000 cobre um Fault inteiro; é
// saída da própria SEFAZ, não carrega material de certificado.
const TAMANHO_EXCERTO_ERRO = 2000;

export async function chamarSefaz({ url, corpoXml, pfx, senha, timeoutMs = TIMEOUT_PADRAO_MS, acaoSoap }) {
  if (!pfx) throw new Error('Certificado ausente para falar com a SEFAZ.');
  // extrairChaveECert já lança erro claro se o .pfx não trouxer a chave
  // privada ou se a senha estiver errada — não precisa de tratamento extra
  // aqui, o erro sobe como está.
  const { chavePrivadaPem, certificadoCadeiaPem } = extrairChaveECert(pfx, senha);
  // `ca` aqui é para validar o certificado do SERVIDOR (SVRS), não o nosso — é
  // independente do `{ key, cert }` acima, que é o certificado do CLIENTE (mTLS).
  // Passar só [RAIZ_ICP_BRASIL_V10] SUBSTITUIRIA o conjunto padrão de CAs
  // confiáveis do Node por este único item — por isso o spread de
  // tls.rootCertificates: queremos ADICIONAR a raiz ICP-Brasil v10, mantendo
  // toda a confiança padrão intacta.
  const agente = new Agent({
    connect: {
      key: chavePrivadaPem,
      cert: certificadoCadeiaPem,
      ca: [...tls.rootCertificates, RAIZ_ICP_BRASIL_V10],
    },
  });
  // SOAP 1.2 carrega a ação como parâmetro `action` do Content-Type, não como
  // header SOAPAction separado (isso era SOAP 1.1) — a SEFAZ espera assim.
  const contentType = acaoSoap
    ? `application/soap+xml; charset=utf-8; action="${acaoSoap}"`
    : 'application/soap+xml; charset=utf-8';
  try {
    const resposta = await request(url, {
      method: 'POST',
      body: corpoXml,
      headers: { 'Content-Type': contentType },
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
