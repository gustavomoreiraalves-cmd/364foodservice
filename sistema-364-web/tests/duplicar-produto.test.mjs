process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'chave-anon-de-teste';

import { test } from 'node:test';
import assert from 'node:assert/strict';
const { camposParaDuplicar } = await import('../lib/cadastro.js');

const FORM_VAZIO = { nome: '', categoria: '', ncm: '', cest: '' };
const CAMPOS_FISCAIS = ['ncm', 'cest'];

test('copia todos os campos quando fiscal está marcado', () => {
  const origem = { nome: 'Pantaneiro', categoria: 'Hambúrguer', ncm: '16025000', cest: '1708300' };
  const resultado = camposParaDuplicar(origem, FORM_VAZIO, CAMPOS_FISCAIS, { fiscal: true });
  assert.equal(resultado.ncm, '16025000');
  assert.equal(resultado.cest, '1708300');
  assert.equal(resultado.nome, 'Pantaneiro');
});

test('zera os campos fiscais quando fiscal não está marcado', () => {
  const origem = { nome: 'Pantaneiro', categoria: 'Hambúrguer', ncm: '16025000', cest: '1708300' };
  const resultado = camposParaDuplicar(origem, FORM_VAZIO, CAMPOS_FISCAIS, { fiscal: false });
  assert.equal(resultado.ncm, '');
  assert.equal(resultado.cest, '');
  assert.equal(resultado.nome, 'Pantaneiro');
});
