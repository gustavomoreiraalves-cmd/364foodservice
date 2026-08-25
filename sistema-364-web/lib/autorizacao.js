// Guardas de escopo de empresa para as rotas de app/api/*.
//
// Todas essas rotas falam com o Supabase pela service role key, que passa por
// cima do RLS. Quem impede um usuário de alcançar dados de outra marca do grupo
// é este arquivo — não o banco. Regra: toda rota que recebe um id vindo do
// cliente passa por uma destas funções ANTES de ler ou gravar qualquer coisa.
//
// Os erros carregam `status` para a rota devolver o código HTTP certo sem
// precisar interpretar a mensagem.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function recusa(mensagem, status) {
  const erro = new Error(mensagem);
  erro.status = status;
  return erro;
}

// Garante que o id é um UUID de verdade. Além do escopo, isto protege quem usa
// o valor como segmento de caminho no Storage (ver a rota de upload de NF-e).
function exigirUuid(valor, rotulo) {
  if (!UUID.test(String(valor))) {
    throw recusa(`${rotulo} inválido: o identificador não é um UUID.`, 400);
  }
}

export async function garantirEmpresa(sb, user, isAdmin, empresaId) {
  if (!empresaId) throw recusa('Informe a empresa.', 400);
  // Para o não-admin a consulta em usuario_empresas já valida o id na prática,
  // mas o admin passa direto — e esse mesmo texto vira segmento do caminho no
  // Storage lá na rota de upload.
  exigirUuid(empresaId, 'Empresa');
  if (isAdmin) return true;
  const { data } = await sb.from('usuario_empresas')
    .select('empresa_id').eq('user_id', user.id).eq('empresa_id', empresaId).maybeSingle();
  if (!data) throw recusa('Sem acesso a esta empresa.', 403);
  return true;
}

// Carrega a linha e confere se ela é de uma empresa que o usuário alcança.
// `campos` é a lista de colunas que a rota vai usar; empresa_id entra sempre.
//
// "Não existe" e "existe, mas é de outra empresa" devolvem exatamente a mesma
// recusa. Diferenciar as duas transformaria a rota num oráculo de enumeração:
// quem tivesse um id em mãos descobriria se ele é real só pela mensagem.
async function garantirLinhaDaEmpresa(sb, user, isAdmin, { tabela, id, campos, rotulo, naoEncontrado }) {
  if (!id) throw recusa(`Informe ${rotulo.artigo} ${rotulo.nome}.`, 400);
  exigirUuid(id, rotulo.titulo);

  const selecao = /\bempresa_id\b/.test(campos) ? campos : `${campos}, empresa_id`;
  const { data, error } = await sb.from(tabela).select(selecao).eq('id', id).maybeSingle();
  if (error) throw recusa(`Falha ao conferir ${rotulo.artigo} ${rotulo.nome}: ${error.message}`, 500);
  if (!data) throw recusa(naoEncontrado, 404);

  if (!isAdmin) {
    const { data: vinculo } = await sb.from('usuario_empresas')
      .select('empresa_id').eq('user_id', user.id).eq('empresa_id', data.empresa_id).maybeSingle();
    if (!vinculo) throw recusa(naoEncontrado, 404);
  }
  return data;
}

export async function garantirColaborador(sb, user, isAdmin, colaboradorId, campos = 'id, nome, empresa_id') {
  return garantirLinhaDaEmpresa(sb, user, isAdmin, {
    tabela: 'colaboradores',
    id: colaboradorId,
    campos,
    rotulo: { artigo: 'o', nome: 'colaborador', titulo: 'Colaborador' },
    naoEncontrado: 'Colaborador não encontrado.',
  });
}

export async function garantirUnidade(sb, user, isAdmin, unidadeId, campos = 'id, nome, fuso, empresa_id') {
  return garantirLinhaDaEmpresa(sb, user, isAdmin, {
    tabela: 'unidades',
    id: unidadeId,
    campos,
    rotulo: { artigo: 'a', nome: 'unidade', titulo: 'Unidade' },
    naoEncontrado: 'Unidade não encontrada.',
  });
}
