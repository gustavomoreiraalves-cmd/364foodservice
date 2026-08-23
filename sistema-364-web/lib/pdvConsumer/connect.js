// Cliente HTTP do painel Consumer Connect. O painel não tem API: estas são as
// chamadas que as próprias telas fazem (DataTables server-side + modais em
// HTML). Filtro de loja e de período são estado de sessão no servidor — por
// isso setLoja/setPeriodo existem e precisam vir antes das consultas.
//
// Recebe `fetch` injetável para teste. Nunca loga o cookie.

export class SessaoExpiradaError extends Error {
  constructor() { super('SESSAO_EXPIRADA: o cookie do Consumer Connect não é mais aceito; abra o painel no navegador, faça login e copie o cookie de novo (scripts/IMPORTACAO-PDV.md).'); this.name = 'SessaoExpiradaError'; }
}

export const COLUNAS = {
  pedidos: ['Codigo', 'Origem', 'Tipo', 'NomeCliente', 'QtdItens', 'ValorTotal', 'Status', 'DataHoraAberturaText', 'DuracaoText', 'Estabelecimento', 'DataHoraExclusaotext'],
  caixas: ['Codigo', 'NomeUsuario', 'DataHoraAberturaText', 'DataHoraFechamentoText', 'SaldoInicial', 'SaldoFinal', 'Observacao', 'StatusCaixa', 'Estabelecimento'],
  recebimentos: ['CategoriaContaText', 'FormaPagamentoText', 'DataHoraPagamentoText', 'DataCreditoText', 'Valor', 'ValorLiquido', 'PedidoCodigo', 'NomeColaborador', 'CaixaCodigo', 'Estabelecimento'],
};

function corpoDataTables(colunas, start, length) {
  const p = new URLSearchParams();
  p.set('draw', '1');
  p.set('start', String(start));
  p.set('length', String(length));
  p.set('search[value]', '');
  p.set('search[regex]', 'false');
  p.set('order[0][column]', '0');
  p.set('order[0][dir]', 'desc');
  colunas.forEach((c, i) => {
    p.set(`columns[${i}][data]`, c);
    p.set(`columns[${i}][name]`, '');
    p.set(`columns[${i}][searchable]`, 'true');
    p.set(`columns[${i}][orderable]`, 'true');
    p.set(`columns[${i}][search][value]`, '');
    p.set(`columns[${i}][search][regex]`, 'false');
  });
  return p.toString();
}

function pareceLogin(resp, texto) {
  if (resp.redirected && /autenticacao\/login/i.test(resp.url || '')) return true;
  return /<form[^>]*autenticacao\/login/i.test(texto);
}

export function criarClienteConnect({ cookie, fetch = globalThis.fetch, base = 'https://connect.consumer.com.br', pausaMs = 300, dormir } = {}) {
  if (!cookie) throw new Error('CONSUMER_CONNECT_COOKIE não informado.');
  const esperar = dormir || (ms => new Promise(r => setTimeout(r, ms)));
  const cabecalhos = extra => ({
    Cookie: cookie,
    'X-Requested-With': 'XMLHttpRequest',
    Accept: 'application/json, text/html, */*',
    ...extra,
  });

  async function chamar(caminho, { method = 'GET', body } = {}) {
    let ultimoErro;
    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      if (pausaMs) await esperar(pausaMs);
      const resp = await fetch(base + caminho, {
        method,
        headers: cabecalhos(body !== undefined ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        body,
        redirect: 'follow',
      });
      const texto = await resp.text();
      if (pareceLogin(resp, texto)) throw new SessaoExpiradaError();
      if (resp.ok) return texto;
      ultimoErro = new Error(`Connect ${method} ${caminho} respondeu ${resp.status}`);
      await esperar(500 * tentativa);
    }
    throw ultimoErro;
  }

  function json(texto, caminho) {
    let obj;
    try { obj = JSON.parse(texto); } catch { throw new Error(`Connect ${caminho} não devolveu JSON`); }
    if (obj && obj.error) throw new Error(`Connect ${caminho}: ${obj.message || 'erro'}`);
    return obj;
  }

  return {
    async setLoja(idConnect) {
      await chamar('/QueryFilters/SetDatabaseFilter', { method: 'POST', body: `ids=${idConnect}` });
    },
    async setPeriodo(de, ate) {
      // Não usa URLSearchParams aqui: ele codifica espaço como "+", e o painel
      // (e os testes) esperam "%20" — decodeURIComponent não converte "+" de volta.
      const body = `start=${encodeURIComponent(`${de} 00:00`)}&end=${encodeURIComponent(`${ate} 23:59`)}`;
      await chamar('/QueryFilters/SetDateFilter', { method: 'POST', body });
    },
    async listar(caminho, colunas, { tamanhoPagina = 200 } = {}) {
      const linhas = [];
      let start = 0, total = Infinity;
      while (start < total) {
        const obj = json(await chamar(caminho, { method: 'POST', body: corpoDataTables(colunas, start, tamanhoPagina) }), caminho);
        const pagina = obj.data || [];
        linhas.push(...pagina);
        total = Number(obj.recordsTotal ?? 0);
        if (!pagina.length) break;
        start += pagina.length;
      }
      return linhas;
    },
    async detalhe(caminho, id) {
      return chamar(`${caminho}?id=${encodeURIComponent(id)}`);
    },
    async produtosVendidos() {
      const obj = json(await chamar('/Produtos/GetProdutosVendidos', { method: 'POST', body: '' }), '/Produtos/GetProdutosVendidos');
      return Array.isArray(obj) ? obj : (obj.data || []);
    },
  };
}
