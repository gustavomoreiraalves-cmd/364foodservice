import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATUS_EMBALAGEM, prefixoFichaEmbalagem, proximaFichaEmbalagem,
  saldoDefumado, validadeDoItem, itemEmbalagemValido,
} from '../lib/embalagem.js';
import { proximoNumeroFicha } from '../lib/format.js';

test('STATUS_EMBALAGEM: os três status da ficha', () => {
  assert.deepEqual(STATUS_EMBALAGEM, ['rascunho', 'finalizada', 'cancelada']);
});

test('proximoNumeroFicha: primeira do dia', () => {
  assert.equal(proximoNumeroFicha('EMB-260822-', []), 'EMB-260822-001');
});

test('proximoNumeroFicha: deriva do maior sufixo, não da contagem', () => {
  const fichas = [{ lote: 'EMB-260822-001' }, { lote: 'EMB-260822-003' }];
  assert.equal(proximoNumeroFicha('EMB-260822-', fichas), 'EMB-260822-004');
});

test('proximoNumeroFicha: ignora prefixo alheio e sufixo não numérico', () => {
  const fichas = [{ lote: 'DEF-260822-009' }, { lote: 'EMB-260822-00X' }, { lote: 'EMB-260822-002' }];
  assert.equal(proximoNumeroFicha('EMB-260822-', fichas), 'EMB-260822-003');
});

test('prefixoFichaEmbalagem: monta a partir da data', () => {
  assert.equal(prefixoFichaEmbalagem('2026-08-22'), 'EMB-260822-');
});

test('proximaFichaEmbalagem: junta prefixo e sufixo', () => {
  assert.equal(proximaFichaEmbalagem('2026-08-22', [{ lote: 'EMB-260822-001' }]), 'EMB-260822-002');
});

const defumados = [
  { recebimento_item_id: 'lote-a', peso_final_kg: 81, defumacoes: { status: 'finalizada' } },
  { recebimento_item_id: 'lote-a', peso_final_kg: 10, defumacoes: { status: 'rascunho' } },
  { recebimento_item_id: 'lote-b', peso_final_kg: 40, defumacoes: { status: 'finalizada' } },
];

test('saldoDefumado: só conta defumação finalizada', () => {
  assert.equal(saldoDefumado('lote-a', defumados, []), 81);
});

test('saldoDefumado: desconta o que já foi embalado daquele lote', () => {
  const embalados = [
    { recebimento_item_id: 'lote-a', peso_total_kg: 30, embalagens: { status: 'finalizada' } },
    { recebimento_item_id: 'lote-a', peso_total_kg: 6, embalagens: { status: 'rascunho' } },
  ];
  assert.equal(saldoDefumado('lote-a', defumados, embalados), 45);
});

test('saldoDefumado: ficha de embalagem cancelada devolve o peso ao lote', () => {
  const embalados = [
    { recebimento_item_id: 'lote-a', peso_total_kg: 30, embalagens: { status: 'cancelada' } },
  ];
  assert.equal(saldoDefumado('lote-a', defumados, embalados), 81);
});

test('saldoDefumado: nunca devolve negativo', () => {
  const embalados = [{ recebimento_item_id: 'lote-b', peso_total_kg: 90, embalagens: { status: 'finalizada' } }];
  assert.equal(saldoDefumado('lote-b', defumados, embalados), 0);
});

test('saldoDefumado: lote sem defumação nenhuma', () => {
  assert.equal(saldoDefumado('lote-z', defumados, []), 0);
});

test('saldoDefumado: item embalado sem o join de embalagens ainda desconta', () => {
  // Sem `embalagens.status` (join ausente, dado incompleto), o item NÃO pode
  // ser tratado como "não desconta" — devolveria ao saldo peso que já foi
  // embalado de verdade, e não há constraint de banco que impeça embalar de
  // novo em cima disso. Só 'cancelada' livra o peso do desconto.
  const embalados = [{ recebimento_item_id: 'lote-a', peso_total_kg: 30 }];
  assert.equal(saldoDefumado('lote-a', defumados, embalados), 51);
});

test('validadeDoItem: dias somam à data da embalagem', () => {
  const regra = { permitido: true, validade_valor: 120, validade_unidade: 'dias' };
  assert.equal(validadeDoItem('2026-08-22', regra), '2026-12-20');
});

test('validadeDoItem: horas arredondam para BAIXO, nunca para cima', () => {
  const regra48 = { permitido: true, validade_valor: 48, validade_unidade: 'horas' };
  assert.equal(validadeDoItem('2026-08-22', regra48), '2026-08-24');

  // 12 horas não pode virar "1 dia" de validade — arredondar para cima
  // daria mais prazo do que a regra permite. Math.floor(12/24) = 0, então a
  // validade fica na própria data da embalagem.
  const regra12 = { permitido: true, validade_valor: 12, validade_unidade: 'horas' };
  assert.equal(validadeDoItem('2026-08-22', regra12), '2026-08-22');
});

test('validadeDoItem: sem regra, sem validade', () => {
  assert.equal(validadeDoItem('2026-08-22', null), null);
  assert.equal(validadeDoItem('2026-08-22', { permitido: false, validade_valor: 30, validade_unidade: 'dias' }), null);
});

test('validadeDoItem: validade_valor zero também é sem validade', () => {
  const regra = { permitido: true, validade_valor: 0, validade_unidade: 'dias' };
  assert.equal(validadeDoItem('2026-08-22', regra), null);
});

test('validadeDoItem: data de embalagem inválida não vira "NaN-NaN-NaN"', () => {
  const regra = { permitido: true, validade_valor: 30, validade_unidade: 'dias' };
  assert.equal(validadeDoItem('', regra), null);
});

test('itemEmbalagemValido: quantidade precisa ser inteira e positiva', () => {
  assert.equal(itemEmbalagemValido({ quantidade: 0, peso_total_kg: 10 }).ok, false);
  assert.equal(itemEmbalagemValido({ quantidade: 2.5, peso_total_kg: 10 }).ok, false);
  assert.equal(itemEmbalagemValido({ quantidade: 50, peso_total_kg: 25 }).ok, true);
});

test('itemEmbalagemValido: mensagem do erro de quantidade fala em quantidade', () => {
  const r = itemEmbalagemValido({ quantidade: 2.5, peso_total_kg: 10 });
  assert.equal(r.ok, false);
  assert.match(r.erro, /quantidade/i);
});

test('itemEmbalagemValido: peso precisa ser positivo', () => {
  const r = itemEmbalagemValido({ quantidade: 50, peso_total_kg: 0 });
  assert.equal(r.ok, false);
  assert.match(r.erro, /peso/i);
});
