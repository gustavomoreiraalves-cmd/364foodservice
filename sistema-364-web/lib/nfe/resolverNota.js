// lib/nfe/resolverNota.js
//
// Junta pedido, cliente, produtos e regras tributárias num objeto neutro, que o
// serializador transforma em XML. Puro: recebe as linhas já lidas do banco.
//
// Existe separado do serializador de propósito: quando o leiaute mudar (IBS/CBS
// da Reforma Tributária alcança o Simples em 04/01/2027), muda o serializador,
// não este arquivo.
//
// Toda validação aqui roda ANTES de reservar número fiscal. Falhar aqui é de
// graça; falhar depois queima numeração.

import { juntarTextoFiscal, LIMITE_INF_AD_PROD } from '../fiscalRegras.js';

// A SEFAZ exige esta razão social em homologação. Mandar o nome real do cliente
// num XML de teste é rejeição 999 / "NF-e de teste em ambiente de produção".
const RAZAO_SOCIAL_HOMOLOGACAO = 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

import { calcularIcmsST } from './calculoST.js';

// CSOSN em que o Simples não destaca ICMS: a nota informa a situação, sem valor.
// O 202 está aqui porque o grupo ICMSSN202 do leiaute NÃO tem campo para vBC,
// pICMS nem vICMS — só para os valores de ST. Calcular ICMS próprio para ele
// faria o ICMSTot declarar um imposto que item nenhum destaca, e total sem
// item correspondente é rejeição. O DANFE modelo do contador confirma:
// base de cálculo do ICMS 0,00, valor do ICMS 0,00.
const CSOSN_SEM_DESTAQUE = ['101', '102', '103', '202', '300', '400', '500'];

// CSOSN em que o emitente do Simples COBRA o ICMS-ST (é o substituto).
const CSOSN_COM_ST = ['201', '202', '203'];

// Percentual que veio do cadastro: 0 é um valor, ausente não é. A diferença
// importa porque pMVAST e pRedBCST são opcionais no leiaute — omitir é dizer
// "não se aplica", mandar zero é declarar uma margem ou redução de 0%.
function percentualCadastrado(valor) {
  if (valor === null || valor === undefined || valor === '') return undefined;
  const n = Number(valor);
  return Number.isFinite(n) ? n : undefined;
}

// Resolve o ICMS-ST de um item. Devolve null quando a operação não tem ST.
//
// Quem decide se há ST é `st_responsavel`, não o CSOSN: o papel é o fato, o
// CSOSN é como ele se escreve. Por isso as duas combinações incoerentes param
// aqui, nomeando os dois campos — durante o cadastro do 364 elas apareceram de
// verdade, com `substituto` e CSOSN 500 na mesma regra.
function resolverSt(regra, nome, vProd) {
  const papel = String(regra.st_responsavel || 'nao_aplicavel');
  const csosn = String(regra.csosn || '');
  const csosnDeSubstituto = CSOSN_COM_ST.includes(csosn);

  if (papel === 'substituto' && !csosnDeSubstituto) {
    throw new Error(
      `A regra tributária de "${nome}" diz que a 364 é substituta (recolhe o ICMS-ST), mas o CSOSN `
      + `é "${csosn || '(vazio)'}", que é de quem já foi substituído. Um dos dois está errado: `
      + `ou o papel na ST, ou o CSOSN (o de substituto é 201, 202 ou 203). Corrija em /fiscal/tributacao.`,
    );
  }
  // Só o 202 entra aqui. Para 201 e 203 quem recusa é o serializador, com a
  // mensagem de "esta fase não cobre" — que é a informação certa. Reclamar do
  // papel na ST mandaria a pessoa corrigir um campo que não é o problema.
  if (papel !== 'substituto' && csosn === '202') {
    throw new Error(
      `A regra tributária de "${nome}" usa CSOSN ${csosn}, que é de quem cobra o ICMS-ST, mas o papel `
      + `na substituição está como "${papel}". Um dos dois está errado. Corrija em /fiscal/tributacao.`,
    );
  }
  if (papel !== 'substituto') return null;

  const mva = percentualCadastrado(regra.mva_percentual);
  const reducaoST = percentualCadastrado(regra.reducao_base_st_percentual);
  const aliquotaST = percentualCadastrado(regra.aliquota_st_retido);

  // Sem alíquota o ICMS-ST calcula zero, e a nota sai dizendo que reteve
  // imposto sem reter nada — pior do que não sair, porque parece recolhido.
  // A margem sozinha não basta: ela só define a base sobre a qual nada seria
  // aplicado. Isto pegou o cadastro real da 364 em 28/08/2026, que tinha MVA
  // preenchido e a alíquota em branco.
  if (!(aliquotaST > 0)) {
    throw new Error(
      `A regra tributária de "${nome}" é de substituição tributária, mas está sem alíquota de ST`
      + (mva === undefined ? ' e sem MVA' : '')
      + '. Sem a alíquota o imposto retido calcula zero, e a nota sairia declarando uma retenção que '
      + 'não aconteceu. Preencha em /fiscal/tributacao antes de emitir.',
    );
  }

  const calculo = calcularIcmsST({
    valorProduto: vProd,
    mva: mva ?? 0,
    reducaoBaseST: reducaoST ?? 0,
    aliquotaST: aliquotaST ?? 0,
    // Simples Nacional: não há ICMS próprio destacado para abater da ST.
    aliquota: 0,
    reducaoBase: 0,
    creditaOperacaoPropria: false,
  });

  return {
    // 4 = margem de valor agregado, que é o caso do cadastro quando há MVA.
    modBCST: String(regra.mod_bc_st ?? (mva === undefined ? '' : '4')) || '4',
    pMVAST: mva,
    pRedBCST: reducaoST,
    vBCST: calculo.vBCST,
    pICMSST: aliquotaST ?? 0,
    vICMSST: calculo.vICMSST,
  };
}

