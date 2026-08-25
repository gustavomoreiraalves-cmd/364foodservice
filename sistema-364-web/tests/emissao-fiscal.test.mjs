// tests/emissao-fiscal.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validarConfiguracaoEmissao, serieConflita, podeAjustarNumero,
} from '../lib/emissaoFiscal.js';

const BASE = { modelo: '55', ativo: true, ambiente: 'homologacao', serie: 1, cscId: null, cscToken: null, certificadoValido: true };

test('série <= 0 é rejeitada', () => {
  assert.ok(validarConfiguracaoEmissao({ ...BASE, serie: 0 }).some(e => /série/i.test(e)));
  assert.deepEqual(validarConfiguracaoEmissao({ ...BASE, serie: 1 }), []);
});

test('modelo 55 rejeita CSC preenchido', () => {
  const erros = validarConfiguracaoEmissao({ ...BASE, modelo: '55', cscId: '1', cscToken: 'x' });
  assert.ok(erros.some(e => /CSC/i.test(e) && /55|NF-e/i.test(e)));
});

test('modelo 65 ativo exige CSC completo', () => {
  const semCsc = validarConfiguracaoEmissao({ ...BASE, modelo: '65', ativo: true, cscId: null, cscToken: null });
  assert.ok(semCsc.some(e => /CSC/i.test(e)));

  const soId = validarConfiguracaoEmissao({ ...BASE, modelo: '65', ativo: true, cscId: '1', cscToken: null });
  assert.ok(soId.some(e => /CSC/i.test(e)));

  const completo = validarConfiguracaoEmissao({ ...BASE, modelo: '65', ativo: true, cscId: '1', cscToken: 'x' });
  assert.deepEqual(completo, []);
});

test('modelo 65 inativo não exige CSC', () => {
  assert.deepEqual(validarConfiguracaoEmissao({ ...BASE, modelo: '65', ativo: false, cscId: null, cscToken: null }), []);
});

test('ativar ambiente produção sem certificado válido é rejeitado', () => {
  const erros = validarConfiguracaoEmissao({ ...BASE, ambiente: 'producao', certificadoValido: false });
  assert.ok(erros.some(e => /certificado/i.test(e)));
  assert.deepEqual(validarConfiguracaoEmissao({ ...BASE, ambiente: 'producao', certificadoValido: true }), []);
});

test('inativo em produção não exige certificado', () => {
  assert.deepEqual(validarConfiguracaoEmissao({ ...BASE, ativo: false, ambiente: 'producao', certificadoValido: false }), []);
});

test('série duplicada no mesmo empregador+modelo+ambiente é rejeitada', () => {
  const existentes = [{ id: 'a', modelo: '55', ambiente: 'homologacao', serie: 1 }];
  assert.equal(serieConflita(existentes, { id: 'b', modelo: '55', ambiente: 'homologacao', serie: 1 }), true);
});

test('mesma série em ambiente diferente da mesma marca não conflita', () => {
  const existentes = [{ id: 'a', modelo: '55', ambiente: 'homologacao', serie: 1 }];
  assert.equal(serieConflita(existentes, { id: 'b', modelo: '55', ambiente: 'producao', serie: 1 }), false);
});

test('editar a própria linha não conflita consigo mesma', () => {
  const existentes = [{ id: 'a', modelo: '55', ambiente: 'homologacao', serie: 1 }];
  assert.equal(serieConflita(existentes, { id: 'a', modelo: '55', ambiente: 'homologacao', serie: 1 }), false);
});

test('ajuste de numeração: cria a primeira linha com qualquer valor >= 0', () => {
  assert.equal(podeAjustarNumero(null, 0), true);
  assert.equal(podeAjustarNumero(null, 847), true);
  assert.equal(podeAjustarNumero(null, -1), false);
});

test('ajuste de numeração: nunca reduz depois de existir', () => {
  assert.equal(podeAjustarNumero(847, 910), true);
  assert.equal(podeAjustarNumero(847, 847), false);
  assert.equal(podeAjustarNumero(847, 800), false);
});
