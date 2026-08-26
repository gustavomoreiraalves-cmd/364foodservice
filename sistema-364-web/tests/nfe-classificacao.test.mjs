// tests/nfe-classificacao.test.mjs
//
// Classificação do retorno de NFeAutorizacao4 (lib/nfe/classificacao.js).
// Sem rede e sem banco: as respostas são envelopes SOAP montados à mão, no
// mesmo formato que a SEFAZ devolve, e passam pelas funções reais de
// lib/sefaz/envelope.js — nada de mock, porque metade dos defeitos que este
// arquivo cobre nasceram justamente na leitura do XML.
//
// O que está sendo protegido: um lote ainda em processamento (cStat 103/105,
// com recibo e sem protocolo) já foi classificado como 'rejeitado' aqui. Como
// 'rejeitado' convida a reemitir com número novo, isso produziu duas notas
// autorizadas para o mesmo pedido enquanto o lote original seguia a caminho de
// autorizar. A regressão a vigiar é qualquer caminho que volte a devolver
// 'rejeitado' para uma resposta com nRec e sem protNFe.
import test from 'node:test';
import assert from 'node:assert/strict';
import { extrairCorpoResposta } from '../lib/sefaz/envelope.js';
import {
  classificarResposta,
  CSTAT_AUTORIZADO, CSTAT_DENEGADO,
  STATUS_INDETERMINADO, STATUS_BLOQUEIA_REEMISSAO, STATUS_REAPROVEITAVEL,
} from '../lib/nfe/classificacao.js';

const CHAVE = '11260837541736000187550010000000011000000017';

function envelope(corpo) {
  return '<?xml version="1.0" encoding="utf-8"?>'
    + '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>'
    + '<nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">'
    + `<retEnviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${corpo}</retEnviNFe>`
    + '</nfeResultMsg></soap:Body></soap:Envelope>';
}

// Resposta síncrona completa: cStat do LOTE (104) diferente do cStat da NOTA
// (dentro de infProt). É a forma que mais importa acertar.
function comProtocolo({ cStat, xMotivo, cStatLote = '104', xMotivoLote = 'Lote processado', nProt = '111260000012345', nRec = null }) {
  return envelope(
    '<tpAmb>2</tpAmb><verAplic>RO_v4_0_6</verAplic>'
    + `<cStat>${cStatLote}</cStat><xMotivo>${xMotivoLote}</xMotivo>`
    + '<cUF>11</cUF><dhRecbto>2026-08-26T01:00:00-04:00</dhRecbto>'
    + (nRec ? `<infRec><nRec>${nRec}</nRec><tMed>1</tMed></infRec>` : '')
    + '<protNFe versao="4.00">'
    + `<infProt Id="ID${nProt}"><tpAmb>2</tpAmb><verAplic>RO_v4_0_6</verAplic>`
    + `<chNFe>${CHAVE}</chNFe><dhRecbto>2026-08-26T01:00:02-04:00</dhRecbto>`
    + `<nProt>${nProt}</nProt><digVal>Zm9v</digVal>`
    + `<cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo>`
    + '</infProt></protNFe>',
  );
}

// Só recibo do lote, sem protNFe: o processamento síncrono não terminou a
// tempo (indSinc=1 estourou a janela).
function soRecibo({ cStat, xMotivo, nRec = '411260000098765' }) {
  return envelope(
    '<tpAmb>2</tpAmb><verAplic>RO_v4_0_6</verAplic>'
    + `<cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo>`
    + '<cUF>11</cUF><dhRecbto>2026-08-26T01:00:00-04:00</dhRecbto>'
    + `<infRec><nRec>${nRec}</nRec><tMed>1</tMed></infRec>`,
  );
}

// Lote inteiro rejeitado antes de gerar protocolo ou recibo.
function loteRejeitado({ cStat, xMotivo }) {
  return envelope(
    '<tpAmb>2</tpAmb><verAplic>RO_v4_0_6</verAplic>'
    + `<cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo>`
    + '<cUF>11</cUF><dhRecbto>2026-08-26T01:00:00-04:00</dhRecbto>',
  );
}

const classificar = (xml) => classificarResposta(extrairCorpoResposta(xml));

// ---------------------------------------------------------------- autorizado

test('cStat 100 dentro de infProt é autorização, com protocolo', () => {
  const r = classificar(comProtocolo({ cStat: '100', xMotivo: 'Autorizado o uso da NF-e' }));
  assert.equal(r.situacao, 'autorizado');
  assert.equal(r.cStat, '100');
  assert.equal(r.protocolo, '111260000012345');
  assert.equal(r.motivo, null);
  assert.equal(r.nRec, null);
});

test('cStat 150 (autorizado fora de prazo) também é autorização, não rejeição', () => {
  // Já foi classificado como 'rejeitado' aqui — e rejeição convida a reemitir
  // uma nota que a SEFAZ tinha autorizado.
  const r = classificar(comProtocolo({ cStat: '150', xMotivo: 'Autorizado o uso da NF-e, autorizacao fora de prazo' }));
  assert.equal(r.situacao, 'autorizado');
  assert.equal(r.cStat, '150');
  assert.equal(r.protocolo, '111260000012345');
});

test('os dois cStat de autorização estão declarados', () => {
  assert.deepEqual(CSTAT_AUTORIZADO, ['100', '150']);
});

// ------------------------------------------------------------------ denegado

