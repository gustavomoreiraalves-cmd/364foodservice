import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarLogo, caminhoLogo, LIMITE_LOGO_BYTES } from '../lib/logo.js';

function arquivo(over = {}) {
  return { name: 'logo.png', type: 'image/png', size: 40 * 1024, ...over };
}

test('validarLogo aceita PNG dentro do limite', () => {
  assert.deepEqual(validarLogo(arquivo()), { ok: true, erro: '' });
});

test('validarLogo recusa arquivo ausente', () => {
  assert.equal(validarLogo(null).ok, false);
  assert.match(validarLogo(null).erro, /Selecione/);
});

test('validarLogo recusa formato diferente de PNG', () => {
  const r = validarLogo(arquivo({ name: 'logo.jpg', type: 'image/jpeg' }));
  assert.equal(r.ok, false);
  assert.match(r.erro, /PNG/);
});

test('validarLogo aceita PNG cujo type veio vazio, pela extensão', () => {
  assert.equal(validarLogo(arquivo({ type: '' })).ok, true);
});

test('validarLogo recusa extensão .png com conteúdo declarado de outro tipo', () => {
  const r = validarLogo(arquivo({ name: 'logo.png', type: 'image/jpeg' }));
  assert.equal(r.ok, false);
  assert.match(r.erro, /PNG/);
});

test('validarLogo recusa arquivo acima do limite', () => {
  const r = validarLogo(arquivo({ size: LIMITE_LOGO_BYTES + 1 }));
  assert.equal(r.ok, false);
  assert.match(r.erro, /1 MB/);
});

test('validarLogo aceita arquivo exatamente no limite', () => {
  assert.equal(validarLogo(arquivo({ size: LIMITE_LOGO_BYTES })).ok, true);
});

test('validarLogo recusa arquivo vazio', () => {
  const r = validarLogo(arquivo({ size: 0 }));
  assert.equal(r.ok, false);
  assert.match(r.erro, /vazio/);
});

test('caminhoLogo monta o path com o id da empresa e o carimbo recebido', () => {
  assert.equal(caminhoLogo('abc-123', 1756137600000), 'abc-123/logo-1756137600000.png');
});

test('caminhoLogo exige o id da empresa', () => {
  assert.throws(() => caminhoLogo('', 1), /empresa/i);
});
