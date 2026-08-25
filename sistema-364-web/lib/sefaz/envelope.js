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

// `dentroDe` restringe a busca ao conteúdo da primeira ocorrência dessa tag.
// Sem isto, um retEnviNFe de autorização mistura níveis: cStat/xMotivo do
// lote (ex.: 104 "Lote processado") são iguais em nome aos da nota dentro de
// protNFe/infProt (ex.: 100 "Autorizado o uso da NF-e"), e o primeiro match
// no documento inteiro é sempre o do lote — quieto e errado justamente no
// caso que decide se a nota foi autorizada. `consStatServ` não tem esse
// problema (só um nível), por isso o default sem escopo continua igual.
export function lerCampos(xml, campos, { dentroDe } = {}) {
  let texto = String(xml);
  if (dentroDe) {
    const escopo = texto.match(new RegExp(`<(?:\\w+:)?${dentroDe}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${dentroDe}>`, 'i'));
    // Elemento de escopo ausente: nada de cair para o match externo — isso
    // reintroduziria exatamente a mistura de níveis que o escopo existe para
    // evitar. Todos os campos saem null.
    texto = escopo ? escopo[1] : '';
  }
  const saida = {};
  for (const campo of campos) {
    const m = texto.match(new RegExp(`<(?:\\w+:)?${campo}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${campo}>`, 'i'));
    saida[campo] = m ? m[1].trim() : null;
  }
  return saida;
}
