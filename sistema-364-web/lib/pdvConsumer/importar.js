// Orquestra a importação de uma loja numa janela de datas. Recebe o cliente
// do Connect e o "banco" (ver contrato em scripts/importar-pdv-consumer.mjs)
// por injeção, para o fluxo inteiro ser testável sem rede nem Supabase.
import { COLUNAS, SessaoExpiradaError } from './connect.js';
import { parsePedidoDetalhe, parseCaixaDetalhe } from './parse.js';
import { normalizaPedido, normalizaCaixa, normalizaRecebimento, normalizaItemDia, pedidoMudou } from './normaliza.js';

export function diasEntre(de, ate) {
  const dias = [];
  let d = new Date(de + 'T00:00:00Z');
  const fim = new Date(ate + 'T00:00:00Z');
  while (d <= fim) {
    dias.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 86400000);
  }
  return dias;
}

export async function importarLoja({ cliente, banco, loja, de, ate, log = () => {} }) {
  const empresaId = loja.empresa_id;
  const avisos = [];
  const r = { pedidos: 0, caixas: 0, recebimentos: 0, itensDia: 0 };

  await cliente.setLoja(loja.id_connect);
  await cliente.setPeriodo(de, ate);

  // ---- pedidos ----
  const linhasPedidos = await cliente.listar('/Pedidos/GetListaPedidos', COLUNAS.pedidos);
  log(`  pedidos na janela: ${linhasPedidos.length}`);
  const existentes = await banco.pedidosExistentes(empresaId, linhasPedidos.map(l => Number(l.Codigo)));
  for (const linha of linhasPedidos) {
    const atual = existentes.get(Number(linha.Codigo)) || null;
    if (!pedidoMudou(linha, atual)) continue;
    let detalhe = null;
    if (/^finalizado/i.test(linha.Status || '')) {
      try {
        const html = await cliente.detalhe('/Pedidos/GetDetalhesPedido', linha.ID);
        detalhe = { ...parsePedidoDetalhe(html), html };
      } catch (e) {
        if (e instanceof SessaoExpiradaError) throw e;
        avisos.push(`pedido ${linha.Codigo}: detalhe falhou (${e.message})`);
        continue;
      }
    }
    await banco.gravarPedido(normalizaPedido({ linha, detalhe, empresaId }));
    r.pedidos++;
  }

  // ---- caixas ----
  const linhasCaixas = await cliente.listar('/Financeiro/GetHistoricoCaixa', COLUNAS.caixas);
  const caixasBanco = await banco.caixasExistentes(empresaId, linhasCaixas.map(l => Number(l.Codigo)));
  for (const linha of linhasCaixas) {
    const atual = caixasBanco.get(Number(linha.Codigo));
    // Caixa fechado que já está fechado no banco não muda mais.
    if (atual && atual.status === 'Fechado' && linha.StatusCaixa === 'Fechado') continue;
    let detalhe = null;
    try {
      const html = await cliente.detalhe('/Financeiro/GetDetalhesCaixa', linha.ID);
      detalhe = { ...parseCaixaDetalhe(html), html };
    } catch (e) {
      if (e instanceof SessaoExpiradaError) throw e;
      avisos.push(`caixa ${linha.Codigo}: detalhe falhou (${e.message})`);
      continue;
    }
    await banco.gravarCaixa(normalizaCaixa({ linha, detalhe, empresaId }));
    r.caixas++;
  }

  // ---- recebimentos ----
  // Recebimento não tem chave natural confiável (duas parcelas do mesmo pedido
  // são iguais em tudo), então a janela de `dia_pagamento` é apagada e
  // regravada inteira. Chamado mesmo com 0 linhas: é assim que um lançamento
  // estornado no painel some do banco. `r.recebimentos` = linhas gravadas na
  // janela.
  const linhasReceb = await cliente.listar('/Financeiro/GetRecebimentos', COLUNAS.recebimentos);
  const recebimentos = linhasReceb.map(l => normalizaRecebimento(l, empresaId));
  await banco.substituirRecebimentos(empresaId, de, ate, recebimentos);
  r.recebimentos = recebimentos.length;

  // ---- itens vendidos por dia ----
  for (const dia of diasEntre(de, ate)) {
    await cliente.setPeriodo(dia, dia);
    const itens = await cliente.produtosVendidos();
    // Lista vazia é ambígua: pode ser dia sem venda, mas também é o que o
    // Connect devolve quando o relatório falha. Apagar um snapshot bom por
    // causa disso é pior que manter o dado antigo — avisa e segue.
    if (itens.length === 0) {
      avisos.push(`itens ${dia}: Connect devolveu 0 itens; snapshot do dia mantido`);
      continue;
    }
    await banco.substituirItensDia(empresaId, dia, itens.map(i => normalizaItemDia(i, dia, empresaId)));
    r.itensDia += itens.length;
  }

  return { ...r, avisos };
}
