import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  periodoPadrao, periodoAnterior, kpis, variacao, porDia, porOrigem, porForma,
  itensPeriodo, statusImportacao, importacaoTravada, HORAS_IMPORTACAO_TRAVADA, ROTULOS_FORMA,
} from '../lib/pdvVendas.js';

const V = [
  { dia: '2026-08-21', tipo: 'mesa', origem: 'Comanda Mobile', qtd_pedidos: 10, qtd_itens: 40, valor_total: 1000 },
  { dia: '2026-08-21', tipo: 'delivery', origem: 'iFood', qtd_pedidos: 5, qtd_itens: 10, valor_total: 500 },
  { dia: '2026-08-22', tipo: 'mesa', origem: 'Comanda Mobile', qtd_pedidos: 8, qtd_itens: 24, valor_total: 800 },
  { dia: '2026-08-22', tipo: 'delivery', origem: 'MenuDino App/Site', qtd_pedidos: 2, qtd_itens: 4, valor_total: 100 },
];

test('periodoPadrao e periodoAnterior', () => {
  assert.deepEqual(periodoPadrao(new Date('2026-08-23T15:00:00Z')), { de: '2026-08-01', ate: '2026-08-23' });
  // 02:00Z de 01/09 já é 22:00 de 31/08 em Porto Velho (UTC-4): "hoje" ainda é agosto.
  assert.deepEqual(periodoPadrao(new Date('2026-09-01T02:00:00Z')), { de: '2026-08-01', ate: '2026-08-31' });
  // 03:59Z de 24/08 é 23:59 de 23/08 local: "hoje" ainda é 23, não 24.
  assert.deepEqual(periodoPadrao(new Date('2026-08-24T03:59:00Z')), { de: '2026-08-01', ate: '2026-08-23' });
  assert.deepEqual(periodoAnterior({ de: '2026-08-01', ate: '2026-08-23' }), { de: '2026-07-09', ate: '2026-07-31' });
  assert.deepEqual(periodoAnterior({ de: '2026-08-21', ate: '2026-08-21' }), { de: '2026-08-20', ate: '2026-08-20' });
});

test('kpis', () => {
  const k = kpis(V);
  assert.equal(k.faturamento, 2400);
  assert.equal(k.pedidos, 25);
  assert.equal(k.ticketMedio, 96);
  assert.equal(k.itensPorPedido, 78 / 25);
  assert.equal(k.pctDelivery, 600 / 2400 * 100);
  assert.deepEqual(kpis([]), { faturamento: 0, pedidos: 0, ticketMedio: 0, itensPorPedido: 0, pctDelivery: 0 });
});

test('variacao', () => {
  assert.equal(variacao(120, 100), 20);
  assert.equal(variacao(80, 100), -20);
  assert.equal(variacao(50, 0), null);
});

test('porDia empilha mesa e delivery', () => {
  const d = porDia(V);
  assert.equal(d.length, 2);
  assert.deepEqual(d[0], { dia: '2026-08-21', mesa: 1000, delivery: 500, outro: 0, total: 1500, pedidos: 15, ticket: 100 });
});

test('porOrigem ordena por valor e calcula participação', () => {
  const o = porOrigem(V);
  assert.equal(o[0].origem, 'Comanda Mobile');
  assert.equal(o[0].valor, 1800);
  assert.equal(o[0].pct, 75);
  assert.equal(o[1].origem, 'iFood');
});

test('porForma agrupa por forma_grupo com total', () => {
  const F = [
    { forma_grupo: 'credito', forma: 'Cartão de Crédito', operadora: 'Visa', qtd: 3, valor_bruto: 300, valor_liquido: 291, taxa: 9 },
    { forma_grupo: 'credito', forma: 'Cartão de Crédito', operadora: 'Mastercard', qtd: 2, valor_bruto: 200, valor_liquido: 194, taxa: 6 },
    { forma_grupo: 'pix', forma: 'Pix Manual', operadora: '(69)9', qtd: 4, valor_bruto: 400, valor_liquido: 400, taxa: 0 },
  ];
  const r = porForma(F);
  assert.equal(r.linhas.length, 2);
  assert.deepEqual(r.linhas[0], { formaGrupo: 'credito', rotulo: 'Cartão de crédito', qtd: 5, bruto: 500, taxa: 15, liquido: 485 });
  assert.deepEqual(r.total, { qtd: 9, bruto: 900, taxa: 15, liquido: 885 });
  assert.equal(ROTULOS_FORMA.ifood_online, 'iFood online');
});

