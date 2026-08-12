'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import AppShell from '../../../components/AppShell';
import PontoTabs from '../../../components/PontoTabs';
import { useEmpresaAtual } from '../../../lib/empresa';
import { useIsAdmin } from '../../../lib/ponto';

export default function DispositivosPage() {
  return (
    <AppShell modulo="ponto" titulo="Ponto — Dispositivos" desc="Tablets quiosque autorizados a registrar ponto">
      <PontoTabs />
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const { empresaAtual } = useEmpresaAtual();
  const isAdmin = useIsAdmin();
  const [lista, setLista] = useState([]);
  const [unidades, setUnidades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ nome: '', unidade_id: '' });
  const [codigoNovo, setCodigoNovo] = useState(null);

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    const [{ data: disps }, { data: unis }] = await Promise.all([
      supabase.from('ponto_dispositivos').select('id, nome, unidade_id, status, ultimo_visto_em, versao_app, created_at').eq('empresa_id', empresaAtual.id).order('nome'),
      supabase.from('unidades').select('id, nome').eq('empresa_id', empresaAtual.id).eq('ativo', true).order('nome'),
    ]);
    setLista(disps || []);
    setUnidades(unis || []);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  async function chamarApi(metodo, body) {
    const { data: { session } } = await supabase.auth.getSession();
    const resp = await fetch('/api/ponto/dispositivos', {
      method: metodo,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body),
    });
    const json = await resp.json();
    if (!resp.ok) throw new Error(json.error || 'Erro na API');
    return json;
  }

  async function criar(e) {
    e.preventDefault();
    try {
      const { codigo } = await chamarApi('POST', { nome: form.nome, empresaId: empresaAtual.id, unidadeId: form.unidade_id });
      setCodigoNovo({ nome: form.nome, codigo });
      setForm({ nome: '', unidade_id: '' });
      carregar();
    } catch (err) { alert(err.message); }
  }

  async function acao(id, acao) {
    try {
      const r = await chamarApi('PATCH', { id, acao });
      if (r.codigo) setCodigoNovo({ nome: lista.find(d => d.id === id)?.nome, codigo: r.codigo });
      carregar();
    } catch (err) { alert(err.message); }
  }

  function online(d) {
    return d.ultimo_visto_em && (Date.now() - new Date(d.ultimo_visto_em).getTime()) < 3 * 60 * 1000;
  }

  if (loading) return <p className="muted">Carregando…</p>;
  if (!isAdmin) return <p className="muted">Apenas administradores gerenciam dispositivos.</p>;

  return (
    <>
      {codigoNovo && (
        <div className="panel" style={{ borderColor: 'var(--amber)' }}>
          <h3>Código de ativação — {codigoNovo.nome}</h3>
          <p style={{ fontSize: 34, fontFamily: 'Georgia, serif', letterSpacing: 8, margin: '6px 0' }}>{codigoNovo.codigo}</p>
          <p className="muted" style={{ fontSize: 11.5 }}>
            Digite este código no tablet, na tela <b>/quiosque</b>, em até 15 minutos. Ele é exibido uma única vez.
          </p>
          <button className="btn secondary small" onClick={() => setCodigoNovo(null)}>Fechar</button>
        </div>
      )}

      <div className="panel">
        <h3>Novo dispositivo</h3>
        <form onSubmit={criar} className="form-grid">
          <div><label>Nome</label><input required value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} placeholder="Ex.: Tablet cozinha Steakhouse" /></div>
          <div><label>Unidade</label>
            <select required value={form.unidade_id} onChange={e => setForm({ ...form, unidade_id: e.target.value })}>
              <option value="">— selecionar —</option>
              {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
          </div>
          <div><button className="btn" type="submit">Criar e gerar código</button></div>
        </form>
      </div>

      <div className="panel">
        <h3>Dispositivos ({lista.length})</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Nome</th><th>Unidade</th><th>Status</th><th>Conexão</th><th>Último visto</th><th></th></tr></thead>
            <tbody>
              {lista.length ? lista.map(d => (
                <tr key={d.id}>
                  <td>{d.nome}</td>
                  <td className="muted">{unidades.find(u => u.id === d.unidade_id)?.nome || '—'}</td>
                  <td>
                    {d.status === 'ativo' ? <span className="tag ok">Ativo</span>
                      : d.status === 'pendente' ? <span className="tag warn">Pendente</span>
                      : <span className="tag bad">Bloqueado</span>}
                  </td>
                  <td>{d.status === 'ativo' ? (online(d) ? <span className="tag ok">Online</span> : <span className="tag bad">Offline</span>) : <span className="muted">—</span>}</td>
                  <td className="muted">{d.ultimo_visto_em ? new Date(d.ultimo_visto_em).toLocaleString('pt-BR') : '—'}</td>
                  <td>
                    <div className="row-actions">
                      {d.status !== 'bloqueado'
                        ? <button className="btn secondary small" onClick={() => acao(d.id, 'bloquear')}>Bloquear</button>
                        : <button className="btn secondary small" onClick={() => acao(d.id, 'reativar')}>Reativar</button>}
                      <button className="btn secondary small" onClick={() => acao(d.id, 'regenerar_codigo')}>Novo código</button>
                    </div>
                  </td>
                </tr>
              )) : <tr className="empty-row"><td colSpan={6}>Nenhum dispositivo cadastrado.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
          Bloquear um dispositivo invalida o token dele imediatamente — o quiosque para de aceitar marcações.
          &quot;Novo código&quot; também desativa o token atual e exige nova ativação no tablet.
        </p>
      </div>
    </>
  );
}
