// Leitura do que o Consumer Connect devolve: datas no formato .NET e em
// dd/mm/aaaa, dinheiro em R$, e os fragmentos HTML dos modais de pedido e de
// caixa. Só funções puras — nada de rede nem banco aqui.
//
// Fuso: o PDV está em Ji-Paraná (America/Porto_Velho, UTC-4, sem horário de
// verão). O Connect manda a hora local como se fosse UTC, tanto em
// `/Date(ms)/` quanto no texto. Corrigimos somando 4 horas.
import { load } from 'cheerio';

export const FUSO_MS = 4 * 60 * 60 * 1000;

export function dataConnect(str) {
  const m = /\/Date\((-?\d+)\)\//.exec(str || '');
  if (!m) return null;
  return new Date(Number(m[1]) + FUSO_MS);
}

export function diaLocalConnect(str) {
  const m = /\/Date\((-?\d+)\)\//.exec(str || '');
  if (!m) return null;
  return new Date(Number(m[1])).toISOString().slice(0, 10);
}

export function dataBr(str) {
  const s = (str || '').trim();
  const m = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (!m) return null;
  const [, d, mo, y, h = '0', mi = '0', se = '0'] = m;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +se) + FUSO_MS);
}

export function diaLocal(date) {
  return new Date(date.getTime() - FUSO_MS).toISOString().slice(0, 10);
}

export function dinheiro(str) {
  const s = (str || '').replace(/[^\d,.-]/g, '');
  if (!s) return null;
  return Number(s.replace(/\./g, '').replace(',', '.'));
}

export function quantidade(str) {
  return dinheiro(str) ?? 0;
}

function limpo(texto) {
  return (texto || '').replace(/\s+/g, ' ').trim();
}

// Lê os pares <small>Rótulo</small><h6>valor</h6> do cabeçalho dos modais.
function campos($, raiz) {
  const out = {};
  $(raiz).find('small.text-muted').each((_, el) => {
    const rotulo = limpo($(el).text());
    const h6 = $(el).next('h6');
    out[rotulo] = h6.length ? h6 : null;
  });
  return out;
}

export function parsePedidoDetalhe(html) {
  const $ = load(html);
  const c = campos($, '.modal-body > .row');

  const codigoH6 = c['Código'];
  const codigo = Number(limpo(codigoH6.clone().children().remove().end().text()));
  const origem = limpo(codigoH6.find('.badge').text()) || null;
  const tipoOriginal = limpo(c['Tipo'].text());
  const status = limpo(c['Status'].text());
  const numero = c['Número'] ? Number(limpo(c['Número'].text())) || null : null;
  const abertoEm = dataBr(limpo(c['Abertura']?.text()));
  const fechadoEm = c['Fechamento'] ? dataBr(limpo(c['Fechamento'].text())) : null;
  const colaborador = c['Colaborador'] ? limpo(c['Colaborador'].text()) || null : null;

  const itens = [];
  let paiAtual = null;
  $('table.tabela-pedido-itens tbody tr').each((_, tr) => {
    const $tr = $(tr);
    if ($tr.hasClass('linha-subtotal')) return;
    const tds = $tr.children('td');
    const nomeTd = tds.eq(0).clone();
    const observacao = limpo(nomeTd.find('i.small').text()) || null;
    nomeTd.find('i').remove();
    nomeTd.find('br').remove();
    const nome = limpo(nomeTd.text());
    const posicao = itens.length + 1;
    const ehPai = $tr.hasClass('linha-pai');
    if (ehPai) paiAtual = posicao;
    itens.push({
      posicao, nome, observacao,
      quantidade: quantidade(tds.eq(2).text()),
      precoUnitario: dinheiro(tds.eq(1).text()),
      valor: dinheiro(tds.eq(3).text()),
      itemPaiPosicao: ehPai ? null : paiAtual,
      ehCombo: false,
    });
  });
  // Pai que tem filho é combo/personalizado: marca depois de ler todos.
  for (const it of itens) {
    if (it.itemPaiPosicao) itens[it.itemPaiPosicao - 1].ehCombo = true;
  }

  const t = campos($, '#pedpagamento .row');
  const totais = {
    valorTotal: t['Valor Total'] ? dinheiro(t['Valor Total'].text()) : null,
    valorDesconto: t['Valor Desc.'] ? dinheiro(t['Valor Desc.'].text()) : null,
    valorItens: t['Valor Itens'] ? dinheiro(t['Valor Itens'].text()) : null,
    valorEntrega: t['Valor Entrega'] ? dinheiro(t['Valor Entrega'].text()) : null,
    valorServico: t['Valor Serviço'] ? dinheiro(t['Valor Serviço'].text()) : null,
    valorAcrescimo: t['Valor Acréscimo'] ? dinheiro(t['Valor Acréscimo'].text()) : null,
  };

  const pagamentos = [];
  $('#pedpagamento table tbody tr').each((_, tr) => {
    const tds = $(tr).children('td');
    pagamentos.push({
      posicao: pagamentos.length + 1,
      valor: dinheiro(tds.eq(0).text()),
      forma: limpo(tds.eq(1).text()) || null,
      operadora: limpo(tds.eq(2).text()) || null,
      pagoEm: dataBr(limpo(tds.eq(3).text())),
    });
  });

  return { codigo, origem, tipoOriginal, status, numero, abertoEm, fechadoEm, colaborador, itens, totais, pagamentos };
}

export function parseCaixaDetalhe(html) {
  const $ = load(html);
  const c = campos($, '.modal-body > .row');
  const codigo = Number(limpo(c['ID'].text()));
  const usuario = limpo(c['Usuário'].text()) || null;
  const status = limpo(c['Status'].text()) || null;
  const aberturaH6 = c['Abertura'];
  const abertoEm = dataBr(limpo(aberturaH6.text()));
  const saldoInicial = dinheiro(aberturaH6.next('h6').text());
  const totalDinheiro = c['Total em Dinheiro'] ? dinheiro(c['Total em Dinheiro'].text()) : null;

  const movimentos = [];
  let saldoAtual = null;
  $('#table-movimentacoes-caixa tbody tr').each((_, tr) => {
    const tds = $(tr).children('td');
    const opTd = tds.eq(0);
    const operacao = limpo(opTd.text());
    if (operacao === 'Saldo Atual') {
      saldoAtual = dinheiro(tds.eq(3).text());
      return;
    }
    const origem = limpo(tds.eq(1).text()) || null;
    const ped = /Pedido\s+(\d+)/.exec(origem || '');
    movimentos.push({
      posicao: movimentos.length + 1,
      operacao,
      origem,
      pedidoCodigo: ped ? Number(ped[1]) : null,
      momento: dataBr(limpo(tds.eq(2).text())),
      entrada: dinheiro(tds.eq(3).text()),
      saida: dinheiro(tds.eq(4).text()),
      meio: limpo(tds.eq(5).text()) || null,
      observacao: opTd.find('a[data-content]').attr('data-content') || null,
    });
  });

  return { codigo, usuario, status, abertoEm, saldoInicial, totalDinheiro, movimentos, saldoAtual };
}
