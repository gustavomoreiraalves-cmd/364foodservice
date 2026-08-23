import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePedidoDetalhe, parseCaixaDetalhe } from '../lib/pdvConsumer/parse.js';
import {
  classificaTipo, classificaForma, separaMeio, pedidoMudou,
  normalizaPedido, normalizaCaixa, normalizaRecebimento, normalizaItemDia,
} from '../lib/pdvConsumer/normaliza.js';

const fx = nome => readFileSync(new URL(`./fixtures/pdv/${nome}`, import.meta.url), 'utf8');
const json = nome => JSON.parse(fx(nome));
const EMPRESA = '0dda3c8e-228b-4d05-b50a-2e2f301d75a3';

test('classificaTipo', () => {
  assert.equal(classificaTipo('Mesas/Comandas'), 'mesa');
  assert.equal(classificaTipo('Delivery'), 'delivery');
  assert.equal(classificaTipo('Balcão'), 'outro');
  assert.equal(classificaTipo(null), 'outro');
});

test('classificaForma cobre as formas vistas no painel', () => {
  assert.equal(classificaForma('Pix Manual', '(69)99280-1420'), 'pix');
  assert.equal(classificaForma('Cartão de Crédito', 'Mastercard'), 'credito');
  assert.equal(classificaForma('Cartão de Débito', 'Visa'), 'debito');
  assert.equal(classificaForma('Dinheiro', null), 'dinheiro');
  assert.equal(classificaForma('iFood Online', 'Outros'), 'ifood_online');
  assert.equal(classificaForma('iFood Online', 'Voucher'), 'ifood_online');
  assert.equal(classificaForma('Vale Refeição', 'Voucher'), 'voucher');
  assert.equal(classificaForma('Fiado', null), 'fiado');
  assert.equal(classificaForma('Delivery Much', 'Outros'), 'outro');
  assert.equal(classificaForma(null, null), 'outro');
});

test('separaMeio divide forma e operadora do texto do caixa', () => {
  assert.deepEqual(separaMeio('Cartão de Crédito Mastercard'), { forma: 'Cartão de Crédito', operadora: 'Mastercard' });
  assert.deepEqual(separaMeio('iFood Online Outros'), { forma: 'iFood Online', operadora: 'Outros' });
  assert.deepEqual(separaMeio('Pix Manual (69)99280-1420'), { forma: 'Pix Manual', operadora: '(69)99280-1420' });
  assert.deepEqual(separaMeio('Vale Refeição Voucher'), { forma: 'Vale Refeição', operadora: 'Voucher' });
  assert.deepEqual(separaMeio('Dinheiro'), { forma: 'Dinheiro', operadora: null });
  assert.deepEqual(separaMeio('Diversos'), { forma: 'Diversos', operadora: null });
});

test('pedidoMudou compara status, valor e exclusão', () => {
  const linha = json('pedidos-lista.json').data[0];
  assert.equal(pedidoMudou(linha, null), true);
  assert.equal(pedidoMudou(linha, { status: 'Finalizado Pago', valor_total: 160.71, excluido_em: null, fechado_em: '2026-08-18T00:32:39.463+00:00' }), false);
  assert.equal(pedidoMudou(linha, { status: 'Em Aberto', valor_total: 160.71, excluido_em: null, fechado_em: null }), true);
  assert.equal(pedidoMudou(linha, { status: 'Finalizado Pago', valor_total: 100, excluido_em: null, fechado_em: '2026-08-18T00:32:39.463+00:00' }), true);
});

test('normalizaPedido monta pedido, itens e pagamentos para o banco', () => {
  const linha = json('pedidos-lista.json').data[0];
  const html = fx('pedido-mesa.html');
  // O importador anexa o HTML bruto ao detalhe; o normalizador só repassa.
  const detalhe = { ...parsePedidoDetalhe(html), html };
  const { pedido, itens, pagamentos } = normalizaPedido({ linha, detalhe, empresaId: EMPRESA });
  assert.equal(pedido.empresa_id, EMPRESA);
  assert.equal(pedido.codigo, 74941);
  assert.equal(pedido.id_connect, -1486004890);
  assert.equal(pedido.tipo, 'mesa');
  assert.equal(pedido.tipo_original, 'Mesas/Comandas');
  assert.equal(pedido.origem, 'Comanda Mobile');
  assert.equal(pedido.status, 'Finalizado Pago');
  assert.equal(pedido.finalizado, true);
  assert.equal(pedido.numero, 2);
  assert.equal(pedido.qtd_itens, 6);
  assert.equal(pedido.valor_total, 160.71);
  assert.equal(pedido.valor_servico, 14.61);
  assert.equal(pedido.aberto_em, '2026-08-18T00:13:51.620Z');
  assert.equal(pedido.dia_venda, '2026-08-17');
  assert.equal(pedido.excluido_em, null);
  assert.equal(pedido.origem_raw.Codigo, 74941);
  assert.equal(typeof pedido.origem_html, 'string');
  assert.equal(itens.length, 7);
  assert.equal(itens[2].item_pai_posicao, 2);
  assert.equal(pagamentos.length, 3);
  assert.equal(pagamentos[2].forma_grupo, 'pix');
  assert.equal(pagamentos[0].forma_grupo, 'credito');
});

