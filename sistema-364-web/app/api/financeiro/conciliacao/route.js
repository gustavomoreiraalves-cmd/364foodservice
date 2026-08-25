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
    .select('id, empresa_id, descricao, importacao_id, parcela_sugerida_id, valor, padrao_id')
    .eq('id', lancamentoId).maybeSingle();
  if (!lanc) throw new Error('Lançamento não encontrado.');
  await garantirEmpresa(sb, user, isAdmin, lanc.empresa_id);

  // Consulta à parte em vez de embed: extrato_lancamentos tem DUAS FKs para
  // extrato_importacoes (importacao_id e fatura_id), o que torna um embed
  // ambíguo para o PostgREST (erro de "mais de uma relação encontrada") sem
  // uma dica de qual FK usar — e a dica depende do nome da constraint/coluna
  // continuar estável, uma dependência a mais que este caminho sem teste
  // automatizado não tem como pegar se quebrar. Uma consulta extra por ação
  // é barata e falha de um jeito visível.
  const { data: importacao, error: erroImportacao } = await sb.from('extrato_importacoes')
    .select('tipo').eq('id', lanc.importacao_id).maybeSingle();
  if (erroImportacao) {
    throw new Error('Não consegui identificar o tipo da importação deste lançamento: ' + erroImportacao.message);
  }
  lanc.importacaoTipo = importacao?.tipo ?? null;

  return lanc;
}

