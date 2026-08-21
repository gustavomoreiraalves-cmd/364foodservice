// As rotas de NF-e usam service role, que passa por cima do RLS. Por isso o
// escopo de empresa precisa ser conferido na mão aqui — sem isso, um usuário
// autenticado poderia ler nota de outra empresa do grupo passando outro empresaId.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function garantirEmpresa(sb, user, isAdmin, empresaId) {
  if (!empresaId) throw new Error('Informe a empresa.');
  // Para o não-admin a consulta em usuario_empresas já valida o id na prática,
  // mas o admin passa direto — e esse mesmo texto vira segmento do caminho no
  // Storage lá na rota de upload.
  if (!UUID.test(String(empresaId))) throw new Error('Empresa inválida: o identificador não é um UUID.');
  if (isAdmin) return true;
  const { data } = await sb.from('usuario_empresas')
    .select('empresa_id').eq('user_id', user.id).eq('empresa_id', empresaId).maybeSingle();
  if (!data) throw new Error('Sem acesso a esta empresa.');
  return true;
}
