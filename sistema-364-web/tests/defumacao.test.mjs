import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATUS_DEFUMACAO, rendimento, condicaoRendimento,
  saldoLote, pesosValidos, proximaFicha, rendimentoDaFicha,
} from '../lib/defumacao.js';

test('STATUS_DEFUMACAO: os três status da ficha', () => {
  assert.deepEqual(STATUS_DEFUMACAO, ['rascunho', 'finalizada', 'cancelada']);
});

test('rendimento: defumado sobre bruto', () => {
  assert.equal(rendimento(100, 45), 0.45);
});

test('rendimento: numeric do Postgres chega como string', () => {
  assert.equal(rendimento('180.0000', '81.0000'), 0.45);
});

test('rendimento: sem bruto não há conta', () => {
  assert.equal(rendimento(0, 10), null);
  assert.equal(rendimento(null, 10), null);
  assert.equal(rendimento(100, null), null);
});

test('condicaoRendimento: abaixo de 40% é alerta', () => {
  assert.equal(condicaoRendimento(0.39).id, 'baixo');
});

test('condicaoRendimento: exatamente 40% não é alerta', () => {
  assert.equal(condicaoRendimento(0.40).id, 'normal');
});

test('condicaoRendimento: sem dado', () => {
  assert.equal(condicaoRendimento(null).id, 'sem_dado');
});

test('saldoLote: recebido menos o que já foi defumado', () => {
  const item = { id: 'a', quantidade: 180 };
  const jaDefumados = [
    { recebimento_item_id: 'a', peso_bruto_kg: 50 },
    { recebimento_item_id: 'a', peso_bruto_kg: 30 },
    { recebimento_item_id: 'b', peso_bruto_kg: 90 },
  ];
  assert.equal(saldoLote(item, jaDefumados), 100);
});

test('saldoLote: lote intocado devolve o recebido inteiro', () => {
  assert.equal(saldoLote({ id: 'a', quantidade: '180.0000' }, []), 180);
});

test('saldoLote: nunca devolve negativo', () => {
  const item = { id: 'a', quantidade: 10 };
  assert.equal(saldoLote(item, [{ recebimento_item_id: 'a', peso_bruto_kg: 25 }]), 0);
});

test('pesosValidos: peso defumado maior que o bruto é erro', () => {
  const r = pesosValidos({ peso_bruto_kg: 100, peso_final_kg: 120 });
  assert.equal(r.ok, false);
  assert.match(r.erro, /bruto/i);
});

test('pesosValidos: perda mais sobra não pode passar do bruto', () => {
  const r = pesosValidos({ peso_bruto_kg: 100, perda_limpeza_kg: 70, sobra_kg: 40, peso_final_kg: 10 });
  assert.equal(r.ok, false);
});

test('pesosValidos: peso bruto é obrigatório e positivo', () => {
  assert.equal(pesosValidos({ peso_bruto_kg: 0, peso_final_kg: 0 }).ok, false);
  assert.equal(pesosValidos({ peso_final_kg: 10 }).ok, false);
});

test('pesosValidos: valor negativo é erro', () => {
  assert.equal(pesosValidos({ peso_bruto_kg: 100, perda_limpeza_kg: -1, peso_final_kg: 40 }).ok, false);
});

test('pesosValidos: ficha completa e coerente passa', () => {
  const r = pesosValidos({ peso_bruto_kg: 180, perda_limpeza_kg: 20, sobra_kg: 5, peso_final_kg: 81 });
  assert.equal(r.ok, true);
});

test('pesosValidos: peso defumado ainda não informado passa (rascunho)', () => {
  assert.equal(pesosValidos({ peso_bruto_kg: 180 }).ok, true);
});

test('rendimentoDaFicha: nenhum item pesado ainda é sem dado, não zero', () => {
  const itens = [{ peso_bruto_kg: 180, peso_final_kg: null }, { peso_bruto_kg: 50, peso_final_kg: '' }];
  assert.equal(rendimentoDaFicha(itens), null);
});

test('rendimentoDaFicha: lista vazia é sem dado', () => {
  assert.equal(rendimentoDaFicha([]), null);
});

test('rendimentoDaFicha: só entram os itens já pesados, bruto pareado com o final', () => {
  const itens = [
    { peso_bruto_kg: 100, peso_final_kg: 45 },  // pesado
    { peso_bruto_kg: 80, peso_final_kg: null }, // ainda não pesado — fica de fora dos dois lados
  ];
  assert.equal(rendimentoDaFicha(itens), 0.45);
});

test('rendimentoDaFicha: ficha inteira pesada soma bruto e final de todos os itens', () => {
  const itens = [
    { peso_bruto_kg: 100, peso_final_kg: 45 },
    { peso_bruto_kg: 80, peso_final_kg: 40 },
  ];
  assert.equal(rendimentoDaFicha(itens), 85 / 180);
});

test('proximaFicha: primeira ficha do dia', () => {
  assert.equal(proximaFicha('2026-08-22', []), 'DEF-260822-001');
});

test('proximaFicha: continua do maior sufixo, não da contagem', () => {
  const existentes = [{ lote: 'DEF-260822-001' }, { lote: 'DEF-260822-003' }];
  assert.equal(proximaFicha('2026-08-22', existentes), 'DEF-260822-004');
});

test('proximaFicha: ignora ficha de outro dia e sufixo não numérico', () => {
  const existentes = [{ lote: 'DEF-260821-009' }, { lote: 'DEF-260822-00X' }, { lote: 'DEF-260822-002' }];
  assert.equal(proximaFicha('2026-08-22', existentes), 'DEF-260822-003');
});
