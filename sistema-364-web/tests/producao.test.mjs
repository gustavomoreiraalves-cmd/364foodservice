import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  condicaoValidade,
  calcularValidadePreview,
  temPermissao,
  fmtDateTime,
} from '../lib/producao.js';

const agora = new Date('2026-08-13T15:40:00');

test('condicaoValidade: vencido quando agora > validade', () => {
  assert.equal(condicaoValidade('2026-08-13T15:39:00', agora).id, 'vencido');
});

test('condicaoValidade: vence_hoje quando vence ainda hoje', () => {
  assert.equal(condicaoValidade('2026-08-13T23:00:00', agora).id, 'vence_hoje');
});

test('condicaoValidade: vence_em_breve dentro de 24h (amanhã)', () => {
  assert.equal(condicaoValidade('2026-08-14T10:00:00', agora).id, 'vence_em_breve');
});

test('condicaoValidade: valido além de 24h', () => {
  assert.equal(condicaoValidade('2026-08-18T15:40:00', agora).id, 'valido');
});

test('condicaoValidade: sem validade', () => {
  assert.equal(condicaoValidade(null, agora).id, 'sem_validade');
});

test('calcularValidadePreview: dias (Molho Cheddar resfriado 5 dias)', () => {
  const r = calcularValidadePreview('2026-08-13T15:40:00Z', { permitido: true, validade_valor: 5, validade_unidade: 'dias' });
  assert.equal(r, '2026-08-18T15:40:00.000Z');
});

test('calcularValidadePreview: horas', () => {
  const r = calcularValidadePreview('2026-08-13T15:40:00Z', { permitido: true, validade_valor: 6, validade_unidade: 'horas' });
  assert.equal(r, '2026-08-13T21:40:00.000Z');
});

test('calcularValidadePreview: não permitido retorna null', () => {
  assert.equal(calcularValidadePreview('2026-08-13T15:40:00Z', { permitido: false }), null);
  assert.equal(calcularValidadePreview('2026-08-13T15:40:00Z', null), null);
});

test('temPermissao: admin passa em tudo, senão exige chave', () => {
  assert.equal(temPermissao([], true, 'producoes.descarte'), true);
  assert.equal(temPermissao(['producoes.descarte'], false, 'producoes.descarte'), true);
  assert.equal(temPermissao(['producoes'], false, 'producoes.descarte'), false);
});

test('fmtDateTime formata DD/MM/AAAA HH:mm', () => {
  assert.equal(fmtDateTime('2026-08-13T15:40:00'), '13/08/2026 15:40');
  assert.equal(fmtDateTime(null), '—');
});
