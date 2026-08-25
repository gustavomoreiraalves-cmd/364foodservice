'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import AppShell from '../../../components/AppShell';
import PontoTabs from '../../../components/PontoTabs';
import FichaPrint, { imprimirFicha } from '../../../components/FichaPrint';
import { useEmpresaAtual } from '../../../lib/empresa';
import { useIsAdmin, TIPOS_MARCACAO } from '../../../lib/ponto';
import { apurarPeriodo, resumo, fmtMinutos, DIAS_SEMANA } from '../../../lib/apuracao';

function mesAtualISO() { return new Date().toISOString().slice(0, 7); }
function limitesDoMes(mesISO) {
  const [ano, mes] = mesISO.split('-').map(Number);
  const de = `${mesISO}-01`;
  const ate = new Date(ano, mes, 0).toISOString().slice(0, 10); // dia 0 do mês seguinte = último dia deste
  return { de, ate };
}

export default function ApuracaoPage() {
  const [ficha, setFicha] = useState(null);
  return (
    <>
      <AppShell modulo="ponto" titulo="Ponto — Apuração" desc="Espelho de ponto: previsto x realizado, atrasos, extras e banco de horas">
        <PontoTabs />
        <Conteudo setFicha={setFicha} />
      </AppShell>
      <FichaPrint ficha={ficha} />
    </>
  );
}

