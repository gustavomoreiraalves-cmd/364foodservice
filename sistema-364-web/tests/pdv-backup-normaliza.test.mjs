import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  dataFirebird, diaFirebird, tipoOriginalFb,
  normalizaPedidoFb, normalizaCaixaFb, normalizaRecebimentoFb, itensDiaFb,
} from '../lib/pdvBackup/normaliza.js';

const json = nome => JSON.parse(readFileSync(new URL(`./fixtures/pdv-backup/${nome}`, import.meta.url), 'utf8'));
const EMPRESA = '0dda3c8e-228b-4d05-b50a-2e2f301d75a3';

const PEDIDOS = json('pedidos.json');
const ITENS = json('itens.json');
const PAGAMENTOS = json('pagamentos.json');
const RECEBIMENTOS = json('recebimentos.json');
const CAIXAS = json('caixas.json');
const OPERACOES = json('caixa-operacoes.json');
const ITENS_DIA = json('itens-dia.json');

const pedido = codigo => PEDIDOS.find(p => p.CODIGO === codigo);
const itensDe = codigo => ITENS.filter(i => i.CODIGOPEDIDO === codigo);
const pagsDe = codigo => PAGAMENTOS.filter(p => p.CODIGOPEDIDO === codigo);
const caixa = codigo => CAIXAS.find(c => c.CODIGO === codigo);

// ---------------------------------------------------------------- datas

test('dataFirebird soma as 4 h de Porto Velho, com string ou Date', () => {
  const alvo = new Date('2026-08-21T21:40:14.587Z');
  assert.deepEqual(dataFirebird('2026-08-21 17:40:14.587'), alvo);
  // node-firebird devolve Date montado com os componentes de parede no fuso
  // do processo; ler de volta esses componentes reproduz o mesmo instante.
  assert.deepEqual(dataFirebird(new Date(2026, 7, 21, 17, 40, 14, 587)), alvo);
  assert.equal(dataFirebird(null), null);
});

test('diaFirebird é o dia local, não o dia UTC', () => {
  assert.equal(diaFirebird('2026-08-21 17:40:14.587'), '2026-08-21');
  // 22:15 local vira 02:15 UTC do dia seguinte: o dia local não pode virar.
  assert.equal(diaFirebird('2026-08-21 22:15:41.230'), '2026-08-21');
  assert.equal(diaFirebird(null), null);
});

// ---------------------------------------------------------------- tipo

test('tipoOriginalFb usa a TAG do pedido, não PEDIDOMESAS (que está vazia)', () => {
  assert.equal(tipoOriginalFb({ TAG: 'M-P', TEM_DELIVERY: 0 }), 'Mesas/Comandas');
  assert.equal(tipoOriginalFb({ TAG: 'M-NV', TEM_DELIVERY: 0 }), 'Mesas/Comandas');
  assert.equal(tipoOriginalFb({ TAG: 'D', TEM_DELIVERY: 1 }), 'Delivery');
  assert.equal(tipoOriginalFb({ TAG: 'D', TEM_DELIVERY: 0 }), 'Balcão');
  assert.equal(tipoOriginalFb({ TAG: null, TEM_DELIVERY: 0 }), 'Balcão');
});

// ---------------------------------------------------------------- pedidos

