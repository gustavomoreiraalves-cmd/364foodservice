'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { fmtMoney } from '../../lib/format';
import AppShell from '../../components/AppShell';
import { useEmpresaAtual } from '../../lib/empresa';

const MP_VAZIA = { nome: '', categoria: '', unidade: 'kg', custo_unitario: '', preco_alvo_kg: '' };

export default function MateriasPrimasPage() {
  return (
    <AppShell modulo="produtos" titulo="Matéria-prima e insumos" desc="Cadastro de insumos, custo padrão e preço-alvo">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const { empresaAtual } = useEmpresaAtual();
  const [mps, setMps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formMP, setFormMP] = useState(MP_VAZIA);

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    const { data } = await supabase.from('materias_primas').select('*').eq('empresa_id', empresaAtual.id).order('nome');
    setMps(data || []);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  async function addMP(e) {
    e.preventDefault();
    const { error } = await supabase.from('materias_primas').insert([{
      nome: formMP.nome,
      categoria: formMP.categoria || null,
      unidade: formMP.unidade,
      custo_unitario: Number(formMP.custo_unitario),
      preco_alvo_kg: formMP.preco_alvo_kg ? Number(formMP.preco_alvo_kg) : null,
      empresa_id: empresaAtual.id,
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

  if (loading) return <p className="muted">Carregando…</p>;

  return (
    <div className="panel">
      <h3>Matérias-primas cadastradas</h3>
      <form onSubmit={addMP} className="form-grid">
        <div><label>Nome</label><input required value={formMP.nome} onChange={e => setFormMP({ ...formMP, nome: e.target.value })} /></div>
        <div><label>Categoria</label><input placeholder="Carnes, Temperos, Embalagens..." value={formMP.categoria} onChange={e => setFormMP({ ...formMP, categoria: e.target.value })} /></div>
        <div><label>Unidade</label>
          <select value={formMP.unidade} onChange={e => setFormMP({ ...formMP, unidade: e.target.value })}>
            <option value="kg">kg</option><option value="g">g</option><option value="un">un</option><option value="L">L</option>
          </select>
        </div>
        <div><label>Custo unitário padrão (R$)</label><input type="number" step="0.01" required value={formMP.custo_unitario} onChange={e => setFormMP({ ...formMP, custo_unitario: e.target.value })} /></div>
        <div><label>Preço-alvo (R$/kg)</label><input type="number" step="0.01" placeholder="Opcional" value={formMP.preco_alvo_kg} onChange={e => setFormMP({ ...formMP, preco_alvo_kg: e.target.value })} /></div>
        <div><button className="btn" type="submit">Adicionar matéria-prima</button></div>
      </form>
      <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
        O preço-alvo é usado no Recebimento para avisar quando o custo do lote vier acima do esperado.
      </p>
      <div className="table-wrap" style={{ marginTop: 14 }}>
        <table>
          <thead><tr><th>Nome</th><th>Categoria</th><th>Unidade</th><th>Custo padrão</th><th>Preço-alvo</th><th></th></tr></thead>
          <tbody>
            {mps.length ? mps.map(m => (
              <tr key={m.id}>
                <td>{m.nome}</td>
                <td className="muted">{m.categoria || '—'}</td>
                <td>{m.unidade}</td>
                <td className="num">{fmtMoney(m.custo_unitario)}</td>
                <td className="num">{m.preco_alvo_kg != null ? fmtMoney(m.preco_alvo_kg) : '—'}</td>
                <td><button className="btn danger" onClick={() => delMP(m.id)}>Excluir</button></td>
              </tr>
            )) : <tr className="empty-row"><td colSpan={6}>Nenhuma matéria-prima.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
