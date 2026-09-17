import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../../lib/pontoServer';
import { garantirPedido, exigirUuid } from '../../../../lib/autorizacao';
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

  // garantirPedido (lib/autorizacao.js) já centraliza "carregar a linha para
  // descobrir a empresa, então autorizar" — o mesmo padrão que
  // garantirColaborador/garantirUnidade usam para outras tabelas. Ele também
  // já troca 403 por 404: "sem acesso à empresa deste pedido" viraria um
  // oráculo aqui, confirmando que o pedidoId existe (só que em empresa de
  // outro dono) para quem não tem acesso — a mesma classe de bug que a
  // revisão de segurança de 24/08 fechou para outras rotas. E valida a forma
  // do id antes de tocar o banco.
  let pedido;
  try {
    pedido = await garantirPedido(sb, user, isAdmin, pedidoId);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 404 });
  }

  // Achado da revisão: sem isto, um naturezaOperacaoId malformado só falhava
  // lá dentro de emitirNfe como um 500 cru do Postgrest, em vez de um 400
  // explicando o que está errado. exigirUuid é a mesma checagem que
  // garantirPedido acabou de aplicar ao pedidoId.
  try {
    exigirUuid(naturezaOperacaoId, 'Natureza da operação');
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }

  // Esta rota deixou de ser o caminho principal de emissão (Task 23 remove o
  // botão "Emitir NF-e" solto da tela de pedido) — agora é só a retentativa
  // manual quando a emissão automática (Task 16, disparada ao finalizar o
  // romaneio) falhou. Por isso a expedição não vem no corpo da requisição:
  // ela é buscada aqui, direto pelo pedido_id, sempre a mais recente
  // finalizada. Só se busca pelo id do pedido (não por garantirExpedicao, que
  // exige o id da própria expedição — não temos esse id aqui).
  const { data: expedicaoRow, error: erroExpedicao } = await sb.from('expedicoes')
    .select('*, transportadora:fornecedores(*), expedicao_caixas(*, expedicao_itens(*))')
    .eq('pedido_id', pedido.id).eq('status', 'finalizado')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (erroExpedicao) {
    return NextResponse.json({ error: `Falha ao carregar o romaneio: ${erroExpedicao.message}` }, { status: 500 });
  }
  if (!expedicaoRow) {
    return NextResponse.json(
      { error: 'Pedido sem romaneio finalizado — finalize o romaneio antes de emitir.' },
      { status: 400 },
    );
  }

  // Mesma forma que emitirNfe (lib/nfe/emitir.js, Task 11) e
  // resolverNota/calcularVolumesNfe exigem: `caixas` sempre array (mesmo
  // vazio), cada item com `pedido_item_id`/`quantidade` (nomes de coluna
  // crus, lidos por quantidadesAlocadasPorItem), `transportadora` como a
  // linha crua de fornecedores com is_transportador (cnpj/nome/ie/logradouro/
  // municipio/uf — resolverTransporte lê esses nomes diretamente, não um
  // formato NFe; atualização 58 moveu transportadora pra dentro de fornecedores).
  const expedicao = {
    modo_frete: expedicaoRow.modo_frete,
    transportadora: expedicaoRow.transportadora,
    veiculo_placa: expedicaoRow.veiculo_placa,
    veiculo_uf: expedicaoRow.veiculo_uf,
    caixas: (expedicaoRow.expedicao_caixas || []).map(c => ({
      peso_bruto_kg: c.peso_bruto_kg,
      itens: (c.expedicao_itens || []).map(i => ({ pedido_item_id: i.pedido_item_id, quantidade: i.quantidade })),
    })),
  };

  try {
    const resultado = await emitirNfe({ sb, pedido, expedicao, naturezaOperacaoId, userId: user.id });
    return NextResponse.json(resultado);
  } catch (e) {
    // e.status vem de lib/nfe/emitir.js (erro() local): 400 para dado de
    // cadastro/negócio faltando, 409 para nota já autorizada, 500 para falha
    // de banco/certificado, 502 para falha de comunicação com a SEFAZ.
    //
    // Achado da revisão (fix round 1, Importante): e.codigo (quando presente)
    // é o mesmo sinal estruturado que os dois throws de "resultado
    // indeterminado" de emitir.js agora carregam — propagado aqui em vez de
    // deixar quem chama adivinhar pelo texto de `error`. Ausente na maioria
    // dos erros; `codigo` simplesmente não aparece no JSON nesse caso.
    const corpo = { error: e.message };
    if (e.codigo) corpo.codigo = e.codigo;
    return NextResponse.json(corpo, { status: e.status || 400 });
  }
}
