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
import { Agent, request } from 'undici';

const TIMEOUT_PADRAO_MS = 20000;

export async function chamarSefaz({ url, corpoXml, pfx, senha, timeoutMs = TIMEOUT_PADRAO_MS }) {
  if (!pfx) throw new Error('Certificado ausente para falar com a SEFAZ.');
  const agente = new Agent({ connect: { pfx, passphrase: senha } });
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
      throw new Error(`A SEFAZ respondeu HTTP ${resposta.statusCode}.`);
    }
    return texto;
  } finally {
    // Sem isto o socket fica aberto e o processo do Next não encerra limpo.
    await agente.close().catch(() => {});
  }
}
