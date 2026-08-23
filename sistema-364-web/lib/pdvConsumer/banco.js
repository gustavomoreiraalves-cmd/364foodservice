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
export function bancoSeco() {
  return {
    async pedidosExistentes() { return new Map(); },
    async gravarPedido() {},
    async caixasExistentes() { return new Map(); },
    async gravarCaixa() {},
    async substituirRecebimentos() {},
    async substituirItensDia() {},
  };
}
