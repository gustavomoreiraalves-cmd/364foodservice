// Assinatura XMLDSig no formato que o leiaute 4.00 da NF-e exige. Os algoritmos
// abaixo não são preferência: são o que a SEFAZ valida. Em especial, a
// canonicalização é a C14N INCLUSIVA — a exclusiva (xml-exc-c14n) produz
// assinatura que a SEFAZ rejeita, e o erro que ela devolve não diz isso.
//
// SHA-1 é o especificado pelo leiaute, não uma escolha de segurança nossa.
//
// Só servidor: recebe a chave privada da empresa em PEM.
import { SignedXml } from 'xml-crypto';

const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const RSA_SHA1 = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';
const SHA1 = 'http://www.w3.org/2000/09/xmldsig#sha1';
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';

export function assinarXml(xml, { chavePrivadaPem, certificadoPem, tagReferencia }) {
  if (!chavePrivadaPem || !certificadoPem) throw new Error('Assinatura exige chave privada e certificado.');
  if (!tagReferencia) throw new Error('Informe a tag de referência da assinatura (infNFe ou infEvento).');

  // A SEFAZ referencia o elemento pelo atributo Id. Sem ele a assinatura sai
  // com URI vazia e a nota é rejeitada por assinatura inválida — erro que só
  // aparece na transmissão. Barrar aqui economiza uma ida à SEFAZ.
  const temId = new RegExp(`<${tagReferencia}[^>]*\\bId="[^"]+"`).test(xml);
  if (!temId) throw new Error(`O elemento <${tagReferencia}> precisa do atributo Id para ser assinado.`);

  // Quando o xpath casa mais de um elemento (ex.: envEvento com vários
  // <evento>), o xml-crypto não assina cada um: ele produz UMA <Signature>
  // com N <Reference>s dentro do primeiro elemento casado, e os demais ficam
  // sem assinatura própria — documento inválido para a SEFAZ, e o erro só
  // aparece como rejeição de schema lá, não aqui. A NF-e exige uma
  // <Signature> por elemento assinado, irmã dele. Por isso: barrar aqui e
  // forçar quem chama a assinar elemento por elemento.
  const contagem = (xml.match(new RegExp(`<${tagReferencia}(?=[\\s/>])`, 'g')) || []).length;
  if (contagem !== 1) {
    throw new Error(`O xpath de <${tagReferencia}> casou ${contagem} elemento(s); assine cada <${tagReferencia}> individualmente, não o documento inteiro de uma vez.`);
  }

  const caminho = `//*[local-name(.)='${tagReferencia}']`;
  const sig = new SignedXml({
    privateKey: chavePrivadaPem,
    publicCert: certificadoPem,
    signatureAlgorithm: RSA_SHA1,
    canonicalizationAlgorithm: C14N,
  });
  sig.addReference({
    xpath: caminho,
    transforms: [ENVELOPED, C14N],
    digestAlgorithm: SHA1,
  });
  // A Signature é irmã do elemento assinado, logo depois dele — dentro de NFe,
  // nunca dentro de infNFe.
  sig.computeSignature(xml, { location: { reference: caminho, action: 'after' } });
  return sig.getSignedXml();
}
