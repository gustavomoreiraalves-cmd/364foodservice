import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusInspecao, inspecaoAprovada } from '../lib/qualidade.js';

// lib/format.js só importa lib/supabase.js sob demanda, dentro das funções
// que batem no banco — não mais no topo do módulo. custoMedioMP é pura e
// nem chega a tocar nisso; as variáveis abaixo ficam por precaução.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'chave-anon-de-teste';
const { custoMedioMP } = await import('../lib/format.js');

const MP = 'mp-picanha';
const MPS = [{ id: MP, custo_unitario: 99 }];

// A relação vem do PostgREST como array (`inspecoes_qualidade(status)`).
const item = (status, quantidade, custo_unitario) => ({
  materia_prima_id: MP,
  quantidade,
  custo_unitario,
  inspecoes_qualidade: status ? [{ status }] : [],
});

test('custoMedioMP: lote rejeitado não entra no custo médio', () => {
  const recs = [
    item('aprovado', 10, 50),
    item('rejeitado', 10, 200),
  ];
  // Só o lote aprovado conta: 10 × 50 / 10 = 50. Com o rejeitado entrando
  // seria 125, distorcendo o custo do lote de produção e o CMV.
  assert.equal(custoMedioMP(MP, recs, MPS), 50);
});

test('custoMedioMP: aprovado com ressalva conta, igual ao saldo de estoque', () => {
  const recs = [
    item('aprovado', 10, 40),
    item('aprovado_com_ressalva', 10, 60),
  ];
  assert.equal(custoMedioMP(MP, recs, MPS), 50);
});

test('custoMedioMP: pendente, quarentena e devolvido também ficam de fora', () => {
  for (const status of ['pendente', 'quarentena', 'devolvido']) {
    const recs = [item('aprovado', 10, 50), item(status, 10, 200)];
    assert.equal(custoMedioMP(MP, recs, MPS), 50, `status ${status} não deveria contar`);
  }
});

test('custoMedioMP: item sem inspeção não conta (não gerou movimento de estoque)', () => {
  const recs = [item(null, 10, 200)];
  // Cai no fallback do custo padrão cadastrado na matéria-prima.
  assert.equal(custoMedioMP(MP, recs, MPS), 99);
});

test('custoMedioMP: sem nenhum recebimento aprovado usa o custo padrão da MP', () => {
  assert.equal(custoMedioMP(MP, [item('rejeitado', 10, 200)], MPS), 99);
  assert.equal(custoMedioMP(MP, [], MPS), 99);
  assert.equal(custoMedioMP(MP, [], []), 0);
});

test('custoMedioMP: ignora recebimentos de outra matéria-prima', () => {
  const recs = [
    item('aprovado', 10, 50),
    { materia_prima_id: 'mp-outra', quantidade: 10, custo_unitario: 500, inspecoes_qualidade: [{ status: 'aprovado' }] },
  ];
  assert.equal(custoMedioMP(MP, recs, MPS), 50);
});

test('custoMedioMP: pondera pela quantidade, não pela média simples', () => {
  const recs = [
    item('aprovado', 30, 10),
    item('aprovado', 10, 50),
  ];
  // (30×10 + 10×50) / 40 = 20; a média simples daria 30.
  assert.equal(custoMedioMP(MP, recs, MPS), 20);
});

test('statusInspecao: aceita as três formas em que a relação chega das queries', () => {
  // Relação crua do PostgREST, array ou objeto conforme a cardinalidade.
  assert.equal(statusInspecao({ inspecoes_qualidade: [{ status: 'rejeitado' }] }), 'rejeitado');
  assert.equal(statusInspecao({ inspecoes_qualidade: { status: 'aprovado' } }), 'aprovado');
  // Achatada pela tela de recebimentos.
  assert.equal(statusInspecao({ inspecao: { status: 'quarentena' } }), 'quarentena');
  // Já extraída pelos relatórios.
  assert.equal(statusInspecao({ status_qualidade: 'devolvido' }), 'devolvido');
  // Sem inspeção.
  assert.equal(statusInspecao({ inspecoes_qualidade: [] }), null);
  assert.equal(statusInspecao({}), null);
  assert.equal(statusInspecao(null), null);
});

test('inspecaoAprovada: só aprovado e aprovado_com_ressalva', () => {
  assert.equal(inspecaoAprovada({ status_qualidade: 'aprovado' }), true);
  assert.equal(inspecaoAprovada({ status_qualidade: 'aprovado_com_ressalva' }), true);
  for (const status of ['pendente', 'quarentena', 'rejeitado', 'devolvido']) {
    assert.equal(inspecaoAprovada({ status_qualidade: status }), false, status);
  }
  assert.equal(inspecaoAprovada({}), false);
});

test('custoMedioMP: também funciona com o formato achatado dos relatórios', () => {
  const recs = [
    { materia_prima_id: MP, quantidade: 10, custo_unitario: 50, status_qualidade: 'aprovado' },
    { materia_prima_id: MP, quantidade: 10, custo_unitario: 200, status_qualidade: 'rejeitado' },
  ];
  assert.equal(custoMedioMP(MP, recs, MPS), 50);
});
