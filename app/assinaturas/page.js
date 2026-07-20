'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { fmtMoney, fmtDate, hoje } from '../../lib/format';
import AppShell from '../../components/AppShell';

// Valores padrão dos planos (Conselho 364, 18/07/2026) — editáveis por assinatura
const PLANOS = { Bronze: 169, Prata: 379, Ouro: 559 };
const STATUS = ['Ativa', 'Pausada', 'Cancelada'];

const FORM_VAZIO = () => ({ cliente_id: '', plano: 'Bronze', valor_mensal: PLANOS.Bronze, dia_entrega: 5, inicio: hoje(), obs: '' });

export default function AssinaturasPage() {
  return (
    <AppShell modulo="assinaturas" titulo="Assinaturas" desc="Boxes mensais Bronze, Prata e Ouro">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const [lista, setLista] = useState([]);
  const [entregas, setEntregas] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [semTabela, setSemTabela] = useState(false);
  const [form, setForm] = useState(FORM_VAZIO());

  const competencia = hoje().slice(0, 7); // AAAA-MM do mês atual

  async function carregar() {
    setLoading(true);
    const [r1, r2, r3] = await Promise.all([
      supabase.from('assinaturas').select('*, clientes(nome, telefone)').order('created_at', { ascending: false }),
      supabase.from('assinatura_entregas').select('*, assinaturas(plano, dia_entrega, clientes(nome, telefone))').eq('competencia', hoje().slice(0, 7)).order('created_at'),
      supabase.from('clientes').select('id, nome, tipo').order('nome'),
    ]);
    if (r1.error && /assinaturas/.test(r1.error.message)) {
      setSemTabela(true);
      setLoading(false);
      return;
    }
    setLista(r1.data || []);
    setEntregas(r2.data || []);
    setClientes(r3.data || []);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, []);

  async function adicionar(e) {
    e.preventDefault();
    setSalvando(true);
    const { error } = await supabase.from('assinaturas').insert([{
      cliente_id: form.cliente_id,
      plano: form.plano,
      valor_mensal: Number(form.valor_mensal),
      dia_entrega: Math.min(28, Math.max(1, Number(form.dia_entrega) || 5)),
      inicio: form.inicio,
      obs: form.obs || null,
    }]);
    setSalvando(false);
    if (error) { alert('Erro ao salvar: ' + error.message); return; }
    setForm(FORM_VAZIO());
    carregar();
  }

  async function mudarStatus(id, status) {
    const { error } = await supabase.from('assinaturas').update({ status }).eq('id', id);
    if (error) alert('Erro ao atualizar: ' + error.message);
    carregar();
  }

  async function excluir(id) {
    if (!confirm('Excluir esta assinatura e o histórico de entregas dela?')) return;
    const { error } = await supabase.from('assinaturas').delete().eq('id', id);
    if (error) alert('Erro ao excluir: ' + error.message);
    carregar();
  }

  // Cria as entregas Pendentes da competência atual para toda assinatura Ativa que ainda não tem
  async function gerarEntregasDoMes() {
    const ativas = lista.filter(a => a.status === 'Ativa');
    const jaTem = new Set(entregas.map(e => e.assinatura_id));
    const novas = ativas.filter(a => !jaTem.has(a.id)).map(a => ({
      assinatura_id: a.id,
      competencia,
      status: 'Pendente',
      valor: Number(a.valor_mensal),
    }));
    if (!novas.length) { alert('Todas as assinaturas ativas já têm entrega gerada neste mês.'); return; }
    const { error } = await supabase.from('assinatura_entregas').insert(novas);
    if (error) { alert('Erro ao gerar entregas: ' + error.message); return; }
    carregar();
  }

  async function marcarEntrega(id, status) {
    const { error } = await supabase.from('assinatura_entregas').update({
      status,
      data_entrega: status === 'Entregue' ? hoje() : null,
    }).eq('id', id);
    if (error) alert('Erro ao atualizar entrega: ' + error.message);
    carregar();
  }

  if (loading) return <p className="muted">Carregando…</p>;

  if (semTabela) {
    return (
      <div className="banner info">
        As tabelas de assinaturas ainda não existem no banco. Rode o script <b>supabase/atualizacao_05_assinaturas_b2b.sql</b> no SQL Editor do Supabase e recarregue esta página.
      </div>
    );
  }

  if (!clientes.length) {
    return (
      <div className="banner info">
        Cadastre ao menos um <b>cliente</b> (aba Clientes) antes de criar uma assinatura.
      </div>
    );
  }

  const ativas = lista.filter(a => a.status === 'Ativa');
  const mrr = ativas.reduce((s, a) => s + Number(a.valor_mensal), 0);
  const porPlano = p => ativas.filter(a => a.plano === p).length;
  const statusTag = s => {
    const map = { Ativa: 'ok', Pausada: 'warn', Cancelada: 'bad', Pendente: 'warn', Entregue: 'ok', Pulada: 'bad' };
    return <span className={`tag ${map[s] || 'warn'}`}>{s}</span>;
  };

  return (
    <>
      <div className="kpi-grid">
        <div className="kpi"><div className="label">Assinantes ativos</div><div className="value">{ativas.length}</div></div>
        <div className="kpi"><div className="label">Bronze · Prata · Ouro</div><div className="value">{porPlano('Bronze')} · {porPlano('Prata')} · {porPlano('Ouro')}</div></div>
        <div className="kpi"><div className="label">Receita recorrente mensal</div><div className="value">{fmtMoney(mrr)}</div></div>
        <div className="kpi"><div className="label">Entregas pendentes no mês</div><div className="value">{entregas.filter(e => e.status === 'Pendente').length}</div></div>
      </div>

      <div className="panel">
        <h3>Nova assinatura</h3>
        <form onSubmit={adicionar} className="form-grid">
          <div><label>Cliente</label>
            <select required value={form.cliente_id} onChange={e => setForm({ ...form, cliente_id: e.target.value })}>
              <option value="">Selecione…</option>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
          <div><label>Plano</label>
            <select value={form.plano} onChange={e => setForm({ ...form, plano: e.target.value, valor_mensal: PLANOS[e.target.value] })}>
              {Object.keys(PLANOS).map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div><label>Valor mensal (R$)</label><input type="number" step="0.01" required value={form.valor_mensal} onChange={e => setForm({ ...form, valor_mensal: e.target.value })} /></div>
          <div><label>Dia de entrega (1–28)</label><input type="number" min="1" max="28" required value={form.dia_entrega} onChange={e => setForm({ ...form, dia_entrega: e.target.value })} /></div>
          <div><label>Início</label><input type="date" required value={form.inicio} onChange={e => setForm({ ...form, inicio: e.target.value })} /></div>
          <div><label>Observações</label><input placeholder="preferências, endereço de entrega…" value={form.obs} onChange={e => setForm({ ...form, obs: e.target.value })} /></div>
          <div><button className="btn" type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Criar assinatura'}</button></div>
        </form>
        <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
          Valores padrão dos planos: Bronze {fmtMoney(PLANOS.Bronze)} · Prata {fmtMoney(PLANOS.Prata)} · Ouro {fmtMoney(PLANOS.Ouro)} (preço de assinante — o avulso é vendido pela aba Pedidos). Assinantes fundadores mantêm o preço por 6 meses.
        </p>
      </div>

      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h3>Entregas de {competencia.split('-').reverse().join('/')} ({entregas.length})</h3>
          <button className="btn secondary" onClick={gerarEntregasDoMes}>Gerar entregas do mês</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Cliente</th><th>Plano</th><th>Dia previsto</th><th>Valor</th><th>Status</th><th>Entregue em</th><th></th></tr></thead>
            <tbody>
              {entregas.length ? entregas.map(e => (
                <tr key={e.id}>
                  <td>{e.assinaturas?.clientes?.nome || '—'}</td>
                  <td>{e.assinaturas?.plano || '—'}</td>
                  <td className="num">dia {e.assinaturas?.dia_entrega ?? '—'}</td>
                  <td className="num">{fmtMoney(e.valor)}</td>
                  <td>{statusTag(e.status)}</td>
                  <td>{fmtDate(e.data_entrega)}</td>
                  <td>
                    <div className="row-actions">
                      {e.status !== 'Entregue' && <button className="btn secondary small" onClick={() => marcarEntrega(e.id, 'Entregue')}>Marcar entregue</button>}
                      {e.status === 'Pendente' && <button className="btn danger" onClick={() => marcarEntrega(e.id, 'Pulada')}>Pular mês</button>}
                      {e.status !== 'Pendente' && <button className="btn secondary small" onClick={() => marcarEntrega(e.id, 'Pendente')}>Reabrir</button>}
                    </div>
                  </td>
                </tr>
              )) : <tr className="empty-row"><td colSpan={7}>Nenhuma entrega gerada neste mês — clique em “Gerar entregas do mês”.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h3>Assinaturas ({lista.length})</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Cliente</th><th>Plano</th><th>Valor mensal</th><th>Dia entrega</th><th>Início</th><th>Status</th><th>Obs</th><th></th></tr></thead>
            <tbody>
              {lista.length ? lista.map(a => (
                <tr key={a.id}>
                  <td>{a.clientes?.nome || '—'}</td>
                  <td>{a.plano}</td>
                  <td className="num">{fmtMoney(a.valor_mensal)}</td>
                  <td className="num">dia {a.dia_entrega}</td>
                  <td>{fmtDate(a.inicio)}</td>
                  <td>
                    <div className="row-actions">
                      {statusTag(a.status)}
                      <select style={{ width: 'auto' }} value={a.status} onChange={e => mudarStatus(a.id, e.target.value)}>
                        {STATUS.map(s => <option key={s}>{s}</option>)}
                      </select>
                    </div>
                  </td>
                  <td className="muted">{a.obs || '—'}</td>
                  <td><button className="btn danger" onClick={() => excluir(a.id)}>Excluir</button></td>
                </tr>
              )) : <tr className="empty-row"><td colSpan={8}>Nenhuma assinatura cadastrada.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
