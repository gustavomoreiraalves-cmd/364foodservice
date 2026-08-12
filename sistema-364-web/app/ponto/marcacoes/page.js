'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import AppShell from '../../../components/AppShell';
import PontoTabs from '../../../components/PontoTabs';
import { useEmpresaAtual } from '../../../lib/empresa';
import { useIsAdmin, TIPOS_MARCACAO, METODOS_MARCACAO } from '../../../lib/ponto';

function hojeISO() { return new Date().toISOString().slice(0, 10); }
function primeiraDoMes() { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); }

export default function MarcacoesPage() {
  return (
    <AppShell modulo="ponto" titulo="Ponto — Marcações" desc="Consulta das marcações originais (imutáveis)">
      <PontoTabs />
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const { empresaAtual } = useEmpresaAtual();
  const isAdmin = useIsAdmin();
  const [lista, setLista] = useState([]);
  const [colaboradores, setColaboradores] = useState([]);
  const [unidades, setUnidades] = useState([]);
  const [empregadores, setEmpregadores] = useState([]);
  const [tentativas, setTentativas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState({ colaborador_id: '', de: primeiraDoMes(), ate: hojeISO(), metodo: '' });
  const [fManual, setFManual] = useState({ colaborador_id: '', unidade_id: '', tipo: 'entrada', motivo: '' });
  const [mostrarManual, setMostrarManual] = useState(false);

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    let q = supabase.from('ponto_marcacoes')
      .select('id, nsr, colaborador_id, unidade_id, dispositivo_id, tipo, data_hora_local, metodo, score_similaridade, liveness_ok, origem, motivo_manual, record_hash, empregador_id')
      .eq('empresa_id', empresaAtual.id)
      .gte('data_hora_utc', filtro.de + 'T00:00:00Z')
      .lte('data_hora_utc', filtro.ate + 'T23:59:59Z')
      .order('nsr', { ascending: false })
      .limit(500);
    if (filtro.colaborador_id) q = q.eq('colaborador_id', filtro.colaborador_id);
    if (filtro.metodo) q = q.eq('metodo', filtro.metodo);

    const [{ data: marcs }, { data: colabs }, { data: unis }, { data: emps }, { data: tents }] = await Promise.all([
      q,
      supabase.from('colaboradores').select('id, nome, matricula').eq('empresa_id', empresaAtual.id).order('nome'),
      supabase.from('unidades').select('id, nome').eq('empresa_id', empresaAtual.id),
      supabase.from('empregadores').select('id, razao_social, nome_fantasia'),
      supabase.from('ponto_tentativas').select('*').eq('empresa_id', empresaAtual.id).order('created_at', { ascending: false }).limit(20),
    ]);
    setLista(marcs || []);
    setColaboradores(colabs || []);
    setUnidades(unis || []);
    setEmpregadores(emps || []);
    setTentativas(tents || []);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  async function registrarManual(e) {
    e.preventDefault();
    const { data: { session } } = await supabase.auth.getSession();
    const resp = await fetch('/api/ponto/marcacoes/manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({
        colaboradorId: fManual.colaborador_id,
        unidadeId: fManual.unidade_id,
        tipo: fManual.tipo,
        motivo: fManual.motivo,
      }),
    });
    const json = await resp.json();
    if (!resp.ok) { alert(json.error || 'Erro'); return; }
    alert(`Marcação manual registrada — NSR ${json.nsr}.`);
    setFManual({ colaborador_id: '', unidade_id: '', tipo: 'entrada', motivo: '' });
    setMostrarManual(false);
    carregar();
  }

  async function verificarCadeia() {
    const empregadorIds = [...new Set(lista.map(m => m.empregador_id))];
    if (!empregadorIds.length) { alert('Nenhuma marcação no período para verificar.'); return; }
    for (const eid of empregadorIds) {
      const { data, error } = await supabase.rpc('verificar_cadeia_marcacoes', { p_empregador_id: eid });
      const nomeEmp = empregadores.find(x => x.id === eid);
      const rotulo = nomeEmp?.nome_fantasia || nomeEmp?.razao_social || eid;
      if (error) { alert(`${rotulo}: erro — ${error.message}`); continue; }
      alert(data === null
        ? `${rotulo}: cadeia de hashes ÍNTEGRA ✔`
        : `${rotulo}: DIVERGÊNCIA no NSR ${data} — possível adulteração!`);
    }
  }

  const nomeColab = id => colaboradores.find(c => c.id === id)?.nome || '—';
  const nomeUnidade = id => unidades.find(u => u.id === id)?.nome || '—';

  return (
    <>
      <div className="panel">
        <h3>Filtros</h3>
        <div className="form-grid">
          <div><label>Colaborador</label>
            <select value={filtro.colaborador_id} onChange={e => setFiltro({ ...filtro, colaborador_id: e.target.value })}>
              <option value="">Todos</option>
              {colaboradores.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
          <div><label>De</label><input type="date" value={filtro.de} onChange={e => setFiltro({ ...filtro, de: e.target.value })} /></div>
          <div><label>Até</label><input type="date" value={filtro.ate} onChange={e => setFiltro({ ...filtro, ate: e.target.value })} /></div>
          <div><label>Método</label>
            <select value={filtro.metodo} onChange={e => setFiltro({ ...filtro, metodo: e.target.value })}>
              <option value="">Todos</option>
              {Object.entries(METODOS_MARCACAO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="row-actions">
            <button className="btn" onClick={carregar}>Filtrar</button>
            <button className="btn secondary" onClick={() => setMostrarManual(!mostrarManual)}>Registrar marcação manual</button>
            {isAdmin && <button className="btn secondary" onClick={verificarCadeia}>Verificar integridade</button>}
          </div>
        </div>
      </div>

      {mostrarManual && (
        <div className="panel" style={{ borderColor: 'var(--amber)' }}>
          <h3>Marcação manual (contingência)</h3>
          <form onSubmit={registrarManual} className="form-grid">
            <div><label>Colaborador</label>
              <select required value={fManual.colaborador_id} onChange={e => setFManual({ ...fManual, colaborador_id: e.target.value })}>
                <option value="">— selecionar —</option>
                {colaboradores.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
            <div><label>Unidade</label>
              <select required value={fManual.unidade_id} onChange={e => setFManual({ ...fManual, unidade_id: e.target.value })}>
                <option value="">— selecionar —</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
              </select>
            </div>
            <div><label>Tipo</label>
              <select value={fManual.tipo} onChange={e => setFManual({ ...fManual, tipo: e.target.value })}>
                {Object.entries(TIPOS_MARCACAO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div><label>Motivo (obrigatório)</label><input required minLength={5} value={fManual.motivo} onChange={e => setFManual({ ...fManual, motivo: e.target.value })} placeholder="Ex.: tablet indisponível, falha no reconhecimento" /></div>
            <div><button className="btn" type="submit">Registrar</button></div>
          </form>
          <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
            A marcação manual usa a hora oficial do servidor (não é possível retroagir) e fica registrada com o seu usuário e o motivo, em log de auditoria.
          </p>
        </div>
      )}

      <div className="panel">
        <h3>Marcações ({lista.length}{lista.length === 500 ? '+ — refine o filtro' : ''})</h3>
        {loading ? <p className="muted">Carregando…</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>NSR</th><th>Colaborador</th><th>Data/hora</th><th>Tipo</th><th>Método</th><th>Unidade</th><th>Score</th><th>Origem</th><th>Hash</th></tr></thead>
              <tbody>
                {lista.length ? lista.map(m => (
                  <tr key={m.id}>
                    <td>{m.nsr}</td>
                    <td>{nomeColab(m.colaborador_id)}</td>
                    <td className="muted">{new Date(m.data_hora_local).toLocaleString('pt-BR')}</td>
                    <td>{TIPOS_MARCACAO[m.tipo]}</td>
                    <td>
                      {m.metodo === 'facial' ? <span className="tag ok">Facial{m.liveness_ok ? ' ✓' : ''}</span>
                        : m.metodo === 'pin' ? <span className="tag warn">PIN</span>
                        : <span className="tag bad" title={m.motivo_manual || ''}>Manual</span>}
                    </td>
                    <td className="muted">{nomeUnidade(m.unidade_id)}</td>
                    <td className="muted">{m.score_similaridade != null ? Number(m.score_similaridade).toFixed(3) : '—'}</td>
                    <td className="muted">{m.origem}</td>
                    <td className="muted" title={m.record_hash} style={{ fontFamily: 'monospace', fontSize: 10.5 }}>🔒 {(m.record_hash || '').slice(0, 10)}…</td>
                  </tr>
                )) : <tr className="empty-row"><td colSpan={9}>Nenhuma marcação no período.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
          Marcações originais são imutáveis por lei: não podem ser editadas nem excluídas por ninguém, inclusive administradores.
          Cada marcação tem NSR sequencial por empregador e hash encadeado com a anterior.
        </p>
      </div>

      <div className="panel">
        <h3>Últimas tentativas recusadas</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Data/hora</th><th>Motivo</th><th>Unidade</th><th>Score</th></tr></thead>
            <tbody>
              {tentativas.length ? tentativas.map(t => (
                <tr key={t.id}>
                  <td className="muted">{new Date(t.created_at).toLocaleString('pt-BR')}</td>
                  <td><span className="tag warn">{t.motivo}</span></td>
                  <td className="muted">{nomeUnidade(t.unidade_id)}</td>
                  <td className="muted">{t.melhor_score != null ? Number(t.melhor_score).toFixed(3) : '—'}</td>
                </tr>
              )) : <tr className="empty-row"><td colSpan={4}>Nenhuma tentativa recusada registrada.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
