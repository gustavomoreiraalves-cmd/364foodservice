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

test('parseNFe: destinatário e tipo de operação', () => {
  const nota = parseNFe(xml);
  assert.equal(nota.destinatario.cnpj, '98765432000188');
  assert.equal(nota.tipoOperacao, '1'); // 1 = saída do emitente, ou seja, entrada aqui
});

test('parseNFe: destinatário sem CNPJ (nota para CPF) vem vazio, não quebra', () => {
  const paraCpf = xml.replace('<CNPJ>98765432000188</CNPJ>', '<CPF>12345678901</CPF>');
  assert.equal(parseNFe(paraCpf).destinatario.cnpj, '');
});

test('parseNFe: somaItens é a soma dos vProd, não o vNF', () => {
  const nota = parseNFe(xml);
  assert.equal(nota.somaItens, 2757); // 1560,00 + 1197,00
  // Numa nota com frete o vNF fica maior que a soma dos itens; quem confere a
  // conferência é somaItens.
  const comFrete = xml.replace('<vNF>2757.00</vNF>', '<vNF>2900.00</vNF>');
  const notaComFrete = parseNFe(comFrete);
  assert.equal(notaComFrete.valorTotal, 2900);
  assert.equal(notaComFrete.somaItens, 2757);
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

test('parseNFe: emitente com CNPJ preenche documento com o CNPJ', () => {
  const { emitente } = parseNFe(xml);
  assert.equal(emitente.cnpj, '12345678000199');
  assert.equal(emitente.cpf, '');
  assert.equal(emitente.documento, '12345678000199');
});

test('parseNFe: emitente produtor rural (CPF) preenche documento com o CPF', () => {
  const porCpf = xml.replace('<CNPJ>12345678000199</CNPJ>', '<CPF>11122233344</CPF>');
  const { emitente } = parseNFe(porCpf);
  assert.equal(emitente.cnpj, '');
  assert.equal(emitente.cpf, '11122233344');
  // É este campo que casa o fornecedor e o de-para; sem ele a nota de produtor
  // rural gravava emitente vazio e nunca reconhecia o mesmo fornecedor duas vezes.
  assert.equal(emitente.documento, '11122233344');
});

test('parseNFe: emitente sem CNPJ nem CPF vem com documento vazio, não quebra', () => {
  const semDocumento = xml.replace('<CNPJ>12345678000199</CNPJ>', '');
  const { emitente } = parseNFe(semDocumento);
  assert.equal(emitente.documento, '');
  assert.equal(emitente.nome, 'Frigorifico Exemplo LTDA');
});

test('parseNFe: UF do emitente vem junto para o cadastro rápido de fornecedor', () => {
  assert.equal(parseNFe(xml).emitente.uf, 'SP');
});
