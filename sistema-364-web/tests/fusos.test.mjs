import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FUSOS_BRASIL, FUSO_PADRAO, rotuloFuso } from '../lib/fusos.js';

const MIGRACAO = 'supabase/atualizacao_44_fuso_iana.sql';

test('todo valor da lista é aceito por Intl.DateTimeFormat', () => {
  // Este é o teste que faltava quando "MANAUS" entrou em produção: o valor só
  // é exercitado na hora de formatar uma data, longe do cadastro que o gravou.
  for (const [valor] of FUSOS_BRASIL) {
    assert.doesNotThrow(
      () => new Intl.DateTimeFormat('pt-BR', { timeZone: valor }).format(new Date(0)),
      `${valor} não é identificador IANA válido`,
    );
  }
});

test('nome de cidade sem o prefixo da região é rejeitado pelo Intl', () => {
  // Prova de que o defeito original não erra em silêncio: quebra alto.
  for (const ruim of ['MANAUS', 'Manaus', 'Porto Velho']) {
    assert.throws(() => new Intl.DateTimeFormat('pt-BR', { timeZone: ruim }), RangeError);
  }
});

test('o padrão está na lista', () => {
  assert.ok(FUSOS_BRASIL.some(([v]) => v === FUSO_PADRAO));
});

test('não há valor repetido', () => {
  const valores = FUSOS_BRASIL.map(([v]) => v);
  assert.equal(new Set(valores).size, valores.length);
});

test('a lista do formulário e a do CHECK no banco não podem divergir', () => {
  // Se uma crescer sem a outra, o cadastro oferece um fuso que o banco recusa
  // (ou o banco aceita um que o formulário nunca mostra).
  const sql = readFileSync(new URL(`../${MIGRACAO}`, import.meta.url), 'utf8');
  const listas = [...sql.matchAll(/fuso (?:not )?in \(([^)]*)\)/g)]
    .map(m => new Set(m[1].match(/America\/[A-Za-z_]+/g) || []));

  assert.ok(listas.length >= 2, 'a migração deveria conter as listas de fuso');
  const daLista = new Set(FUSOS_BRASIL.map(([v]) => v));
  for (const [i, doSql] of listas.entries()) {
    assert.deepEqual(
      [...doSql].sort(), [...daLista].sort(),
      `a lista ${i} da migração ${MIGRACAO} não bate com FUSOS_BRASIL`,
    );
  }
});

test('rotuloFuso devolve o valor cru quando não conhece, em vez de sumir', () => {
  assert.equal(rotuloFuso('America/Porto_Velho'), 'Porto Velho (UTC-4) — RO');
  assert.equal(rotuloFuso('MANAUS'), 'MANAUS');
  assert.equal(rotuloFuso(null), '—');
});
