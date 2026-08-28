// ICMS retido por substituição tributária com a 364 na posição de substituta.
//
// O vetor central destes testes é a NF-e modelo que o contador emitiu em
// 13/08/2026 (nº 29, série 005): CARNE SUINA DEFUMADA, CFOP 5401, CSOSN 202,
// vProd 3.150,00, vBCST 4.095,00, vICMSST 184,27, total da nota 3.334,27.
//
// Spec: docs/superpowers/specs/2026-08-28-icms-st-csosn-202-design.md

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolverNota } from '../lib/nfe/resolverNota.js';
import { montarXmlNFe } from '../lib/nfe/montarXml.js';
import { dadosEmitente } from '../lib/nfe/emitente.js';

const EMITENTE = dadosEmitente({
  cnpj: '37541736000187', razao_social: '364 STEAKHOUSE COMERCIO DE ALIMENTOS LTDA',
  inscricao_estadual: '00000005709288', regime_tributario: 'simples',
  endereco: 'AV DOIS DE ABRIL', numero: '1974', bairro: '2 DE ABRIL',
  cidade: 'JI-PARANA', uf: 'RO', cep: '76900808', codigo_municipio_ibge: '1100122',
});

const CLIENTE = {
  nome: 'SUPERMERCADO MANAR LTDA', cnpj: '09057435000147', tipo_pessoa: 'J',
  ie: '00000002303388', ind_ie_dest: 1, logradouro: 'RUA X', numero: '725',
  bairro: 'CENTRO', municipio: 'JI-PARANA', codigo_municipio_ibge: '1100122',
  uf: 'RO', cep: '76900000',
};

const PRODUTO = {
  id: 'p1', codigo: '0364-003', nome: 'CARNE SUINA DEFUMADA 364', unidade: 'KG',
  unidade_tributavel: 'KG', ncm: '02101900', cest: '1708701',
  origem_mercadoria: '0', ativo_fiscal: true,
};

// A regra da nota modelo: substituta, MVA 30%, sem redução, alíquota 4,5%.
// A alíquota vem de `aliquota_interna_destino`, que é o campo que o formulário
// mostra quando o papel é substituto — não de `aliquota_st_retido`, que é do
// bloco de substituído e fica escondido aqui.
const REGRA_SUBSTITUTO = {
  id: 'r1', cfop: '5401', csosn: '202', st_responsavel: 'substituto',
  mod_bc_st: '4', mva_percentual: 30, reducao_base_st_percentual: 0,
  aliquota_interna_destino: 4.5,
  cst_pis: '49', aliquota_pis: 0, cst_cofins: '49', aliquota_cofins: 0,
};

function nota({ regra = REGRA_SUBSTITUTO, quantidade = 1, preco = 3150 } = {}) {
  return resolverNota({
    pedido: { id: 'ped1' }, cliente: CLIENTE, emitente: EMITENTE,
    itens: [{ pedidoItem: { id: 'i1', quantidade, preco_unitario: preco }, produto: PRODUTO, regra }],
    naturezaOperacao: { id: 'n1', descricao: 'Venda de produção do estabelecimento' },
    ambiente: 'homologacao',
  });
}

const OPCOES = {
  serie: 3, numero: 2, ambiente: 'homologacao',
  dataEmissao: new Date('2026-08-28T10:00:00-04:00'), codigoNumerico: '10000002',
};

// ------------------------------------------------------------ resolver

test('o vetor da nota modelo do contador fecha na base de ST', () => {
  const item = nota().itens[0];
  assert.equal(item.vProd, 3150);
  // 3.150,00 × 1,30 — exatamente o que o DANFE do contador traz.
  assert.equal(item.vBCST, 4095);
});

test('o ICMS ST do vetor do contador, com o nosso arredondamento', () => {
  const item = nota().itens[0];
  // 4.095,00 × 4,5% = 184,275. Arredondamos meio-para-cima (184,28); o sistema
  // do contador truncou e gravou 184,27. Um centavo, sem rejeição — a SEFAZ
  // confere a coerência interna da nota, e a nossa fecha do item ao total.
  // Ver a seção de arredondamento do spec antes de "consertar" isto.
  assert.equal(item.vICMSST, 184.28);
});

test('CSOSN 202 não destaca ICMS próprio', () => {
  const item = nota().itens[0];
  // O grupo ICMSSN202 não tem campo para vBC, pICMS nem vICMS. Se o resolver
  // calculasse os três, o ICMSTot declararia ICMS que item nenhum destaca —
  // total incoerente. O DANFE do contador confirma: ICMS 0,00.
  assert.equal(item.vBC, 0);
  assert.equal(item.pICMS, 0);
  assert.equal(item.vICMS, 0);
});

test('o item carrega os campos que o grupo ICMSSN202 exige', () => {
  const item = nota().itens[0];
  assert.equal(item.modBCST, '4');
  assert.equal(item.pMVAST, 30);
  assert.equal(item.pRedBCST, 0);
  assert.equal(item.pICMSST, 4.5);
});

