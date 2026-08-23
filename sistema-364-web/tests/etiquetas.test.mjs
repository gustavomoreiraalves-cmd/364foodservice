import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODELOS, modelo, medidasImpressao, paginarEtiquetas, urlRastreio } from '../lib/etiquetas.js';

test('MODELOS: só os três modelos desta fase', () => {
  assert.deepEqual(Object.keys(MODELOS).sort(), ['producao-lote', 'recebimento', 'validade-cozinha']);
});

test('modelo: devolve o modelo pedido', () => {
  assert.equal(modelo('recebimento').largura_mm, 50);
  assert.equal(modelo('recebimento').colunas, 2);
});

test('modelo: id desconhecido é erro, não silêncio', () => {
  assert.throws(() => modelo('despacho'), /despacho/);
});

test('medidasImpressao: a página é uma linha do rolo', () => {
  // Rolo de 108 mm, duas etiquetas de 50 mm, vão de 2,5 mm entre colunas:
  // sobra 5,5 mm, 2,75 mm em cada borda. A página tem a altura da etiqueta
  // mais o vão entre linhas.
  const m = medidasImpressao('recebimento');
  assert.equal(m.paginaLargura_mm, 108);
  assert.equal(m.paginaAltura_mm, 32);
  assert.equal(m.margemLateral_mm, 2.75);
  assert.equal(m.colunas, 2);
});

test('medidasImpressao: validade-cozinha mantém a geometria que já era impressa', () => {
  const m = medidasImpressao('validade-cozinha');
  assert.equal(m.paginaLargura_mm, 108);
  assert.equal(m.paginaAltura_mm, 32);
  assert.equal(m.margemLateral_mm, 2.75);
  assert.equal(m.etiquetaLargura_mm, 50);
  assert.equal(m.etiquetaAltura_mm, 30);
  assert.equal(m.gapColuna_mm, 2.5);
});

test('paginarEtiquetas: contagem par preenche as duas colunas', () => {
  assert.deepEqual(paginarEtiquetas(4, 2), [[0, 1], [2, 3]]);
});

test('paginarEtiquetas: contagem ímpar deixa a última coluna vazia', () => {
  assert.deepEqual(paginarEtiquetas(5, 2), [[0, 1], [2, 3], [4]]);
});

test('paginarEtiquetas: uma etiqueta é uma linha só', () => {
  assert.deepEqual(paginarEtiquetas(1, 2), [[0]]);
});

test('paginarEtiquetas: coluna única não agrupa', () => {
  assert.deepEqual(paginarEtiquetas(3, 1), [[0], [1], [2]]);
});

test('paginarEtiquetas: zero ou negativo não imprime nada', () => {
  assert.deepEqual(paginarEtiquetas(0, 2), []);
  assert.deepEqual(paginarEtiquetas(-3, 2), []);
});

test('urlRastreio: usa a base informada, sem barra dobrada', () => {
  assert.equal(urlRastreio('0364', 'LT-260820-001', 'https://exemplo.test/'), 'https://exemplo.test/rastreio/0364/LT-260820-001');
  assert.equal(urlRastreio('0364', 'LT-260820-001', 'https://exemplo.test'), 'https://exemplo.test/rastreio/0364/LT-260820-001');
});

test('urlRastreio: base padrão é a produção real (364foodservice.vercel.app)', () => {
  assert.equal(urlRastreio('0364', 'LT-260820-001'), 'https://364foodservice.vercel.app/rastreio/0364/LT-260820-001');
});

test('urlRastreio: o prefixo distingue empresas com o mesmo número de lote', () => {
  const a = urlRastreio('0364', 'LT-260820-001', 'https://e.test');
  const b = urlRastreio('STK', 'LT-260820-001', 'https://e.test');
  assert.notEqual(a, b);
  assert.equal(a, 'https://e.test/rastreio/0364/LT-260820-001');
  assert.equal(b, 'https://e.test/rastreio/STK/LT-260820-001');
});

test('urlRastreio: lote com espaço ou barra é escapado', () => {
  assert.equal(urlRastreio('0364', 'LT 260820/001', 'https://e.test'), 'https://e.test/rastreio/0364/LT%20260820%2F001');
});

test('urlRastreio: prefixo com espaço ou barra também é escapado', () => {
  assert.equal(urlRastreio('0/364', 'LT-260820-001', 'https://e.test'), 'https://e.test/rastreio/0%2F364/LT-260820-001');
});

test('medidasImpressao: recebimento deriva o tamanho do QR do modelo', () => {
  const m = medidasImpressao('recebimento');
  assert.equal(m.qrTamanho_mm, 16);
});

test('medidasImpressao: producao-lote usa a mesma geometria de rolo dos demais modelos', () => {
  const m = medidasImpressao('producao-lote');
  assert.equal(m.paginaLargura_mm, 108);
  assert.equal(m.paginaAltura_mm, 32);
  assert.equal(m.margemLateral_mm, 2.75);
  assert.equal(m.etiquetaLargura_mm, 50);
  assert.equal(m.etiquetaAltura_mm, 30);
  assert.equal(m.gapColuna_mm, 2.5);
  assert.equal(m.colunas, 2);
  assert.equal(m.qrTamanho_mm, 16);
});
