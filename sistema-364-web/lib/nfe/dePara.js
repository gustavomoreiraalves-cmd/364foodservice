// Liga cada item da NF-e à matéria-prima cadastrada, usando o mapa que o sistema
// aprende a cada nota. O fornecedor fatura em caixa/fardo e o estoque trabalha em
// quilo, então o fator de conversão é parte do mapa, não um detalhe opcional.
//
// `mapa` é a lista de linhas de fornecedor_produto_mapa JÁ FILTRADA pelo CNPJ do
// emitente — filtrar por CNPJ é responsabilidade de quem consulta o banco.

function arred(v, casas) {
  const f = 10 ** casas;
  return Math.round(Number(v) * f) / f;
}

export function aplicarDePara(nota, mapa) {
  const indice = new Map((mapa || []).map(m => [String(m.codigo_produto), m]));

  return (nota.itens || []).map(item => {
    const m = indice.get(String(item.codigo)) || null;
    const fator = m && Number(m.fator_conversao) > 0 ? Number(m.fator_conversao) : 1;
    const pesoNotaKg = arred(item.quantidade * fator, 4);
    // Custo por unidade de estoque (kg), e não por unidade comercial da nota.
    const custoUnitario = pesoNotaKg > 0 ? arred(item.valorTotal / pesoNotaKg, 2) : 0;

    return {
      indice: item.indice,
      codigo: item.codigo,
      descricao: item.descricao,
      unidadeNota: item.unidade,
      quantidadeNota: item.quantidade,
      valorUnitarioNota: item.valorUnitario,
      valorTotalItem: item.valorTotal,
      materiaPrimaId: m ? m.materia_prima_id : null,
      fatorConversao: fator,
      pesoNotaKg,
      custoUnitario,
      mapeado: Boolean(m),
    };
  });
}

export function itensNaoMapeados(itens) {
  return (itens || []).filter(i => !i.mapeado);
}
