import test from 'node:test';
import assert from 'node:assert/strict';
import { ordenarFefo, sugerirAlocacao, empacotarCaixas, calcularDivergencia, calcularVolumesNfe, proximoNumeroExpedicao, loteAcimaDoSaldo } from '../lib/expedicao.js';

test('ordenarFefo: lote que vence primeiro vem primeiro', () => {
  const lotes = [
    { embalagemId: 'b', validade: '2026-12-01', saldo: 10 },
    { embalagemId: 'a', validade: '2026-10-01', saldo: 5 },
  ];
  const ordenado = ordenarFefo(lotes);
  assert.deepEqual(ordenado.map(l => l.embalagemId), ['a', 'b']);
});

test('ordenarFefo: lote sem validade vai para o fim', () => {
  const lotes = [
    { embalagemId: 'sem_validade', validade: null, saldo: 10 },
    { embalagemId: 'com_validade', validade: '2026-10-01', saldo: 5 },
  ];
  const ordenado = ordenarFefo(lotes);
  assert.deepEqual(ordenado.map(l => l.embalagemId), ['com_validade', 'sem_validade']);
});

test('sugerirAlocacao: item rastreado consome o lote que vence primeiro até cobrir a quantidade', () => {
  const itensPedido = [{ pedidoItemId: 'i1', produtoId: 'p1', quantidade: 8, rastreado: true }];
  const lotesPorProduto = {
    p1: [
      { embalagemId: 'lote_a', validade: '2026-10-01', saldo: 5 },
      { embalagemId: 'lote_b', validade: '2026-11-01', saldo: 10 },
    ],
  };
  const alocacao = sugerirAlocacao(itensPedido, lotesPorProduto);
  assert.deepEqual(alocacao, [
    { pedidoItemId: 'i1', embalagemId: 'lote_a', quantidade: 5 },
    { pedidoItemId: 'i1', embalagemId: 'lote_b', quantidade: 3 },
  ]);
});

test('sugerirAlocacao: item não rastreado entra sem lote, com a quantidade inteira', () => {
  const itensPedido = [{ pedidoItemId: 'i1', produtoId: 'p1', quantidade: 4, rastreado: false }];
  const alocacao = sugerirAlocacao(itensPedido, {});
  assert.deepEqual(alocacao, [{ pedidoItemId: 'i1', embalagemId: null, quantidade: 4 }]);
});

test('sugerirAlocacao: item rastreado sem saldo suficiente completa o resto sem lote', () => {
  const itensPedido = [{ pedidoItemId: 'i1', produtoId: 'p1', quantidade: 10, rastreado: true }];
  const lotesPorProduto = { p1: [{ embalagemId: 'lote_a', validade: '2026-10-01', saldo: 4 }] };
  const alocacao = sugerirAlocacao(itensPedido, lotesPorProduto);
  assert.deepEqual(alocacao, [
    { pedidoItemId: 'i1', embalagemId: 'lote_a', quantidade: 4 },
    { pedidoItemId: 'i1', embalagemId: null, quantidade: 6 },
  ]);
});

test('sugerirAlocacao: lote com saldo zero é ignorado', () => {
  const itensPedido = [{ pedidoItemId: 'i1', produtoId: 'p1', quantidade: 3, rastreado: true }];
  const lotesPorProduto = {
    p1: [
      { embalagemId: 'lote_zerado', validade: '2026-09-01', saldo: 0 },
      { embalagemId: 'lote_a', validade: '2026-10-01', saldo: 5 },
    ],
  };
  const alocacao = sugerirAlocacao(itensPedido, lotesPorProduto);
  assert.deepEqual(alocacao, [{ pedidoItemId: 'i1', embalagemId: 'lote_a', quantidade: 3 }]);
});

const PRODUTO_POR_ITEM = { i1: 'p1', i2: 'p2', i3: 'p3' };

test('empacotarCaixas: até 12 unidades do mesmo produto cabem numa caixa', () => {
  const alocacao = [{ pedidoItemId: 'i1', embalagemId: 'lote_a', quantidade: 12 }];
  const caixas = empacotarCaixas(alocacao, PRODUTO_POR_ITEM);
  assert.equal(caixas.length, 1);
  assert.equal(caixas[0].reduce((s, i) => s + i.quantidade, 0), 12);
});

test('empacotarCaixas: 13 unidades do mesmo produto viram duas caixas', () => {
  const alocacao = [{ pedidoItemId: 'i1', embalagemId: 'lote_a', quantidade: 13 }];
  const caixas = empacotarCaixas(alocacao, PRODUTO_POR_ITEM);
  assert.equal(caixas.length, 2);
  assert.deepEqual(caixas.map(c => c.reduce((s, i) => s + i.quantidade, 0)), [12, 1]);
});

test('empacotarCaixas: no máximo 2 produtos distintos por caixa', () => {
  const alocacao = [
    { pedidoItemId: 'i1', embalagemId: null, quantidade: 4 },
    { pedidoItemId: 'i2', embalagemId: null, quantidade: 4 },
    { pedidoItemId: 'i3', embalagemId: null, quantidade: 4 },
  ];
  const caixas = empacotarCaixas(alocacao, PRODUTO_POR_ITEM);
  for (const caixa of caixas) {
    const produtosDistintos = new Set(caixa.map(i => PRODUTO_POR_ITEM[i.pedidoItemId]));
    assert.ok(produtosDistintos.size <= 2, `caixa com ${produtosDistintos.size} produtos distintos`);
  }
  // 3 produtos de 4 un., limite de 2 produtos/caixa: não cabem todos numa só.
  assert.ok(caixas.length >= 2);
});

