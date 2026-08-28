import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAMPOS_FISCAIS, mesmoValor, mesclar } from '../lib/pdvBackup/mergeProdutos.js';

const NOVO = { nome: 'Costela Bovina', preco_venda: 59.9, ncm: '02102000', ativo: true };

test('mesmoValor não confunde o texto do Postgres com o número do Firebird', () => {
  // numeric volta do supabase-js como string; o Firebird devolve número. Sem
  // isto, todo preço viraria conflito falso já na segunda rodada.
  assert.equal(mesmoValor('49.90', 49.9), true);
  assert.equal(mesmoValor(49.9, 49.9), true);
  assert.equal(mesmoValor('49.90', 59.9), false);
  assert.equal(mesmoValor(null, null), true);
  assert.equal(mesmoValor(null, 0), false);
  assert.equal(mesmoValor(' Costela ', 'Costela'), true);
});

test('linha nova grava tudo', () => {
  const r = mesclar({ novo: NOVO, atual: null, retrato: null, revisado: false });
  assert.deepEqual(r.valores, NOVO);
  assert.deepEqual(r.conflitos, []);
  assert.deepEqual(r.congelados, []);
});

test('campo intocado desde a última importação é atualizado', () => {
  const r = mesclar({
    novo: { ...NOVO, preco_venda: 59.9 },
    atual: { ...NOVO, preco_venda: '49.90' },
    retrato: { ...NOVO, preco_venda: 49.9 },
    revisado: false,
  });
  assert.equal(r.valores.preco_venda, 59.9);
  assert.deepEqual(r.conflitos, []);
});

test('campo que alguém editou à mão não é tocado e vira conflito', () => {
  const r = mesclar({
    novo: { ...NOVO, nome: 'Costela Bovina PROMO' },
    atual: { ...NOVO, nome: 'Costela bovina (nome arrumado)' },
    retrato: { ...NOVO, nome: 'Costela Bovina' },
    revisado: false,
  });
  assert.equal(r.valores.nome, undefined, 'não pode entrar no update');
  assert.deepEqual(r.conflitos, [{
    campo: 'nome',
    atual: 'Costela bovina (nome arrumado)',
    novo: 'Costela Bovina PROMO',
  }]);
});

test('sem retrato, campo existente é tratado como editado à mão', () => {
  // Linha que já existia antes de a importação nascer: não há retrato para
  // comparar, e o certo é não presumir que o PDV pode mandar nela.
  const r = mesclar({
    novo: NOVO,
    atual: { ...NOVO, nome: 'Digitado à mão' },
    retrato: null,
    revisado: false,
  });
  assert.equal(r.valores.nome, undefined);
  assert.equal(r.conflitos.length, 1);
});

test('campo fiscal de linha revisada é congelado mesmo batendo com o retrato', () => {
  const r = mesclar({
    novo: { ...NOVO, ncm: '16025000', preco_venda: 59.9 },
    atual: { ...NOVO, ncm: '02102000', preco_venda: 49.9 },
    retrato: { ...NOVO, ncm: '02102000', preco_venda: 49.9 },
    revisado: true,
  });
  assert.equal(r.valores.ncm, undefined, 'NCM conferido por gente não se mexe');
  assert.ok(r.congelados.includes('ncm'));
  assert.equal(r.valores.preco_venda, 59.9, 'preço não é campo fiscal e continua espelhado');
});

test('CAMPOS_FISCAIS é a lista que a spec fixou', () => {
  assert.deepEqual([...CAMPOS_FISCAIS].sort(), [
    'aliquota_transparencia', 'cest', 'fator_conversao_tributavel', 'grupo_tributario_id',
    'ncm', 'origem_mercadoria', 'sujeito_st', 'unidade_tributavel',
  ]);
});

test('campo sem mudança nenhuma não entra no update', () => {
  const r = mesclar({ novo: NOVO, atual: { ...NOVO }, retrato: { ...NOVO }, revisado: false });
  assert.deepEqual(r.valores, {});
  assert.deepEqual(r.conflitos, []);
});
