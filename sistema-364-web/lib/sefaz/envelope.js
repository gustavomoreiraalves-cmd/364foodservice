//
// Envelope SOAP 1.2 e leitura do retorno. Puro: sem rede, sem certificado.
//
// A leitura é por regex de tag, não por parser de XML completo, de propósito:
// o que se lê aqui são campos escalares curtos (cStat, xMotivo, nRec, nProt) de
// respostas pequenas, e o retorno da SEFAZ vem ora com prefixo de namespace ora
// sem. Documento de verdade (o XML da nota) continua sendo lido com
// fast-xml-parser, como já faz lib/nfe/parseNFe.js.

export function envelopeSoap(corpoXml) {
  return '<?xml version="1.0" encoding="UTF-8"?>'
    + '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">'
    + '<soap:Body>' + corpoXml + '</soap:Body>'
    + '</soap:Envelope>';
}

export function extrairCorpoResposta(xmlResposta) {
  const m = String(xmlResposta).match(/<(?:\w+:)?Body[^>]*>([\s\S]*)<\/(?:\w+:)?Body>/i);
  return m ? m[1].trim() : String(xmlResposta).trim();
}

export function lerCampos(xml, campos) {
  const texto = String(xml);
  const saida = {};
  for (const campo of campos) {
    const m = texto.match(new RegExp(`<(?:\\w+:)?${campo}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${campo}>`, 'i'));
    saida[campo] = m ? m[1].trim() : null;
  }
  return saida;
}
