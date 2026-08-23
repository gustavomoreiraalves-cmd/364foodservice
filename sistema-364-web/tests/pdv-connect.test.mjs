import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarClienteConnect, SessaoExpiradaError, COLUNAS } from '../lib/pdvConsumer/connect.js';

// fetch falso: registra chamadas e responde pelo caminho.
function fetchFalso(respostas) {
  const chamadas = [];
  const fn = async (url, opts = {}) => {
    const u = new URL(url);
    chamadas.push({ caminho: u.pathname + u.search, opts });
    const r = respostas[u.pathname];
    const resp = typeof r === 'function' ? r(opts, chamadas.length) : r;
    return {
      ok: resp.status ? resp.status < 400 : true,
      status: resp.status || 200,
      redirected: !!resp.redirected,
      url: resp.url || url,
      headers: { get: h => (resp.headers || {})[h.toLowerCase()] || null },
      text: async () => (typeof resp.body === 'string' ? resp.body : JSON.stringify(resp.body)),
    };
  };
  fn.chamadas = chamadas;
  return fn;
}

test('setLoja e setPeriodo fazem POST com cookie e formato do painel', async () => {
  const f = fetchFalso({ '/QueryFilters/SetDatabaseFilter': { body: '{}' }, '/QueryFilters/SetDateFilter': { body: '{}' } });
  const c = criarClienteConnect({ cookie: 'ASP.NET_SessionId=abc', fetch: f, pausaMs: 0 });
  await c.setLoja(-2147478159);
  await c.setPeriodo('2026-08-20', '2026-08-23');
  assert.equal(f.chamadas[0].opts.method, 'POST');
  assert.equal(f.chamadas[0].opts.headers.Cookie, 'ASP.NET_SessionId=abc');
  assert.equal(f.chamadas[0].opts.headers['X-Requested-With'], 'XMLHttpRequest');
  assert.equal(f.chamadas[0].opts.body, 'ids=-2147478159');
  assert.equal(decodeURIComponent(f.chamadas[1].opts.body), 'start=2026-08-20 00:00&end=2026-08-23 23:59');
});

test('listar pagina até recordsTotal e monta corpo DataTables', async () => {
  const todas = Array.from({ length: 5 }, (_, i) => ({ Codigo: i + 1 }));
  const f = fetchFalso({
    '/Pedidos/GetListaPedidos': opts => {
      const p = new URLSearchParams(opts.body);
      const start = Number(p.get('start')), length = Number(p.get('length'));
      return { body: { draw: 1, recordsTotal: 5, recordsFiltered: 5, data: todas.slice(start, start + length) } };
    },
  });
  const c = criarClienteConnect({ cookie: 'x', fetch: f, pausaMs: 0 });
  const linhas = await c.listar('/Pedidos/GetListaPedidos', COLUNAS.pedidos, { tamanhoPagina: 2 });
  assert.equal(linhas.length, 5);
  assert.equal(f.chamadas.length, 3);
  const corpo = new URLSearchParams(f.chamadas[0].opts.body);
  assert.equal(corpo.get('columns[0][data]'), 'Codigo');
  assert.equal(corpo.get('order[0][column]'), '0');
  assert.equal(corpo.get('order[0][dir]'), 'desc');
  assert.equal(corpo.get('length'), '2');
});

test('listar devolve erro legível quando o servidor responde {error, message}', async () => {
  const f = fetchFalso({ '/Pedidos/GetListaPedidos': { body: { error: true, message: 'Object reference not set' } } });
  const c = criarClienteConnect({ cookie: 'x', fetch: f, pausaMs: 0 });
  await assert.rejects(() => c.listar('/Pedidos/GetListaPedidos', COLUNAS.pedidos), /Object reference not set/);
});

test('detalhe faz GET com id e devolve HTML', async () => {
  const f = fetchFalso({ '/Pedidos/GetDetalhesPedido': { body: '<div class="modal-dialog">x</div>' } });
  const c = criarClienteConnect({ cookie: 'x', fetch: f, pausaMs: 0 });
  const html = await c.detalhe('/Pedidos/GetDetalhesPedido', -1486004890);
  assert.match(html, /modal-dialog/);
  assert.equal(f.chamadas[0].caminho, '/Pedidos/GetDetalhesPedido?id=-1486004890');
  assert.equal(f.chamadas[0].opts.method, 'GET');
});

test('sessão expirada: redirect para login vira SessaoExpiradaError', async () => {
  const f = fetchFalso({ '/Pedidos/GetDetalhesPedido': { redirected: true, url: 'https://connect.consumer.com.br/autenticacao/login?ReturnUrl=x', body: '<form action="/autenticacao/login">' } });
  const c = criarClienteConnect({ cookie: 'x', fetch: f, pausaMs: 0 });
  await assert.rejects(() => c.detalhe('/Pedidos/GetDetalhesPedido', 1), SessaoExpiradaError);
});

test('produtosVendidos aceita corpo vazio e devolve data', async () => {
  const f = fetchFalso({ '/Produtos/GetProdutosVendidos': { body: { data: [{ Nome: 'Arroz' }] } } });
  const c = criarClienteConnect({ cookie: 'x', fetch: f, pausaMs: 0 });
  const itens = await c.produtosVendidos();
  assert.deepEqual(itens, [{ Nome: 'Arroz' }]);
});

test('erro 500 é tentado três vezes antes de falhar', async () => {
  let n = 0;
  const f = fetchFalso({ '/Financeiro/GetRecebimentos': () => { n++; return n < 3 ? { status: 500, body: 'erro' } : { body: { recordsTotal: 0, data: [] } }; } });
  const c = criarClienteConnect({ cookie: 'x', fetch: f, pausaMs: 0, dormir: async () => {} });
  const linhas = await c.listar('/Financeiro/GetRecebimentos', COLUNAS.recebimentos);
  assert.deepEqual(linhas, []);
  assert.equal(n, 3);
});
