import { NextResponse } from 'next/server';
import { autenticarDispositivo, sha256Hex } from '../../../../../lib/pontoServer';

// POST { matricula, pin } (x-device-token): identifica o colaborador por
// matrícula + PIN de contingência. Retorna o colaborador para seguir no
// fluxo normal de contexto/marcar com metodo='pin'.
export async function POST(request) {
  const { sb, disp, erro } = await autenticarDispositivo(request);
  if (erro) return erro;

  const { matricula, pin } = await request.json();
  if (!matricula || !pin) return NextResponse.json({ error: 'Informe matrícula e PIN.' }, { status: 400 });

  const hoje = new Date().toISOString().slice(0, 10);
  const { data: colabs } = await sb.from('colaboradores')
    .select('id, nome, matricula, status, registra_ponto, metodos_permitidos')
    .eq('matricula', String(matricula).trim())
    .eq('status', 'ativo')
    .eq('registra_ponto', true);

  const candidatos = (colabs || []).filter(c => (c.metodos_permitidos || []).includes('pin'));

  for (const colab of candidatos) {
    const { data: vinculo } = await sb.from('colaborador_unidades')
      .select('id')
      .eq('colaborador_id', colab.id)
      .eq('unidade_id', disp.unidade_id)
      .lte('data_inicio', hoje)
      .or('data_fim.is.null,data_fim.gte.' + hoje)
      .limit(1).maybeSingle();
    if (!vinculo) continue;

    const { data: reg } = await sb.from('ponto_pins').select('pin_hash, salt').eq('colaborador_id', colab.id).maybeSingle();
    if (reg && sha256Hex(String(pin) + reg.salt) === reg.pin_hash) {
      return NextResponse.json({ colaborador: { id: colab.id, primeiroNome: colab.nome.split(' ')[0] } });
    }
  }

  await sb.from('ponto_tentativas').insert([{
    empresa_id: disp.empresa_id,
    unidade_id: disp.unidade_id,
    dispositivo_id: disp.id,
    motivo: 'pin_invalido',
  }]);
  return NextResponse.json({ error: 'Matrícula ou PIN inválidos.' }, { status: 401 });
}
