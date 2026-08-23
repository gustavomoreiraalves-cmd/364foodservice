import { test } from 'node:test';
import assert from 'node:assert/strict';
// Importar o script não dispara a rodada: o `main()` só roda quando ele é
// chamado direto (ver o fim de scripts/importar-pdv-backup.mjs).
import { dataValida } from '../scripts/importar-pdv-backup.mjs';

test('dataValida aceita dia que existe no calendário', () => {
  assert.equal(dataValida('2026-08-23'), true);
  assert.equal(dataValida('2024-02-29'), true); // ano bissexto
  assert.equal(dataValida('2022-03-14'), true); // início da carga histórica
});

test('dataValida recusa formato fora de YYYY-MM-DD', () => {
  assert.equal(dataValida('23/08/2026'), false);
  assert.equal(dataValida('2026-8-23'), false);
  assert.equal(dataValida(''), false);
  assert.equal(dataValida(null), false);
  assert.equal(dataValida(undefined), false);
});

test('dataValida recusa data que o formato aceita mas o calendário não', () => {
  // `new Date('2026-13-45')` seria Invalid Date, mas...
  assert.equal(dataValida('2026-13-45'), false);
  // ...`new Date('2026-02-30T00:00:00Z')` vira 2 de março sem reclamar: é o
  // ida-e-volta que pega.
  assert.equal(dataValida('2026-02-30'), false);
  assert.equal(dataValida('2023-02-29'), false); // 2023 não é bissexto
  assert.equal(dataValida('2026-04-31'), false);
  assert.equal(dataValida('2026-00-10'), false);
});
