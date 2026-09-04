import { NextResponse } from 'next/server';
import { autenticarDispositivo, decifrarDescritor } from '../../../../../lib/pontoServer';

// POST (x-device-token): heartbeat + sincroniza descritores de todos os
// colaboradores da empresa (o dispositivo reconhece qualquer um deles, não
// só os da sua unidade física — cada marcação é creditada na unidade
// principal do próprio colaborador, ver /quiosque/marcar).
export async function POST(request) {
  const { sb, disp, erro } = await autenticarDispositivo(request);
  if (erro) return erro;

  let versaoApp = null;
  try { versaoApp = (await request.json())?.versaoApp || null; } catch { /* corpo vazio */ }

  await sb.from('ponto_dispositivos').update({
    ultimo_visto_em: new Date().toISOString(),
    ...(versaoApp ? { versao_app: versaoApp } : {}),
  }).eq('id', disp.id);

  const { data: colabs } = await sb.from('colaboradores')
    .select('id, nome, empresa_id, empregador_id, metodos_permitidos')
    .eq('empresa_id', disp.empresa_id)
    .eq('status', 'ativo')
    .eq('registra_ponto', true)
    .eq('biometria_status', 'cadastrada')
    .not('unidade_principal_id', 'is', null);

  const colabIds = (colabs || []).map(c => c.id);
  let bios = [];
  if (colabIds.length) {
    const { data } = await sb.from('ponto_biometrias')
      .select('colaborador_id, descritor_cifrado')
      .in('colaborador_id', colabIds)
      .eq('ativo', true);
    bios = data || [];
  }

  const colaboradores = (colabs || [])
    .filter(c => (c.metodos_permitidos || []).includes('facial'))
    .map(c => ({
      id: c.id,
      primeiroNome: c.nome.split(' ')[0],
      descritores: bios.filter(b => b.colaborador_id === c.id).map(b => {
        try { return decifrarDescritor(b.descritor_cifrado); } catch { return null; }
      }).filter(Boolean),
    }))
    .filter(c => c.descritores.length);

  return NextResponse.json({
    agoraUtcMs: Date.now(),
    unidade: { id: disp.unidade_id },
    colaboradores,
  });
}
