import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarListaParceiros, salvarParceiro, excluirParceiro, alternarAtivoParceiro } from '../lib/parceiro.js';

// Dublê mínimo de supabase-js pra estas três funções: cobre só
// insert/update/delete/select/eq/single, que é tudo que salvarParceiro usa.
// `banco` é { clientes: [...], fornecedores: [...] } — mutado em memória.
function criarSb(banco, { falharAoExcluir = new Set(), falharAoInserir = new Set() } = {}) {
  let proximoId = 1;
  function builder(tabela) {
    const estado = {};
    const chain = {
      insert: linhas => { estado.op = 'insert'; estado.linhas = linhas; return chain; },
      update: valores => { estado.op = 'update'; estado.valores = valores; return chain; },
      delete: () => { estado.op = 'delete'; return chain; },
      eq: (campo, valor) => { estado.eqCampo = campo; estado.eqValor = valor; return chain; },
      select: () => chain,
      single: () => executar(),
      then: (resolve, reject) => executar().then(resolve, reject),
    };
    async function executar() {
      const linhas = banco[tabela];
      if (estado.op === 'insert') {
        if (falharAoInserir.has(tabela)) {
          return { data: null, error: { message: `duplicate key value violates unique constraint "${tabela}_empresa_cnpj_idx"`, code: '23505' } };
        }
        const linha = { id: `novo-${proximoId++}`, ...estado.linhas[0] };
        linhas.push(linha);
        return { data: linha, error: null };
      }
      if (estado.op === 'update') {
        const alvo = linhas.find(l => l[estado.eqCampo] === estado.eqValor);
        if (alvo) Object.assign(alvo, estado.valores);
        return { data: alvo || null, error: null };
      }
      if (estado.op === 'delete') {
        if (falharAoExcluir.has(estado.eqValor)) {
          return { data: null, error: { message: 'update or delete on table violates foreign key constraint' } };
        }
        const i = linhas.findIndex(l => l[estado.eqCampo] === estado.eqValor);
        if (i >= 0) linhas.splice(i, 1);
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }
    return chain;
  }
  return { from: builder };
}

const CLIENTE_SOLTO = { id: 'c1', nome: 'Açougue Central', nome_fantasia: null, cnpj: '111', contato: 'A', telefone: '1', tipo: 'Revenda', municipio: 'Ji-Paraná', uf: 'RO', ativo: true, fornecedor_vinculado_id: null };
const FORNECEDOR_SOLTO = { id: 'f1', nome: 'Distribuidora XYZ', nome_fantasia: null, cnpj: '222', contato: 'B', telefone: '2', categoria: 'Embalagens', email: 'xyz@ex.com', ativo: true, cliente_vinculado_id: null };

test('montarListaParceiros: cliente sem vínculo vira uma linha com papel só cliente', () => {
  const lista = montarListaParceiros([CLIENTE_SOLTO], []);
  assert.equal(lista.length, 1);
  assert.deepEqual(lista[0].papeis, ['cliente']);
  assert.equal(lista[0].id, 'c:c1');
  assert.equal(lista[0].clienteId, 'c1');
  assert.equal(lista[0].fornecedorId, null);
  assert.equal(lista[0].nome, 'Açougue Central');
  assert.equal(lista[0].categoria, '');
});

test('montarListaParceiros: fornecedor sem vínculo vira uma linha com papel só fornecedor', () => {
  const lista = montarListaParceiros([], [FORNECEDOR_SOLTO]);
  assert.equal(lista.length, 1);
  assert.deepEqual(lista[0].papeis, ['fornecedor']);
  assert.equal(lista[0].id, 'f:f1');
  assert.equal(lista[0].clienteId, null);
  assert.equal(lista[0].fornecedorId, 'f1');
  assert.equal(lista[0].categoria, 'Embalagens');
  assert.equal(lista[0].tipo, '');
});

test('montarListaParceiros: par vinculado vira uma linha só, com os dois papéis', () => {
  const cliente = { ...CLIENTE_SOLTO, id: 'c2', nome: 'Manar', fornecedor_vinculado_id: 'f2' };
  const fornecedor = { ...FORNECEDOR_SOLTO, id: 'f2', nome: 'Manar', cliente_vinculado_id: 'c2' };
  const lista = montarListaParceiros([cliente], [fornecedor]);
  assert.equal(lista.length, 1);
  assert.deepEqual(lista[0].papeis, ['cliente', 'fornecedor']);
  assert.equal(lista[0].id, 'c:c2+f:f2');
  assert.equal(lista[0].clienteId, 'c2');
  assert.equal(lista[0].fornecedorId, 'f2');
  assert.equal(lista[0].nome, 'Manar');
  assert.equal(lista[0].categoria, 'Embalagens'); // veio do lado fornecedor
  assert.equal(lista[0].tipo, 'Revenda'); // veio do lado cliente
});

test('montarListaParceiros: vínculo quebrado (aponta pra id que não existe na lista) trata como solto', () => {
  const cliente = { ...CLIENTE_SOLTO, id: 'c3', fornecedor_vinculado_id: 'nao-existe' };
  const lista = montarListaParceiros([cliente], []);
  assert.equal(lista.length, 1);
  assert.deepEqual(lista[0].papeis, ['cliente']);
});

test('montarListaParceiros: ativo é true só se os dois lados vinculados estiverem ativos', () => {
  const cliente = { ...CLIENTE_SOLTO, id: 'c4', fornecedor_vinculado_id: 'f4', ativo: true };
  const fornecedor = { ...FORNECEDOR_SOLTO, id: 'f4', cliente_vinculado_id: 'c4', ativo: false };
  const lista = montarListaParceiros([cliente], [fornecedor]);
  assert.equal(lista[0].ativo, false);
});

test('montarListaParceiros: ordena por nome (pt-BR, ignora maiúscula/acento)', () => {
  const lista = montarListaParceiros(
    [{ ...CLIENTE_SOLTO, id: 'c5', nome: 'Zebra' }, { ...CLIENTE_SOLTO, id: 'c6', nome: 'Água' }],
    [],
  );
  assert.deepEqual(lista.map(p => p.nome), ['Água', 'Zebra']);
});

test('montarListaParceiros: listas vazias não quebram', () => {
  assert.deepEqual(montarListaParceiros([], []), []);
  assert.deepEqual(montarListaParceiros(null, undefined), []);
});

test('salvarParceiro: cria só cliente quando só o papel cliente está marcado', async () => {
  const banco = { clientes: [], fornecedores: [] };
  const sb = criarSb(banco);
  const { error } = await salvarParceiro(sb, {
    form: { nome: 'Açougue Central', cnpj: '111', tipo: 'Revenda', tipo_pessoa: 'J' },
    papeis: ['cliente'], clienteExistente: null, fornecedorExistente: null, empresaId: 'e1', fiscalDisponivel: true,
  });
  assert.equal(error, null);
  assert.equal(banco.clientes.length, 1);
  assert.equal(banco.fornecedores.length, 0);
  assert.equal(banco.clientes[0].nome, 'Açougue Central');
  assert.equal(banco.clientes[0].fornecedor_vinculado_id, null);
});

test('salvarParceiro: cria os dois lados vinculados quando os dois papéis estão marcados', async () => {
  const banco = { clientes: [], fornecedores: [] };
  const sb = criarSb(banco);
  const { error } = await salvarParceiro(sb, {
    form: { nome: 'Manar', cnpj: '222', tipo: 'Revenda', tipo_pessoa: 'J', categoria: 'Carnes' },
    papeis: ['cliente', 'fornecedor'], clienteExistente: null, fornecedorExistente: null, empresaId: 'e1', fiscalDisponivel: true,
  });
  assert.equal(error, null);
  assert.equal(banco.clientes.length, 1);
  assert.equal(banco.fornecedores.length, 1);
  assert.equal(banco.clientes[0].fornecedor_vinculado_id, banco.fornecedores[0].id);
  assert.equal(banco.fornecedores[0].cliente_vinculado_id, banco.clientes[0].id);
  assert.equal(banco.clientes[0].nome, 'Manar');
  assert.equal(banco.fornecedores[0].nome, 'Manar');
});

test('salvarParceiro: editar um par existente sincroniza os campos compartilhados nos dois lados', async () => {
  const banco = {
    clientes: [{ id: 'c1', nome: 'Manar', cnpj: '222', tipo: 'Revenda', tipo_pessoa: 'J', fornecedor_vinculado_id: 'f1' }],
    fornecedores: [{ id: 'f1', nome: 'Manar', cnpj: '222', categoria: 'Carnes', cliente_vinculado_id: 'c1' }],
  };
  const sb = criarSb(banco);
  const { error } = await salvarParceiro(sb, {
    form: { nome: 'Manar Atacado', cnpj: '222', tipo: 'Revenda', tipo_pessoa: 'J', categoria: 'Carnes' },
    papeis: ['cliente', 'fornecedor'], clienteExistente: banco.clientes[0], fornecedorExistente: banco.fornecedores[0],
    empresaId: 'e1', fiscalDisponivel: true,
  });
  assert.equal(error, null);
  assert.equal(banco.clientes[0].nome, 'Manar Atacado');
  assert.equal(banco.fornecedores[0].nome, 'Manar Atacado');
});

test('salvarParceiro: adicionar papel fornecedor a um cliente existente cria e vincula o novo lado', async () => {
  const banco = { clientes: [{ id: 'c1', nome: 'Manar', cnpj: '222', tipo: 'Revenda', tipo_pessoa: 'J', fornecedor_vinculado_id: null }], fornecedores: [] };
  const sb = criarSb(banco);
  const { error } = await salvarParceiro(sb, {
    form: { nome: 'Manar', cnpj: '222', tipo: 'Revenda', tipo_pessoa: 'J', categoria: 'Carnes' },
    papeis: ['cliente', 'fornecedor'], clienteExistente: banco.clientes[0], fornecedorExistente: null,
    empresaId: 'e1', fiscalDisponivel: true,
  });
  assert.equal(error, null);
  assert.equal(banco.fornecedores.length, 1);
  assert.equal(banco.clientes[0].fornecedor_vinculado_id, banco.fornecedores[0].id);
  assert.equal(banco.fornecedores[0].cliente_vinculado_id, 'c1');
});

test('salvarParceiro: desmarcar um papel exclui aquele lado e não apaga o outro', async () => {
  const banco = {
    clientes: [{ id: 'c1', nome: 'Manar', fornecedor_vinculado_id: 'f1' }],
    fornecedores: [{ id: 'f1', nome: 'Manar', cliente_vinculado_id: 'c1' }],
  };
  const sb = criarSb(banco);
  const { error } = await salvarParceiro(sb, {
    form: { nome: 'Manar', tipo_pessoa: 'J' },
    papeis: ['cliente'], clienteExistente: banco.clientes[0], fornecedorExistente: banco.fornecedores[0],
    empresaId: 'e1', fiscalDisponivel: true,
  });
  assert.equal(error, null);
  assert.equal(banco.fornecedores.length, 0);
  assert.equal(banco.clientes.length, 1);
});

test('salvarParceiro: desmarcar um papel com movimento vinculado falha e não grava nada', async () => {
  const banco = {
    clientes: [{ id: 'c1', nome: 'Manar', fornecedor_vinculado_id: 'f1' }],
    fornecedores: [{ id: 'f1', nome: 'Manar', cliente_vinculado_id: 'c1' }],
  };
  const sb = criarSb(banco, { falharAoExcluir: new Set(['f1']) });
  const { error } = await salvarParceiro(sb, {
    form: { nome: 'Manar Novo Nome', tipo_pessoa: 'J' },
    papeis: ['cliente'], clienteExistente: banco.clientes[0], fornecedorExistente: banco.fornecedores[0],
    empresaId: 'e1', fiscalDisponivel: true,
  });
  assert.match(error, /fornecedor/);
  assert.equal(banco.fornecedores.length, 1); // não foi excluído
  assert.equal(banco.clientes[0].nome, 'Manar'); // e o cliente não foi atualizado, o save parou antes
});

test('salvarParceiro: recusa salvar sem nenhum papel marcado', async () => {
  const sb = criarSb({ clientes: [], fornecedores: [] });
  const { error } = await salvarParceiro(sb, { form: { nome: 'X' }, papeis: [], clienteExistente: null, fornecedorExistente: null, empresaId: 'e1' });
  assert.match(error, /papel/i);
});

test('salvarParceiro: sem fiscalDisponivel usa o recorte comercial (não manda coluna do bloco fiscal)', async () => {
  const banco = { clientes: [], fornecedores: [] };
  const sb = criarSb(banco);
  await salvarParceiro(sb, {
    form: { nome: 'X', tipo: 'Revenda', tipo_pessoa: 'J', uf: 'RO', cep: '76900000' },
    papeis: ['cliente'], clienteExistente: null, fornecedorExistente: null, empresaId: 'e1', fiscalDisponivel: false,
  });
  assert.equal('uf' in banco.clientes[0], false);
  assert.equal(banco.clientes[0].nome, 'X');
});

test('salvarParceiro: recorte comercial não derruba o vínculo com fornecedor', async () => {
  const banco = { clientes: [], fornecedores: [{ id: 'f9', nome: 'X', categoria: 'Outros' }] };
  const sb = criarSb(banco);
  const { error } = await salvarParceiro(sb, {
    form: { nome: 'X', tipo: 'Revenda', tipo_pessoa: 'J', uf: 'RO', cep: '76900000', categoria: 'Outros' },
    papeis: ['cliente', 'fornecedor'], clienteExistente: null, fornecedorExistente: banco.fornecedores[0],
    empresaId: 'e1', fiscalDisponivel: false,
  });
  assert.equal(error, null);
  assert.equal(banco.clientes[0].fornecedor_vinculado_id, 'f9');
  assert.equal('uf' in banco.clientes[0], false);
});

test('salvarParceiro: fornecedor criado é desfeito se a gravação do cliente falhar', async () => {
  const banco = { clientes: [], fornecedores: [] };
  const sb = criarSb(banco, { falharAoInserir: new Set(['clientes']) });
  const { error } = await salvarParceiro(sb, {
    form: { nome: 'Manar', cnpj: '222', tipo: 'Revenda', tipo_pessoa: 'J', categoria: 'Carnes' },
    papeis: ['cliente', 'fornecedor'], clienteExistente: null, fornecedorExistente: null, empresaId: 'e1', fiscalDisponivel: true,
  });
  assert.match(error, /cliente/);
  assert.equal(banco.fornecedores.length, 0, 'o fornecedor criado nesta chamada não deve sobrar órfão');
  assert.equal(banco.clientes.length, 0);
});

test('salvarParceiro: CNPJ de fornecedor duplicado vira mensagem em português, não o erro do Postgres', async () => {
  const banco = { clientes: [], fornecedores: [] };
  const sb = criarSb(banco, { falharAoInserir: new Set(['fornecedores']) });
  const { error } = await salvarParceiro(sb, {
    form: { nome: 'Manar', cnpj: '222', tipo_pessoa: 'J', categoria: 'Carnes' },
    papeis: ['fornecedor'], clienteExistente: null, fornecedorExistente: null, empresaId: 'e1',
  });
  assert.match(error, /já existe/i);
  assert.doesNotMatch(error, /duplicate key/);
});

test('excluirParceiro: cliente excluído e fornecedor bloqueado por FK relata o que já foi feito', async () => {
  const banco = { clientes: [{ id: 'c1', nome: 'Manar' }], fornecedores: [{ id: 'f1', nome: 'Manar' }] };
  const sb = criarSb(banco, { falharAoExcluir: new Set(['f1']) });
  const { error } = await excluirParceiro(sb, { clienteId: 'c1', fornecedorId: 'f1' });
  assert.match(error, /cliente.*foi excluído/i);
  assert.equal(banco.clientes.length, 0);
  assert.equal(banco.fornecedores.length, 1);
});

test('excluirParceiro: exclui os dois lados de um par vinculado', async () => {
  const banco = { clientes: [{ id: 'c1', nome: 'Manar' }], fornecedores: [{ id: 'f1', nome: 'Manar' }] };
  const sb = criarSb(banco);
  const { error } = await excluirParceiro(sb, { clienteId: 'c1', fornecedorId: 'f1' });
  assert.equal(error, null);
  assert.equal(banco.clientes.length, 0);
  assert.equal(banco.fornecedores.length, 0);
});

test('excluirParceiro: erro num dos lados relata os dois nomes na mensagem', async () => {
  const banco = { clientes: [{ id: 'c1', nome: 'Manar' }], fornecedores: [{ id: 'f1', nome: 'Manar' }] };
  const sb = criarSb(banco, { falharAoExcluir: new Set(['f1']) });
  const { error } = await excluirParceiro(sb, { clienteId: 'c1', fornecedorId: 'f1' });
  assert.match(error, /fornecedor/);
  assert.equal(banco.clientes.length, 0); // o lado cliente foi excluído normalmente
});

test('alternarAtivoParceiro: desativa os dois lados de um par vinculado', async () => {
  const banco = { clientes: [{ id: 'c1', nome: 'Manar', ativo: true }], fornecedores: [{ id: 'f1', nome: 'Manar', ativo: true }] };
  const sb = criarSb(banco);
  const { error } = await alternarAtivoParceiro(sb, { clienteId: 'c1', fornecedorId: 'f1', ativo: true });
  assert.equal(error, null);
  assert.equal(banco.clientes[0].ativo, false);
  assert.equal(banco.fornecedores[0].ativo, false);
});
