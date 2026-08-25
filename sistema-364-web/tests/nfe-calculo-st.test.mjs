import test from 'node:test';
import assert from 'node:assert/strict';
import { calcularIcmsST, arredondar } from '../lib/nfe/calculoST.js';

// Vetores extraídos da NF-e 34.840, série 1, emitida pelo frigorífico em
// 21/08/2026 e autorizada sob o protocolo 211260024029638 — três itens de carne
// bovina, CEST 17.084.00, CST 70, comprados pela 364. São os únicos números
// desta base que vieram de um documento que a SEFAZ já aceitou.
const NOTA_ENTRADA = [
  { item: 1, ncm: '02013000', vProd: 2741.52, vBC: 1599.13, vICMS: 191.90, vBCST: 2158.82, vICMSST: 67.16 },
  { item: 2, ncm: '02023000', vProd: 3110.64, vBC: 1814.44, vICMS: 217.73, vBCST: 2449.49, vICMSST: 76.21 },
  { item: 3, ncm: '02023000', vProd: 1482.84, vBC: 864.94, vICMS: 103.79, vBCST: 1167.67, vICMSST: 36.33 },
];

const PARAMETROS_RO_84 = { aliquota: 12, reducaoBase: 41.67, mva: 35, reducaoBaseST: 41.67 };

test('reproduz item a item o ICMS e a ST de uma NF-e autorizada', () => {
  for (const esperado of NOTA_ENTRADA) {
    const calculado = calcularIcmsST({ valorProduto: esperado.vProd, ...PARAMETROS_RO_84 });
    assert.equal(calculado.vBC, esperado.vBC, `vBC do item ${esperado.item}`);
    assert.equal(calculado.vICMS, esperado.vICMS, `vICMS do item ${esperado.item}`);
    assert.equal(calculado.vBCST, esperado.vBCST, `vBCST do item ${esperado.item}`);
    assert.equal(calculado.vICMSST, esperado.vICMSST, `vICMSST do item ${esperado.item}`);
  }
});

test('a soma dos itens bate com os totais da nota', () => {
  const total = NOTA_ENTRADA.reduce(
    (acumulado, esperado) => {
      const c = calcularIcmsST({ valorProduto: esperado.vProd, ...PARAMETROS_RO_84 });
      return {
        vProd: arredondar(acumulado.vProd + esperado.vProd),
        vBC: arredondar(acumulado.vBC + c.vBC),
        vICMS: arredondar(acumulado.vICMS + c.vICMS),
        vBCST: arredondar(acumulado.vBCST + c.vBCST),
        vST: arredondar(acumulado.vST + c.vICMSST),
      };
    },
    { vProd: 0, vBC: 0, vICMS: 0, vBCST: 0, vST: 0 },
  );

  // Bloco ICMSTot da nota.
  assert.equal(total.vProd, 7335.0);
  assert.equal(total.vBC, 4278.51);
  assert.equal(total.vICMS, 513.42);
  assert.equal(total.vBCST, 5775.98);
  assert.equal(total.vST, 179.7);
  // vNF = produtos + ST retida, que é o que o frigorífico cobrou em duplicata.
  assert.equal(arredondar(total.vProd + total.vST), 7514.7);
});

test('sem redução de base a conta é a clássica', () => {
  const r = calcularIcmsST({ valorProduto: 1000, aliquota: 12, mva: 35 });
  assert.equal(r.vBC, 1000);
  assert.equal(r.vICMS, 120);
  assert.equal(r.vBCST, 1350);
  assert.equal(r.vICMSST, 42); // 162 - 120
});

test('no Simples Nacional não há ICMS próprio a abater da ST', () => {
  const normal = calcularIcmsST({ valorProduto: 1000, aliquota: 12, mva: 35 });
  const simples = calcularIcmsST({
    valorProduto: 1000, aliquota: 12, mva: 35, creditaOperacaoPropria: false,
  });
  assert.equal(simples.vICMSST, 162);
  assert.ok(simples.vICMSST > normal.vICMSST, 'o Simples retém mais, não menos');
});

test('frete e despesas entram na base, desconto sai', () => {
  const r = calcularIcmsST({
    valorProduto: 1000, frete: 100, seguro: 20, outrasDespesas: 30, desconto: 50,
    aliquota: 12, mva: 35,
  });
  assert.equal(r.valorOperacao, 1100);
  assert.equal(r.vBC, 1100);
  assert.equal(r.vICMSST, arredondar(1100 * 1.35 * 0.12 - 132));
});

test('ST nunca sai negativa', () => {
  const r = calcularIcmsST({ valorProduto: 1000, aliquota: 12, mva: 0, aliquotaST: 7 });
  assert.equal(r.vICMSST, 0);
});

test('arredonda meio para cima, e não meio para par', () => {
  assert.equal(arredondar(1.005), 1.01);
  assert.equal(arredondar(2.675), 2.68);
  assert.equal(arredondar(0.145), 0.15);
});
