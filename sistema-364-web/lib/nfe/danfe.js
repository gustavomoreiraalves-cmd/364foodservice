// Modelo do DANFE a partir do XML que a SEFAZ autorizou.
//
// Puro: recebe o nfeProc como texto e devolve os blocos já formatados como o
// papel exige. Não conhece React, rede nem Storage.
//
// A fonte é o nfeProc, e não o banco, por duas razões. A primeira é que o
// DANFE representa o que foi AUTORIZADO, não o que este sistema acha que
// enviou — e os dois divergem em silêncio sempre que uma gravação local falha
// pela metade. A segunda é que o banco não tem tudo: dhRecbto e digVal só
// existem dentro do protNFe, e nfe_saida_itens não guarda infAdProd nem infCpl.
//
// Não reaproveita lib/nfe/parseNFe.js de propósito: aquele extrai a fatia
// estreita que o recebimento precisa (fornecedor, de-para de item) e não traz
// endereço do destinatário, protocolo, totais de ST nem informação adicional
// por item. Fundir os dois faria um arquivo servir a dois documentos
// diferentes com necessidades opostas.
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Sem isto o NCM 02102000 vira o número 2102000 e a chave perde o zero
  // inicial. Mesma configuração de lib/nfe/parseNFe.js, pela mesma razão.
  parseTagValue: false,
  trimValues: true,
});

// A NF-e omite o array quando há um só elemento — um det, uma dup.
const lista = v => (v == null ? [] : Array.isArray(v) ? v : [v]);
const texto = v => (v == null ? '' : String(v));

// Dinheiro e quantidade no formato do papel: milhar com ponto, decimal com
// vírgula. O XML traz ponto decimal, que impresso ficaria estrangeiro.
function numeroBr(valor, casas = 2) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

function dataHoraBr(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(texto(iso));
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : '';
}

function dataBr(iso) {
  return dataHoraBr(iso).slice(0, 10);
}

function endereco(e = {}) {
  return {
    logradouro: texto(e.xLgr), numero: texto(e.nro), complemento: texto(e.xCpl),
    bairro: texto(e.xBairro), municipio: texto(e.xMun), uf: texto(e.UF),
    cep: texto(e.CEP), fone: texto(e.fone),
  };
}

// O grupo de ICMS do item vem embrulhado pelo nome da situação
// (ICMSSN202, ICMSSN500, ICMS60...). Qual deles é não importa para o papel:
// o DANFE imprime os mesmos campos, e os que não existirem saem vazios.
function grupoIcms(det) {
  const icms = det.imposto?.ICMS;
  if (!icms || typeof icms !== 'object') return {};
  return Object.values(icms)[0] || {};
}

export function modeloDanfe(xml) {
  const doc = parser.parse(xml);
  const proc = doc.nfeProc;
  if (!proc) {
    throw new Error('DANFE: o arquivo não é um nfeProc — só a NF-e com protocolo de autorização vira DANFE.');
  }

  const inf = proc.NFe?.infNFe;
  if (!inf) throw new Error('DANFE: o nfeProc não tem o bloco infNFe.');

  const protocolo = proc.protNFe?.infProt;
  if (!protocolo) {
    throw new Error('DANFE: o arquivo não tem protNFe. Sem protocolo não há como imprimir DANFE de nota autorizada.');
  }

  const ide = inf.ide || {};
  const total = inf.total?.ICMSTot || {};
  const chave = texto(inf['@_Id']).replace(/^NFe/, '');

  const itens = lista(inf.det).map(det => {
    const prod = det.prod || {};
    const icms = grupoIcms(det);
    return {
      numero: texto(det['@_nItem']),
      codigo: texto(prod.cProd),
      descricao: texto(prod.xProd),
      ncm: texto(prod.NCM),
      cest: texto(prod.CEST),
      cfop: texto(prod.CFOP),
      unidade: texto(prod.uCom),
      quantidade: numeroBr(prod.qCom, 4),
      valorUnitario: numeroBr(prod.vUnCom, 2),
      valorTotal: numeroBr(prod.vProd, 2),
      origem: texto(icms.orig),
      csosn: texto(icms.CSOSN),
      cstIcms: texto(icms.CST),
      baseIcms: numeroBr(icms.vBC || 0, 2),
      aliquotaIcms: numeroBr(icms.pICMS || 0, 2),
      valorIcms: numeroBr(icms.vICMS || 0, 2),
      baseIcmsSt: numeroBr(icms.vBCST || 0, 2),
      valorIcmsSt: numeroBr(icms.vICMSST || 0, 2),
      informacaoAdicional: texto(det.infAdProd),
    };
  });

  return {
    chave,
    // Em grupos de quatro, como o DANFE imprime — 44 dígitos corridos ninguém
    // confere a olho.
    chaveFormatada: chave.replace(/(\d{4})(?=\d)/g, '$1 '),
    numero: texto(ide.nNF),
    serie: texto(ide.serie),
    emitidaEm: dataBr(ide.dhEmi),
    tipoOperacao: texto(ide.tpNF) === '0' ? 'ENTRADA' : 'SAÍDA',
    indicadorOperacao: texto(ide.tpNF),
    naturezaOperacao: texto(ide.natOp),
    // Lido do documento, não da configuração da empresa: a configuração muda,
    // o papel impresso é sobre a nota que foi emitida.
    semValorFiscal: texto(ide.tpAmb) === '2',
    protocolo: {
      numero: texto(protocolo.nProt),
      recebidoEm: dataHoraBr(protocolo.dhRecbto),
      motivo: texto(protocolo.xMotivo),
    },
    emitente: {
      nome: texto(inf.emit?.xNome),
      fantasia: texto(inf.emit?.xFant),
      cnpj: texto(inf.emit?.CNPJ),
      ie: texto(inf.emit?.IE),
      endereco: endereco(inf.emit?.enderEmit),
    },
    destinatario: {
      nome: texto(inf.dest?.xNome),
      documento: texto(inf.dest?.CNPJ || inf.dest?.CPF),
      ie: texto(inf.dest?.IE),
      endereco: endereco(inf.dest?.enderDest),
    },
    totais: {
      vBC: numeroBr(total.vBC, 2),
      vICMS: numeroBr(total.vICMS, 2),
      vBCST: numeroBr(total.vBCST, 2),
      vST: numeroBr(total.vST, 2),
      vProd: numeroBr(total.vProd, 2),
      vFrete: numeroBr(total.vFrete, 2),
      vSeg: numeroBr(total.vSeg, 2),
      vDesc: numeroBr(total.vDesc, 2),
      vOutro: numeroBr(total.vOutro, 2),
      vIPI: numeroBr(total.vIPI, 2),
      vPIS: numeroBr(total.vPIS, 2),
      vCOFINS: numeroBr(total.vCOFINS, 2),
      vNF: numeroBr(total.vNF, 2),
    },
    transporte: { modalidade: texto(inf.transp?.modFrete) },
    itens,
    informacoesComplementares: texto(inf.infAdic?.infCpl),
  };
}
