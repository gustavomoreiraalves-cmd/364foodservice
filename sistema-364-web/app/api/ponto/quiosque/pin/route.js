import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { autenticarDispositivo, sha256Hex, auditar } from '../../../../../lib/pontoServer';

// POST { matricula, pin } (x-device-token): identifica o colaborador por
// matrícula + PIN de contingência. Retorna o colaborador para seguir no
// fluxo normal de contexto/marcar com metodo='pin'.
//
// Autoatendimento: se o colaborador ainda não tem PIN cadastrado, o PIN
// digitado agora vira o PIN dele (não existe passo prévio de RH pra isso —
// só precisa já estar com matrícula cadastrada e vínculo com a unidade).
// Se já existe PIN, precisa bater com o cadastrado, como antes.
export async function POST(request) {
  const { sb, disp, erro } = await autenticarDispositivo(request);
  if (erro) return erro;

  const { matricula, pin } = await request.json();
  if (!matricula || !pin) return NextResponse.json({ error: 'Informe matrícula e PIN.' }, { status: 400 });
  if (!/^\d{4,6}$/.test(String(pin))) return NextResponse.json({ error: 'O PIN deve ter de 4 a 6 dígitos.' }, { status: 400 });

  const hoje = new Date().toISOString().slice(0, 10);
  const { data: colabs } = await sb.from('colaboradores')
    .select('id, nome, matricula, status, registra_ponto, metodos_permitidos, biometria_status')
    .eq('matricula', String(matricula).trim())
    .eq('status', 'ativo')
    .eq('registra_ponto', true);

  for (const colab of (colabs || [])) {
    const { data: vinculo } = await sb.from('colaborador_unidades')
      .select('id')
      .eq('colaborador_id', colab.id)
      .eq('unidade_id', disp.unidade_id)
      .lte('data_inicio', hoje)
      .or('data_fim.is.null,data_fim.gte.' + hoje)
      .limit(1).maybeSingle();
    if (!vinculo) continue;

    const { data: reg } = await sb.from('ponto_pins').select('pin_hash, salt').eq('colaborador_id', colab.id).maybeSingle();

    if (reg) {
      if (sha256Hex(String(pin) + reg.salt) !== reg.pin_hash) continue; // PIN errado: tenta o próximo candidato
    } else {
      // primeiro acesso por PIN: cadastra na hora
      const salt = crypto.randomBytes(16).toString('hex');
      const { error: eSalvar } = await sb.from('ponto_pins').insert([{
        colaborador_id: colab.id, pin_hash: sha256Hex(String(pin) + salt), salt,
      }]);
      if (eSalvar) continue; // colisão de corrida improvável: trata como falha e segue
      if (!(colab.metodos_permitidos || []).includes('pin')) {
        await sb.from('colaboradores').update({
          metodos_permitidos: [...(colab.metodos_permitidos || []), 'pin'],
        }).eq('id', colab.id);
      }
      await auditar(sb, {
        ator_tipo: 'dispositivo', ator_dispositivo_id: disp.id,
        acao: 'pin_autoregistrado', entidade: 'colaboradores', entidade_id: colab.id,
      });
    }

    return NextResponse.json({
      colaborador: {
        id: colab.id,
        primeiroNome: colab.nome.split(' ')[0],
        biometriaStatus: colab.biometria_status,
      },
    });
  }

  await sb.from('ponto_tentativas').insert([{
    empresa_id: disp.empresa_id,
    unidade_id: disp.unidade_id,
    dispositivo_id: disp.id,
    motivo: 'pin_invalido',
  }]);
  return NextResponse.json({ error: 'Matrícula ou PIN inválidos.' }, { status: 401 });
}
