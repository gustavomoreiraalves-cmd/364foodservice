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

// ---------------------------------------------------------------------------
// CRÍTICO 1 e 4 (achados da revisão): grupo ICMS certo por CSOSN, e nunca
// inventar um CSOSN quando a regra tributária não é uma das que este arquivo
// sabe montar.
// ---------------------------------------------------------------------------

function notaComRegra(regraExtra) {
  const item = { ...ITEM, regra: { ...ITEM.regra, ...regraExtra } };
  return resolverNota({
    pedido: { id: 'ped1' }, cliente: CLIENTE, itens: [item], emitente: EMITENTE,
    naturezaOperacao: { id: 'n1', descricao: 'Venda de mercadoria' }, ambiente: 'homologacao',
  });
}

test('CSOSN 101 é recusado no serializador — falta pCredSN/vCredICMSSN, nunca vira ICMSSN102', () => {
  const nota = notaComRegra({ csosn: '101' });
  assert.throws(() => montarXmlNFe(nota, OPCOES), /pCredSN/i);
});

test('CSOSN fora do que este arquivo sabe montar é recusado, nunca vira ICMSSN900 900 chutado', () => {
  // 201 é CSOSN de substituição tributária — teria vBCST/vICMSST próprios,
  // que este arquivo não calcula; o catch-all antigo destacava ICMS comum
  // (ICMSSN900/900) por cima disso, descartando a ST em silêncio.
  const nota = notaComRegra({ csosn: '201' });
  assert.throws(() => montarXmlNFe(nota, OPCOES), /não é suportado/i);
});

test('CST de ICMS sem CSOSN é recusado — é regime normal vazando para o Simples, não 900 chutado', () => {
  const nota = notaComRegra({ csosn: undefined, cst_icms: '00' });
  assert.throws(() => montarXmlNFe(nota, OPCOES), /regime normal|CST de ICMS/i);
});

test('CSOSN 900 destaca ICMS de verdade, com base/alíquota/valor', () => {
  const nota = notaComRegra({ csosn: '900', reducao_base_percentual: 0, aliquota_interna_destino: 18 });
  const { xml } = montarXmlNFe(nota, OPCOES);
  assert.match(xml, /<ICMSSN900>/);
  assert.match(xml, /<CSOSN>900<\/CSOSN>/);
  assert.match(xml, /<vBC>255\.00<\/vBC>/);
  assert.match(xml, /<pICMS>18\.0000<\/pICMS>/);
  assert.match(xml, /<vICMS>45\.90<\/vICMS>/);
});

// ---------------------------------------------------------------------------
// CRÍTICO 2 (achado da revisão): CST 49 (o padrão quando a regra não declara
// cst_pis/cst_cofins) vai para PISOutr/COFINSOutr, nunca para PISNT/COFINSNT
// — nenhum teste cobria o grupo PIS/COFINS antes desta revisão.
// ---------------------------------------------------------------------------

test('PIS/COFINS CST 01/02 vão para o grupo Aliq, com base/alíquota/valor', () => {
  const nota = notaComRegra({ cst_pis: '01', aliquota_pis: 1.65, cst_cofins: '02', aliquota_cofins: 7.6 });
  const { xml } = montarXmlNFe(nota, OPCOES);
  assert.match(xml, /<PISAliq><CST>01<\/CST><vBC>255\.00<\/vBC><pPIS>1\.6500<\/pPIS><vPIS>4\.21<\/vPIS><\/PISAliq>/);
  assert.match(xml, /<COFINSAliq><CST>02<\/CST><vBC>255\.00<\/vBC><pCOFINS>7\.6000<\/pCOFINS><vCOFINS>19\.38<\/vCOFINS><\/COFINSAliq>/);
});

test('PIS/COFINS CST 04-09 vão para o grupo NT, só com a situação (sem valor)', () => {
  const nota = notaComRegra({ cst_pis: '06', cst_cofins: '07' });
  const { xml } = montarXmlNFe(nota, OPCOES);
  assert.match(xml, /<PISNT><CST>06<\/CST><\/PISNT>/);
  assert.match(xml, /<COFINSNT><CST>07<\/CST><\/COFINSNT>/);
});

test('PIS/COFINS CST 49 (o padrão) vão para o grupo Outr zerado, nunca para NT', () => {
  const nota = notaComRegra({ cst_pis: null, cst_cofins: null });
  const { xml } = montarXmlNFe(nota, OPCOES);
  assert.match(xml, /<PISOutr><CST>49<\/CST><vBC>0\.00<\/vBC><pPIS>0\.0000<\/pPIS><vPIS>0\.00<\/vPIS><\/PISOutr>/);
  assert.match(xml, /<COFINSOutr><CST>49<\/CST><vBC>0\.00<\/vBC><pCOFINS>0\.0000<\/pCOFINS><vCOFINS>0\.00<\/vCOFINS><\/COFINSOutr>/);
  assert.doesNotMatch(xml, /<PISNT>/);
  assert.doesNotMatch(xml, /<COFINSNT>/);
});

test('CST 49 fica zerado no grupo Outr mesmo se a regra (por engano) tiver alíquota', () => {
  // Padrão do Simples: PIS/COFINS são recolhidos pelo DAS, não calculados
  // nota a nota — o grupo Outr sempre zerado, nunca reflete uma alíquota
  // cadastrada por engano junto de CST 49.
  const nota = notaComRegra({ cst_pis: '49', aliquota_pis: 5, cst_cofins: '49', aliquota_cofins: 5 });
  const { xml } = montarXmlNFe(nota, OPCOES);
  assert.match(xml, /<PISOutr><CST>49<\/CST><vBC>0\.00<\/vBC><pPIS>0\.0000<\/pPIS><vPIS>0\.00<\/vPIS><\/PISOutr>/);
  assert.match(xml, /<COFINSOutr><CST>49<\/CST><vBC>0\.00<\/vBC><pCOFINS>0\.0000<\/pCOFINS><vCOFINS>0\.00<\/vCOFINS><\/COFINSOutr>/);
});

