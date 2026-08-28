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

// tPag descreve COMO o destinatário pagou, não SE pagou. tPag 90 ("sem
// pagamento") é para finNFe 3/4 (ajuste, devolução) — numa venda normal
// (finNFe 1, o único que este arquivo emite) declarar tPag 90 com vPag igual
// ao total da nota é uma contradição que o schema aceita mas que não faz
// sentido de negócio (defeito do próprio plano desta fase, não drift de
// implementação). Esta fase ainda não conhece a condição de pagamento real
// do pedido — isso é do módulo de contas a receber, que ainda não existe —
// então usa um valor provisório neutro: '01' (dinheiro), a forma que menos
// inventa informação (não afirma cartão, boleto ou prazo que não aconteceu).
// TROCAR aqui quando contas a receber existir: a forma de pagamento deve vir
// da condição de pagamento do pedido, não desta constante fixa.
const TPAG_PADRAO_SAIDA = '01';

// CSOSN em que o Simples não destaca ICMS na nota (grupo ICMSSN102): a nota
// informa só a situação, sem base/alíquota/valor. CSOSN 101 NÃO entra aqui —
// tem grupo próprio (ICMSSN101), que o leiaute 4.00 exige com pCredSN e
// vCredICMSSN. Botar 101 nesta lista (como este arquivo fazia antes da
// revisão) gera <ICMSSN102><CSOSN>101</CSOSN></ICMSSN102>, que o schema da
// SEFAZ rejeita (Rejeição 215) — com o número fiscal já queimado.
const CSOSN_ICMSSN102 = ['102', '103', '300', '400'];

// Todo CSOSN que este arquivo sabe montar. Uma nota com CSOSN fora desta
// lista (ou sem CSOSN nenhum) é recusada explicitamente — nunca cai no
// catch-all antigo que inventava CSOSN 900 (ver validarCsosnItem).
const CSOSN_SUPORTADOS = ['102', '103', '300', '400', '500', '900'];

// Mensagem única para a recusa de CSOSN 101 — usada tanto aqui (serializador)
// quanto no pré-check de lib/nfe/emitir.js (mesmo texto, uma fonte só).
const MENSAGEM_CSOSN_101 =
  'CSOSN 101 (crédito presumido do Simples Nacional) precisa do grupo ICMSSN101, que o leiaute 4.00 '
  + 'exige com pCredSN (percentual de crédito) e vCredICMSSN (valor do crédito) — nenhum dos dois é '
  + 'opcional nesse grupo. O cadastro de regra tributária hoje só guarda permite_credito_simples '
  + '(booleano) e percentual_credito_presumido, que não são o percentual de crédito do Simples (esse '
  + 'muda todo mês com o RBT12 e viria de parametros_simples_nacional, que esta fase ainda não lê). '
  + 'Sem um valor de verdade para pCredSN, a emissão não pode chutar um número nem omitir o grupo e '
  + 'destacar ICMS por engano — por isso este item está fora do que esta fase do motor de emissão '
  + 'sabe emitir. Isto é uma lacuna de cadastro/próxima fase, não uma falha do sistema.';

// Valida o CSOSN de um item ANTES de montar qualquer XML — mesma lógica que
// decide o grupo ICMS logo abaixo, fatorada para poder rodar de graça no
// pipeline (lib/nfe/emitir.js), antes de reservar_numero_fiscal. Puro: só lê
// o item, nunca escreve nada. Uma função só, chamada dos dois lugares, para
// as duas checagens nunca divergirem uma da outra.
export function validarCsosnItem(item) {
  const csosn = String(item.csosn || '');
  if (csosn === '101') throw new Error(MENSAGEM_CSOSN_101);
  if (csosn === '500' || CSOSN_ICMSSN102.includes(csosn) || csosn === '900') return;
  if (!csosn && item.cstIcms) {
    throw new Error(
      `O item "${item.xProd || item.cProd}" tem CST de ICMS ("${item.cstIcms}") em vez de CSOSN — isso `
      + 'é regime normal (CRT 3), não Simples Nacional, e esta fase do motor de emissão só cobre CRT 1 '
      + 'ou 2. Regime normal está previsto para uma fase seguinte.',
    );
  }
  throw new Error(
    `CSOSN "${csosn || '(vazio)'}" do item "${item.xProd || item.cProd}" não é suportado nesta fase do `
    + `motor de emissão. Suportados aqui: ${CSOSN_SUPORTADOS.join(', ')} (101 também é reconhecido, mas `
    + 'recusado explicitamente — ver mensagem própria). Revise a regra tributária deste item em '
    + '/fiscal/tributacao.',
  );
}

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
  // Lança para os mesmos casos que o pré-check de emitir.js já barrou de
  // graça antes de reservar número — mantido aqui também porque montarXml.js
  // é chamado de outros lugares além do pipeline (ex.: um teste, ou um script
  // futuro), e o serializador não pode confiar que quem o chama já validou.
  validarCsosnItem(item);
  const csosn = String(item.csosn || '');
  if (csosn === '500') {
    return `<ICMS><ICMSSN500>${tag('orig', item.origem)}${tag('CSOSN', csosn)}</ICMSSN500></ICMS>`;
  }
  if (CSOSN_ICMSSN102.includes(csosn)) {
    return `<ICMS><ICMSSN102>${tag('orig', item.origem)}${tag('CSOSN', csosn)}</ICMSSN102></ICMS>`;
  }
  // Só resta '900' depois de validarCsosnItem — nunca inventa CSOSN quando
  // não reconhece o valor (isso já lançou acima).
  return '<ICMS><ICMSSN900>'
    + tag('orig', item.origem)
    + tag('CSOSN', csosn)
    + tag('modBC', '3')
    + tag('vBC', numero(item.vBC, 2))
    + tag('pICMS', numero(item.pICMS, 4))
    + tag('vICMS', numero(item.vICMS, 2))
    + '</ICMSSN900></ICMS>';
}

