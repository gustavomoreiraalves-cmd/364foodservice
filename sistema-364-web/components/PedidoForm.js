'use client';
import { useState } from 'react';
import { fmtMoney } from '../lib/format';
import { precoDoItem, totalPedido } from '../lib/pedidos';

// Cabeçalho e itens do pedido de venda. Usado pelo cadastro em /pedidos e pela
// edição em /pedidos/[id]. Não fala com o Supabase: quem chama é que grava.
export default function PedidoForm({
  cabecalho, setCabecalho, itens, setItens,
  clientes, produtos, funcionarios, saldoProduto,
  somenteLeitura = false,
}) {
  const [novoItem, setNovoItem] = useState({ produto_id: '', quantidade: '', preco_unitario: '' });

  function addItem(e) {
    e.preventDefault();
    const prod = produtos.find(p => p.id === novoItem.produto_id);
    if (!prod) return;
    const preco = precoDoItem(novoItem.preco_unitario, prod);
    setItens([...itens, { produto_id: prod.id, quantidade: Number(novoItem.quantidade), preco_unitario: preco }]);
    setNovoItem({ produto_id: '', quantidade: '', preco_unitario: '' });
  }

  function removerItem(idx) {
    setItens(itens.filter((_, i) => i !== idx));
  }

  const excedeSaldo = it => Number(it.quantidade) > saldoProduto(it.produto_id);

  return (
    <>
      <div className="form-grid">
        <div><label>Data</label>
          <input type="date" disabled={somenteLeitura} value={cabecalho.data}
            onChange={e => setCabecalho({ ...cabecalho, data: e.target.value })} />
        </div>
        <div><label>Cliente</label>
          <select disabled={somenteLeitura} value={cabecalho.cliente_id}
            onChange={e => setCabecalho({ ...cabecalho, cliente_id: e.target.value })}>
            <option value="">Selecione…</option>
            {clientes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </div>
        <div><label>Responsável</label>
          <select disabled={somenteLeitura} value={cabecalho.responsavel_id}
            onChange={e => setCabecalho({ ...cabecalho, responsavel_id: e.target.value })}>
            <option value="">Selecione…</option>
            {funcionarios.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
        </div>
        <div><label>Observações</label>
          <input type="text" disabled={somenteLeitura} value={cabecalho.observacoes || ''}
            placeholder="Ex.: entregar antes das 10h"
            onChange={e => setCabecalho({ ...cabecalho, observacoes: e.target.value })} />
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <label>Itens do pedido</label>
        {!somenteLeitura && (
          <form className="form-grid" onSubmit={addItem}>
            <div><label>Produto</label>
              <select required value={novoItem.produto_id}
                onChange={e => setNovoItem({ ...novoItem, produto_id: e.target.value })}>
                <option value="">Selecione…</option>
                {produtos.map(p => <option key={p.id} value={p.id}>{p.codigo} — {p.nome} (saldo: {saldoProduto(p.id).toFixed(1)})</option>)}
              </select>
            </div>
            <div><label>Quantidade</label>
              <input type="number" step="0.001" min="0.001" required value={novoItem.quantidade}
                onChange={e => setNovoItem({ ...novoItem, quantidade: e.target.value })} />
            </div>
            <div><label>Preço unit. (R$ — vazio usa o preço de venda)</label>
              <input type="number" step="0.01" min="0" value={novoItem.preco_unitario}
                onChange={e => setNovoItem({ ...novoItem, preco_unitario: e.target.value })} />
            </div>
            <div><button className="btn secondary" type="submit">Adicionar item</button></div>
          </form>
        )}

        <div className="items-list">
          {itens.length ? itens.map((it, idx) => {
            const prod = produtos.find(p => p.id === it.produto_id);
            return (
              <div className="item-line" key={it.id || `novo-${idx}`}>
                <span>
                  {prod?.nome || '—'}
                  {excedeSaldo(it) && <span className="tag warn" style={{ marginLeft: 8 }}>acima do saldo</span>}
                </span>
                <span className="num">{Number(it.quantidade)} × {fmtMoney(it.preco_unitario)}</span>
                {!somenteLeitura && <button className="btn danger small" type="button" onClick={() => removerItem(idx)}>×</button>}
              </div>
            );
          }) : <p className="muted" style={{ fontSize: 12 }}>Nenhum item adicionado ainda.</p>}
          {itens.length > 0 && <div className="subtotal">Total: {fmtMoney(totalPedido(itens))}</div>}
        </div>
      </div>
    </>
  );
}
