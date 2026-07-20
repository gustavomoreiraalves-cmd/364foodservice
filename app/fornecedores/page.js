'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import AppShell from '../../components/AppShell';

const FORM_VAZIO = { nome: '', cnpj: '', categoria: 'Carnes', contato: '', telefone: '', email: '' };
const CATEGORIAS = ['Carnes', 'Temperos', 'Embalagens', 'Equipamentos', 'Serviços', 'Outros'];

export default function FornecedoresPage() {
  return (
    <AppShell modulo="fornecedores" titulo="Fornecedores" desc="Cadastro de fornecedores e categorias">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const [lista, setLista] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(FORM_VAZIO);

  async function carregar() {
    setLoading(true);
    const { data, error } = await supabase.from('fornecedores').select('*').order('nome');
    if (!error) setLista(data);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, []);

  async function adicionar(e) {
    e.preventDefault();
    const { error } = await supabase.from('fornecedores').insert([form]);
    if (!error) {
      setForm(FORM_VAZIO);
      carregar();
    } else {
      alert('Erro ao salvar: ' + error.message);
    }
  }

  async function excluir(id) {
    if (!confirm('Excluir este fornecedor?')) return;
    const { error } = await supabase.from('fornecedores').delete().eq('id', id);
    if (error) alert('Erro ao excluir: ' + error.message);
    carregar();
  }

  return (
    <>
      <div className="panel">
        <h3>Novo fornecedor</h3>
        <form onSubmit={adicionar} className="form-grid">
          <div><label>Nome / Razão social</label><input required value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} /></div>
          <div><label>CNPJ</label><input value={form.cnpj} onChange={e => setForm({ ...form, cnpj: e.target.value })} /></div>
          <div><label>Categoria</label>
            <select value={form.categoria} onChange={e => setForm({ ...form, categoria: e.target.value })}>
              {CATEGORIAS.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div><label>Contato</label><input value={form.contato} onChange={e => setForm({ ...form, contato: e.target.value })} /></div>
          <div><label>Telefone</label><input value={form.telefone} onChange={e => setForm({ ...form, telefone: e.target.value })} /></div>
          <div><label>E-mail</label><input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
          <div><button className="btn" type="submit">Adicionar fornecedor</button></div>
        </form>
      </div>

      <div className="panel">
        <h3>Fornecedores cadastrados ({lista.length})</h3>
        {loading ? <p className="muted">Carregando…</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Nome</th><th>Categoria</th><th>CNPJ</th><th>Contato</th><th>Telefone</th><th>E-mail</th><th></th></tr></thead>
              <tbody>
                {lista.length ? lista.map(f => (
                  <tr key={f.id}>
                    <td>{f.nome}</td>
                    <td>{f.categoria || '—'}</td>
                    <td className="muted">{f.cnpj || '—'}</td>
                    <td>{f.contato || '—'}</td>
                    <td className="muted">{f.telefone || '—'}</td>
                    <td className="muted">{f.email || '—'}</td>
                    <td><button className="btn danger" onClick={() => excluir(f.id)}>Excluir</button></td>
                  </tr>
                )) : <tr className="empty-row"><td colSpan={7}>Nenhum fornecedor cadastrado.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