for (const [cStat, xMotivo] of [
  ['110', 'Uso Denegado'],
  ['301', 'Uso Denegado: Irregularidade fiscal do emitente'],
  ['302', 'Rejeicao: Irregularidade fiscal do destinatario'],
]) {
  test(`cStat ${cStat} é denegação, não rejeição — o número foi consumido`, () => {
    const r = classificar(comProtocolo({ cStat, xMotivo }));
    assert.equal(r.situacao, 'denegado');
    assert.equal(r.cStat, cStat);
    assert.equal(r.motivo, `${cStat} - ${xMotivo}`);
    // Denegação não gera protocolo de autorização utilizável.
    assert.equal(r.protocolo, null);
  });
}

test('os três cStat de denegação estão declarados', () => {
  assert.deepEqual(CSTAT_DENEGADO, ['110', '301', '302']);
});

// ------------------------------------------------------------- indeterminado

for (const [cStat, xMotivo] of [
  ['103', 'Lote recebido com sucesso'],
  ['105', 'Lote em processamento'],
]) {
  test(`cStat ${cStat} com nRec e sem protNFe é indeterminado, NUNCA rejeitado`, () => {
    const r = classificar(soRecibo({ cStat, xMotivo }));
    assert.equal(r.situacao, 'indeterminado');
    assert.notEqual(r.situacao, 'rejeitado');
    assert.equal(r.nRec, '411260000098765');
    assert.equal(r.protocolo, null);
    assert.equal(r.cStat, cStat);
  });
}

test('qualquer resposta com nRec e sem protNFe é indeterminada, mesmo com cStat desconhecido', () => {
  // A regra não é uma lista de cStat: é "recebeu, ainda não disse o veredito".
  const r = classificar(soRecibo({ cStat: '999', xMotivo: 'Codigo que este sistema nao conhece' }));
  assert.equal(r.situacao, 'indeterminado');
  assert.equal(r.nRec, '411260000098765');
});

// ----------------------------------------------------------------- rejeitado

test('rejeição do lote (sem protNFe e sem nRec) é rejeição — aí reemitir é correto', () => {
  const r = classificar(loteRejeitado({ cStat: '225', xMotivo: 'Rejeicao: Falha no Schema XML do lote de NFe' }));
  assert.equal(r.situacao, 'rejeitado');
  assert.equal(r.cStat, '225');
  assert.equal(r.motivo, '225 - Rejeicao: Falha no Schema XML do lote de NFe');
  assert.equal(r.nRec, null);
  assert.equal(r.protocolo, null);
});

test('veredito de rejeição dentro de infProt ganha do nRec do lote', () => {
  // infProt existe: a SEFAZ já disse o que aconteceu com ESTA nota. O nRec no
  // nível do lote não torna isso indeterminado.
  const r = classificar(comProtocolo({
    cStat: '204', xMotivo: 'Rejeicao: Duplicidade de NF-e',
    nRec: '411260000098765',
  }));
  assert.equal(r.situacao, 'rejeitado');
  assert.equal(r.cStat, '204');
  assert.equal(r.motivo, '204 - Rejeicao: Duplicidade de NF-e');
  assert.equal(r.nRec, '411260000098765');
});

// ------------------------------------------------------- a armadilha do nível

test('o veredito vem de infProt, não do lote: 104 no lote com 204 na nota é rejeitado', () => {
  // Ler o cStat do LOTE aqui devolveria 104 ("Lote processado"), que não está
  // em CSTAT_AUTORIZADO — mas o mesmo engano com 100 no lote marcaria como
  // autorizada uma nota rejeitada. O caso abaixo prova que o escopo infProt
  // está sendo usado.
  const r = classificar(comProtocolo({ cStat: '204', xMotivo: 'Rejeicao: Duplicidade de NF-e' }));
  assert.equal(r.cStat, '204');
  assert.notEqual(r.cStat, '104');
  assert.equal(r.situacao, 'rejeitado');
});

test('cStat 100 no nível do lote não autoriza nada sem infProt', () => {
  // Resposta malformada/inesperada: 100 solto no lote, sem protNFe e sem
  // nRec. Não pode virar 'autorizado' — não há protocolo nenhum.
  const r = classificar(loteRejeitado({ cStat: '100', xMotivo: 'Autorizado o uso da NF-e' }));
  assert.notEqual(r.situacao, 'autorizado');
  assert.equal(r.situacao, 'rejeitado');
  assert.equal(r.protocolo, null);
});

// ------------------------------------- invariantes dos conjuntos de status

test('rejeitado fica fora de STATUS_INDETERMINADO e autorizado/denegado bloqueiam reemissão', () => {
  assert.ok(!STATUS_INDETERMINADO.includes('rejeitado'));
  assert.deepEqual(STATUS_BLOQUEIA_REEMISSAO, ['autorizado', 'denegado']);
  assert.ok(STATUS_INDETERMINADO.includes('enviado'));
  assert.ok(STATUS_INDETERMINADO.includes('erro_comunicacao'));
});

test('nenhum status reaproveitável é, ao mesmo tempo, indeterminado ou bloqueante', () => {
  // Reaproveitar um número que a SEFAZ já pode ter visto é o caminho para a
  // nota duplicada; os conjuntos não podem se sobrepor.
  for (const status of STATUS_REAPROVEITAVEL) {
    assert.ok(!STATUS_INDETERMINADO.includes(status), `${status} não pode ser reaproveitável e indeterminado`);
    assert.ok(!STATUS_BLOQUEIA_REEMISSAO.includes(status), `${status} não pode ser reaproveitável e bloqueante`);
  }
});
