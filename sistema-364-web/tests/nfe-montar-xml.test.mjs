import test from 'node:test';
import assert from 'node:assert/strict';
import { montarXmlNFe } from '../lib/nfe/montarXml.js';
import { resolverNota } from '../lib/nfe/resolverNota.js';
import { dadosEmitente } from '../lib/nfe/emitente.js';
import { digitoVerificadorChave } from '../lib/nfe/chaveAcesso.js';

const EMITENTE = dadosEmitente({
  cnpj: '37541736000187', razao_social: '364 COMERCIO LTDA', inscricao_estadual: '00000005709288',
  regime_tributario: 'simples', endereco: 'AV DOIS DE ABRIL', numero: '1974', bairro: '2 DE ABRIL',
  cidade: 'JI-PARANÁ', uf: 'RO', cep: '76900808', codigo_municipio_ibge: '1100122',
});
const CLIENTE = {
  nome: 'MANAR', cnpj: '09057435000147', tipo_pessoa: 'J', ie: '00000002303388', ind_ie_dest: 1,
  logradouro: 'RUA X', numero: '725', bairro: 'NOVA BRASILIA', municipio: 'JI-PARANA',
  codigo_municipio_ibge: '1100122', uf: 'RO', cep: '76900000',
};
const ITEM = {
  pedidoItem: { id: 'i1', quantidade: 10, preco_unitario: 25.5 },
  produto: { id: 'p1', codigo: 'STK-001', nome: 'Costela Defumada 500g', unidade: 'UN', ncm: '16025000', origem_mercadoria: '0', ativo_fiscal: true },
  regra: { id: 'r1', cfop: '5101', csosn: '102', cst_pis: '49', aliquota_pis: 0, cst_cofins: '49', aliquota_cofins: 0 },
};

function notaBase(ambiente = 'homologacao') {
  return resolverNota({
    pedido: { id: 'ped1' }, cliente: CLIENTE, itens: [ITEM], emitente: EMITENTE,
    naturezaOperacao: { id: 'n1', descricao: 'Venda de mercadoria' }, ambiente,
  });
}
const OPCOES = { serie: 1, numero: 1, ambiente: 'homologacao', dataEmissao: new Date('2026-08-25T10:00:00-03:00'), codigoNumerico: '10000001' };

test('o Id do infNFe é NFe + a chave, e a chave fecha no DV', () => {
  const { xml, chave } = montarXmlNFe(notaBase(), OPCOES);
  assert.match(xml, new RegExp(`<infNFe[^>]*Id="NFe${chave}"`));
  assert.equal(Number(chave[43]), digitoVerificadorChave(chave.slice(0, 43)));
});

test('declara o namespace e a versão do leiaute', () => {
  const { xml } = montarXmlNFe(notaBase(), OPCOES);
  assert.match(xml, /xmlns="http:\/\/www\.portalfiscal\.inf\.br\/nfe"/);
  assert.match(xml, /versao="4\.00"/);
});

test('tpAmb 2 em homologação e 1 em produção', () => {
  assert.match(montarXmlNFe(notaBase(), OPCOES).xml, /<tpAmb>2<\/tpAmb>/);
  const prod = montarXmlNFe(notaBase('producao'), { ...OPCOES, ambiente: 'producao' });
  assert.match(prod.xml, /<tpAmb>1<\/tpAmb>/);
});

test('os blocos vêm na ordem que o schema exige', () => {
  const { xml } = montarXmlNFe(notaBase(), OPCOES);
  const ordem = ['<ide>', '<emit>', '<dest>', '<det ', '<total>', '<transp>', '<pag>'];
  let ultima = -1;
  for (const tag of ordem) {
    const pos = xml.indexOf(tag);
    assert.ok(pos > ultima, `${tag} está fora de ordem`);
    ultima = pos;
  }
});

