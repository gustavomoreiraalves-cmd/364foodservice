import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORIAS_FORNECEDOR, soDigitos, formularioDaNota, fornecedorParaGravar, mensagemAoCadastrar,
} from '../lib/fornecedores.js';

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
  assert.deepEqual(form, { nome: '', cnpj: '', categoria: 'Outros', contato: '', telefone: '', email: '' });
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
