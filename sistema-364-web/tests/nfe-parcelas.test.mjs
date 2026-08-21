import { test } from 'node:test';
import assert from 'node:assert/strict';

// lib/financeiro.js importa lib/format.js, que importa lib/supabase.js.
// Basta um par de valores de fachada antes do import.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'chave-anon-de-teste';
const { parcelasDoRecebimento } = await import('../lib/nfe/parcelas.js');

const DUP = [
  { numero: '001', vencimento: '2026-09-02', valor: 1378.5 },
  { numero: '002', vencimento: '2026-09-17', valor: 1378.5 },
];

test('usa as duplicatas quando o valor lançado bate com a nota', () => {
  const r = parcelasDoRecebimento({
    duplicatas: DUP, dataBase: '2026-08-18',
    valorLancado: 2757, valorTotalNota: 2757, numeroParcelas: 1, intervaloDias: 30,
  });
  assert.equal(r.origem, 'nota');
  assert.deepEqual(r.parcelas, [
    { numero: 1, valor: 1378.5, vencimento: '2026-09-02' },
    { numero: 2, valor: 1378.5, vencimento: '2026-09-17' },
  ]);
  assert.equal(r.parcelas.reduce((s, p) => s + p.valor, 0), 2757);
});

test('divergência de valor volta para o parcelamento manual', () => {
  const r = parcelasDoRecebimento({
    duplicatas: DUP, dataBase: '2026-08-18',
    valorLancado: 1560, valorTotalNota: 2757, numeroParcelas: 2, intervaloDias: 30,
  });
  assert.equal(r.origem, 'manual_divergencia');
  assert.equal(r.parcelas.length, 2);
  assert.equal(r.parcelas.reduce((s, p) => s + p.valor, 0), 1560);
});

test('nota sem duplicatas cai no gerarParcelas atual', () => {
  const r = parcelasDoRecebimento({
    duplicatas: [], dataBase: '2026-08-18',
    valorLancado: 1000, valorTotalNota: 1000, numeroParcelas: 1, intervaloDias: 30,
  });
  assert.equal(r.origem, 'manual');
  assert.deepEqual(r.parcelas, [{ numero: 1, valor: 1000, vencimento: '2026-08-18' }]);
});

test('diferença de centavo é tolerada e as duplicatas valem', () => {
  const r = parcelasDoRecebimento({
    duplicatas: DUP, dataBase: '2026-08-18',
    valorLancado: 2756.995, valorTotalNota: 2757, numeroParcelas: 1, intervaloDias: 30,
  });
  assert.equal(r.origem, 'nota');
});
