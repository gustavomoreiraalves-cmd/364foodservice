import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enderecoParaGravar } from '../lib/endereco.js';

test('enderecoParaGravar: campos preenchidos saem aparados, cep e IBGE só com dígitos', () => {
  const saida = enderecoParaGravar({
    logradouro: '  Avenida Brasil  ', numero: '725', complemento: '', bairro: 'Nova Brasília',
    codigo_municipio_ibge: '1100122', municipio: 'Ji-Paraná', uf: 'ro', cep: '76908-408',
  });
  assert.equal(saida.logradouro, 'Avenida Brasil');
  assert.equal(saida.numero, '725');
  assert.equal(saida.complemento, null);
  assert.equal(saida.bairro, 'Nova Brasília');
  assert.equal(saida.codigo_municipio_ibge, '1100122');
  assert.equal(saida.municipio, 'Ji-Paraná');
  assert.equal(saida.uf, 'RO');
  assert.equal(saida.cep, '76908408');
});

test('enderecoParaGravar: tudo em branco vira null, não string vazia', () => {
  const saida = enderecoParaGravar({});
  assert.deepEqual(saida, {
    logradouro: null, numero: null, complemento: null, bairro: null,
    codigo_municipio_ibge: null, municipio: null, uf: null, cep: null,
  });
});

test('enderecoParaGravar: mesma entrada produz exatamente a mesma saída duas vezes (garantia de sincronismo)', () => {
  const form = { logradouro: 'Rua X', numero: '10', bairro: 'Centro', uf: 'sp', cep: '01311902', municipio: 'São Paulo', codigo_municipio_ibge: '3550308' };
  assert.deepEqual(enderecoParaGravar(form), enderecoParaGravar(form));
});
