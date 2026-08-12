'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import AppShell from '../../components/AppShell';
import { useEmpresaAtual } from '../../lib/empresa';

const TIPOS = ['seco', 'refrigerado', 'congelado', 'outro'];
const FORM_VAZIO = { unidade_id: '', nome: '', tipo: 'seco' };

export default function DepositosPage() {
  return (
    <AppShell modulo="depositos" titulo="Depósitos" desc="Espaços de armazenamento por unidade (CD, câmaras, etc.)">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const { empresaAtual } = useEmpresaAtual();
  const [lista, setLista] = useState([]);
  const [unidades, setUnidades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(FORM_VAZIO);

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    const [r1, r2] = await Promise.all([
      supabase.from('depositos').select('*, unidades(nome)').eq('empresa_id', empresaAtual.id).order('nome'),
      supabase.from('unidades').select('id, nome').eq('empresa_id', empresaAtual.id).eq('ativo', true).order('nome'),
    ]);
    if (!r1.error) setLista(r1.data);
    setUnidades(r2.data || []);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  async function adicionar(e) {
    e.preventDefault();
    const { error } = await supabase.from('depositos').insert([{ ...form, empresa_id: empresaAtual.id }]);
    if (!error) {
      setForm(FORM_VAZIO);
      carregar();
    } else {
      alert('Erro ao salvar: ' + error.message);
    }
  }

  async function excluir(id) {
    if (!confirm('Excluir este depósito?')) return;
    const { error } = await supabase.from('depositos').delete().eq('id', id);
    if (error) alert('Erro ao excluir: ' + error.message);
    carregar();
  }

  if (!unidades.length && !loading) {
    return (
      <div className="banner info">
        Nenhuma unidade cadastrada para esta empresa ainda. Rode a migração
        <code> supabase/atualizacao_11_fundacao_suprimentos.sql</code> ou cadastre uma unidade antes de criar depósitos.
      </div>
    );
  }

  return (
    <>
      <div className="panel">
        <h3>Novo depósito</h3>
        <form onSubmit={adicionar} className="form-grid">
          <div><label>Unidade</label>
            <select required value={form.unidade_id} onChange={e => setForm({ ...form, unidade_id: e.target.value })}>
              <option value="">Selecione…</option>
              {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
          </div>
          <div><label>Nome</label><input required placeholder="Câmara fria 2..." value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} /></div>
          <div><label>Tipo</label>
            <select value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })}>
              {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div><button className="btn" type="submit">Adicionar depósito</button></div>
        </form>
      </div>

      <div className="panel">
        <h3>Depósitos cadastrados ({lista.length})</h3>
        {loading ? <p className="muted">Carregando…</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Nome</th><th>Unidade</th><th>Tipo</th><th></th></tr></thead>
              <tbody>
                {lista.length ? lista.map(d => (
                  <tr key={d.id}>
                    <td>{d.nome}</td>
                    <td className="muted">{d.unidades?.nome || '—'}</td>
                    <td className="muted">{d.tipo}</td>
                    <td><button className="btn danger" onClick={() => excluir(d.id)}>Excluir</button></td>
                  </tr>
                )) : <tr className="empty-row"><td colSpan={4}>Nenhum depósito cadastrado.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
