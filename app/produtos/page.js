'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { fmtMoney, proximoCodigoProduto } from '../../lib/format';
import AppShell from '../../components/AppShell';

const MP_VAZIA = { nome: '', unidade: 'kg', custo_unitario: '', preco_alvo: '' };
const PROD_VAZIO = { nome: '', categoria: '', unidade: 'un', preco_venda: '', validade_dias: 90 };

export default function ProdutosPage() {
  return (
    <AppShell modulo="produtos" titulo="Produtos" desc="Catálogo, ficha técnica, custo e preço de venda">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const [mps, setMps] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [fichas, setFichas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formMP, setFormMP] = useState(MP_VAZIA);
  const [formProd, setFormProd] = useState(PROD_VAZIO);
  const [itemFicha, setItemFicha] = useState({});

  async function carregar() {
    setLoading(true);
    const [r1, r2, r3] = await Promise.all([
      supabase.from('materias_primas').select('*').order('nome'),
      supabase.from('produtos').select('*').order('codigo'),
      supabase.from('ficha_tecnica').select('*, materias_primas(nome, unidade)'),
    ]);
    setMps(r1.data || []);
    setProdutos(r2.data || []);
    setFichas(r3.data || []);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, []);

  async function addMP(e) {
    e.preventDefault();
    const { error } = await supabase.from('materias_primas').insert([{
      ...formMP,
      custo_unitario: Number(formMP.custo_unitario),
      preco_alvo: formMP.preco_alvo ? Number(formMP.preco_alvo) : null,
    }]);
    if (error) { alert('Erro ao salvar: ' + error.message); return; }
    setFormMP(MP_VAZIA);
    carregar();
  }

  async function delMP(id) {
    if (!confirm('Excluir esta matéria-prima?')) return;
    const { error } = await supabase.from('materias_primas').delete().eq('id', id);
    if (error) alert('Não foi possível excluir (ela pode estar em uso em fichas técnicas ou recebimentos): ' + error.message);
    carregar();
  }

  async function addProduto(e) {
    e.preventDefault();
    const codigo = await proximoCodigoProduto();
    const { error } = await supabase.from('produtos').insert([{
      codigo,
      nome: formProd.nome,
      categoria: formProd.categoria || null,
      unidade: formProd.unidade,
      preco_venda: Number(formProd.preco_venda),
      validade_dias: Number(formProd.validade_dias) || 90,
    }]);
    if (error) { alert('Erro ao salvar: ' + error.message); return; }
    setFormProd(PROD_VAZIO);
    carregar();
  }

  async function delProduto(id) {
    if (!confirm('Excluir este produto (e sua ficha técnica)?')) return;
    const { error } = await supabase.from('produtos').delete().eq('id', id);
    if (error) alert('Não foi possível excluir (pode haver produções ou pedidos vinculados): ' + error.message);
    carregar();
  }

  async function addItemFicha(e, produtoId) {
    e.preventDefault();
    const item = itemFicha[produtoId] || {};
    if (!item.materia_prima_id || !item.quantidade) return;
    const { error } = await supabase.from('ficha_tecnica').insert([{
      produto_id: produtoId,
      materia_prima_id: item.materia_prima_id,
      quantidade: Number(item.quantidade),
    }]);
    if (error) { alert('Erro ao salvar: ' + error.message); return; }
    setItemFicha({ ...itemFicha, [produtoId]: { materia_prima_id: item.materia_prima_id, quantidade: '' } });
    carregar();
  }

  async function delItemFicha(id) {
    await supabase.from('ficha_tecnica').delete().eq('id', id);
    carregar();
  }

  function custoTeorico(produtoId) {
    return fichas
      .filter(f => f.produto_id === produtoId)
      .reduce((s, f) => {
        const mp = mps.find(m => m.id === f.materia_prima_id);
        return s + (mp ? Number(f.quantidade) * Number(mp.custo_unitario) : 0);
      }, 0);
  }

  if (loading) return <p className="muted">Carregando…</p>;

  return (
    <>
      <div className="panel">
        <h3>Matérias-primas cadastradas</h3>
        <form onSubmit={addMP} className="form-grid">
          <div><label>Nome</label><input required value={formMP.nome} onChange={e => setFormMP({ ...formMP, nome: e.target.value })} /></div>
          <div><label>Unidade</label>
            <select value={formMP.unidade} onChange={e => setFormMP({ ...formMP, unidade: e.target.value })}>
              <option value="kg">kg</option><option value="g">g</option><option value="un">un</option><option value="L">L</option>
            </select>
          </div>
          <div><label>Custo unitário padrão (R$)</label><input type="number" step="0.01" required value={formMP.custo_unitario} onChange={e => setFormMP({ ...formMP, custo_unitario: e.target.value })} /></div>
          <div><label>Preço-alvo de compra (R$)</label><input type="number" step="0.01" placeholder="opcional" value={formMP.preco_alvo} onChange={e => setFormMP({ ...formMP, preco_alvo: e.target.value })} /></div>
          <div><button className="btn" type="submit">Adicionar matéria-prima</button></div>
        </form>
        <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
          O <b>preço-alvo</b> é o gatilho de oportunidade: quando um recebimento entrar por esse valor ou menos, a tela de Recebimento avisa que é bom momento para estocar (ex.: costela a R$ 20/kg).
        </p>
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table>
            <thead><tr><th>Nome</th><th>Unidade</th><th>Custo padrão</th><th>Preço-alvo</th><th></th></tr></thead>
            <tbody>
              {mps.length ? mps.map(m => (
                <tr key={m.id}>
                  <td>{m.nome}</td><td>{m.unidade}</td>
                  <td className="num">{fmtMoney(m.custo_unitario)}</td>
                  <td className="num">{m.preco_alvo ? fmtMoney(m.preco_alvo) : <span className="muted">—</span>}</td>
                  <td><button className="btn danger" onClick={() => delMP(m.id)}>Excluir</button></td>
                </tr>
              )) : <tr className="empty-row"><td colSpan={5}>Nenhuma matéria-prima.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h3>Novo produto</h3>
        <form onSubmit={addProduto} className="form-grid">
          <div><label>Nome</label><input required value={formProd.nome} onChange={e => setFormProd({ ...formProd, nome: e.target.value })} /></div>
          <div><label>Categoria</label><input placeholder="Defumado, Embutido..." value={formProd.categoria} onChange={e => setFormProd({ ...formProd, categoria: e.target.value })} /></div>
          <div><label>Unidade de venda</label>
            <select value={formProd.unidade} onChange={e => setFormProd({ ...formProd, unidade: e.target.value })}>
              <option value="un">un</option><option value="kg">kg</option><option value="pct">pacote</option>
            </select>
          </div>
          <div><label>Preço de venda (R$)</label><input type="number" step="0.01" required value={formProd.preco_venda} onChange={e => setFormProd({ ...formProd, preco_venda: e.target.value })} /></div>
          <div><label>Validade do produto (dias)</label><input type="number" value={formProd.validade_dias} onChange={e => setFormProd({ ...formProd, validade_dias: e.target.value })} /></div>
          <div><button className="btn" type="submit">Adicionar produto</button></div>
        </form>
        <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
          O código (0364-XXX) é gerado automaticamente. Depois de criar, defina a ficha técnica (matérias-primas usadas) na lista abaixo.
        </p>
      </div>

      <div className="panel">
        <h3>Catálogo de produtos ({produtos.length})</h3>
        {produtos.length ? produtos.map(p => {
          const custoT = custoTeorico(p.id);
          const margem = Number(p.preco_venda) ? ((Number(p.preco_venda) - custoT) / Number(p.preco_venda) * 100) : 0;
          const itens = fichas.filter(f => f.produto_id === p.id);
          const item = itemFicha[p.id] || { materia_prima_id: mps[0]?.id || '', quantidade: '' };
          return (
            <div className="items-list" style={{ marginBottom: 12 }} key={p.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div><b>{p.codigo}</b> — {p.nome} <span className="muted">({p.categoria || 'sem categoria'})</span></div>
                <div className="row-actions">
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    Custo teórico: {fmtMoney(custoT)} · Preço: {fmtMoney(p.preco_venda)} · Margem: {margem.toFixed(1)}%
                  </span>
                  <button className="btn danger" onClick={() => delProduto(p.id)}>Excluir produto</button>
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <label style={{ marginBottom: 6 }}>Ficha técnica (matéria-prima por unidade produzida)</label>
                {itens.length ? itens.map(f => (
                  <div className="item-line" key={f.id}>
                    <span>{f.materias_primas?.nome || '—'}</span>
                    <span className="num">{Number(f.quantidade)} {f.materias_primas?.unidade || ''}</span>
                    <button className="btn danger small" onClick={() => delItemFicha(f.id)}>×</button>
                  </div>
                )) : <p className="muted" style={{ fontSize: 12 }}>Nenhum item na ficha técnica ainda.</p>}
                <form className="form-grid" style={{ marginTop: 8 }} onSubmit={e => addItemFicha(e, p.id)}>
                  <div><label>Matéria-prima</label>
                    <select value={item.materia_prima_id} onChange={e => setItemFicha({ ...itemFicha, [p.id]: { ...item, materia_prima_id: e.target.value } })}>
                      {mps.map(m => <option key={m.id} value={m.id}>{m.nome} ({m.unidade})</option>)}
                    </select>
                  </div>
                  <div><label>Qtd por unidade</label>
                    <input type="number" step="0.001" required value={item.quantidade} onChange={e => setItemFicha({ ...itemFicha, [p.id]: { ...item, quantidade: e.target.value } })} />
                  </div>
                  <div><button className="btn secondary" type="submit">Adicionar à ficha técnica</button></div>
                </form>
              </div>
            </div>
          );
        }) : <p className="muted">Nenhum produto cadastrado ainda.</p>}
      </div>
    </>
  );
}
