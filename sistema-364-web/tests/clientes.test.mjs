import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clienteParaGravar, recorteComercial } from '../lib/clientes.js';

test('clienteParaGravar: normaliza nome e reduz campos opcionais vazios a null', () => {
  const saida = clienteParaGravar({
    nome: '  Supermercado Manar  ', nome_fantasia: '', cnpj: '09.057.435/0001-47',
    tipo: 'Revenda', contato: '', telefone: '(69) 99841-4082',
    tipo_pessoa: 'J', cpf: '', ie: '', ind_ie_dest: '', consumidor_final: null,
    logradouro: '', numero: '', complemento: '', bairro: '',
    codigo_municipio_ibge: '', municipio: '', uf: '', cep: '', email_nfe: '',
  });
  assert.equal(saida.nome, 'Supermercado Manar');
  assert.equal(saida.nome_fantasia, null);
  assert.equal(saida.cnpj, '09057435000147');
  assert.equal(saida.contato, null);
  assert.equal(saida.telefone, '69998414082');
  assert.equal(saida.ind_ie_dest, null);
});

test('clienteParaGravar: converte ind_ie_dest para número quando preenchido', () => {
  const saida = clienteParaGravar({ nome: 'X', tipo_pessoa: 'J', ind_ie_dest: '1' });
  assert.equal(saida.ind_ie_dest, 1);
  assert.equal(typeof saida.ind_ie_dest, 'number');
});

test('clienteParaGravar: ind_ie_dest null continua null (não quebra o insert numa coluna smallint)', () => {
  assert.equal(clienteParaGravar({ nome: 'X', ind_ie_dest: null }).ind_ie_dest, null);
  assert.equal(clienteParaGravar({ nome: 'X', ind_ie_dest: undefined }).ind_ie_dest, null);
});

test('clienteParaGravar: mantém consumidor_final como veio (bool ou null)', () => {
  assert.equal(clienteParaGravar({ nome: 'X', consumidor_final: true }).consumidor_final, true);
  assert.equal(clienteParaGravar({ nome: 'X', consumidor_final: null }).consumidor_final, null);
});

test('clienteParaGravar: uf maiúscula só com letras, cep só com dígitos', () => {
  const saida = clienteParaGravar({ nome: 'X', uf: 'ro', cep: '76908-408' });
  assert.equal(saida.uf, 'RO');
  assert.equal(saida.cep, '76908408');
});

test('recorteComercial: mantém só os campos comerciais, sem o bloco fiscal', () => {
  const completo = clienteParaGravar({
    nome: 'X', nome_fantasia: 'Y', cnpj: '12345678000199', tipo: 'Revenda',
    contato: 'A', telefone: '69999999999', uf: 'RO', cep: '76900000', ie: '123',
  });
  const cortado = recorteComercial(completo);
  assert.deepEqual(Object.keys(cortado).sort(), ['cnpj', 'contato', 'nome', 'nome_fantasia', 'telefone', 'tipo'].sort());
  assert.equal(cortado.nome, 'X');
});