test('normalizaPedidoFb: mesa finalizada (75088) com item filho', () => {
  const { pedido: p, itens, pagamentos } = normalizaPedidoFb({
    linhaPedido: pedido(75088), itens: itensDe(75088), pagamentos: pagsDe(75088), empresaId: EMPRESA,
  });

  assert.deepEqual(Object.keys(p).sort(), [
    'aberto_em', 'cliente', 'codigo', 'colaborador', 'dia_venda', 'empresa_id',
    'excluido_em', 'fechado_em', 'finalizado', 'id_connect', 'numero', 'origem',
    'origem_html', 'origem_raw', 'qtd_itens', 'status', 'tipo', 'tipo_original',
    'valor_acrescimo', 'valor_desconto', 'valor_entrega', 'valor_itens',
    'valor_servico', 'valor_total',
  ]);

  assert.equal(p.empresa_id, EMPRESA);
  assert.equal(p.codigo, 75088);
  assert.equal(p.id_connect, null);
  assert.equal(p.tipo, 'mesa');
  assert.equal(p.tipo_original, 'Mesas/Comandas');
  assert.equal(p.origem, 'Comanda Mobile');
  assert.equal(p.status, 'Finalizado');
  assert.equal(p.finalizado, true);
  assert.equal(p.numero, 3);
  assert.equal(p.colaborador, 'Colaboradora Teste');
  assert.equal(p.cliente, null);
  assert.equal(p.qtd_itens, 2);
  assert.equal(p.valor_total, 112.97);
  assert.equal(p.valor_itens, 102.7);
  assert.equal(p.valor_servico, 10.27);
  assert.equal(p.valor_entrega, 0);
  assert.equal(p.valor_desconto, null);
  // TOTALACRESCIMO no Firebird é serviço + entrega somados, não um acréscimo
  // avulso: gravá-lo aqui contaria o serviço duas vezes.
  assert.equal(p.valor_acrescimo, null);
  assert.equal(p.aberto_em, '2026-08-21T22:35:30.960Z');
  assert.equal(p.fechado_em, '2026-08-21T23:20:08.906Z');
  assert.equal(p.dia_venda, '2026-08-21');
  assert.equal(p.excluido_em, null);
  assert.equal(p.origem_html, null);
  assert.equal(p.origem_raw, pedido(75088));

  assert.equal(itens.length, 5);
  assert.deepEqual(Object.keys(itens[0]).sort(), [
    'eh_combo', 'empresa_id', 'item_pai_posicao', 'nome', 'observacao',
    'posicao', 'preco_unitario', 'quantidade', 'valor',
  ]);
  assert.deepEqual(itens[0], {
    empresa_id: EMPRESA, posicao: 1, nome: 'Fraldinha Red', observacao: 'Bem passada',
    quantidade: 1, preco_unitario: 72.9, valor: 72.9, item_pai_posicao: null, eh_combo: true,
  });
  // Vinagrete/Mandioca/Mandioca frita são filhos do item 1.
  assert.deepEqual(itens.slice(1, 4).map(i => i.item_pai_posicao), [1, 1, 1]);
  assert.equal(itens[1].observacao, null);
  assert.equal(itens[4].item_pai_posicao, null);
  assert.equal(itens[4].eh_combo, false);
  // O valor da linha é VALORITEM: VALORTOTAL do pai (87,80) já inclui os filhos.
  assert.equal(itens.reduce((s, i) => s + i.valor, 0).toFixed(2), '102.70');

  assert.equal(pagamentos.length, 2);
  assert.deepEqual(Object.keys(pagamentos[0]).sort(), [
    'empresa_id', 'forma', 'forma_grupo', 'operadora', 'pago_em', 'posicao', 'valor',
  ]);
  assert.deepEqual(pagamentos[0], {
    empresa_id: EMPRESA, posicao: 1, valor: 55, forma: 'Cartão de Crédito',
    operadora: 'Mastercard', forma_grupo: 'credito', pago_em: '2026-08-21T23:19:56.690Z',
  });
  assert.equal(pagamentos.reduce((s, p2) => s + p2.valor, 0), 112.97);
});

test('normalizaPedidoFb: delivery (75089) com entrega e cliente', () => {
  const { pedido: p, pagamentos } = normalizaPedidoFb({
    linhaPedido: pedido(75089), itens: itensDe(75089), pagamentos: pagsDe(75089), empresaId: EMPRESA,
  });
  assert.equal(p.tipo, 'delivery');
  assert.equal(p.tipo_original, 'Delivery');
  assert.equal(p.origem, 'MenuDino App/Site');
  assert.equal(p.valor_total, 139.6);
  assert.equal(p.valor_entrega, 9);
  assert.equal(p.cliente, 'Cliente Um');
  // NUMERO = 0 no delivery: o painel não mostra número nenhum.
  assert.equal(p.numero, null);
  assert.equal(pagamentos.length, 1);
  assert.equal(pagamentos[0].forma_grupo, 'credito');
});

test('normalizaPedidoFb: balcão (75114) não é mesa nem delivery', () => {
  const { pedido: p } = normalizaPedidoFb({
    linhaPedido: pedido(75114), itens: [], pagamentos: [], empresaId: EMPRESA,
  });
  assert.equal(p.tipo, 'outro');
  assert.equal(p.tipo_original, 'Balcão');
  assert.equal(p.origem, 'Desktop');
});

test('normalizaPedidoFb: pedido excluído (75138) não conta como finalizado', () => {
  const { pedido: p } = normalizaPedidoFb({
    linhaPedido: pedido(75138), itens: [], pagamentos: [], empresaId: EMPRESA,
  });
  assert.equal(p.finalizado, false);
  assert.equal(p.status, 'Excluído');
  assert.equal(p.excluido_em, '2026-08-22T02:16:46.027Z');
  assert.equal(p.fechado_em, null);
  // Fechou 22:15 em Porto Velho — 02:15 UTC do dia 22, mas a venda é do dia 21.
  assert.equal(p.dia_venda, '2026-08-21');
});