// Linha de fatura de cartão sempre nasce como Cartão de Crédito; no extrato
// bancário a forma sai do texto do próprio lançamento.
function formaPara(lanc) {
  return lanc.importacaoTipo === 'fatura_cartao'
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

// De onde sai o fornecedor que o lote vai ensinar ao padrão. O padrao_id só
// existe quando a descrição JÁ bateu com um padrão na importação — ou seja,
// quando não há nada de novo a aprender. Na primeira importação do piloto
// conciliacao_padroes está vazia, toda sugestão vem de valor + data, e o lote
// mandava fornecedor null: fn_registrar_padrao voltava na primeira linha sem
// gravar nada, e "Confirmar 18 sugestões" criava ZERO padrões. O mês seguinte
// chegava sem desempate nenhum, com o objetivo declarado do módulo ("a cada
// associação confirmada o sistema aprende o padrão") nunca saindo do papel.
// A conta a pagar da parcela sugerida tem o fornecedor e a categoria — é o
// mesmo dado que o caminho manual do "Associar" já passa, lido aqui no
// servidor em vez de vir do corpo da requisição.
async function fornecedorParaAprender(sb, lanc) {
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
  if (padrao?.fornecedor_id) {
    return { fornecedorId: padrao.fornecedor_id, categoriaConta: padrao.categoria_conta || null };
  }

  const { data: parcela, error: erroParcela } = await sb.from('contas_a_pagar_parcelas')
    .select('contas_a_pagar(fornecedor_id, categoria_conta)')
    .eq('id', lanc.parcela_sugerida_id).maybeSingle();
  if (erroParcela) {
    throw new Error('Não consegui ler o fornecedor da parcela sugerida: ' + erroParcela.message);
  }
  const conta = Array.isArray(parcela?.contas_a_pagar)
    ? (parcela.contas_a_pagar[0] || null)
    : (parcela?.contas_a_pagar || null);
  return {
    fornecedorId: conta?.fornecedor_id || null,
    categoriaConta: padrao?.categoria_conta || conta?.categoria_conta || null,
  };
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
      const { fornecedorId, categoriaConta } = await fornecedorParaAprender(sb, lanc);
      const { error } = await sb.rpc('fn_conciliar_lancamento', {
        p_lancamento_id: lanc.id,
        p_parcelas: [{ parcela_id: lanc.parcela_sugerida_id, valor_aplicado: lanc.valor }],
        p_forma_pagamento: formaPara(lanc),
        p_fornecedor_id: fornecedorId,
        p_categoria_conta: categoriaConta,
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

// Apaga a importação inteira. Existe porque o erro mais provável do dia 1 do
// piloto é importar o extrato do Sicoob contra a conta do Cresol: o
// hash_dedupe inclui a conta, então reimportar contra a conta certa gera um
// SEGUNDO conjunto completo, e o primeiro não tinha como sair da tela. Cada
// lançamento fantasma segura um parcela_sugerida_id que parcelasPendentes
// subtrai de toda importação futura — a importação certa chegaria 'pendente'
// em vez de 'sugerido', para sempre.
//
// Só quando NENHUM lançamento está conciliado: apagar uma importação
// conciliada arrastaria vínculos e baixas junto, pelo cascade, em silêncio.
// Essa mesma regra cobre o pagamento de fatura (que mora em outra importação,
// mas só existe conciliado).
const BUCKET_EXTRATOS = 'recebimentos';   // mesmo bucket de lib/extratosServer.js

async function excluirImportacao(sb, user, isAdmin, corpo) {
  if (!corpo.importacaoId) throw new Error('Informe a importação.');
  const { data: imp, error: erroImp } = await sb.from('extrato_importacoes')
    .select('id, empresa_id, arquivo_path, arquivo_nome')
    .eq('id', corpo.importacaoId).maybeSingle();
  if (erroImp) throw new Error('Não consegui ler a importação: ' + erroImp.message);
  if (!imp) throw new Error('Importação não encontrada.');
  await garantirEmpresa(sb, user, isAdmin, imp.empresa_id);

  const { count, error: erroContagem } = await sb.from('extrato_lancamentos')
    .select('id', { count: 'exact', head: true })
    .eq('importacao_id', imp.id).eq('status', 'conciliado');
  if (erroContagem) {
    throw new Error('Não consegui conferir os lançamentos conciliados: ' + erroContagem.message);
  }
  if ((count || 0) > 0) {
    throw new Error(`Esta importação tem ${count} lançamento(s) já conciliado(s). `
      + 'Desfaça essas conciliações antes de excluir — apagar agora sumiria com os vínculos '
      + 'e com as baixas que eles fizeram.');
  }

  // Arquivo órfão no bucket é sujeira; lançamento fantasma é sugestão travada.
  // Se o remove falhar, seguir com o delete ainda é o certo — o que envenena a
  // conciliação é a linha, não o arquivo.
  const { error: erroArquivo } = await sb.storage.from(BUCKET_EXTRATOS).remove([imp.arquivo_path]);
  if (erroArquivo) {
    console.error('Não removi o arquivo da importação', imp.id, ':', erroArquivo.message);
  }

  // O cascade de extrato_lancamentos.importacao_id limpa as linhas junto.
  const { error: erroDelete } = await sb.from('extrato_importacoes').delete().eq('id', imp.id);
  if (erroDelete) throw new Error('Não consegui excluir a importação: ' + erroDelete.message);
  return { ok: true, arquivoRemovido: !erroArquivo };
}

const ACOES = {
  confirmar, 'confirmar-lote': confirmarLote, 'criar-conta': criarConta,
  desfazer, 'pagar-fatura': pagarFatura, 'excluir-importacao': excluirImportacao,
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

  // hasOwnProperty, não `ACOES[acao]`: o acesso direto alcança
  // Object.prototype, e {"acao":"toString"} devolvia 200 com "[object
  // Undefined]" no corpo em vez de "Ação desconhecida".
  const acao = corpo?.acao;
  const executar = Object.prototype.hasOwnProperty.call(ACOES, acao) ? ACOES[acao] : null;
  if (!executar) return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });

  try {
    return NextResponse.json(await executar(sb, user, isAdmin, corpo));
  } catch (e) {
    const status = /Sem acesso|outra empresa/i.test(e.message) ? 403 : 400;
    return NextResponse.json({ error: e.message }, { status });
  }
}
