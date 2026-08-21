// As rotas de NF-e usam service role, que passa por cima do RLS. Por isso o
// escopo de empresa precisa ser conferido na mão aqui — sem isso, um usuário
// autenticado poderia ler nota de outra empresa do grupo passando outro empresaId.
export async function garantirEmpresa(sb, user, isAdmin, empresaId) {
  if (!empresaId) throw new Error('Informe a empresa.');
  if (isAdmin) return true;
  const { data } = await sb.from('usuario_empresas')
    .select('empresa_id').eq('user_id', user.id).eq('empresa_id', empresaId).maybeSingle();
  if (!data) throw new Error('Sem acesso a esta empresa.');
  return true;
}
