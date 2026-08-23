process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'chave-anon-de-teste';

import { test } from 'node:test';
import assert from 'node:assert/strict';
const { camposDoFormulario, mensagemAoAlternarAtivo, linhaParaInserir } = await import('../lib/cadastro.js');

const FORM_VAZIO = { nome: '', categoria: 'Carnes', validade_dias: 90, producao_interna: false };

test('camposDoFormulario: copia os campos que o formulário conhece', () => {
  const r = camposDoFormulario(
    { id: 'x', nome: 'Picanha', categoria: 'Bovinos', validade_dias: 30, producao_interna: true },
    FORM_VAZIO,
  );
  assert.deepEqual(r, { nome: 'Picanha', categoria: 'Bovinos', validade_dias: 30, producao_interna: true });
});

test('camposDoFormulario: ignora coluna que não está no formulário', () => {
  const r = camposDoFormulario({ nome: 'Picanha', empresa_id: 'e1', created_at: 'ontem' }, FORM_VAZIO);
  assert.deepEqual(Object.keys(r).sort(), ['categoria', 'nome', 'producao_interna', 'validade_dias']);
});

test('camposDoFormulario: null vira o padrão do formulário, não string vazia', () => {
  const r = camposDoFormulario({ nome: 'X', categoria: null, validade_dias: null }, FORM_VAZIO);
  assert.equal(r.categoria, 'Carnes');
  assert.equal(r.validade_dias, 90);
});

test('camposDoFormulario: chave ausente no registro cai no padrão', () => {
  assert.equal(camposDoFormulario({ nome: 'X' }, FORM_VAZIO).categoria, 'Carnes');
});

test('camposDoFormulario: false e 0 são preservados, não confundidos com vazio', () => {
  const r = camposDoFormulario({ nome: '', categoria: '', validade_dias: 0, producao_interna: false }, FORM_VAZIO);
  assert.equal(r.validade_dias, 0);
  assert.equal(r.producao_interna, false);
  assert.equal(r.categoria, '');
  assert.equal(r.nome, '');
});

test('camposDoFormulario: registro nulo devolve o formulário vazio', () => {
  assert.deepEqual(camposDoFormulario(null, FORM_VAZIO), FORM_VAZIO);
});

// A frase da migração 26 é o único ponto onde o estado pré-migração fica visível
// para o operador, e o texto original tem que sobreviver ao ramo que a dispara —
// a detecção é larga de propósito e um falso positivo não pode levar embora a
// pista do que realmente aconteceu.
test('mensagemAoAlternarAtivo: PGRST204 aponta a atualização 26 e mantém o erro cru', () => {
  const r = mensagemAoAlternarAtivo({
    code: 'PGRST204',
    message: "Could not find the 'ativo' column of 'clientes' in the schema cache",
  });
  assert.match(r, /atualização 26/);
  assert.match(r, /administrador/);
  assert.ok(r.includes("Could not find the 'ativo' column of 'clientes' in the schema cache"));
});

test('mensagemAoAlternarAtivo: 42703 cai no mesmo ramo', () => {
  const r = mensagemAoAlternarAtivo({ code: '42703', message: 'column "ativo" does not exist' });
  assert.match(r, /atualização 26/);
  assert.ok(r.includes('column "ativo" does not exist'));
});

test('mensagemAoAlternarAtivo: sem código, a mensagem citando ativo já basta', () => {
  const r = mensagemAoAlternarAtivo({ message: "Could not find the 'ativo' column" });
  assert.match(r, /atualização 26/);
});

test('mensagemAoAlternarAtivo: erro qualquer preserva o texto original e não fala em migração', () => {
  const r = mensagemAoAlternarAtivo({ code: '42501', message: 'permission denied for table clientes' });
  assert.ok(r.includes('permission denied for table clientes'));
  assert.doesNotMatch(r, /atualização 26/);
});

test('mensagemAoAlternarAtivo: erro sem message não vira "undefined" na tela', () => {
  assert.equal(mensagemAoAlternarAtivo({}), 'Não foi possível mudar a situação: ');
  assert.doesNotMatch(mensagemAoAlternarAtivo({}), /undefined/);
  const semTexto = mensagemAoAlternarAtivo({ code: 'PGRST204' });
  assert.match(semTexto, /atualização 26/);
  assert.doesNotMatch(semTexto, /Erro original/);
});

// Regressão: com empresaId === undefined, `{ ...dados, empresa_id: undefined }`
// ainda manda a chave `empresa_id` para o PostgREST (que monta `?columns=` a
// partir de Object.keys antes do JSON.stringify) — e tabelas sem essa coluna
// (ex.: empregadores) recusam o insert. `linhaParaInserir` é o que a tela
// Empresas usa para evitar isso.
test('linhaParaInserir: empresaId undefined não inclui a chave empresa_id', () => {
  const r = linhaParaInserir({ razao_social: 'Steak 364 Ltda' }, undefined);
  assert.deepEqual(Object.keys(r).sort(), ['razao_social']);
  assert.equal('empresa_id' in r, false);
});

test('linhaParaInserir: empresaId definido inclui empresa_id no objeto', () => {
  const r = linhaParaInserir({ nome: 'Cliente X' }, 'e1');
  assert.deepEqual(r, { nome: 'Cliente X', empresa_id: 'e1' });
});

test('linhaParaInserir: empresaId null é gravado como null (não confundido com undefined)', () => {
  const r = linhaParaInserir({ nome: 'Cliente X' }, null);
  assert.equal(r.empresa_id, null);
  assert.equal('empresa_id' in r, true);
});
