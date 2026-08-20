import { NextResponse } from 'next/server';
import { autenticarDispositivo } from '../../../../../lib/pontoServer';

// GET (x-device-token): retorna o aviso de privacidade vigente, para exibir
// no quiosque antes do colaborador consentir com a captura da biometria.
export async function GET(request) {
  const { sb, erro } = await autenticarDispositivo(request);
  if (erro) return erro;

  const { data: aviso } = await sb.from('ponto_avisos_privacidade')
    .select('id, versao, texto').eq('ativo', true).order('versao', { ascending: false }).limit(1).maybeSingle();
  if (!aviso) return NextResponse.json({ error: 'Nenhum aviso de privacidade cadastrado.' }, { status: 404 });

  return NextResponse.json({ aviso });
}
