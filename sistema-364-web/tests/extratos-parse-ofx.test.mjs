import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOfx } from '../lib/extratos/parseOfx.js';

// OFX 1.x: SGML, tag de folha sem fechamento. É o que Sicoob, Sicredi e BB
// entregam hoje.
const OFX_102 = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
CHARSET:1252

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>BRL
<BANKACCTFROM><BANKID>756<ACCTID>12345-6<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20260801000000[-3:BRT]<DTEND>20260831000000[-3:BRT]
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260810000000[-3:BRT]<TRNAMT>-750.00<FITID>2026081001<MEMO>PIX ENVIADO BOI FORTE</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260812000000[-3:BRT]<TRNAMT>200.00<FITID>2026081202<MEMO>PIX RECEBIDO CLIENTE</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>1200.00<DTASOF>20260831000000[-3:BRT]</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

// OFX 2.x: XML de verdade, tudo fechado, tudo numa linha só.
const OFX_211 = `<?xml version="1.0" encoding="UTF-8"?><?OFX OFXHEADER="200" VERSION="211"?>`
  + `<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL</CURDEF><BANKTRANLIST>`
  + `<DTSTART>20260801</DTSTART><DTEND>20260831</DTEND>`
  + `<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260815</DTPOSTED><TRNAMT>-49.90</TRNAMT>`
  + `<FITID>X1</FITID><MEMO>TARIFA PACOTE SERVICOS</MEMO><CHECKNUM>445</CHECKNUM></STMTTRN>`
  + `</BANKTRANLIST><LEDGERBAL><BALAMT>950.10</BALAMT></LEDGERBAL>`
  + `</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

test('OFX 1.x: lê período, saldo final e os dois lançamentos', () => {
  const r = parseOfx(OFX_102);
  assert.equal(r.periodoInicio, '2026-08-01');
  assert.equal(r.periodoFim, '2026-08-31');
  assert.equal(r.saldoInicial, null, 'OFX não traz saldo inicial');
  assert.equal(r.saldoFinal, 1200);
  assert.equal(r.lancamentos.length, 2);
});

test('OFX 1.x: sinal do TRNAMT define tipo, e valor fica positivo', () => {
  const [debito, credito] = parseOfx(OFX_102).lancamentos;
  assert.deepEqual(debito, {
    data: '2026-08-10', descricao: 'PIX ENVIADO BOI FORTE', valor: 750,
    tipo: 'saida', documento: null, fitid: '2026081001',
  });
  assert.equal(credito.tipo, 'entrada');
  assert.equal(credito.valor, 200);
});

test('OFX 2.x: mesmo resultado com tags fechadas e arquivo em uma linha', () => {
  const r = parseOfx(OFX_211);
  assert.equal(r.periodoInicio, '2026-08-01');
  assert.equal(r.saldoFinal, 950.1);
  assert.equal(r.lancamentos.length, 1);
  assert.deepEqual(r.lancamentos[0], {
    data: '2026-08-15', descricao: 'TARIFA PACOTE SERVICOS', valor: 49.9,
    tipo: 'saida', documento: '445', fitid: 'X1',
  });
});

test('fatura de cartão (CCSTMTRS) é lida pelo mesmo caminho', () => {
  const cc = `<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><BANKTRANLIST>`
    + `<DTSTART>20260801</DTSTART><DTEND>20260831</DTEND>`
    + `<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260802</DTPOSTED><TRNAMT>-400.00</TRNAMT>`
    + `<FITID>C1</FITID><MEMO>MERCADO LIVRE</MEMO></STMTTRN>`
    + `</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;
  const r = parseOfx(cc);
  assert.equal(r.lancamentos.length, 1);
  assert.equal(r.lancamentos[0].descricao, 'MERCADO LIVRE');
});

