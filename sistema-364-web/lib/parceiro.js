// Junta `clientes` e `fornecedores` numa lista só de "parceiros" — usada pela
// tela unificada em app/clientes/page.js. Função pura: sem rede, sem Supabase.
// A lógica de gravação (criar/editar/desvincular) fica em salvarParceiro, logo
// abaixo neste mesmo arquivo.

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
