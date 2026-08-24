// Extrato em PDF é o formato que o colaborador tem na mão, e é o pior de
// todos para ler por regra fixa: cada banco tem um layout e muda sem avisar.
// A Claude API lê PDF nativamente e devolve os lançamentos por tool call com
// schema — o que chega aqui já é estrutura, não texto solto.
//
// Custo: um extrato de ~10 páginas sai por centavos. É mais barato que manter
// seis parsers de PDF.
import Anthropic from '@anthropic-ai/sdk';
import { dataIso } from './numero.js';

export const MODELO_PADRAO = 'claude-opus-5';
const BETA_FALLBACK = 'server-side-fallback-2026-07-01';

export const FERRAMENTA = {
  name: 'registrar_extrato',
  description: 'Registra os lançamentos lidos do extrato ou da fatura.',
  input_schema: {
    type: 'object',
    properties: {
      periodo_inicio: { type: 'string', description: 'Primeiro dia do período, AAAA-MM-DD.' },
      periodo_fim: { type: 'string', description: 'Último dia do período, AAAA-MM-DD.' },
      saldo_inicial: { type: ['number', 'null'], description: 'Saldo anterior, se o documento mostrar.' },
      saldo_final: { type: ['number', 'null'], description: 'Saldo final, se o documento mostrar.' },
      total_fatura: { type: ['number', 'null'], description: 'Total a pagar da fatura de cartão.' },
      lancamentos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            data: { type: 'string', description: 'AAAA-MM-DD.' },
            descricao: { type: 'string', description: 'Histórico como está no documento.' },
            valor: { type: 'number', description: 'Negativo para saída, positivo para entrada.' },
            tipo: { type: 'string', enum: ['saida', 'entrada'] },
            documento: { type: ['string', 'null'] },
          },
          required: ['data', 'descricao', 'valor', 'tipo'],
        },
      },
    },
    required: ['lancamentos'],
  },
};

function instrucao(tipo) {
  const comum = 'Leia o documento anexado e registre TODOS os lançamentos, na ordem em que '
    + 'aparecem, sem agrupar e sem pular nenhum, inclusive tarifas, impostos e estornos. '
    + 'Datas em AAAA-MM-DD. Valor negativo para dinheiro que saiu, positivo para dinheiro que '
    + 'entrou, e preencha "tipo" de acordo. Não invente linha que não está no documento e não '
    + 'inclua linhas de saldo ou de subtotal como lançamento.';
  return tipo === 'fatura_cartao'
    ? `${comum} Este documento é uma fatura de cartão de crédito: registre cada compra como `
      + `lançamento de saída e preencha total_fatura com o total a pagar da fatura.`
    : `${comum} Este documento é um extrato de conta bancária: preencha saldo_inicial e `
      + `saldo_final quando o extrato mostrar os dois.`;
}

export function montarPedido({ base64, tipo, modelo }) {
  return {
    model: modelo || MODELO_PADRAO,
    max_tokens: 16000,
    // Recusa por política refaz o pedido no modelo de fallback dentro da mesma
    // chamada, em vez de devolver um extrato vazio para o colaborador.
    betas: [BETA_FALLBACK],
    fallbacks: 'default',
    tools: [FERRAMENTA],
    tool_choice: { type: 'tool', name: FERRAMENTA.name },
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text: instrucao(tipo) },
      ],
    }],
  };
}

function normalizar(lidos) {
  const lancamentos = [];
  for (const l of lidos || []) {
    const data = dataIso(l?.data);
    const valor = Number(l?.valor);
    if (!data || !Number.isFinite(valor) || valor === 0) continue;
    const tipo = l?.tipo === 'saida' || l?.tipo === 'entrada'
      ? l.tipo
      : (valor < 0 ? 'saida' : 'entrada');
    lancamentos.push({
      data,
      descricao: String(l?.descricao || '').trim() || 'SEM DESCRIÇÃO',
      valor: Math.abs(valor),
      tipo,
      documento: l?.documento ? String(l.documento) : null,
      fitid: null,
    });
  }
  return lancamentos;
}

// Traduz erro do SDK para uma frase que o colaborador entende. Usa as classes
// tipadas do SDK — nunca comparar texto de mensagem de erro.
function erroLegivel(e) {
  if (e instanceof Anthropic.AuthenticationError) {
    return new Error('A chave da Anthropic foi recusada. Confira ANTHROPIC_API_KEY.');
  }
  if (e instanceof Anthropic.RateLimitError) {
    return new Error('A leitura automática atingiu o limite de uso. Tente de novo em alguns minutos, '
      + 'ou importe o extrato em OFX.');
  }
  if (e instanceof Anthropic.APIError) {
    return new Error(`A leitura do PDF falhou (HTTP ${e.status}). ${String(e.message).slice(0, 200)}`);
  }
  return e;
}

export async function extrairPdf({ base64, tipo, apiKey, modelo, cliente }) {
  const chave = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!cliente && !chave) {
    throw new Error('Configure ANTHROPIC_API_KEY para importar extrato em PDF '
      + '(OFX e CSV funcionam sem ela).');
  }
  const ia = cliente || new Anthropic({ apiKey: chave });

  let resposta;
  try {
    resposta = await ia.beta.messages.create(montarPedido({ base64, tipo, modelo }));
  } catch (e) {
    throw erroLegivel(e);
  }

  if (resposta.stop_reason === 'refusal') {
    throw new Error('A leitura automática deste PDF foi recusada. Importe o extrato em OFX '
      + 'pelo internet banking.');
  }
  if (resposta.stop_reason === 'max_tokens') {
    throw new Error('Este extrato é longo demais para uma leitura só e veio truncado. '
      + 'Exporte um período menor, ou importe em OFX.');
  }

  const ferramenta = (resposta.content || []).find(
    c => c.type === 'tool_use' && c.name === FERRAMENTA.name);
  if (!ferramenta?.input) {
    throw new Error('Não consegui ler o PDF: a leitura não devolveu os lançamentos. '
      + 'Tente exportar o extrato em OFX no internet banking.');
  }

  const dados = ferramenta.input;
  const lancamentos = normalizar(dados.lancamentos);
  if (!lancamentos.length) {
    throw new Error('Não achei nenhum lançamento neste PDF — confira se é mesmo o extrato '
      + 'ou a fatura do período.');
  }

  const numeroOuNulo = v => (Number.isFinite(Number(v)) ? Number(v) : null);
  const datas = lancamentos.map(l => l.data).sort();
  return {
    periodoInicio: dataIso(dados.periodo_inicio) || datas[0],
    periodoFim: dataIso(dados.periodo_fim) || datas[datas.length - 1],
    saldoInicial: numeroOuNulo(dados.saldo_inicial),
    saldoFinal: numeroOuNulo(dados.saldo_final),
    total: numeroOuNulo(dados.total_fatura),
    lancamentos,
  };
}
