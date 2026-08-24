import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../lib/extratos/parseCsv.js';

const CSV_SICOOB = `Extrato de conta corrente
Conta: 12345-6

Data;Histórico;Documento;Valor
10/08/2026;PIX ENVIADO BOI FORTE;123456;-750,00
12/08/2026;PIX RECEBIDO CLIENTE;123457;200,00
31/08/2026;SALDO DO DIA;;1.200,00
`;

test('lê CSV com ponto e vírgula, data BR e valor com vírgula', () => {
  const r = parseCsv(CSV_SICOOB);
  assert.equal(r.reconhecido, true);
  assert.equal(r.lancamentos.length, 2, 'linha de saldo não é lançamento');
  assert.deepEqual(r.lancamentos[0], {
    data: '2026-08-10', descricao: 'PIX ENVIADO BOI FORTE', valor: 750,
    tipo: 'saida', documento: '123456', fitid: null,
  });
  assert.equal(r.lancamentos[1].tipo, 'entrada');
});

test('período sai da primeira e da última data', () => {
  const r = parseCsv(CSV_SICOOB);
  assert.equal(r.periodoInicio, '2026-08-10');
  assert.equal(r.periodoFim, '2026-08-12');
});

test('aceita vírgula como separador e cabeçalho em inglês', () => {
  const csv = 'Date,Description,Amount\n2026-08-10,MERCADO LIVRE,-400.00\n';
  const r = parseCsv(csv);
  assert.equal(r.reconhecido, true);
  assert.deepEqual(r.lancamentos[0].valor, 400);
  assert.equal(r.lancamentos[0].tipo, 'saida');
});

test('campo entre aspas com separador dentro não parte a coluna', () => {
  const csv = 'Data;Histórico;Valor\n10/08/2026;"BOI FORTE; MATRIZ";-750,00\n';
  assert.equal(parseCsv(csv).lancamentos[0].descricao, 'BOI FORTE; MATRIZ');
});

test('arquivo sem cabeçalho reconhecível não é erro — devolve reconhecido false', () => {
  const r = parseCsv('bla bla bla\noutra linha qualquer\n');
  assert.equal(r.reconhecido, false);
  assert.deepEqual(r.lancamentos, []);
});

test('cabeçalho sem coluna de valor não é reconhecido', () => {
  const r = parseCsv('Data;Histórico\n10/08/2026;ALGO\n');
  assert.equal(r.reconhecido, false);
});

test('linha com valor ilegível é descartada, o resto entra', () => {
  const csv = 'Data;Histórico;Valor\n10/08/2026;BOM;-750,00\n11/08/2026;RUIM;abc\n';
  const r = parseCsv(csv);
  assert.equal(r.lancamentos.length, 1);
  assert.equal(r.lancamentos[0].descricao, 'BOM');
});

test('CSV não traz saldo: conferência aritmética fica de fora', () => {
  const r = parseCsv(CSV_SICOOB);
  assert.equal(r.saldoInicial, null);
  assert.equal(r.saldoFinal, null);
});

test('[REGRESSION] cabeçalho "Data Lançamento;Histórico;Valor" — descrição não vira data', () => {
  // Testa o bug onde "Data Lançamento" reivindicava tanto o papel de data quanto
  // de descricao (porque a regex de descrição continha "lançamento"). Sem o `break`,
  // mapa[descricao] apontava para coluna 0 em vez de 1, e a descricao de cada
  // lançamento virava a data.
  const csv = 'Data Lançamento;Histórico;Valor\n10/08/2026;FORNECEDOR XYZ;-500,00\n';
  const r = parseCsv(csv);
  assert.equal(r.reconhecido, true, 'cabeçalho deve ser reconhecido');
  assert.equal(r.lancamentos.length, 1);
  const lance = r.lancamentos[0];
  assert.equal(lance.data, '2026-08-10', 'data deve vir da coluna 0');
  assert.equal(lance.descricao, 'FORNECEDOR XYZ', 'descrição deve ser o conteúdo de Histórico (coluna 1), não a data');
  assert.equal(lance.valor, 500);
  assert.equal(lance.tipo, 'saida');
});
