import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../../lib/pontoServer';

export const runtime = 'nodejs';

// POST sem corpo: pede uma rodada extra da importação do PDV (botão
// "Atualizar agora" em /vendas/importacao). Só grava o pedido — quem importa
// de verdade é o checador local (scripts/checar-importacao-pdv.mjs, cron a
// cada 15 min), porque o import só roda nessa máquina (precisa docker pro
// Firebird efêmero). Idempotente: um clique em cima de um pedido ainda não
// atendido devolve o mesmo pedido em vez de empilhar outro.
export async function POST(request) {
  const { sb, user, erro } = await autorizarModulo(request, 'pedidos');
  if (erro) return erro;

  const { data: pendente } = await sb.from('pdv_importacao_solicitacoes')
    .select('id, solicitado_em').is('atendido_em', null).order('solicitado_em', { ascending: false }).limit(1).maybeSingle();
  if (pendente) return NextResponse.json({ ok: true, id: pendente.id, jaPendente: true });

  const { data, error } = await sb.from('pdv_importacao_solicitacoes')
    .insert({ solicitado_por: user.id }).select('id, solicitado_em').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, id: data.id, jaPendente: false });
}