// ---------------------------------------------------------------- caixas

test('normalizaCaixaFb: caixa 1561 fecha em 7.902,13 pela soma dos movimentos', () => {
  const pags = [
    { CODIGO: 1, CODIGOCAIXA: 1561, CODIGOPEDIDO: 75089, VALOR: 7723.53,
      DATAPAGAMENTO: '2026-08-21 18:37:37.586', FORMA: 'Cartão de Crédito',
      OPERADORA: 'Mastercard', OBSERVACAO: 'Levar Máquina - Lanç. Aut.' },
  ];
  const { caixa: c, movimentos } = normalizaCaixaFb({
    linhaCaixa: caixa(1561), pagamentos: pags,
    operacoes: OPERACOES.filter(o => o.CODIGOCAIXA === 1561), empresaId: EMPRESA,
  });

  assert.deepEqual(Object.keys(c).sort(), [
    'aberto_em', 'codigo', 'dia_caixa', 'empresa_id', 'fechado_em', 'id_connect',
    'observacao', 'origem_html', 'origem_raw', 'saldo_final', 'saldo_inicial',
    'status', 'total_dinheiro', 'usuario',
  ]);
  assert.equal(c.status, 'Fechado');
  assert.equal(c.usuario, 'Caixa');
  assert.equal(c.saldo_inicial, 178.6);
  assert.equal(c.saldo_final, 7902.13);
  assert.equal(c.dia_caixa, '2026-08-21');
  assert.equal(c.aberto_em, '2026-08-21T21:40:14.587Z');
  assert.equal(c.observacao, 'Aberto às 17:39 por Caixa');
  assert.equal(c.origem_html, null);
  assert.equal(c.id_connect, null);
  // Nenhuma entrada em dinheiro neste caixa: o "Total em Dinheiro" do painel
  // era exatamente o saldo de abertura.
  assert.equal(c.total_dinheiro, 178.6);

  assert.deepEqual(Object.keys(movimentos[0]).sort(), [
    'empresa_id', 'entrada', 'forma', 'forma_grupo', 'momento', 'observacao',
    'operacao', 'operadora', 'origem', 'pedido_codigo', 'posicao', 'saida',
  ]);
  assert.deepEqual(movimentos[0], {
    empresa_id: EMPRESA, posicao: 1, operacao: 'Abertura', origem: 'Caixa',
    pedido_codigo: null, momento: '2026-08-21T21:40:14.587Z', entrada: 178.6,
    saida: null, forma: 'Diversos', operadora: null, forma_grupo: 'outro',
    observacao: null,
  });
  assert.deepEqual(movimentos[1], {
    empresa_id: EMPRESA, posicao: 2, operacao: 'Recebimento', origem: 'Pedido 75089',
    pedido_codigo: 75089, momento: '2026-08-21T22:37:37.586Z', entrada: 7723.53,
    saida: null, forma: 'Cartão de Crédito', operadora: 'Mastercard',
    forma_grupo: 'credito', observacao: 'Levar Máquina - Lanç. Aut.',
  });
  // O estorno (TIPO E) do caixa 1561 não vira movimento: o pagamento
  // correspondente já saiu por DATADELETE, então descontá-lo dobraria a baixa.
  assert.equal(movimentos.length, 2);
  const saldo = movimentos.reduce((s, m) => s + (m.entrada || 0) - (m.saida || 0), 0);
  assert.equal(Number(saldo.toFixed(2)), 7902.13);
});

test('normalizaCaixaFb: sangria, suprimento e despesa viram movimentos', () => {
  const operacoes = [
    { ...OPERACOES.find(o => o.TIPO === 'S'), CODIGOCAIXA: 1562 },
    { ...OPERACOES.find(o => o.TIPO === 'A'), CODIGOCAIXA: 1562, DATAOPERACAO: '2026-08-22 18:00:00.000' },
    { ...OPERACOES.find(o => o.TIPO === 'D'), CODIGOCAIXA: 1562, DATAOPERACAO: '2026-08-22 19:00:00.000' },
  ];
  const { movimentos } = normalizaCaixaFb({
    linhaCaixa: caixa(1562), pagamentos: [], operacoes, empresaId: EMPRESA,
  });
  const porOperacao = Object.fromEntries(movimentos.map(m => [m.operacao, m]));
  assert.equal(porOperacao.Suprimento.entrada, 300);
  assert.equal(porOperacao.Suprimento.saida, null);
  assert.equal(porOperacao.Suprimento.forma_grupo, 'dinheiro');
  assert.equal(porOperacao.Despesa.saida, 30);
  assert.equal(porOperacao.Sangria.saida, 450);
  assert.equal(porOperacao.Sangria.origem, 'Caixa');
  // abertura + 3 operações, em ordem de momento
  assert.deepEqual(movimentos.map(m => m.operacao),
    ['Abertura', 'Suprimento', 'Despesa', 'Sangria']);
  const saldo = movimentos.reduce((s, m) => s + (m.entrada || 0) - (m.saida || 0), 0);
  assert.equal(Number(saldo.toFixed(2)), -1.4);
});

