// app/api/expedicao/[id]/finalizar/route.js
import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../../../lib/pontoServer';
import { garantirExpedicao, exigirUuid } from '../../../../../lib/autorizacao';
import { calcularDivergencia, loteAcimaDoSaldo } from '../../../../../lib/expedicao';
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
    sb.from('pedidos').select('id, empresa_id, cliente_id, status, observacoes, condicao_pagamento_id').eq('id', expedicao.pedido_id).maybeSingle(),
  ]);
  if (erroItens || erroCaixas || erroTransportadora || erroPedido) {
    return NextResponse.json({ error: 'Falha ao carregar os dados do romaneio para finalizar.' }, { status: 500 });
  }

  // Achado da revisão (Importante I2): migration 50 só aceita a transição
  // Separação→Conferido — se o pedido estiver em qualquer outro status (uma
  // limpeza compensatória que ficou pela metade, uma edição manual no banco),
  // o UPDATE de `pedidos` logo abaixo seria recusado pelo trigger DEPOIS que
  // `expedicoes` já tivesse virado 'finalizado', deixando um estado sem
  // saída (cancelar só aceita rascunho; o índice único trava um romaneio
  // substituto). Checagem barata, com dado que já foi carregado, ANTES de
  // qualquer escrita.
  if (pedido.status !== 'Separação') {
    return NextResponse.json({ error: `Pedido está "${pedido.status}" — só é possível finalizar o romaneio de um pedido em Separação.` }, { status: 400 });
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

  // Achado Importante da revisão final de 16/09: a seção "Alocação por
  // produto" deixa o operador digitar qualquer quantidade contra qualquer
  // lote, sem checar o saldo real — só sugerirAlocacao (a sugestão inicial)
  // respeitava min(saldo, restante). Confere aqui, com o saldo mais recente
  // de vw_estoque_produto_lote, ANTES de qualquer escrita (mesmo lugar da
  // checagem de divergência acima).
  const paresAlocados = [...new Map(
    (caixas || []).flatMap(c => (c.expedicao_itens || [])
      .filter(i => i.embalagem_id)
      .map(i => [`${i.produto_id}::${i.embalagem_id}`, { produtoId: i.produto_id, embalagemId: i.embalagem_id }]))
  ).values()];
  if (paresAlocados.length) {
    const { data: saldos, error: erroSaldos } = await sb.from('vw_estoque_produto_lote')
      .select('produto_id, embalagem_id, saldo')
      .eq('empresa_id', expedicao.empresa_id)
      .in('embalagem_id', paresAlocados.map(p => p.embalagemId));
    if (erroSaldos) {
      return NextResponse.json({ error: `Falha ao conferir o saldo dos lotes: ${erroSaldos.message}` }, { status: 500 });
    }
    const lotesAcimaDoSaldo = loteAcimaDoSaldo(paresAlocados, saldos || []);
    if (lotesAcimaDoSaldo.length) {
      return NextResponse.json({
        error: 'A alocação de um ou mais lotes passou do saldo disponível — ajuste a quantidade ou o lote na seção "Alocação por produto" antes de finalizar.',
        lotesAcimaDoSaldo,
      }, { status: 400 });
    }
  }

  // Achado da revisão (Importante I1): um `update` comum não é
  // compare-and-swap — duas requisições concorrentes para o mesmo romaneio
  // (duplo clique, retry por timeout) leriam `status === 'rascunho'` antes
  // de qualquer uma escrever, as duas marcariam 'finalizado', as duas
  // avançariam o pedido e as duas chamariam emitirNfe — cuja checagem de
  // duplicidade olha para `nfe_saida_documentos`, vazio para as duas no
  // instante em que checam. Resultado: duas notas autorizadas para o mesmo
  // pedido, exatamente o que o cabeçalho de lib/nfe/emitir.js diz que este
  // pipeline existe para evitar. O `.eq('status', 'rascunho')` na cláusula
  // WHERE faz da própria escrita o lock: o bloqueio de linha do Postgres
  // serializa as duas tentativas, só uma dá match e atualiza, a perdedora
  // recebe zero linhas de volta e para aqui, em 409, antes de chegar em
  // emitirNfe.
  const { data: fechadas, error: erroFinalizar } = await sb.from('expedicoes')
    .update({ status: 'finalizado' })
    .eq('id', expedicao.id)
    .eq('status', 'rascunho')
    .select('id');
  if (erroFinalizar) return NextResponse.json({ error: `Falha ao finalizar o romaneio: ${erroFinalizar.message}` }, { status: 500 });
  if (!fechadas?.length) {
    return NextResponse.json({ error: 'Este romaneio já foi finalizado ou cancelado por outra requisição.' }, { status: 409 });
  }

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
