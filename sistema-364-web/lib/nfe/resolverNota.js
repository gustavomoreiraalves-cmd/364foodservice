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

// A SEFAZ exige esta razão social em homologação. Mandar o nome real do cliente
// num XML de teste é rejeição 999 / "NF-e de teste em ambiente de produção".
const RAZAO_SOCIAL_HOMOLOGACAO = 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

// CSOSN em que o Simples não destaca ICMS: a nota informa a situação, sem valor.
const CSOSN_SEM_DESTAQUE = ['101', '102', '103', '300', '400', '500'];

const duasCasas = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const digitos = v => String(v ?? '').replace(/\D/g, '');

function exigir(valor, mensagem) {
  const v = typeof valor === 'string' ? valor.trim() : valor;
  if (v === null || v === undefined || v === '') throw new Error(mensagem);
  return v;
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

  const pPIS = Number(regra.aliquota_pis || 0);
  const pCOFINS = Number(regra.aliquota_cofins || 0);

  return {
    numeroItem: indice + 1,
    pedidoItemId: pedidoItem.id,
    produtoId: produto.id,
    cProd: String(produto.codigo || produto.id),
    xProd: nome,
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
    cstPis: regra.cst_pis || '49',
    pPIS, vPIS: duasCasas(vProd * pPIS / 100),
    cstCofins: regra.cst_cofins || '49',
    pCOFINS, vCOFINS: duasCasas(vProd * pCOFINS / 100),
    regraTributariaId: regra.id,
  };
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
    xNome: ambiente === 'homologacao' ? RAZAO_SOCIAL_HOMOLOGACAO : exigir(cliente.nome, 'O cliente está sem nome.'),
    indIEDest: String(cliente.ind_ie_dest ?? '9'),
    IE: cliente.ie ? digitos(cliente.ie) : undefined,
    email: cliente.email_nfe || undefined,
    enderDest: {
      xLgr: exigir(cliente.logradouro, `O cliente "${cliente.nome}" está sem logradouro.`),
      nro: exigir(cliente.numero, `O cliente "${cliente.nome}" está sem número no endereço.`),
      xCpl: cliente.complemento || undefined,
      xBairro: exigir(cliente.bairro, `O cliente "${cliente.nome}" está sem bairro.`),
      cMun: exigir(digitos(cliente.codigo_municipio_ibge), `O cliente "${cliente.nome}" está sem o código do município (IBGE).`),
      xMun: exigir(cliente.municipio, `O cliente "${cliente.nome}" está sem município.`),
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
    },
    emit: emitente,
    dest,
    itens: resolvidos,
    total: {
      vProd,
      vNF: vProd,
      vBC: duasCasas(resolvidos.reduce((s, i) => s + i.vBC, 0)),
      vICMS: duasCasas(resolvidos.reduce((s, i) => s + i.vICMS, 0)),
      vPIS: duasCasas(resolvidos.reduce((s, i) => s + i.vPIS, 0)),
      vCOFINS: duasCasas(resolvidos.reduce((s, i) => s + i.vCOFINS, 0)),
    },
  };
}