const duasCasas = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const digitos = v => String(v ?? '').replace(/\D/g, '');

function exigir(valor, mensagem) {
  const v = typeof valor === 'string' ? valor.trim() : valor;
  if (v === null || v === undefined || v === '') throw new Error(mensagem);
  return v;
}

// Campos de texto livre do leiaute (tipo TString) proíbem espaço em branco no
// início/fim e caractere de controle (quebra de linha inclusa) — e cada um
// tem um tamanho máximo. Descumprir isso é a mesma Rejeição 215 opaca de
// schema, só que descoberta DEPOIS de reservar_numero_fiscal ter queimado o
// número. Por isso a normalização roda aqui, no resolver, antes da reserva —
// nunca no serializador. Verificado: xProd chegou a sair com 141 caracteres e
// espaço no fim (limite 120), e infCpl com quebra de linha crua vinda direto
// de uma textarea (controle proibido).
function normalizarTexto(valor, max, descricaoCampo) {
  if (valor === null || valor === undefined) return valor;
  const semControle = String(valor).replace(/[\x00-\x1F\x7F]/g, ' ');
  const normalizado = semControle.replace(/\s+/g, ' ').trim();
  if (normalizado.length > max) {
    throw new Error(
      `${descricaoCampo} excede o limite de ${max} caracteres do leiaute (tem ${normalizado.length}): `
      + `"${normalizado.slice(0, 40)}…".`,
    );
  }
  return normalizado;
}

// Sanitiza xNome + endereço do emitente sem alterar o objeto que
// dadosEmitente() devolveu (outros lugares do pipeline ainda seguram essa
// referência). Emitente muda pouco (é cadastro, não input por pedido), mas
// nada garante que um logradouro longo ou com espaço sobrando nunca chegue
// lá — a mesma trava vale para os dois lados da nota.
function sanitizarEmit(emitente) {
  return {
    ...emitente,
    xNome: normalizarTexto(emitente.xNome, 60, 'xNome do emitente'),
    enderEmit: {
      ...emitente.enderEmit,
      xLgr: normalizarTexto(emitente.enderEmit.xLgr, 60, 'logradouro do emitente (xLgr)'),
      xCpl: normalizarTexto(emitente.enderEmit.xCpl, 60, 'complemento do emitente (xCpl)'),
      xBairro: normalizarTexto(emitente.enderEmit.xBairro, 60, 'bairro do emitente (xBairro)'),
      xMun: normalizarTexto(emitente.enderEmit.xMun, 60, 'município do emitente (xMun)'),
    },
  };
}

