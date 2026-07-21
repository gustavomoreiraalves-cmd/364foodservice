'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { fmtMoney, fmtDate, hoje } from '../../lib/format';
import AppShell from '../../components/AppShell';
import { useEmpresaAtual } from '../../lib/empresa';

const FORM_VAZIO = () => ({ data: hoje(), descricao: '', valor: '', responsavel_id: '' });

export default function DespesasPage() {
  return (
    <AppShell modulo="despesas" titulo="Despesas" desc="Despesas operacionais (aluguel, energia, salários...)">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const { empresaAtual } = useEmpresaAtual();
  const [lista, setLista] = useState([]);
  const [funcionarios, setFuncionarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(FORM_VAZIO());

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    const [r1, r2] = await Promise.all([
      supabase.from('despesas').select('*, funcionarios(nome)').eq('empresa_id', empresaAtual.id).order('data', { ascending: false }),
      supabase.from('funcionarios').select('id, nome').eq('empresa_id', empresaAtual.id).eq('ativo', true).order('nome'),
    ]);
    setLista(r1.data || []);
    setFuncionarios(r2.data || []);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  async function adicionar(e) {
    e.preventDefault();
    const { error } = await supabase.from('despesas').insert([{
      data: form.data,
      descricao: form.descricao,
      valor: Number(form.valor),
      responsavel_id: form.responsavel_id || null,
      empresa_id: empresaAtual.id,
    }]);
    if (error) { alert('Erro ao salvar: ' + error.message); return; }
    setForm(FORM_VAZIO());
    carregar();
  }

  async function excluir(id) {
    if (!confirm('Excluir esta despesa?')) return;
    const { error } = await supabase.from('despesas').delete().eq('id', id);
    if (error) alert('Erro ao excluir: ' + error.message);
    carregar();
  }

  const total = lista.reduce((s, d) => s + Number(d.valor), 0);

  return (
    <>
      <div className="panel">
        <h3>Lançar despesa</h3>
        <form onSubmit={adicionar} className="form-grid">
          <div><label>Data</label><input type="date" required value={form.data} onChange={e => setForm({ ...form, data: e.target.value })} /></div>
          <div><label>Descrição</label><input required placeholder="Aluguel, energia, salários..." value={form.descricao} onChange={e => setForm({ ...form, descricao: e.target.value })} /></div>
          <div><label>Valor (R$)</label><input type="number" step="0.01" required value={form.valor} onChange={e => setForm({ ...form, valor: e.target.value })} /></div>
          <div><label>Responsável</label>
            <select value={form.responsavel_id} onChange={e => setForm({ ...form, responsavel_id: e.target.value })}>
              <option value="">Selecione…</option>
              {funcionarios.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </div>
          <div><button className="btn" type="submit">Lançar despesa</button></div>
        </form>
      </div>

      <div className="panel">
        <h3>Despesas lançadas ({lista.length}) — total {fmtMoney(total)}</h3>
        {loading ? <p className="muted">Carregando…</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Data</th><th>Descrição</th><th>Valor</th><th>Responsável</th><th></th></tr></thead>
              <tbody>
                {lista.length ? lista.map(d => (
                  <tr key={d.id}>
                    <td>{fmtDate(d.data)}</td>
                    <td>{d.descricao}</td>
                    <td className="num">{fmtMoney(d.valor)}</td>
                    <td className="muted">{d.funcionarios?.nome || '—'}</td>
                    <td><button className="btn danger" onClick={() => excluir(d.id)}>Excluir</button></td>
                  </tr>
                )) : <tr className="empty-row"><td colSpan={5}>Nenhuma despesa lançada.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
