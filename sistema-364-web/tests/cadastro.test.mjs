import { test } from 'node:test';
import assert from 'node:assert/strict';
import { camposDoFormulario } from '../lib/cadastro.js';

const FORM_VAZIO = { nome: '', categoria: 'Carnes', validade_dias: 90, producao_interna: false };

test('camposDoFormulario: copia os campos que o formulário conhece', () => {
  const r = camposDoFormulario(
    { id: 'x', nome: 'Picanha', categoria: 'Bovinos', validade_dias: 30, producao_interna: true },
    FORM_VAZIO,
  );
  assert.deepEqual(r, { nome: 'Picanha', categoria: 'Bovinos', validade_dias: 30, producao_interna: true });
});

test('camposDoFormulario: ignora coluna que não está no formulário', () => {
  const r = camposDoFormulario({ nome: 'Picanha', empresa_id: 'e1', created_at: 'ontem' }, FORM_VAZIO);
  assert.deepEqual(Object.keys(r).sort(), ['categoria', 'nome', 'producao_interna', 'validade_dias']);
});

test('camposDoFormulario: null vira o padrão do formulário, não string vazia', () => {
  const r = camposDoFormulario({ nome: 'X', categoria: null, validade_dias: null }, FORM_VAZIO);
  assert.equal(r.categoria, 'Carnes');
  assert.equal(r.validade_dias, 90);
});

test('camposDoFormulario: chave ausente no registro cai no padrão', () => {
  assert.equal(camposDoFormulario({ nome: 'X' }, FORM_VAZIO).categoria, 'Carnes');
});

test('camposDoFormulario: false e 0 são preservados, não confundidos com vazio', () => {
  const r = camposDoFormulario({ nome: '', categoria: '', validade_dias: 0, producao_interna: false }, FORM_VAZIO);
  assert.equal(r.validade_dias, 0);
  assert.equal(r.producao_interna, false);
  assert.equal(r.categoria, '');
  assert.equal(r.nome, '');
});

test('camposDoFormulario: registro nulo devolve o formulário vazio', () => {
  assert.deepEqual(camposDoFormulario(null, FORM_VAZIO), FORM_VAZIO);
});
