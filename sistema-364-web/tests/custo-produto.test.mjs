import { test } from 'node:test';
import assert from 'node:assert/strict';

// lib/format.js só importa lib/supabase.js sob demanda, dentro das funções
// que batem no banco — não mais no topo do módulo. parseCustoUnitario é
// pura e nem chega a tocar nisso; as variáveis abaixo ficam por precaução.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'chave-anon-de-teste';
const { parseCustoUnitario } = await import('../lib/format.js');

test('vazio, null e undefined viram 0 — que é "usar a ficha técnica"', () => {
  assert.equal(parseCustoUnitario(null), 0);
  assert.equal(parseCustoUnitario(undefined), 0);
  assert.equal(parseCustoUnitario(''), 0);
  assert.equal(parseCustoUnitario('   '), 0);
});

test('aceita vírgula decimal e ponto decimal', () => {
  assert.equal(parseCustoUnitario('45,50'), 45.5);
  assert.equal(parseCustoUnitario('45.50'), 45.5);
  assert.equal(parseCustoUnitario(45.5), 45.5);
  assert.equal(parseCustoUnitario(' 45,50 '), 45.5);
});

test('zero é válido: é o valor documentado de "não informado"', () => {
  assert.equal(parseCustoUnitario('0'), 0);
  assert.equal(parseCustoUnitario('0,00'), 0);
  assert.equal(parseCustoUnitario(0), 0);
});

test('texto que não vira número é recusado, não convertido para 0', () => {
  assert.equal(parseCustoUnitario('abc'), null);
  assert.equal(parseCustoUnitario('45,50 reais'), null);
});

test('negativo é recusado', () => {
  assert.equal(parseCustoUnitario('-5'), null);
  assert.equal(parseCustoUnitario('-0,01'), null);
  assert.equal(parseCustoUnitario(-5), null);
});

// Separador de milhar não é aceito de propósito: removê-lo estragaria '1.5',
// que o <input type="number"> produz querendo dizer um e meio. Recusar é
// visível; converter errado, não.
test('separador de milhar é recusado em vez de virar número errado', () => {
  assert.equal(parseCustoUnitario('1.234,56'), null);
  assert.equal(parseCustoUnitario('1,234,56'), null);
  assert.equal(parseCustoUnitario('1.5'), 1.5);
});

test('Infinity e NaN não passam', () => {
  assert.equal(parseCustoUnitario('Infinity'), null);
  assert.equal(parseCustoUnitario(NaN), null);
});
