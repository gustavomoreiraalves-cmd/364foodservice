// Agregações da tela Vendas PDV. Funções puras sobre as linhas que o
// Supabase devolve (views e tabela de itens). Sem React, sem rede.

export const ROTULOS_FORMA = {
  pix: 'Pix', credito: 'Cartão de crédito', debito: 'Cartão de débito', dinheiro: 'Dinheiro',
  ifood_online: 'iFood online', voucher: 'Vale/voucher', fiado: 'Fiado', outro: 'Outros',
};

const iso = d => d.toISOString().slice(0, 10);
const dataUtc = s => new Date(s + 'T00:00:00Z');
const somaDias = (s, dias) => iso(new Date(dataUtc(s).getTime() + dias * 86400000));
const div = (a, b) => (b ? a / b : 0);
const n = v => Number(v) || 0;
// Porto Velho é UTC-4 o ano todo (sem horário de verão). "Hoje" da tela
// precisa ser o dia local, não o dia UTC — depois das 20h local já é
// amanhã em UTC, e o mês corrente sumiria do período padrão.
const FUSO_MS = 4 * 36e5;

export function periodoPadrao(agora = new Date()) {
  const ate = iso(new Date(agora.getTime() - FUSO_MS));
  return { de: ate.slice(0, 8) + '01', ate };
}

export function periodoAnterior({ de, ate }) {
  const dias = Math.round((dataUtc(ate) - dataUtc(de)) / 86400000) + 1;
  const novoAte = somaDias(de, -1);
  return { de: somaDias(novoAte, -(dias - 1)), ate: novoAte };
}

export function kpis(linhas) {
  let faturamento = 0, pedidos = 0, itens = 0, delivery = 0;
  for (const l of linhas) {
    faturamento += n(l.valor_total);
    pedidos += n(l.qtd_pedidos);
    itens += n(l.qtd_itens);
    if (l.tipo === 'delivery') delivery += n(l.valor_total);
  }
  return {
    faturamento, pedidos,
    ticketMedio: div(faturamento, pedidos),
    itensPorPedido: div(itens, pedidos),
    pctDelivery: div(delivery, faturamento) * 100,
  };
}

export function variacao(atual, anterior) {
  if (!anterior) return null;
  return (atual - anterior) / anterior * 100;
}

export function porDia(linhas) {
  const mapa = new Map();
  for (const l of linhas) {
    const d = mapa.get(l.dia) || { dia: l.dia, mesa: 0, delivery: 0, outro: 0, total: 0, pedidos: 0, ticket: 0 };
    d[l.tipo in d ? l.tipo : 'outro'] += n(l.valor_total);
    d.total += n(l.valor_total);
    d.pedidos += n(l.qtd_pedidos);
    mapa.set(l.dia, d);
  }
  return [...mapa.values()].sort((a, b) => a.dia.localeCompare(b.dia)).map(d => ({ ...d, ticket: div(d.total, d.pedidos) }));
}

export function porOrigem(linhas) {
  const mapa = new Map();
  let total = 0;
  for (const l of linhas) {
    const o = mapa.get(l.origem) || { origem: l.origem || '(sem origem)', pedidos: 0, valor: 0 };
    o.pedidos += n(l.qtd_pedidos);
    o.valor += n(l.valor_total);
    total += n(l.valor_total);
    mapa.set(l.origem, o);
  }
  return [...mapa.values()].sort((a, b) => b.valor - a.valor).map(o => ({ ...o, pct: div(o.valor, total) * 100 }));
}

export function porForma(linhas) {
  const mapa = new Map();
  const total = { qtd: 0, bruto: 0, taxa: 0, liquido: 0 };
  for (const l of linhas) {
    const g = l.forma_grupo || 'outro';
    const f = mapa.get(g) || { formaGrupo: g, rotulo: ROTULOS_FORMA[g] || g, qtd: 0, bruto: 0, taxa: 0, liquido: 0 };
    f.qtd += n(l.qtd); f.bruto += n(l.valor_bruto); f.taxa += n(l.taxa); f.liquido += n(l.valor_liquido);
    total.qtd += n(l.qtd); total.bruto += n(l.valor_bruto); total.taxa += n(l.taxa); total.liquido += n(l.valor_liquido);
    mapa.set(g, f);
  }
  return { linhas: [...mapa.values()].sort((a, b) => b.bruto - a.bruto), total };
}

export function itensPeriodo(linhas) {
  const mapa = new Map();
  for (const l of linhas) {
    const i = mapa.get(l.codigo_detalhe) || { codigoDetalhe: l.codigo_detalhe, nome: l.nome, categoria: l.categoria, quantidade: 0, valor: 0, lucro: 0 };
    i.quantidade += n(l.quantidade); i.valor += n(l.valor_vendido); i.lucro += n(l.lucro);
    mapa.set(l.codigo_detalhe, i);
  }
  const lista = [...mapa.values()].sort((a, b) => b.valor - a.valor);
  const total = lista.reduce((s, i) => s + i.valor, 0);
  let acumulado = 0;
  return lista.map(i => {
    const antes = div(acumulado, total) * 100;
    acumulado += i.valor;
    return { ...i, margem: div(i.lucro, i.valor) * 100, pct: div(i.valor, total) * 100, abc: antes < 80 ? 'A' : antes < 95 ? 'B' : 'C' };
  });
}

export function statusImportacao(ultima, agora = new Date()) {
  if (!ultima) return { texto: 'Nenhuma importação registrada', alerta: true };
  const quando = new Date(ultima.iniciado_em);
  const horas = (agora - quando) / 36e5;
  const local = new Date(quando.getTime() - FUSO_MS);
  const dd = String(local.getUTCDate()).padStart(2, '0');
  const mm = String(local.getUTCMonth() + 1).padStart(2, '0');
  const hh = String(local.getUTCHours()).padStart(2, '0');
  const mi = String(local.getUTCMinutes()).padStart(2, '0');
  const texto = `Última importação: ${dd}/${mm}/${local.getUTCFullYear()} ${hh}:${mi} · ${ultima.status}`;
  // 'executando' que não fecha em 1 h é rodada travada: o processo morreu sem
  // atualizar o log e a tela mostraria "em andamento" para sempre.
  const travada = ultima.status === 'executando' && horas > 1;
  return { texto, alerta: ultima.status === 'erro' || travada || horas > 36 };
}
