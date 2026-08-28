import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { modeloDanfe } from '../lib/nfe/danfe.js';

// nfeProc real da primeira NF-e autorizada da 364 (nº 2, série 3, 28/08/2026).
const XML = readFileSync(new URL('./fixtures/nfeproc-autorizada.xml', import.meta.url), 'utf8');
const CHAVE = '11260837541736000187550030000000021541041714';

test('modeloDanfe: identificação da nota', () => {
  const m = modeloDanfe(XML);
  assert.equal(m.chave, CHAVE);
  assert.equal(m.numero, '2');
  assert.equal(m.serie, '3');
  assert.equal(m.tipoOperacao, 'SAÍDA');
  assert.equal(m.naturezaOperacao, 'Venda de produção do estabelecimento');
});

test('modeloDanfe: a chave sai em grupos de quatro, como o DANFE imprime', () => {
  const m = modeloDanfe(XML);
  assert.equal(m.chaveFormatada.replace(/ /g, ''), CHAVE);
  assert.ok(m.chaveFormatada.startsWith('1126 0837 '), m.chaveFormatada);
});

test('modeloDanfe: protocolo de autorização', () => {
  const m = modeloDanfe(XML);
  assert.equal(m.protocolo.numero, '311260000018151');
  // dhRecbto só existe dentro do protNFe — é a razão de a fonte ser o nfeProc
  // e não o banco.
  assert.match(m.protocolo.recebidoEm, /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
});

test('modeloDanfe: totais, com o ICMS-ST que a 364 destaca', () => {
  const t = modeloDanfe(XML).totais;
  assert.equal(t.vProd, '58,50');
  assert.equal(t.vBCST, '76,05');
  assert.equal(t.vST, '3,42');
  assert.equal(t.vNF, '61,92');
  // CSOSN 202 não destaca ICMS próprio.
  assert.equal(t.vICMS, '0,00');
});

test('modeloDanfe: item com NCM, CFOP, CSOSN e valores', () => {
  const [item] = modeloDanfe(XML).itens;
  assert.equal(item.codigo, '0364-001');
  assert.equal(item.ncm, '02102000');
  assert.equal(item.cfop, '5401');
  assert.equal(item.csosn, '202');
  assert.equal(item.origem, '0');
  assert.equal(item.valorTotal, '58,50');
  assert.equal(item.baseIcmsSt, '76,05');
  assert.equal(item.valorIcmsSt, '3,42');
});

test('modeloDanfe: NCM mantém o zero à esquerda', () => {
  // parseTagValue precisa ficar desligado no parser: 02102000 vira 2102000 se
  // o XML for convertido para número.
  assert.equal(modeloDanfe(XML).itens[0].ncm, '02102000');
});

test('modeloDanfe: homologação marca o documento como sem valor fiscal', () => {
  // tpAmb 2, lido do XML e não da configuração da empresa: a configuração
  // muda, o papel impresso é sobre a nota que foi emitida.
  assert.equal(modeloDanfe(XML).semValorFiscal, true);
});

test('modeloDanfe: XML sem protNFe é recusado nomeando o que falta', () => {
  const semProtocolo = XML.replace(/<protNFe[\s\S]*?<\/protNFe>/, '');
  assert.throws(() => modeloDanfe(semProtocolo), /protNFe/);
});

test('modeloDanfe: arquivo que não é nfeProc é recusado', () => {
  assert.throws(() => modeloDanfe('<nada/>'), /nfeProc/);
});
