import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../../lib/pontoServer';
import { garantirEmpresa } from '../../../../lib/nfe/autorizacao';
import { inferirFormaPagamento } from '../../../../lib/extratos/matching';

export const runtime = 'nodejs';

// Carrega o lançamento e confere que quem chama tem acesso à empresa dele.
// Service role passa por cima do RLS, então esta conferência é a única que
// existe — sem ela, um id de outra empresa seria conciliado sem barreira.
async function carregarLancamento(sb, user, isAdmin, lancamentoId) {
  if (!lancamentoId) throw new Error('Informe o lançamento.');
  const { data: lanc } = await sb.from('extrato_lancamentos')
    .select('id, empresa_id, descricao, importacao_id, parcela_sugerida_id, valor, '
      + 'padrao_id, extrato_importacoes!inner(tipo)')
    .eq('id', lancamentoId).maybeSingle();
  if (!lanc) throw new Error('Lançamento não encontrado.');
  await garantirEmpresa(sb, user, isAdmin, lanc.empresa_id);
  return lanc;
}

// O embed !inner normalmente devolve objeto (relação N:1), mas blindar contra
// as duas formas evita que a forma de pagamento degrade em silêncio se o
// formato do embed mudar algum dia — sem isso, tipo vira undefined, uma linha
// de fatura de cartão é tratada como extrato comum e sai com a forma de
// pagamento errada, sem erro nenhum avisando.
function comoObjeto(valor) {
  return Array.isArray(valor) ? (valor[0] || null) : valor;
}

// Linha de fatura de cartão sempre nasce como Cartão de Crédito; no extrato
// bancário a forma sai do texto do próprio lançamento.
function formaPara(lanc) {
  return comoObjeto(lanc.extrato_importacoes)?.tipo === 'fatura_cartao'
    ? 'Cartão de Crédito'
    : inferirFormaPagamento(lanc.descricao);
}

async function confirmar(sb, user, isAdmin, corpo) {
  const lanc = await carregarLancamento(sb, user, isAdmin, corpo.lancamentoId);
  const parcelas = (corpo.parcelas || []).map(p => ({
    parcela_id: p.parcelaId, valor_aplicado: p.valorAplicado ?? null,
  }));
  if (!parcelas.length) throw new Error('Escolha a parcela que este lançamento pagou.');
  const { data, error } = await sb.rpc('fn_conciliar_lancamento', {
    p_lancamento_id: lanc.id,
    p_parcelas: parcelas,
    p_forma_pagamento: formaPara(lanc),
    p_fornecedor_id: corpo.fornecedorId || null,
    p_categoria_conta: corpo.categoriaConta || null,
  });
  if (error) throw new Error(error.message);
  return { ok: true, vinculadas: data?.vinculadas ?? 0, baixadas: data?.baixadas ?? 0 };
}

// Lote: confirma cada sugestão como o colaborador confirmaria uma por uma.
// Uma falha não derruba as outras — a tela mostra quais ficaram de fora.
async function confirmarLote(sb, user, isAdmin, corpo) {
  const ids = corpo.lancamentoIds || [];
  if (!ids.length) throw new Error('Nenhuma sugestão selecionada.');
  let confirmados = 0;
  const falhas = [];
  for (const id of ids) {
    try {
      const lanc = await carregarLancamento(sb, user, isAdmin, id);
      if (!lanc.parcela_sugerida_id) throw new Error('Este lançamento não tem sugestão.');
      const { data: padrao, error: erroPadrao } = lanc.padrao_id
        ? await sb.from('conciliacao_padroes').select('fornecedor_id, categoria_conta')
            .eq('id', lanc.padrao_id).maybeSingle()
        : { data: null, error: null };
      // Erro descartado aqui conciliaria o lançamento sem fornecedor/categoria
      // e sem reforçar o padrão — silencioso, e a razão de ser do lote é
      // aprender. Melhor este item entrar em falhas do que baixar pela metade.
      if (erroPadrao) {
        throw new Error('Não consegui ler o padrão aprendido para este lançamento: ' + erroPadrao.message);
      }
      const { error } = await sb.rpc('fn_conciliar_lancamento', {
        p_lancamento_id: lanc.id,
        p_parcelas: [{ parcela_id: lanc.parcela_sugerida_id, valor_aplicado: lanc.valor }],
        p_forma_pagamento: formaPara(lanc),
        p_fornecedor_id: padrao?.fornecedor_id || null,
        p_categoria_conta: padrao?.categoria_conta || null,
      });
      if (error) throw new Error(error.message);
      confirmados++;
    } catch (e) {
      falhas.push({ lancamentoId: id, erro: e.message });
    }
  }
  return { ok: true, confirmados, falhas };
}

async function criarConta(sb, user, isAdmin, corpo) {
  const lanc = await carregarLancamento(sb, user, isAdmin, corpo.lancamentoId);
  if (!corpo.fornecedorId) throw new Error('Escolha o fornecedor.');
  if (!corpo.categoriaConta) throw new Error('Escolha a categoria da conta.');
  const { data, error } = await sb.rpc('fn_criar_conta_e_conciliar', {
    p_lancamento_id: lanc.id,
    p_descricao: corpo.descricao || null,
    p_categoria_conta: corpo.categoriaConta,
    p_fornecedor_id: corpo.fornecedorId,
    p_responsavel_id: corpo.responsavelId || null,
    p_forma_pagamento: formaPara(lanc),
  });
  if (error) throw new Error(error.message);
  return { ok: true, contaId: data?.conta_id, parcelaId: data?.parcela_id };
}

async function desfazer(sb, user, isAdmin, corpo) {
  const lanc = await carregarLancamento(sb, user, isAdmin, corpo.lancamentoId);
  const { data, error } = await sb.rpc('fn_desfazer_conciliacao', { p_lancamento_id: lanc.id });
  if (error) throw new Error(error.message);
  return { ok: true, reabertas: data?.reabertas ?? 0 };
}

async function pagarFatura(sb, user, isAdmin, corpo) {
  const lanc = await carregarLancamento(sb, user, isAdmin, corpo.lancamentoId);
  if (!corpo.faturaId) throw new Error('Escolha a fatura que este débito pagou.');
  const { data, error } = await sb.rpc('fn_conciliar_pagamento_fatura', {
    p_lancamento_id: lanc.id, p_fatura_id: corpo.faturaId, p_forcar: !!corpo.forcar,
  });
  if (error) throw new Error(error.message);
  return { ok: true, baixadas: data?.baixadas ?? 0, somaFatura: data?.soma_fatura ?? null };
}

const ACOES = {
  confirmar, 'confirmar-lote': confirmarLote, 'criar-conta': criarConta,
  desfazer, 'pagar-fatura': pagarFatura,
};

export async function POST(request) {
  const { sb, user, isAdmin, erro } = await autorizarModulo(request, 'financeiro');
  if (erro) return erro;

  let corpo;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ error: 'Requisição inválida.' }, { status: 400 });
  }

  const executar = ACOES[corpo?.acao];
  if (!executar) return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });

  try {
    return NextResponse.json(await executar(sb, user, isAdmin, corpo));
  } catch (e) {
    const status = /Sem acesso|outra empresa/i.test(e.message) ? 403 : 400;
    return NextResponse.json({ error: e.message }, { status });
  }
}
