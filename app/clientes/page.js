'use client';
import { Fragment, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { fmtMoney } from '../../lib/format';
import AppShell from '../../components/AppShell';

const FORM_VAZIO = { nome: '', cnpj: '', tipo: 'Revenda', contato: '', telefone: '' };
const TIPOS = ['Revenda', 'Distribuidor', 'Food Service', 'Consumidor Final'];

export default function ClientesPage() {
  return (
    <AppShell modulo="clientes" titulo="Clientes" desc="Cadastro de clientes e revendas">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const [lista, setLista] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [precos, setPrecos] = useState([]);          // tabela B2B (cliente_precos)
  const [temTabelaB2B, setTemTabelaB2B] = useState(true);
  const [precosAberto, setPrecosAberto] = useState(null); // cliente com editor de preços aberto
  const [novoPreco, setNovoPreco] = useState({});
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(FORM_VAZIO);

  async function carregar() {
    setLoading(true);
    const [r1, r2, r3] = await Promise.all([
      supabase.from('clientes').select('*').order('nome'),
      supabase.from('produtos').select('id, codigo, nome, preco_venda').order('codigo'),
      supabase.from('cliente_precos').select('*'),
    ]);
    setLista(r1.data || []);
    setProdutos(r2.data || []);
    if (r3.error) { setTemTabelaB2B(false); } else { setPrecos(r3.data || []); setTemTabelaB2B(true); }
    setLoading(false);
  }

  useEffect(() => { carregar(); }, []);

  async function adicionar(e) {
    e.preventDefault();
    const { error } = await supabase.from('clientes').insert([form]);
    if (error) { alert('Erro ao salvar: ' + error.message); return; }
    setForm(FORM_VAZIO);
    carregar();
  }

  async function excluir(id) {
    if (!confirm('Excluir este cliente?')) return;
    const { error } = await supabase.from('clientes').delete().eq('id', id);
    if (error) alert('Não foi possível excluir (pode haver pedidos vinculados): ' + error.message);
    carregar();
  }

  // ----- Tabela de preços B2B por cliente -----
  async function salvarPreco(clienteId) {
    const np = novoPreco[clienteId] || {};
    if (!np.produto_id || !np.preco) return;
    const { error } = await supabase.from('cliente_precos').upsert(
      [{ cliente_id: clienteId, produto_id: np.produto_id, preco: Number(np.preco) }],
      { onConflict: 'cliente_id,produto_id' }
    );
    if (error) { alert('Erro ao salvar preço: ' + error.message); return; }
    setNovoPreco({ ...novoPreco, [clienteId]: { produto_id: '', preco: '' } });
    carregar();
  }

  async function removerPreco(id) {
    const { error } = await supabase.from('cliente_precos').delete().eq('id', id);
    if (error) alert('Erro ao remover: ' + error.message);
    carregar();
  }

  return (
    <>
      <div className="panel">
        <h3>Novo cliente</h3>
        <form onSubmit={adicionar} className="form-grid">
          <div><label>Nome / Razão social</label><input required value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} /></div>
          <div><label>CNPJ/CPF</label><input value={form.cnpj} onChange={e => setForm({ ...form, cnpj: e.target.value })} /></div>
          <div><label>Tipo</label>
            <select value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })}>
              {TIPOS.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div><label>Contato</label><input value={form.contato} onChange={e => setForm({ ...form, contato: e.target.value })} /></div>
          <div><label>Telefone</label><input value={form.telefone} onChange={e => setForm({ ...form, telefone: e.target.value })} /></div>
          <div><button className="btn" type="submit">Adicionar cliente</button></div>
        </form>
      </div>

      <div className="panel">
        <h3>Clientes cadastrados ({lista.length})</h3>
        {loading ? <p className="muted">Carregando…</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Nome</th><th>Tipo</th><th>CNPJ/CPF</th><th>Contato</th><th>Telefone</th><th></th></tr></thead>
              <tbody>
                {lista.length ? lista.map(c => {
                  const precosCliente = precos.filter(p => p.cliente_id === c.id);
                  const aberto = precosAberto === c.id;
                  const np = novoPreco[c.id] || { produto_id: '', preco: '' };
                  return (
                  <Fragment key={c.id}>
                  <tr>
                    <td>{c.nome}</td>
                    <td>{c.tipo || '—'}</td>
                    <td className="muted">{c.cnpj || '—'}</td>
                    <td>{c.contato || '—'}</td>
                    <td className="muted">{c.telefone || '—'}</td>
                    <td>
                      <div className="row-actions">
                        {temTabelaB2B && (
                          <button className="btn secondary small" onClick={() => setPrecosAberto(aberto ? null : c.id)}>
                            Preços B2B{precosCliente.length ? ` (${precosCliente.length})` : ''}
                          </button>
                        )}
                        <button className="btn danger" onClick={() => excluir(c.id)}>Excluir</button>
                      </div>
                    </td>
                  </tr>
                  {aberto && (
                    <tr>
                      <td colSpan={6} style={{ background: 'rgba(255,255,255,0.02)' }}>
                        <div style={{ padding: '10px 6px' }}>
                          <label style={{ marginBottom: 6 }}>Tabela de preços deste cliente (vale no lugar do preço de varejo nos pedidos)</label>
                          {precosCliente.length ? precosCliente.map(pc => {
                            const prod = produtos.find(p => p.id === pc.produto_id);
                            return (
                              <div className="item-line" key={pc.id}>
                                <span>{prod ? `${prod.codigo} — ${prod.nome}` : '—'}</span>
                                <span className="num">{fmtMoney(pc.preco)} <span className="muted" style={{ fontSize: 11 }}>(varejo: {fmtMoney(prod?.preco_venda)})</span></span>
                                <button className="btn danger small" onClick={() => removerPreco(pc.id)}>×</button>
                              </div>
                            );
                          }) : <p className="muted" style={{ fontSize: 12 }}>Nenhum preço especial — os pedidos usam o preço de varejo.</p>}
                          <div className="form-grid" style={{ marginTop: 8 }}>
                            <div><label>Produto</label>
                              <select value={np.produto_id} onChange={e => setNovoPreco({ ...novoPreco, [c.id]: { ...np, produto_id: e.target.value } })}>
                                <option value="">Selecione…</option>
                                {produtos.map(p => <option key={p.id} value={p.id}>{p.codigo} — {p.nome}</option>)}
                              </select>
                            </div>
                            <div><label>Preço para este cliente (R$)</label>
                              <input type="number" step="0.01" value={np.preco} onChange={e => setNovoPreco({ ...novoPreco, [c.id]: { ...np, preco: e.target.value } })} />
                            </div>
                            <div><button className="btn secondary" onClick={() => salvarPreco(c.id)}>Salvar preço</button></div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                  );
                }) : <tr className="empty-row"><td colSpan={6}>Nenhum cliente cadastrado.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
