import { NextResponse } from 'next/server';
import { autenticarDispositivo, cifrarDescritor, mascararEmail } from '../../../../../lib/pontoServer';

const TIPOS = ['entrada', 'intervalo_inicio', 'intervalo_fim', 'saida'];

async function registrarTentativa(sb, disp, motivo, extras = {}) {
  await sb.from('ponto_tentativas').insert([{
    empresa_id: disp.empresa_id,
    unidade_id: disp.unidade_id,
    dispositivo_id: disp.id,
    motivo,
    ...extras,
  }]);
}

// POST (x-device-token): grava a marcação original via registrar_marcacao (RPC).
export async function POST(request) {
  const { sb, disp, erro } = await autenticarDispositivo(request);
  if (erro) return erro;

  const body = await request.json();
  const {
    idempotencia, colaboradorId, tipo, metodo = 'facial',
    score, livenessOk, livenessDetalhe, descritorCapturado,
    capturadoEmCliente, offsetRelogioMs,
  } = body;

  if (!idempotencia || !colaboradorId || !TIPOS.includes(tipo)) {
    return NextResponse.json({ error: 'Dados da marcação incompletos.' }, { status: 400 });
  }

  // valida colaborador de novo no servidor (não confia no quiosque)
  const { data: colab } = await sb.from('colaboradores')
    .select('id, nome, email, empresa_id, empregador_id, unidade_principal_id, status, registra_ponto, biometria_status, metodos_permitidos')
    .eq('id', colaboradorId).maybeSingle();
  if (!colab || colab.status !== 'ativo' || !colab.registra_ponto) {
    await registrarTentativa(sb, disp, 'colaborador_bloqueado', { colaborador_proximo_id: colaboradorId });
    return NextResponse.json({ error: 'Colaborador não autorizado a registrar ponto.' }, { status: 403 });
  }
  if (metodo === 'facial' && colab.biometria_status !== 'cadastrada') {
    await registrarTentativa(sb, disp, 'colaborador_bloqueado', { colaborador_proximo_id: colaboradorId });
    return NextResponse.json({ error: 'Biometria não cadastrada ou bloqueada.' }, { status: 403 });
  }
  if (!(colab.metodos_permitidos || []).includes(metodo)) {
    await registrarTentativa(sb, disp, 'colaborador_bloqueado', { colaborador_proximo_id: colaboradorId });
    return NextResponse.json({ error: 'Método de registro não permitido para este colaborador.' }, { status: 403 });
  }

  // o dispositivo reconhece qualquer colaborador da empresa (não só os da sua
  // unidade física) e credita a marcação na unidade principal do colaborador
  if (colab.empresa_id !== disp.empresa_id) {
    await registrarTentativa(sb, disp, 'fora_da_unidade', { colaborador_proximo_id: colaboradorId });
    return NextResponse.json({ error: 'Colaborador não pertence a esta empresa.' }, { status: 403 });
  }
  if (!colab.unidade_principal_id) {
    await registrarTentativa(sb, disp, 'fora_da_unidade', { colaborador_proximo_id: colaboradorId });
    return NextResponse.json({ error: 'Colaborador sem unidade principal cadastrada — ajuste em Colaboradores.' }, { status: 403 });
  }

  if (metodo === 'facial' && livenessOk === false) {
    await registrarTentativa(sb, disp, 'liveness_falhou', { colaborador_proximo_id: colaboradorId, melhor_score: score ?? null });
    return NextResponse.json({ error: 'Prova de vida não aprovada.' }, { status: 403 });
  }

  const { data: unidade } = await sb.from('unidades').select('fuso, nome').eq('id', colab.unidade_principal_id).single();

  let descritorCifrado = null;
  if (Array.isArray(descritorCapturado) && descritorCapturado.length === 128) {
    try { descritorCifrado = cifrarDescritor(descritorCapturado); } catch { descritorCifrado = null; }
  }

  const { data: marcacao, error } = await sb.rpc('registrar_marcacao', {
    p_idempotencia: idempotencia,
    p_empregador_id: colab.empregador_id,
    p_empresa_id: colab.empresa_id,
    p_unidade_id: colab.unidade_principal_id,
    p_colaborador_id: colab.id,
    p_dispositivo_id: disp.id,
    p_tipo: tipo,
    p_metodo: metodo,
    p_score: score ?? null,
    p_liveness_ok: livenessOk ?? null,
    p_liveness_detalhe: livenessDetalhe ?? null,
    p_descritor_cifrado: descritorCifrado,
    p_fuso: unidade?.fuso || 'America/Sao_Paulo',
    p_capturado_em_cliente: capturadoEmCliente || null,
    p_offset_relogio_ms: offsetRelogioMs ?? null,
    p_origem: 'quiosque',
    p_motivo_manual: null,
    p_registrado_por: null,
  });
  if (error) return NextResponse.json({ error: 'Falha ao gravar a marcação: ' + error.message }, { status: 500 });

  const m = Array.isArray(marcacao) ? marcacao[0] : marcacao;
  return NextResponse.json({
    comprovante: {
      nsr: m.nsr,
      tipo: m.tipo,
      dataHoraLocal: m.data_hora_local,
      hashPrefixo: (m.record_hash || '').slice(0, 12),
      unidade: unidade?.nome || null,
      primeiroNome: colab.nome.split(' ')[0],
      colaboradorId: colab.id,
      temEmail: !!colab.email,
      emailMascarado: colab.email ? mascararEmail(colab.email) : null,
    },
  });
}
