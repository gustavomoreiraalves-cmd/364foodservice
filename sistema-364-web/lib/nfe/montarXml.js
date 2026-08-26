//
// Serializador do XML da NF-e 4.00. Consome o objeto neutro de `resolverNota`
// e devolve o XML SEM assinatura — quem assina é `assinarXml` de
// `lib/sefaz/assinatura.js`, no pipeline.
//
// Esta fase cobre só: operação interna (mesma UF do emitente e do destinatário)
// e emitente no Simples Nacional (CRT 1 ou 2). Fora disso, recusa explicitamente
// em vez de gerar um XML que a SEFAZ rejeita depois de reservar numeração.
//
// Fuso horário fixo em America/Porto_Velho: é o fuso do emitente desta fase
// (Rondônia, UTC-4), e tem que ser o MESMO usado para calcular o AAMM da chave
// de acesso — se dhEmi e a chave discordarem de mês, a nota é rejeitada.

import { montarChaveAcesso, gerarCodigoNumerico } from './chaveAcesso.js';

const FUSO_HORARIO = 'America/Porto_Velho';
const MODELO = '55';
const VERSAO_PROCESSO = '364-nfe-1.0.0';

// CSOSN em que o Simples não destaca ICMS na nota (ICMSSN102): a nota informa
// só a situação, sem base/alíquota/valor.
const CSOSN_ICMSSN102 = ['101', '102', '103', '300', '400'];