// CST 01/02: tributado, com base/alíquota/valor (grupo XAliq).
// CST 04-09: não incidência/isenção/suspensão etc. — só a situação, sem
// valor (grupo XNT). CST 49 e 50-99 ("outras operações"): no Simples, PIS/
// COFINS são recolhidos pelo DAS, não calculados nota a nota — por isso vão
// para o grupo XOutr com base/alíquota/valor zerados (padrão do Simples),
// nunca para XNT: XNT só enumera 04-09 no leiaute 4.00, e botar 49 ali
// (como este arquivo fazia antes da revisão) é <PISNT><CST>49</CST></PISNT>,
// que o schema rejeita — e 49 é exatamente o que sai por padrão quando a
// regra tributária não declara cst_pis/cst_cofins (ver resolverNota.js).
const CST_PIS_COFINS_ALIQ = ['01', '02'];
const CST_PIS_COFINS_NT = ['04', '05', '06', '07', '08', '09'];

function montarPIS(item) {
  const cst = String(item.cstPis || '49');
  if (CST_PIS_COFINS_ALIQ.includes(cst)) {
    return `<PIS><PISAliq>${tag('CST', cst)}${tag('vBC', numero(item.vProd, 2))}${tag('pPIS', numero(item.pPIS, 4))}${tag('vPIS', numero(item.vPIS, 2))}</PISAliq></PIS>`;
  }
  if (CST_PIS_COFINS_NT.includes(cst)) {
    return `<PIS><PISNT>${tag('CST', cst)}</PISNT></PIS>`;
  }
  return `<PIS><PISOutr>${tag('CST', cst)}${tag('vBC', numero(0, 2))}${tag('pPIS', numero(0, 4))}${tag('vPIS', numero(0, 2))}</PISOutr></PIS>`;
}

function montarCOFINS(item) {
  const cst = String(item.cstCofins || '49');
  if (CST_PIS_COFINS_ALIQ.includes(cst)) {
    return `<COFINS><COFINSAliq>${tag('CST', cst)}${tag('vBC', numero(item.vProd, 2))}${tag('pCOFINS', numero(item.pCOFINS, 4))}${tag('vCOFINS', numero(item.vCOFINS, 2))}</COFINSAliq></COFINS>`;
  }
  if (CST_PIS_COFINS_NT.includes(cst)) {
    return `<COFINS><COFINSNT>${tag('CST', cst)}</COFINSNT></COFINS>`;
  }
  return `<COFINS><COFINSOutr>${tag('CST', cst)}${tag('vBC', numero(0, 2))}${tag('pCOFINS', numero(0, 4))}${tag('vCOFINS', numero(0, 2))}</COFINSOutr></COFINS>`;
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

  // infAdProd é o último filho opcional de det, depois de imposto e do
  // impostoDevol que este sistema não emite. tag() omite quando não há texto.
  return `<det nItem="${item.numeroItem}">${prod}${imposto}${tag('infAdProd', item.infAdProd)}</det>`;
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

// resolverNota já junta emit.informacoesComplementaresPadrao + observações do
// pedido e sanitiza o resultado (sem quebra de linha, dentro do limite de
// 5000 caracteres) em nota.ide.infCpl — aqui só falta empacotar na tag.
function montarInfAdic(nota) {
  const texto = nota.ide?.infCpl;
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
    + '<pag>' + '<detPag>' + tag('indPag', '0') + tag('tPag', TPAG_PADRAO_SAIDA) + tag('vPag', numero(nota.total.vNF, 2)) + '</detPag>' + '</pag>'
    + infAdicXml
    + '</infNFe>';

  const xml = `<?xml version="1.0" encoding="UTF-8"?>`
    + `<NFe xmlns="http://www.portalfiscal.inf.br/nfe">${infNFe}</NFe>`;

  return { xml, chave, codigoNumerico: cNF };
}
