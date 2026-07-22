import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Gestão de usuários exige a service role key (Painel Supabase →
// Project Settings → API Keys → secret key). Fica só no servidor:
// nunca usar prefixo NEXT_PUBLIC_.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function clienteAdmin() {
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Confere que quem chama está logado e tem o módulo 'admin'
async function autorizar(request) {
  if (!serviceKey) {
    return { erro: NextResponse.json({ error: 'Configure SUPABASE_SERVICE_ROLE_KEY no .env.local para gerenciar usuários.' }, { status: 500 }) };
  }
  const token = (request.headers.get('authorization') || '').replace('Bearer ', '');
  if (!token) return { erro: NextResponse.json({ error: 'Não autenticado.' }, { status: 401 }) };

  const sb = clienteAdmin();
  const { data: { user }, error } = await sb.auth.getUser(token);
  if (error || !user) return { erro: NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 }) };

  const { data: perm } = await sb.from('permissoes').select('modulo').eq('user_id', user.id).eq('modulo', 'admin');
  if (!perm?.length) return { erro: NextResponse.json({ error: 'Apenas administradores.' }, { status: 403 }) };

  return { sb, user };
}

// Grava (cria ou atualiza) o registro do usuário na tabela funcionarios — um por
// empresa concedida, já que funcionarios.user_id agora é único por empresa.
// Empresas removidas do acesso NÃO apagam o funcionário (pode estar referenciado
// em responsavel_id de recebimentos/produções/despesas) — marcam ativo=false.
async function salvarFuncionarios(sb, userId, dados, empresaIds) {
  const campos = {
    nome: dados.nome || null,
    email: dados.email || null,
    telefone: dados.telefone || null,
    cpf: dados.cpf || null,
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

export async function GET(request) {
  const { sb, erro } = await autorizar(request);
  if (erro) return erro;

  const { data, error } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const [{ data: perms }, { data: funcs }, { data: empresasUsuario }, { data: empresasDisponiveis }] = await Promise.all([
    sb.from('permissoes').select('user_id, modulo'),
    sb.from('funcionarios').select('user_id, empresa_id, nome, email, telefone, cpf, ativo'),
    sb.from('usuario_empresas').select('user_id, empresa_id'),
    sb.from('empresas').select('id, nome').eq('ativo', true).order('nome'),
  ]);

  const permsPorUsuario = {};
  (perms || []).forEach(p => {
    (permsPorUsuario[p.user_id] = permsPorUsuario[p.user_id] || []).push(p.modulo);
  });
  const empresasPorUsuario = {};
  (empresasUsuario || []).forEach(e => {
    (empresasPorUsuario[e.user_id] = empresasPorUsuario[e.user_id] || []).push(e.empresa_id);
  });
  // dados de cadastro (nome/email/telefone/cpf) vêm do primeiro funcionário ativo do usuário
  const funcPorUsuario = {};
  (funcs || []).forEach(f => {
    if (!f.user_id) return;
    if (!funcPorUsuario[f.user_id] || f.ativo) funcPorUsuario[f.user_id] = f;
  });

  const usuarios = data.users.map(u => {
    const func = funcPorUsuario[u.id] || {};
    return {
      id: u.id,
      loginEmail: u.email,
      usuario: u.email?.endsWith('@364.local') ? u.email.replace('@364.local', '') : u.email,
      nome: func.nome || u.user_metadata?.nome || '',
      email: func.email || '',
      telefone: func.telefone || '',
      cpf: func.cpf || '',
      permissoes: permsPorUsuario[u.id] || [],
      empresas: empresasPorUsuario[u.id] || [],
    };
  });
  return NextResponse.json({ usuarios, empresasDisponiveis: empresasDisponiveis || [] });
}

export async function POST(request) {
  const { sb, erro } = await autorizar(request);
  if (erro) return erro;

  const { nome, usuario, email, telefone, cpf, senha, permissoes, empresas } = await request.json();
  if (!nome || !usuario || !senha) {
    return NextResponse.json({ error: 'Nome, usuário e senha são obrigatórios.' }, { status: 400 });
  }
  const empresaIds = Array.isArray(empresas) ? empresas : [];
  const loginEmail = usuario.includes('@') ? usuario.trim() : `${usuario.trim()}@364.local`;

  const { data, error } = await sb.auth.admin.createUser({
    email: loginEmail,
    password: senha,
    email_confirm: true,
    user_metadata: { nome },
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const uid = data.user.id;
  const mods = Array.isArray(permissoes) ? permissoes : [];
  if (mods.length) {
    await sb.from('permissoes').insert(mods.map(m => ({ user_id: uid, modulo: m })));
  }
  if (empresaIds.length) {
    await sb.from('usuario_empresas').insert(empresaIds.map(eid => ({ user_id: uid, empresa_id: eid })));
  }
  await salvarFuncionarios(sb, uid, { nome, email, telefone, cpf }, empresaIds);

  return NextResponse.json({ ok: true, id: uid });
}

export async function PATCH(request) {
  const { sb, erro } = await autorizar(request);
  if (erro) return erro;

  const { id, nome, email, telefone, cpf, senha, permissoes, empresas } = await request.json();
  if (!id) return NextResponse.json({ error: 'id é obrigatório.' }, { status: 400 });

  // Atualiza login (senha e/ou nome de exibição)
  const authUpdates = {};
  if (senha) authUpdates.password = senha;
  if (nome) authUpdates.user_metadata = { nome };
  if (Object.keys(authUpdates).length) {
    const { error } = await sb.auth.admin.updateUserById(id, authUpdates);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Atualiza acesso por empresa (substitui todas) — quando `empresas` não vem no
  // payload (ex: usuário marcado como admin), não mexe no que já existe.
  let empresaIds = null;
  if (Array.isArray(empresas)) {
    empresaIds = empresas;
    await sb.from('usuario_empresas').delete().eq('user_id', id);
    if (empresaIds.length) {
      const { error } = await sb.from('usuario_empresas').insert(empresaIds.map(eid => ({ user_id: id, empresa_id: eid })));
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // Atualiza cadastro (funcionarios) — um registro por empresa concedida.
  // Só roda quando `empresas` veio no payload (senão não sabemos a lista atual sem
  // outra consulta, e não há necessidade: nada mudou nas empresas do usuário).
  if (empresaIds !== null) {
    await salvarFuncionarios(sb, id, { nome, email, telefone, cpf }, empresaIds);
  }

  // Atualiza permissões (substitui todas)
  if (Array.isArray(permissoes)) {
    await sb.from('permissoes').delete().eq('user_id', id);
    if (permissoes.length) {
      const { error } = await sb.from('permissoes').insert(permissoes.map(m => ({ user_id: id, modulo: m })));
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request) {
  const { sb, user, erro } = await autorizar(request);
  if (erro) return erro;

  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: 'id é obrigatório.' }, { status: 400 });
  if (id === user.id) return NextResponse.json({ error: 'Você não pode excluir o próprio usuário.' }, { status: 400 });

  const { error } = await sb.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
