import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rotularAmbiente, ehProducao, montarVersao } from '../lib/versao.js';

test('rotula os ambientes da Vercel e trata ausência como local', () => {
  assert.equal(rotularAmbiente('production'), 'produção');
  assert.equal(rotularAmbiente('preview'), 'teste');
  assert.equal(rotularAmbiente('development'), 'local');
  assert.equal(rotularAmbiente(undefined), 'local');
  assert.equal(rotularAmbiente('local'), 'local');
});

test('só production conta como produção', () => {
  assert.equal(ehProducao('production'), true);
  assert.equal(ehProducao('preview'), false);
  assert.equal(ehProducao(undefined), false);
});

test('em produção esconde o branch da linha visível mas mantém no title', () => {
  const info = montarVersao({
    versao: '0.1.0', commit: 'a1b2c3d', branch: 'main',
    ambiente: 'production', buildEm: '21/08 14:32',
  });
  assert.equal(info.versao, 'v0.1.0');
  assert.equal(info.ambiente, 'produção');
  assert.equal(info.ehProducao, true);
  assert.equal(info.branch, null);
  assert.match(info.titulo, /branch: main/);
});

test('fora de produção mostra o branch, que é a informação útil', () => {
  const info = montarVersao({
    versao: '0.1.0', commit: 'a1b2c3d', branch: 'feat/menu-categorias',
    ambiente: 'preview', buildEm: '21/08 14:32',
  });
  assert.equal(info.ambiente, 'teste');
  assert.equal(info.ehProducao, false);
  assert.equal(info.branch, 'feat/menu-categorias');
});

test('campo ausente ou em branco vira ? em vez de sumir', () => {
  const info = montarVersao({ versao: '', commit: undefined, branch: '   ', ambiente: 'local', buildEm: null });
  assert.equal(info.versao, 'v?');
  assert.equal(info.commit, '?');
  assert.equal(info.branch, '?');
  assert.equal(info.buildEm, '?');
});

test('sem nenhum dado não quebra', () => {
  const info = montarVersao();
  assert.equal(info.ambiente, 'local');
  assert.equal(info.commit, '?');
});
