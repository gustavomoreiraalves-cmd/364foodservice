// Escolhe entre os vencimentos reais da nota e o parcelamento manual.
//
// As duplicatas do XML só valem quando o valor lançado no contas a pagar bate com
// o total da nota. Se algum item foi rejeitado na inspeção, o valor lançado é menor
// e os vencimentos do fornecedor deixam de corresponder — nesse caso o sistema
// devolve 'manual_divergencia' para a tela avisar e usa o parcelamento informado.
import { gerarParcelas } from '../financeiro.js';

const TOLERANCIA = 0.01;

export function parcelasDoRecebimento({
  duplicatas, dataBase, valorLancado, valorTotalNota, numeroParcelas = 1, intervaloDias = 30,
}) {
  const temDuplicatas = Array.isArray(duplicatas) && duplicatas.length > 0;
  const bate = temDuplicatas
    && Math.abs(Number(valorLancado) - Number(valorTotalNota)) <= TOLERANCIA;

  if (bate) {
    return {
      origem: 'nota',
      parcelas: duplicatas.map((d, i) => ({
        numero: i + 1,
        valor: Number(d.valor),
        vencimento: String(d.vencimento).slice(0, 10),
      })),
    };
  }

  return {
    origem: temDuplicatas ? 'manual_divergencia' : 'manual',
    parcelas: gerarParcelas(dataBase, valorLancado, numeroParcelas, intervaloDias),
  };
}