function resolverItem({ pedidoItem, produto, regra }, indice) {
  const nome = produto?.nome || produto?.codigo || `item ${indice + 1}`;

  if (!regra) {
    throw new Error(
      `Não há regra tributária para "${nome}". Cadastre a tributação do produto em `
      + '/fiscal/tributacao antes de emitir.',
    );
  }
  if (!produto.ativo_fiscal) {
    throw new Error(`O produto "${nome}" não está liberado para emissão fiscal. Revise a aba Fiscal do produto.`);
  }
  exigir(produto.ncm, `O produto "${nome}" está sem NCM.`);
  exigir(regra.cfop, `A regra tributária de "${nome}" está sem CFOP.`);

  const quantidade = Number(pedidoItem.quantidade);
  const valorUnitario = Number(pedidoItem.preco_unitario);
  if (!(quantidade > 0)) throw new Error(`Quantidade inválida em "${nome}": ${pedidoItem.quantidade}`);
  if (!(valorUnitario > 0)) throw new Error(`Preço inválido em "${nome}": ${pedidoItem.preco_unitario}`);

  const vProd = duasCasas(quantidade * valorUnitario);

  // Simples Nacional sem destaque: informa o CSOSN, não o valor. Com destaque
  // (CSOSN 900 ou CST de regime normal), aplica redução de base e alíquota.
  const semDestaque = regra.csosn && CSOSN_SEM_DESTAQUE.includes(String(regra.csosn));
  let vBC = 0, vICMS = 0, pICMS = 0;
  if (!semDestaque) {
    const reducao = Number(regra.reducao_base_percentual || 0);
    pICMS = Number(regra.aliquota_interna_destino || 0);
    vBC = duasCasas(vProd * (1 - reducao / 100));
    vICMS = duasCasas(vBC * pICMS / 100);
  }

  const st = resolverSt(regra, nome, vProd);

  const pPIS = Number(regra.aliquota_pis || 0);
  const pCOFINS = Number(regra.aliquota_cofins || 0);

  return {
    numeroItem: indice + 1,
    pedidoItemId: pedidoItem.id,
    produtoId: produto.id,
    cProd: String(produto.codigo || produto.id),
    xProd: normalizarTexto(nome, 120, `xProd do produto "${nome}"`),
    NCM: digitos(produto.ncm),
    CEST: produto.cest ? digitos(produto.cest) : undefined,
    cEAN: produto.gtin || 'SEM GTIN',
    cEANTrib: produto.gtin_tributavel || produto.gtin || 'SEM GTIN',
    CFOP: String(regra.cfop),
    uCom: produto.unidade || 'UN',
    uTrib: produto.unidade_tributavel || produto.unidade || 'UN',
    quantidade, valorUnitario, vProd,
    origem: String(produto.origem_mercadoria ?? '0'),
    csosn: regra.csosn || undefined,
    cstIcms: regra.cst_icms || undefined,
    vBC, pICMS, vICMS,
    modBCST: st?.modBCST,
    pMVAST: st?.pMVAST,
    pRedBCST: st?.pRedBCST,
    vBCST: st?.vBCST ?? 0,
    pICMSST: st?.pICMSST,
    vICMSST: st?.vICMSST ?? 0,
    cstPis: regra.cst_pis || '49',
    pPIS, vPIS: duasCasas(vProd * pPIS / 100),
    cstCofins: regra.cst_cofins || '49',
    pCOFINS, vCOFINS: duasCasas(vProd * pCOFINS / 100),
    regraTributariaId: regra.id,
    // Informação adicional POR ITEM. Nota com ST retido que não diz no item de
    // onde vem a retenção gera questionamento fiscal e cliente sem como se
    // creditar. O rodapé (infCpl) é da nota inteira e não serve para isso.
    infAdProd: normalizarTexto(
      juntarTextoFiscal(regra.base_legal, regra.observacao_fiscal),
      LIMITE_INF_AD_PROD,
      `informação adicional do item "${nome}" (infAdProd)`,
    ),
  };
}

// Esta fase cobre só destinatário contribuinte (ind_ie_dest 1 ou 2). Ausência
// do campo não é evidência de nenhum valor — muito menos de um valor fiscal —
// então não há default: falta ou valor fora do escopo tem que parar a emissão
// aqui, explicitamente, e não virar uma nota de consumidor final por acaso.
function resolverIndIEDest(cliente) {
  const bruto = cliente.ind_ie_dest;
  if (bruto === null || bruto === undefined || bruto === '') {
    throw new Error(
      `O cliente "${cliente.nome}" está sem indicador de inscrição estadual do destinatário `
      + '(ind_ie_dest). Preencha o cadastro em /clientes antes de emitir.',
    );
  }
  const valor = String(bruto).trim();
  if (valor === '1' || valor === '2') return valor;
  if (valor === '9') {
    throw new Error(
      `O cliente "${cliente.nome}" está cadastrado como não contribuinte / consumidor final `
      + '(ind_ie_dest = 9). Esta fase do motor de emissão cobre apenas vendas para destinatário '
      + 'contribuinte (ind_ie_dest 1 ou 2); venda para consumidor final exige DIFAL, indFinal e '
      + 'campos relacionados, que ainda não foram implementados — isso será tratado em fase futura.',
    );
  }
  throw new Error(
    `O cliente "${cliente.nome}" tem indicador de inscrição estadual do destinatário inválido `
    + `(ind_ie_dest = "${bruto}"). Corrija o cadastro em /clientes antes de emitir.`,
  );
}

