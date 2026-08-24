// Orquestra a importação de um extrato ou fatura: escolhe o parser, confere a
// aritmética, sobe o arquivo, grava os lançamentos com dedupe e já pré-associa
// o que o aprendizado permite. Só as rotas importam este arquivo — ele usa
// service role.
import crypto from 'node:crypto';
import { parseOfx } from './extratos/parseOfx.js';
import { parseCsv } from './extratos/parseCsv.js';
import { extrairPdf } from './extratos/extrairPdf.js';
import { validarExtrato, validarFatura } from './extratos/validar.js';
import { normalizarDescricao } from './extratos/normalizar.js';
import { hashDedupe } from './extratos/dedupe.js';
import { escolherSugestao } from './extratos/matching.js';

const BUCKET = 'recebimentos';

export function formatoDoArquivo(nome) {
  const ext = String(nome || '').toLowerCase().split('.').pop();
  if (ext === 'ofx') return 'ofx';
  if (ext === 'csv' || ext === 'txt') return 'csv';
  if (ext === 'pdf') return 'pdf';
  throw new Error('Formato não aceito. Envie o extrato em PDF, OFX ou CSV.');
}

async function lerArquivo({ formato, buffer, tipo }) {
  if (formato === 'ofx') return parseOfx(buffer.toString('latin1'));
  if (formato === 'pdf') {
    return extrairPdf({
      base64: buffer.toString('base64'), tipo,
      apiKey: process.env.ANTHROPIC_API_KEY, modelo: process.env.EXTRATO_IA_MODELO,
    });
  }
  // CSV reconhecido sai de graça. Layout estranho não é adivinhado nem mandado
  // para a IA (o caminho da IA manda um bloco `document` de PDF, e CSV não
  // entra nele): recusa com instrução, que é honesto e não gera lançamento
  // errado no financeiro.
  const lido = parseCsv(buffer.toString('utf8'));
  if (!lido.reconhecido) {
    throw new Error('Não reconheci as colunas deste CSV. Exporte em OFX, ou envie o extrato '
      + 'em PDF — nesse formato a leitura é automática.');
  }
  return lido;
}

// O embed !inner normalmente devolve objeto (relação N:1), mas blindar contra
// as duas formas evita que o aprendizado degrade em silêncio se o formato do
// embed mudar algum dia — sem isso, fornecedorId vira null sem erro nenhum e
// as sugestões simplesmente param de desempatar por fornecedor, sem avisar.
function comoObjeto(valor) {
  return Array.isArray(valor) ? (valor[0] || null) : valor;
}

// Parcelas pendentes achatadas no shape que o motor de sugestão espera, menos
// as que já foram sugeridas por um lançamento ainda aberto ('pendente' ou
// 'sugerido') de QUALQUER importação — inclusive de outra. Sem essa exclusão,
// duas importações diferentes (a conta corrente e a fatura do cartão, por
// exemplo) podem sugerir a mesma parcela cada uma para o seu próprio débito;
// confirmando as duas, a função do banco não deixa baixar a parcela duas
// vezes, mas cria os dois vínculos e concilia os dois lançamentos — uma saída
// real fica contabilizada contra nada, em silêncio. Lançamento já conciliado
// não precisa entrar nessa exclusão: a parcela dele já não é mais 'Pendente',
// então nem chega na consulta abaixo.
async function parcelasPendentes(sb, empresaId) {
  const { data, error } = await sb.from('contas_a_pagar_parcelas')
    .select('id, valor, vencimento, contas_a_pagar!inner(fornecedor_id)')
    .eq('empresa_id', empresaId).eq('status', 'Pendente');
  if (error) throw new Error('Não consegui ler as parcelas em aberto: ' + error.message);

  const { data: reservadas, error: erroReservadas } = await sb.from('extrato_lancamentos')
    .select('parcela_sugerida_id').eq('empresa_id', empresaId)
    .in('status', ['pendente', 'sugerido']).not('parcela_sugerida_id', 'is', null);
  if (erroReservadas) {
    throw new Error('Não consegui conferir as sugestões em aberto: ' + erroReservadas.message);
  }
  const jaReservadas = new Set((reservadas || []).map(l => l.parcela_sugerida_id));

  return (data || [])
    .filter(p => !jaReservadas.has(p.id))
    .map(p => ({
      id: p.id, valor: Number(p.valor), vencimento: p.vencimento,
      fornecedorId: comoObjeto(p.contas_a_pagar)?.fornecedor_id || null,
    }));
}

async function mapaDePadroes(sb, empresaId) {
  const { data, error } = await sb.from('conciliacao_padroes')
    .select('id, padrao, fornecedor_id, categoria_conta').eq('empresa_id', empresaId);
  if (error) throw new Error('Não consegui ler os padrões de conciliação aprendidos: ' + error.message);
  const mapa = new Map();
  for (const p of data || []) {
    mapa.set(p.padrao, { id: p.id, fornecedorId: p.fornecedor_id, categoriaConta: p.categoria_conta });
  }
  return mapa;
}

