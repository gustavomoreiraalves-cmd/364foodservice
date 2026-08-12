import { NextResponse } from 'next/server';
import { autenticarDispositivo } from '../../../../../lib/pontoServer';

const MOTIVOS = ['sem_match', 'liveness_falhou', 'colaborador_bloqueado', 'fora_da_unidade', 'pin_invalido', 'dispositivo_bloqueado'];

// POST (x-device-token): registra uma tentativa recusada no quiosque
// (sem match facial, prova de vida reprovada etc.) para telemetria/antifraude.
export async function POST(request) {
  const { sb, disp, erro } = await autenticarDispositivo(request);
  if (erro) return erro;

  const { motivo, melhorScore } = await request.json();
  if (!MOTIVOS.includes(motivo)) return NextResponse.json({ error: 'Motivo inválido.' }, { status: 400 });

  await sb.from('ponto_tentativas').insert([{
    empresa_id: disp.empresa_id,
    unidade_id: disp.unidade_id,
    dispositivo_id: disp.id,
    motivo,
    melhor_score: melhorScore ?? null,
  }]);
  return NextResponse.json({ ok: true });
}
