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

// A conta de um item da nota, num lugar só. A tela de recebimento refaz esta mesma
// conta quando o operador ajusta o fator na conferência — duas cópias da mesma
// fórmula acabam divergindo, e é ela que define o custo do lote em estoque.
// Peso em 4 casas e custo em 2, o padrão de valor derivado e persistido do projeto.
export function calcularItem({ quantidade, valorTotal, fator }) {
  const f = Number(fator) > 0 ? Number(fator) : 1;
  const pesoNotaKg = arred(Number(quantidade) * f, 4);
  // Custo por unidade de estoque (kg), e não por unidade comercial da nota.
  const custoUnitario = pesoNotaKg > 0 ? arred(Number(valorTotal) / pesoNotaKg, 2) : 0;
  return { pesoNotaKg, custoUnitario };
}

export function aplicarDePara(nota, mapa) {
  const indice = new Map((mapa || []).map(m => [String(m.codigo_produto), m]));

  return (nota.itens || []).map(item => {
    const m = indice.get(String(item.codigo)) || null;
    const fator = m && Number(m.fator_conversao) > 0 ? Number(m.fator_conversao) : 1;
    const { pesoNotaKg, custoUnitario } = calcularItem({
      quantidade: item.quantidade, valorTotal: item.valorTotal, fator,
    });

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
