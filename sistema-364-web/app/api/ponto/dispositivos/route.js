import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { autorizarModulo, auditar } from '../../../../lib/pontoServer';

function codigoAtivacao() {
  return String(crypto.randomInt(100000, 1000000));
}

// POST: cria um dispositivo e gera o código de ativação (admin)
export async function POST(request) {
  const { sb, user, isAdmin, erro } = await autorizarModulo(request, 'ponto');
  if (erro) return erro;
  if (!isAdmin) return NextResponse.json({ error: 'Apenas administradores gerenciam dispositivos.' }, { status: 403 });

  const { nome, empresaId, unidadeId } = await request.json();
  if (!nome || !empresaId || !unidadeId) return NextResponse.json({ error: 'Informe nome, empresa e unidade.' }, { status: 400 });

  const codigo = codigoAtivacao();
  const { data, error } = await sb.from('ponto_dispositivos').insert([{
    nome,
    empresa_id: empresaId,
    unidade_id: unidadeId,
    codigo_ativacao: codigo,
    codigo_ativacao_expira: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    status: 'pendente',
    criado_por: user.id,
  }]).select('id, nome').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await auditar(sb, { ator_user_id: user.id, ator_tipo: 'usuario', acao: 'dispositivo_codigo_gerado', entidade: 'ponto_dispositivos', entidade_id: data.id });
  return NextResponse.json({ id: data.id, codigo });
}

// PATCH: bloquear/reativar/regenerar código (admin)
export async function PATCH(request) {
  const { sb, user, isAdmin, erro } = await autorizarModulo(request, 'ponto');
  if (erro) return erro;
  if (!isAdmin) return NextResponse.json({ error: 'Apenas administradores gerenciam dispositivos.' }, { status: 403 });

  const { id, acao } = await request.json();
  if (!id || !acao) return NextResponse.json({ error: 'Informe id e acao.' }, { status: 400 });

  if (acao === 'bloquear' || acao === 'reativar') {
    const status = acao === 'bloquear' ? 'bloqueado' : 'ativo';
    const { error } = await sb.from('ponto_dispositivos').update({ status }).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await auditar(sb, { ator_user_id: user.id, ator_tipo: 'usuario', acao: 'dispositivo_' + acao, entidade: 'ponto_dispositivos', entidade_id: id });
    return NextResponse.json({ ok: true });
  }

  if (acao === 'regenerar_codigo') {
    const codigo = codigoAtivacao();
    const { error } = await sb.from('ponto_dispositivos').update({
      codigo_ativacao: codigo,
      codigo_ativacao_expira: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      token_hash: null,
      status: 'pendente',
    }).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await auditar(sb, { ator_user_id: user.id, ator_tipo: 'usuario', acao: 'dispositivo_codigo_gerado', entidade: 'ponto_dispositivos', entidade_id: id });
    return NextResponse.json({ codigo });
  }

  return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });
}
