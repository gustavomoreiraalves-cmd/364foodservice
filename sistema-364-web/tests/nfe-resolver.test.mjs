// tests/nfe-resolver.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolverNota } from '../lib/nfe/resolverNota.js';
import { dadosEmitente } from '../lib/nfe/emitente.js';

const EMITENTE = dadosEmitente({
  cnpj: '37541736000187', razao_social: '364 COMERCIO LTDA', inscricao_estadual: '00000005709288',
  regime_tributario: 'simples', endereco: 'AV DOIS DE ABRIL', numero: '1974', bairro: '2 DE ABRIL',
  cidade: 'JI-PARANÁ', uf: 'RO', cep: '76900808', codigo_municipio_ibge: '1100122',
});

const CLIENTE = {
  nome: 'SUPERMERCADO MANAR LTDA', cnpj: '09057435000147', tipo_pessoa: 'J',
  ie: '00000002303388', ind_ie_dest: 1, logradouro: 'RUA X', numero: '725',
  bairro: 'NOVA BRASILIA', municipio: 'JI-PARANA', codigo_municipio_ibge: '1100122',
  uf: 'RO', cep: '76900000', email_nfe: 'compras@manar.com.br',
};

const PEDIDO = { id: 'p1', data: '2026-08-25', observacoes: null };
const NATUREZA = { id: 'n1', descricao: 'Venda de mercadoria' };

const ITEM = {
  pedidoItem: { id: 'i1', quantidade: 10, preco_unitario: 25.5 },
  produto: {
    id: 'prod1', codigo: 'STK-001', nome: 'Costela Defumada 500g', unidade: 'UN',
    ncm: '16025000', cest: null, gtin: null, origem_mercadoria: '0', ativo_fiscal: true,
  },
  regra: {
    id: 'r1', cfop: '5101', csosn: '101', cst_icms: null,
    reducao_base_percentual: null, aliquota_interna_destino: null,
    cst_pis: '49', aliquota_pis: 0, cst_cofins: '49', aliquota_cofins: 0,
  },
};

const ENTRADA = { pedido: PEDIDO, cliente: CLIENTE, itens: [ITEM], emitente: EMITENTE, naturezaOperacao: NATUREZA, ambiente: 'homologacao' };

test('calcula o valor do item e o total da nota', () => {
  const nota = resolverNota(ENTRADA);
  assert.equal(nota.itens[0].vProd, 255);
  assert.equal(nota.total.vNF, 255);
  assert.equal(nota.total.vProd, 255);
});

test('CSOSN 101 não destaca ICMS', () => {
  const nota = resolverNota(ENTRADA);
  assert.equal(nota.itens[0].csosn, '101');
  assert.equal(nota.itens[0].vICMS, 0);
  assert.equal(nota.itens[0].vBC, 0);
});

test('numera os itens a partir de 1, na ordem recebida', () => {
  const nota = resolverNota({ ...ENTRADA, itens: [ITEM, { ...ITEM, pedidoItem: { ...ITEM.pedidoItem, id: 'i2' } }] });
  assert.deepEqual(nota.itens.map(i => i.numeroItem), [1, 2]);
});

test('em homologação a razão social do destinatário é a exigida pela SEFAZ', () => {
  const nota = resolverNota(ENTRADA);
  assert.match(nota.dest.xNome, /HOMOLOGACAO/i,
    'em homologação a SEFAZ exige a razão social de teste, senão rejeita');
});

test('em produção usa o nome real do cliente', () => {
  const nota = resolverNota({ ...ENTRADA, ambiente: 'producao' });
  assert.equal(nota.dest.xNome, 'SUPERMERCADO MANAR LTDA');
});

test('item sem regra tributária aborta nomeando o produto', () => {
  assert.throws(
    () => resolverNota({ ...ENTRADA, itens: [{ ...ITEM, regra: null }] }),
    /Costela Defumada/,
  );
});

test('produto sem NCM aborta nomeando o produto', () => {
  assert.throws(
    () => resolverNota({ ...ENTRADA, itens: [{ ...ITEM, produto: { ...ITEM.produto, ncm: null } }] }),
    /Costela Defumada.*NCM|NCM.*Costela Defumada/i,
  );
});

test('produto não liberado fiscalmente aborta — é a trava do cadastro', () => {
  assert.throws(
    () => resolverNota({ ...ENTRADA, itens: [{ ...ITEM, produto: { ...ITEM.produto, ativo_fiscal: false } }] }),
    /Costela Defumada/,
  );
});

test('quantidade ou preço não positivo aborta', () => {
  assert.throws(() => resolverNota({ ...ENTRADA, itens: [{ ...ITEM, pedidoItem: { ...ITEM.pedidoItem, quantidade: 0 } }] }), /quantidade/i);
  assert.throws(() => resolverNota({ ...ENTRADA, itens: [{ ...ITEM, pedidoItem: { ...ITEM.pedidoItem, preco_unitario: 0 } }] }), /pre[çc]o/i);
});

test('cliente sem município IBGE aborta antes de qualquer emissão', () => {
  assert.throws(() => resolverNota({ ...ENTRADA, cliente: { ...CLIENTE, codigo_municipio_ibge: null } }), /munic[íi]pio/i);
});

test('pedido sem itens aborta', () => {
  assert.throws(() => resolverNota({ ...ENTRADA, itens: [] }), /item/i);
});

test('PIS e COFINS saem da regra, sobre o valor do produto', () => {
  const comAliquota = { ...ITEM, regra: { ...ITEM.regra, cst_pis: '01', aliquota_pis: 1.65, cst_cofins: '01', aliquota_cofins: 7.6 } };
  const nota = resolverNota({ ...ENTRADA, itens: [comAliquota] });
  assert.equal(nota.itens[0].vPIS, 4.21);   // 255 * 1.65%
  assert.equal(nota.itens[0].vCOFINS, 19.38); // 255 * 7.6%
});