test('normalizaCaixaFb: caixa aberto não tem saldo final', () => {
  const aberto = { ...caixa(1562), DATAFECHAMENTO: null };
  const { caixa: c } = normalizaCaixaFb({
    linhaCaixa: aberto, pagamentos: [], operacoes: [], empresaId: EMPRESA,
  });
  assert.equal(c.status, 'Aberto');
  assert.equal(c.saldo_final, null);
});

test('normalizaCaixaFb: total_dinheiro conta pagamento em dinheiro e sangria', () => {
  const pags = [
    { CODIGO: 1, CODIGOCAIXA: 1562, CODIGOPEDIDO: 75162, VALOR: 19.9,
      DATAPAGAMENTO: '2026-08-22 19:24:35.998', FORMA: 'Dinheiro', OPERADORA: null },
    { CODIGO: 2, CODIGOCAIXA: 1562, CODIGOPEDIDO: 75163, VALOR: 100,
      DATAPAGAMENTO: '2026-08-22 19:30:00.000', FORMA: 'Cartão de Débito', OPERADORA: 'Visa' },
  ];
  const { caixa: c } = normalizaCaixaFb({
    linhaCaixa: caixa(1562), pagamentos: pags,
    operacoes: OPERACOES.filter(o => o.TIPO === 'S'), empresaId: EMPRESA,
  });
  // 178,60 de abertura + 19,90 em dinheiro − 450,00 de sangria
  assert.equal(c.total_dinheiro, -251.5);
});

// ---------------------------------------------------------------- recebimentos

test('normalizaRecebimentoFb devolve a forma do v1, sem taxa', () => {
  const r = normalizaRecebimentoFb(RECEBIMENTOS.find(x => x.CODIGO === 101295), EMPRESA);
  assert.deepEqual(Object.keys(r).sort(), [
    'caixa_codigo', 'categoria', 'credito_em', 'dia_pagamento', 'empresa_id',
    'forma', 'forma_grupo', 'observacao', 'operadora', 'origem_raw', 'pago_em',
    'parcela', 'pedido_codigo', 'percentual_taxa', 'valor', 'valor_liquido',
  ]);
  assert.equal(r.pedido_codigo, 75089);
  assert.equal(r.caixa_codigo, 1561);
  assert.equal(r.categoria, 'Recebimento - Vendas');
  assert.equal(r.forma, 'Cartão de Crédito');
  assert.equal(r.operadora, 'Mastercard');
  assert.equal(r.forma_grupo, 'credito');
  assert.equal(r.valor, 139.6);
  // O backup não tem líquido nem taxa da credenciadora.
  assert.equal(r.valor_liquido, 139.6);
  assert.equal(r.percentual_taxa, null);
  assert.equal(r.parcela, null);
  assert.equal(r.pago_em, '2026-08-21T22:37:37.586Z');
  assert.equal(r.dia_pagamento, '2026-08-21');
  assert.equal(r.credito_em, '2026-08-21');
  assert.equal(r.observacao, 'Levar Máquina - Lanç. Aut.');
});

test('normalizaRecebimentoFb classifica as formas da janela, com acento', () => {
  const grupos = RECEBIMENTOS.map(l => normalizaRecebimentoFb(l, EMPRESA))
    .map(r => [r.forma, r.forma_grupo]);
  assert.deepEqual(grupos, [
    ['Cartão de Crédito', 'credito'],
    ['Pix Manual', 'pix'],
    ['iFood Online', 'ifood_online'],
    ['Dinheiro', 'dinheiro'],
    ['Vale Alimentação', 'voucher'],
  ]);
});

