import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  dataConnect, diaLocalConnect, dataBr, diaLocal, dinheiro, quantidade,
  parsePedidoDetalhe, parseCaixaDetalhe,
} from '../lib/pdvConsumer/parse.js';

const fx = nome => readFileSync(new URL(`./fixtures/pdv/${nome}`, import.meta.url), 'utf8');

test('dataConnect trata /Date/ como hora local de Porto Velho', () => {
  // 1786997631620 = 2026-08-17T20:13:51Z no relógio do Connect = 20:13:51 local
  const d = dataConnect('/Date(1786997631620)/');
  assert.equal(d.toISOString(), '2026-08-18T00:13:51.620Z');
  assert.equal(diaLocalConnect('/Date(1786997631620)/'), '2026-08-17');
  assert.equal(dataConnect(null), null);
  assert.equal(dataConnect(''), null);
});

test('dataBr converte dd/mm/aaaa hh:mm:ss local', () => {
  assert.equal(dataBr('17/08/2026 20:13:51').toISOString(), '2026-08-18T00:13:51.000Z');
  assert.equal(dataBr('21/08/2026').toISOString(), '2026-08-21T04:00:00.000Z');
  assert.equal(dataBr(''), null);
  assert.equal(dataBr('  '), null);
});

test('diaLocal devolve o dia em Porto Velho de um instante real', () => {
  // 00:13Z do dia 18 ainda é 20:13 do dia 17 em Porto Velho
  assert.equal(diaLocal(new Date('2026-08-18T00:13:51Z')), '2026-08-17');
  assert.equal(diaLocal(new Date('2026-08-18T04:00:00Z')), '2026-08-18');
});

test('dinheiro e quantidade no formato brasileiro', () => {
  assert.equal(dinheiro('R$ 7.902,13'), 7902.13);
  assert.equal(dinheiro('R$ 0,00'), 0);
  assert.equal(dinheiro(''), null);
  assert.equal(dinheiro(undefined), null);
  assert.equal(quantidade('3,0000'), 3);
  assert.equal(quantidade('0,5000'), 0.5);
});

test('parsePedidoDetalhe lê pedido de mesa com complemento e três pagamentos', () => {
  const p = parsePedidoDetalhe(fx('pedido-mesa.html'));
  assert.equal(p.codigo, 74941);
  assert.equal(p.origem, 'Comanda Mobile');
  assert.equal(p.tipoOriginal, 'Mesas/Comandas');
  assert.equal(p.status, 'Finalizado Pago');
  assert.equal(p.numero, 2);
  assert.equal(p.abertoEm.toISOString(), '2026-08-18T00:13:51.000Z');
  assert.equal(p.fechadoEm.toISOString(), '2026-08-18T00:32:39.000Z');
  assert.equal(p.colaborador, 'Colaboradora Teste');

  assert.equal(p.itens.length, 7); // 4 pais + 3 filhos; linhas de subtotal não contam
  assert.deepEqual(p.itens[0], {
    posicao: 1, nome: 'Suco Laranja 500ml',
    observacao: '1 copo, Ir agora, Com açucar, somente lançando',
    quantidade: 3, precoUnitario: 18.9, valor: 56.7, itemPaiPosicao: null, ehCombo: false,
  });
  assert.equal(p.itens[1].nome, 'Burguer');
  assert.equal(p.itens[1].ehCombo, true);
  assert.deepEqual(p.itens[2], {
    posicao: 3, nome: 'Queijo Mussarela', observacao: null,
    quantidade: 1, precoUnitario: 5.9, valor: 5.9, itemPaiPosicao: 2, ehCombo: false,
  });

  assert.deepEqual(p.totais, {
    valorTotal: 160.71, valorDesconto: 0, valorItens: 146.1,
    valorEntrega: null, valorServico: 14.61, valorAcrescimo: null,
  });

  assert.equal(p.pagamentos.length, 3);
  assert.deepEqual(p.pagamentos[2], {
    posicao: 3, valor: 53.57, forma: 'Pix Manual', operadora: '(69)99280-1420', pagoEm: null,
  });
  assert.equal(p.pagamentos[0].forma, 'Cartão de Crédito');
});

test('parsePedidoDetalhe lê delivery com entrega e sem número', () => {
  const p = parsePedidoDetalhe(fx('pedido-delivery.html'));
  assert.equal(p.codigo, 74940);
  assert.equal(p.tipoOriginal, 'Delivery');
  assert.equal(p.origem, 'MenuDino App/Site');
  assert.equal(p.numero, null);
  assert.equal(p.itens.length, 1);
  assert.equal(p.itens[0].observacao, 'Vinagrete');
  assert.equal(p.totais.valorEntrega, 8);
  assert.equal(p.totais.valorServico, null);
  assert.equal(p.pagamentos.length, 1);
  assert.equal(p.pagamentos[0].valor, 50.9);
});

test('parseCaixaDetalhe lê cabeçalho, movimentações e saldo', () => {
  const c = parseCaixaDetalhe(fx('caixa-fechado.html'));
  assert.equal(c.codigo, 1561);
  assert.equal(c.usuario, 'Caixa');
  assert.equal(c.status, 'Fechado');
  assert.equal(c.abertoEm.toISOString(), '2026-08-21T21:40:14.000Z');
  assert.equal(c.saldoInicial, 178.6);
  assert.equal(c.totalDinheiro, 178.6);
  assert.equal(c.saldoAtual, 7902.13);

  // Abertura + 5 recebimentos + sangria + 2 recebimentos; "Saldo Atual" não é movimento
  assert.equal(c.movimentos.length, 9);
  assert.deepEqual(c.movimentos[0], {
    posicao: 1, operacao: 'Abertura', origem: 'Caixa', pedidoCodigo: null,
    momento: new Date('2026-08-21T21:40:14Z'), entrada: 178.6, saida: null,
    meio: 'Diversos', observacao: null,
  });
  assert.deepEqual(c.movimentos[1], {
    posicao: 2, operacao: 'Recebimento', origem: 'Pedido 75089', pedidoCodigo: 75089,
    momento: new Date('2026-08-21T22:37:37Z'), entrada: 139.6, saida: null,
    meio: 'Cartão de Crédito Mastercard', observacao: 'Levar Máquina - Lanç. Aut.',
  });
  assert.equal(c.movimentos[5].observacao, null); // "Recebimento" sem popover
  assert.deepEqual(c.movimentos[6], {
    posicao: 7, operacao: 'Sangria', origem: 'Caixa', pedidoCodigo: null,
    momento: new Date('2026-08-22T01:00:00Z'), entrada: null, saida: 100,
    meio: 'Dinheiro', observacao: null,
  });
});
