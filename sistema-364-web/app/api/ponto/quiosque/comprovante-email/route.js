import { NextResponse } from 'next/server';
import { autenticarDispositivo, enviarEmail, mascararEmail, auditar } from '../../../../../lib/pontoServer';

const TIPOS_MARCACAO = {
  entrada: 'Entrada',
  intervalo_inicio: 'Início do intervalo',
  intervalo_fim: 'Retorno do intervalo',
  saida: 'Saída',
};

// POST (x-device-token): reenvia por e-mail o comprovante de uma marcação já
// gravada. body: { colaboradorId, nsr }. Reconstrói o comprovante a partir do
// banco (nunca confia em dados vindos do quiosque) e usa o e-mail já
// cadastrado no colaborador — o tablet só decide SE envia, nunca para onde.
export async function POST(request) {
  const { sb, disp, erro } = await autenticarDispositivo(request);
  if (erro) return erro;

  const { colaboradorId, nsr } = await request.json();
  if (!colaboradorId || !nsr) return NextResponse.json({ error: 'Dados incompletos.' }, { status: 400 });

  const { data: colab } = await sb.from('colaboradores')
    .select('id, nome, email, empresa_id').eq('id', colaboradorId).maybeSingle();
  if (!colab || colab.empresa_id !== disp.empresa_id) {
    return NextResponse.json({ error: 'Colaborador não encontrado.' }, { status: 404 });
  }
  if (!colab.email) return NextResponse.json({ error: 'Colaborador sem e-mail cadastrado.' }, { status: 400 });

  const { data: marcacao } = await sb.from('ponto_marcacoes')
    .select('nsr, tipo, data_hora_local, record_hash, unidades(nome)')
    .eq('colaborador_id', colaboradorId).eq('nsr', nsr).maybeSingle();
  if (!marcacao) return NextResponse.json({ error: 'Marcação não encontrada.' }, { status: 404 });

  const dataHora = new Date(marcacao.data_hora_local).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'medium' });
  const tipoLabel = TIPOS_MARCACAO[marcacao.tipo] || marcacao.tipo;
  const hashPrefixo = (marcacao.record_hash || '').slice(0, 12);

  try {
    await enviarEmail({
      to: colab.email,
      assunto: `Comprovante de ponto — ${tipoLabel}`,
      html: `
        <p>Olá, ${colab.nome.split(' ')[0]}!</p>
        <p>Registro de ponto confirmado:</p>
        <table cellpadding="6" style="border-collapse:collapse">
          <tr><td><b>Tipo</b></td><td>${tipoLabel}</td></tr>
          <tr><td><b>Data/hora</b></td><td>${dataHora}</td></tr>
          <tr><td><b>Unidade</b></td><td>${marcacao.unidades?.nome || '—'}</td></tr>
          <tr><td><b>NSR</b></td><td>${marcacao.nsr}</td></tr>
          <tr><td><b>Hash</b></td><td>${hashPrefixo}</td></tr>
        </table>
        <p style="color:#888;font-size:12px">Grupo 364 — registro eletrônico de ponto (Portaria MTP 671/2021).</p>
      `,
    });
  } catch (err) {
    return NextResponse.json({ error: 'Falha ao enviar e-mail: ' + err.message }, { status: 502 });
  }

  await auditar(sb, {
    ator_tipo: 'dispositivo',
    ator_dispositivo_id: disp.id,
    acao: 'comprovante_email_enviado',
    entidade: 'ponto_marcacoes',
    entidade_id: String(marcacao.nsr),
  });

  return NextResponse.json({ ok: true, emailMascarado: mascararEmail(colab.email) });
}
