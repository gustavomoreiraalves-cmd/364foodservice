import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { autorizarModulo, auditar } from '../../../../../lib/pontoServer';
import { garantirColaborador, garantirUnidade } from '../../../../../lib/autorizacao';

const TIPOS = ['entrada', 'intervalo_inicio', 'intervalo_fim', 'saida'];

// POST (gestor/RH logado): marcação assistida de contingência.
// body: { colaboradorId, unidadeId, tipo, motivo }
export async function POST(request) {
  const { sb, user, isAdmin, erro } = await autorizarModulo(request, 'ponto');
  if (erro) return erro;

  const { colaboradorId, unidadeId, tipo, motivo } = await request.json();
  if (!colaboradorId || !unidadeId || !TIPOS.includes(tipo)) {
    return NextResponse.json({ error: 'Informe colaborador, unidade e tipo.' }, { status: 400 });
  }
  if (!motivo || motivo.trim().length < 5) {
    return NextResponse.json({ error: 'O motivo é obrigatório na marcação manual.' }, { status: 400 });
  }

  // Colaborador e unidade precisam ser de uma empresa que o gestor alcança:
  // esta rota grava marcação de ponto, que é documento trabalhista.
  let colab, unidade;
  try {
    colab = await garantirColaborador(sb, user, isAdmin, colaboradorId,
      'id, nome, empresa_id, empregador_id, status, registra_ponto');
    unidade = await garantirUnidade(sb, user, isAdmin, unidadeId, 'id, fuso, empresa_id');
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 403 });
  }
  if (colab.status !== 'ativo' || !colab.registra_ponto) {
    return NextResponse.json({ error: 'Colaborador não autorizado a registrar ponto.' }, { status: 403 });
  }
  // Marcar na unidade de outra empresa embaralharia a apuração das duas.
  if (unidade.empresa_id !== colab.empresa_id) {
    return NextResponse.json({ error: 'A unidade não pertence à empresa do colaborador.' }, { status: 400 });
  }

  const { data: marcacao, error } = await sb.rpc('registrar_marcacao', {
    p_idempotencia: crypto.randomUUID(),
    p_empregador_id: colab.empregador_id,
    p_empresa_id: colab.empresa_id,
    p_unidade_id: unidade.id,
    p_colaborador_id: colab.id,
    p_dispositivo_id: null,
    p_tipo: tipo,
    p_metodo: 'manual_gestor',
    p_score: null,
    p_liveness_ok: null,
    p_liveness_detalhe: null,
    p_descritor_cifrado: null,
    p_fuso: unidade.fuso || 'America/Sao_Paulo',
    p_capturado_em_cliente: null,
    p_offset_relogio_ms: null,
    p_origem: 'web_gestor',
    p_motivo_manual: motivo.trim(),
    p_registrado_por: user.id,
  });
  if (error) return NextResponse.json({ error: 'Falha ao gravar: ' + error.message }, { status: 500 });

  const m = Array.isArray(marcacao) ? marcacao[0] : marcacao;
  await auditar(sb, { ator_user_id: user.id, ator_tipo: 'usuario', acao: 'marcacao_manual', entidade: 'ponto_marcacoes', entidade_id: m.id, motivo: motivo.trim() });

  return NextResponse.json({ nsr: m.nsr, dataHoraLocal: m.data_hora_local, tipo: m.tipo });
}
