// app/api/expedicao/route.js
import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../lib/pontoServer';
import { garantirPedido } from '../../../lib/autorizacao';
import { proximoNumeroExpedicao } from '../../../lib/expedicao';

export const runtime = 'nodejs';

// POST body: { pedidoId }
export async function POST(request) {
  const { sb, user, isAdmin, erro } = await autorizarModulo(request, 'expedicao');
  if (erro) return erro;

  let corpo;
  try { corpo = await request.json(); } catch { return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 }); }
  const { pedidoId } = corpo;
  if (!pedidoId) return NextResponse.json({ error: 'Informe pedidoId.' }, { status: 400 });

  let pedido;
  try {
    pedido = await garantirPedido(sb, user, isAdmin, pedidoId, 'id, empresa_id, status, data');
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 404 });
  }
  if (pedido.status !== 'Pendente') {
    return NextResponse.json({ error: `Pedido está "${pedido.status}" — só um pedido Pendente pode iniciar romaneio.` }, { status: 400 });
  }

  const numero = await proximoNumeroExpedicao(pedido.data, pedido.empresa_id, sb);
  const { data: expedicao, error: erroExpedicao } = await sb.from('expedicoes').insert([{
    empresa_id: pedido.empresa_id, pedido_id: pedido.id, numero, responsavel_id: null,
  }]).select('*').single();
  if (erroExpedicao) return NextResponse.json({ error: `Falha ao criar o romaneio: ${erroExpedicao.message}` }, { status: 500 });

  // A expedição em rascunho já existe quando este UPDATE roda — é a ordem
  // que fn_pedido_bloquear_cabecalho (atualização 50) exige pra aceitar a
  // transição Pendente→Separação.
  const { error: erroStatus } = await sb.from('pedidos').update({ status: 'Separação' }).eq('id', pedido.id);
  if (erroStatus) {
    await sb.from('expedicoes').delete().eq('id', expedicao.id);
    return NextResponse.json({ error: `Falha ao avançar o pedido para Separação: ${erroStatus.message}` }, { status: 500 });
  }

  return NextResponse.json({ expedicaoId: expedicao.id, numero });
}
