import { test } from 'node:test';
import assert from 'node:assert/strict';
import { somenteDigitos, formatarCnpj, cnpjValido } from '../lib/cnpj.js';

test('somenteDigitos remove máscara', () => {
  assert.equal(somenteDigitos('37.541.736/0001-87'), '37541736000187');
  assert.equal(somenteDigitos(null), '');
});

test('formatarCnpj aplica máscara progressiva', () => {
  assert.equal(formatarCnpj('37541736000187'), '37.541.736/0001-87');
  assert.equal(formatarCnpj('3754'), '37.54');
  assert.equal(formatarCnpj(''), '');
});

test('cnpjValido confere dígitos verificadores', () => {
  assert.equal(cnpjValido('37541736000187'), true);
  assert.equal(cnpjValido('60361009000150'), true);
  assert.equal(cnpjValido('37541736000188'), false);
  assert.equal(cnpjValido('11111111111111'), false);
  assert.equal(cnpjValido('123'), false);
});
