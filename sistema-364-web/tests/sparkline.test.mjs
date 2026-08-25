import test from 'node:test';
import assert from 'node:assert/strict';
import { pontosDaSerie, variacao } from '../lib/sparkline.js';

test('série vira coordenadas dentro da caixa', () => {
  const p = pontosDaSerie([0, 5, 10], { largura: 100, altura: 20 });
  assert.equal(p.length, 3);
  assert.deepEqual(p[0], { x: 0, y: 20 });   // menor valor encosta embaixo
  assert.deepEqual(p[2], { x: 100, y: 0 });  // maior encosta em cima
  assert.equal(p[1].x, 50);
  assert.equal(p[1].y, 10);
});

test('série constante fica na linha do meio, não colada na borda', () => {
  const p = pontosDaSerie([7, 7, 7], { largura: 60, altura: 20 });
  assert.deepEqual(p.map(x => x.y), [10, 10, 10]);
});

test('série curta ou vazia não quebra', () => {
  assert.deepEqual(pontosDaSerie([], { largura: 60, altura: 20 }), []);
  assert.deepEqual(pontosDaSerie([4], { largura: 60, altura: 20 }), [{ x: 0, y: 10 }]);
});

test('valores não numéricos são descartados em vez de virar NaN', () => {
  const p = pontosDaSerie([1, null, 3, undefined, 'x'], { largura: 100, altura: 10 });
  assert.equal(p.length, 2);
  assert.ok(p.every(v => Number.isFinite(v.x) && Number.isFinite(v.y)));
});

test('variação compara o fim com o começo', () => {
  assert.equal(variacao([100, 110]), 10);
  assert.equal(variacao([100, 90]), -10);
  assert.equal(variacao([0, 50]), null, 'sem base não há percentual');
  assert.equal(variacao([5]), null);
  assert.equal(variacao([]), null);
});
