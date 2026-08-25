// Junta `clientes` e `fornecedores` numa lista só de "parceiros" — usada pela
// tela unificada em app/clientes/page.js. Função pura: sem rede, sem Supabase.
// A lógica de gravação (criar/editar/desvincular) fica em salvarParceiro, logo
// abaixo neste mesmo arquivo.

import { clienteParaGravar, recorteComercial } from './clientes.js';
import { fornecedorParaGravar } from './fornecedores.js';

function linhaParceiro({ id, clienteId, fornecedorId, papeis, cliente, fornecedor }) {
  const principal = cliente || fornecedor;
  return {
    id, clienteId, fornecedorId, papeis,
    nome: principal.nome, nome_fantasia: principal.nome_fantasia || '',
    cnpj: principal.cnpj || '', contato: principal.contato || '', telefone: principal.telefone || '',
    cpf: cliente?.cpf || '', tipo: cliente?.tipo || '', municipio: cliente?.municipio || '', uf: cliente?.uf || '',
    categoria: fornecedor?.categoria || '', email: fornecedor?.email || '',
    cliente: cliente || null, fornecedor: fornecedor || null,
    ativo: (cliente ? cliente.ativo !== false : true) && (fornecedor ? fornecedor.ativo !== false : true),
  };
}

export function montarListaParceiros(clientes, fornecedores) {
  const fornecedoresPorId = new Map((fornecedores || []).map(f => [f.id, f]));
  const clientesVinculados = new Set();
  const fornecedoresVinculados = new Set();

  const linhas = [];

  for (const c of clientes || []) {
    if (!c.fornecedor_vinculado_id) continue;
    const f = fornecedoresPorId.get(c.fornecedor_vinculado_id);
    if (!f) continue;
    clientesVinculados.add(c.id);
    fornecedoresVinculados.add(f.id);
    linhas.push(linhaParceiro({
      id: `c:${c.id}+f:${f.id}`, clienteId: c.id, fornecedorId: f.id,
      papeis: ['cliente', 'fornecedor'], cliente: c, fornecedor: f,
    }));
  }

  for (const c of clientes || []) {
    if (clientesVinculados.has(c.id)) continue;
    linhas.push(linhaParceiro({ id: `c:${c.id}`, clienteId: c.id, fornecedorId: null, papeis: ['cliente'], cliente: c, fornecedor: null }));
  }

  for (const f of fornecedores || []) {
    if (fornecedoresVinculados.has(f.id)) continue;
    linhas.push(linhaParceiro({ id: `f:${f.id}`, clienteId: null, fornecedorId: f.id, papeis: ['fornecedor'], cliente: null, fornecedor: f }));
  }

  return linhas.sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
}

/**
 * Grava um parceiro (cliente e/ou fornecedor vinculados) a partir de um único
 * formulário. `papeis` decide quais tabelas recebem linha; campos
 * compartilhados saem idênticos nas duas quando os dois papéis estão
 * marcados. Um papel que existia e some desta vez tenta excluir aquele lado —
 * se a FK barrar (movimento vinculado), o salvamento inteiro para ali, sem
 * gravar nada mais.
 */
