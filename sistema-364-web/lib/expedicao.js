//
// Lógica pura do romaneio de separação (expedição): FEFO, empacotamento em
// caixas, divergência pedido × alocado, numeração e volumes pra NF-e. Nada
// aqui toca banco — quem chama já leu as linhas (mesmo padrão de
// lib/nfe/resolverNota.js).

// Lote sem validade vai para o fim — não é "vence primeiro", é "não se sabe
// quando vence", e a lista tem que continuar utilizável antes dele.
export function ordenarFefo(lotes) {
  return [...lotes].sort((a, b) => {
    if (!a.validade && !b.validade) return 0;
    if (!a.validade) return 1;
    if (!b.validade) return -1;
    return a.validade < b.validade ? -1 : a.validade > b.validade ? 1 : 0;
  });
}

// Para cada item do pedido: se o produto é rastreado, consome os lotes
// disponíveis em ordem FEFO até cobrir a quantidade; o que sobrar sem saldo
// de lote (ou o item inteiro, se não for rastreado) entra com
// recebimentoItemId null — "sem lote", aceito desde a revisão de 25/08 da
// Fase 4. Nunca aloca mais do que a quantidade pedida.
export function sugerirAlocacao(itensPedido, lotesPorProduto) {
  const alocacao = [];
  for (const item of itensPedido) {
    let restante = Number(item.quantidade);
    if (item.rastreado) {
      const lotes = ordenarFefo(lotesPorProduto[item.produtoId] || []);
      for (const lote of lotes) {
        if (restante <= 0) break;
        const saldo = Number(lote.saldo);
        if (!(saldo > 0)) continue;
        const usar = Math.min(saldo, restante);
        alocacao.push({ pedidoItemId: item.pedidoItemId, recebimentoItemId: lote.recebimentoItemId, quantidade: usar });
        restante -= usar;
      }
    }
    if (restante > 0) {
      alocacao.push({ pedidoItemId: item.pedidoItemId, recebimentoItemId: null, quantidade: restante });
    }
  }
  return alocacao;
}