test('normalizaRecebimentoFb aceita as strings acentuadas do Firebird', () => {
  const linha = {
    CODIGO: 1, CODIGOPEDIDO: 1, CODIGOCAIXA: 1, VALOR: 10,
    DATAPAGAMENTO: '2026-08-21 20:00:00.000', DATACREDITO: null,
    PERCENTUALTAXA: null, NROPARCELA: null, OBSERVACAO: null,
    FORMA: 'Cartão de Crédito', OPERADORA: 'Mastercard', CATEGORIA: null,
  };
  assert.equal(normalizaRecebimentoFb(linha, EMPRESA).forma_grupo, 'credito');
  assert.equal(normalizaRecebimentoFb({ ...linha, FORMA: 'Cartão de Débito' }, EMPRESA).forma_grupo, 'debito');
  assert.equal(normalizaRecebimentoFb({ ...linha, FORMA: 'Vale Refeição' }, EMPRESA).forma_grupo, 'voucher');
});

// ---------------------------------------------------------------- itens/dia

test('itensDiaFb devolve a forma do v1 e calcula lucro, margem e ABC', () => {
  const linhas = itensDiaFb(ITENS_DIA, EMPRESA);
  assert.equal(linhas.length, ITENS_DIA.length);
  assert.deepEqual(Object.keys(linhas[0]).sort(), [
    'categoria', 'codigo_detalhe', 'codigo_produto', 'curva_abc', 'custo_medio',
    'dia', 'empresa_id', 'lucro', 'margem', 'nome', 'origem_raw',
    'participacao_lucro', 'preco_custo', 'preco_venda', 'quantidade',
    'valor_vendido',
  ]);
  const smash = linhas.find(l => l.codigo_detalhe === 260);
  assert.equal(smash.dia, '2026-08-21');
  assert.equal(smash.codigo_produto, 229);
  assert.equal(smash.nome, 'Smash Duplo');
  assert.equal(smash.categoria, 'Hambúrgueres');
  assert.equal(smash.quantidade, 14);
  assert.equal(smash.valor_vendido, 401.6);
  assert.equal(smash.preco_venda, 34.9);
  assert.equal(smash.preco_custo, 12.5);
  assert.equal(smash.custo_medio, 12.5);
  assert.equal(smash.lucro, 226.6);
  assert.equal(smash.margem, 56.42);
  assert.equal(smash.origem_raw, ITENS_DIA.find(l => l.CODIGO_DETALHE === 260));

  // Participação soma 100% no dia e a curva ABC começa em A.
  const soma = linhas.reduce((s, l) => s + l.participacao_lucro, 0);
  assert.ok(Math.abs(soma - 100) < 0.05, `participação somou ${soma}`);
  assert.equal(linhas[0].curva_abc, 'A');
  assert.ok(linhas.every(l => 'ABC'.includes(l.curva_abc)));
});

test('itensDiaFb separa a curva ABC por dia', () => {
  const linhas = itensDiaFb([
    { DIA: '2026-08-21', CODIGO_PRODUTO: 1, CODIGO_DETALHE: 10, NOME: 'A1', CATEGORIA: 'X',
      QUANTIDADE: 1, VALOR_VENDIDO: 100, CUSTO: 10, PRECO_VENDA: 100, PRECO_CUSTO: 10 },
    { DIA: '2026-08-22', CODIGO_PRODUTO: 2, CODIGO_DETALHE: 20, NOME: 'B1', CATEGORIA: 'X',
      QUANTIDADE: 1, VALOR_VENDIDO: 50, CUSTO: 10, PRECO_VENDA: 50, PRECO_CUSTO: 10 },
  ], EMPRESA);
  assert.deepEqual(linhas.map(l => [l.dia, l.participacao_lucro, l.curva_abc]), [
    ['2026-08-21', 100, 'A'],
    ['2026-08-22', 100, 'A'],
  ]);
});

test('itensDiaFb aguenta dia sem lucro (só custo)', () => {
  const linhas = itensDiaFb([
    { DIA: '2026-08-21', CODIGO_PRODUTO: null, CODIGO_DETALHE: 278, NOME: 'Vinagrete',
      CATEGORIA: null, QUANTIDADE: 3, VALOR_VENDIDO: 0, CUSTO: 3.12,
      PRECO_VENDA: 0, PRECO_CUSTO: 1.04 },
  ], EMPRESA);
  assert.equal(linhas[0].lucro, -3.12);
  assert.equal(linhas[0].margem, null);
  assert.equal(linhas[0].participacao_lucro, 0);
  assert.equal(linhas[0].curva_abc, 'C');
  assert.equal(linhas[0].codigo_produto, null);
});
