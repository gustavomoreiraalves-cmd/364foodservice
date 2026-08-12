import { NextResponse } from 'next/server';
import { autorizarModulo, auditar } from '../../../../../lib/pontoServer';

// Gestão de acesso ao sistema a partir do cadastro de colaborador
// (substitui a antiga tela /usuarios). Admin-only.

async function exigirAdmin(request) {
  const auth = await autorizarModulo(request, 'ponto');
  if (auth.erro) return auth;
  if (!auth.isAdmin) return { erro: NextResponse.json({ error: 'Apenas administradores gerenciam acessos.' }, { status: 403 }) };
  return auth;
}

async function carregarColaborador(sb, colaboradorId) {
  const { data } = await sb.from('colaboradores')
    .select('id, nome, cpf, email, telefone, cargo, empresa_id, status, user_id')
    .eq('id', colaboradorId).maybeSingle();
  return data;
}

// Sincroniza a tabela operacional `funcionarios` (Responsável em
// recebimentos/produções/pedidos/despesas): uma linha por empresa
// concedida, dados vindos do colaborador. Empresas removidas nunca
// são deletadas (podem estar em responsavel_id) — só ativo=false.
async function sincronizarFuncionarios(sb, colab, userId, empresaIds) {
  const campos = {
    nome: colab.nome,
    email: colab.email || null,
    telefone: colab.telefone || null,
    cpf: colab.cpf || null,
    cargo: colab.cargo || null,
    colaborador_id: colab.id,
  };
  const { data: existentes } = await sb.from('funcionarios').select('id, empresa_id').eq('user_id', userId);
  const porEmpresa = {};
  (existentes || []).forEach(f => { porEmpresa[f.empresa_id] = f; });

  for (const empresaId of empresaIds) {
    const existente = porEmpresa[empresaId];
    if (existente) {
      await sb.from('funcionarios').update({ ...campos, ativo: true }).eq('id', existente.id);
    } else {
      await sb.from('funcionarios').insert([{ user_id: userId, empresa_id: empresaId, ativo: true, ...campos }]);
    }
  }
  const removidas = Object.keys(porEmpresa).filter(eid => !empresaIds.includes(eid));
  if (removidas.length) {
    await sb.from('funcionarios').update({ ativo: false }).eq('user_id', userId).in('empresa_id', removidas);
  }
}

async function gravarPermissoesEmpresas(sb, userId, permissoes, empresas) {
  if (Array.isArray(permissoes)) {
    await sb.from('permissoes').delete().eq('user_id', userId);
    if (permissoes.length) {
      await sb.from('permissoes').insert(permissoes.map(m => ({ user_id: userId, modulo: m })));
    }
  }
  if (Array.isArray(empresas)) {
    await sb.from('usuario_empresas').delete().eq('user_id', userId);
    if (empresas.length) {
      await sb.from('usuario_empresas').insert(empresas.map(eid => ({ user_id: userId, empresa_id: eid })));
    }
  }
}

// GET ?colaboradorId= — acesso atual + logins ainda não vinculados a colaborador
export async function GET(request) {
  const { sb, erro } = await exigirAdmin(request);
  if (erro) return erro;

  const colaboradorId = new URL(request.url).searchParams.get('colaboradorId');
  if (!colaboradorId) return NextResponse.json({ error: 'Informe colaboradorId.' }, { status: 400 });

  const colab = await carregarColaborador(sb, colaboradorId);
  if (!colab) return NextResponse.json({ error: 'Colaborador não encontrado.' }, { status: 404 });

  const { data: usersData } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
  const { data: vinculados } = await sb.from('colaboradores').select('user_id').not('user_id', 'is', null);
  const idsVinculados = new Set((vinculados || []).map(c => c.user_id));

  let acesso = null;
  if (colab.user_id) {
    const usuario = (usersData?.users || []).find(u => u.id === colab.user_id);
    const [{ data: perms }, { data: emps }] = await Promise.all([
      sb.from('permissoes').select('modulo').eq('user_id', colab.user_id),
      sb.from('usuario_empresas').select('empresa_id').eq('user_id', colab.user_id),
    ]);
    acesso = {
      userId: colab.user_id,
      usuario: usuario ? usuario.email.replace('@364.local', '') : '(login removido)',
      banido: !!(usuario?.banned_until && new Date(usuario.banned_until) > new Date()),
      permissoes: (perms || []).map(p => p.modulo),
      empresas: (emps || []).map(e => e.empresa_id),
    };
  }

  const loginsDisponiveis = (usersData?.users || [])
    .filter(u => !idsVinculados.has(u.id))
    .map(u => ({ id: u.id, usuario: u.email.replace('@364.local', ''), nome: u.user_metadata?.nome || '' }));

  return NextResponse.json({ acesso, loginsDisponiveis });
}

