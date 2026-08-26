// lib/nfe/classificacao.js
//
// Vocabulário de status do documento de saída e a leitura do veredito da
// SEFAZ. Puro: sem rede, sem banco, sem certificado — só string de resposta
// entra e uma decisão sai. Foi separado de lib/nfe/emitir.js exatamente para
// poder ser testado sem subir nada (tests/nfe-classificacao.test.mjs), já que
// é o trecho onde um engano vale duas notas autorizadas para o mesmo pedido.

import { lerCampos } from '../sefaz/envelope.js';

// Estados em que uma nova tentativa para o MESMO pedido reaproveita o mesmo
// documento e (quando já existir) o mesmo número — porque a SEFAZ ainda não
// viu nada. A partir de 'enviado' (gravado ANTES de chamar a SEFAZ — ver o
// passo 7 de emitir.js), uma nova tentativa NUNCA reaproveita nem o documento
// nem o número: o anterior já pode ter sido visto pela SEFAZ e não pode
// voltar.
export const STATUS_REAPROVEITAVEL = ['rascunho', 'numero_reservado', 'assinado'];

// Estados pós-transmissão cujo veredito da SEFAZ não ficou registrado de
// forma confiável neste sistema: 'enviado' sem nunca ter avançado para
// 'autorizado'/'rejeitado' (o UPDATE que gravaria o veredito falhou, ou o
// processo caiu no meio) e 'erro_comunicacao' (a chamada à SEFAZ falhou sem
// resposta — pode ter sido recebida e processada mesmo assim). Em nenhum dos
// dois emitir de novo para o mesmo pedido é seguro: pode duplicar uma nota
// que a SEFAZ já autorizou. 'rejeitado' fica de fora deste conjunto de
// propósito — ali o veredito da SEFAZ é conhecido e está gravado, então uma
// nova tentativa com número novo é o fluxo normal esperado.
export const STATUS_INDETERMINADO = ['enviado', 'erro_comunicacao'];

// Estados que travam uma nova emissão para o MESMO pedido porque já existe
// um veredito definitivo da SEFAZ que não se resolve tentando de novo por
// este caminho: 'autorizado' (reemitir duplicaria a nota) e 'denegado'
// (achado da revisão, Crítico 3 — cStat 110/301/302: CNPJ irregular, IE
// inválida etc. Denegação consome o número definitivamente; mesmo depois de
// regularizar a pendência, a reemissão correta usa numeração nova e passa
// por fora deste guard, não por uma nova tentativa automática aqui).
export const STATUS_BLOQUEIA_REEMISSAO = ['autorizado', 'denegado'];

// cStat de infProt (o veredito da NOTA, nunca o do lote) que valem como
// autorização. 100 é o caso comum (autorizada dentro da janela síncrona);
// 150 é "Autorizado o uso da NF-e, autorização fora de prazo" — também é
// autorização, e antes da revisão (Crítico 3) só 100 era reconhecido: 150
// caía no branch de 'rejeitado', abrindo caminho pra reemitir (com número
// novo) uma nota que a SEFAZ já tinha autorizado.
export const CSTAT_AUTORIZADO = ['100', '150'];

// cStat de infProt que valem como denegação (situação cadastral do
// destinatário: CNPJ irregular = 110, inapto = 301, destinatário não
// contribuinte quando deveria ser = 302 — os três consomem o número
// definitivamente, ao contrário de uma rejeição comum). Antes da revisão
// caíam no mesmo branch de 'rejeitado' que uma falha de schema comum, o que
// convidava a reemitir e queimar outro número na mesma denegação.
export const CSTAT_DENEGADO = ['110', '301', '302'];

function comMotivo(cStat, xMotivo) {
  return cStat ? `${cStat} - ${xMotivo}` : null;
}

// Classifica o corpo da resposta de NFeAutorizacao4 (o conteúdo do Body SOAP,
// já extraído por extrairCorpoResposta) em uma das quatro situações
// possíveis, sem tocar em banco:
//
//   'autorizado'     — infProt com cStat 100/150. A nota existe; reemitir
//                      duplicaria.
//   'denegado'       — infProt com cStat 110/301/302. O número foi consumido
//                      pela denegação; reemitir com o mesmo número é
//                      impossível e uma nova tentativa automática só queima
//                      outro número na mesma pendência cadastral.
//   'indeterminado'  — sem infProt, mas com nRec do lote (indSinc=1 estourou
//                      a janela: cStat 103/105). NÃO é rejeição — a nota pode
//                      estar a caminho de autorizar. Reconciliar por
//                      NFeRetAutorizacao4 com esse nRec.
//   'rejeitado'      — veredito genuíno de rejeição, seja dentro de infProt
//                      (ex.: 204 duplicidade) ou do lote inteiro sem recibo
//                      (ex.: 225 schema). Aqui reemitir com número novo é o
//                      fluxo correto.
//
// A ARMADILHA que esta função concentra: a resposta traz cStat/xMotivo no
// nível do LOTE **e** dentro de protNFe/infProt. O veredito da NOTA é sempre
// o de dentro — por isso o segundo lerCampos usa `dentroDe: 'infProt'`. Ler o
// do lote (ex.: 104 "Lote processado") marcaria como autorizada uma nota que
// a SEFAZ rejeitou. Ver o comentário de lerCampos em lib/sefaz/envelope.js.
//
// Consequência da ordem dos ifs, e ela é deliberada: um veredito dentro de
// infProt sempre ganha do nRec do lote. Uma nota rejeitada com 204 numa
// resposta que também traz nRec é 'rejeitado', não 'indeterminado' — só a
// AUSÊNCIA de infProt junto com um nRec caracteriza "ainda não sei".
export function classificarResposta(corpoResposta) {
  const lote = lerCampos(corpoResposta, ['cStat', 'xMotivo', 'nRec']);
  const veredito = lerCampos(corpoResposta, ['cStat', 'xMotivo', 'nProt'], { dentroDe: 'infProt' });
  const nRec = lote.nRec || null;

  if (veredito.cStat && CSTAT_AUTORIZADO.includes(veredito.cStat)) {
    return {
      situacao: 'autorizado',
      cStat: veredito.cStat,
      motivo: null,
      nRec,
      protocolo: veredito.nProt || null,
    };
  }

  if (veredito.cStat && CSTAT_DENEGADO.includes(veredito.cStat)) {
    return {
      situacao: 'denegado',
      cStat: veredito.cStat,
      motivo: comMotivo(veredito.cStat, veredito.xMotivo),
      nRec,
      protocolo: null,
    };
  }

  if (!veredito.cStat && nRec) {
    return {
      situacao: 'indeterminado',
      cStat: lote.cStat,
      motivo: comMotivo(lote.cStat, lote.xMotivo),
      nRec,
      protocolo: null,
    };
  }

  // Rejeição: prioriza o veredito de dentro de infProt; cai para o do lote só
  // se a nota nem chegou a ter protNFe nem nRec (lote inteiro rejeitado antes
  // disso).
  const cStat = veredito.cStat || lote.cStat;
  const xMotivo = veredito.cStat ? veredito.xMotivo : lote.xMotivo;
  return {
    situacao: 'rejeitado',
    cStat,
    motivo: `${cStat} - ${xMotivo}`,
    nRec,
    protocolo: null,
  };
}
