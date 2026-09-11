// app/api/expedicao/[id]/finalizar/route.js
import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../../../lib/pontoServer';
import { garantirExpedicao, exigirUuid } from '../../../../../lib/autorizacao';
import { calcularDivergencia } from '../../../../../lib/expedicao';
import { emitirNfe } from '../../../../../lib/nfe/emitir';

export const runtime = 'nodejs';
export const maxDuration = 60;

// POST body: { naturezaOperacaoId }
export async function POST(request, { params }) {
  const { sb, user, isAdmin, erro } = await autorizarModulo(request, 'expedicao');
  if (erro) return erro;

  let expedicao;
  try {
    expedicao = await garantirExpedicao(sb, user, isAdmin, params.id,
      'id, pedido_id, status, empresa_id, modo_frete, veiculo_placa, veiculo_uf, transportadora_id');
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 404 });
  }
  if (expedicao.status !== 'rascunho') {
    return NextResponse.json({ error: `Romaneio está "${expedicao.status}" — só um romaneio em rascunho pode ser finalizado.` }, { status: 400 });
  }

  let corpo;
  try { corpo = await request.json(); } catch { return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 }); }
  try { exigirUuid(corpo.naturezaOperacaoId, 'Natureza da operação'); } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }

  const [
    { data: pedidoItens, error: erroItens },
    { data: caixas, error: erroCaixas },
    { data: transportadora, error: erroTransportadora },
    { data: pedido, error: erroPedido },
  ] = await Promise.all([
    sb.from('pedido_itens').select('id, quantidade').eq('pedido_id', expedicao.pedido_id),
    sb.from('expedicao_caixas').select('*, expedicao_itens(*)').eq('expedicao_id', expedicao.id),
    expedicao.transportadora_id
      ? sb.from('transportadoras').select('*').eq('id', expedicao.transportadora_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    sb.from('pedidos').select('id, empresa_id, cliente_id, status, observacoes').eq('id', expedicao.pedido_id).maybeSingle(),
  ]);
  if (erroItens || erroCaixas || erroTransportadora || erroPedido) {
    return NextResponse.json({ error: 'Falha ao carregar os dados do romaneio para finalizar.' }, { status: 500 });
  }

  const alocacao = (caixas || []).flatMap(c => (c.expedicao_itens || [])
    .map(i => ({ pedidoItemId: i.pedido_item_id, quantidade: i.quantidade })));
  const divergencias = calcularDivergencia(pedidoItens, alocacao);
  if (divergencias.length) {
    return NextResponse.json({
      error: 'O romaneio não cobre exatamente o pedido — ajuste as caixas ou o pedido antes de finalizar.',
      divergencias,
    }, { status: 400 });
  }

  const { error: erroFinalizar } = await sb.from('expedicoes').update({ status: 'finalizado' }).eq('id', expedicao.id);
  if (erroFinalizar) return NextResponse.json({ error: `Falha ao finalizar o romaneio: ${erroFinalizar.message}` }, { status: 500 });

  const { error: erroConferido } = await sb.from('pedidos').update({ status: 'Conferido' }).eq('id', expedicao.pedido_id);
  if (erroConferido) {
    return NextResponse.json({ error: `Romaneio finalizado, mas falhou ao avançar o pedido para Conferido: ${erroConferido.message}` }, { status: 500 });
  }

  const expedicaoParaEmitir = {
    modo_frete: expedicao.modo_frete, transportadora, veiculo_placa: expedicao.veiculo_placa, veiculo_uf: expedicao.veiculo_uf,
    caixas: (caixas || []).map(c => ({
      peso_bruto_kg: c.peso_bruto_kg,
      itens: (c.expedicao_itens || []).map(i => ({ pedido_item_id: i.pedido_item_id, quantidade: i.quantidade })),
    })),
  };

  try {
    const resultado = await emitirNfe({ sb, pedido: { ...pedido, status: 'Conferido' }, expedicao: expedicaoParaEmitir, naturezaOperacaoId: corpo.naturezaOperacaoId, userId: user.id });
    return NextResponse.json(resultado);
  } catch (e) {
    // Falha da emissão nunca desfaz o romaneio finalizado (regra 13 do spec
    // de 25/08) — o pedido fica em Conferido, e "Tentar emitir novamente"
    // (Task 12, rota /api/fiscal/emitir-nfe) é o caminho de recuperação.
    const corpoErro = { error: e.message };
    if (e.codigo) corpoErro.codigo = e.codigo;
    return NextResponse.json(corpoErro, { status: e.status || 400 });
  }
}
