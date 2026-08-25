// lib/sefaz/statusServico.js
//
// NFeStatusServico4: o serviço mais leve da SEFAZ. Não emite, não consome
// numeração, não altera nada — só responde se está no ar. É por isso que ele é
// o "testar conexão": prova certificado, handshake mTLS e alcance da SEFAZ sem
// nenhum efeito colateral fiscal.
//
// Atenção: consStatServ NÃO é assinado. Este caminho não exercita a assinatura
// XMLDSig — quem cobre isso é tests/sefaz-assinatura.test.mjs.
import { endpointSefaz, tpAmb, CUF_RONDONIA } from './endpoints.js';
import { envelopeSoap, extrairCorpoResposta, lerCampos } from './envelope.js';
import { chamarSefaz } from './transporte.js';

export async function consultarStatusServico({ ambiente, pfx, senha, timeoutMs }) {
  const corpo = '<consStatServ xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">'
    + `<tpAmb>${tpAmb(ambiente)}</tpAmb>`
    + `<cUF>${CUF_RONDONIA}</cUF>`
    + '<xServ>STATUS</xServ>'
    + '</consStatServ>';

  const resposta = await chamarSefaz({
    url: endpointSefaz('statusServico', ambiente),
    corpoXml: envelopeSoap(corpo),
    pfx,
    senha,
    timeoutMs,
  });

  const { cStat, xMotivo } = lerCampos(extrairCorpoResposta(resposta), ['cStat', 'xMotivo']);
  return { cStat, xMotivo, ambiente };
}