// POST — concede acesso: cria login novo OU vincula login existente
export async function POST(request) {
  const { sb, user, erro } = await exigirAdmin(request);
  if (erro) return erro;

  // empresas ausente (caso admin) = não mexer em usuario_empresas nem em funcionarios
  const { colaboradorId, usuario, senha, vincularUserId, permissoes = [], empresas } = await request.json();
  if (!colaboradorId) return NextResponse.json({ error: 'Informe o colaborador.' }, { status: 400 });

  const colab = await carregarColaborador(sb, colaboradorId);
  if (!colab) return NextResponse.json({ error: 'Colaborador não encontrado.' }, { status: 404 });
  if (colab.user_id) return NextResponse.json({ error: 'Este colaborador já tem login. Use a edição de acesso.' }, { status: 400 });
  if (colab.status === 'desligado') return NextResponse.json({ error: 'Colaborador desligado não pode receber acesso.' }, { status: 400 });

  let userId = vincularUserId || null;
  if (!userId) {
    if (!usuario || !senha) return NextResponse.json({ error: 'Informe usuário e senha (ou vincule um login existente).' }, { status: 400 });
    if (senha.length < 6) return NextResponse.json({ error: 'A senha deve ter ao menos 6 caracteres.' }, { status: 400 });
    const loginEmail = usuario.includes('@') ? usuario.trim() : `${usuario.trim()}@364.local`;
    const { data, error } = await sb.auth.admin.createUser({
      email: loginEmail, password: senha, email_confirm: true, user_metadata: { nome: colab.nome },
    });
    if (error) return NextResponse.json({ error: 'Erro ao criar login: ' + error.message }, { status: 500 });
    userId = data.user.id;
  } else {
    // garante que o login não pertence a outro colaborador
    const { data: dono } = await sb.from('colaboradores').select('id').eq('user_id', userId).maybeSingle();
    if (dono) return NextResponse.json({ error: 'Este login já está vinculado a outro colaborador.' }, { status: 400 });
  }

  const { error: eVinc } = await sb.from('colaboradores').update({ user_id: userId }).eq('id', colaboradorId);
  if (eVinc) return NextResponse.json({ error: eVinc.message }, { status: 500 });

  await gravarPermissoesEmpresas(sb, userId, permissoes, empresas);
  if (Array.isArray(empresas)) {
    await sincronizarFuncionarios(sb, colab, userId, empresas);
  } else {
    // acesso admin: só garante o vínculo colaborador_id nos funcionários existentes
    await sb.from('funcionarios').update({ colaborador_id: colab.id }).eq('user_id', userId);
  }
  await auditar(sb, { ator_user_id: user.id, ator_tipo: 'usuario', acao: 'acesso_concedido', entidade: 'colaboradores', entidade_id: colaboradorId });

  return NextResponse.json({ ok: true, userId });
}

// PATCH — atualiza senha / permissões / empresas do acesso existente
export async function PATCH(request) {
  const { sb, user, erro } = await exigirAdmin(request);
  if (erro) return erro;

  const { colaboradorId, senha, permissoes, empresas } = await request.json();
  if (!colaboradorId) return NextResponse.json({ error: 'Informe o colaborador.' }, { status: 400 });

  const colab = await carregarColaborador(sb, colaboradorId);
  if (!colab?.user_id) return NextResponse.json({ error: 'Este colaborador não tem login.' }, { status: 400 });

  if (senha) {
    if (senha.length < 6) return NextResponse.json({ error: 'A senha deve ter ao menos 6 caracteres.' }, { status: 400 });
    const { error } = await sb.auth.admin.updateUserById(colab.user_id, { password: senha });
    if (error) return NextResponse.json({ error: 'Erro ao trocar senha: ' + error.message }, { status: 500 });
  }

  await gravarPermissoesEmpresas(sb, colab.user_id, permissoes, empresas);
  if (Array.isArray(empresas)) {
    await sincronizarFuncionarios(sb, colab, colab.user_id, empresas);
  }
  await auditar(sb, { ator_user_id: user.id, ator_tipo: 'usuario', acao: 'acesso_atualizado', entidade: 'colaboradores', entidade_id: colaboradorId });

  return NextResponse.json({ ok: true });
}

// DELETE — revoga o acesso (desligamento ou decisão do admin).
// O auth user NÃO é apagado (preserva histórico); é banido.
export async function DELETE(request) {
  const { sb, user, erro } = await exigirAdmin(request);
  if (erro) return erro;

  const { colaboradorId, motivo } = await request.json();
  if (!colaboradorId) return NextResponse.json({ error: 'Informe o colaborador.' }, { status: 400 });

  const colab = await carregarColaborador(sb, colaboradorId);
  if (!colab?.user_id) return NextResponse.json({ error: 'Este colaborador não tem login.' }, { status: 400 });
  if (colab.user_id === user.id) return NextResponse.json({ error: 'Você não pode revogar o próprio acesso.' }, { status: 400 });

  const { error: eBan } = await sb.auth.admin.updateUserById(colab.user_id, { ban_duration: '87600h' });
  if (eBan) return NextResponse.json({ error: 'Erro ao bloquear login: ' + eBan.message }, { status: 500 });

  await sb.from('permissoes').delete().eq('user_id', colab.user_id);
  await sb.from('usuario_empresas').delete().eq('user_id', colab.user_id);
  await sb.from('funcionarios').update({ ativo: false }).eq('user_id', colab.user_id);
  await auditar(sb, { ator_user_id: user.id, ator_tipo: 'usuario', acao: 'acesso_revogado', entidade: 'colaboradores', entidade_id: colaboradorId, motivo: motivo || null });

  return NextResponse.json({ ok: true });
}