test('PIS/COFINS CST 50-99 também vão para o grupo Outr', () => {
  const nota = notaComRegra({ cst_pis: '99', cst_cofins: '61' });
  const { xml } = montarXmlNFe(nota, OPCOES);
  assert.match(xml, /<PISOutr><CST>99<\/CST>/);
  assert.match(xml, /<COFINSOutr><CST>61<\/CST>/);
});

// ---------------------------------------------------------------------------
// IMPORTANTE I9 (achado da revisão, defeito do próprio plano): tPag não pode
// mais ser 90 ("sem pagamento") numa venda normal (finNFe 1) com vPag igual
// ao total da nota — as duas coisas juntas são uma contradição que o schema
// aceita mas que não faz sentido de negócio.
// ---------------------------------------------------------------------------

test('tPag não é mais 90 (sem pagamento) numa venda normal', () => {
  const { xml } = montarXmlNFe(notaBase(), OPCOES);
  assert.doesNotMatch(xml, /<tPag>90<\/tPag>/);
  assert.match(xml, /<tPag>01<\/tPag>/);
});

// ---------------------------------------------------------------------------
// IMPORTANTE I2 (achado da revisão): infCpl sai de nota.ide.infCpl (já
// normalizado pelo resolver), empacotado dentro de infAdic.
// ---------------------------------------------------------------------------

test('infAdic/infCpl aparece no XML quando resolverNota calculou infCpl', () => {
  const emitenteComTexto = { ...EMITENTE, informacoesComplementaresPadrao: 'Aviso padrão' };
  const nota = resolverNota({
    pedido: { id: 'ped1', observacoes: 'Entregar até 18h' }, cliente: CLIENTE, itens: [ITEM],
    emitente: emitenteComTexto, naturezaOperacao: { id: 'n1', descricao: 'Venda' }, ambiente: 'homologacao',
  });
  const { xml } = montarXmlNFe(nota, OPCOES);
  assert.match(xml, /<infAdic><infCpl>Aviso padrão \| Entregar até 18h<\/infCpl><\/infAdic>/);
});

test('infAdic some do XML quando não há infCpl nenhum', () => {
  const { xml } = montarXmlNFe(notaBase(), OPCOES);
  assert.doesNotMatch(xml, /<infAdic>/);
});

function notaComTexto(extra) {
  return resolverNota({
    pedido: { id: 'ped1' }, cliente: CLIENTE,
    itens: [{ ...ITEM, regra: { ...ITEM.regra, ...extra } }],
    emitente: EMITENTE, naturezaOperacao: { id: 'n1', descricao: 'Venda de mercadoria' },
    ambiente: 'homologacao',
  });
}

test('infAdProd é o último filho de det, depois de imposto', () => {
  // Posição do leiaute 4.00: prod, imposto, [impostoDevol], [infAdProd].
  // Fora de ordem é Rejeição 215 de schema, tão opaca quanto qualquer outra.
  const { xml } = montarXmlNFe(notaComTexto({ base_legal: 'RICMS-RO art. 1º' }), OPCOES);
  assert.match(xml, /<\/imposto><infAdProd>RICMS-RO art\. 1º<\/infAdProd><\/det>/);
});

test('item sem texto não emite a tag vazia', () => {
  const { xml } = montarXmlNFe(notaBase(), OPCOES);
  assert.ok(!xml.includes('<infAdProd>'),
    'tag vazia é lida pela SEFAZ como valor vazio, não como campo ausente');
});

test('caractere que exige escape XML sai escapado no infAdProd', () => {
  const { xml } = montarXmlNFe(notaComTexto({ base_legal: 'Convênio ICMS 52/91 <art. 1º & 2º>' }), OPCOES);
  assert.match(xml, /<infAdProd>Convênio ICMS 52\/91 &lt;art\. 1º &amp; 2º&gt;<\/infAdProd>/);
});

// ------------------------------------------------------------ indIntermed
// Regressão real: a primeira NF-e enviada à SVRS voltou com
//   434 — Rejeicao: NF-e sem indicativo do intermediador
// (chave 11260837541736000187550030000000011862210289, série 3, número 1).
// A NT 2020.006 exige indIntermed sempre que indPres for 2, 3, 4 ou 9 — e
// este serializador emite indPres 9 (não presencial, outros). O campo não
// existia no ide.

test('indIntermed acompanha o indPres não presencial — rejeição 434 da SVRS', () => {
  const { xml } = montarXmlNFe(notaBase(), OPCOES);
  assert.match(xml, /<indPres>9<\/indPres>/);
  // 0 = operação sem intermediador. A 364 vende direto, não por marketplace.
  assert.match(xml, /<indIntermed>0<\/indIntermed>/);
});

test('indIntermed vem depois de indPres e antes de procEmi, como o schema exige', () => {
  const { xml } = montarXmlNFe(notaBase(), OPCOES);
  const ide = xml.slice(xml.indexOf('<ide>'), xml.indexOf('</ide>'));
  assert.ok(ide.indexOf('<indPres>') < ide.indexOf('<indIntermed>'),
    'indIntermed não pode vir antes de indPres');
  assert.ok(ide.indexOf('<indIntermed>') < ide.indexOf('<procEmi>'),
    'indIntermed tem de vir antes de procEmi');
});
