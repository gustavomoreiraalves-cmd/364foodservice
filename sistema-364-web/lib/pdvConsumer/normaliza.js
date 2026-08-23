// Transforma o que o parse.js devolve em linhas prontas para as tabelas
// pdv_* (nomes de coluna do banco). Funções puras.
import { dataConnect, diaLocalConnect, diaLocal } from './parse.js';

export function classificaTipo(tipoOriginal) {
  const t = (tipoOriginal || '').toLowerCase();
  if (t.includes('mesa') || t.includes('comanda')) return 'mesa';
  if (t.includes('delivery')) return 'delivery';
  return 'outro';
}

// Operadoras conhecidas, para separar "Cartão de Crédito Mastercard" no
// texto único do caixa. Telefone de Pix entra pelo regex.
const OPERADORAS = ['Mastercard', 'Visa', 'Elo', 'Amex', 'Hipercard', 'Voucher', 'Outros'];

export function separaMeio(meio) {
  const s = (meio || '').trim();
  if (!s) return { forma: null, operadora: null };
  const tel = /\s(\(\d{2}\)\s?\d{4,5}-?\d{4})$/.exec(s);
  if (tel) return { forma: s.slice(0, tel.index).trim(), operadora: tel[1] };
  for (const op of OPERADORAS) {
    if (s.endsWith(' ' + op)) return { forma: s.slice(0, -op.length).trim(), operadora: op };
  }
  return { forma: s, operadora: null };
}

export function classificaForma(forma, operadora) {
  const f = (forma || '').toLowerCase();
  const o = (operadora || '').toLowerCase();
  if (f.includes('ifood')) return 'ifood_online';
  if (f.includes('pix')) return 'pix';
  if (f.includes('crédito') || f.includes('credito')) return 'credito';
  if (f.includes('débito') || f.includes('debito')) return 'debito';
  if (f.includes('dinheiro')) return 'dinheiro';
  if (f.includes('fiado') || f.includes('conta corrente')) return 'fiado';
  if (f.includes('vale') || f.includes('voucher') || o === 'voucher') return 'voucher';
  return 'outro';
}

const iso = d => (d ? d.toISOString() : null);
const num = v => (v === null || v === undefined || v === '' ? null : Number(v));

export function pedidoMudou(linha, existente) {
  if (!existente) return true;
  if ((existente.status || null) !== (linha.Status || null)) return true;
  if (Number(existente.valor_total) !== Number(linha.ValorTotal)) return true;
  const exclLinha = iso(dataConnect(linha.DataHoraExclusao));
  const exclBanco = existente.excluido_em ? new Date(existente.excluido_em).toISOString() : null;
  if (exclLinha !== exclBanco) return true;
  const fechLinha = iso(dataConnect(linha.DataHoraFechamento));
  const fechBanco = existente.fechado_em ? new Date(existente.fechado_em).toISOString() : null;
  return fechLinha !== fechBanco;
}

export function normalizaPedido({ linha, detalhe, empresaId }) {
  const status = detalhe?.status || linha.Status || null;
  const abertoEm = dataConnect(linha.DataHoraAbertura) || detalhe?.abertoEm;
  const pedido = {
    empresa_id: empresaId,
    codigo: Number(linha.Codigo),
    id_connect: num(linha.ID),
    tipo: classificaTipo(detalhe?.tipoOriginal || linha.Tipo),
    tipo_original: detalhe?.tipoOriginal || linha.Tipo || null,
    origem: detalhe?.origem || linha.Origem || null,
    status,
    finalizado: /^finalizado/i.test(status || ''),
    cliente: linha.NomeCliente || null,
    numero: detalhe?.numero ?? (linha.Numero ? Number(linha.Numero) : null),
    colaborador: detalhe?.colaborador || null,
    qtd_itens: num(linha.QtdItens),
    valor_total: detalhe?.totais?.valorTotal ?? Number(linha.ValorTotal || 0),
    valor_itens: detalhe?.totais?.valorItens ?? null,
    valor_desconto: detalhe?.totais?.valorDesconto ?? null,
    valor_entrega: detalhe?.totais?.valorEntrega ?? null,
    valor_servico: detalhe?.totais?.valorServico ?? null,
    valor_acrescimo: detalhe?.totais?.valorAcrescimo ?? null,
    aberto_em: iso(abertoEm),
    fechado_em: iso(dataConnect(linha.DataHoraFechamento) || detalhe?.fechadoEm || null),
    dia_venda: diaLocalConnect(linha.DataHoraAbertura) || diaLocal(abertoEm),
    excluido_em: iso(dataConnect(linha.DataHoraExclusao)),
    origem_raw: linha,
    origem_html: detalhe?.html ?? null,
  };
  const itens = (detalhe?.itens || []).map(i => ({
    empresa_id: empresaId,
    posicao: i.posicao,
    nome: i.nome,
    observacao: i.observacao,
    quantidade: i.quantidade,
    preco_unitario: i.precoUnitario,
    valor: i.valor,
    item_pai_posicao: i.itemPaiPosicao,
    eh_combo: i.ehCombo,
  }));
  const pagamentos = (detalhe?.pagamentos || []).map(p => ({
    empresa_id: empresaId,
    posicao: p.posicao,
    valor: p.valor,
    forma: p.forma,
    operadora: p.operadora,
    forma_grupo: classificaForma(p.forma, p.operadora),
    pago_em: iso(p.pagoEm),
  }));
  return { pedido, itens, pagamentos };
}

