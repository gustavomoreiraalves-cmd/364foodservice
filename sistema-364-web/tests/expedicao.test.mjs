import test from 'node:test';
import assert from 'node:assert/strict';
import { ordenarFefo, sugerirAlocacao } from '../lib/expedicao.js';

test('ordenarFefo: lote que vence primeiro vem primeiro', () => {
  const lotes = [
    { recebimentoItemId: 'b', validade: '2026-12-01', saldo: 10 },
    { recebimentoItemId: 'a', validade: '2026-10-01', saldo: 5 },
  ];
  const ordenado = ordenarFefo(lotes);
  assert.deepEqual(ordenado.map(l => l.recebimentoItemId), ['a', 'b']);
});

test('ordenarFefo: lote sem validade vai para o fim', () => {
  const lotes = [
    { recebimentoItemId: 'sem_validade', validade: null, saldo: 10 },
    { recebimentoItemId: 'com_validade', validade: '2026-10-01', saldo: 5 },
  ];
  const ordenado = ordenarFefo(lotes);
  assert.deepEqual(ordenado.map(l => l.recebimentoItemId), ['com_validade', 'sem_validade']);
});

test('sugerirAlocacao: item rastreado consome o lote que vence primeiro até cobrir a quantidade', () => {
  const itensPedido = [{ pedidoItemId: 'i1', produtoId: 'p1', quantidade: 8, rastreado: true }];
  const lotesPorProduto = {
    p1: [
      { recebimentoItemId: 'lote_a', validade: '2026-10-01', saldo: 5 },
      { recebimentoItemId: 'lote_b', validade: '2026-11-01', saldo: 10 },
    ],
  };
  const alocacao = sugerirAlocacao(itensPedido, lotesPorProduto);
  assert.deepEqual(alocacao, [
    { pedidoItemId: 'i1', recebimentoItemId: 'lote_a', quantidade: 5 },
    { pedidoItemId: 'i1', recebimentoItemId: 'lote_b', quantidade: 3 },
  ]);
});

test('sugerirAlocacao: item não rastreado entra sem lote, com a quantidade inteira', () => {
  const itensPedido = [{ pedidoItemId: 'i1', produtoId: 'p1', quantidade: 4, rastreado: false }];
  const alocacao = sugerirAlocacao(itensPedido, {});
  assert.deepEqual(alocacao, [{ pedidoItemId: 'i1', recebimentoItemId: null, quantidade: 4 }]);
});

test('sugerirAlocacao: item rastreado sem saldo suficiente completa o resto sem lote', () => {
  const itensPedido = [{ pedidoItemId: 'i1', produtoId: 'p1', quantidade: 10, rastreado: true }];
  const lotesPorProduto = { p1: [{ recebimentoItemId: 'lote_a', validade: '2026-10-01', saldo: 4 }] };
  const alocacao = sugerirAlocacao(itensPedido, lotesPorProduto);
  assert.deepEqual(alocacao, [
    { pedidoItemId: 'i1', recebimentoItemId: 'lote_a', quantidade: 4 },
    { pedidoItemId: 'i1', recebimentoItemId: null, quantidade: 6 },
  ]);
});

test('sugerirAlocacao: lote com saldo zero é ignorado', () => {
  const itensPedido = [{ pedidoItemId: 'i1', produtoId: 'p1', quantidade: 3, rastreado: true }];
  const lotesPorProduto = {
    p1: [
      { recebimentoItemId: 'lote_zerado', validade: '2026-09-01', saldo: 0 },
      { recebimentoItemId: 'lote_a', validade: '2026-10-01', saldo: 5 },
    ],
  };
  const alocacao = sugerirAlocacao(itensPedido, lotesPorProduto);
  assert.deepEqual(alocacao, [{ pedidoItemId: 'i1', recebimentoItemId: 'lote_a', quantidade: 3 }]);
});
