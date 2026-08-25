// Cálculo do ICMS próprio e do ICMS retido por substituição tributária de um
// item de NF-e.
//
// A fórmula não é opinião: ela foi conferida contra a NF-e 34.840, série 1,
// emitida pelo frigorífico em 21/08/2026 e autorizada sob o protocolo
// 211260024029638, cujos três itens fecham ao centavo com estes parâmetros
// (MVA 35%, redução de base de 41,67% na própria e na ST, alíquota de 12%).
// Os vetores estão em tests/nfe-calculo-st.test.mjs.
//
// Os percentuais entram como percentuais (35 para 35%), não como fração — é
// assim que eles chegam de `cest_uf_regra` e de `regras_tributarias`, e é assim
// que vão para o XML.

// Arredondamento meio-para-cima em duas casas. Number.toFixed usa meio-para-par
// em alguns casos de borda, e a SEFAZ confere os totais somando os itens: um
// centavo de diferença rejeita a nota inteira.
export function arredondar(valor, casas = 2) {
  if (!Number.isFinite(valor)) return 0;
  const fator = 10 ** casas;
  // O epsilon corrige a representação binária (1.005 * 100 = 100.49999...).
  return Math.round((valor + Number.EPSILON) * fator) / fator;
}

function percentual(valor, taxa) {
  return valor * (taxa / 100);
}

/**
 * @param {object} p
 * @param {number} p.valorProduto        vProd do item, já líquido de desconto
 * @param {number} [p.frete]             rateio de frete no item
 * @param {number} [p.seguro]            rateio de seguro
 * @param {number} [p.outrasDespesas]    outras despesas acessórias
 * @param {number} [p.desconto]          desconto do item
 * @param {number} [p.aliquota]          alíquota do ICMS próprio, em %
 * @param {number} [p.reducaoBase]       redução da base própria, em %
 * @param {number} [p.mva]               margem de valor agregado, em %
 * @param {number} [p.reducaoBaseST]     redução da base de ST, em %
 * @param {number} [p.aliquotaST]        alíquota aplicada na base de ST, em %
 * @param {boolean} [p.creditaOperacaoPropria] false quando o emitente é do
 *        Simples: não há ICMS próprio destacado para abater da ST
 */
export function calcularIcmsST({
  valorProduto,
  frete = 0,
  seguro = 0,
  outrasDespesas = 0,
  desconto = 0,
  aliquota = 0,
  reducaoBase = 0,
  mva = 0,
  reducaoBaseST = 0,
  aliquotaST = null,
  creditaOperacaoPropria = true,
} = {}) {
  const valorOperacao = valorProduto + frete + seguro + outrasDespesas - desconto;

  const vBC = arredondar(valorOperacao * (1 - reducaoBase / 100));
  const vICMS = arredondar(percentual(vBC, aliquota));

  const aliquotaSTefetiva = aliquotaST === null ? aliquota : aliquotaST;
  const baseCheia = valorOperacao * (1 + mva / 100);
  const vBCST = arredondar(baseCheia * (1 - reducaoBaseST / 100));

  // O substituto recolhe a diferença entre o imposto de toda a cadeia presumida
  // e o que ele já destacou na operação própria. No Simples Nacional não há
  // destaque próprio a abater, então o valor retido é o imposto cheio da base
  // de ST — é o que o art. 28 da Resolução CGSN 140/2018 descreve.
  const impostoCadeia = arredondar(percentual(vBCST, aliquotaSTefetiva));
  const vICMSST = arredondar(impostoCadeia - (creditaOperacaoPropria ? vICMS : 0));

  return {
    valorOperacao: arredondar(valorOperacao),
    vBC,
    vICMS,
    vBCST,
    vICMSST: vICMSST > 0 ? vICMSST : 0,
  };
}
