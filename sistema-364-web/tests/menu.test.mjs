import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MENU, menuVisivel, itemAtivo, grupoDaRota } from '../lib/menu.js';

// O caminho do projeto tem espaços e acentos: fileURLToPath, nunca .pathname.
const RAIZ = fileURLToPath(new URL('..', import.meta.url));

const ids = menu => menu.map(e => e.id);
const todosItens = menu => menu.flatMap(e => (e.tipo === 'grupo' ? e.itens : [e]));

// lib/auth.js importa react e next/navigation; para o teste ficar hermético,
// lemos os ids do catálogo de permissões direto do texto do arquivo.
function idsDePermissao() {
  const src = fs.readFileSync(path.join(RAIZ, 'lib/auth.js'), 'utf8');
  const inicio = src.indexOf('export const MODULOS');
  const bloco = src.slice(inicio, src.indexOf('\n];', inicio));
  return [...bloco.matchAll(/\bid: '([^']+)'/g)].map(m => m[1]);
}

test('menuVisivel: usuário só com producoes vê o grupo Produção e o Dashboard', () => {
  const visivel = menuVisivel(['producoes'], false);
  assert.deepEqual(ids(visivel), ['dashboard', 'producao']);
  const labels = visivel.find(e => e.id === 'producao').itens.map(i => i.label);
  assert.deepEqual(labels, [
    'Visão Geral', 'Defumação', 'Produção Completa', 'Produção Interna',
    'Relatório de Validades', 'Histórico de Produção',
  ]);
  assert.ok(!labels.includes('Recebimento'));
  assert.ok(!labels.includes('Estoque'));
});

test('menuVisivel: sem a permissão pedidos, o grupo Vendas não aparece', () => {
  const visivel = menuVisivel(['clientes', 'produtos'], false);
  assert.ok(!ids(visivel).includes('vendas'));
  assert.ok(ids(visivel).includes('cadastros'));
});

test('menuVisivel: admin vê todos os grupos e todos os itens', () => {
  const visivel = menuVisivel([], true);
  assert.deepEqual(ids(visivel), ids(MENU));
  assert.equal(todosItens(visivel).length, todosItens(MENU).length);
});

test('menuVisivel: sem permissão nenhuma sobra só o Dashboard', () => {
  assert.deepEqual(ids(menuVisivel([], false)), ['dashboard']);
});

test('MENU: todo href tem uma page.js correspondente em app/', () => {
  for (const item of todosItens(MENU)) {
    const rota = item.href === '/' ? 'app/page.js' : `app${item.href}/page.js`;
    assert.ok(fs.existsSync(path.join(RAIZ, rota)), `rota inexistente para ${item.href}: ${rota}`);
  }
});

test('MENU: todo modulo citado existe em MODULOS', () => {
  // 'admin' é o módulo especial (lib/auth.js:7): não está em MODULOS, mas é válido.
  const validos = [...idsDePermissao(), 'admin'];
  assert.ok(validos.length > 0, 'não consegui ler os ids de MODULOS');
  for (const item of todosItens(MENU)) {
    if (!item.modulo) continue;
    assert.ok(validos.includes(item.modulo), `modulo desconhecido: ${item.modulo}`);
  }
});

test('menuVisivel: Empresas (CNPJ) só aparece para admin', () => {
  const semAdmin = todosItens(menuVisivel(['clientes'], false)).map(i => i.href);
  assert.ok(!semAdmin.includes('/empresas'));
  const comAdmin = todosItens(menuVisivel([], true)).map(i => i.href);
  assert.ok(comAdmin.includes('/empresas'));
});

test('itemAtivo: exato distingue /producoes de /producoes/completa', () => {
  const visaoGeral = { href: '/producoes', exato: true };
  const defumacao = { href: '/producoes/completa' };
  assert.equal(itemAtivo(visaoGeral, '/producoes'), true);
  assert.equal(itemAtivo(visaoGeral, '/producoes/completa'), false);
  assert.equal(itemAtivo(defumacao, '/producoes/completa'), true);
});

test('grupoDaRota: acha o grupo da rota atual e devolve null fora do menu', () => {
  assert.equal(grupoDaRota('/producoes/completa'), 'producao');
  assert.equal(grupoDaRota('/ponto/escalas'), 'rh');
  assert.equal(grupoDaRota('/materias-primas'), 'cadastros');
  assert.equal(grupoDaRota('/login'), null);
});
