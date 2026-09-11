// app/api/expedicao/[id]/route.js
import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../../lib/pontoServer';
import { garantirExpedicao } from '../../../../lib/autorizacao';

export const runtime = 'nodejs';

export async function PUT(request, { params }) {
  const { sb, user, isAdmin, erro } = await autorizarModulo(request, 'expedicao');
  if (erro) return erro;

  let expedicao;
  try {
    expedicao = await garantirExpedicao(sb, user, isAdmin, params.id, 'id, status, empresa_id');
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 404 });
  }
  if (expedicao.status !== 'rascunho') {
    return NextResponse.json({ error: `Romaneio está "${expedicao.status}" — só um romaneio em rascunho pode ser editado.` }, { status: 400 });
  }

  let corpo;
  try { corpo = await request.json(); } catch { return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 }); }
  const { transportadoraId, modoFrete, veiculoPlaca, veiculoUf, caixas } = corpo;

  const { error: erroCabecalho } = await sb.from('expedicoes').update({
    transportadora_id: transportadoraId || null,
    modo_frete: modoFrete || '0',
    veiculo_placa: veiculoPlaca || null,
    veiculo_uf: veiculoUf || null,
  }).eq('id', expedicao.id);
  if (erroCabecalho) return NextResponse.json({ error: `Falha ao gravar os dados de transporte: ${erroCabecalho.message}` }, { status: 500 });

  // Regravado do zero — mesma disciplina de emitir.js ao regravar
  // nfe_saida_itens: a tela manda o estado inteiro da montagem de caixas a
  // cada salvamento, nunca um diff.
  const { error: erroLimpar } = await sb.from('expedicao_caixas').delete().eq('expedicao_id', expedicao.id);
  if (erroLimpar) return NextResponse.json({ error: `Falha ao limpar as caixas anteriores: ${erroLimpar.message}` }, { status: 500 });

  for (const [indice, caixa] of (caixas || []).entries()) {
    const { data: caixaGravada, error: erroCaixa } = await sb.from('expedicao_caixas').insert([{
      empresa_id: expedicao.empresa_id, expedicao_id: expedicao.id,
      numero: caixa.numero ?? indice + 1, peso_bruto_kg: caixa.pesoBrutoKg || null,
    }]).select('id').single();
    if (erroCaixa) return NextResponse.json({ error: `Falha ao gravar a caixa ${indice + 1}: ${erroCaixa.message}` }, { status: 500 });

    const linhasItens = (caixa.itens || []).map(item => ({
      empresa_id: expedicao.empresa_id, expedicao_caixa_id: caixaGravada.id,
      pedido_item_id: item.pedidoItemId, produto_id: item.produtoId,
      recebimento_item_id: item.recebimentoItemId || null, quantidade: item.quantidade,
    }));
    if (linhasItens.length) {
      const { error: erroItens } = await sb.from('expedicao_itens').insert(linhasItens);
      if (erroItens) return NextResponse.json({ error: `Falha ao gravar os itens da caixa ${indice + 1}: ${erroItens.message}` }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
