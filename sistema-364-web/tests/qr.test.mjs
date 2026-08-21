import { test } from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import { qrSvg } from '../lib/qr.js';
import { urlRastreio } from '../lib/etiquetas.js';

test('qrSvg: devolve um SVG com o tamanho pedido em milímetros', async () => {
  const svg = await qrSvg(urlRastreio('0364', 'LT-260821-001'), 12);
  assert.match(svg, /^<svg /);
  assert.match(svg, /width="12mm"/);
  assert.match(svg, /height="12mm"/);
  assert.match(svg, /<\/svg>$/);
});

// O dimensionamento do QR (lib/etiquetas.js, Important 3 da revisão) parte da
// premissa de que `margin: 0` realmente devolve a matriz sem quiet zone —
// comparar só "viewBox é quadrado" não prova isso: um viewBox com margem
// simétrica também é quadrado. O teste que guarda essa premissa precisa
// comparar contra uma geração COM margem e mostrar que a de margem 0 é
// estritamente menor.
test('qrSvg: sem margem — o viewBox é estritamente menor que o de uma geração com margem', async () => {
  const semMargem = await qrSvg('https://exemplo.test/rastreio/0364/LT-1', 10);
  const vbSemMargem = semMargem.match(/viewBox="0 0 (\d+) (\d+)"/);
  assert.ok(vbSemMargem, 'o SVG precisa ter viewBox');
  assert.equal(vbSemMargem[1], vbSemMargem[2]);

  const comMargem = await QRCode.toString('https://exemplo.test/rastreio/0364/LT-1', {
    type: 'svg', margin: 4, errorCorrectionLevel: 'M',
  });
  const vbComMargem = comMargem.match(/viewBox="0 0 (\d+) (\d+)"/);
  assert.ok(vbComMargem, 'o SVG de comparação precisa ter viewBox');

  assert.ok(Number(vbSemMargem[1]) < Number(vbComMargem[1]),
    'margin:0 precisa gerar uma matriz estritamente menor que margin:4 — senão o quiet zone não foi removido');
});

test('qrSvg: conteúdos diferentes geram desenhos diferentes', async () => {
  const a = await qrSvg('https://exemplo.test/rastreio/LT-1', 10);
  const b = await qrSvg('https://exemplo.test/rastreio/LT-2', 10);
  assert.notEqual(a, b);
});

test('qrSvg: texto vazio é erro — etiqueta com QR ilegível é pior que sem QR', async () => {
  await assert.rejects(() => qrSvg('', 10), /vazio/);
});
