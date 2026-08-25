import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORIAS_FORNECEDOR, soDigitos, formularioDaNota, fornecedorParaGravar, mensagemAoCadastrar,
} from '../lib/fornecedores.js';
import { clienteParaGravar } from '../lib/clientes.js';

test('soDigitos: tira máscara, mantém só números', () => {
  assert.equal(soDigitos('12.345.678/0001-99'), '12345678000199');
  assert.equal(soDigitos(null), '');
  assert.equal(soDigitos(''), '');
});

test('formularioDaNota: preenche com o que a nota traz e completa o resto', () => {
  const form = formularioDaNota({
    nome: 'Frigorifico Exemplo LTDA', documento: '12345678000199',
    telefone: '1133334444', email: null, uf: 'SP',
  });
  assert.equal(form.nome, 'Frigorifico Exemplo LTDA');
  assert.equal(form.cnpj, '12345678000199');
  assert.equal(form.telefone, '1133334444');
  // Nulo do XML vira string vazia: input controlado com value={null} deixa de
  // ser controlado no meio do caminho e o campo para de responder.
  assert.equal(form.email, '');
  assert.equal(form.contato, '');
  // A NF-e não diz a categoria; "Outros" é o que não afirma nada de errado.
  assert.equal(form.categoria, 'Outros');
  assert.ok(CATEGORIAS_FORNECEDOR.includes(form.categoria));
});

test('formularioDaNota: emitente sem documento deixa o campo vazio para preencher à mão', () => {
  const form = formularioDaNota({ nome: 'Sitio do Zé', documento: '', telefone: null, email: null });
  assert.equal(form.cnpj, '');
  assert.equal(form.nome, 'Sitio do Zé');
});

test('formularioDaNota: sem sugestão nenhuma devolve formulário em branco', () => {
  const form = formularioDaNota(null);
  assert.deepEqual(form, {
    nome: '', nome_fantasia: '', cnpj: '', categoria: 'Outros', contato: '', telefone: '', email: '',
    logradouro: '', numero: '', complemento: '', bairro: '', codigo_municipio_ibge: '', municipio: '', uf: '', cep: '',
  });
});

test('fornecedorParaGravar: normaliza o CNPJ e manda em branco como null', () => {
  const gravar = fornecedorParaGravar({
    nome: '  Frigorifico Exemplo  ', cnpj: '12.345.678/0001-99',
    categoria: 'Carnes', contato: '', telefone: '', email: '',
  });
  assert.equal(gravar.cnpj, '12345678000199');
  assert.equal(gravar.nome, 'Frigorifico Exemplo');
  // Vazio precisa virar null: a coluna é opcional e string vazia não passa no
  // check "só dígitos" da atualização 23.
  assert.equal(gravar.telefone, null);
  assert.equal(gravar.email, null);
  assert.equal(gravar.contato, null);
});

test('fornecedorParaGravar: CPF de produtor rural cabe na coluna de documento', () => {
  const gravar = fornecedorParaGravar({ nome: 'Sitio do Zé', cnpj: '111.222.333-44', categoria: 'Outros' });
  assert.equal(gravar.cnpj, '11122233344');
});

test('fornecedorParaGravar: sem documento nenhum grava null, não string vazia', () => {
  assert.equal(fornecedorParaGravar({ nome: 'Sitio do Zé', cnpj: '' }).cnpj, null);
});

test('fornecedorParaGravar: sincroniza nome_fantasia com o cliente vinculado (branco vira null)', () => {
  const gravar = fornecedorParaGravar({ nome: 'Manar', nome_fantasia: '  Comercial São João  ', cnpj: '', categoria: 'Outros' });
  assert.equal(gravar.nome_fantasia, 'Comercial São João');
  assert.equal(fornecedorParaGravar({ nome: 'Manar', nome_fantasia: '', categoria: 'Outros' }).nome_fantasia, null);
});

test('fornecedorParaGravar: telefone vira só dígitos (mesma convenção do lado cliente, pro campo ficar idêntico quando vinculado)', () => {
  assert.equal(fornecedorParaGravar({ nome: 'X', telefone: '(11) 91234-5678', categoria: 'Outros' }).telefone, '11912345678');
});

test('fornecedorParaGravar: grava endereço normalizado (cep e IBGE só com dígitos, UF maiúscula)', () => {
  const gravar = fornecedorParaGravar({
    nome: 'Distribuidora XYZ', categoria: 'Embalagens',
    logradouro: 'Avenida Brasil', numero: '725', bairro: 'Nova Brasília',
    codigo_municipio_ibge: '1100122', municipio: 'Ji-Paraná', uf: 'ro', cep: '76908-408',
  });
  assert.equal(gravar.logradouro, 'Avenida Brasil');
  assert.equal(gravar.uf, 'RO');
  assert.equal(gravar.cep, '76908408');
  assert.equal(gravar.codigo_municipio_ibge, '1100122');
});

test('fornecedorParaGravar: endereço sai idêntico ao de clienteParaGravar pra mesma entrada (garante o vínculo não divergir)', () => {
  const form = {
    nome: 'Manar', categoria: 'Carnes', tipo_pessoa: 'J',
    logradouro: 'Rua X', numero: '10', complemento: '', bairro: 'Centro',
    codigo_municipio_ibge: '1100122', municipio: 'Ji-Paraná', uf: 'ro', cep: '76900-000',
  };
  const doFornecedor = fornecedorParaGravar(form);
  const doCliente = clienteParaGravar(form);
  for (const campo of ['logradouro', 'numero', 'complemento', 'bairro', 'codigo_municipio_ibge', 'municipio', 'uf', 'cep']) {
    assert.equal(doFornecedor[campo], doCliente[campo], `campo ${campo} divergiu entre cliente e fornecedor`);
  }
});

test('mensagemAoCadastrar: documento repetido vira instrução, não erro do Postgres', () => {
  const msg = mensagemAoCadastrar({ code: '23505', message: 'duplicate key value violates unique constraint "fornecedores_empresa_cnpj_idx"' });
  assert.match(msg, /já existe/i);
  assert.doesNotMatch(msg, /duplicate key/);
});

test('mensagemAoCadastrar: qualquer outro erro aparece como veio', () => {
  const msg = mensagemAoCadastrar({ code: '42501', message: 'new row violates row-level security policy' });
  assert.match(msg, /row-level security policy/);
});

test('ehDocumentoRepetido é o que decide o ramo da mensagem, e só pega 23505', () => {
  assert.match(mensagemAoCadastrar({ code: '23514', message: 'violates check constraint' }), /check constraint/);
});
