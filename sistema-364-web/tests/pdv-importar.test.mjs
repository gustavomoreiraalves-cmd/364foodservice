import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importarLoja, diasEntre } from '../lib/pdvConsumer/importar.js';

const fx = nome => readFileSync(new URL(`./fixtures/pdv/${nome}`, import.meta.url), 'utf8');
const json = nome => JSON.parse(fx(nome));
const EMPRESA = '0dda3c8e-228b-4d05-b50a-2e2f301d75a3';
const LOJA = { id_connect: -2147478159, empresa_id: EMPRESA };

function clienteFalso() {
  const chamadas = [];
  return {
    chamadas,
    async setLoja(id) { chamadas.push(['setLoja', id]); },
    async setPeriodo(de, ate) { chamadas.push(['setPeriodo', de, ate]); },
    async listar(caminho) {
      chamadas.push(['listar', caminho]);
      if (caminho === '/Pedidos/GetListaPedidos') return json('pedidos-lista.json').data;
      if (caminho === '/Financeiro/GetHistoricoCaixa') return json('caixas-lista.json').data;
      if (caminho === '/Financeiro/GetRecebimentos') return json('recebimentos-lista.json').data;
      throw new Error('caminho inesperado ' + caminho);
    },
    async detalhe(caminho, id) {
      chamadas.push(['detalhe', caminho, id]);
      if (caminho === '/Pedidos/GetDetalhesPedido') return id === -1486004890 ? fx('pedido-mesa.html') : fx('pedido-delivery.html');
      return fx('caixa-fechado.html');
    },
    async produtosVendidos() { chamadas.push(['produtosVendidos']); return json('produtos-vendidos.json').data; },
  };
}

function bancoFalso({ pedidos = new Map(), caixas = new Map() } = {}) {
  const gravados = { pedidos: [], caixas: [], recebimentos: [], itensDia: [] };
  return {
    gravados,
    async pedidosExistentes() { return pedidos; },
    async gravarPedido(p) { gravados.pedidos.push(p); },
    async caixasExistentes() { return caixas; },
    async gravarCaixa(c) { gravados.caixas.push(c); },
    async gravarRecebimentos(l) { gravados.recebimentos.push(...l); },
    async substituirItensDia(empresaId, dia, linhas) { gravados.itensDia.push({ dia, n: linhas.length }); },
  };
}

test('diasEntre', () => {
  assert.deepEqual(diasEntre('2026-08-21', '2026-08-23'), ['2026-08-21', '2026-08-22', '2026-08-23']);
  assert.deepEqual(diasEntre('2026-08-23', '2026-08-21'), []);
});

test('importarLoja: banco vazio busca detalhe de pedido finalizado e grava tudo', async () => {
  const cliente = clienteFalso();
  const banco = bancoFalso();
  const r = await importarLoja({ cliente, banco, loja: LOJA, de: '2026-08-21', ate: '2026-08-22' });

  assert.deepEqual(cliente.chamadas[0], ['setLoja', -2147478159]);
  assert.deepEqual(cliente.chamadas[1], ['setPeriodo', '2026-08-21', '2026-08-22']);

  // 3 pedidos na lista: 2 finalizados (detalhe) + 1 em aberto (sem detalhe)
  const detalhesPedido = cliente.chamadas.filter(c => c[0] === 'detalhe' && c[1] === '/Pedidos/GetDetalhesPedido');
  assert.equal(detalhesPedido.length, 2);
  assert.equal(banco.gravados.pedidos.length, 3);
  const aberto = banco.gravados.pedidos.find(p => p.pedido.codigo === 75222);
  assert.equal(aberto.pedido.finalizado, false);
  assert.deepEqual(aberto.itens, []);
  const mesa = banco.gravados.pedidos.find(p => p.pedido.codigo === 74941);
  assert.equal(mesa.itens.length, 7);
  assert.match(mesa.pedido.origem_html, /modal-dialog/);

  // 2 caixas: aberto e fechado, ambos novos → detalhe dos dois
  assert.equal(banco.gravados.caixas.length, 2);
  assert.equal(banco.gravados.caixas.find(c => c.caixa.codigo === 1561).movimentos.length, 9);

  assert.equal(banco.gravados.recebimentos.length, 3);

  // itens por dia: um setPeriodo + produtosVendidos por dia da janela
  assert.deepEqual(banco.gravados.itensDia, [{ dia: '2026-08-21', n: 3 }, { dia: '2026-08-22', n: 3 }]);
  const periodosDia = cliente.chamadas.filter(c => c[0] === 'setPeriodo' && c[1] === c[2]);
  assert.equal(periodosDia.length, 2);

  assert.deepEqual(r, { pedidos: 3, caixas: 2, recebimentos: 3, itensDia: 6, avisos: [] });
});

test('importarLoja: pedido já igual no banco não busca detalhe nem regrava', async () => {
  const cliente = clienteFalso();
  const pedidos = new Map([[74941, { id: 'x', status: 'Finalizado Pago', valor_total: 160.71, excluido_em: null, fechado_em: '2026-08-18T00:32:39.463Z' }]]);
  const banco = bancoFalso({ pedidos });
  await importarLoja({ cliente, banco, loja: LOJA, de: '2026-08-21', ate: '2026-08-21' });
  const detalhes = cliente.chamadas.filter(c => c[0] === 'detalhe' && c[1] === '/Pedidos/GetDetalhesPedido').map(c => c[2]);
  assert.deepEqual(detalhes, [-1486004889]);
  assert.equal(banco.gravados.pedidos.some(p => p.pedido.codigo === 74941), false);
});

test('importarLoja: caixa fechado já fechado no banco não busca detalhe', async () => {
  const cliente = clienteFalso();
  const caixas = new Map([[1561, { id: 'c', status: 'Fechado' }], [1562, { id: 'd', status: 'Aberto' }]]);
  const banco = bancoFalso({ caixas });
  await importarLoja({ cliente, banco, loja: LOJA, de: '2026-08-21', ate: '2026-08-21' });
  const detalhes = cliente.chamadas.filter(c => c[0] === 'detalhe' && c[1] === '/Financeiro/GetDetalhesCaixa').map(c => c[2]);
  // o aberto é sempre relido (pode ter movimentação nova); o fechado não
  assert.deepEqual(detalhes, [-2131420458]);
});

test('importarLoja: erro no detalhe de um pedido vira aviso e não aborta', async () => {
  const cliente = clienteFalso();
  const original = cliente.detalhe;
  cliente.detalhe = async (caminho, id) => { if (id === -1486004890) throw new Error('timeout'); return original(caminho, id); };
  const banco = bancoFalso();
  const r = await importarLoja({ cliente, banco, loja: LOJA, de: '2026-08-21', ate: '2026-08-21' });
  assert.equal(r.avisos.length, 1);
  assert.match(r.avisos[0], /74941/);
  assert.equal(banco.gravados.pedidos.length, 2);
});
