import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numeroBr, dataIso } from '../lib/extratos/numero.js';

test('lê número no formato brasileiro', () => {
  assert.equal(numeroBr('1.234,56'), 1234.56);
  assert.equal(numeroBr('-750,00'), -750);
  assert.equal(numeroBr('0,01'), 0.01);
});

test('lê número no formato americano (OFX usa ponto decimal)', () => {
  assert.equal(numeroBr('1234.56'), 1234.56);
  assert.equal(numeroBr('-750.00'), -750);
  assert.equal(numeroBr('750'), 750);
});

test('número inválido devolve NaN, não zero', () => {
  assert.ok(Number.isNaN(numeroBr('SALDO')));
  assert.ok(Number.isNaN(numeroBr('')));
  assert.ok(Number.isNaN(numeroBr(null)));
});

test('data do OFX com fuso é cortada no dia', () => {
  assert.equal(dataIso('20260810120000[-3:BRT]'), '2026-08-10');
  assert.equal(dataIso('20260810'), '2026-08-10');
});

test('data brasileira e ISO', () => {
  assert.equal(dataIso('10/08/2026'), '2026-08-10');
  assert.equal(dataIso('2026-08-10'), '2026-08-10');
});

test('data ilegível devolve null', () => {
  assert.equal(dataIso('mês passado'), null);
  assert.equal(dataIso(''), null);
});

test('número negativo entre parênteses (formato de extrato)', () => {
  assert.equal(numeroBr('(1.234,56)'), -1234.56);
  assert.equal(numeroBr('(100.50)'), -100.50);
});

test('data dd/mm/aa com dois dígitos de ano', () => {
  assert.equal(dataIso('10/08/26'), '2026-08-10');
  assert.equal(dataIso('31/12/25'), '2025-12-31');
});
