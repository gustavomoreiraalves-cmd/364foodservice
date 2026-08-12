import { NextResponse } from 'next/server';
import { autenticarDispositivo } from '../../../../../lib/pontoServer';

const ORDEM = ['entrada', 'intervalo_inicio', 'intervalo_fim', 'saida'];

// POST { colaboradorId } (x-device-token): marcações de hoje + tipo sugerido.
export async function POST(request) {
  const { sb, disp, erro } = await autenticarDispositivo(request);
  if (erro) return erro;

  const { colaboradorId } = await request.json();
  if (!colaboradorId) return NextResponse.json({ error: 'Informe o colaborador.' }, { status: 400 });

  const inicioDia = new Date();
  inicioDia.setHours(0, 0, 0, 0);

  const { data: marcacoes } = await sb.from('ponto_marcacoes')
    .select('tipo, data_hora_local, nsr')
    .eq('colaborador_id', colaboradorId)
    .gte('data_hora_utc', inicioDia.toISOString())
    .order('data_hora_utc');

  const feitas = (marcacoes || []).map(m => m.tipo);
  // sugestão simples: próximo tipo da sequência ainda não registrado hoje
  const tipoSugerido = ORDEM.find(t => !feitas.includes(t)) || 'saida';

  return NextResponse.json({ tipoSugerido, marcacoesHoje: marcacoes || [] });
}
