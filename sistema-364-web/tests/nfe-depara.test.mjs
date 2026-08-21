import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseNFe } from '../lib/nfe/parseNFe.js';
import { aplicarDePara, itensNaoMapeados } from '../lib/nfe/dePara.js';

const nota = parseNFe(readFileSync(new URL('./fixtures/nfe-exemplo.xml', import.meta.url), 'utf8'));

const MAPA = [
  { codigo_produto: 'PC-001', materia_prima_id: 'mp-picanha', unidade_nf: 'CX', fator_conversao: 12 },
  { codigo_produto: 'FR-010', materia_prima_id: 'mp-fraldinha', unidade_nf: 'KG', fator_conversao: 1 },
];

test('aplicarDePara: caixa vira quilo pelo fator', () => {
  const [picanha] = aplicarDePara(nota, MAPA);
  assert.equal(picanha.materiaPrimaId, 'mp-picanha');
  assert.equal(picanha.fatorConversao, 12);
  assert.equal(picanha.pesoNotaKg, 24);       // 2 caixas x 12 kg
  assert.equal(picanha.custoUnitario, 65);    // 1560,00 / 24 kg
  assert.equal(picanha.mapeado, true);
});

test('aplicarDePara: item já em quilo mantém quantidade e custo', () => {
  const [, fraldinha] = aplicarDePara(nota, MAPA);
  assert.equal(fraldinha.pesoNotaKg, 30);
  assert.equal(fraldinha.custoUnitario, 39.9);
});

test('aplicarDePara: item sem mapa vem marcado, com fator 1', () => {
  const itens = aplicarDePara(nota, [MAPA[1]]);
  assert.equal(itens[0].mapeado, false);
  assert.equal(itens[0].materiaPrimaId, null);
  assert.equal(itens[0].fatorConversao, 1);
  assert.equal(itens[0].pesoNotaKg, 2);
  assert.equal(itensNaoMapeados(itens).length, 1);
});

test('aplicarDePara: mapa vazio não quebra', () => {
  const itens = aplicarDePara(nota, []);
  assert.equal(itens.length, 2);
  assert.equal(itensNaoMapeados(itens).length, 2);
});

test('aplicarDePara: quantidade zero não gera divisão por zero', () => {
  const zerada = { ...nota, itens: [{ ...nota.itens[0], quantidade: 0, valorTotal: 0 }] };
  assert.equal(aplicarDePara(zerada, MAPA)[0].custoUnitario, 0);
});
