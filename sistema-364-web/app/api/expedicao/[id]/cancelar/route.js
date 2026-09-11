// app/api/expedicao/[id]/cancelar/route.js
import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../../../lib/pontoServer';
import { garantirExpedicao } from '../../../../../lib/autorizacao';

export const runtime = 'nodejs';

export async function POST(request, { params }) {
  const { sb, user, isAdmin, erro } = await autorizarModulo(request, 'expedicao');
  if (erro) return erro;

  let expedicao;
  try {
    expedicao = await garantirExpedicao(sb, user, isAdmin, params.id, 'id, pedido_id, status');
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 404 });
  }
  if (expedicao.status !== 'rascunho') {
    return NextResponse.json({ error: `Romaneio está "${expedicao.status}" — só um romaneio em rascunho pode ser cancelado por aqui.` }, { status: 400 });
  }

  const { error: erroCancelar } = await sb.from('expedicoes').update({ status: 'cancelado' }).eq('id', expedicao.id);
  if (erroCancelar) return NextResponse.json({ error: `Falha ao cancelar o romaneio: ${erroCancelar.message}` }, { status: 500 });

  const { error: erroStatusPedido } = await sb.from('pedidos').update({ status: 'Pendente' }).eq('id', expedicao.pedido_id);
  if (erroStatusPedido) return NextResponse.json({ error: `Romaneio cancelado, mas falhou ao devolver o pedido para Pendente: ${erroStatusPedido.message}` }, { status: 500 });

  return NextResponse.json({ ok: true });
}
