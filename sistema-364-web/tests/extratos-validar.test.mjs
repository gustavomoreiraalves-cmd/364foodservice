import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarExtrato, validarFatura } from '../lib/extratos/validar.js';

const lancamentos = [
  { valor: 1000, tipo: 'entrada' },
  { valor: 250.5, tipo: 'saida' },
  { valor: 49.5, tipo: 'saida' },
];

test('extrato fechado: saldo final bate com a soma dos lançamentos', () => {
  const r = validarExtrato({ saldoInicial: 500, saldoFinal: 1200, lancamentos });
  assert.equal(r.ok, true);
  assert.equal(r.alerta, null);
});

test('tolerância de um centavo não vira alerta', () => {
  const r = validarExtrato({ saldoInicial: 500, saldoFinal: 1200.01, lancamentos });
  assert.equal(r.ok, true);
});

test('diferença acima de um centavo alerta e diz o tamanho da diferença', () => {
  const r = validarExtrato({ saldoInicial: 500, saldoFinal: 1299.99, lancamentos });
  assert.equal(r.ok, false);
  assert.match(r.alerta, /99,99|99\.99/);
});

test('sem saldo inicial a conferência é ignorada (OFX e CSV não trazem)', () => {
  const r = validarExtrato({ saldoInicial: null, saldoFinal: 1200, lancamentos });
  assert.equal(r.ok, true);
  assert.equal(r.alerta, null);
});

test('fatura: total confere com a soma das linhas', () => {
  const linhas = [{ valor: 300, tipo: 'saida' }, { valor: 100, tipo: 'saida' }];
  assert.equal(validarFatura({ total: 400, lancamentos: linhas }).ok, true);
  const ruim = validarFatura({ total: 450, lancamentos: linhas });
  assert.equal(ruim.ok, false);
  assert.match(ruim.alerta, /50,00|50\.00/);
});

test('fatura sem total informado não alerta', () => {
  assert.equal(validarFatura({ total: null, lancamentos: [{ valor: 1, tipo: 'saida' }] }).ok, true);
});

test('fatura com estorno (entrada): compras menos estorno bate com o total', () => {
  const linhas = [
    { valor: 300, tipo: 'saida' },
    { valor: 100, tipo: 'saida' },
    { valor: 50, tipo: 'entrada' },
  ];
  assert.equal(validarFatura({ total: 350, lancamentos: linhas }).ok, true);
});