test('normalizaPedido sem detalhe (pedido em aberto) usa só a linha', () => {
  const linha = json('pedidos-lista.json').data[2];
  const { pedido, itens, pagamentos } = normalizaPedido({ linha, detalhe: null, empresaId: EMPRESA });
  assert.equal(pedido.finalizado, false);
  assert.equal(pedido.tipo, 'delivery');
  assert.equal(pedido.dia_venda, '2026-08-22');
  assert.equal(pedido.fechado_em, null);
  assert.deepEqual(itens, []);
  assert.deepEqual(pagamentos, []);
});

test('normalizaCaixa', () => {
  const linha = json('caixas-lista.json').data[1];
  const html = fx('caixa-fechado.html');
  const detalhe = { ...parseCaixaDetalhe(html), html };
  const { caixa, movimentos } = normalizaCaixa({ linha, detalhe, empresaId: EMPRESA });
  assert.equal(caixa.codigo, 1561);
  assert.equal(caixa.status, 'Fechado');
  assert.equal(caixa.aberto_em, '2026-08-21T21:40:14.000Z');
  assert.equal(caixa.fechado_em, '2026-08-22T03:47:18.000Z');
  assert.equal(caixa.dia_caixa, '2026-08-21');
  assert.equal(caixa.saldo_final, 7902.13);
  assert.equal(caixa.total_dinheiro, 178.6);
  assert.equal(movimentos.length, 9);
  assert.equal(movimentos[1].pedido_codigo, 75089);
  assert.equal(movimentos[1].forma, 'Cartão de Crédito');
  assert.equal(movimentos[1].operadora, 'Mastercard');
  assert.equal(movimentos[1].forma_grupo, 'credito');
  assert.equal(movimentos[6].saida, 100);
  assert.equal(movimentos[6].forma_grupo, 'dinheiro');
});

test('normalizaRecebimento guarda taxa, líquido e data de crédito', () => {
  const r = normalizaRecebimento(json('recebimentos-lista.json').data[2], EMPRESA);
  assert.equal(r.pedido_codigo, 75090);
  assert.equal(r.caixa_codigo, 1561);
  assert.equal(r.forma, 'iFood Online');
  assert.equal(r.operadora, 'Outros');
  assert.equal(r.forma_grupo, 'ifood_online');
  assert.equal(r.valor, 136.09);
  assert.equal(r.valor_liquido, 119.76);
  assert.equal(r.percentual_taxa, 12);
  assert.equal(r.pago_em, '2026-08-21T22:42:57.000Z');
  assert.equal(r.dia_pagamento, '2026-08-21');
  assert.equal(r.credito_em, '2026-09-20');
  const dinheiro = normalizaRecebimento(json('recebimentos-lista.json').data[1], EMPRESA);
  assert.equal(dinheiro.operadora, null);
  assert.equal(dinheiro.forma_grupo, 'dinheiro');
});

test('normalizaItemDia', () => {
  const i = normalizaItemDia(json('produtos-vendidos.json').data[0], '2026-08-21', EMPRESA);
  assert.equal(i.dia, '2026-08-21');
  assert.equal(i.codigo_produto, 172);
  assert.equal(i.codigo_detalhe, 203);
  assert.equal(i.nome, 'Bife Ancho');
  assert.equal(i.categoria, 'Churrasco');
  assert.equal(i.quantidade, 22);
  assert.equal(i.valor_vendido, 1993.8);
  assert.equal(i.curva_abc, 'A');
  assert.equal(i.margem, 57.7);
});
