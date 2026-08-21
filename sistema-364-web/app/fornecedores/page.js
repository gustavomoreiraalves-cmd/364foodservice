'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import AppShell from '../../components/AppShell';
import { useEmpresaAtual } from '../../lib/empresa';

const FORM_VAZIO = { nome: '', cnpj: '', categoria: 'Carnes', contato: '', telefone: '', email: '' };
const CATEGORIAS = ['Carnes', 'Temperos', 'Embalagens', 'Equipamentos', 'Serviços', 'Outros'];

// O CNPJ é gravado só com dígitos: é assim que ele vem no XML da NF-e, e é por
// igualdade exata que a importação encontra o fornecedor da nota. Fornecedor
// cadastrado como 12.345.678/0001-99 nunca casava com a nota.
const soDigitos = v => String(v || '').replace(/\D/g, '');

export default function FornecedoresPage() {
  return (
    <AppShell modulo="fornecedores" titulo="Fornecedores" desc="Cadastro de fornecedores e categorias">
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
    const { data, error } = await supabase.from('fornecedores').select('*').eq('empresa_id', empresaAtual.id).order('nome');
    if (!error) setLista(data);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  async function adicionar(e) {
    e.preventDefault();
    // CNPJ em branco vai como null: a coluna é opcional e string vazia não passa
    // no check de "só dígitos" da migração 22.
    const { error } = await supabase.from('fornecedores')
      .insert([{ ...form, cnpj: soDigitos(form.cnpj) || null, empresa_id: empresaAtual.id }]);
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
          <div><label>CNPJ</label>
            <input inputMode="numeric" maxLength={14} placeholder="Só números"
              value={form.cnpj} onChange={e => setForm({ ...form, cnpj: soDigitos(e.target.value) })} />
          </div>
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
