import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { autorizarModulo, sha256Hex, auditar } from '../../../../../lib/pontoServer';

// POST (RH logado) { colaboradorId, pin }: define o PIN de contingência.
// O PIN nunca é armazenado em claro — só sha256(pin + salt).
export async function POST(request) {
  const { sb, user, erro } = await autorizarModulo(request, 'ponto');
  if (erro) return erro;

  const { colaboradorId, pin } = await request.json();
  if (!colaboradorId || !/^\d{4,6}$/.test(String(pin || ''))) {
    return NextResponse.json({ error: 'PIN deve ter de 4 a 6 dígitos.' }, { status: 400 });
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const { error } = await sb.from('ponto_pins').upsert([{
    colaborador_id: colaboradorId,
    pin_hash: sha256Hex(String(pin) + salt),
    salt,
    updated_at: new Date().toISOString(),
  }]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await auditar(sb, { ator_user_id: user.id, ator_tipo: 'usuario', acao: 'pin_definido', entidade: 'colaboradores', entidade_id: colaboradorId });
  return NextResponse.json({ ok: true });
}
