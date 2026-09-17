import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'chave-anon-de-teste';
const { agruparPorCategoria } = await import('../lib/financeiro.js');

test('soma quantidade*custo_unitario por categoria', () => {
  const itens = [
    { categoria_conta: 'Custos Variáveis', quantidade: 10, custo_unitario: 5 },
    { categoria_conta: 'Custos Variáveis', quantidade: 2, custo_unitario: 3 },
    { categoria_conta: 'Custos Fixos', quantidade: 1, custo_unitario: 120 },
  ];
  assert.deepEqual(agruparPorCategoria(itens), {
    'Custos Variáveis': 56,
    'Custos Fixos': 120,
  });
});

test('ignora itens sem categoria_conta e trata strings numéricas', () => {
  const itens = [
    { categoria_conta: null, quantidade: 10, custo_unitario: 5 },
    { categoria_conta: 'Investimentos', quantidade: '2', custo_unitario: '99.9' },
  ];
  assert.deepEqual(agruparPorCategoria(itens), { Investimentos: 199.8 });
});

test('lista vazia retorna objeto vazio', () => {
  assert.deepEqual(agruparPorCategoria([]), {});
});
