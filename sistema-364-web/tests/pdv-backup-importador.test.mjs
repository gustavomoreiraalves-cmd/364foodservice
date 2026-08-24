import { test } from 'node:test';
import assert from 'node:assert/strict';
// Importar o script não dispara a rodada: o `main()` só roda quando ele é
// chamado direto (ver o fim de scripts/importar-pdv-backup.mjs).
import { dataValida, janelasMensais } from '../scripts/importar-pdv-backup.mjs';

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

// ------------------------------------------------------- janelas mensais

// Nenhum dia pode ficar de fora nem ser processado duas vezes: as janelas têm
// que emendar exatamente uma na outra e cobrir [de, ate].
function conferePedacos(janelas, de, ate) {
  assert.equal(janelas[0].de, de);
  assert.equal(janelas.at(-1).ate, ate);
  for (let i = 1; i < janelas.length; i++) {
    const anterior = new Date(`${janelas[i - 1].ate}T00:00:00Z`);
    const seguinte = new Date(`${janelas[i].de}T00:00:00Z`);
    assert.equal(seguinte.getTime() - anterior.getTime(), 86400000,
      `janela ${i} não emenda: ${janelas[i - 1].ate} → ${janelas[i].de}`);
  }
}

test('janelasMensais deixa a janela do dia a dia inteira', () => {
  // A rodada padrão (D-3 até hoje) não pode virar duas por causa da virada
  // de mês.
  assert.deepEqual(janelasMensais('2026-08-20', '2026-08-23'), [{ de: '2026-08-20', ate: '2026-08-23' }]);
  assert.deepEqual(janelasMensais('2026-07-30', '2026-08-02'), [{ de: '2026-07-30', ate: '2026-08-02' }]);
  assert.deepEqual(janelasMensais('2026-08-23', '2026-08-23'), [{ de: '2026-08-23', ate: '2026-08-23' }]);
  // 31 dias corridos ainda é uma janela só; 32 já é fatiada.
  assert.equal(janelasMensais('2026-07-01', '2026-07-31').length, 1);
  assert.equal(janelasMensais('2026-07-01', '2026-08-01').length, 2);
});

test('janelasMensais corta a carga histórica em meses cheios', () => {
  const janelas = janelasMensais('2022-03-14', '2026-08-23');
  // De março/2022 a agosto/2026 são 54 meses.
  assert.equal(janelas.length, 54);
  assert.deepEqual(janelas[0], { de: '2022-03-14', ate: '2022-03-31' });
  assert.deepEqual(janelas[1], { de: '2022-04-01', ate: '2022-04-30' });
  assert.deepEqual(janelas.at(-1), { de: '2026-08-01', ate: '2026-08-23' });
  conferePedacos(janelas, '2022-03-14', '2026-08-23');
});

test('janelasMensais respeita fevereiro, inclusive bissexto', () => {
  const bissexto = janelasMensais('2024-01-15', '2024-04-05');
  assert.deepEqual(bissexto, [
    { de: '2024-01-15', ate: '2024-01-31' },
    { de: '2024-02-01', ate: '2024-02-29' },
    { de: '2024-03-01', ate: '2024-03-31' },
    { de: '2024-04-01', ate: '2024-04-05' },
  ]);
  const comum = janelasMensais('2023-01-15', '2023-03-05');
  assert.equal(comum[1].ate, '2023-02-28');
  conferePedacos(comum, '2023-01-15', '2023-03-05');
});
