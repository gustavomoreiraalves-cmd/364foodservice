import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATUS_PEDIDO, podeEditar, totalPedido, precoDoItem, diffItens, saldoDisponivel } from '../lib/pedidos.js';

test('STATUS_PEDIDO: os quatro status na ordem do fluxo', () => {
  assert.deepEqual(STATUS_PEDIDO, ['Pendente', 'Faturado', 'Enviado', 'Cancelado']);
});

test('podeEditar: só Pendente edita', () => {
  assert.equal(podeEditar('Pendente'), true);
  assert.equal(podeEditar('Faturado'), false);
  assert.equal(podeEditar('Enviado'), false);
  assert.equal(podeEditar('Cancelado'), false);
});

test('podeEditar: status desconhecido do banco não libera edição', () => {
  assert.equal(podeEditar('Em separação'), false);
  assert.equal(podeEditar(null), false);
  assert.equal(podeEditar(undefined), false);
});

test('totalPedido: soma quantidade x preço', () => {
  const itens = [
    { quantidade: 2, preco_unitario: 10.5 },
    { quantidade: 3, preco_unitario: 4 },
  ];
  assert.equal(totalPedido(itens), 33);
});

test('totalPedido: numeric do Postgres chega como string', () => {
  const itens = [{ quantidade: '2.5000', preco_unitario: '10.00' }];
  assert.equal(totalPedido(itens), 25);
});

test('totalPedido: lista vazia, nula e item sem preço valem zero', () => {
  assert.equal(totalPedido([]), 0);
  assert.equal(totalPedido(null), 0);
  assert.equal(totalPedido([{ quantidade: 3, preco_unitario: null }]), 0);
});

test('precoDoItem: preço digitado vence o preço de venda do produto', () => {
  assert.equal(precoDoItem('12.34', { preco_venda: 50 }), 12.34);
});

test('precoDoItem: preço vazio cai no preço de venda do produto', () => {
  assert.equal(precoDoItem('', { preco_venda: '50.00' }), 50);
  assert.equal(precoDoItem(null, { preco_venda: 50 }), 50);
});

test('precoDoItem: produto sem preço de venda vale zero', () => {
  assert.equal(precoDoItem('', {}), 0);
  assert.equal(precoDoItem('', null), 0);
});

test('precoDoItem: zero digitado é preço zero, não cai no produto', () => {
  assert.equal(precoDoItem('0', { preco_venda: 50 }), 0);
});

const original = [
  { id: 'a', produto_id: 'p1', quantidade: 2, preco_unitario: 10 },
  { id: 'b', produto_id: 'p2', quantidade: 5, preco_unitario: 4 },
  { id: 'c', produto_id: 'p3', quantidade: 1, preco_unitario: 99 },
];

test('diffItens: item intocado não gera update', () => {
  const r = diffItens(original, original);
  assert.deepEqual(r, { inserir: [], atualizar: [], remover: [] });
});

test('diffItens: item novo entra em inserir, sem id', () => {
  const atual = [...original, { produto_id: 'p4', quantidade: 7, preco_unitario: 2.5 }];
  const r = diffItens(original, atual);
  assert.equal(r.inserir.length, 1);
  assert.equal(r.inserir[0].produto_id, 'p4');
  assert.equal(r.inserir[0].id, undefined);
  assert.deepEqual(r.atualizar, []);
  assert.deepEqual(r.remover, []);
});

test('diffItens: item removido entra em remover, só o id', () => {
  const atual = original.filter(i => i.id !== 'b');
  const r = diffItens(original, atual);
  assert.deepEqual(r.remover, ['b']);
  assert.deepEqual(r.inserir, []);
  assert.deepEqual(r.atualizar, []);
});

test('diffItens: quantidade alterada entra em atualizar', () => {
  const atual = original.map(i => (i.id === 'a' ? { ...i, quantidade: 9 } : i));
  const r = diffItens(original, atual);
  assert.equal(r.atualizar.length, 1);
  assert.equal(r.atualizar[0].id, 'a');
  assert.equal(r.atualizar[0].quantidade, 9);
});

test('diffItens: preço alterado entra em atualizar', () => {
  const atual = original.map(i => (i.id === 'c' ? { ...i, preco_unitario: 88 } : i));
  const r = diffItens(original, atual);
  assert.equal(r.atualizar.length, 1);
  assert.equal(r.atualizar[0].id, 'c');
  assert.equal(r.atualizar[0].preco_unitario, 88);
});

test('diffItens: string e número com o mesmo valor não contam como alteração', () => {
  const atual = original.map(i => (i.id === 'a' ? { ...i, quantidade: '2.0000', preco_unitario: '10.00' } : i));
  assert.deepEqual(diffItens(original, atual).atualizar, []);
});

test('diffItens: trocar o produto do item conta como alteração', () => {
  const atual = original.map(i => (i.id === 'b' ? { ...i, produto_id: 'p9' } : i));
  const r = diffItens(original, atual);
  assert.equal(r.atualizar.length, 1);
  assert.equal(r.atualizar[0].produto_id, 'p9');
});

test('diffItens: pedido esvaziado remove todos', () => {
  const r = diffItens(original, []);
  assert.deepEqual(r.remover.sort(), ['a', 'b', 'c']);
});

test('diffItens: pedido novo (original vazio) só insere', () => {
  const r = diffItens([], [{ produto_id: 'p1', quantidade: 1, preco_unitario: 5 }]);
  assert.equal(r.inserir.length, 1);
  assert.deepEqual(r.remover, []);
});

const estoque = [
  { produto_id: 'p1', saldo: 0 },
  { produto_id: 'p2', saldo: 7.5 },
];

test('saldoDisponivel: no cadastro, sem itens gravados, é o saldo da view', () => {
  assert.equal(saldoDisponivel(estoque, [], 'p2'), 7.5);
});

test('saldoDisponivel: na edição, soma de volta o que este pedido reservou', () => {
  // A view já descontou os 10 deste mesmo pedido: saldo 0 com 10 produzidos.
  const jaGravados = [{ id: 'a', produto_id: 'p1', quantidade: 10 }];
  assert.equal(saldoDisponivel(estoque, jaGravados, 'p1'), 10);
});

test('saldoDisponivel: soma todas as linhas do mesmo produto', () => {
  const jaGravados = [
    { id: 'a', produto_id: 'p2', quantidade: 2 },
    { id: 'b', produto_id: 'p2', quantidade: '3.5000' },
    { id: 'c', produto_id: 'p1', quantidade: 100 },
  ];
  assert.equal(saldoDisponivel(estoque, jaGravados, 'p2'), 13);
});

test('saldoDisponivel: produto fora da view devolve o que o pedido reservou', () => {
  assert.equal(saldoDisponivel(estoque, [], 'p9'), 0);
  assert.equal(saldoDisponivel(estoque, [{ produto_id: 'p9', quantidade: 4 }], 'p9'), 4);
});
