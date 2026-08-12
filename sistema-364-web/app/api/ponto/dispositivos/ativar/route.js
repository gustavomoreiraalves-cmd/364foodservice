import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { clienteAdmin, sha256Hex, auditar } from '../../../../../lib/pontoServer';

// POST { codigo }: ativa um tablet quiosque. O token retorna UMA única vez;
// no banco fica só o sha256 dele.
export async function POST(request) {
  const { codigo } = await request.json();
  if (!codigo) return NextResponse.json({ error: 'Informe o código de ativação.' }, { status: 400 });

  const sb = clienteAdmin();
  const { data: disp } = await sb.from('ponto_dispositivos')
    .select('*')
    .eq('codigo_ativacao', String(codigo).replace(/\D/g, ''))
    .eq('status', 'pendente')
    .maybeSingle();

  if (!disp) return NextResponse.json({ error: 'Código inválido.' }, { status: 404 });
  if (disp.codigo_ativacao_expira && new Date(disp.codigo_ativacao_expira) < new Date()) {
    return NextResponse.json({ error: 'Código expirado. Peça um novo ao administrador.' }, { status: 410 });
  }

  const token = crypto.randomBytes(32).toString('hex');
  const { error } = await sb.from('ponto_dispositivos').update({
    token_hash: sha256Hex(token),
    codigo_ativacao: null,
    codigo_ativacao_expira: null,
    status: 'ativo',
    ultimo_visto_em: new Date().toISOString(),
  }).eq('id', disp.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const [{ data: unidade }, { data: empresa }] = await Promise.all([
    sb.from('unidades').select('id, nome, fuso').eq('id', disp.unidade_id).single(),
    sb.from('empresas').select('id, nome').eq('id', disp.empresa_id).single(),
  ]);

  await auditar(sb, { ator_tipo: 'dispositivo', ator_dispositivo_id: disp.id, acao: 'dispositivo_ativado', entidade: 'ponto_dispositivos', entidade_id: disp.id });

  return NextResponse.json({
    deviceToken: token,
    dispositivo: { id: disp.id, nome: disp.nome },
    unidade,
    empresa,
  });
}
