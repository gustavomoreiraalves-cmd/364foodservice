'use client';

// Apuração da jornada: compara marcações reais contra a escala vigente,
// dia a dia, aplicando tolerância — nunca persistida como fonte de
// verdade, é recalculada sob demanda a partir de dados imutáveis
// (ponto_marcacoes) + escalas + ajustes retroativos.
// Limitação conhecida: não trata escalas cujo horário cruza a meia-noite
// (turno começa num dia e termina no seguinte) — nenhuma escala cadastrada
// no sistema hoje faz isso.

export const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

function minutosDoDia(hhmmss) {
  if (!hhmmss) return null;
  const [h, m] = hhmmss.split(':').map(Number);
  return h * 60 + m;
}

function minutosDoTimestamp(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  return d.getHours() * 60 + d.getMinutes();
}

function diaISO(d) {
  return d.toISOString().slice(0, 10);
}

export function* diasEntre(de, ate) {
  const cursor = new Date(de + 'T12:00:00');
  const fim = new Date(ate + 'T12:00:00');
  while (cursor <= fim) {
    yield diaISO(cursor);
    cursor.setDate(cursor.getDate() + 1);
  }
}

// escala vigente do colaborador num dia, a partir das linhas de colaborador_escalas
function escalaVigente(colaboradorEscalas, colaboradorId, dia) {
  return colaboradorEscalas.find(ce => ce.colaborador_id === colaboradorId
    && ce.data_inicio <= dia && (!ce.data_fim || ce.data_fim >= dia));
}

function posicaoNoDia(escala, vigencia, dia) {
  if (escala.tipo === '12x36') {
    const ancora = new Date((vigencia.data_referencia_ciclo || vigencia.data_inicio) + 'T12:00:00');
    const alvo = new Date(dia + 'T12:00:00');
    const diff = Math.round((alvo - ancora) / 86400000);
    const ciclo = escala.ciclo_dias || 2;
    return ((diff % ciclo) + ciclo) % ciclo;
  }
  return new Date(dia + 'T12:00:00').getDay();
}

