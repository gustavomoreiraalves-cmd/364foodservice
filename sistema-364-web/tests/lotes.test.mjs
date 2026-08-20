import { test } from 'node:test';
import assert from 'node:assert/strict';

// lib/format.js importa lib/supabase.js, que chama createClient no topo do
// módulo e exige as variáveis de ambiente.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'chave-anon-de-teste';
const { proximosLotes, proximoLote } = await import('../lib/format.js');

// Cliente de fachada no formato do PostgREST: from().select().eq().like()
// devolve { data }. Registra cada tabela consultada para provar quantas
// idas ao banco a função faz.
function clienteFake({ recebimentos = [], producoes = [] } = {}) {
  const consultas = [];
  const porTabela = { recebimento_itens: recebimentos, producoes };
  return {
    consultas,
    from(tabela) {
      consultas.push(tabela);
      const encadeia = {
        select: () => encadeia,
        eq: () => encadeia,
        like: () => Promise.resolve({ data: porTabela[tabela] ?? [] }),
      };
      return encadeia;
    },
  };
}

const lotes = (n) => Array.from({ length: n }, (_, i) => ({ lote: `LT-260820-${String(i + 1).padStart(3, '0')}` }));

test('proximosLotes: gera a quantidade pedida, sequencial e sem repetir', async () => {
  const cliente = clienteFake();
  const resultado = await proximosLotes('2026-08-20', 'empresa-1', 3, cliente);
  assert.deepEqual(resultado, ['LT-260820-001', 'LT-260820-002', 'LT-260820-003']);
  assert.equal(new Set(resultado).size, 3);
});

test('proximosLotes: continua a partir do que já existe no dia', async () => {
  // 2 recebimentos + 1 produção já lançados hoje: o próximo é o 004.
  const cliente = clienteFake({ recebimentos: lotes(2), producoes: lotes(1) });
  const resultado = await proximosLotes('2026-08-20', 'empresa-1', 2, cliente);
  assert.deepEqual(resultado, ['LT-260820-004', 'LT-260820-005']);
});

test('proximosLotes: consulta o banco uma vez por tabela, não uma vez por item', async () => {
  // Este é o teste que separa a implementação certa do loop ingênuo sobre
  // proximoLote: contar N vezes lê o mesmo saldo N vezes e gera lote duplicado.
  const cliente = clienteFake();
  await proximosLotes('2026-08-20', 'empresa-1', 5, cliente);
  assert.deepEqual(cliente.consultas.sort(), ['producoes', 'recebimento_itens']);
});

test('proximosLotes: monta o prefixo LT-AAMMDD- a partir da data', async () => {
  const cliente = clienteFake();
  const [lote] = await proximosLotes('2027-01-09', 'empresa-1', 1, cliente);
  assert.equal(lote, 'LT-270109-001');
});

test('proximosLotes: quantidade zero ou negativa devolve lista vazia', async () => {
  const cliente = clienteFake();
  assert.deepEqual(await proximosLotes('2026-08-20', 'empresa-1', 0, cliente), []);
  assert.deepEqual(await proximosLotes('2026-08-20', 'empresa-1', -1, cliente), []);
});

test('proximosLotes: passa de 999 sem truncar o número', async () => {
  const cliente = clienteFake({ recebimentos: lotes(999) });
  const resultado = await proximosLotes('2026-08-20', 'empresa-1', 2, cliente);
  assert.deepEqual(resultado, ['LT-260820-1000', 'LT-260820-1001']);
});

test('proximoLote: continua entregando um único lote, igual ao primeiro do plural', async () => {
  const cliente = clienteFake({ recebimentos: lotes(4) });
  assert.equal(await proximoLote('2026-08-20', 'empresa-1', cliente), 'LT-260820-005');
});
