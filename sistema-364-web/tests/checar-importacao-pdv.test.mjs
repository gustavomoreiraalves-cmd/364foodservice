import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backupMaisNovo, decidirRodada } from '../scripts/checar-importacao-pdv.mjs';

// ------------------------------------------------------ backupMaisNovo

test('backupMaisNovo: sem data conhecida, qualquer backup é novo', () => {
  assert.equal(backupMaisNovo(new Date('2026-08-28T10:00:00Z'), null), true);
});

test('backupMaisNovo: backup mais recente que o conhecido', () => {
  assert.equal(backupMaisNovo(new Date('2026-08-28T10:00:00Z'), '2026-08-27T10:00:00Z'), true);
});

test('backupMaisNovo: backup igual ou mais antigo não é novidade', () => {
  assert.equal(backupMaisNovo(new Date('2026-08-27T10:00:00Z'), '2026-08-27T10:00:00Z'), false);
  assert.equal(backupMaisNovo(new Date('2026-08-26T10:00:00Z'), '2026-08-27T10:00:00Z'), false);
});

test('backupMaisNovo: sem data de backup (cabeçalho não leu) nunca é novidade', () => {
  assert.equal(backupMaisNovo(null, '2026-08-27T10:00:00Z'), false);
  assert.equal(backupMaisNovo(null, null), false);
});

// -------------------------------------------------------- decidirRodada

test('decidirRodada: importação em andamento nunca dispara outra', () => {
  const r = decidirRodada({ importacaoEmAndamento: true, pedidoManualPendente: true, backupMaisNovo: true });
  assert.equal(r.rodar, false);
  assert.equal(r.motivo, 'já em andamento');
});

test('decidirRodada: pedido manual pendente dispara mesmo sem backup novo', () => {
  const r = decidirRodada({ importacaoEmAndamento: false, pedidoManualPendente: true, backupMaisNovo: false });
  assert.equal(r.rodar, true);
  assert.equal(r.motivo, 'pedido manual pendente');
});

test('decidirRodada: backup novo dispara sem pedido manual', () => {
  const r = decidirRodada({ importacaoEmAndamento: false, pedidoManualPendente: false, backupMaisNovo: true });
  assert.equal(r.rodar, true);
  assert.equal(r.motivo, 'backup mais novo disponível');
});

test('decidirRodada: nada pendente e nada novo não dispara', () => {
  const r = decidirRodada({ importacaoEmAndamento: false, pedidoManualPendente: false, backupMaisNovo: false });
  assert.equal(r.rodar, false);
  assert.equal(r.motivo, null);
});
