import test from 'node:test';
import assert from 'node:assert/strict';
import { code128c, PADROES_CODE128 } from '../lib/nfe/code128.js';

// Conferido à mão contra a especificação do Code 128:
//   símbolos = [Start C (105), 00, verificador, Stop (106)]
//   verificador = (105 + 1×0) mod 103 = 2
//   padrões     = 211232 · 212222 · 222221 · 2331112
test('code128c: "00" sai com Start C, dado, dígito verificador e Stop', () => {
  assert.deepEqual(
    code128c('00'),
    [2,1,1,2,3,2, 2,1,2,2,2,2, 2,2,2,2,2,1, 2,3,3,1,1,1,2],
  );
});

// Este é o teste que protege a tabela inteira. Errar uma largura no meio dos
// 107 padrões imprime um código bonito que não lê no leitor da fiscalização —
// e ninguém descobre até a mercadoria estar parada na barreira.
test('code128c: todo padrão da tabela tem 11 módulos, menos o Stop, que tem 13', () => {
  assert.equal(PADROES_CODE128.length, 107);
  PADROES_CODE128.forEach((p, i) => {
    const modulos = p.split('').reduce((s, n) => s + Number(n), 0);
    const esperado = i === 106 ? 13 : 11;
    assert.equal(modulos, esperado, `padrão ${i} ("${p}") tem ${modulos} módulos, esperado ${esperado}`);
  });
});

test('code128c: a contagem de módulos da chave real obedece à especificação', () => {
  // 44 dígitos = 22 símbolos de dados, mais Start e verificador = 24 de 11
  // módulos, mais o Stop de 13.
  const larguras = code128c('11260837541736000187550030000000021541041714');
  assert.equal(larguras.reduce((s, n) => s + n, 0), 24 * 11 + 13);
});

test('code128c: o dígito verificador pondera pela posição', () => {
  // "123456": valores 12, 34, 56 → (105 + 12×1 + 34×2 + 56×3) mod 103
  //         = (105 + 12 + 68 + 168) mod 103 = 353 mod 103 = 44
  const larguras = code128c('123456');
  const esperado = [105, 12, 34, 56, 44, 106].flatMap(v => PADROES_CODE128[v].split('').map(Number));
  assert.deepEqual(larguras, esperado);
});

test('code128c: recusa entrada que não seja numérica de comprimento par', () => {
  assert.throws(() => code128c('123'), /par/);
  assert.throws(() => code128c('12a4'), /numéric/);
  assert.throws(() => code128c(''), /vazia/);
});
