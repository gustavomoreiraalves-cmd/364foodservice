'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { fmtMoney, fmtDate, hoje } from '../../lib/format';
import AppShell from '../../components/AppShell';
import FichaPrint, { imprimirFicha } from '../../components/FichaPrint';

const STATUS = ['Pendente', 'Faturado', 'Enviado', 'Cancelado'];

export default function PedidosPage() {
  const [ficha, setFicha] = useState(null);
  return (
    <>
      <AppShell modulo="pedidos" titulo="Pedidos de Venda" desc="Pedidos, faturamento e baixa de estoque">
        <Conteudo setFicha={setFicha} />
      </AppShell>
      <FichaPrint ficha={ficha} />
    </>
  );
}

function Conteudo({ setFicha }) {
  const [pedidos, setPedidos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [estoqueProd, setEstoqueProd] = useState([]);
  const [funcionarios, setFuncionarios] = useState([]);
  const [precosB2B, setPrecosB2B] = useState([]);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const [cabecalho, setCabecalho] = useState({ data: hoje(), cliente_id: '', responsavel_id: '' });
  const [itens, setItens] = useState([]);
  const [novoItem, setNovoItem] = useState({ produto_id: '', quantidade: '', preco_unitario: '' });

  async function carregar() {
    setLoading(true);
    const [r1, r2, r3, r4, r5, r6] = await Promise.all([
      supabase.from('pedidos').select('*, clientes(nome, cnpj, telefone), funcionarios(nome), pedido_itens(id, quantidade, preco_unitario, produtos(codigo, nome, unidade))').order('created_at', { ascending: false }),
      supabase.from('clientes').select('id, nome').order('nome'),
      supabase.from('produtos').select('*').order('codigo'),
      supabase.from('vw_estoque_produto').select('*'),
      supabase.from('funcionarios').select('id, nome').eq('ativo', true).order('nome'),
      supabase.from('cliente_precos').select('*'),
    ]);
    setPedidos(r1.data || []);
    setClientes(r2.data || []);
    setProdutos(r3.data || []);
    setEstoqueProd(r4.data || []);
    setFuncionarios(r5.data || []);
    setPrecosB2B(r6.error ? [] : (r6.data || [])); // tabela pode não existir ainda (atualizacao_05)
    setLoading(false);
  }

  useEffect(() => { carregar(); }, []);

  function saldoProduto(id) {
    return Number(estoqueProd.find(e => e.produto_id === id)?.saldo || 0);
  }

  // Preço B2B do cliente selecionado para um produto (null se não houver tabela especial)
  function precoDoCliente(produtoId) {
    if (!cabecalho.cliente_id) return null;
    const pc = precosB2B.find(p => p.cliente_id === cabecalho.cliente_id && p.produto_id === produtoId);
    return pc ? Number(pc.preco) : null;
  }

  function addItem(e) {
    e.preventDefault();
    const prod = produtos.find(p => p.id === novoItem.produto_id);
    if (!prod) return;
    // prioridade: preço digitado > tabela B2B do cliente > preço de varejo
    const preco = Number(novoItem.preco_unitario) || precoDoCliente(prod.id) || Number(prod.preco_venda);
    setItens([...itens, { produto_id: prod.id, quantidade: Number(novoItem.quantidade), preco_unitario: preco }]);
    setNovoItem({ produto_id: '', quantidade: '', preco_unitario: '' });
  }

  async function finalizar() {
    if (!itens.length) { alert('Adicione ao menos um item ao pedido.'); return; }
    if (!cabecalho.cliente_id) { alert('Selecione o cliente.'); return; }
    setSalvando(true);
    const { data: pedido, error } = await supabase.from('pedidos').insert([{
      data: cabecalho.data,
      cliente_id: cabecalho.cliente_id,
      status: 'Pendente',
      responsavel_id: cabecalho.responsavel_id || null,
    }]).select().single();
    if (error) { setSalvando(false); alert('Erro ao salvar: ' + error.message); return; }

    const { error: e2 } = await supabase.from('pedido_itens').insert(
      itens.map(i => ({ pedido_id: pedido.id, ...i }))
    );
    setSalvando(false);
    if (e2) { alert('Pedido criado, mas houve erro nos itens: ' + e2.message); }
    setItens([]);
    setCabecalho({ data: hoje(), cliente_id: '', responsavel_id: '' });
    carregar();
  }

  async function mudarStatus(id, status) {
    const { error } = await supabase.from('pedidos').update({ status }).eq('id', id);
    if (error) alert('Erro ao atualizar status: ' + error.message);
    carregar();
  }

  async function excluir(id) {
    if (!confirm('Excluir este pedido?')) return;
    const { error } = await supabase.from('pedidos').delete().eq('id', id);
    if (error) alert('Erro ao excluir: ' + error.message);
    carregar();
  }

  const totalPedido = p => (p.pedido_itens || []).reduce((s, i) => s + Number(i.quantidade) * Number(i.preco_unitario), 0);

  function imprimir(p) {
    imprimirFicha(setFicha, {
      titulo: 'Pedido de Venda',
      numero: `Pedido ${String(p.id).slice(0, 8).toUpperCase()} · ${fmtDate(p.data)}`,
      campos: [
        { rot: 'Data', valor: fmtDate(p.data) },
        { rot: 'Status', valor: p.status },
        { rot: 'Cliente', valor: p.clientes?.nome },
        { rot: 'CNPJ/CPF', valor: p.clientes?.cnpj },
        { rot: 'Telefone', valor: p.clientes?.telefone },
        { rot: 'Responsável', valor: p.funcionarios?.nome },
      ],
      itens: {
        headers: ['Código', 'Produto', 'Qtd', 'Preço unit.', 'Subtotal'],
        rows: (p.pedido_itens || []).map(i => [
          i.produtos?.codigo || '—',
          i.produtos?.nome || '—',
          `${Number(i.quantidade)} ${i.produtos?.unidade || ''}`,
          fmtMoney(i.preco_unitario),
          fmtMoney(Number(i.quantidade) * Number(i.preco_unitario)),
        ]),
      },
      totais: `Total do pedido: ${fmtMoney(totalPedido(p))}`,
      assinaturas: ['Vendedor', 'Cliente'],
    });
  }

  if (loading) return <p className="muted">Carregando…</p>;

  if (!clientes.length || !produtos.length) {
    return (
      <div className="banner info">
        Cadastre ao menos um <b>cliente</b> e um <b>produto</b> antes de lançar um pedido de venda.
      </div>
    );
  }

  const statusTag = s => {
    const map = { Pendente: 'warn', Faturado: 'ok', Enviado: 'ok', Cancelado: 'bad' };
    return <span className={`tag ${map[s] || 'warn'}`}>{s}</span>;
  };

  return (
    <>
      <div className="panel">
        <h3>Novo pedido de venda</h3>
        <div className="form-grid">
          <div><label>Data</label><input type="date" value={cabecalho.data} onChange={e => setCabecalho({ ...cabecalho, data: e.target.value })} /></div>
          <div><label>Cliente</label>
            <select value={cabecalho.cliente_id} onChange={e => setCabecalho({ ...cabecalho, cliente_id: e.target.value })}>
              <option value="">Selecione…</option>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
          <div><label>Responsável</label>
            <select value={cabecalho.responsavel_id} onChange={e => setCabecalho({ ...cabecalho, responsavel_id: e.target.value })}>
              <option value="">Selecione…</option>
              {funcionarios.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <label>Itens do pedido</label>
          <form className="form-grid" onSubmit={addItem}>
            <div><label>Produto</label>
              <select required value={novoItem.produto_id} onChange={e => setNovoItem({ ...novoItem, produto_id: e.target.value })}>
                <option value="">Selecione…</option>
                {produtos.map(p => <option key={p.id} value={p.id}>{p.codigo} — {p.nome} (saldo: {saldoProduto(p.id).toFixed(1)})</option>)}
              </select>
            </div>
            <div><label>Quantidade</label><input type="number" step="0.001" required value={novoItem.quantidade} onChange={e => setNovoItem({ ...novoItem, quantidade: e.target.value })} /></div>
            <div><label>Preço unit. (R$ — vazio usa a tabela do cliente ou o varejo)</label>
              <input type="number" step="0.01" value={novoItem.preco_unitario} onChange={e => setNovoItem({ ...novoItem, preco_unitario: e.target.value })} />
              {novoItem.produto_id && !novoItem.preco_unitario && (() => {
                const b2b = precoDoCliente(novoItem.produto_id);
                const prod = produtos.find(p => p.id === novoItem.produto_id);
                return (
                  <p className="muted" style={{ fontSize: 11.5, marginTop: 4, marginBottom: 0 }}>
                    {b2b !== null
                      ? <span style={{ color: '#8fbd6f', fontWeight: 600 }}>Tabela B2B deste cliente: {fmtMoney(b2b)}</span>
                      : <>Será usado o varejo: {fmtMoney(prod?.preco_venda)}</>}
                  </p>
                );
              })()}
            </div>
            <div><button className="btn secondary" type="submit">Adicionar item</button></div>
          </form>
          <div className="items-list">
            {itens.length ? itens.map((it, idx) => {
              const prod = produtos.find(p => p.id === it.produto_id);
              return (
                <div className="item-line" key={idx}>
                  <span>{prod?.nome || '—'}</span>
                  <span className="num">{it.quantidade} × {fmtMoney(it.preco_unitario)}</span>
                  <button className="btn danger small" onClick={() => setItens(itens.filter((_, i) => i !== idx))}>×</button>
                </div>
              );
            }) : <p className="muted" style={{ fontSize: 12 }}>Nenhum item adicionado ainda.</p>}
            {itens.length > 0 && (
              <div className="subtotal">Total: {fmtMoney(itens.reduce((s, i) => s + i.quantidade * i.preco_unitario, 0))}</div>
            )}
          </div>
          <button className="btn" style={{ marginTop: 12 }} onClick={finalizar} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Finalizar pedido'}
          </button>
        </div>
      </div>

      <div className="panel">
        <h3>Pedidos lançados ({pedidos.length})</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Data</th><th>Cliente</th><th>Itens</th><th>Total</th><th>Status</th><th>Responsável</th><th></th></tr></thead>
            <tbody>
              {pedidos.length ? pedidos.map(p => (
                <tr key={p.id}>
                  <td>{fmtDate(p.data)}</td>
                  <td>{p.clientes?.nome || '—'}</td>
                  <td>{(p.pedido_itens || []).length} item(ns)</td>
                  <td className="num">{fmtMoney(totalPedido(p))}</td>
                  <td>
                    <div className="row-actions">
                      {statusTag(p.status)}
                      <select style={{ width: 'auto' }} value={p.status} onChange={e => mudarStatus(p.id, e.target.value)}>
                        {STATUS.map(s => <option key={s}>{s}</option>)}
                      </select>
                    </div>
                  </td>
                  <td className="muted">{p.funcionarios?.nome || '—'}</td>
                  <td>
                    <div className="row-actions">
                      <button className="btn secondary small" onClick={() => imprimir(p)}>Imprimir pedido</button>
                      <button className="btn danger" onClick={() => excluir(p.id)}>Excluir</button>
                    </div>
                  </td>
                </tr>
              )) : <tr className="empty-row"><td colSpan={7}>Nenhum pedido lançado.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