test('OFX 1.x com transação única (SGML) não quebra o array', () => {
  const OFX_102_UNICA = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
CHARSET:1252

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>BRL
<BANKACCTFROM><BANKID>756<ACCTID>12345-6<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20260801000000[-3:BRT]<DTEND>20260831000000[-3:BRT]
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260810000000[-3:BRT]<TRNAMT>-100.50<FITID>2026081001<MEMO>PIX ENVIADO FORNECEDOR</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>900.50<DTASOF>20260831000000[-3:BRT]</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;
  const r = parseOfx(OFX_102_UNICA);
  assert.equal(r.lancamentos.length, 1);
  assert.deepEqual(r.lancamentos[0], {
    data: '2026-08-10', descricao: 'PIX ENVIADO FORNECEDOR', valor: 100.50,
    tipo: 'saida', documento: null, fitid: '2026081001',
  });
});

test('arquivo que não é OFX explica o problema em português', () => {
  assert.throws(() => parseOfx('isto nao e um ofx'), /não parece ser um arquivo OFX/i);
});

test('OFX sem nenhuma transação é erro, não extrato vazio silencioso', () => {
  const vazio = `<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>`
    + `<DTSTART>20260801</DTSTART><DTEND>20260831</DTEND></BANKTRANLIST>`
    + `</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  assert.throws(() => parseOfx(vazio), /nenhum lançamento/i);
});

test('MEMO ausente cai para NAME sem perder a linha', () => {
  const semMemo = `<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>`
    + `<DTSTART>20260801</DTSTART><DTEND>20260831</DTEND>`
    + `<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260810</DTPOSTED><TRNAMT>-10.00</TRNAMT>`
    + `<FITID>N1</FITID><NAME>DEB AUT ENERGISA</NAME></STMTTRN>`
    + `</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  assert.equal(parseOfx(semMemo).lancamentos[0].descricao, 'DEB AUT ENERGISA');
});

test('[REGRESSÃO] OFX 1.x: CHECKNUM vazio não come a transação seguinte', () => {
  const OFX_1x_checknum_vazio = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
CHARSET:1252

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>BRL
<BANKACCTFROM><BANKID>756<ACCTID>12345-6<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20260801000000[-3:BRT]<DTEND>20260831000000[-3:BRT]
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260810000000[-3:BRT]<TRNAMT>-750.00<FITID>2026081001<CHECKNUM>
<MEMO>PIX ENVIADO BOI FORTE</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260812000000[-3:BRT]<TRNAMT>200.00<FITID>2026081202<MEMO>PIX RECEBIDO CLIENTE</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>1200.00<DTASOF>20260831000000[-3:BRT]</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;
  const r = parseOfx(OFX_1x_checknum_vazio);
  assert.equal(r.lancamentos.length, 2, 'deve ter duas transações, não uma');
  const [debito, credito] = r.lancamentos;
  assert.equal(debito.descricao, 'PIX ENVIADO BOI FORTE', 'MEMO da primeira deve ser lido corretamente');
  assert.equal(debito.documento, null, 'CHECKNUM vazio deve ser null, não [object Object]');
  assert.equal(credito.tipo, 'entrada', 'segunda transação (crédito) não deve desaparecer');
  assert.equal(credito.valor, 200, 'crédito de 200 deve estar intacto');
});

test('[REGRESSÃO] OFX 2.x: MEMO vazio não vira [object Object]', () => {
  const OFX_2x_memo_vazio = `<?xml version="1.0" encoding="UTF-8"?><?OFX OFXHEADER="200" VERSION="211"?>`
    + `<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL</CURDEF><BANKTRANLIST>`
    + `<DTSTART>20260801</DTSTART><DTEND>20260831</DTEND>`
    + `<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260815</DTPOSTED><TRNAMT>-49.90</TRNAMT>`
    + `<FITID>X1</FITID><MEMO></MEMO><NAME>TARIFA PACOTE SERVICOS</NAME></STMTTRN>`
    + `</BANKTRANLIST><LEDGERBAL><BALAMT>950.10</BALAMT></LEDGERBAL>`
    + `</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  const r = parseOfx(OFX_2x_memo_vazio);
  assert.equal(r.lancamentos[0].descricao, 'TARIFA PACOTE SERVICOS', 'MEMO vazio deve cair para NAME, não virar [object Object]');
});
