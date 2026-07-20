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

// Grava (cria ou atualiza) o registro do usuário na tabela funcionarios
async function salvarFuncionario(sb, userId, dados) {
  const campos = {
    nome: dados.nome || null,
    email: dados.email || null,
    telefone: dados.telefone || null,
    cpf: dados.cpf || null,
  };
  const { data: existente } = await sb.from('funcionarios').select('id').eq('user_id', userId).maybeSingle();
  if (existente) {
    await sb.from('funcionarios').update(campos).eq('id', existente.id);
  } else {
    await sb.from('funcionarios').insert([{ user_id: userId, ...campos }]);
  }
}

export async function GET(request) {
  const { sb, erro } = await autorizar(request);
  if (erro) return erro;

  const { data, error } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const [{ data: perms }, { data: funcs }] = await Promise.all([
    sb.from('permissoes').select('user_id, modulo'),
    sb.from('funcionarios').select('user_id, nome, email, telefone, cpf'),
  ]);

  const permsPorUsuario = {};
  (perms || []).forEach(p => {
    (permsPorUsuario[p.user_id] = permsPorUsuario[p.user_id] || []).push(p.modulo);
  });
  const funcPorUsuario = {};
  (funcs || []).forEach(f => { if (f.user_id) funcPorUsuario[f.user_id] = f; });

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
    };
  });
  return NextResponse.json({ usuarios });
}

export async function POST(request) {
  const { sb, erro } = await autorizar(request);
  if (erro) return erro;

  const { nome, usuario, email, telefone, cpf, senha, permissoes } = await request.json();
  if (!nome || !usuario || !senha) {
    return NextResponse.json({ error: 'Nome, usuário e senha são obrigatórios.' }, { status: 400 });
  }
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
  await salvarFuncionario(sb, uid, { nome, email, telefone, cpf });

  return NextResponse.json({ ok: true, id: uid });
}

export async function PATCH(request) {
  const { sb, erro } = await autorizar(request);
  if (erro) return erro;

  const { id, nome, email, telefone, cpf, senha, permissoes } = await request.json();
  if (!id) return NextResponse.json({ error: 'id é obrigatório.' }, { status: 400 });

  // Atualiza login (senha e/ou nome de exibição)
  const authUpdates = {};
  if (senha) authUpdates.password = senha;
  if (nome) authUpdates.user_metadata = { nome };
  if (Object.keys(authUpdates).length) {
    const { error } = await sb.auth.admin.updateUserById(id, authUpdates);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Atualiza cadastro (funcionarios)
  if (nome !== undefined || email !== undefined || telefone !== undefined || cpf !== undefined) {
    await salvarFuncionario(sb, id, { nome, email, telefone, cpf });
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