export async function processarImportacao({ sb, empresaId, contaBancariaId, tipo, arquivoNome, buffer }) {
  const formato = formatoDoArquivo(arquivoNome);
  const importacaoId = crypto.randomUUID();
  const caminho = `${empresaId}/extratos/${importacaoId}/${formato === 'pdf' ? 'arquivo.pdf' : `arquivo.${formato}`}`;

  const { data: conta, error: erroConta } = await sb.from('contas_bancarias')
    .select('id, empresa_id, tipo').eq('id', contaBancariaId).maybeSingle();
  if (erroConta || !conta) throw new Error('Conta bancária não encontrada.');
  if (conta.empresa_id !== empresaId) throw new Error('Conta bancária de outra empresa.');
  if (tipo === 'fatura_cartao' && conta.tipo !== 'cartao_credito') {
    throw new Error('Fatura só pode ser importada contra uma conta de cartão de crédito.');
  }

  const contentType = formato === 'pdf' ? 'application/pdf'
    : (formato === 'csv' ? 'text/csv' : 'application/x-ofx');
  const { error: erroUpload } = await sb.storage.from(BUCKET)
    .upload(caminho, buffer, { contentType, upsert: false });
  if (erroUpload) throw new Error('Não consegui guardar o arquivo: ' + erroUpload.message);

  const { error: erroImportacao } = await sb.from('extrato_importacoes').insert([{
    id: importacaoId, empresa_id: empresaId, conta_bancaria_id: contaBancariaId,
    tipo, arquivo_path: caminho, arquivo_nome: arquivoNome, formato, status: 'processando',
  }]);
  if (erroImportacao) throw new Error('Não consegui registrar a importação: ' + erroImportacao.message);

  try {
    const lido = await lerArquivo({ formato, buffer, tipo });
    const conferencia = tipo === 'fatura_cartao'
      ? validarFatura({ total: lido.total, lancamentos: lido.lancamentos })
      : validarExtrato(lido);

    const parcelas = await parcelasPendentes(sb, empresaId);
    const padroes = await mapaDePadroes(sb, empresaId);
    const jaSugeridas = new Set();
    // Contador por identidade (data + valor + descrição normalizada), para o
    // hash_dedupe diferenciar duas linhas idênticas sem FITID (duas tarifas
    // de R$ 50 no mesmo dia, por exemplo — comum em PDF e CSV). A primeira
    // ocorrência leva 0, a segunda 1, e assim por diante. Reimportar o mesmo
    // arquivo é idempotente porque a ordem das linhas se repete e os ordinais
    // batem de novo com os já gravados.
    const contagemPorIdentidade = new Map();

    const linhas = lido.lancamentos.map(l => {
      const descricaoNormalizada = normalizarDescricao(l.descricao);
      const padrao = padroes.get(descricaoNormalizada) || null;
      let status = l.tipo === 'entrada' ? 'ignorado' : 'pendente';
      let parcelaSugeridaId = null;

      if (l.tipo === 'saida') {
        const livres = parcelas.filter(p => !jaSugeridas.has(p.id));
        const sugestao = escolherSugestao(l, livres, padrao);
        if (sugestao) {
          parcelaSugeridaId = sugestao.parcelaId;
          jaSugeridas.add(sugestao.parcelaId);
          status = 'sugerido';
        }
      }

      const chaveIdentidade = `${l.data}|${Number(l.valor).toFixed(2)}|${descricaoNormalizada}`;
      const ocorrencia = contagemPorIdentidade.get(chaveIdentidade) || 0;
      contagemPorIdentidade.set(chaveIdentidade, ocorrencia + 1);

      return {
        importacao_id: importacaoId, empresa_id: empresaId,
        data: l.data, descricao: l.descricao, descricao_normalizada: descricaoNormalizada,
        valor: l.valor, tipo: l.tipo, documento: l.documento, status,
        parcela_sugerida_id: parcelaSugeridaId, padrao_id: padrao?.id || null,
        hash_dedupe: hashDedupe({
          contaBancariaId, data: l.data, valor: l.valor,
          descricaoNormalizada, fitid: l.fitid, ocorrencia,
        }),
      };
    });

    // ignoreDuplicates: reimportar o mesmo período não duplica nem trava.
    const { data: inseridas, error: erroLinhas } = await sb.from('extrato_lancamentos')
      .upsert(linhas, { onConflict: 'empresa_id,hash_dedupe', ignoreDuplicates: true })
      .select('id, status');
    if (erroLinhas) throw new Error('Não consegui gravar os lançamentos: ' + erroLinhas.message);

    const novas = inseridas?.length || 0;
    const sugeridas = (inseridas || []).filter(l => l.status === 'sugerido').length;

    // supabase-js não lança em erro de escrita — devolve { error }. Sem essa
    // checagem, uma falha aqui some em silêncio: periodo_inicio, periodo_fim
    // e, principalmente, o `alerta` (o único aviso de que o extrato não
    // fecha) desapareceriam sem o catch rodar, e a rota devolveria o resumo
    // de sucesso mesmo assim.
    const { error: erroAtualizarImportacao } = await sb.from('extrato_importacoes').update({
      periodo_inicio: lido.periodoInicio, periodo_fim: lido.periodoFim,
      alerta: conferencia.alerta, status: 'aguardando_conciliacao',
    }).eq('id', importacaoId);
    if (erroAtualizarImportacao) {
      throw new Error('Não consegui atualizar o resumo da importação: ' + erroAtualizarImportacao.message);
    }
    const { error: erroRecalcular } = await sb.rpc('fn_recalcular_importacao', { p_importacao_id: importacaoId });
    if (erroRecalcular) {
      throw new Error('Não consegui recalcular os totais da importação: ' + erroRecalcular.message);
    }

    return {
      importacaoId, total: linhas.length, novas, duplicadas: linhas.length - novas,
      sugeridas, alerta: conferencia.alerta,
    };
  } catch (e) {
    // Deixa a importação registrada com o erro (a tela explica o que houve),
    // mas limpa as linhas parciais para o dedupe não travar a nova tentativa.
    await sb.from('extrato_lancamentos').delete().eq('importacao_id', importacaoId);
    await sb.from('extrato_importacoes')
      .update({ status: 'erro', erro: String(e.message).slice(0, 500) }).eq('id', importacaoId);
    throw e;
  }
}
