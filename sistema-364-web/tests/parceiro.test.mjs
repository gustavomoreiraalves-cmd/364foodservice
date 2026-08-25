import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarListaParceiros } from '../lib/parceiro.js';

const CLIENTE_SOLTO = { id: 'c1', nome: 'Açougue Central', nome_fantasia: null, cnpj: '111', contato: 'A', telefone: '1', tipo: 'Revenda', municipio: 'Ji-Paraná', uf: 'RO', ativo: true, fornecedor_vinculado_id: null };
const FORNECEDOR_SOLTO = { id: 'f1', nome: 'Distribuidora XYZ', nome_fantasia: null, cnpj: '222', contato: 'B', telefone: '2', categoria: 'Embalagens', email: 'xyz@ex.com', ativo: true, cliente_vinculado_id: null };

test('montarListaParceiros: cliente sem vínculo vira uma linha com papel só cliente', () => {
  const lista = montarListaParceiros([CLIENTE_SOLTO], []);
  assert.equal(lista.length, 1);
  assert.deepEqual(lista[0].papeis, ['cliente']);
  assert.equal(lista[0].id, 'c:c1');
  assert.equal(lista[0].clienteId, 'c1');
  assert.equal(lista[0].fornecedorId, null);
  assert.equal(lista[0].nome, 'Açougue Central');
  assert.equal(lista[0].categoria, '');
});

test('montarListaParceiros: fornecedor sem vínculo vira uma linha com papel só fornecedor', () => {
  const lista = montarListaParceiros([], [FORNECEDOR_SOLTO]);
  assert.equal(lista.length, 1);
  assert.deepEqual(lista[0].papeis, ['fornecedor']);
  assert.equal(lista[0].id, 'f:f1');
  assert.equal(lista[0].clienteId, null);
  assert.equal(lista[0].fornecedorId, 'f1');
  assert.equal(lista[0].categoria, 'Embalagens');
  assert.equal(lista[0].tipo, '');
});

test('montarListaParceiros: par vinculado vira uma linha só, com os dois papéis', () => {
  const cliente = { ...CLIENTE_SOLTO, id: 'c2', nome: 'Manar', fornecedor_vinculado_id: 'f2' };
  const fornecedor = { ...FORNECEDOR_SOLTO, id: 'f2', nome: 'Manar', cliente_vinculado_id: 'c2' };
  const lista = montarListaParceiros([cliente], [fornecedor]);
  assert.equal(lista.length, 1);
  assert.deepEqual(lista[0].papeis, ['cliente', 'fornecedor']);
  assert.equal(lista[0].id, 'c:c2+f:f2');
  assert.equal(lista[0].clienteId, 'c2');
  assert.equal(lista[0].fornecedorId, 'f2');
  assert.equal(lista[0].nome, 'Manar');
  assert.equal(lista[0].categoria, 'Embalagens'); // veio do lado fornecedor
  assert.equal(lista[0].tipo, 'Revenda'); // veio do lado cliente
});

test('montarListaParceiros: vínculo quebrado (aponta pra id que não existe na lista) trata como solto', () => {
  const cliente = { ...CLIENTE_SOLTO, id: 'c3', fornecedor_vinculado_id: 'nao-existe' };
  const lista = montarListaParceiros([cliente], []);
  assert.equal(lista.length, 1);
  assert.deepEqual(lista[0].papeis, ['cliente']);
});

test('montarListaParceiros: ativo é true só se os dois lados vinculados estiverem ativos', () => {
  const cliente = { ...CLIENTE_SOLTO, id: 'c4', fornecedor_vinculado_id: 'f4', ativo: true };
  const fornecedor = { ...FORNECEDOR_SOLTO, id: 'f4', cliente_vinculado_id: 'c4', ativo: false };
  const lista = montarListaParceiros([cliente], [fornecedor]);
  assert.equal(lista[0].ativo, false);
});

test('montarListaParceiros: ordena por nome (pt-BR, ignora maiúscula/acento)', () => {
  const lista = montarListaParceiros(
    [{ ...CLIENTE_SOLTO, id: 'c5', nome: 'Zebra' }, { ...CLIENTE_SOLTO, id: 'c6', nome: 'Água' }],
    [],
  );
  assert.deepEqual(lista.map(p => p.nome), ['Água', 'Zebra']);
});

test('montarListaParceiros: listas vazias não quebram', () => {
  assert.deepEqual(montarListaParceiros([], []), []);
  assert.deepEqual(montarListaParceiros(null, undefined), []);
});
