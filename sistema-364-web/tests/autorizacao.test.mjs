import { test } from 'node:test';
import assert from 'node:assert/strict';
import { garantirEmpresa, garantirColaborador, garantirUnidade } from '../lib/autorizacao.js';

// As rotas de API usam a service role key, que passa por cima do RLS. Estes
// testes são a rede de proteção do escopo de empresa: se algum deles passar a
// aceitar um id de outra empresa, abriu-se um IDOR entre as marcas do grupo.

const EMPRESA_A = '11111111-1111-4111-8111-111111111111';
const EMPRESA_B = '22222222-2222-4222-8222-222222222222';
const COLAB_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COLAB_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const UNIDADE_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const UNIDADE_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const USER_A = { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' };

// Supabase de mentira: só o suficiente para .from().select().eq().maybeSingle().
function fakeSb(tabelas) {
  return {
    from(tabela) {
      const linhas = tabelas[tabela] || [];
      const filtros = [];
      const q = {
        select() { return q; },
        eq(coluna, valor) { filtros.push([coluna, valor]); return q; },
        maybeSingle() {
          const achado = linhas.find(l => filtros.every(([c, v]) => String(l[c]) === String(v)));
          return Promise.resolve({ data: achado || null, error: null });
        },
      };
      return q;
    },
  };
}

// Banco padrão: colaborador e unidade em cada empresa; USER_A só vê a empresa A.
function banco() {
  return fakeSb({
    usuario_empresas: [{ user_id: USER_A.id, empresa_id: EMPRESA_A }],
    colaboradores: [
      { id: COLAB_A, nome: 'Ana da Silva', empresa_id: EMPRESA_A, status: 'ativo' },
      { id: COLAB_B, nome: 'Bruno Souza', empresa_id: EMPRESA_B, status: 'ativo' },
    ],
    unidades: [
      { id: UNIDADE_A, nome: 'Matriz A', empresa_id: EMPRESA_A, fuso: 'America/Sao_Paulo' },
      { id: UNIDADE_B, nome: 'Matriz B', empresa_id: EMPRESA_B, fuso: 'America/Sao_Paulo' },
    ],
  });
}

async function erroDe(fn) {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  throw new assert.AssertionError({ message: 'esperava que lançasse, mas passou' });
}

// ---------- garantirEmpresa (veio de lib/nfe/autorizacao.js, agora compartilhada) ----------

test('garantirEmpresa: admin passa direto', async () => {
  assert.equal(await garantirEmpresa(banco(), USER_A, true, EMPRESA_B), true);
});

test('garantirEmpresa: usuário com vínculo passa', async () => {
  assert.equal(await garantirEmpresa(banco(), USER_A, false, EMPRESA_A), true);
});

test('garantirEmpresa: usuário sem vínculo é barrado', async () => {
  const e = await erroDe(() => garantirEmpresa(banco(), USER_A, false, EMPRESA_B));
  assert.match(e.message, /Sem acesso a esta empresa/);
  assert.equal(e.status, 403);
});

test('garantirEmpresa: id que não é UUID é barrado antes do banco', async () => {
  const e = await erroDe(() => garantirEmpresa(banco(), USER_A, true, '../../etc/passwd'));
  assert.match(e.message, /não é um UUID/);
});

test('garantirEmpresa: empresa ausente é barrada', async () => {
  const e = await erroDe(() => garantirEmpresa(banco(), USER_A, true, null));
  assert.match(e.message, /Informe a empresa/);
});

// ---------- garantirColaborador ----------

test('garantirColaborador: devolve o colaborador da própria empresa', async () => {
  const colab = await garantirColaborador(banco(), USER_A, false, COLAB_A);
  assert.equal(colab.id, COLAB_A);
  assert.equal(colab.nome, 'Ana da Silva');
});

test('garantirColaborador: admin alcança colaborador de qualquer empresa', async () => {
  const colab = await garantirColaborador(banco(), USER_A, true, COLAB_B);
  assert.equal(colab.id, COLAB_B);
});

// O IDOR: usuário do módulo `ponto` da marca A mexendo em colaborador da marca B.
test('garantirColaborador: colaborador de outra empresa é barrado', async () => {
  const e = await erroDe(() => garantirColaborador(banco(), USER_A, false, COLAB_B));
  assert.equal(e.status, 404);
});

// Mesma resposta para "não existe" e "existe mas não é seu": sem esse cuidado,
// a diferença de mensagem vira enumeração de colaboradores por UUID.
test('garantirColaborador: fora de escopo é indistinguível de inexistente', async () => {
  const foraDeEscopo = await erroDe(() => garantirColaborador(banco(), USER_A, false, COLAB_B));
  const inexistente = await erroDe(() =>
    garantirColaborador(banco(), USER_A, false, '99999999-9999-4999-8999-999999999999'));
  assert.equal(foraDeEscopo.message, inexistente.message);
  assert.equal(foraDeEscopo.status, inexistente.status);
});

test('garantirColaborador: id que não é UUID é barrado antes do banco', async () => {
  const e = await erroDe(() => garantirColaborador(banco(), USER_A, true, 'nao-e-uuid'));
  assert.match(e.message, /não é um UUID/);
});

test('garantirColaborador: id ausente é barrado', async () => {
  const e = await erroDe(() => garantirColaborador(banco(), USER_A, true, undefined));
  assert.match(e.message, /Informe o colaborador/);
});

test('garantirColaborador: traz as colunas pedidas e sempre empresa_id', async () => {
  const colab = await garantirColaborador(banco(), USER_A, false, COLAB_A, 'id, nome, status');
  assert.equal(colab.status, 'ativo');
  assert.equal(colab.empresa_id, EMPRESA_A);
});

// ---------- garantirUnidade ----------

test('garantirUnidade: devolve a unidade da própria empresa', async () => {
  const unidade = await garantirUnidade(banco(), USER_A, false, UNIDADE_A);
  assert.equal(unidade.id, UNIDADE_A);
  assert.equal(unidade.fuso, 'America/Sao_Paulo');
});

test('garantirUnidade: unidade de outra empresa é barrada', async () => {
  const e = await erroDe(() => garantirUnidade(banco(), USER_A, false, UNIDADE_B));
  assert.equal(e.status, 404);
});

test('garantirUnidade: admin alcança unidade de qualquer empresa', async () => {
  const unidade = await garantirUnidade(banco(), USER_A, true, UNIDADE_B);
  assert.equal(unidade.id, UNIDADE_B);
});

test('garantirUnidade: id que não é UUID é barrado antes do banco', async () => {
  const e = await erroDe(() => garantirUnidade(banco(), USER_A, true, 'nao-e-uuid'));
  assert.match(e.message, /não é um UUID/);
});
