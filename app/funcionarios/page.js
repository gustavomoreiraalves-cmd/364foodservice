'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import AppShell from '../../components/AppShell';

const FORM_VAZIO = { nome: '', cargo: 'Produção', telefone: '', cpf: '' };
const CARGOS = ['Recebimento', 'Produção', 'Embalagem', 'Estoque', 'Vendas', 'Administrativo', 'Outro'];

export default function FuncionariosPage() {
  return (
    <AppShell modulo="funcionarios" titulo="Funcionários" desc="Equipe e responsáveis por cada registro">
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
    const { data } = await supabase.from('funcionarios').select('*').order('nome');
    setLista(data || []);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, []);

  async function adicionar(e) {
    e.preventDefault();
    const { error } = await supabase.from('funcionarios').insert([{ ...form, ativo: true }]);
    if (error) { alert('Erro ao salvar: ' + error.message); return; }
    setForm(FORM_VAZIO);
    carregar();
  }

  async function alternarAtivo(f) {
    await supabase.from('funcionarios').update({ ativo: !f.ativo }).eq('id', f.id);
    carregar();
  }

  async function excluir(id) {
    if (!confirm('Excluir este funcionário?')) return;
    const { error } = await supabase.from('funcionarios').delete().eq('id', id);
    if (error) alert('Não foi possível excluir (há registros vinculados a ele — prefira inativar): ' + error.message);
    carregar();
  }

  return (
    <>
      <div className="panel">
        <h3>Novo funcionário</h3>
        <form onSubmit={adicionar} className="form-grid">
          <div><label>Nome</label><input required value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} /></div>
          <div><label>Cargo / setor</label>
            <select value={form.cargo} onChange={e => setForm({ ...form, cargo: e.target.value })}>
              {CARGOS.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div><label>Telefone</label><input value={form.telefone} onChange={e => setForm({ ...form, telefone: e.target.value })} /></div>
          <div><label>CPF</label><input value={form.cpf} onChange={e => setForm({ ...form, cpf: e.target.value })} /></div>
          <div><button className="btn" type="submit">Adicionar funcionário</button></div>
        </form>
      </div>

      <div className="panel">
        <h3>Equipe cadastrada ({lista.length})</h3>
        {loading ? <p className="muted">Carregando…</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Nome</th><th>Cargo / setor</th><th>Telefone</th><th>CPF</th><th>Acesso ao sistema</th><th>Situação</th><th></th></tr></thead>
              <tbody>
                {lista.length ? lista.map(f => (
                  <tr key={f.id}>
                    <td>{f.nome}</td>
                    <td>{f.cargo || '—'}</td>
                    <td className="muted">{f.telefone || '—'}</td>
                    <td className="muted">{f.cpf || '—'}</td>
                    <td>{f.user_id ? <span className="tag ok">Tem login</span> : <span className="muted">—</span>}</td>
                    <td>{f.ativo ? <span className="tag ok">Ativo</span> : <span className="tag bad">Inativo</span>}</td>
                    <td>
                      <div className="row-actions">
                        <button className="btn secondary small" onClick={() => alternarAtivo(f)}>{f.ativo ? 'Inativar' : 'Reativar'}</button>
                        <button className="btn danger" onClick={() => excluir(f.id)}>Excluir</button>
                      </div>
                    </td>
                  </tr>
                )) : <tr className="empty-row"><td colSpan={7}>Nenhum funcionário cadastrado.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
          Funcionários ativos aparecem como opção de &quot;Responsável&quot; nas telas de Recebimento, Produção, Pedidos e Despesas — assim cada ficha fica registrada em nome de quem lançou.
          Para dar login de acesso ao sistema a um funcionário, use a aba <b>Usuários</b>.
        </p>
      </div>
    </>
  );
}
