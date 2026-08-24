// Implementação compartilhada do contrato de banco usado por importarLoja
// (ver lib/pdvConsumer/importar.js). Extraído de scripts/importar-pdv-consumer.mjs
// para ser reusado também pelo importador do backup Firebird.
const falhou = (erro, ctx) => { if (erro) throw new Error(`${ctx}: ${erro.message}`); };

export function bancoSupabase(sb) {
  return {
    async pedidosExistentes(empresaId, codigos) {
      const mapa = new Map();
      for (let i = 0; i < codigos.length; i += 500) {
        const { data, error } = await sb.from('pdv_pedidos')
          .select('id, codigo, status, valor_total, excluido_em, fechado_em')
          .eq('empresa_id', empresaId).in('codigo', codigos.slice(i, i + 500));
        falhou(error, 'pedidosExistentes');
        for (const p of data || []) mapa.set(p.codigo, p);
      }
      return mapa;
    },
    async gravarPedido({ pedido, itens, pagamentos }) {
      const { data, error } = await sb.from('pdv_pedidos').upsert(pedido, { onConflict: 'empresa_id,codigo' }).select('id').single();
      falhou(error, `gravarPedido ${pedido.codigo}`);
      const pedidoId = data.id;
      falhou((await sb.from('pdv_pedido_itens').delete().eq('pedido_id', pedidoId)).error, 'apagar itens');
      falhou((await sb.from('pdv_pagamentos').delete().eq('pedido_id', pedidoId)).error, 'apagar pagamentos');
      if (itens.length) falhou((await sb.from('pdv_pedido_itens').insert(itens.map(i => ({ ...i, pedido_id: pedidoId })))).error, 'inserir itens');
      if (pagamentos.length) falhou((await sb.from('pdv_pagamentos').insert(pagamentos.map(p => ({ ...p, pedido_id: pedidoId })))).error, 'inserir pagamentos');
    },
    // Caminho em lote da carga histórica: upsert de até 500 pedidos por
    // requisição, depois delete+insert dos filhos também em lote. Mesmo
    // resultado do gravarPedido um a um, com ~100x menos requisições.
    async gravarPedidosLote(lista) {
      if (!lista.length) return;
      const porCodigo = new Map(lista.map(l => [l.pedido.codigo, l]));
      const empresaId = lista[0].pedido.empresa_id;
      const ids = new Map(); // codigo -> id
      for (let i = 0; i < lista.length; i += 500) {
        const fatia = lista.slice(i, i + 500).map(l => l.pedido);
        const { data, error } = await sb.from('pdv_pedidos')
          .upsert(fatia, { onConflict: 'empresa_id,codigo' }).select('id, codigo');
        falhou(error, 'gravarPedidosLote upsert');
        for (const r of data || []) ids.set(r.codigo, r.id);
      }
      const todosIds = [...ids.values()];
      for (let i = 0; i < todosIds.length; i += 200) {
        const fatia = todosIds.slice(i, i + 200);
        falhou((await sb.from('pdv_pedido_itens').delete().in('pedido_id', fatia)).error, 'lote: apagar itens');
        falhou((await sb.from('pdv_pagamentos').delete().in('pedido_id', fatia)).error, 'lote: apagar pagamentos');
      }
      const itens = [], pagamentos = [];
      for (const [codigo, l] of porCodigo) {
        const pedidoId = ids.get(codigo);
        if (!pedidoId) throw new Error(`gravarPedidosLote: upsert não devolveu id do pedido ${codigo} (empresa ${empresaId})`);
        for (const it of l.itens) itens.push({ ...it, pedido_id: pedidoId });
        for (const pg of l.pagamentos) pagamentos.push({ ...pg, pedido_id: pedidoId });
      }
      for (let i = 0; i < itens.length; i += 500) {
        falhou((await sb.from('pdv_pedido_itens').insert(itens.slice(i, i + 500))).error, 'lote: inserir itens');
      }
      for (let i = 0; i < pagamentos.length; i += 500) {
        falhou((await sb.from('pdv_pagamentos').insert(pagamentos.slice(i, i + 500))).error, 'lote: inserir pagamentos');
      }
    },
    async caixasExistentes(empresaId, codigos) {
      const mapa = new Map();
      for (let i = 0; i < codigos.length; i += 500) {
        const { data, error } = await sb.from('pdv_caixas')
          .select('id, codigo, status')
          .eq('empresa_id', empresaId).in('codigo', codigos.slice(i, i + 500));
        falhou(error, 'caixasExistentes');
        for (const c of data || []) mapa.set(c.codigo, c);
      }
      return mapa;
    },
    async gravarCaixa({ caixa, movimentos }) {
      const { data, error } = await sb.from('pdv_caixas').upsert(caixa, { onConflict: 'empresa_id,codigo' }).select('id').single();
      falhou(error, `gravarCaixa ${caixa.codigo}`);
      falhou((await sb.from('pdv_caixa_movimentos').delete().eq('caixa_id', data.id)).error, 'apagar movimentos');
      if (movimentos.length) falhou((await sb.from('pdv_caixa_movimentos').insert(movimentos.map(m => ({ ...m, caixa_id: data.id })))).error, 'inserir movimentos');
    },
    // Sem chave natural (parcelas iguais colidem): apaga e regrava a janela.
    async substituirRecebimentos(empresaId, de, ate, linhas) {
      falhou((await sb.from('pdv_recebimentos').delete()
        .eq('empresa_id', empresaId).gte('dia_pagamento', de).lte('dia_pagamento', ate)).error, 'apagar recebimentos da janela');
      for (let i = 0; i < linhas.length; i += 500) {
        falhou((await sb.from('pdv_recebimentos').insert(linhas.slice(i, i + 500))).error, 'inserir recebimentos');
      }
    },
    async substituirItensDia(empresaId, dia, linhas) {
      falhou((await sb.from('pdv_vendas_itens_dia').delete().eq('empresa_id', empresaId).eq('dia', dia)).error, 'apagar itens do dia');
      if (linhas.length) falhou((await sb.from('pdv_vendas_itens_dia').insert(linhas)).error, 'inserir itens do dia');
    },
  };
}

// Em --dry-run o banco só conta; nada é escrito.
// (bancoSeco ganha o mesmo método de lote como no-op, abaixo.)
export function bancoSeco() {
  return {
    async pedidosExistentes() { return new Map(); },
    async gravarPedido() {},
    async gravarPedidosLote() {},
    async caixasExistentes() { return new Map(); },
    async gravarCaixa() {},
    async substituirRecebimentos() {},
    async substituirItensDia() {},
  };
}