test('empacotarCaixas: caixa não passa de 12 unidades mesmo com 2 produtos cabendo em teoria', () => {
  const alocacao = [
    { pedidoItemId: 'i1', embalagemId: null, quantidade: 10 },
    { pedidoItemId: 'i2', embalagemId: null, quantidade: 10 },
  ];
  const caixas = empacotarCaixas(alocacao, PRODUTO_POR_ITEM);
  for (const caixa of caixas) {
    assert.ok(caixa.reduce((s, i) => s + i.quantidade, 0) <= 12);
  }
});

test('calcularDivergencia: nada diverge quando o alocado bate com o pedido', () => {
  const pedidoItens = [{ id: 'i1', quantidade: 10 }];
  const alocacao = [{ pedidoItemId: 'i1', recebimentoItemId: 'lote_a', quantidade: 10 }];
  assert.deepEqual(calcularDivergencia(pedidoItens, alocacao), []);
});

test('calcularDivergencia: soma várias linhas de alocação do mesmo item', () => {
  const pedidoItens = [{ id: 'i1', quantidade: 10 }];
  const alocacao = [
    { pedidoItemId: 'i1', recebimentoItemId: 'lote_a', quantidade: 6 },
    { pedidoItemId: 'i1', recebimentoItemId: 'lote_b', quantidade: 4 },
  ];
  assert.deepEqual(calcularDivergencia(pedidoItens, alocacao), []);
});

test('calcularDivergencia: falta alocar aparece com diferença negativa', () => {
  const pedidoItens = [{ id: 'i1', quantidade: 10 }];
  const alocacao = [{ pedidoItemId: 'i1', recebimentoItemId: null, quantidade: 7 }];
  assert.deepEqual(calcularDivergencia(pedidoItens, alocacao), [
    { pedidoItemId: 'i1', pedido: 10, alocado: 7, diferenca: -3 },
  ]);
});

test('calcularDivergencia: item do pedido sem nenhuma alocação aparece com alocado 0', () => {
  const pedidoItens = [{ id: 'i1', quantidade: 5 }];
  assert.deepEqual(calcularDivergencia(pedidoItens, []), [
    { pedidoItemId: 'i1', pedido: 5, alocado: 0, diferenca: -5 },
  ]);
});

test('calcularVolumesNfe: conta as caixas como volumes, sem peso (não capturado na UI)', () => {
  const caixas = [{ peso_bruto_kg: 5.5 }, { peso_bruto_kg: 3.2 }, { peso_bruto_kg: null }];
  assert.deepEqual(calcularVolumesNfe(caixas), { qVol: 3, esp: 'Caixa' });
});

test('calcularVolumesNfe: nenhuma caixa devolve null (nada a declarar)', () => {
  assert.equal(calcularVolumesNfe([]), null);
});

test('loteAcimaDoSaldo: par dentro do saldo não aparece', () => {
  const paresAlocados = [{ produtoId: 'p1', embalagemId: 'emb_a' }];
  const saldos = [{ produto_id: 'p1', embalagem_id: 'emb_a', saldo: 5 }];
  assert.deepEqual(loteAcimaDoSaldo(paresAlocados, saldos), []);
});

test('loteAcimaDoSaldo: saldo negativo (alocado maior que o embalado) aparece', () => {
  const paresAlocados = [{ produtoId: 'p1', embalagemId: 'emb_a' }];
  // saldo já vem negativo da view (total_embalado - total_expedido, que já
  // inclui as próprias linhas deste romaneio) quando a alocação estourou.
  const saldos = [{ produto_id: 'p1', embalagem_id: 'emb_a', saldo: -15 }];
  assert.deepEqual(loteAcimaDoSaldo(paresAlocados, saldos), [{ produtoId: 'p1', embalagemId: 'emb_a' }]);
});

test('loteAcimaDoSaldo: par sem nenhuma linha na view (lote cancelado/sumido) aparece', () => {
  const paresAlocados = [{ produtoId: 'p1', embalagemId: 'emb_a' }];
  assert.deepEqual(loteAcimaDoSaldo(paresAlocados, []), [{ produtoId: 'p1', embalagemId: 'emb_a' }]);
});

test('loteAcimaDoSaldo: só reporta os pares que realmente estouraram', () => {
  const paresAlocados = [
    { produtoId: 'p1', embalagemId: 'emb_a' },
    { produtoId: 'p1', embalagemId: 'emb_b' },
  ];
  const saldos = [
    { produto_id: 'p1', embalagem_id: 'emb_a', saldo: 3 },
    { produto_id: 'p1', embalagem_id: 'emb_b', saldo: -1 },
  ];
  assert.deepEqual(loteAcimaDoSaldo(paresAlocados, saldos), [{ produtoId: 'p1', embalagemId: 'emb_b' }]);
});

test('proximoNumeroExpedicao: primeiro romaneio do dia começa em 001', async () => {
  const clienteFalso = {
    from: () => ({
      select: () => ({ eq: () => ({ like: async () => ({ data: [] }) }) }),
    }),
  };
  const numero = await proximoNumeroExpedicao('2026-09-10', 'empresa-1', clienteFalso);
  assert.equal(numero, 'RM-260910-001');
});

test('proximoNumeroExpedicao: continua do maior sufixo já usado no dia', async () => {
  const linhas = [{ numero: 'RM-260910-001' }, { numero: 'RM-260910-003' }];
  const clienteFalso = {
    from: () => ({
      select: () => ({ eq: () => ({ like: async () => ({ data: linhas }) }) }),
    }),
  };
  const numero = await proximoNumeroExpedicao('2026-09-10', 'empresa-1', clienteFalso);
  assert.equal(numero, 'RM-260910-004');
});
