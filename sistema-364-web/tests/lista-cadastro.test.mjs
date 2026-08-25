import test from 'node:test';
import assert from 'node:assert/strict';
import { filtrarRegistros, textoDaBusca } from '../lib/listaCadastro.js';

const LISTA = [
  { id: 1, nome: 'Mercado Central', cnpj: '98765432000188', tipo: 'Revenda', ativo: true },
  { id: 2, nome: 'Açougue São José', cnpj: '11222333000144', tipo: 'Food Service', ativo: true },
  { id: 3, nome: 'Distribuidora Norte', cnpj: '55666777000122', tipo: 'Distribuidor', ativo: false },
];
const CAMPOS = ['nome', 'cnpj', 'tipo'];

test('sem busca, devolve os ativos', () => {
  const r = filtrarRegistros(LISTA, { campos: CAMPOS });
  assert.equal(r.length, 2);
  assert.ok(!r.some(x => x.ativo === false));
});

test('mostrarInativos traz todos', () => {
  assert.equal(filtrarRegistros(LISTA, { campos: CAMPOS, mostrarInativos: true }).length, 3);
});

test('busca por nome, parte do nome e CNPJ', () => {
  assert.equal(filtrarRegistros(LISTA, { campos: CAMPOS, busca: 'mercado' })[0].id, 1);
  assert.equal(filtrarRegistros(LISTA, { campos: CAMPOS, busca: 'central' })[0].id, 1);
  assert.equal(filtrarRegistros(LISTA, { campos: CAMPOS, busca: '9876' })[0].id, 1);
});

test('busca ignora acento e caixa — ninguém digita Açougue com cedilha na pressa', () => {
  assert.equal(filtrarRegistros(LISTA, { campos: CAMPOS, busca: 'acougue' })[0].id, 2);
  assert.equal(filtrarRegistros(LISTA, { campos: CAMPOS, busca: 'AÇOUGUE' })[0].id, 2);
  assert.equal(filtrarRegistros(LISTA, { campos: CAMPOS, busca: 'sao jose' })[0].id, 2);
});

test('busca por CNPJ funciona com máscara digitada', () => {
  assert.equal(filtrarRegistros(LISTA, { campos: CAMPOS, busca: '98.765.432/0001-88' })[0].id, 1);
  assert.equal(filtrarRegistros(LISTA, { campos: CAMPOS, busca: '11.222.333' })[0].id, 2);
});

test('busca alcança inativo só quando eles estão à mostra', () => {
  assert.equal(filtrarRegistros(LISTA, { campos: CAMPOS, busca: 'norte' }).length, 0);
  assert.equal(filtrarRegistros(LISTA, { campos: CAMPOS, busca: 'norte', mostrarInativos: true }).length, 1);
});

test('busca sem resultado devolve lista vazia, não a lista inteira', () => {
  assert.deepEqual(filtrarRegistros(LISTA, { campos: CAMPOS, busca: 'zzzz' }), []);
});

test('campo ausente ou nulo não quebra a busca', () => {
  const comBuraco = [{ id: 9, nome: 'Sem CNPJ', cnpj: null, ativo: true }];
  assert.equal(filtrarRegistros(comBuraco, { campos: CAMPOS, busca: 'sem' }).length, 1);
  assert.equal(filtrarRegistros(comBuraco, { campos: CAMPOS, busca: '123' }).length, 0);
});

test('textoDaBusca normaliza acento, caixa e espaço', () => {
  assert.equal(textoDaBusca('  Açougue São José '), 'acougue sao jose');
  assert.equal(textoDaBusca(null), '');
});
