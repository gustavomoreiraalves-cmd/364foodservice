'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import AppShell from '../../components/AppShell';
import { useEmpresaAtual } from '../../lib/empresa';

const FORM_VAZIO = { nome: '', unidade_id: '' };

export default function CentrosCustoPage() {
  return (
    <AppShell modulo="centros_custo" titulo="Centros de custo" desc="Centros de custo por empresa e unidade">
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
      supabase.from('centros_custo').select('*, unidades(nome)').eq('empresa_id', empresaAtual.id).order('nome'),
      supabase.from('unidades').select('id, nome').eq('empresa_id', empresaAtual.id).eq('ativo', true).order('nome'),
    ]);
    if (!r1.error) setLista(r1.data);
    setUnidades(r2.data || []);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  async function adicionar(e) {
    e.preventDefault();
    const { error } = await supabase.from('centros_custo').insert([{
      nome: form.nome,
      unidade_id: form.unidade_id || null,
      empresa_id: empresaAtual.id,
    }]);
    if (!error) {
      setForm(FORM_VAZIO);
      carregar();
    } else {
      alert('Erro ao salvar: ' + error.message);
    }
  }

  async function excluir(id) {
    if (!confirm('Excluir este centro de custo?')) return;
    const { error } = await supabase.from('centros_custo').delete().eq('id', id);
    if (error) alert('Erro ao excluir: ' + error.message);
    carregar();
  }

  return (
    <>
      <div className="panel">
        <h3>Novo centro de custo</h3>
        <form onSubmit={adicionar} className="form-grid">
          <div><label>Nome</label><input required placeholder="Steakhouse — Cozinha..." value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} /></div>
          <div><label>Unidade (opcional)</label>
            <select value={form.unidade_id} onChange={e => setForm({ ...form, unidade_id: e.target.value })}>
              <option value="">Sem unidade específica (administrativo)</option>
              {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
          </div>
          <div><button className="btn" type="submit">Adicionar centro de custo</button></div>
        </form>
      </div>

      <div className="panel">
        <h3>Centros de custo cadastrados ({lista.length})</h3>
        {loading ? <p className="muted">Carregando…</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Nome</th><th>Unidade</th><th></th></tr></thead>
              <tbody>
                {lista.length ? lista.map(c => (
                  <tr key={c.id}>
                    <td>{c.nome}</td>
                    <td className="muted">{c.unidades?.nome || '—'}</td>
                    <td><button className="btn danger" onClick={() => excluir(c.id)}>Excluir</button></td>
                  </tr>
                )) : <tr className="empty-row"><td colSpan={3}>Nenhum centro de custo cadastrado.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