// Calcula um dia de apuração para um colaborador. Retorna null se o
// colaborador não tinha escala vigente naquele dia (fora do vínculo).
export function apurarDia({ colaboradorId, dia, colaboradorEscalas, escalas, escalaDias, marcacoes, ajustes }) {
  const vigencia = escalaVigente(colaboradorEscalas, colaboradorId, dia);
  if (!vigencia) return null;
  const escala = escalas.find(e => e.id === vigencia.escala_id);
  if (!escala) return null;
  const pos = posicaoNoDia(escala, vigencia, dia);
  const ed = escalaDias.find(d => d.escala_id === escala.id && d.dia === pos);
  const trabalha = !!ed?.trabalha;

  const ajustesDoDia = ajustes.filter(a => a.colaborador_id === colaboradorId && a.dia === dia);
  const faltaAbonada = ajustesDoDia.some(a => a.tipo === 'falta_abonada');
  const compensacaoManual = ajustesDoDia
    .filter(a => a.tipo === 'compensacao_manual')
    .reduce((s, a) => s + (a.minutos_ajuste || 0), 0);
  const retroativos = Object.fromEntries(
    ajustesDoDia.filter(a => a.tipo === 'marcacao_retroativa').map(a => [a.marcacao_tipo, a.horario])
  );

  function horarioReal(tipo) {
    if (retroativos[tipo]) return minutosDoDia(retroativos[tipo]);
    const doDia = marcacoes.filter(m => m.colaborador_id === colaboradorId
      && m.tipo === tipo && m.data_hora_local.slice(0, 10) === dia);
    if (!doDia.length) return null;
    // primeira entrada/início de intervalo do dia; última saída/fim de intervalo
    const ordenadas = doDia.slice().sort((a, b) => a.data_hora_local.localeCompare(b.data_hora_local));
    const pega = (tipo === 'saida' || tipo === 'intervalo_fim') ? ordenadas[ordenadas.length - 1] : ordenadas[0];
    return minutosDoTimestamp(pega.data_hora_local);
  }

  const previstoEntrada = minutosDoDia(ed?.entrada);
  const previstoSaida = minutosDoDia(ed?.saida);
  const previstoIntInicio = minutosDoDia(ed?.intervalo_inicio);
  const previstoIntFim = minutosDoDia(ed?.intervalo_fim);
  const tolerancia = escala.tolerancia_minutos || 0;

  const previstoMinutos = trabalha && previstoEntrada != null && previstoSaida != null
    ? Math.max(0, previstoSaida - previstoEntrada - Math.max(0, (previstoIntFim ?? 0) - (previstoIntInicio ?? 0)))
    : 0;

  const entradaReal = horarioReal('entrada');
  const saidaReal = horarioReal('saida');
  const intInicioReal = horarioReal('intervalo_inicio');
  const intFimReal = horarioReal('intervalo_fim');

  const falta = trabalha && entradaReal == null && !faltaAbonada;

  let trabalhadoMinutos = 0;
  let atrasoMinutos = 0;
  let saidaAntecipadaMinutos = 0;
  let extraMinutos = 0;

  if (trabalha && entradaReal != null && saidaReal != null) {
    const intervaloReal = (intInicioReal != null && intFimReal != null)
      ? Math.max(0, intFimReal - intInicioReal)
      : Math.max(0, (previstoIntFim ?? 0) - (previstoIntInicio ?? 0));
    trabalhadoMinutos = Math.max(0, saidaReal - entradaReal - intervaloReal);
    if (previstoEntrada != null) atrasoMinutos = Math.max(0, entradaReal - previstoEntrada - tolerancia);
    if (previstoSaida != null) {
      saidaAntecipadaMinutos = Math.max(0, previstoSaida - saidaReal - tolerancia);
      extraMinutos = Math.max(0, saidaReal - previstoSaida - tolerancia);
    }
  }

  let saldoMinutos;
  if (falta) saldoMinutos = -previstoMinutos;
  else if (!trabalha) saldoMinutos = 0;
  else if (faltaAbonada) saldoMinutos = 0;
  else saldoMinutos = trabalhadoMinutos - previstoMinutos;
  saldoMinutos += compensacaoManual;

  return {
    colaboradorId, dia, escalaId: escala.id, escalaTipo: escala.tipo, trabalha,
    previstoEntrada: ed?.entrada || null, previstoIntInicio: ed?.intervalo_inicio || null,
    previstoIntFim: ed?.intervalo_fim || null, previstoSaida: ed?.saida || null, previstoMinutos,
    entradaReal, saidaReal, intInicioReal, intFimReal, trabalhadoMinutos,
    atrasoMinutos, saidaAntecipadaMinutos, extraMinutos, saldoMinutos,
    falta, faltaAbonada, ajustado: ajustesDoDia.length > 0, ajustes: ajustesDoDia,
  };
}

export function apurarPeriodo({ colaboradorIds, de, ate, colaboradorEscalas, escalas, escalaDias, marcacoes, ajustes }) {
  const linhas = [];
  for (const colaboradorId of colaboradorIds) {
    for (const dia of diasEntre(de, ate)) {
      const linha = apurarDia({ colaboradorId, dia, colaboradorEscalas, escalas, escalaDias, marcacoes, ajustes });
      if (linha) linhas.push(linha);
    }
  }
  return linhas;
}

export function resumo(linhas) {
  return linhas.reduce((r, l) => ({
    previstoMinutos: r.previstoMinutos + l.previstoMinutos,
    trabalhadoMinutos: r.trabalhadoMinutos + l.trabalhadoMinutos,
    atrasoMinutos: r.atrasoMinutos + l.atrasoMinutos,
    extraMinutos: r.extraMinutos + l.extraMinutos,
    saldoMinutos: r.saldoMinutos + l.saldoMinutos,
    diasFalta: r.diasFalta + (l.falta ? 1 : 0),
    diasTrabalhados: r.diasTrabalhados + (l.trabalha ? 1 : 0),
  }), { previstoMinutos: 0, trabalhadoMinutos: 0, atrasoMinutos: 0, extraMinutos: 0, saldoMinutos: 0, diasFalta: 0, diasTrabalhados: 0 });
}

// "HH:MM" (aceita negativo, ex.: saldo -95 -> "-1:35")
export function fmtMinutos(min) {
  const sinal = min < 0 ? '-' : '';
  const abs = Math.abs(Math.round(min));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sinal}${h}:${String(m).padStart(2, '0')}`;
}
