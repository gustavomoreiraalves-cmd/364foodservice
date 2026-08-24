import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extrairPdf, montarPedido, MODELO_PADRAO } from '../lib/extratos/extrairPdf.js';

// Dublê do cliente: implementa só beta.messages.create, que é tudo que o módulo usa.
function clienteFalso(resposta, capturar) {
  return {
    beta: {
      messages: {
        create: async pedido => {
          if (capturar) capturar(pedido);
          return resposta;
        },
      },
    },
  };
}

function respostaComFerramenta(input) {
  return {
    stop_reason: 'tool_use',
    content: [
      { type: 'text', text: 'Li o extrato.' },
      { type: 'tool_use', name: 'registrar_extrato', input },
    ],
  };
}

const EXTRATO_IA = {
  periodo_inicio: '2026-08-01',
  periodo_fim: '2026-08-31',
  saldo_inicial: 500,
  saldo_final: 1200,
  lancamentos: [
    { data: '2026-08-10', descricao: 'PIX ENVIADO BOI FORTE', valor: -750, tipo: 'saida', documento: '123' },
    { data: '2026-08-12', descricao: 'PIX RECEBIDO CLIENTE', valor: 200, tipo: 'entrada', documento: null },
  ],
};

test('pedido manda o PDF como documento e força a ferramenta', () => {
  const pedido = montarPedido({ base64: 'QUJD', tipo: 'extrato' });
  assert.equal(pedido.model, MODELO_PADRAO);
  assert.equal(pedido.tool_choice.type, 'tool');
  assert.equal(pedido.tool_choice.name, 'registrar_extrato');
  const doc = pedido.messages[0].content.find(c => c.type === 'document');
  assert.equal(doc.source.type, 'base64');
  assert.equal(doc.source.media_type, 'application/pdf');
  assert.equal(doc.source.data, 'QUJD');
});

test('modelo padrão é o mais capaz, e pode ser trocado por parâmetro', () => {
  assert.equal(MODELO_PADRAO, 'claude-opus-5');
  assert.equal(montarPedido({ base64: 'x', tipo: 'extrato', modelo: 'claude-sonnet-5' }).model,
    'claude-sonnet-5');
});

test('fatura pede o total da fatura no prompt', () => {
  const pedido = montarPedido({ base64: 'x', tipo: 'fatura_cartao' });
  const texto = pedido.messages[0].content.find(c => c.type === 'text').text;
  assert.match(texto, /fatura/i);
});

test('lê a resposta da ferramenta e normaliza sinal em tipo', async () => {
  const r = await extrairPdf({
    base64: 'x', tipo: 'extrato', cliente: clienteFalso(respostaComFerramenta(EXTRATO_IA)),
  });
  assert.equal(r.periodoInicio, '2026-08-01');
  assert.equal(r.saldoInicial, 500);
  assert.equal(r.saldoFinal, 1200);
  assert.deepEqual(r.lancamentos[0], {
    data: '2026-08-10', descricao: 'PIX ENVIADO BOI FORTE', valor: 750,
    tipo: 'saida', documento: '123', fitid: null,
  });
  assert.equal(r.lancamentos[1].tipo, 'entrada');
});

test('sinal decide o tipo quando a IA não preenche o campo', async () => {
  const r = await extrairPdf({
    base64: 'x', tipo: 'extrato',
    cliente: clienteFalso(respostaComFerramenta({
      ...EXTRATO_IA,
      lancamentos: [{ data: '2026-08-10', descricao: 'TARIFA', valor: -49.9 }],
    })),
  });
  assert.equal(r.lancamentos[0].tipo, 'saida');
  assert.equal(r.lancamentos[0].valor, 49.9);
});

test('linha sem data legível é descartada sem derrubar a importação', async () => {
  const r = await extrairPdf({
    base64: 'x', tipo: 'extrato',
    cliente: clienteFalso(respostaComFerramenta({
      ...EXTRATO_IA,
      lancamentos: [
        { data: 'sei lá', descricao: 'RUIM', valor: -10, tipo: 'saida' },
        { data: '2026-08-10', descricao: 'BOM', valor: -10, tipo: 'saida' },
      ],
    })),
  });
  assert.equal(r.lancamentos.length, 1);
  assert.equal(r.lancamentos[0].descricao, 'BOM');
});

test('sem chave da API o erro diz o que configurar', async () => {
  await assert.rejects(
    () => extrairPdf({ base64: 'x', tipo: 'extrato', apiKey: '' }),
    /ANTHROPIC_API_KEY/);
});

test('recusa do modelo vira erro em português, não "ferramenta não veio"', async () => {
  await assert.rejects(
    () => extrairPdf({
      base64: 'x', tipo: 'extrato',
      cliente: clienteFalso({ stop_reason: 'refusal', stop_details: { category: 'other' }, content: [] }),
    }),
    /recus/i);
});

test('resposta sem tool_use é erro explícito', async () => {
  await assert.rejects(
    () => extrairPdf({
      base64: 'x', tipo: 'extrato',
      cliente: clienteFalso({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'não consegui' }] }),
    }),
    /não consegui ler o PDF|não devolveu/i);
});

test('resposta truncada por max_tokens é erro, não extrato pela metade', async () => {
  await assert.rejects(
    () => extrairPdf({
      base64: 'x', tipo: 'extrato',
      cliente: clienteFalso({
        stop_reason: 'max_tokens',
        content: [{ type: 'tool_use', name: 'registrar_extrato', input: EXTRATO_IA }],
      }),
    }),
    /longo demais|truncad/i);
});

test('nenhum lançamento extraído é erro (PDF errado, página em branco)', async () => {
  await assert.rejects(
    () => extrairPdf({
      base64: 'x', tipo: 'extrato',
      cliente: clienteFalso(respostaComFerramenta({ ...EXTRATO_IA, lancamentos: [] })),
    }),
    /nenhum lançamento/i);
});
