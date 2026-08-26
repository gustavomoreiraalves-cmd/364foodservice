import test from 'node:test';
import assert from 'node:assert/strict';
import { montarChaveAcesso, digitoVerificadorChave, gerarCodigoNumerico } from '../lib/nfe/chaveAcesso.js';

const BASE = {
  cUF: '11', dataEmissao: new Date('2026-08-25T10:00:00-03:00'),
  cnpj: '37541736000187', modelo: '55', serie: 1, numero: 1,
  tipoEmissao: '1', codigoNumerico: '10000001',
};

test('a chave tem exatamente 44 dígitos', () => {
  const chave = montarChaveAcesso(BASE);
  assert.equal(chave.length, 44);
  assert.match(chave, /^\d{44}$/);
});

test('cada campo ocupa a posição que a SEFAZ espera', () => {
  const chave = montarChaveAcesso(BASE);
  assert.equal(chave.slice(0, 2), '11', 'cUF');
  assert.equal(chave.slice(2, 6), '2608', 'AAMM');
  assert.equal(chave.slice(6, 20), '37541736000187', 'CNPJ');
  assert.equal(chave.slice(20, 22), '55', 'modelo');
  assert.equal(chave.slice(22, 25), '001', 'série com zeros à esquerda');
  assert.equal(chave.slice(25, 34), '000000001', 'número com zeros à esquerda');
  assert.equal(chave.slice(34, 35), '1', 'tpEmis');
  assert.equal(chave.slice(35, 43), '10000001', 'cNF');
});

test('o dígito verificador fecha a própria chave', () => {
  const chave = montarChaveAcesso(BASE);
  assert.equal(Number(chave[43]), digitoVerificadorChave(chave.slice(0, 43)));
});

test('DV: resto 0 ou 1 vira dígito 0', () => {
  // 43 zeros somam 0; resto 0 → DV 0.
  assert.equal(digitoVerificadorChave('0'.repeat(43)), 0);
});

test('DV muda quando qualquer dígito muda — é o que o torna útil', () => {
  const chave = montarChaveAcesso(BASE);
  const adulterada = chave.slice(0, 42) + (chave[42] === '9' ? '0' : String(Number(chave[42]) + 1));
  assert.notEqual(digitoVerificadorChave(adulterada), Number(chave[43]));
});

test('DV exige exatamente 43 dígitos', () => {
  assert.throws(() => digitoVerificadorChave('123'), /43/);
});

test('série e número acima do que cabe são recusados, não truncados', () => {
  assert.throws(() => montarChaveAcesso({ ...BASE, serie: 1000 }), /série/i);
  assert.throws(() => montarChaveAcesso({ ...BASE, numero: 1000000000 }), /número/i);
});

test('gerarCodigoNumerico devolve 8 dígitos e nunca repete o número da nota', () => {
  for (let i = 0; i < 200; i++) {
    const cnf = gerarCodigoNumerico(12345);
    assert.match(cnf, /^\d{8}$/);
    assert.notEqual(Number(cnf), 12345, 'cNF igual a nNF é rejeição 539 na SEFAZ');
  }
});
