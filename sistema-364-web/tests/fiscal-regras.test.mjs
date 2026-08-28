import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validarRegraTributaria, cfopSugerido, descreverDestinatario, resumoRegra,
  CSOSN_QUE_PERMITE_CREDITO, ST_RESPONSAVEL,
  CST_PIS_COFINS, cstPisCofinsPara, regimeDoEmpregador,
  LIMITE_INF_AD_PROD, juntarTextoFiscal,
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

// ---------- CST de PIS e COFINS ----------

const CST_SAIDA = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '49'];
const CST_ENTRADA = ['50', '51', '52', '53', '54', '55', '56',
                     '60', '61', '62', '63', '64', '65', '66', '67',
                     '70', '71', '72', '73', '74', '75', '98', '99'];

const codigosDe = grupos => grupos.flatMap(g => g.itens.map(i => i.valor));

test('a tabela de CST de PIS/COFINS traz saída e entrada do ADE Cofis 25/2010', () => {
  assert.deepEqual(CST_PIS_COFINS.filter(c => c.sentido === 'S').map(c => c.codigo), CST_SAIDA);
  assert.deepEqual(CST_PIS_COFINS.filter(c => c.sentido === 'E').map(c => c.codigo), CST_ENTRADA);
  assert.ok(CST_PIS_COFINS.every(c => c.descricao.trim().length > 0), 'todo código tem descrição');
});

test('o select de CST oferece só os códigos do sentido da natureza', () => {
  const saida = codigosDe(cstPisCofinsPara('saida', 'simples'));
  assert.deepEqual(saida.slice().sort(), CST_SAIDA.slice().sort());

  const entrada = codigosDe(cstPisCofinsPara('entrada', 'simples'));
  assert.deepEqual(entrada.slice().sort(), CST_ENTRADA.slice().sort());
});

test('o regime destaca os usuais sem esconder nenhum código', () => {
  const grupos = cstPisCofinsPara('saida', 'simples');
  assert.equal(grupos.length, 2, 'usuais e outros');
  assert.match(grupos[0].grupo, /simples/i);
  assert.equal(grupos[0].itens[0].valor, '49', 'o mais usado do Simples na saída vem primeiro');

  const todos = codigosDe(grupos);
  assert.equal(todos.length, CST_SAIDA.length);
  assert.equal(new Set(todos).size, CST_SAIDA.length, 'nenhum código repetido entre os grupos');
});

test('sem regime conhecido o select mostra um grupo só, sem destaque', () => {
  const grupos = cstPisCofinsPara('saida', null);
  assert.equal(grupos.length, 1);
  assert.deepEqual(codigosDe(grupos).slice().sort(), CST_SAIDA.slice().sort());
});

test('o rótulo do CST mostra código e descrição', () => {
  const item = codigosDe(cstPisCofinsPara('saida', null)).length &&
    cstPisCofinsPara('saida', null)[0].itens.find(i => i.valor === '49');
  assert.match(item.label, /^49 — /);
});

test('regime sai do CRT e cai no regime_tributario quando o CRT está vazio', () => {
  assert.equal(regimeDoEmpregador({ crt: 1 }), 'simples');
  assert.equal(regimeDoEmpregador({ crt: 2 }), 'simples', 'excesso de sublimite ainda é Simples');
  assert.equal(regimeDoEmpregador({ crt: 3, regime_tributario: 'real' }), 'real');
  assert.equal(regimeDoEmpregador({ crt: null, regime_tributario: 'simples' }), 'simples');
  assert.equal(regimeDoEmpregador({ crt: 3 }), null,
    'CRT 3 sozinho não distingue presumido de real — sem destaque é melhor que destaque errado');
  assert.equal(regimeDoEmpregador(null), null);
});

