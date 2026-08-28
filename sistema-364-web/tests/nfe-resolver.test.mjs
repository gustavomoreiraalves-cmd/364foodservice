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

test('ind_ie_dest 1 (contribuinte de ICMS) resolve normalmente', () => {
  const nota = resolverNota({ ...ENTRADA, cliente: { ...CLIENTE, ind_ie_dest: 1 } });
  assert.equal(nota.dest.indIEDest, '1');
});

test('ind_ie_dest 2 (contribuinte isento de inscrição) resolve normalmente', () => {
  const nota = resolverNota({ ...ENTRADA, cliente: { ...CLIENTE, ind_ie_dest: 2 } });
  assert.equal(nota.dest.indIEDest, '2');
});

test('ind_ie_dest string "1" resolve igual ao numérico 1', () => {
  const nota = resolverNota({ ...ENTRADA, cliente: { ...CLIENTE, ind_ie_dest: '1' } });
  assert.equal(nota.dest.indIEDest, '1');
});

test('ind_ie_dest 9 (não contribuinte / consumidor final) aborta explicando o motivo', () => {
  assert.throws(
    () => resolverNota({ ...ENTRADA, cliente: { ...CLIENTE, ind_ie_dest: 9 } }),
    /SUPERMERCADO MANAR LTDA.*(não contribuinte|consumidor final)/is,
  );
});

test('ind_ie_dest ausente aborta em vez de assumir consumidor final (9)', () => {
  const cliente = { ...CLIENTE };
  delete cliente.ind_ie_dest;
  let erro;
  try {
    resolverNota({ ...ENTRADA, cliente });
  } catch (e) {
    erro = e;
  }
  assert.ok(erro, 'era esperado que a emissão abortasse com ind_ie_dest ausente');
  assert.doesNotMatch(erro.message, /9/, 'não pode silenciosamente virar indIEDest 9 (consumidor final)');
  assert.match(erro.message, /ind_ie_dest|inscri[çc][ãa]o estadual/i);
});

test('PIS e COFINS saem da regra, sobre o valor do produto', () => {
  const comAliquota = { ...ITEM, regra: { ...ITEM.regra, cst_pis: '01', aliquota_pis: 1.65, cst_cofins: '01', aliquota_cofins: 7.6 } };
  const nota = resolverNota({ ...ENTRADA, itens: [comAliquota] });
  assert.equal(nota.itens[0].vPIS, 4.21);   // 255 * 1.65%
  assert.equal(nota.itens[0].vCOFINS, 19.38); // 255 * 7.6%
});

// I2 (achado da revisão): campos de texto livre do leiaute proíbem espaço no
// início/fim e caractere de controle, e têm tamanho máximo — descumprir isso
// só aparecia depois de reservar_numero_fiscal, como Rejeição 215 opaca de
// schema. A normalização/validação roda aqui, no resolver, antes da reserva.

test('xProd maior que 120 caracteres é recusado antes de reservar número', () => {
  const nomeGrande = 'Costela Defumada Extra Especial da Casa '.repeat(4); // > 120 chars
  assert.throws(
    () => resolverNota({ ...ENTRADA, itens: [{ ...ITEM, produto: { ...ITEM.produto, nome: nomeGrande } }] }),
    /xProd.*120|120.*caracteres/i,
  );
});

test('xProd com espaço sobrando e quebra de linha sai normalizado, sem lançar', () => {
  const nota = resolverNota({
    ...ENTRADA,
    itens: [{ ...ITEM, produto: { ...ITEM.produto, nome: '  Costela   Defumada\n500g  ' } }],
  });
  assert.equal(nota.itens[0].xProd, 'Costela Defumada 500g');
});

test('xNome e endereço do destinatário saem normalizados (espaço sobrando, quebra de linha)', () => {
  const nota = resolverNota({
    ...ENTRADA,
    ambiente: 'producao',
    cliente: {
      ...CLIENTE,
      nome: '  Supermercado   Manar  ',
      logradouro: 'Rua\tX  Bagunçada',
      bairro: '  Nova   Brasília ',
    },
  });
  assert.equal(nota.dest.xNome, 'Supermercado Manar');
  assert.equal(nota.dest.enderDest.xLgr, 'Rua X Bagunçada');
  assert.equal(nota.dest.enderDest.xBairro, 'Nova Brasília');
});

