// O que a rota decide sobre cada destino é lógica pura, testada aqui sem banco
// e sem Next. A rota fica fina de propósito: autoriza, chama isto, grava.
//
// Fora do alcance destes testes, e sem cobertura automatizada: a checagem de
// módulo (autorizarModulo), o acesso por empresa (garantirProduto) e a gravação
// em audit_logs. Os três são exercidos na verificação manual da entrega —
// dizer isso aqui é melhor do que fingir que estão cobertos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { avaliarDestino } from '../lib/fiscalCopia.js';
import { camposCopiaFiscal } from '../lib/fiscal.js';

const ORIGEM = { id: 'p1', nome: 'Costela Defumada 500g', empresa_id: 'e1' };

const FONTE_COMPLETA = {
  ncm: '02102000', ex_tipi: null, cest: '1708300', origem_mercadoria: 0,
  unidade_tributavel: 'KG', fator_conversao_tributavel: 1,
  grupo_tributario_id: 'g1', ind_escala: 'S', cnpj_fabricante: null, cst_ibs_cbs: null,
  sujeito_st: true,
};

const DESTINO = {
  id: 'p2', nome: 'Cupim Defumado 500g', empresa_id: 'e1', unidade: 'KG',
  gtin: null, gtin_tributavel: null, sujeito_st: true, ativo_fiscal: false,
};

const avaliar = (extra = {}, opcoes = {}) => avaliarDestino({
  origem: ORIGEM,
  destino: { ...DESTINO, ...(opcoes.destino || {}) },
  payload: camposCopiaFiscal({ ...FONTE_COMPLETA, ...extra }),
  liberar: opcoes.liberar ?? true,
});

test('destino de outra marca é recusado', () => {
  // grupo_tributario_id pertence a uma empresa: propagá-lo entre CNPJs produz
  // regra que nunca resolve e leva configuração fiscal de um estabelecimento
  // para outro.
  const r = avaliar({}, { destino: { empresa_id: 'e2' } });
  assert.equal(r.ok, false);
  assert.match(r.erro, /outra marca/i);
  assert.equal(r.gravar, undefined, 'destino recusado não pode ter nada a gravar');
});

test('destino que fica completo depois da cópia é liberado', () => {
  const r = avaliar();
  assert.equal(r.ok, true);
  assert.equal(r.liberado, true);
  assert.deepEqual(r.pendencias, []);
  assert.equal(r.gravar.ativo_fiscal, true);
});

test('a decisão olha o produto DEPOIS da cópia, não antes', () => {
  // O destino chega sem NCM nenhum; é a cópia que o completa. Avaliar o estado
  // anterior recusaria toda liberação e a ação nunca apareceria na tela.
  assert.equal(DESTINO.ncm, undefined);
  assert.equal(avaliar().liberado, true);
});

test('sem pedir liberação, ativo_fiscal não é tocado', () => {
  const r = avaliar({}, { liberar: false });
  assert.equal(r.liberado, false);
  assert.ok(!('ativo_fiscal' in r.gravar),
    'copiar não pode assinar embaixo de uma classificação que ninguém olhou');
});

test('destino que continua incompleto não é liberado e diz o que falta', () => {
  const r = avaliar({ ncm: null });
  assert.equal(r.liberado, false);
  assert.ok(!('ativo_fiscal' in r.gravar));
  assert.ok(r.pendencias.some(p => /NCM/i.test(p)), r.pendencias.join(' | '));
});

test('pendência que a cópia não resolve continua barrando', () => {
  // Código de barras inválido é do produto, não da classificação — a cópia não
  // toca nele, e ele impede a emissão do mesmo jeito.
  const r = avaliar({}, { destino: { gtin: '123' } });
  assert.equal(r.liberado, false);
  assert.ok(r.pendencias.some(p => /barras/i.test(p)), r.pendencias.join(' | '));
});

test('produto sujeito a ST sem CEST na fonte não é liberado', () => {
  const r = avaliar({ cest: null });
  assert.equal(r.liberado, false);
  assert.ok(r.pendencias.some(p => /CEST/i.test(p)), r.pendencias.join(' | '));
});

test('o payload gravado espelha a fonte, inclusive o vazio', () => {
  const r = avaliar({ cest: null }, { liberar: false });
  assert.ok('cest' in r.gravar);
  assert.equal(r.gravar.cest, null, 'copiar é substituir, não mesclar');
});

test('origem sem ST limpa a marca do destino junto com o CEST', () => {
  // Antes de sujeito_st entrar na cópia, o destino ficava marcado como sujeito
  // a ST e sem CEST — cadastro incoerente que só aparecia na hora de emitir.
  const r = avaliar({ sujeito_st: false, cest: null }, { liberar: false });
  assert.equal(r.gravar.sujeito_st, false);
  assert.equal(r.gravar.cest, null);
  assert.deepEqual(r.pendencias, [], 'sem ST, a ausência de CEST não é pendência');
});