function Conteudo({ setFicha }) {
  const { empresaAtual } = useEmpresaAtual();
  const isAdmin = useIsAdmin();
  const [colaboradores, setColaboradores] = useState([]);
  const [colaboradorId, setColaboradorId] = useState('');
  const [mes, setMes] = useState(mesAtualISO());
  const [dados, setDados] = useState(null);
  const [loading, setLoading] = useState(true);
  const [ajustandoDia, setAjustandoDia] = useState(null);
  const [fAjuste, setFAjuste] = useState({ tipo: 'marcacao_retroativa', marcacao_tipo: 'entrada', horario: '', minutos_ajuste: '', motivo: '' });
  const [salvando, setSalvando] = useState(false);
  const [fechamento, setFechamento] = useState(null);

  useEffect(() => {
    if (!empresaAtual) return;
    supabase.from('colaboradores').select('id, nome, banco_horas, status')
      .eq('empresa_id', empresaAtual.id).order('nome')
      .then(({ data }) => {
        setColaboradores(data || []);
        setColaboradorId(atual => atual || (data?.[0]?.id || ''));
      });
  }, [empresaAtual?.id]);

  const { de, ate } = limitesDoMes(mes);

  async function carregar() {
    if (!colaboradorId) { setDados(null); setLoading(false); return; }
    setLoading(true);
    const [{ data: ces }, { data: escalas }, { data: escalaDias }, { data: marcacoes }, { data: ajustes }, { data: fech }] = await Promise.all([
      supabase.from('colaborador_escalas').select('*').eq('colaborador_id', colaboradorId),
      supabase.from('escalas').select('*'),
      supabase.from('escala_dias').select('*'),
      supabase.from('ponto_marcacoes').select('colaborador_id, tipo, data_hora_local, status')
        .eq('colaborador_id', colaboradorId).eq('status', 'valida')
        .gte('data_hora_local', de + 'T00:00:00').lte('data_hora_local', ate + 'T23:59:59'),
      supabase.from('ponto_ajustes').select('*').eq('colaborador_id', colaboradorId).gte('dia', de).lte('dia', ate),
      supabase.from('ponto_fechamentos').select('*').eq('colaborador_id', colaboradorId).eq('competencia', de).maybeSingle(),
    ]);
    const linhas = apurarPeriodo({
      colaboradorIds: [colaboradorId], de, ate,
      colaboradorEscalas: ces || [], escalas: escalas || [], escalaDias: escalaDias || [],
      marcacoes: marcacoes || [], ajustes: ajustes || [],
    });
    setDados(linhas);
    setFechamento(fech || null);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [colaboradorId, mes]);

  async function salvarAjuste(dia) {
    if (!fAjuste.motivo.trim()) { alert('Informe o motivo do ajuste.'); return; }
    setSalvando(true);
    const { data: { session } } = await supabase.auth.getSession();
    const payload = {
      colaborador_id: colaboradorId, dia, tipo: fAjuste.tipo, motivo: fAjuste.motivo.trim(),
      criado_por: session.user.id,
      marcacao_tipo: fAjuste.tipo === 'marcacao_retroativa' ? fAjuste.marcacao_tipo : null,
      horario: fAjuste.tipo === 'marcacao_retroativa' ? fAjuste.horario : null,
      minutos_ajuste: fAjuste.tipo === 'compensacao_manual' ? Number(fAjuste.minutos_ajuste) : null,
    };
    const { error } = await supabase.from('ponto_ajustes').insert([payload]);
    setSalvando(false);
    if (error) { alert('Erro ao salvar ajuste: ' + error.message); return; }
    setAjustandoDia(null);
    setFAjuste({ tipo: 'marcacao_retroativa', marcacao_tipo: 'entrada', horario: '', minutos_ajuste: '', motivo: '' });
    carregar();
  }

  const colaborador = colaboradores.find(c => c.id === colaboradorId);
  const r = dados ? resumo(dados) : null;

  function imprimirEspelho() {
    if (!dados || !colaborador) return;
    imprimirFicha(setFicha, {
      titulo: 'Espelho de Ponto',
      numero: `${colaborador.nome} · ${mes}`,
      campos: [
        { rot: 'Colaborador', valor: colaborador.nome },
        { rot: 'Competência', valor: mes },
        { rot: 'Previsto', valor: fmtMinutos(r.previstoMinutos) + 'h' },
        { rot: 'Trabalhado', valor: fmtMinutos(r.trabalhadoMinutos) + 'h' },
        { rot: 'Atrasos', valor: fmtMinutos(r.atrasoMinutos) + 'h' },
        { rot: 'Faltas', valor: `${r.diasFalta} dia(s)` },
      ],
      itens: {
        headers: ['Dia', 'Entrada', 'Int. início', 'Int. fim', 'Saída', 'Trabalhado', 'Saldo', 'Situação'],
        rows: dados.map(l => [
          `${DIAS_SEMANA[new Date(l.dia + 'T12:00:00').getDay()].slice(0, 3)} ${l.dia.slice(8, 10)}/${l.dia.slice(5, 7)}`,
          l.entradaReal != null ? fmtMinutos(l.entradaReal) : (l.previstoEntrada || '—'),
          l.intInicioReal != null ? fmtMinutos(l.intInicioReal) : (l.previstoIntInicio || '—'),
          l.intFimReal != null ? fmtMinutos(l.intFimReal) : (l.previstoIntFim || '—'),
          l.saidaReal != null ? fmtMinutos(l.saidaReal) : (l.previstoSaida || '—'),
          l.trabalha ? fmtMinutos(l.trabalhadoMinutos) : '—',
          l.trabalha || l.falta ? fmtMinutos(l.saldoMinutos) : '—',
          l.falta ? 'Falta' : !l.trabalha ? 'Folga' : l.atrasoMinutos > 0 ? 'Atraso' : 'OK',
        ]),
      },
      totais: `Saldo do período: ${fmtMinutos(r.saldoMinutos)}h${colaborador.banco_horas ? ' (banco de horas)' : ''}`,
      assinaturas: ['Colaborador', 'Responsável RH'],
    });
  }

  return (
    <>
      <div className="panel">
        <h3>Espelho de ponto</h3>
        <div className="form-grid">
          <div><label>Colaborador</label>
            <select value={colaboradorId} onChange={e => setColaboradorId(e.target.value)}>
              {colaboradores.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
          <div><label>Competência</label><input type="month" value={mes} onChange={e => setMes(e.target.value)} /></div>
          <div><button className="btn secondary" type="button" onClick={imprimirEspelho} disabled={!dados}>Imprimir espelho</button></div>
        </div>

        {fechamento && (
          <p className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
            {fechamento.status === 'fechado'
              ? <><span className="tag ok">Período fechado</span> em {new Date(fechamento.fechado_em).toLocaleDateString('pt-BR')} — novos ajustes exigem reabertura em Fechamento.</>
              : <><span className="tag warn">Período reaberto</span> — {fechamento.reaberto_motivo}</>}
          </p>
        )}
      </div>

      {loading ? <p className="muted">Carregando…</p> : !dados ? null : (
        <>
          <div className="grid2">
            <div className="panel">
              <h3>Resumo do período</h3>
              <table>
                <tbody>
                  <tr><td>Previsto</td><td className="num">{fmtMinutos(r.previstoMinutos)}h</td></tr>
                  <tr><td>Trabalhado</td><td className="num">{fmtMinutos(r.trabalhadoMinutos)}h</td></tr>
                  <tr><td>Atrasos</td><td className="num">{fmtMinutos(r.atrasoMinutos)}h</td></tr>
                  <tr><td>Horas extras</td><td className="num">{fmtMinutos(r.extraMinutos)}h</td></tr>
                  <tr><td>Faltas</td><td className="num">{r.diasFalta} dia(s)</td></tr>
                  <tr><td><b>Saldo do período{colaborador?.banco_horas ? ' (banco de horas)' : ''}</b></td>
                    <td className="num" style={{ color: r.saldoMinutos < 0 ? 'var(--danger)' : 'var(--amber-bright)' }}>
                      <b>{fmtMinutos(r.saldoMinutos)}h</b>
                    </td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel">
            <h3>Dia a dia</h3>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Dia</th><th>Entrada</th><th>Int. início</th><th>Int. fim</th><th>Saída</th><th>Trabalhado</th><th>Saldo</th><th>Situação</th><th></th></tr></thead>
                <tbody>
                  {dados.map(l => (
                    <tr key={l.dia}>
                      <td className="muted">{DIAS_SEMANA[new Date(l.dia + 'T12:00:00').getDay()].slice(0, 3)} {l.dia.slice(8, 10)}/{l.dia.slice(5, 7)}</td>
                      <td className="num">{l.entradaReal != null ? fmtMinutos(l.entradaReal) : (l.previstoEntrada?.slice(0, 5) || '—')}</td>
                      <td className="num">{l.intInicioReal != null ? fmtMinutos(l.intInicioReal) : (l.previstoIntInicio?.slice(0, 5) || '—')}</td>
                      <td className="num">{l.intFimReal != null ? fmtMinutos(l.intFimReal) : (l.previstoIntFim?.slice(0, 5) || '—')}</td>
                      <td className="num">{l.saidaReal != null ? fmtMinutos(l.saidaReal) : (l.previstoSaida?.slice(0, 5) || '—')}</td>
                      <td className="num">{l.trabalha ? fmtMinutos(l.trabalhadoMinutos) : '—'}</td>
                      <td className="num">{l.trabalha || l.falta ? fmtMinutos(l.saldoMinutos) : '—'}</td>
                      <td>
                        {l.falta ? <span className="tag bad">Falta</span>
                          : !l.trabalha ? <span className="muted">Folga</span>
                          : l.atrasoMinutos > 0 ? <span className="tag warn">Atraso</span>
                          : <span className="tag ok">OK</span>}
                        {l.ajustado && <span className="tag" style={{ marginLeft: 4 }} title={l.ajustes.map(a => a.motivo).join('; ')}>Ajustado</span>}
                      </td>
                      <td>
                        {isAdmin && (!fechamento || fechamento.status === 'reaberto') && (
                          <button className="btn secondary small" onClick={() => setAjustandoDia(l.dia)}>Ajustar</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {ajustandoDia && (
        <div className="panel" style={{ borderColor: 'var(--amber)' }}>
          <h3>Ajuste retroativo — {ajustandoDia}</h3>
          <div className="form-grid">
            <div><label>Tipo</label>
              <select value={fAjuste.tipo} onChange={e => setFAjuste({ ...fAjuste, tipo: e.target.value })}>
                <option value="marcacao_retroativa">Corrigir horário de uma marcação</option>
                <option value="falta_abonada">Abonar falta</option>
                <option value="compensacao_manual">Compensação manual (minutos)</option>
              </select>
            </div>
            {fAjuste.tipo === 'marcacao_retroativa' && (
              <>
                <div><label>Marcação</label>
                  <select value={fAjuste.marcacao_tipo} onChange={e => setFAjuste({ ...fAjuste, marcacao_tipo: e.target.value })}>
                    {Object.entries(TIPOS_MARCACAO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div><label>Horário correto</label><input type="time" value={fAjuste.horario} onChange={e => setFAjuste({ ...fAjuste, horario: e.target.value })} /></div>
              </>
            )}
            {fAjuste.tipo === 'compensacao_manual' && (
              <div><label>Minutos (+ credita, − debita)</label><input type="number" value={fAjuste.minutos_ajuste} onChange={e => setFAjuste({ ...fAjuste, minutos_ajuste: e.target.value })} placeholder="Ex.: 60 ou -30" /></div>
            )}
            <div><label>Motivo (obrigatório)</label><input required value={fAjuste.motivo} onChange={e => setFAjuste({ ...fAjuste, motivo: e.target.value })} placeholder="Ex.: esqueceu de bater saída" /></div>
          </div>
          <div className="row-actions" style={{ marginTop: 14 }}>
            <button className="btn" disabled={salvando} onClick={() => salvarAjuste(ajustandoDia)}>{salvando ? 'Salvando…' : 'Salvar ajuste'}</button>
            <button className="btn secondary" onClick={() => setAjustandoDia(null)}>Cancelar</button>
          </div>
        </div>
      )}
    </>
  );
}