function escapar(valor) {
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Omite a tag inteira quando o valor é undefined/null/'' — campo opcional
// ausente não pode virar <tag></tag>, que a SEFAZ trata como valor vazio, não
// como ausência.
function tag(nome, valor) {
  if (valor === undefined || valor === null || valor === '') return '';
  return `<${nome}>${escapar(valor)}</${nome}>`;
}

function numero(valor, casas) {
  return Number(valor ?? 0).toFixed(casas);
}

// dhEmi em ISO 8601 com o offset do fuso informado — nunca UTC com "Z".
// toISOString() devolve sempre UTC; por isso montamos a string a partir dos
// componentes locais no fuso, via Intl.DateTimeFormat.
function isoComOffset(data, fusoHorario) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: fusoHorario,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(data);
  const p = Object.fromEntries(partes.map(({ type, value }) => [type, value]));

  // Offset: diferença entre o instante interpretado como se fosse UTC no
  // fuso alvo e o instante UTC real, em minutos.
  const comoUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour), Number(p.minute), Number(p.second),
  );
  const offsetMin = Math.round((comoUtc - data.getTime()) / 60000);
  const sinal = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const offH = String(Math.floor(abs / 60)).padStart(2, '0');
  const offM = String(abs % 60).padStart(2, '0');

  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${sinal}${offH}:${offM}`;
}

function montarICMS(item) {
  const csosn = String(item.csosn || '');
  if (csosn === '500') {
    return `<ICMS><ICMSSN500>${tag('orig', item.origem)}${tag('CSOSN', csosn)}</ICMSSN500></ICMS>`;
  }
  if (CSOSN_ICMSSN102.includes(csosn)) {
    return `<ICMS><ICMSSN102>${tag('orig', item.origem)}${tag('CSOSN', csosn)}</ICMSSN102></ICMS>`;
  }
  // Destaca (900 ou qualquer outro CSOSN do Simples com valor).
  return '<ICMS><ICMSSN900>'
    + tag('orig', item.origem)
    + tag('CSOSN', csosn || '900')
    + tag('modBC', '3')
    + tag('vBC', numero(item.vBC, 2))
    + tag('pICMS', numero(item.pICMS, 4))
    + tag('vICMS', numero(item.vICMS, 2))
    + '</ICMSSN900></ICMS>';
}

function montarPIS(item) {
  const cst = String(item.cstPis || '49');
  if (cst === '01' || cst === '02') {
    return `<PIS><PISAliq>${tag('CST', cst)}${tag('vBC', numero(item.vProd, 2))}${tag('pPIS', numero(item.pPIS, 4))}${tag('vPIS', numero(item.vPIS, 2))}</PISAliq></PIS>`;
  }
  return `<PIS><PISNT>${tag('CST', cst)}</PISNT></PIS>`;
}

function montarCOFINS(item) {
  const cst = String(item.cstCofins || '49');
  if (cst === '01' || cst === '02') {
    return `<COFINS><COFINSAliq>${tag('CST', cst)}${tag('vBC', numero(item.vProd, 2))}${tag('pCOFINS', numero(item.pCOFINS, 4))}${tag('vCOFINS', numero(item.vCOFINS, 2))}</COFINSAliq></COFINS>`;
  }
  return `<COFINS><COFINSNT>${tag('CST', cst)}</COFINSNT></COFINS>`;
}

function montarDet(item) {
  const prod = '<prod>'
    + tag('cProd', item.cProd)
    + tag('cEAN', item.cEAN)
    + tag('xProd', item.xProd)
    + tag('NCM', item.NCM)
    + tag('CEST', item.CEST)
    + tag('CFOP', item.CFOP)
    + tag('uCom', item.uCom)
    + tag('qCom', numero(item.quantidade, 4))
    + tag('vUnCom', numero(item.valorUnitario, 10))
    + tag('vProd', numero(item.vProd, 2))
    + tag('cEANTrib', item.cEANTrib)
    + tag('uTrib', item.uTrib)
    + tag('qTrib', numero(item.quantidade, 4))
    + tag('vUnTrib', numero(item.valorUnitario, 10))
    + tag('indTot', '1')
    + '</prod>';

  const imposto = '<imposto>'
    + montarICMS(item)
    + montarPIS(item)
    + montarCOFINS(item)
    + '</imposto>';

  return `<det nItem="${item.numeroItem}">${prod}${imposto}</det>`;
}

function montarEnderEmit(end) {
  return '<enderEmit>'
    + tag('xLgr', end.xLgr)
    + tag('nro', end.nro)
    + tag('xCpl', end.xCpl)
    + tag('xBairro', end.xBairro)
    + tag('cMun', end.cMun)
    + tag('xMun', end.xMun)
    + tag('UF', end.UF)
    + tag('CEP', end.CEP)
    + tag('cPais', end.cPais)
    + tag('xPais', end.xPais)
    + tag('fone', end.fone)
    + '</enderEmit>';
}

function montarEmit(emit) {
  return '<emit>'
    + tag('CNPJ', emit.cnpj)
    + tag('xNome', emit.xNome)
    + tag('xFant', emit.xFant)
    + montarEnderEmit(emit.enderEmit)
    + tag('IE', emit.IE)
    + tag('CRT', emit.CRT)
    + '</emit>';
}

function montarEnderDest(end) {
  return '<enderDest>'
    + tag('xLgr', end.xLgr)
    + tag('nro', end.nro)
    + tag('xCpl', end.xCpl)
    + tag('xBairro', end.xBairro)
    + tag('cMun', end.cMun)
    + tag('xMun', end.xMun)
    + tag('UF', end.UF)
    + tag('CEP', end.CEP)
    + tag('cPais', end.cPais)
    + tag('xPais', end.xPais)
    + tag('fone', end.fone)
    + '</enderDest>';
}

function montarDest(dest) {
  const docTag = dest.tipoPessoa === 'J' ? tag('CNPJ', dest.documento) : tag('CPF', dest.documento);
  return '<dest>'
    + docTag
    + tag('xNome', dest.xNome)
    + montarEnderDest(dest.enderDest)
    + tag('indIEDest', String(dest.indIEDest))
    + tag('IE', dest.IE)
    + tag('email', dest.email)
    + '</dest>';
}

function montarTotal(total) {
  const icmsTot = '<ICMSTot>'
    + tag('vBC', numero(total.vBC, 2))
    + tag('vICMS', numero(total.vICMS, 2))
    + tag('vICMSDeson', numero(0, 2))
    + tag('vFCP', numero(0, 2))
    + tag('vBCST', numero(0, 2))
    + tag('vST', numero(0, 2))
    + tag('vFCPST', numero(0, 2))
    + tag('vFCPSTRet', numero(0, 2))
    + tag('vProd', numero(total.vProd, 2))
    + tag('vFrete', numero(0, 2))
    + tag('vSeg', numero(0, 2))
    + tag('vDesc', numero(0, 2))
    + tag('vII', numero(0, 2))
    + tag('vIPI', numero(0, 2))
    + tag('vIPIDevol', numero(0, 2))
    + tag('vPIS', numero(total.vPIS, 2))
    + tag('vCOFINS', numero(total.vCOFINS, 2))
    + tag('vOutro', numero(0, 2))
    + tag('vNF', numero(total.vNF, 2))
    + '</ICMSTot>';
  return `<total>${icmsTot}</total>`;
}

function montarIde({ ide, cUF, cNF, dhEmi, serie, numero: nNF, tpAmb }) {
  return '<ide>'
    + tag('cUF', cUF)
    + tag('cNF', cNF)
    + tag('natOp', ide.natOp)
    + tag('mod', MODELO)
    + tag('serie', String(serie))
    + tag('nNF', String(nNF))
    + tag('dhEmi', dhEmi)
    + tag('tpNF', '1')
    + tag('idDest', ide.idDest)
    + tag('cMunFG', ide.cMunFG)
    + tag('tpImp', '1')
    + tag('tpEmis', '1')
    + tag('cDV', '__CDV__')
    + tag('tpAmb', tpAmb)
    + tag('finNFe', '1')
    + tag('indFinal', '0')
    + tag('indPres', '9')
    + tag('procEmi', '0')
    + tag('verProc', VERSAO_PROCESSO)
    + '</ide>';
}

function montarInfAdic(nota) {
  const partes = [];
  if (nota.emit?.informacoesComplementaresPadrao) partes.push(nota.emit.informacoesComplementaresPadrao);
  if (nota.ide?.observacoes) partes.push(nota.ide.observacoes);
  const texto = partes.join(' | ').trim();
  if (!texto) return '';
  return `<infAdic>${tag('infCpl', texto)}</infAdic>`;
}

export function montarXmlNFe(nota, { serie, numero: nNF, ambiente, dataEmissao, codigoNumerico }) {
  if (String(nota.ide.idDest) !== '1') {
    throw new Error(
      'Operação interestadual (idDest diferente de 1) não é coberta por esta fase do motor de '
      + 'emissão. Só operação interna (mesma UF do emitente e do destinatário) é suportada aqui; '
      + 'DIFAL e partilha interestadual estão previstos para uma fase seguinte.',
    );
  }
  const crt = String(nota.emit.CRT);
  if (crt !== '1' && crt !== '2') {
    throw new Error(
      `Regime normal (CRT = ${crt}) não é coberto por esta fase do motor de emissão. Só CRT 1 ou 2 `
      + '(Simples Nacional) é suportado aqui; ICMS/IPI de regime normal estão previstos para uma '
      + 'fase seguinte.',
    );
  }

  const cUF = String(nota.emit.enderEmit.cMun).slice(0, 2);
  const cNF = codigoNumerico || gerarCodigoNumerico(nNF);
  const dataBase = dataEmissao instanceof Date ? dataEmissao : new Date(dataEmissao);
  if (Number.isNaN(dataBase.getTime())) throw new Error('dataEmissao inválida para montar a NF-e.');

  const dhEmi = isoComOffset(dataBase, FUSO_HORARIO);

  const chave = montarChaveAcesso({
    cUF, dataEmissao: dataBase, cnpj: nota.emit.cnpj, modelo: MODELO, serie, numero: nNF,
    tipoEmissao: '1', codigoNumerico: cNF, fusoHorario: FUSO_HORARIO,
  });

  const tpAmb = ambiente === 'producao' ? '1' : '2';

  const ideXml = montarIde({ ide: nota.ide, cUF, cNF, dhEmi, serie, numero: nNF, tpAmb })
    .replace('<cDV>__CDV__</cDV>', tag('cDV', chave[43]));

  const detXml = nota.itens.map(montarDet).join('');
  const infAdicXml = montarInfAdic(nota);

  const infNFe = `<infNFe Id="NFe${chave}" versao="4.00">`
    + ideXml
    + montarEmit(nota.emit)
    + montarDest(nota.dest)
    + detXml
    + montarTotal(nota.total)
    + '<transp>' + tag('modFrete', '9') + '</transp>'
    + '<pag>' + '<detPag>' + tag('indPag', '0') + tag('tPag', '90') + tag('vPag', numero(nota.total.vNF, 2)) + '</detPag>' + '</pag>'
    + infAdicXml
    + '</infNFe>';

  const xml = `<?xml version="1.0" encoding="UTF-8"?>`
    + `<NFe xmlns="http://www.portalfiscal.inf.br/nfe">${infNFe}</NFe>`;

  return { xml, chave, codigoNumerico: cNF };
}
