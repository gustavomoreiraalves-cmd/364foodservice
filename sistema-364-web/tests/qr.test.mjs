import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qrSvg } from '../lib/qr.js';
import { urlRastreio } from '../lib/etiquetas.js';

test('qrSvg: devolve um SVG com o tamanho pedido em milímetros', async () => {
  const svg = await qrSvg(urlRastreio('LT-260821-001'), 12);
  assert.match(svg, /^<svg /);
  assert.match(svg, /width="12mm"/);
  assert.match(svg, /height="12mm"/);
  assert.match(svg, /<\/svg>$/);
});

test('qrSvg: sem margem — a etiqueta é pequena e o quiet zone come área útil', async () => {
  const svg = await qrSvg('https://exemplo.test/rastreio/LT-1', 10);
  const vb = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  assert.ok(vb, 'o SVG precisa ter viewBox');
  assert.equal(vb[1], vb[2]);
});

test('qrSvg: conteúdos diferentes geram desenhos diferentes', async () => {
  const a = await qrSvg('https://exemplo.test/rastreio/LT-1', 10);
  const b = await qrSvg('https://exemplo.test/rastreio/LT-2', 10);
  assert.notEqual(a, b);
});

test('qrSvg: texto vazio é erro — etiqueta com QR ilegível é pior que sem QR', async () => {
  await assert.rejects(() => qrSvg('', 10), /vazio/);
});
