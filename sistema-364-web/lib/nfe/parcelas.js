// Escolhe entre os vencimentos reais da nota e o parcelamento manual.
//
// Três coisas tiram as duplicatas do fornecedor de cena:
//
// 1. Item fora do aceite (rejeitado, quarentena, devolvido, pendente). Aí o que se
//    deve ao fornecedor não é mais o que ele faturou, e quem decide isso é a tela,
//    que conhece o status de cada item — não uma comparação de valores.
// 2. Divergência de valor grande demais. A comparação é contra a SOMA DOS ITENS da
//    nota (Σ vProd), nunca contra o vNF: o vNF carrega frete, IPI e ST, que não
//    entram no custo dos itens conferidos, e uma nota com frete nunca bateria.
//    A tolerância é relativa (0,5%) porque carne vendida por quilo sempre pesa um
//    pouco diferente do que a nota diz — essa divergência é esperada e fica visível
//    na tela; o que não pode passar é a nota errada.
// 3. Duplicata sem vencimento utilizável. dVenc é opcional no layout 4.00 e
//    contas_a_pagar_parcelas.vencimento é NOT NULL: gravar assim derruba a conta a
//    pagar inteira, então é melhor cair no parcelamento informado e avisar.
import { gerarParcelas } from '../financeiro.js';

// Um lugar só para os motivos, para a tela conseguir dizer o que de fato aconteceu.
export const ORIGEM_PARCELAS = {
  NOTA: 'nota',
  MANUAL: 'manual',
  MANUAL_ITEM_NAO_ACEITO: 'manual_item_nao_aceito',
  MANUAL_VALOR_DIVERGENTE: 'manual_valor_divergente',
  MANUAL_VENCIMENTO_INVALIDO: 'manual_vencimento_invalido',
};

// Aviso que a tela mostra para cada motivo. 'nota' e 'manual' não avisam nada:
// um seguiu os vencimentos do fornecedor, o outro é o fluxo normal sem nota.
export const AVISO_PARCELAS = {
  [ORIGEM_PARCELAS.MANUAL_ITEM_NAO_ACEITO]:
    'Há item que não entrou no aceite (rejeitado, em quarentena, devolvido ou pendente), '
    + 'então o valor devido deixou de ser o da nota e as parcelas seguiram a condição de pagamento informada, '
    + 'e não os vencimentos do fornecedor.',
  [ORIGEM_PARCELAS.MANUAL_VALOR_DIVERGENTE]:
    'O total conferido ficou mais de 0,5% distante da soma dos itens da nota, '
    + 'então as parcelas seguiram a condição de pagamento informada, e não os vencimentos do fornecedor. '
    + 'Confira os pesos lançados antes de pagar.',
  [ORIGEM_PARCELAS.MANUAL_VENCIMENTO_INVALIDO]:
    'Alguma duplicata da nota veio sem data de vencimento (ou com data ilegível), '
    + 'então as parcelas seguiram a condição de pagamento informada. '
    + 'Ajuste os vencimentos em Financeiro se o fornecedor tiver combinado outras datas.',
};

const TOLERANCIA_RELATIVA = 0.005; // 0,5% da soma dos itens da nota
const TOLERANCIA_MINIMA = 0.01;    // piso de um centavo, para nota de valor baixo

// contas_a_pagar_parcelas.vencimento é `date not null` — só serve o que o Postgres
// aceita como data ISO.
function vencimentoUsavel(valor) {
  const v = String(valor ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  return !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime());
}

export function parcelasDoRecebimento({
  duplicatas, dataBase, valorLancado, somaItensNota,
  temItemNaoAceito = false, numeroParcelas = 1, intervaloDias = 30,
}) {
  const manual = origem => ({
    origem,
    parcelas: gerarParcelas(dataBase, valorLancado, numeroParcelas, intervaloDias),
  });

  if (!Array.isArray(duplicatas) || duplicatas.length === 0) {
    return manual(ORIGEM_PARCELAS.MANUAL);
  }
  if (temItemNaoAceito) {
    return manual(ORIGEM_PARCELAS.MANUAL_ITEM_NAO_ACEITO);
  }
  if (!duplicatas.every(d => vencimentoUsavel(d.vencimento))) {
    return manual(ORIGEM_PARCELAS.MANUAL_VENCIMENTO_INVALIDO);
  }

  const soma = Number(somaItensNota);
  const tolerancia = Math.max(Math.abs(soma) * TOLERANCIA_RELATIVA, TOLERANCIA_MINIMA);
  if (!Number.isFinite(soma) || Math.abs(Number(valorLancado) - soma) > tolerancia) {
    return manual(ORIGEM_PARCELAS.MANUAL_VALOR_DIVERGENTE);
  }

  return {
    origem: ORIGEM_PARCELAS.NOTA,
    parcelas: duplicatas.map((d, i) => ({
      numero: i + 1,
      valor: Number(d.valor),
      vencimento: String(d.vencimento).slice(0, 10),
    })),
  };
}
