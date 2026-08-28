// Linhas de cadastro do Firebird → objetos prontos para gravar no 364 OS.
//
// Puro: não fala com banco nenhum, dos dois lados. É onde vivem o roteamento
// por tipo, o de-para de unidade, a geração de código e a recusa de formato.
//
// A postura em cima de dado torto é a de lib/nfe/resolverNota.js: falhar alto
// e nomear o campo. Nada aqui vira null silencioso — NCM de 2 dígitos sai na
// lista de recusados com o valor que veio, para alguém arrumar no PDV.
//
// grupo_tributario_codigo é uma chave natural ("PDV 5405/500"), não o
// grupo_tributario_id (uuid) que produtos.grupo_tributario_id de fato usa —
// resolver essa chave para um id fica para a etapa de gravação, que upserta
// gruposDoLote() em grupos_tributarios antes de casar produto com grupo.

const TIPO_PRODUTO = 1;
const TIPO_INSUMO = 2;

const texto = v => {
  const s = String(v ?? '').trim();
  return s || null;
};

// 0.0000 no Consumer quer dizer "não informado", não um valor de zero real.
// Gravar 0 em preço faria a margem do relatório sair 100%.
const numeroPositivo = v => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function codigoDoProduto(prefixo, codigoPdv) {
  return `${prefixo}-P${codigoPdv}`;
}

export function unidadeDoPdv(sigla) {
  return texto(sigla)?.toLowerCase() || 'un';
}

// Sem CFOP ou sem CSOSN não há grupo: a combinação é o que dá nome a ele, e
// meia combinação não identifica tributação nenhuma.
export function chaveDoGrupo(linha) {
  const cfop = texto(linha.CFOP);
  const csosn = texto(linha.SITUACAOTRIBUTARIA);
  if (!cfop || !csosn) return null;
  return `PDV ${cfop}/${csosn}`;
}

export function gruposDoLote(linhas) {
  const vistos = new Map();
  for (const l of linhas) {
    const codigo = chaveDoGrupo(l);
    if (!codigo || vistos.has(codigo)) continue;
    const origem = l.ORIGEMMERCADORIA ?? '?';
    vistos.set(codigo, {
      codigo,
      descricao: `Importado do PDV — CFOP ${l.CFOP}, CSOSN ${l.SITUACAOTRIBUTARIA}, origem ${origem}`,
    });
  }
  return [...vistos.values()];
}

function validarFiscal(linha, recusados) {
  const ncm = texto(linha.NCM);
  if (ncm && !/^\d{8}$/.test(ncm)) {
    recusados.push({ codigo: linha.CODIGO, campo: 'ncm', valor: ncm, motivo: 'NCM não tem 8 dígitos' });
    return null;
  }
  const cest = texto(linha.CEST);
  if (cest && !/^\d{7}$/.test(cest)) {
    recusados.push({ codigo: linha.CODIGO, campo: 'cest', valor: cest, motivo: 'CEST não tem 7 dígitos' });
    return null;
  }
  // O banco tem `produtos_st_exige_cest`: sujeito_st sem CEST é violação de
  // check, e uma linha assim derrubaria a carga inteira no insert. CSOSN 500
  // é justamente o que liga sujeito_st, então a recusa mora aqui — com o
  // código na lista, para alguém completar o CEST no PDV.
  if (texto(linha.SITUACAOTRIBUTARIA) === '500' && !cest) {
    recusados.push({
      codigo: linha.CODIGO, campo: 'cest', valor: '',
      motivo: 'CSOSN 500 (ST) exige CEST, e a linha veio sem',
    });
    return null;
  }
  const origemBruta = linha.ORIGEMMERCADORIA;
  let origem = null;
  if (origemBruta !== null && origemBruta !== undefined && origemBruta !== '') {
    origem = Number(origemBruta);
    if (!Number.isInteger(origem) || origem < 0 || origem > 8) {
      recusados.push({
        codigo: linha.CODIGO, campo: 'origem_mercadoria', valor: origemBruta,
        motivo: 'origem fora do intervalo 0–8',
      });
      return null;
    }
  }
  return { ncm, cest, origem };
}

export function normalizaProdutosFb({ linhas, empresaId, prefixo, codigosVendidos = new Set() }) {
  const produtos = [];
  const materiasPrimas = [];
  const recusados = [];

  for (const l of linhas) {
    const vivo = texto(l.DESCONTINUADO) !== 'S';
    // Descontinuado sem venda no histórico não tem por que existir aqui. Com
    // venda, entra inativo — senão o join com pdv_vendas_itens_dia fica furado
    // justamente nos anos antigos.
    if (!vivo && !codigosVendidos.has(l.CODIGO)) continue;

    const comum = {
      empresa_id: empresaId,
      pdv_codigo_produto: l.CODIGO,
      nome: texto(l.NOME) || `Produto ${l.CODIGO} do PDV`,
      unidade: unidadeDoPdv(l.UNIDADE),
      categoria: texto(l.CATEGORIA),
      ativo: vivo,
    };
    // custo_unitario e preco_venda são NOT NULL no banco, com default 0.
    // Mandar null explícito não cai no default — é violação de NOT NULL, e
    // uma linha assim derruba a carga inteira. Quando o Consumer não informa,
    // a chave nem entra: quem grava resolve o valor de criação, e a rodada
    // seguinte não mexe no que já estiver na linha.
    const custo = numeroPositivo(l.PRECOCUSTO);
    if (custo !== null) comum.custo_unitario = custo;

    if (l.CODIGOPRODUTOTIPO === TIPO_INSUMO) {
      materiasPrimas.push(comum);
      continue;
    }
    if (l.CODIGOPRODUTOTIPO !== TIPO_PRODUTO) continue;

    const fiscal = validarFiscal(l, recusados);
    if (!fiscal) continue;

    const unidade = comum.unidade;
    const produto = {
      ...comum,
      codigo: codigoDoProduto(prefixo, l.CODIGO),
      ncm: fiscal.ncm,
      cest: fiscal.cest,
      origem_mercadoria: fiscal.origem,
      sujeito_st: texto(l.SITUACAOTRIBUTARIA) === '500',
      aliquota_transparencia: numeroPositivo(l.ALIQUOTATRANSPARENCIA),
      grupo_tributario_codigo: chaveDoGrupo(l),
      // Não existem no Consumer. O CHECK produtos_ativo_fiscal_completo exige
      // os dois para liberar emissão; como ativo_fiscal nasce false, ninguém
      // emite em cima do palpite sem revisar antes.
      unidade_tributavel: unidade,
      fator_conversao_tributavel: 1,
      ativo_fiscal: false,
      sugerido_automaticamente: true,
    };
    const preco = numeroPositivo(l.PRECOVENDA);
    if (preco !== null) produto.preco_venda = preco;
    produtos.push(produto);
  }

  return { produtos, materiasPrimas, recusados };
}