test('xNome do destinatário maior que 60 caracteres é recusado', () => {
  const nomeGrande = 'Empresa Com Razão Social Extremamente Longa E Detalhada Demais Ltda';
  assert.throws(
    () => resolverNota({ ...ENTRADA, ambiente: 'producao', cliente: { ...CLIENTE, nome: nomeGrande } }),
    /xNome.*60|60.*caracteres/i,
  );
});

test('infCpl junta o texto padrão do emitente com as observações do pedido, sem quebra de linha', () => {
  const emitenteComTexto = { ...EMITENTE, informacoesComplementaresPadrao: 'Texto padrão\nem duas linhas' };
  const nota = resolverNota({
    ...ENTRADA,
    pedido: { ...PEDIDO, observacoes: '  observação   com espaço  ' },
    emitente: emitenteComTexto,
  });
  assert.equal(nota.ide.infCpl, 'Texto padrão em duas linhas | observação com espaço');
});

test('infCpl fica undefined quando emitente e pedido não têm nada a dizer', () => {
  const nota = resolverNota({ ...ENTRADA, pedido: { ...PEDIDO, observacoes: null } });
  assert.equal(nota.ide.infCpl, undefined);
});

test('infCpl maior que 5000 caracteres é recusado', () => {
  const nota5000 = { ...PEDIDO, observacoes: 'A'.repeat(5001) };
  assert.throws(
    () => resolverNota({ ...ENTRADA, pedido: nota5000 }),
    /infCpl.*5000|5000.*caracteres/i,
  );
});

function comRegra(extra) {
  return { ...ENTRADA, itens: [{ ...ITEM, regra: { ...ITEM.regra, ...extra } }] };
}

function comRegraResolvida(extra) {
  return resolverNota(comRegra(extra)).itens[0].infAdProd;
}

test('infAdProd junta base legal e observação, nessa ordem', () => {
  const nota = resolverNota(comRegra({
    base_legal: 'RICMS-RO Anexo VI, Tabela XVII, item 84.0',
    observacao_fiscal: 'ICMS retido por substituição tributária',
  }));
  assert.equal(
    nota.itens[0].infAdProd,
    'RICMS-RO Anexo VI, Tabela XVII, item 84.0 — ICMS retido por substituição tributária',
  );
});

test('infAdProd sai com só uma das duas, sem separador solto', () => {
  assert.equal(comRegraResolvida({ base_legal: 'RICMS-RO art. 1º' }), 'RICMS-RO art. 1º');
  assert.equal(comRegraResolvida({ observacao_fiscal: 'Mercadoria de produção própria' }),
    'Mercadoria de produção própria');
});

test('regra sem base legal e sem observação não produz infAdProd', () => {
  assert.equal(resolverNota(ENTRADA).itens[0].infAdProd, undefined,
    'undefined é o que faz montarXml omitir a tag; string vazia viraria <infAdProd></infAdProd>');
});

test('quebra de linha crua vinda da tela é normalizada antes de virar XML', () => {
  const nota = resolverNota(comRegra({ base_legal: 'RICMS-RO\nart. 1º   §2º' }));
  assert.equal(nota.itens[0].infAdProd, 'RICMS-RO art. 1º §2º');
});

test('texto acima de 500 caracteres para a emissão no resolver, antes de queimar número', () => {
  // resolverNota roda em lib/nfe/emitir.js:339; reservar_numero_fiscal só em
  // :429. Falhar aqui é falhar antes de gastar numeração — que é o motivo de
  // toda a normalização de texto viver no resolver e não no serializador.
  assert.throws(
    () => resolverNota(comRegra({ base_legal: 'a'.repeat(501) })),
    /500 caracteres/,
  );
});
