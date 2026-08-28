import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampLargura, larguraMaximaPadrao, chaveLargura, chaveVisiveis, chaveTamanhoPagina,
  colunaVisivel, alternarColuna, alternarOrdenacao, ordenarRegistros, paginar,
} from '../lib/listaCadastro.js';

test('clampLargura mantém dentro do intervalo e corta nas pontas', () => {
  assert.equal(clampLargura(100, 40, 200), 100);
  assert.equal(clampLargura(10, 40, 200), 40);
  assert.equal(clampLargura(500, 40, 200), 200);
});

test('larguraMaximaPadrao é o triplo da largura, com teto de 400', () => {
  assert.equal(larguraMaximaPadrao(60), 180);
  assert.equal(larguraMaximaPadrao(200), 400);
});

test('chaves de localStorage são namespaced pela tela', () => {
  assert.equal(chaveLargura('produtos'), 'produtos:colunas:largura');
  assert.equal(chaveVisiveis('clientes'), 'clientes:colunas:visiveis');
  assert.equal(chaveTamanhoPagina('produtos'), 'produtos:paginacao:tamanho');
});

test('colunaVisivel: coluna não-escondível é sempre visível', () => {
  const colunas = [{ id: 'nome', escondivel: false }];
  assert.equal(colunaVisivel(colunas, { nome: false }, 'nome'), true);
});

test('colunaVisivel: coluna escondível é visível por padrão até ser desmarcada', () => {
  const colunas = [{ id: 'ncm', escondivel: true }];
  assert.equal(colunaVisivel(colunas, {}, 'ncm'), true);
  assert.equal(colunaVisivel(colunas, { ncm: false }, 'ncm'), false);
  assert.equal(colunaVisivel(colunas, { ncm: true }, 'ncm'), true);
});

test('alternarColuna liga/desliga a partir do estado atual', () => {
  const v1 = alternarColuna({}, 'ncm');
  assert.equal(v1.ncm, false);
  const v2 = alternarColuna(v1, 'ncm');
  assert.equal(v2.ncm, true);
});

test('alternarOrdenacao: primeiro clique ordena crescente', () => {
  assert.deepEqual(alternarOrdenacao({ campo: null, direcao: 'asc' }, 'nome'), { campo: 'nome', direcao: 'asc' });
});

test('alternarOrdenacao: clicar de novo na mesma coluna inverte', () => {
  assert.deepEqual(alternarOrdenacao({ campo: 'nome', direcao: 'asc' }, 'nome'), { campo: 'nome', direcao: 'desc' });
  assert.deepEqual(alternarOrdenacao({ campo: 'nome', direcao: 'desc' }, 'nome'), { campo: 'nome', direcao: 'asc' });
});

test('alternarOrdenacao: clicar em coluna diferente reseta para crescente', () => {
  assert.deepEqual(alternarOrdenacao({ campo: 'nome', direcao: 'desc' }, 'custo'), { campo: 'custo', direcao: 'asc' });
});

test('ordenarRegistros ordena string com localeCompare pt-BR', () => {
  const colunas = [{ id: 'nome', valor: r => r.nome }];
  const registros = [{ nome: 'Éclair' }, { nome: 'Bolo' }, { nome: 'Água' }];
  const asc = ordenarRegistros(registros, colunas, { campo: 'nome', direcao: 'asc' });
  assert.deepEqual(asc.map(r => r.nome), ['Água', 'Bolo', 'Éclair']);
  const desc = ordenarRegistros(registros, colunas, { campo: 'nome', direcao: 'desc' });
  assert.deepEqual(desc.map(r => r.nome), ['Éclair', 'Bolo', 'Água']);
});

test('ordenarRegistros ordena número corretamente (não como string)', () => {
  const colunas = [{ id: 'custo', valor: r => r.custo }];
  const registros = [{ custo: 9 }, { custo: 100 }, { custo: 20 }];
  const asc = ordenarRegistros(registros, colunas, { campo: 'custo', direcao: 'asc' });
  assert.deepEqual(asc.map(r => r.custo), [9, 20, 100]);
});

test('ordenarRegistros sem campo escolhido devolve a lista como veio', () => {
  const colunas = [{ id: 'nome', valor: r => r.nome }];
  const registros = [{ nome: 'B' }, { nome: 'A' }];
  const resultado = ordenarRegistros(registros, colunas, { campo: null, direcao: 'asc' });
  assert.deepEqual(resultado, registros);
});

test('ordenarRegistros em coluna sem valor() devolve a lista como veio', () => {
  const colunas = [{ id: 'fiscal' }];
  const registros = [{ fiscal: true }, { fiscal: false }];
  const resultado = ordenarRegistros(registros, colunas, { campo: 'fiscal', direcao: 'asc' });
  assert.deepEqual(resultado, registros);
});

test('paginar fatia a página certa e calcula o intervalo mostrado', () => {
  const registros = Array.from({ length: 55 }, (_, i) => ({ id: i + 1 }));
  const p1 = paginar(registros, 1, 25);
  assert.equal(p1.linhas.length, 25);
  assert.equal(p1.linhas[0].id, 1);
  assert.equal(p1.totalPaginas, 3);
  assert.equal(p1.inicio, 1);
  assert.equal(p1.fim, 25);

  const p3 = paginar(registros, 3, 25);
  assert.equal(p3.linhas.length, 5);
  assert.equal(p3.paginaAtual, 3);
  assert.equal(p3.inicio, 51);
  assert.equal(p3.fim, 55);
});

test('paginar com tamanhoPagina 0 (Todos) devolve tudo numa página só', () => {
  const registros = Array.from({ length: 55 }, (_, i) => ({ id: i + 1 }));
  const resultado = paginar(registros, 1, 0);
  assert.equal(resultado.linhas.length, 55);
  assert.equal(resultado.totalPaginas, 1);
  assert.equal(resultado.inicio, 1);
  assert.equal(resultado.fim, 55);
});

test('paginar com lista vazia não quebra e mostra intervalo 0', () => {
  const resultado = paginar([], 1, 25);
  assert.equal(resultado.linhas.length, 0);
  assert.equal(resultado.totalPaginas, 1);
  assert.equal(resultado.inicio, 0);
  assert.equal(resultado.fim, 0);
});

test('paginar corrige página fora do intervalo (ex.: filtro reduziu o total)', () => {
  const registros = Array.from({ length: 10 }, (_, i) => ({ id: i + 1 }));
  const resultado = paginar(registros, 9, 25);
  assert.equal(resultado.paginaAtual, 1);
  assert.equal(resultado.totalPaginas, 1);
});
