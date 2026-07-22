'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import AppShell from '../../components/AppShell';
import { useEmpresaAtual } from '../../lib/empresa';

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
  const { empresaAtual } = useEmpresaAtual();
  const [lista, setLista] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(FORM_VAZIO);

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    const { data } = await supabase.from('clientes').select('*').eq('empresa_id', empresaAtual.id).order('nome');
    setLista(data || []);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  async function adicionar(e) {
    e.preventDefault();
    const { error } = await supabase.from('clientes').insert([{ ...form, empresa_id: empresaAtual.id }]);
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
                {lista.length ? lista.map(c => (
                  <tr key={c.id}>
                    <td>{c.nome}</td>
                    <td>{c.tipo || '—'}</td>
                    <td className="muted">{c.cnpj || '—'}</td>
                    <td>{c.contato || '—'}</td>
                    <td className="muted">{c.telefone || '—'}</td>
                    <td><button className="btn danger" onClick={() => excluir(c.id)}>Excluir</button></td>
                  </tr>
                )) : <tr className="empty-row"><td colSpan={6}>Nenhum cliente cadastrado.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