export function normalizaCaixa({ linha, detalhe, empresaId }) {
  const abertoEm = dataConnect(linha.DataHoraAbertura) || detalhe?.abertoEm;
  const caixa = {
    empresa_id: empresaId,
    codigo: Number(linha.Codigo),
    id_connect: num(linha.ID),
    usuario: linha.NomeUsuario || detalhe?.usuario || null,
    status: linha.StatusCaixa || detalhe?.status || null,
    aberto_em: iso(abertoEm),
    fechado_em: iso(dataConnect(linha.DataHoraFechamento)),
    dia_caixa: diaLocalConnect(linha.DataHoraAbertura) || diaLocal(abertoEm),
    saldo_inicial: num(linha.SaldoInicial) ?? detalhe?.saldoInicial ?? null,
    saldo_final: num(linha.SaldoFinal) ?? detalhe?.saldoAtual ?? null,
    total_dinheiro: detalhe?.totalDinheiro ?? num(linha.ValorTotalDinheiro),
    observacao: linha.Observacao || null,
    origem_raw: linha,
    origem_html: detalhe?.html ?? null,
  };
  const movimentos = (detalhe?.movimentos || []).map(m => {
    const { forma, operadora } = separaMeio(m.meio);
    return {
      empresa_id: empresaId,
      posicao: m.posicao,
      operacao: m.operacao,
      origem: m.origem,
      pedido_codigo: m.pedidoCodigo,
      momento: iso(m.momento),
      entrada: m.entrada,
      saida: m.saida,
      forma,
      operadora,
      forma_grupo: classificaForma(forma, operadora),
      observacao: m.observacao,
    };
  });
  return { caixa, movimentos };
}

export function normalizaRecebimento(linha, empresaId) {
  const pagoEm = dataConnect(linha.DataHoraPagamento);
  return {
    empresa_id: empresaId,
    pedido_codigo: num(linha.PedidoCodigo),
    caixa_codigo: num(linha.CaixaCodigo),
    categoria: linha.CategoriaContaText || null,
    forma: linha.FormaPagamentoText || null,
    operadora: linha.OperadoraCartaoText || null,
    forma_grupo: classificaForma(linha.FormaPagamentoText, linha.OperadoraCartaoText),
    valor: Number(linha.Valor || 0),
    valor_liquido: num(linha.ValorLiquido),
    percentual_taxa: num(linha.PercentualTaxa),
    parcela: num(linha.NumeroParcela),
    pago_em: iso(pagoEm),
    dia_pagamento: diaLocalConnect(linha.DataHoraPagamento),
    credito_em: diaLocalConnect(linha.DataCreditoID),
    observacao: linha.Observacao || null,
    origem_raw: linha,
  };
}

export function normalizaItemDia(linha, dia, empresaId) {
  return {
    empresa_id: empresaId,
    dia,
    codigo_produto: num(linha.CodigoProduto),
    codigo_detalhe: Number(linha.CodigoProdutoDetalhe),
    nome: linha.Nome,
    categoria: linha.DescricaoCategoria || null,
    quantidade: Number(linha.QuantidadeVendida || 0),
    valor_vendido: Number(linha.ValorVendido || 0),
    preco_venda: num(linha.PrecoVenda),
    preco_custo: num(linha.PrecoCusto),
    custo_medio: num(linha.CustoMedio),
    lucro: num(linha.Lucro),
    margem: num(linha.MargemLucro),
    participacao_lucro: num(linha.PercentualParticipacaoNoLucro),
    curva_abc: linha.ClassificacaoAbc || null,
    origem_raw: linha,
  };
}
