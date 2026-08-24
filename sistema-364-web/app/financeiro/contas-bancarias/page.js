'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import AppShell from '../../../components/AppShell';
import { useEmpresaAtual } from '../../../lib/empresa';

const INSTITUICOES = ['Sicoob', 'Cresol', 'Sicredi', 'Banco do Brasil', 'Santander', 'Bradesco'];

const VAZIO = () => ({
  nome: '', instituicao: INSTITUICOES[0], tipo: 'conta_corrente', agencia: '', numero_conta: '',
});

export default function ContasBancariasPage() {
  return (
    <AppShell modulo="financeiro" titulo="Contas Bancárias"
      desc="Contas e cartões usados na conciliação dos extratos">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const { empresaAtual } = useEmpresaAtual();
  const [lista, setLista] = useState([]);
  const [form, setForm] = useState(VAZIO());
  const [salvando, setSalvando] = useState(false);
  const [loading, setLoading] = useState(true);

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    const { data, error } = await supabase.from('contas_bancarias').select('*')
      .eq('empresa_id', empresaAtual.id).order('nome');
    if (error) console.error(error);
    setLista(data || []);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  async function salvar(e) {
    e.preventDefault();
    if (!form.nome.trim()) { alert('Dê um nome para a conta (ex.: Sicoob principal).'); return; }
    setSalvando(true);
    const { error } = await supabase.from('contas_bancarias').insert([{
      empresa_id: empresaAtual.id,
      nome: form.nome.trim(),
      instituicao: form.instituicao,
      tipo: form.tipo,
      agencia: form.agencia.trim() || null,
      numero_conta: form.numero_conta.trim() || null,
    }]);
    setSalvando(false);
    if (error) { alert('Não consegui salvar: ' + error.message); return; }
    setForm(VAZIO());
    carregar();
  }

  async function alternarAtivo(conta) {
    const { error } = await supabase.from('contas_bancarias')
      .update({ ativo: !conta.ativo }).eq('id', conta.id);
    if (error) { alert('Não consegui atualizar: ' + error.message); return; }
    carregar();
  }

  return (
    <>
      <div className="panel">
        <strong>Nova conta</strong>
        <form className="form-grid" onSubmit={salvar} style={{ marginTop: 10 }}>
          <div>
            <label>Nome</label>
            <input value={form.nome} placeholder="Sicoob principal"
              onChange={e => setForm({ ...form, nome: e.target.value })} />
          </div>
          <div>
            <label>Instituição</label>
            <select value={form.instituicao}
              onChange={e => setForm({ ...form, instituicao: e.target.value })}>
              {INSTITUICOES.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>
          <div>
            <label>Tipo</label>
            <select value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })}>
              <option value="conta_corrente">Conta corrente</option>
              <option value="cartao_credito">Cartão de crédito</option>
            </select>
          </div>
          <div>
            <label>Agência</label>
            <input value={form.agencia} onChange={e => setForm({ ...form, agencia: e.target.value })} />
          </div>
          <div>
            <label>{form.tipo === 'cartao_credito' ? 'Final do cartão' : 'Número da conta'}</label>
            <input value={form.numero_conta}
              onChange={e => setForm({ ...form, numero_conta: e.target.value })} />
          </div>
          <div style={{ alignSelf: 'end' }}>
            <button className="btn" disabled={salvando}>{salvando ? 'Salvando…' : 'Cadastrar'}</button>
          </div>
        </form>
      </div>

      <div className="panel">
        <strong>Contas cadastradas</strong>
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table>
            <thead>
              <tr>
                <th>Nome</th><th>Instituição</th><th>Tipo</th><th>Agência</th>
                <th>Conta / cartão</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr className="empty-row"><td colSpan={7}>Carregando…</td></tr>}
              {!loading && !lista.length && (
                <tr className="empty-row"><td colSpan={7}>
                  Nenhuma conta cadastrada. Comece pelas contas dos bancos que você usa.
                </td></tr>
              )}
              {lista.map(c => (
                <tr key={c.id}>
                  <td>{c.nome}</td>
                  <td>{c.instituicao}</td>
                  <td>{c.tipo === 'cartao_credito' ? 'Cartão de crédito' : 'Conta corrente'}</td>
                  <td>{c.agencia || '—'}</td>
                  <td>{c.numero_conta || '—'}</td>
                  <td><span className={'tag ' + (c.ativo ? 'ok' : 'bad')}>
                    {c.ativo ? 'Ativa' : 'Inativa'}
                  </span></td>
                  <td className="row-actions">
                    <button className="btn secondary small" onClick={() => alternarAtivo(c)}>
                      {c.ativo ? 'Desativar' : 'Reativar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
