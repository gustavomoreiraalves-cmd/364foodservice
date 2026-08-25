import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validarRegraTributaria, cfopSugerido, descreverDestinatario, resumoRegra,
  CSOSN_QUE_PERMITE_CREDITO, ST_RESPONSAVEL,
} from '../lib/fiscalRegras.js';

const BASE = {
  grupo_tributario_id: 'g1', natureza_operacao_id: 'n1', cfop: '5101',
  csosn: '102', uf_destino: '*', st_responsavel: 'nao_aplicavel',
};

test('a regra precisa de exatamente um alvo', () => {
  assert.deepEqual(validarRegraTributaria(BASE), []);
  assert.ok(validarRegraTributaria({ ...BASE, grupo_tributario_id: null })
    .some(e => /alvo/i.test(e)), 'sem alvo nenhum');
  assert.ok(validarRegraTributaria({ ...BASE, produto_id: 'p1' })
    .some(e => /alvo/i.test(e)), 'grupo e produto ao mesmo tempo');
  assert.deepEqual(
    validarRegraTributaria({ ...BASE, grupo_tributario_id: null, ncm_generico: '02102000' }), []);
});

test('substituto sem MVA é recusado, substituído não precisa', () => {
  const substituto = { ...BASE, st_responsavel: ST_RESPONSAVEL.SUBSTITUTO, csosn: '202', cfop: '5401' };
  assert.ok(validarRegraTributaria(substituto).some(e => /MVA/i.test(e)));
  assert.deepEqual(validarRegraTributaria({ ...substituto, mva_percentual: 35 }), []);

  const substituido = { ...BASE, st_responsavel: ST_RESPONSAVEL.SUBSTITUIDO, csosn: '500', cfop: '5405' };
  assert.deepEqual(validarRegraTributaria(substituido), [], 'quem já sofreu a retenção não recalcula MVA');
});

test('crédito do Simples só em CSOSN que permite crédito', () => {
  assert.ok(validarRegraTributaria({ ...BASE, csosn: '102', permite_credito_simples: true })
    .some(e => /cr[ée]dito/i.test(e)));
  for (const csosn of CSOSN_QUE_PERMITE_CREDITO) {
    assert.deepEqual(validarRegraTributaria({ ...BASE, csosn, permite_credito_simples: true }), [],
      `CSOSN ${csosn} deveria aceitar crédito`);
  }
});

test('CFOP e UF têm formato conferido', () => {
  assert.ok(validarRegraTributaria({ ...BASE, cfop: '510' }).some(e => /CFOP/i.test(e)));
  assert.ok(validarRegraTributaria({ ...BASE, cfop: '' }).some(e => /CFOP/i.test(e)));
  assert.ok(validarRegraTributaria({ ...BASE, uf_destino: 'RONDONIA' }).some(e => /UF/i.test(e)));
  assert.deepEqual(validarRegraTributaria({ ...BASE, uf_destino: 'RO' }), []);
});

test('CFOP de saída não serve para natureza de entrada', () => {
  assert.ok(validarRegraTributaria({ ...BASE, tipo_operacao: 'entrada', cfop: '5101' })
    .some(e => /entrada/i.test(e)));
  assert.deepEqual(validarRegraTributaria({ ...BASE, tipo_operacao: 'entrada', cfop: '1202' }), []);
  assert.ok(validarRegraTributaria({ ...BASE, tipo_operacao: 'saida', cfop: '1202' })
    .some(e => /sa[íi]da/i.test(e)));
});

test('vigência final não pode ser antes da inicial', () => {
  assert.ok(validarRegraTributaria({ ...BASE, vigencia_inicio: '2026-08-01', vigencia_fim: '2026-07-01' })
    .some(e => /vig[êe]ncia/i.test(e)));
  assert.deepEqual(
    validarRegraTributaria({ ...BASE, vigencia_inicio: '2026-08-01', vigencia_fim: '2026-08-01' }), []);
});

test('CFOP sugerido pela operação', () => {
  assert.equal(cfopSugerido({ producaoPropria: true, stResponsavel: 'nao_aplicavel' }), '5101');
  assert.equal(cfopSugerido({ producaoPropria: false, stResponsavel: 'nao_aplicavel' }), '5102');
  assert.equal(cfopSugerido({ producaoPropria: true, stResponsavel: 'substituto' }), '5401');
  assert.equal(cfopSugerido({ producaoPropria: false, stResponsavel: 'substituto' }), '5403');
  assert.equal(cfopSugerido({ producaoPropria: false, stResponsavel: 'substituido' }), '5405');
  // Fora de Rondônia o primeiro dígito muda, e só ele.
  assert.equal(cfopSugerido({ producaoPropria: true, stResponsavel: 'substituto', mesmaUf: false }), '6401');
});

test('descrição do destinatário é legível', () => {
  assert.match(descreverDestinatario({}), /qualquer/i);
  assert.match(descreverDestinatario({ destinatario_contribuinte: true }), /contribuinte/i);
  assert.match(descreverDestinatario({ destinatario_consumidor_final: true }), /consumidor final/i);
  assert.match(
    descreverDestinatario({ destinatario_contribuinte: false, destinatario_consumidor_final: true }),
    /n[ãa]o contribuinte/i);
});

test('resumo mostra o essencial da regra numa linha', () => {
  const texto = resumoRegra({ ...BASE, cfop: '5401', csosn: '202', st_responsavel: 'substituto', mva_percentual: 35 });
  assert.match(texto, /5401/);
  assert.match(texto, /202/);
  assert.match(texto, /35/);
});
