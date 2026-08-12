import { NextResponse } from 'next/server';
import { autenticarDispositivo, decifrarDescritor } from '../../../../../lib/pontoServer';

// POST (x-device-token): heartbeat + sincroniza descritores dos colaboradores
// autorizados a bater ponto na unidade do dispositivo.
export async function POST(request) {
  const { sb, disp, erro } = await autenticarDispositivo(request);
  if (erro) return erro;

  let versaoApp = null;
  try { versaoApp = (await request.json())?.versaoApp || null; } catch { /* corpo vazio */ }

  await sb.from('ponto_dispositivos').update({
    ultimo_visto_em: new Date().toISOString(),
    ...(versaoApp ? { versao_app: versaoApp } : {}),
  }).eq('id', disp.id);

  const hoje = new Date().toISOString().slice(0, 10);
  const { data: vinculos } = await sb.from('colaborador_unidades')
    .select('colaborador_id')
    .eq('unidade_id', disp.unidade_id)
    .lte('data_inicio', hoje)
    .or('data_fim.is.null,data_fim.gte.' + hoje);

  const ids = [...new Set((vinculos || []).map(v => v.colaborador_id))];
  let colaboradores = [];
  if (ids.length) {
    const { data: colabs } = await sb.from('colaboradores')
      .select('id, nome, empresa_id, empregador_id, metodos_permitidos')
      .in('id', ids)
      .eq('status', 'ativo')
      .eq('registra_ponto', true)
      .eq('biometria_status', 'cadastrada');

    const colabIds = (colabs || []).map(c => c.id);
    let bios = [];
    if (colabIds.length) {
      const { data } = await sb.from('ponto_biometrias')
        .select('colaborador_id, descritor_cifrado')
        .in('colaborador_id', colabIds)
        .eq('ativo', true);
      bios = data || [];
    }

    colaboradores = (colabs || [])
      .filter(c => (c.metodos_permitidos || []).includes('facial'))
      .map(c => ({
        id: c.id,
        primeiroNome: c.nome.split(' ')[0],
        descritores: bios.filter(b => b.colaborador_id === c.id).map(b => {
          try { return decifrarDescritor(b.descritor_cifrado); } catch { return null; }
        }).filter(Boolean),
      }))
      .filter(c => c.descritores.length);
  }

  return NextResponse.json({
    agoraUtcMs: Date.now(),
    unidade: { id: disp.unidade_id },
    colaboradores,
  });
}