export async function salvarParceiro(sb, { form, papeis, clienteExistente, fornecedorExistente, empresaId, fiscalDisponivel = true }) {
  const querCliente = papeis.includes('cliente');
  const querFornecedor = papeis.includes('fornecedor');
  if (!querCliente && !querFornecedor) return { error: 'Marque pelo menos um papel: cliente ou fornecedor.' };

  if (!querCliente && clienteExistente) {
    const { error } = await sb.from('clientes').delete().eq('id', clienteExistente.id);
    if (error) return { error: mensagemDeExclusaoDePapel(error, 'cliente') };
  }
  if (!querFornecedor && fornecedorExistente) {
    const { error } = await sb.from('fornecedores').delete().eq('id', fornecedorExistente.id);
    if (error) return { error: mensagemDeExclusaoDePapel(error, 'fornecedor') };
  }

  let clienteId = querCliente ? clienteExistente?.id : null;
  let fornecedorId = querFornecedor ? fornecedorExistente?.id : null;

  // Fornecedor primeiro: se os dois lados são novos, o cliente precisa do id
  // dele pra gravar o vínculo já na própria criação.
  if (querFornecedor) {
    const dados = fornecedorParaGravar(form);
    if (fornecedorId) {
      const { error } = await sb.from('fornecedores').update(dados).eq('id', fornecedorId);
      if (error) return { error: 'Não foi possível salvar o fornecedor: ' + error.message };
    } else {
      const { data, error } = await sb.from('fornecedores')
        .insert([{ ...dados, empresa_id: empresaId }]).select('*').single();
      if (error) return { error: 'Não foi possível criar o fornecedor: ' + error.message };
      fornecedorId = data.id;
    }
  }

  if (querCliente) {
    const base = fiscalDisponivel ? clienteParaGravar(form) : recorteComercial(clienteParaGravar(form));
    const dados = { ...base, fornecedor_vinculado_id: querFornecedor ? fornecedorId : null };
    if (clienteId) {
      const { error } = await sb.from('clientes').update(dados).eq('id', clienteId);
      if (error) return { error: 'Não foi possível salvar o cliente: ' + error.message };
    } else {
      const { data, error } = await sb.from('clientes')
        .insert([{ ...dados, empresa_id: empresaId }]).select('*').single();
      if (error) return { error: 'Não foi possível criar o cliente: ' + error.message };
      clienteId = data.id;
    }
  }

  if (querFornecedor && querCliente) {
    const { error } = await sb.from('fornecedores')
      .update({ cliente_vinculado_id: clienteId }).eq('id', fornecedorId);
    if (error) return { error: 'Não foi possível vincular o fornecedor ao cliente: ' + error.message };
  }

  return { error: null };
}

function mensagemDeExclusaoDePapel(erro, lado) {
  return `Não foi possível remover o papel de ${lado}: ${erro.message}. Se este cadastro já `
    + 'tem movimento (pedido, recebimento, conta a pagar), desmarcar não é possível — desative em vez de remover o papel.';
}

// Exclui os lados que existirem. Usado pelo botão "Excluir" da ficha de
// parceiro — o mesmo bloqueio de FK de sempre vale por lado.
export async function excluirParceiro(sb, parceiro) {
  const erros = [];
  if (parceiro.clienteId) {
    const { error } = await sb.from('clientes').delete().eq('id', parceiro.clienteId);
    if (error) erros.push('cliente: ' + error.message);
  }
  if (parceiro.fornecedorId) {
    const { error } = await sb.from('fornecedores').delete().eq('id', parceiro.fornecedorId);
    if (error) erros.push('fornecedor: ' + error.message);
  }
  if (erros.length) {
    return { error: 'Não foi possível excluir (' + erros.join('; ') + '). Se já tem movimento, use Desativar em vez de Excluir.' };
  }
  return { error: null };
}

// Ativa/desativa os lados que existirem, sempre pro mesmo valor.
export async function alternarAtivoParceiro(sb, parceiro) {
  const novoAtivo = !(parceiro.ativo !== false);
  const erros = [];
  if (parceiro.clienteId) {
    const { error } = await sb.from('clientes').update({ ativo: novoAtivo }).eq('id', parceiro.clienteId);
    if (error) erros.push('cliente: ' + error.message);
  }
  if (parceiro.fornecedorId) {
    const { error } = await sb.from('fornecedores').update({ ativo: novoAtivo }).eq('id', parceiro.fornecedorId);
    if (error) erros.push('fornecedor: ' + error.message);
  }
  if (erros.length) return { error: 'Não foi possível mudar a situação (' + erros.join('; ') + ').' };
  return { error: null };
}