test('o total da nota soma a ST, como no modelo do contador', () => {
  const total = nota().total;
  assert.equal(total.vProd, 3150);
  assert.equal(total.vBCST, 4095);
  assert.equal(total.vST, 184.28);
  // O contador fecha em 3.334,27; nós em 3.334,28, pelo centavo do
  // arredondamento. A soma é que importa: vNF = vProd + vST.
  assert.equal(total.vNF, 3334.28);
});

test('substituído com CSOSN 500 continua sem ST — não regride', () => {
  const regra = { ...REGRA_SUBSTITUTO, csosn: '500', st_responsavel: 'substituido' };
  const n = nota({ regra });
  assert.equal(n.itens[0].vBCST, 0);
  assert.equal(n.itens[0].vICMSST, 0);
  assert.equal(n.total.vST, 0);
  assert.equal(n.total.vNF, n.total.vProd);
});

test('substituto sem MVA e sem alíquota de ST é recusado antes de reservar número', () => {
  const regra = {
    ...REGRA_SUBSTITUTO, mva_percentual: null,
    reducao_base_st_percentual: null, aliquota_interna_destino: null,
  };
  assert.throws(() => nota({ regra }), /sem alíquota interna do destino e sem MVA/);
});

test('MVA preenchido mas alíquota de ST vazia também é recusado', () => {
  // Estado real do cadastro da 364 em 28/08/2026: DEFUMADO_BOVINO_ST tinha
  // MVA 4,50 e alíquota em branco. Sem esta guarda a nota sairia com CSOSN 202
  // e vICMSST 0,00 — declarando uma retenção que não houve.
  const regra = { ...REGRA_SUBSTITUTO, mva_percentual: 4.5, aliquota_interna_destino: null };
  assert.throws(() => nota({ regra }), /sem alíquota interna do destino\./);
});

test('substituto com CSOSN de substituído é contradição e para a emissão', () => {
  const regra = { ...REGRA_SUBSTITUTO, csosn: '500' };
  assert.throws(() => nota({ regra }), /500/);
});

test('substituído com CSOSN de substituto é a mesma contradição, ao contrário', () => {
  const regra = { ...REGRA_SUBSTITUTO, st_responsavel: 'substituido' };
  assert.throws(() => nota({ regra }), /202/);
});

// ------------------------------------------------------------ serializador

test('ICMSSN202 sai com os campos na ordem do schema', () => {
  const { xml } = montarXmlNFe(nota(), OPCOES);
  assert.match(
    xml,
    /<ICMS><ICMSSN202><orig>0<\/orig><CSOSN>202<\/CSOSN><modBCST>4<\/modBCST><pMVAST>30\.0000<\/pMVAST><pRedBCST>0\.0000<\/pRedBCST><vBCST>4095\.00<\/vBCST><pICMSST>4\.5000<\/pICMSST><vICMSST>184\.28<\/vICMSST><\/ICMSSN202><\/ICMS>/,
  );
});

test('pMVAST e pRedBCST somem quando a regra não os tem — omitir não é mandar zero', () => {
  // Base por pauta (modBCST 5): a base vem pronta, não há margem nem redução.
  // Mandar pRedBCST zerado declararia uma redução de 0% que ninguém cadastrou.
  const regra = {
    ...REGRA_SUBSTITUTO, mod_bc_st: '5',
    mva_percentual: null, reducao_base_st_percentual: null,
  };
  const { xml } = montarXmlNFe(nota({ regra }), OPCOES);
  assert.match(xml, /<ICMSSN202>/);
  assert.doesNotMatch(xml, /<pMVAST>/);
  assert.doesNotMatch(xml, /<pRedBCST>/);
});

test('o ICMSTot leva vBCST e vST de verdade, não zero fixo', () => {
  const { xml } = montarXmlNFe(nota(), OPCOES);
  assert.match(xml, /<vBCST>4095\.00<\/vBCST>/);
  assert.match(xml, /<vST>184\.28<\/vST>/);
  assert.match(xml, /<vNF>3334\.28<\/vNF>/);
});

test('vPag acompanha vNF quando há ST — divergir é rejeição', () => {
  const { xml } = montarXmlNFe(nota(), OPCOES);
  const vNF = /<vNF>([\d.]+)<\/vNF>/.exec(xml)[1];
  const vPag = /<vPag>([\d.]+)<\/vPag>/.exec(xml)[1];
  assert.equal(vPag, vNF);
});

test('201 e 203 continuam recusados — compartilham o grupo mas não os campos', () => {
  for (const csosn of ['201', '203']) {
    const regra = { ...REGRA_SUBSTITUTO, csosn };
    assert.throws(() => montarXmlNFe(nota({ regra }), OPCOES), new RegExp(csosn));
  }
});