test('itensPeriodo soma dias e recalcula ABC', () => {
  const I = [
    { dia: '2026-08-21', codigo_detalhe: 1, nome: 'Ancho', categoria: 'Churrasco', quantidade: 10, valor_vendido: 800, lucro: 400 },
    { dia: '2026-08-22', codigo_detalhe: 1, nome: 'Ancho', categoria: 'Churrasco', quantidade: 5, valor_vendido: 400, lucro: 200 },
    { dia: '2026-08-21', codigo_detalhe: 2, nome: 'Coca', categoria: 'Bebida', quantidade: 20, valor_vendido: 150, lucro: 100 },
    { dia: '2026-08-21', codigo_detalhe: 3, nome: 'Arroz', categoria: 'Acomp.', quantidade: 5, valor_vendido: 50, lucro: 40 },
  ];
  const r = itensPeriodo(I);
  assert.equal(r.length, 3);
  assert.equal(r[0].nome, 'Ancho');
  assert.equal(r[0].quantidade, 15);
  assert.equal(r[0].valor, 1200);
  assert.equal(r[0].lucro, 600);
  assert.equal(r[0].margem, 50);
  // ABC pelo acumulado ANTES do item: Ancho (0 %) = A, Coca (85,7 %) = B, Arroz (96,4 %) = C
  assert.equal(r[0].abc, 'A');
  assert.equal(r[1].abc, 'B');
  assert.equal(r[2].abc, 'C');
  assert.equal(r[1].pct, 150 / 1400 * 100);
});

test('statusImportacao', () => {
  const agora = new Date('2026-08-23T12:00:00Z');
  assert.deepEqual(statusImportacao(null, agora), { texto: 'Nenhuma importação registrada', alerta: true });
  assert.deepEqual(statusImportacao({ iniciado_em: '2026-08-23T08:00:00Z', status: 'ok' }, agora), { texto: 'Última importação: 23/08/2026 04:00 · ok', alerta: false });
  assert.equal(statusImportacao({ iniciado_em: '2026-08-21T08:00:00Z', status: 'ok' }, agora).alerta, true);
  assert.equal(statusImportacao({ iniciado_em: '2026-08-23T08:00:00Z', status: 'erro', erro: 'SESSAO_EXPIRADA' }, agora).alerta, true);
  // 'executando' há horas é rodada travada (processo morto sem fechar o log)
  assert.equal(statusImportacao({ iniciado_em: '2026-08-23T11:45:00Z', status: 'executando' }, agora).alerta, false);
  assert.equal(statusImportacao({ iniciado_em: '2026-08-23T10:00:00Z', status: 'executando' }, agora).alerta, true);
});

// ---------------------------------------------- importacaoTravada
// Regressão real: uma linha aberta em 24/08 que nunca fechou segurou o cron da
// importação por quatro dias, e as vendas do PDV ficaram congeladas em 22/08.
// A tela já tinha a regra de 1 h embutida; o checador não. Agora é uma só.

test('importacaoTravada: linha ausente não trava nada', () => {
  assert.equal(importacaoTravada(null), false);
  assert.equal(importacaoTravada(undefined), false);
});

test('importacaoTravada: rodada que terminou nunca está travada', () => {
  const agora = new Date('2026-08-28T12:00:00Z');
  assert.equal(importacaoTravada({ iniciado_em: '2026-08-24T03:00:00Z', terminado_em: '2026-08-24T04:00:00Z' }, agora), false);
});

test('importacaoTravada: rodada aberta recente está viva', () => {
  const agora = new Date('2026-08-28T12:00:00Z');
  assert.equal(importacaoTravada({ iniciado_em: '2026-08-28T11:50:00Z', terminado_em: null }, agora), false);
});

test('importacaoTravada: o limite é MAIS de uma hora, não exatamente uma', () => {
  const agora = new Date('2026-08-28T12:00:00Z');
  assert.equal(HORAS_IMPORTACAO_TRAVADA, 1);
  assert.equal(importacaoTravada({ iniciado_em: '2026-08-28T11:00:00Z', terminado_em: null }, agora), false);
  assert.equal(importacaoTravada({ iniciado_em: '2026-08-28T10:59:00Z', terminado_em: null }, agora), true);
});

test('importacaoTravada: a linha real que travou o cron por quatro dias', () => {
  const agora = new Date('2026-08-28T14:00:00Z');
  assert.equal(importacaoTravada({ iniciado_em: '2026-08-24T03:01:48Z', terminado_em: null }, agora), true);
});
