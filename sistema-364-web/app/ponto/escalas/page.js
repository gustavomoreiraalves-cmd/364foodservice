'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import AppShell from '../../../components/AppShell';
import PontoTabs from '../../../components/PontoTabs';
import { useEmpresaAtual } from '../../../lib/empresa';

const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const ESCALA_VAZIA = { nome: '', tipo: 'fixo', tolerancia_minutos: '10' };
const DIA_VAZIO = { trabalha: true, entrada: '08:00', intervalo_inicio: '12:00', intervalo_fim: '13:00', saida: '17:00' };

function diasIniciais(tipo) {
  const n = tipo === '12x36' ? 2 : 7;
  return Array.from({ length: n }, (_, i) => ({
    dia: i,
    ...(tipo === '12x36'
      ? (i === 0 ? { trabalha: true, entrada: '07:00', intervalo_inicio: '12:00', intervalo_fim: '13:00', saida: '19:00' } : { trabalha: false, entrada: '', intervalo_inicio: '', intervalo_fim: '', saida: '' })
      : (i === 0 ? { trabalha: false, entrada: '', intervalo_inicio: '', intervalo_fim: '', saida: '' } : { ...DIA_VAZIO })),
  }));
}

export default function EscalasPage() {
  return (
    <AppShell modulo="ponto" titulo="Ponto — Escalas" desc="Jornadas previstas e atribuição aos colaboradores">
      <PontoTabs />
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const { empresaAtual, empresas: empresasGrupo } = useEmpresaAtual();
  const [escalas, setEscalas] = useState([]);
  const [dias, setDias] = useState([]);
  const [colaboradores, setColaboradores] = useState([]);
  const [atribuicoes, setAtribuicoes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fEscala, setFEscala] = useState(ESCALA_VAZIA);
  const [fDias, setFDias] = useState(diasIniciais('fixo'));
  const [mostrarForm, setMostrarForm] = useState(false);
  const [fAtrib, setFAtrib] = useState({ colaborador_id: '', escala_id: '', data_inicio: new Date().toISOString().slice(0, 10), motivo: '' });
  const [historicoDe, setHistoricoDe] = useState('');

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    const [{ data: escs }, { data: ds }, { data: colabs }, { data: atribs }] = await Promise.all([
      // compartilhadas entre todas as empresas do grupo — sem filtro por empresa_id
      supabase.from('escalas').select('*').order('nome'),
      supabase.from('escala_dias').select('*'),
      supabase.from('colaboradores').select('id, nome, status').eq('empresa_id', empresaAtual.id).order('nome'),
      supabase.from('colaborador_escalas').select('*').order('data_inicio', { ascending: false }),
    ]);
    setEscalas(escs || []);
    setDias(ds || []);
    setColaboradores(colabs || []);
    setAtribuicoes(atribs || []);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  function mudarTipo(tipo) {
    setFEscala({ ...fEscala, tipo });
    setFDias(diasIniciais(tipo));
  }

  function setDiaCampo(i, campo, valor) {
    setFDias(fDias.map((d, idx) => idx === i ? { ...d, [campo]: valor } : d));
  }

  async function salvarEscala(e) {
    e.preventDefault();
    const { data, error } = await supabase.from('escalas').insert([{
      empresa_id: empresaAtual.id, // só registro de origem — a escala fica visível a todas as empresas
      nome: fEscala.nome,
      tipo: fEscala.tipo,
      ciclo_dias: fEscala.tipo === '12x36' ? 2 : null,
      tolerancia_minutos: Number(fEscala.tolerancia_minutos) || 10,
    }]).select().single();
    if (error) { alert('Erro ao salvar escala: ' + error.message); return; }
    const linhas = fDias.map(d => ({
      escala_id: data.id,
      dia: d.dia,
      trabalha: d.trabalha,
      entrada: d.trabalha && d.entrada ? d.entrada : null,
      intervalo_inicio: d.trabalha && d.intervalo_inicio ? d.intervalo_inicio : null,
      intervalo_fim: d.trabalha && d.intervalo_fim ? d.intervalo_fim : null,
      saida: d.trabalha && d.saida ? d.saida : null,
    }));
    const { error: e2 } = await supabase.from('escala_dias').insert(linhas);
    if (e2) { alert('Escala criada, mas houve erro nos horários: ' + e2.message); }
    setFEscala(ESCALA_VAZIA);
    setFDias(diasIniciais('fixo'));
    setMostrarForm(false);
    carregar();
  }

  async function atribuir(e) {
    e.preventDefault();
    const { colaborador_id, escala_id, data_inicio, motivo } = fAtrib;
    if (!colaborador_id || !escala_id) return;

    // histórico: encerra a vigência atual (se houver) um dia antes da nova
    const vigente = atribuicoes.find(a => a.colaborador_id === colaborador_id && !a.data_fim);
    if (vigente) {
      if (vigente.data_inicio >= data_inicio) {
        alert('A nova vigência precisa começar depois do início da escala atual (' + vigente.data_inicio + ').');
        return;
      }
      const fim = new Date(data_inicio + 'T12:00:00');
      fim.setDate(fim.getDate() - 1);
      const { error: eFim } = await supabase.from('colaborador_escalas')
        .update({ data_fim: fim.toISOString().slice(0, 10) }).eq('id', vigente.id);
      if (eFim) { alert('Erro ao encerrar a escala anterior: ' + eFim.message); return; }
    }

    const { data: { session } } = await supabase.auth.getSession();
    const escala = escalas.find(s => s.id === escala_id);
    const { error } = await supabase.from('colaborador_escalas').insert([{
      colaborador_id, escala_id, data_inicio,
      data_referencia_ciclo: escala?.tipo === '12x36' ? data_inicio : null,
      motivo: motivo || null,
      criado_por: session?.user?.id || null,
    }]);
    if (error) { alert('Erro ao atribuir escala: ' + error.message); return; }
    setFAtrib({ ...fAtrib, colaborador_id: '', escala_id: '', motivo: '' });
    carregar();
  }

  const nomeColab = id => colaboradores.find(c => c.id === id)?.nome || '—';
  const nomeEscala = id => escalas.find(s => s.id === id)?.nome || '—';
  const nomeEmpresa = id => empresasGrupo?.find(e => e.id === id)?.nome || '—';
  const rotuloDia = (escala, dia) => escala?.tipo === '12x36' ? `Dia ${dia + 1} do ciclo` : DIAS_SEMANA[dia];

  if (loading) return <p className="muted">Carregando…</p>;

  return (
    <>
      <div className="panel">
        <h3>Escalas do Grupo 364</h3>
        <p className="muted" style={{ fontSize: 11.5, margin: '-6px 0 12px' }}>
          Compartilhadas entre todas as empresas — cadastre uma vez e atribua a colaboradores de qualquer marca.
        </p>
        {!mostrarForm ? (
          <button className="btn" onClick={() => setMostrarForm(true)}>Criar escala</button>
        ) : (
          <form onSubmit={salvarEscala}>
            <div className="form-grid">
              <div><label>Nome</label><input required value={fEscala.nome} onChange={e => setFEscala({ ...fEscala, nome: e.target.value })} placeholder="Ex.: Salão 6x1 — 08h às 17h" /></div>
              <div><label>Tipo</label>
                <select value={fEscala.tipo} onChange={e => mudarTipo(e.target.value)}>
                  <option value="fixo">Horário fixo</option>
                  <option value="5x2">5x2</option>
                  <option value="6x1">6x1</option>
                  <option value="12x36">12x36</option>
                  <option value="livre">Livre</option>
                </select>
              </div>
              <div><label>Tolerância (minutos)</label><input type="number" value={fEscala.tolerancia_minutos} onChange={e => setFEscala({ ...fEscala, tolerancia_minutos: e.target.value })} /></div>
            </div>
            <div className="table-wrap" style={{ marginTop: 14 }}>
              <table>
                <thead><tr><th>{fEscala.tipo === '12x36' ? 'Ciclo' : 'Dia'}</th><th>Trabalha</th><th>Entrada</th><th>Início intervalo</th><th>Fim intervalo</th><th>Saída</th></tr></thead>
                <tbody>
                  {fDias.map((d, i) => (
                    <tr key={i}>
                      <td>{fEscala.tipo === '12x36' ? `Dia ${i + 1}` : DIAS_SEMANA[i]}</td>
                      <td>
                        <select value={d.trabalha ? 'sim' : 'nao'} onChange={e => setDiaCampo(i, 'trabalha', e.target.value === 'sim')}>
                          <option value="sim">Sim</option>
                          <option value="nao">Folga</option>
                        </select>
                      </td>
                      <td><input type="time" disabled={!d.trabalha} value={d.entrada} onChange={e => setDiaCampo(i, 'entrada', e.target.value)} /></td>
                      <td><input type="time" disabled={!d.trabalha} value={d.intervalo_inicio} onChange={e => setDiaCampo(i, 'intervalo_inicio', e.target.value)} /></td>
                      <td><input type="time" disabled={!d.trabalha} value={d.intervalo_fim} onChange={e => setDiaCampo(i, 'intervalo_fim', e.target.value)} /></td>
                      <td><input type="time" disabled={!d.trabalha} value={d.saida} onChange={e => setDiaCampo(i, 'saida', e.target.value)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row-actions" style={{ marginTop: 14 }}>
              <button className="btn" type="submit">Salvar escala</button>
              <button className="btn secondary" type="button" onClick={() => setMostrarForm(false)}>Cancelar</button>
            </div>
          </form>
        )}

        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table>
            <thead><tr><th>Nome</th><th>Tipo</th><th>Horários</th><th>Tolerância</th><th>Origem</th><th>Situação</th></tr></thead>
            <tbody>
              {escalas.length ? escalas.map(s => {
                const meusDias = dias.filter(d => d.escala_id === s.id).sort((a, b) => a.dia - b.dia);
                return (
                  <tr key={s.id}>
                    <td>{s.nome}</td>
                    <td className="muted">{s.tipo}</td>
                    <td className="muted" style={{ fontSize: 11.5 }}>
                      {meusDias.filter(d => d.trabalha).map(d => `${rotuloDia(s, d.dia).slice(0, 3)} ${d.entrada?.slice(0, 5) || '?'}–${d.saida?.slice(0, 5) || '?'}`).join(' · ') || '—'}
                    </td>
                    <td className="muted">{s.tolerancia_minutos} min</td>
                    <td className="muted">{s.empresa_id ? nomeEmpresa(s.empresa_id) : '—'}</td>
                    <td>{s.ativo ? <span className="tag ok">Ativa</span> : <span className="tag bad">Inativa</span>}</td>
                  </tr>
                );
              }) : <tr className="empty-row"><td colSpan={6}>Nenhuma escala cadastrada.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h3>Atribuição de escala</h3>
        <form onSubmit={atribuir} className="form-grid">
          <div><label>Colaborador</label>
            <select required value={fAtrib.colaborador_id} onChange={e => setFAtrib({ ...fAtrib, colaborador_id: e.target.value })}>
              <option value="">— selecionar —</option>
              {colaboradores.filter(c => c.status !== 'desligado').map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
          <div><label>Escala</label>
            <select required value={fAtrib.escala_id} onChange={e => setFAtrib({ ...fAtrib, escala_id: e.target.value })}>
              <option value="">— selecionar —</option>
              {escalas.filter(s => s.ativo).map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          </div>
          <div><label>Início da vigência</label><input type="date" required value={fAtrib.data_inicio} onChange={e => setFAtrib({ ...fAtrib, data_inicio: e.target.value })} /></div>
          <div><label>Motivo</label><input value={fAtrib.motivo} onChange={e => setFAtrib({ ...fAtrib, motivo: e.target.value })} placeholder="Ex.: admissão, mudança de turno" /></div>
          <div><button className="btn" type="submit">Atribuir</button></div>
        </form>
        <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
          Ao atribuir uma nova escala, a anterior é encerrada na véspera — o histórico fica preservado e nunca é apagado.
        </p>

        <div style={{ marginTop: 14 }}>
          <label className="muted" style={{ fontSize: 11.5 }}>Ver histórico de:</label>{' '}
          <select value={historicoDe} onChange={e => setHistoricoDe(e.target.value)} style={{ fontSize: 12 }}>
            <option value="">— vigentes de todos —</option>
            {colaboradores.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </div>
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table>
            <thead><tr><th>Colaborador</th><th>Escala</th><th>Vigência</th><th>Motivo</th><th>Status</th></tr></thead>
            <tbody>
              {(historicoDe
                ? atribuicoes.filter(a => a.colaborador_id === historicoDe)
                : atribuicoes.filter(a => !a.data_fim)
              ).map(a => (
                <tr key={a.id}>
                  <td>{nomeColab(a.colaborador_id)}</td>
                  <td>{nomeEscala(a.escala_id)}</td>
                  <td className="muted">{a.data_inicio} → {a.data_fim || 'vigente'}</td>
                  <td className="muted">{a.motivo || '—'}</td>
                  <td>{!a.data_fim ? <span className="tag ok">Vigente</span> : <span className="tag warn">Encerrada</span>}</td>
                </tr>
              ))}
              {!atribuicoes.length && <tr className="empty-row"><td colSpan={5}>Nenhuma atribuição ainda.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
