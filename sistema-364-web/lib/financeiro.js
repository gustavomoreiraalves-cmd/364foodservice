import { hoje } from './format.js';

export const CATEGORIAS_CONTA = ['Custos Fixos', 'Custos Diretos', 'Custos Variáveis', 'Investimentos'];

export const FORMAS_PAGAMENTO = ['Pix', 'Boleto', 'Transferência', 'Dinheiro'];

function somarDias(dataStr, dias) {
  const d = new Date(dataStr);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// Divide um valor total em N parcelas com vencimentos espaçados por
// `intervaloDias`, contando a partir de `dataBase` (data da nota/lançamento).
// N=1 é "à vista": vence na própria dataBase, `intervaloDias` é ignorado.
// A última parcela absorve o resto do arredondamento de centavos, pra soma
// bater exatamente com `valorTotal`.
export function gerarParcelas(dataBase, valorTotal, numeroParcelas = 1, intervaloDias = 30) {
  const n = Math.max(1, Number(numeroParcelas) || 1);
  const valorParcela = Math.round((Number(valorTotal) / n) * 100) / 100;
  const parcelas = [];
  let somaAnteriores = 0;
  for (let i = 1; i <= n; i++) {
    const valor = i < n ? valorParcela : Math.round((Number(valorTotal) - somaAnteriores) * 100) / 100;
    somaAnteriores += valor;
    const vencimento = n === 1 ? dataBase : somarDias(dataBase, i * Number(intervaloDias));
    parcelas.push({ numero: i, valor, vencimento });
  }
  return parcelas;
}

// Uma parcela pendente cujo vencimento já passou é "vencida" — não é um
// status gravado no banco (evita depender de job agendado pra atualizar
// linha), é derivado aqui a partir da data de hoje.
export function isVencida(parcela) {
  return parcela.status === 'Pendente' && parcela.vencimento < hoje();
}
