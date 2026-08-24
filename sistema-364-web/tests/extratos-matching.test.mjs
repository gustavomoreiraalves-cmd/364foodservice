import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JANELA_DIAS, valorCasa, diferencaDias, inferirFormaPagamento,
  candidatosParaLancamento, escolherSugestao,
} from '../lib/extratos/matching.js';

const saida = { data: '2026-08-10', valor: 750, tipo: 'saida', descricao: 'PIX ENVIADO BOI FORTE' };
const parcela = (id, valor, vencimento, fornecedorId = 'forn-1') =>
  ({ id, valor, vencimento, fornecedorId });

test('valor casa com tolerância de um centavo, não além', () => {
  assert.equal(valorCasa(750, 750), true);
  assert.equal(valorCasa(750, 750.01), true);
  assert.equal(valorCasa(750, 750.02), false);
});

test('diferença de dias é assinada', () => {
  assert.equal(diferencaDias('2026-08-10', '2026-08-10'), 0);
  assert.equal(diferencaDias('2026-08-10', '2026-08-13'), -3);
  assert.equal(diferencaDias('2026-08-13', '2026-08-10'), 3);
});

test('forma de pagamento sai da descrição', () => {
  assert.equal(inferirFormaPagamento('PIX ENVIADO BOI FORTE'), 'Pix');
  assert.equal(inferirFormaPagamento('PAGAMENTO DE BOLETO 001'), 'Boleto');
  assert.equal(inferirFormaPagamento('LIQUIDACAO TITULO COBRANCA'), 'Boleto');
  assert.equal(inferirFormaPagamento('DEB AUT ENERGISA'), 'Transferência');
  assert.equal(inferirFormaPagamento(''), 'Transferência');
});

test('parcela fora da janela de 7 dias não é candidata', () => {
  const fora = parcela('p1', 750, '2026-08-20');
  assert.equal(candidatosParaLancamento(saida, [fora], null).length, 0);
  const dentro = parcela('p2', 750, `2026-08-${10 + JANELA_DIAS}`);
  assert.equal(candidatosParaLancamento(saida, [dentro], null).length, 1);
});

test('parcela de valor diferente não é candidata, nem perto', () => {
  assert.equal(candidatosParaLancamento(saida, [parcela('p1', 749, '2026-08-10')], null).length, 0);
});

test('candidato único no mesmo dia é sugerido', () => {
  const r = escolherSugestao(saida, [parcela('p1', 750, '2026-08-10')], null);
  assert.equal(r.parcelaId, 'p1');
  assert.ok(r.score >= 60);
});

test('dois candidatos idênticos são ambíguos: ninguém é sugerido', () => {
  const r = escolherSugestao(saida, [
    parcela('p1', 750, '2026-08-10'),
    parcela('p2', 750, '2026-08-10'),
  ], null);
  assert.equal(r, null);
});

test('o padrão aprendido desempata pelo fornecedor', () => {
  const r = escolherSugestao(saida, [
    parcela('p1', 750, '2026-08-10', 'forn-1'),
    parcela('p2', 750, '2026-08-10', 'forn-2'),
  ], { fornecedorId: 'forn-2', categoriaConta: 'Custos Diretos' });
  assert.equal(r.parcelaId, 'p2');
});

test('padrão que não acha ninguém não descarta os candidatos', () => {
  const r = candidatosParaLancamento(saida, [parcela('p1', 750, '2026-08-10', 'forn-9')],
    { fornecedorId: 'forn-inexistente' });
  assert.equal(r.length, 1, 'padrão errado não pode zerar a lista de candidatos');
});

test('candidatos vêm ordenados: quem vence mais perto do débito primeiro', () => {
  const r = candidatosParaLancamento(saida, [
    parcela('p-longe', 750, '2026-08-16'),
    parcela('p-perto', 750, '2026-08-10'),
  ], null);
  assert.deepEqual(r.map(c => c.parcelaId), ['p-perto', 'p-longe']);
});

test('entrada nunca gera candidato', () => {
  const entrada = { ...saida, tipo: 'entrada' };
  assert.equal(candidatosParaLancamento(entrada, [parcela('p1', 750, '2026-08-10')], null).length, 0);
  assert.equal(escolherSugestao(entrada, [parcela('p1', 750, '2026-08-10')], null), null);
});

test('sem parcela nenhuma não quebra', () => {
  assert.deepEqual(candidatosParaLancamento(saida, [], null), []);
  assert.equal(escolherSugestao(saida, null, null), null);
});

test('candidato distante da data não alcança o limiar sozinho', () => {
  const r = escolherSugestao(saida, [parcela('p1', 750, '2026-08-17')], null);
  assert.equal(r, null, 'vencimento a 7 dias sem padrão é fraco demais para sugerir');
});