test('CST de PIS/COFINS fora da tabela é recusado', () => {
  assert.ok(validarRegraTributaria({ ...BASE, cst_pis: '88' }).some(e => /CST do PIS/i.test(e)));
  assert.ok(validarRegraTributaria({ ...BASE, cst_cofins: '88' }).some(e => /CST da COFINS/i.test(e)));
  assert.deepEqual(validarRegraTributaria({ ...BASE, cst_pis: '49', cst_cofins: '49' }), []);
});

test('CST de entrada não serve para natureza de saída', () => {
  const saida = validarRegraTributaria({ ...BASE, tipo_operacao: 'saida', cst_pis: '70', cst_cofins: '70' });
  assert.ok(saida.some(e => /CST do PIS 70 é de entrada/i.test(e)));
  assert.ok(saida.some(e => /CST da COFINS 70 é de entrada/i.test(e)));

  const entrada = validarRegraTributaria(
    { ...BASE, tipo_operacao: 'entrada', cfop: '1202', cst_pis: '49', cst_cofins: '70' });
  assert.ok(entrada.some(e => /CST do PIS 49 é de sa[íi]da/i.test(e)));
  assert.ok(!entrada.some(e => /COFINS/i.test(e)), '70 está certo numa entrada');
});

test('CST em branco continua aceito — o campo ainda não é obrigatório', () => {
  assert.deepEqual(validarRegraTributaria({ ...BASE, cst_pis: '', cst_cofins: null }), []);
});

test('juntarTextoFiscal põe a base legal antes da observação, separadas por travessão', () => {
  assert.equal(
    juntarTextoFiscal('RICMS-RO Anexo VI, item 84.0', 'ICMS retido por ST'),
    'RICMS-RO Anexo VI, item 84.0 — ICMS retido por ST',
  );
});

test('juntarTextoFiscal omite a parte vazia em vez de deixar o separador solto', () => {
  assert.equal(juntarTextoFiscal('só a base legal', ''), 'só a base legal');
  assert.equal(juntarTextoFiscal(null, 'só a observação'), 'só a observação');
  assert.equal(juntarTextoFiscal('  ', null), undefined,
    'espaço em branco não é texto: viraria um infAdProd vazio no XML');
  assert.equal(juntarTextoFiscal(null, null), undefined);
});

test('alíquota de PIS/COFINS acima de 99,9999 é recusada no formulário, não no banco', () => {
  // As colunas são numeric(6,4): dois dígitos inteiros, quatro decimais.
  // Gravar 100 estoura a precisão e volta como erro cru do PostgREST.
  const erros = validarRegraTributaria({ ...BASE, aliquota_pis: 100 });
  assert.ok(erros.some(e => /alíquota do PIS/i.test(e)), erros.join(' | '));
  assert.equal(validarRegraTributaria({ ...BASE, aliquota_pis: 99.9999 }).length, 0);
});

test('alíquota negativa ou não numérica é recusada', () => {
  assert.ok(validarRegraTributaria({ ...BASE, aliquota_cofins: -1 })
    .some(e => /alíquota da COFINS/i.test(e)));
  assert.ok(validarRegraTributaria({ ...BASE, aliquota_cofins: 'sete' })
    .some(e => /alíquota da COFINS/i.test(e)));
});

test('alíquota em branco é permitida — o resolver já trata nulo como zero', () => {
  assert.equal(validarRegraTributaria({ ...BASE, aliquota_pis: '', aliquota_cofins: null }).length, 0);
});

test('base legal e observação somadas não passam de 500 caracteres', () => {
  // A validação vive no cadastro porque falhar na emissão é caro: o operador
  // já escolheu o pedido e abriu a tela. Falhar aqui é de graça.
  const erros = validarRegraTributaria({
    ...BASE, base_legal: 'a'.repeat(300), observacao_fiscal: 'b'.repeat(300),
  });
  assert.ok(erros.some(e => e.includes(String(LIMITE_INF_AD_PROD))), erros.join(' | '));
  assert.equal(
    validarRegraTributaria({ ...BASE, base_legal: 'a'.repeat(200), observacao_fiscal: 'b'.repeat(200) }).length,
    0,
  );
});
