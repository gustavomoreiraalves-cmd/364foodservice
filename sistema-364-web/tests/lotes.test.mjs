import { test } from 'node:test';
import assert from 'node:assert/strict';

// lib/format.js importa lib/supabase.js, que chama createClient no topo do
// módulo e exige as variáveis de ambiente.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'chave-anon-de-teste';
const { proximosLotes, proximoLote, mensagemAoGravarItemRecebido } = await import('../lib/format.js');

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
  // 2 recebimentos (001, 002) + 1 produção (003) já lançados hoje, numa
  // sequência combinada sem sobreposição (o real: proximosLotes trata as
  // duas tabelas como uma sequência só) — o próximo é o 004.
  const cliente = clienteFake({
    recebimentos: [{ lote: 'LT-260820-001' }, { lote: 'LT-260820-002' }],
    producoes: [{ lote: 'LT-260820-003' }],
  });
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

// Excluir um item do meio do dia é fluxo normal (app/recebimentos/page.js,
// excluirItem) — e recebimento_itens.lote tem unique(empresa_id, lote)
// desde a atualização 28. Contar linhas geraria de novo o número que acabou
// de ser liberado pela exclusão, colidindo com a constraint; o maior sufixo
// não tem esse problema.
test('proximosLotes: buraco no meio da sequência usa o maior sufixo, não a contagem', async () => {
  const cliente = clienteFake({
    recebimentos: [{ lote: 'LT-260820-001' }, { lote: 'LT-260820-003' }],
  });
  const resultado = await proximosLotes('2026-08-20', 'empresa-1', 1, cliente);
  // Contagem (2 linhas) geraria "-003", que já existe. O maior sufixo (3) dá "-004".
  assert.deepEqual(resultado, ['LT-260820-004']);
});

test('proximosLotes: lista vazia começa em 001', async () => {
  const cliente = clienteFake();
  const resultado = await proximosLotes('2026-08-20', 'empresa-1', 1, cliente);
  assert.deepEqual(resultado, ['LT-260820-001']);
});

test('proximosLotes: sufixo não numérico (dado sujo) é ignorado no cálculo do maior', async () => {
  const cliente = clienteFake({
    recebimentos: [{ lote: 'LT-260820-001' }, { lote: 'LT-260820-XYZ' }],
  });
  const resultado = await proximosLotes('2026-08-20', 'empresa-1', 1, cliente);
  assert.deepEqual(resultado, ['LT-260820-002']);
});

test('proximosLotes: pedido de vários lotes continua a sequência a partir do buraco', async () => {
  const cliente = clienteFake({
    recebimentos: [{ lote: 'LT-260820-001' }, { lote: 'LT-260820-003' }],
  });
  const resultado = await proximosLotes('2026-08-20', 'empresa-1', 3, cliente);
  assert.deepEqual(resultado, ['LT-260820-004', 'LT-260820-005', 'LT-260820-006']);
});

test('proximoLote: continua entregando um único lote, igual ao primeiro do plural', async () => {
  const cliente = clienteFake({ recebimentos: lotes(4) });
  assert.equal(await proximoLote('2026-08-20', 'empresa-1', cliente), 'LT-260820-005');
});

// --- mensagem de erro ao gravar item de recebimento (atualização 28) ---

test('mensagemAoGravarItemRecebido: lote repetido vira instrução em português', () => {
  const msg = mensagemAoGravarItemRecebido(
    { code: '23505', message: 'duplicate key value violates unique constraint "recebimento_itens_empresa_lote_unico"' },
    '2 (Cupim)'
  );
  assert.match(msg, /número de lote gerado já está em uso/);
  assert.match(msg, /Nada foi salvo/);
  assert.match(msg, /o item 2 \(Cupim\)/);
});

test('mensagemAoGravarItemRecebido: o erro cru vai junto, para diagnóstico', () => {
  const cru = 'duplicate key value violates unique constraint "recebimento_itens_empresa_lote_unico"';
  const msg = mensagemAoGravarItemRecebido({ code: '23505', message: cru }, '1 (Costela)');
  assert.ok(msg.includes(cru), 'a mensagem original do Postgres precisa continuar visível');
});

test('mensagemAoGravarItemRecebido: reconhece a constraint mesmo sem o code', () => {
  // O PostgREST nem sempre devolve `code`; a citação do nome da constraint na
  // mensagem é a outra pista, e sozinha basta.
  const msg = mensagemAoGravarItemRecebido(
    { message: 'duplicate key value violates unique constraint "recebimento_itens_empresa_lote_unico"' },
    '1 (Costela)'
  );
  assert.match(msg, /número de lote gerado já está em uso/);
});

test('mensagemAoGravarItemRecebido: outro erro passa como veio', () => {
  const msg = mensagemAoGravarItemRecebido({ code: '23502', message: 'null value in column "quantidade"' }, '3 (Panceta)');
  assert.equal(msg, 'Erro ao salvar o item 3 (Panceta): null value in column "quantidade"');
});

test('mensagemAoGravarItemRecebido: sem descrição não escreve "o item undefined"', () => {
  const msg = mensagemAoGravarItemRecebido({ code: '23502', message: 'falhou' });
  assert.equal(msg, 'Erro ao salvar o item: falhou');
});
