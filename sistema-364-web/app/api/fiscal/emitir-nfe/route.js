import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../../lib/pontoServer';
import { garantirEmpresa } from '../../../../lib/autorizacao';
import { emitirNfe } from '../../../../lib/nfe/emitir';

export const runtime = 'nodejs';
// Teto de PLATAFORMA, mesmo idioma de app/api/fiscal/testar-conexao/route.js:
// esta rota é mais lenta que aquela (resolve tributos item a item, assina e
// transmite à SEFAZ), por isso o teto sobe de 30 para 60.
export const maxDuration = 60;

// POST body: { pedidoId, naturezaOperacaoId }
export async function POST(request) {
  const { sb, user, isAdmin, erro } = await autorizarModulo(request, 'fiscal');
  if (erro) return erro;

  let corpo;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 });
  }
  const { pedidoId, naturezaOperacaoId } = corpo;
  if (!pedidoId || !naturezaOperacaoId) {
    return NextResponse.json({ error: 'Informe pedidoId e naturezaOperacaoId.' }, { status: 400 });
  }

  // O corpo só traz pedidoId, sem empresaId — a empresa do pedido só se
  // conhece lendo o pedido. Por isso a única leitura antes de garantirEmpresa
  // é esta, e ela busca só o suficiente para descobrir a empresa; nenhum dado
  // de negócio (cliente, itens, valores) é lido antes da autorização.
  const { data: pedido, error: erroPedido } = await sb.from('pedidos')
    .select('id, empresa_id, cliente_id, observacoes, status')
    .eq('id', pedidoId).maybeSingle();
  if (erroPedido) return NextResponse.json({ error: `Falha ao carregar o pedido: ${erroPedido.message}` }, { status: 500 });
  if (!pedido) return NextResponse.json({ error: 'Pedido não encontrado.' }, { status: 404 });

  try {
    await garantirEmpresa(sb, user, isAdmin, pedido.empresa_id);
  } catch (e) {
    // "Sem acesso a esta empresa" (403) viraria um oráculo aqui: confirmaria
    // que o pedidoId existe (só que em empresa de outro dono) para quem não
    // tem acesso a ele. A mesma classe de bug que a revisão de segurança de
    // 24/08 fechou para outras rotas — devolve a mesma mensagem genérica de
    // "não encontrado" que um pedidoId inexistente já recebeu acima.
    if (e.status === 403) return NextResponse.json({ error: 'Pedido não encontrado.' }, { status: 404 });
    return NextResponse.json({ error: e.message }, { status: e.status || 403 });
  }

  try {
    const resultado = await emitirNfe({ sb, pedido, naturezaOperacaoId, userId: user.id });
    return NextResponse.json(resultado);
  } catch (e) {
    // e.status vem de lib/nfe/emitir.js (erro() local): 400 para dado de
    // cadastro/negócio faltando, 409 para nota já autorizada, 500 para falha
    // de banco/certificado, 502 para falha de comunicação com a SEFAZ.
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
}