function resolverDestinatario(cliente, ambiente) {
  const doc = digitos(cliente.cnpj);
  if (doc.length !== 14 && doc.length !== 11) {
    throw new Error(`O cliente "${cliente.nome}" está sem CNPJ/CPF válido.`);
  }
  return {
    tipoPessoa: doc.length === 14 ? 'J' : 'F',
    documento: doc,
    // Em homologação a razão social é fixada pela SEFAZ; usar o nome real
    // ali é rejeição.
    xNome: normalizarTexto(
      ambiente === 'homologacao' ? RAZAO_SOCIAL_HOMOLOGACAO : exigir(cliente.nome, 'O cliente está sem nome.'),
      60, `xNome do cliente "${cliente.nome}"`,
    ),
    indIEDest: resolverIndIEDest(cliente),
    IE: cliente.ie ? digitos(cliente.ie) : undefined,
    email: cliente.email_nfe || undefined,
    enderDest: {
      xLgr: normalizarTexto(
        exigir(cliente.logradouro, `O cliente "${cliente.nome}" está sem logradouro.`),
        60, `logradouro do cliente "${cliente.nome}" (xLgr)`,
      ),
      nro: exigir(cliente.numero, `O cliente "${cliente.nome}" está sem número no endereço.`),
      xCpl: normalizarTexto(cliente.complemento || undefined, 60, `complemento do cliente "${cliente.nome}" (xCpl)`),
      xBairro: normalizarTexto(
        exigir(cliente.bairro, `O cliente "${cliente.nome}" está sem bairro.`),
        60, `bairro do cliente "${cliente.nome}" (xBairro)`,
      ),
      cMun: exigir(digitos(cliente.codigo_municipio_ibge), `O cliente "${cliente.nome}" está sem o código do município (IBGE).`),
      xMun: normalizarTexto(
        exigir(cliente.municipio, `O cliente "${cliente.nome}" está sem município.`),
        60, `município do cliente "${cliente.nome}" (xMun)`,
      ),
      UF: exigir(cliente.uf, `O cliente "${cliente.nome}" está sem UF.`),
      CEP: digitos(cliente.cep) || undefined,
      cPais: '1058',
      xPais: 'BRASIL',
      fone: digitos(cliente.telefone) || undefined,
    },
  };
}

export function resolverNota({ pedido, cliente, itens, emitente, naturezaOperacao, ambiente }) {
  if (!Array.isArray(itens) || itens.length === 0) {
    throw new Error('O pedido não tem nenhum item para emitir.');
  }
  const dest = resolverDestinatario(cliente, ambiente);
  const resolvidos = itens.map(resolverItem);
  const vProd = duasCasas(resolvidos.reduce((s, i) => s + i.vProd, 0));

  // infCpl junta o texto padrão do emitente (informacoesComplementaresPadrao,
  // vindo de uma textarea em /fiscal/emissor) com as observações do pedido —
  // as duas fontes livres de texto que alimentam este campo. A junção
  // acontece aqui, não no serializador, porque a normalização (sem quebra de
  // linha, dentro do limite de 5000 caracteres) tem que rodar antes de
  // reservar_numero_fiscal.
  const infCplBruto = [emitente.informacoesComplementaresPadrao, pedido.observacoes]
    .filter(v => v !== null && v !== undefined && String(v).trim() !== '')
    .join(' | ');
  const infCpl = infCplBruto ? normalizarTexto(infCplBruto, 5000, 'infCpl (informações complementares)') : undefined;

  return {
    ide: {
      natOp: exigir(naturezaOperacao?.descricao, 'Escolha a natureza da operação antes de emitir.'),
      naturezaOperacaoId: naturezaOperacao.id,
      // Operação interna (mesma UF) = 1; interestadual = 2. Esta fase cobre
      // só a interna; o serializador recusa o resto.
      idDest: emitente.enderEmit.UF === dest.enderDest.UF ? '1' : '2',
      cMunFG: emitente.enderEmit.cMun,
      pedidoId: pedido.id,
      observacoes: pedido.observacoes || undefined,
      infCpl,
    },
    emit: sanitizarEmit(emitente),
    dest,
    itens: resolvidos,
    total: {
      vProd,
      vBCST: duasCasas(resolvidos.reduce((s, i) => s + (i.vBCST || 0), 0)),
      vST: duasCasas(resolvidos.reduce((s, i) => s + (i.vICMSST || 0), 0)),
      // O ICMS-ST entra no valor do documento: o destinatário paga produto
      // mais imposto retido. O DANFE modelo do contador fecha assim
      // (3.150,00 + 184,27 = 3.334,27), e o vPag do bloco de pagamento segue
      // o vNF — divergir entre os dois é rejeição.
      vNF: duasCasas(vProd + duasCasas(resolvidos.reduce((s, i) => s + (i.vICMSST || 0), 0))),
      vBC: duasCasas(resolvidos.reduce((s, i) => s + i.vBC, 0)),
      vICMS: duasCasas(resolvidos.reduce((s, i) => s + i.vICMS, 0)),
      vPIS: duasCasas(resolvidos.reduce((s, i) => s + i.vPIS, 0)),
      vCOFINS: duasCasas(resolvidos.reduce((s, i) => s + i.vCOFINS, 0)),
    },
  };
}
