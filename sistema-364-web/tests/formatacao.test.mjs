import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatarTelefone, capitalizarNome } from '../lib/formatacao.js';

test('formatarTelefone aplica máscara progressiva de fixo (8 dígitos)', () => {
  assert.equal(formatarTelefone('6932251234'), '(69) 3225-1234');
  assert.equal(formatarTelefone('69322'), '(69) 322');
  assert.equal(formatarTelefone('69'), '(69');
  assert.equal(formatarTelefone(''), '');
});

test('formatarTelefone aplica máscara progressiva de celular (9 dígitos)', () => {
  assert.equal(formatarTelefone('69998414082'), '(69) 99841-4082');
});

test('formatarTelefone ignora caracteres não numéricos e corta em 11 dígitos', () => {
  assert.equal(formatarTelefone('(69) 99841-4082 ramal 5'), '(69) 99841-4082');
});

test('capitalizarNome maiuscula a primeira letra de cada palavra', () => {
  assert.equal(capitalizarNome('supermercado manar ltda'), 'Supermercado Manar Ltda');
});

test('capitalizarNome mantém preposições em minúsculo, exceto na primeira palavra', () => {
  assert.equal(capitalizarNome('casa de carne boi nobre'), 'Casa de Carne Boi Nobre');
  assert.equal(capitalizarNome('de carne'), 'De Carne');
});

test('capitalizarNome não quebra com espaços duplicados ou nome vazio', () => {
  assert.equal(capitalizarNome('joão  da  silva'), 'João  da  Silva');
  assert.equal(capitalizarNome(''), '');
  assert.equal(capitalizarNome('   '), '   ');
});

test('capitalizarNome preserva siglas maiúsculas comuns (LTDA, ME, EIRELI)', () => {
  assert.equal(capitalizarNome('mercado bom preco EIRELI'), 'Mercado Bom Preco EIRELI');
});
