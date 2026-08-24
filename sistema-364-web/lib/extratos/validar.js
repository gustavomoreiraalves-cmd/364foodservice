// Conferência aritmética do arquivo lido. Não bloqueia a importação — só
// levanta a mão: se o saldo não fecha, alguma linha ficou de fora (página
// cortada no PDF, layout novo) e o colaborador precisa saber antes de
// conciliar. Extrato sem saldo inicial (OFX, CSV) não tem como ser conferido.
const TOLERANCIA = 0.01;

function fmt(n) {
  return Number(n).toFixed(2).replace('.', ',');
}

function soma(lancamentos) {
  return (lancamentos || []).reduce(
    (t, l) => t + (l.tipo === 'entrada' ? Number(l.valor) : -Number(l.valor)), 0);
}

export function validarExtrato({ saldoInicial, saldoFinal, lancamentos }) {
  if (saldoInicial == null || saldoFinal == null) return { ok: true, alerta: null };
  const movimento = soma(lancamentos);
  const esperado = Number(saldoFinal) - Number(saldoInicial);
  const diferenca = Math.abs(movimento - esperado);
  if (diferenca <= TOLERANCIA) return { ok: true, alerta: null };
  return {
    ok: false,
    alerta: `O extrato não fecha: a soma dos lançamentos dá R$ ${fmt(movimento)} e a `
      + `diferença entre os saldos é R$ ${fmt(esperado)} (sobrou R$ ${fmt(diferenca)}). `
      + `Confira se alguma linha ficou de fora antes de conciliar.`,
  };
}

export function validarFatura({ total, lancamentos }) {
  if (total == null) return { ok: true, alerta: null };
  const somaLinhas = (lancamentos || []).reduce(
    (t, l) => t + (l.tipo === 'entrada' ? -Number(l.valor) : Number(l.valor)), 0);
  const diferenca = Math.abs(somaLinhas - Number(total));
  if (diferenca <= TOLERANCIA) return { ok: true, alerta: null };
  return {
    ok: false,
    alerta: `A fatura não fecha: as linhas somam R$ ${fmt(somaLinhas)} e o total informado é `
      + `R$ ${fmt(total)} (diferença de R$ ${fmt(diferenca)}).`,
  };
}