test('o item traz produto e imposto, com CSOSN do Simples', () => {
  const { xml } = montarXmlNFe(notaBase(), OPCOES);
  assert.match(xml, /<det nItem="1">/);
  assert.match(xml, /<cProd>STK-001<\/cProd>/);
  assert.match(xml, /<NCM>16025000<\/NCM>/);
  assert.match(xml, /<CFOP>5101<\/CFOP>/);
  assert.match(xml, /<ICMSSN102>/);
  assert.match(xml, /<CSOSN>102<\/CSOSN>/);
});

test('quantidade e valores saem com as casas decimais do leiaute', () => {
  const { xml } = montarXmlNFe(notaBase(), OPCOES);
  assert.match(xml, /<qCom>10\.0000<\/qCom>/, 'qCom tem 4 casas');
  assert.match(xml, /<vUnCom>25\.5000000000<\/vUnCom>/, 'vUnCom tem 10 casas');
  assert.match(xml, /<vProd>255\.00<\/vProd>/, 'vProd tem 2 casas');
});

test('o total da nota bate com a soma dos itens', () => {
  const { xml } = montarXmlNFe(notaBase(), OPCOES);
  assert.match(xml, /<vNF>255\.00<\/vNF>/);
});

test('dhEmi sai com fuso, não em UTC', () => {
  const { xml } = montarXmlNFe(notaBase(), OPCOES);
  // O emitente é de Rondônia (America/Porto_Velho, UTC-4), não de São Paulo
  // (UTC-3). O fixture instancia o instante 2026-08-25T13:00:00.000Z; em
  // Porto Velho isso é 09:00, não 10:00 — o horário muda junto com o offset.
  assert.match(xml, /<dhEmi>2026-08-25T09:00:00-04:00<\/dhEmi>/);
  assert.doesNotMatch(xml, /<dhEmi>[^<]*Z<\/dhEmi>/);
});

test('a AAMM da chave de acesso vem do mesmo fuso que o dhEmi', () => {
  const { xml, chave } = montarXmlNFe(notaBase(), OPCOES);
  const match = xml.match(/<dhEmi>(\d{4})-(\d{2})-\d{2}T/);
  assert.ok(match, 'dhEmi não encontrado no XML');
  const [, anoDoDhEmi, mesDoDhEmi] = match;
  const aammDaChave = chave.slice(2, 6);
  assert.equal(aammDaChave, anoDoDhEmi.slice(2) + mesDoDhEmi, 'AAMM da chave e dhEmi discordam de ano/mês');
});

test('escapa caractere especial na descrição em vez de quebrar o XML', () => {
  const comEcomercial = { ...ITEM, produto: { ...ITEM.produto, nome: 'Costela & Cupim <500g>' } };
  const nota = resolverNota({
    pedido: { id: 'ped1' }, cliente: CLIENTE, itens: [comEcomercial], emitente: EMITENTE,
    naturezaOperacao: { id: 'n1', descricao: 'Venda' }, ambiente: 'homologacao',
  });
  const { xml } = montarXmlNFe(nota, OPCOES);
  assert.match(xml, /&amp;/);
  assert.doesNotMatch(xml, /<xProd>[^<]*<500g>/);
});

test('operação interestadual é recusada nesta fase, em vez de sair errada', () => {
  const outraUf = resolverNota({
    pedido: { id: 'ped1' }, cliente: { ...CLIENTE, uf: 'SP' }, itens: [ITEM], emitente: EMITENTE,
    naturezaOperacao: { id: 'n1', descricao: 'Venda' }, ambiente: 'homologacao',
  });
  assert.throws(() => montarXmlNFe(outraUf, OPCOES), /interestadual/i);
});

test('regime normal é recusado nesta fase', () => {
  const emitenteNormal = { ...EMITENTE, CRT: '3' };
  const nota = { ...notaBase(), emit: emitenteNormal };
  assert.throws(() => montarXmlNFe(nota, OPCOES), /regime normal|CRT/i);
});
