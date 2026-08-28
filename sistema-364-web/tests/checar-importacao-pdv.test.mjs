import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backupMaisNovo, decidirRodada, importacaoBloqueia } from '../scripts/checar-importacao-pdv.mjs';

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

// ------------------------------------------------ importacaoBloqueia
// Este é o ponto exato do bug: o checador perguntava só se existia linha
// aberta, sem olhar a idade. Uma rodada que morreu sem fechar o log bloqueava
// o cron para sempre.

test('importacaoBloqueia: sem linha aberta, não bloqueia', () => {
  assert.equal(importacaoBloqueia(null), false);
});

test('importacaoBloqueia: rodada viva bloqueia — é o caso que a guarda existe para cobrir', () => {
  const agora = new Date('2026-08-28T12:00:00Z');
  assert.equal(importacaoBloqueia({ iniciado_em: '2026-08-28T11:50:00Z', terminado_em: null }, agora), true);
});

test('importacaoBloqueia: rodada morta NÃO bloqueia', () => {
  const agora = new Date('2026-08-28T12:00:00Z');
  assert.equal(importacaoBloqueia({ iniciado_em: '2026-08-24T03:01:48Z', terminado_em: null }, agora), false);
});

test('importacaoBloqueia + decidirRodada: pedido manual passa por cima de rodada morta', () => {
  const agora = new Date('2026-08-28T12:00:00Z');
  const morta = { iniciado_em: '2026-08-24T03:01:48Z', terminado_em: null };
  const decisao = decidirRodada({
    importacaoEmAndamento: importacaoBloqueia(morta, agora),
    pedidoManualPendente: true,
    backupMaisNovo: false,
  });
  assert.equal(decisao.rodar, true);
});
