import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseNFe } from '../lib/nfe/parseNFe.js';

const xml = readFileSync(new URL('./fixtures/nfe-exemplo.xml', import.meta.url), 'utf8');

test('parseNFe: cabeçalho e emitente', () => {
  const nota = parseNFe(xml);
  assert.equal(nota.chave, '35260812345678000199550010000012341000012348');
  assert.equal(nota.numero, '1234');
  assert.equal(nota.serie, '1');
  assert.equal(nota.modelo, '55');
  assert.equal(nota.valorTotal, 2757);
  assert.equal(nota.emitente.cnpj, '12345678000199');
  assert.equal(nota.emitente.nome, 'Frigorifico Exemplo LTDA');
  assert.equal(nota.emitente.telefone, '1133334444');
  assert.equal(nota.emitente.email, null);
});

test('parseNFe: itens', () => {
  const { itens } = parseNFe(xml);
  assert.equal(itens.length, 2);
  assert.deepEqual(itens[0], {
    indice: 1, codigo: 'PC-001', descricao: 'PICANHA RESFRIADA CX 12KG', ncm: '02013000',
    unidade: 'CX', quantidade: 2, valorUnitario: 780, valorTotal: 1560,
  });
  assert.equal(itens[1].codigo, 'FR-010');
  assert.equal(itens[1].quantidade, 30);
});

test('parseNFe: duplicatas', () => {
  const { duplicatas } = parseNFe(xml);
  assert.equal(duplicatas.length, 2);
  assert.deepEqual(duplicatas[0], { numero: '001', vencimento: '2026-09-02', valor: 1378.5 });
});

test('parseNFe: nota com um único item vira lista de um', () => {
  const umItem = xml.replace(/<det nItem="2">[\s\S]*?<\/det>/, '');
  assert.equal(parseNFe(umItem).itens.length, 1);
});

test('parseNFe: XML que não é NF-e falha', () => {
  assert.throws(() => parseNFe('<qualquer><coisa/></qualquer>'), /não é uma NF-e/);
});

test('parseNFe: chave fora de 44 dígitos falha', () => {
  const ruim = xml.replace('NFe35260812345678000199550010000012341000012348', 'NFe123');
  assert.throws(() => parseNFe(ruim), /Chave de acesso inválida/);
});
