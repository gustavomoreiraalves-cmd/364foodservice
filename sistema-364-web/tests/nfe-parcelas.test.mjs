import { test } from 'node:test';
import assert from 'node:assert/strict';

// lib/financeiro.js importa lib/format.js, que importa lib/supabase.js.
// Basta um par de valores de fachada antes do import.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'chave-anon-de-teste';
const { parcelasDoRecebimento, ORIGEM_PARCELAS, AVISO_PARCELAS } = await import('../lib/nfe/parcelas.js');

const DUP = [
  { numero: '001', vencimento: '2026-09-02', valor: 1378.5 },
  { numero: '002', vencimento: '2026-09-17', valor: 1378.5 },
];

test('usa as duplicatas quando o total aceito bate com a soma dos itens', () => {
  const r = parcelasDoRecebimento({
    duplicatas: DUP, dataBase: '2026-08-18',
    valorLancado: 2757, somaItensNota: 2757, numeroParcelas: 1, intervaloDias: 30,
  });
  assert.equal(r.origem, ORIGEM_PARCELAS.NOTA);
  assert.deepEqual(r.parcelas, [
    { numero: 1, valor: 1378.5, vencimento: '2026-09-02' },
    { numero: 2, valor: 1378.5, vencimento: '2026-09-17' },
  ]);
  assert.equal(r.parcelas.reduce((s, p) => s + p.valor, 0), 2757);
});

test('nota com frete: duplicatas somam mais que os itens e continuam valendo', () => {
  // vNF = 2900 (2757 de produto + 143 de frete). As duplicatas seguem o vNF, mas
  // a conferência é sobre os itens — a regra antiga rejeitaria esta nota.
  const comFrete = [
    { numero: '001', vencimento: '2026-09-02', valor: 1450 },
    { numero: '002', vencimento: '2026-09-17', valor: 1450 },
  ];
  const r = parcelasDoRecebimento({
    duplicatas: comFrete, dataBase: '2026-08-18',
    valorLancado: 2757, somaItensNota: 2757, numeroParcelas: 1, intervaloDias: 30,
  });
  assert.equal(r.origem, ORIGEM_PARCELAS.NOTA);
  assert.equal(r.parcelas.reduce((s, p) => s + p.valor, 0), 2900);
});

test('divergência de pesagem dentro de 0,5% mantém as duplicatas', () => {
  const r = parcelasDoRecebimento({
    duplicatas: DUP, dataBase: '2026-08-18',
    valorLancado: 2745, somaItensNota: 2757, numeroParcelas: 1, intervaloDias: 30,
  });
  assert.equal(r.origem, ORIGEM_PARCELAS.NOTA);
});

test('divergência de pesagem acima de 0,5% cai no parcelamento manual', () => {
  const r = parcelasDoRecebimento({
    duplicatas: DUP, dataBase: '2026-08-18',
    valorLancado: 2700, somaItensNota: 2757, numeroParcelas: 2, intervaloDias: 30,
  });
  assert.equal(r.origem, ORIGEM_PARCELAS.MANUAL_VALOR_DIVERGENTE);
  assert.equal(r.parcelas.length, 2);
  assert.equal(r.parcelas.reduce((s, p) => s + p.valor, 0), 2700);
});

test('item fora do aceite descarta as duplicatas mesmo com o valor batendo', () => {
  const r = parcelasDoRecebimento({
    duplicatas: DUP, dataBase: '2026-08-18',
    valorLancado: 2757, somaItensNota: 2757, temItemNaoAceito: true,
    numeroParcelas: 2, intervaloDias: 30,
  });
  assert.equal(r.origem, ORIGEM_PARCELAS.MANUAL_ITEM_NAO_ACEITO);
  assert.equal(r.parcelas.length, 2);
  assert.equal(r.parcelas.reduce((s, p) => s + p.valor, 0), 2757);
});

test('duplicata sem vencimento cai no parcelamento manual', () => {
  const semVenc = [
    { numero: '001', vencimento: '', valor: 1378.5 },
    { numero: '002', vencimento: '2026-09-17', valor: 1378.5 },
  ];
  const r = parcelasDoRecebimento({
    duplicatas: semVenc, dataBase: '2026-08-18',
    valorLancado: 2757, somaItensNota: 2757, numeroParcelas: 1, intervaloDias: 30,
  });
  assert.equal(r.origem, ORIGEM_PARCELAS.MANUAL_VENCIMENTO_INVALIDO);
  assert.deepEqual(r.parcelas, [{ numero: 1, valor: 2757, vencimento: '2026-08-18' }]);
});

test('duplicata com vencimento fora do formato ISO também cai no manual', () => {
  const ruim = [{ numero: '001', vencimento: '02/09/2026', valor: 2757 }];
  const r = parcelasDoRecebimento({
    duplicatas: ruim, dataBase: '2026-08-18',
    valorLancado: 2757, somaItensNota: 2757, numeroParcelas: 1, intervaloDias: 30,
  });
  assert.equal(r.origem, ORIGEM_PARCELAS.MANUAL_VENCIMENTO_INVALIDO);
});

test('nota sem duplicatas cai no gerarParcelas atual', () => {
  const r = parcelasDoRecebimento({
    duplicatas: [], dataBase: '2026-08-18',
    valorLancado: 1000, somaItensNota: 1000, numeroParcelas: 1, intervaloDias: 30,
  });
  assert.equal(r.origem, ORIGEM_PARCELAS.MANUAL);
  assert.deepEqual(r.parcelas, [{ numero: 1, valor: 1000, vencimento: '2026-08-18' }]);
});

test('diferença de centavo é tolerada e as duplicatas valem', () => {
  const r = parcelasDoRecebimento({
    duplicatas: DUP, dataBase: '2026-08-18',
    valorLancado: 2756.995, somaItensNota: 2757, numeroParcelas: 1, intervaloDias: 30,
  });
  assert.equal(r.origem, ORIGEM_PARCELAS.NOTA);
});

test('todo motivo de queda para o manual tem aviso próprio', () => {
  for (const origem of [
    ORIGEM_PARCELAS.MANUAL_ITEM_NAO_ACEITO,
    ORIGEM_PARCELAS.MANUAL_VALOR_DIVERGENTE,
    ORIGEM_PARCELAS.MANUAL_VENCIMENTO_INVALIDO,
  ]) {
    assert.equal(typeof AVISO_PARCELAS[origem], 'string');
    assert.ok(AVISO_PARCELAS[origem].length > 0);
  }
  assert.equal(AVISO_PARCELAS[ORIGEM_PARCELAS.NOTA], undefined);
  assert.equal(AVISO_PARCELAS[ORIGEM_PARCELAS.MANUAL], undefined);
});
