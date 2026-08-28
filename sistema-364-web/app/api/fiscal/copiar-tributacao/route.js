import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../../lib/pontoServer';
import { garantirProduto } from '../../../../lib/autorizacao';
import { camposCopiaFiscal, CAMPOS_COPIA_FISCAL } from '../../../../lib/fiscal';
import { avaliarDestino } from '../../../../lib/fiscalCopia';

export const runtime = 'nodejs';

// POST body: { origemId, destinoIds: [], liberar: boolean }
//
// Copia a configuração fiscal de um produto para outros, um a um. Não é
// transação única sobre todos os destinos: um destino que falhe não desfaz os
// que deram certo, e o retorno diz o que aconteceu com cada um. A operação é
// idempotente — reaplicar a mesma cópia dá o mesmo resultado — e um lote de dez
// produtos parando inteiro por causa de um é pior do que nove entrarem.
export async function POST(request) {
  const { sb, user, isAdmin, erro } = await autorizarModulo(request, 'fiscal');
  if (erro) return erro;

  let corpo;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 });
  }
  const { origemId, destinoIds, liberar } = corpo;
  if (!origemId || !Array.isArray(destinoIds) || destinoIds.length === 0) {
    return NextResponse.json({ error: 'Informe origemId e ao menos um destino.' }, { status: 400 });
  }

  // garantirProduto valida a forma do id e o acesso à empresa antes de tocar
  // qualquer dado útil, e devolve a mesma recusa para "não existe" e "existe em
  // outra empresa" — diferenciar as duas viraria oráculo de enumeração.
  let origem;
  try {
    origem = await garantirProduto(sb, user, isAdmin, origemId,
      `id, nome, codigo, empresa_id, ${CAMPOS_COPIA_FISCAL.join(', ')}`);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 404 });
  }

  const payload = camposCopiaFiscal(origem);
  const resultados = [];

  for (const destinoId of destinoIds) {
    let destino;
    try {
      destino = await garantirProduto(sb, user, isAdmin, destinoId,
        'id, nome, codigo, empresa_id, unidade, gtin, gtin_tributavel, sujeito_st, ativo_fiscal');
    } catch (e) {
      resultados.push({ produtoId: destinoId, copiado: false, liberado: false, erro: e.message });
      continue;
    }

    // A checagem de marca é separada da de acesso e vem depois dela: um usuário
    // pode alcançar as duas empresas do grupo e ainda assim não poder levar
    // configuração fiscal de uma para a outra.
    const avaliacao = avaliarDestino({ origem, destino, payload, liberar });
    if (!avaliacao.ok) {
      resultados.push({
        produtoId: destinoId, nome: destino.nome, copiado: false, liberado: false, erro: avaliacao.erro,
      });
      continue;
    }

    const { error } = await sb.from('produtos').update(avaliacao.gravar).eq('id', destinoId);
    if (error) {
      resultados.push({
        produtoId: destinoId, nome: destino.nome, copiado: false, liberado: false, erro: error.message,
      });
      continue;
    }
    resultados.push({
      produtoId: destinoId, nome: destino.nome, copiado: true,
      liberado: avaliacao.liberado, pendencias: avaliacao.pendencias,
    });
  }

  // Auditoria por inserção direta, não pela RPC fn_registrar_auditoria: ela
  // preenche usuario_id com auth.uid(), sempre nulo no client service-role que
  // as rotas usam — auditar por ela daqui grava linha órfã.
  await sb.from('audit_logs').insert([{
    empresa_id: origem.empresa_id,
    usuario_id: user.id,
    acao: 'copiar_tributacao',
    recurso: 'produtos',
    recurso_id: origem.id,
    valores_novos: {
      origem: origem.codigo || origem.id,
      campos: payload,
      liberacaoPedida: Boolean(liberar),
      destinos: resultados.map(r => ({
        id: r.produtoId, copiado: r.copiado, liberado: r.liberado, erro: r.erro || null,
      })),
    },
  }]);

  return NextResponse.json({ resultados });
}
