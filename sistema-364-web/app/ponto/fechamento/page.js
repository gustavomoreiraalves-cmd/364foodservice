'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import AppShell from '../../../components/AppShell';
import PontoTabs from '../../../components/PontoTabs';
import PromptDialog from '../../../components/PromptDialog';
import { useEmpresaAtual } from '../../../lib/empresa';
import { useIsAdmin } from '../../../lib/ponto';
import { apurarPeriodo, resumo, fmtMinutos } from '../../../lib/apuracao';

function mesAtualISO() { return new Date().toISOString().slice(0, 7); }
function limitesDoMes(mesISO) {
  const [ano, mes] = mesISO.split('-').map(Number);
  return { de: `${mesISO}-01`, ate: new Date(ano, mes, 0).toISOString().slice(0, 10) };
}

export default function FechamentoPage() {
  return (
    <AppShell modulo="ponto" titulo="Ponto — Fechamento" desc="Consolida e trava a apuração do período por colaborador">
      <PontoTabs />
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const { empresaAtual } = useEmpresaAtual();
  const isAdmin = useIsAdmin();
  const [mes, setMes] = useState(mesAtualISO());
  const [linhas, setLinhas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reabrindo, setReabrindo] = useState(null); // fechamento sendo reaberto

  const { de, ate } = limitesDoMes(mes);

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    const { data: colabs } = await supabase.from('colaboradores')
      .select('id, nome, banco_horas').eq('empresa_id', empresaAtual.id).eq('status', 'ativo').order('nome');
    const ids = (colabs || []).map(c => c.id);
    if (!ids.length) { setLinhas([]); setLoading(false); return; }

    const [{ data: ces }, { data: escalas }, { data: escalaDias }, { data: marcacoes }, { data: ajustes }, { data: fechs }] = await Promise.all([
      supabase.from('colaborador_escalas').select('*').in('colaborador_id', ids),
      supabase.from('escalas').select('*'),
      supabase.from('escala_dias').select('*'),
      supabase.from('ponto_marcacoes').select('colaborador_id, tipo, data_hora_local, status').in('colaborador_id', ids)
        .eq('status', 'valida').gte('data_hora_local', de + 'T00:00:00').lte('data_hora_local', ate + 'T23:59:59'),
      supabase.from('ponto_ajustes').select('*').in('colaborador_id', ids).gte('dia', de).lte('dia', ate),
      supabase.from('ponto_fechamentos').select('*').in('colaborador_id', ids).eq('competencia', de),
    ]);

    const apurado = apurarPeriodo({
      colaboradorIds: ids, de, ate,
      colaboradorEscalas: ces || [], escalas: escalas || [], escalaDias: escalaDias || [],
      marcacoes: marcacoes || [], ajustes: ajustes || [],
    });

    const porColab = ids.map(id => {
      const colab = colabs.find(c => c.id === id);
      const r = resumo(apurado.filter(l => l.colaboradorId === id));
      const fech = (fechs || []).find(f => f.colaborador_id === id);
      return { colaborador: colab, resumo: r, fechamento: fech || null };
    });
    setLinhas(porColab);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id, mes]);

  async function fechar(linha) {
    const { data: { session } } = await supabase.auth.getSession();
    const { resumo: r } = linha;
    const { error } = await supabase.from('ponto_fechamentos').upsert([{
      colaborador_id: linha.colaborador.id, competencia: de, status: 'fechado',
      previsto_minutos: r.previstoMinutos, trabalhado_minutos: r.trabalhadoMinutos,
      atraso_minutos: r.atrasoMinutos, extra_minutos: r.extraMinutos, saldo_minutos: r.saldoMinutos,
      dias_falta: r.diasFalta, fechado_por: session.user.id, fechado_em: new Date().toISOString(),
      reaberto_por: null, reaberto_em: null, reaberto_motivo: null,
    }], { onConflict: 'colaborador_id,competencia' });
    if (error) { alert('Erro ao fechar: ' + error.message); return; }
    carregar();
  }

  async function fecharTodos() {
    const abertos = linhas.filter(l => !l.fechamento || l.fechamento.status === 'reaberto');
    if (!abertos.length) { alert('Nada para fechar neste período.'); return; }
    if (!confirm(`Fechar a apuração de ${abertos.length} colaborador(es) para ${mes}?`)) return;
    for (const l of abertos) await fechar(l);
  }

  async function reabrir(motivo) {
    if (!reabrindo) return;
    const { data: { session } } = await supabase.auth.getSession();
    const { error } = await supabase.from('ponto_fechamentos').update({
      status: 'reaberto', reaberto_por: session.user.id, reaberto_em: new Date().toISOString(), reaberto_motivo: motivo,
    }).eq('id', reabrindo.id);
    setReabrindo(null);
    if (error) { alert('Erro ao reabrir: ' + error.message); return; }
    carregar();
  }

  if (loading) return <p className="muted">Carregando…</p>;

  return (
    <>
      <div className="panel">
        <h3>Fechamento — {empresaAtual?.nome}</h3>
        <div className="form-grid">
          <div><label>Competência</label><input type="month" value={mes} onChange={e => setMes(e.target.value)} /></div>
          {isAdmin && <div><button className="btn" type="button" onClick={fecharTodos}>Fechar todos do período</button></div>}
        </div>

        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table>
            <thead><tr><th>Colaborador</th><th>Previsto</th><th>Trabalhado</th><th>Atrasos</th><th>Extras</th><th>Faltas</th><th>Saldo</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {linhas.length ? linhas.map(l => (
                <tr key={l.colaborador.id}>
                  <td>{l.colaborador.nome}</td>
                  <td className="num">{fmtMinutos(l.resumo.previstoMinutos)}h</td>
                  <td className="num">{fmtMinutos(l.resumo.trabalhadoMinutos)}h</td>
                  <td className="num">{fmtMinutos(l.resumo.atrasoMinutos)}h</td>
                  <td className="num">{fmtMinutos(l.resumo.extraMinutos)}h</td>
                  <td className="num">{l.resumo.diasFalta}</td>
                  <td className="num">{fmtMinutos(l.resumo.saldoMinutos)}h</td>
                  <td>
                    {!l.fechamento ? <span className="muted">Aberto</span>
                      : l.fechamento.status === 'fechado' ? <span className="tag ok">Fechado</span>
                      : <span className="tag warn">Reaberto</span>}
                  </td>
                  <td>
                    {isAdmin && (!l.fechamento || l.fechamento.status === 'reaberto') && (
                      <button className="btn secondary small" onClick={() => fechar(l)}>Fechar</button>
                    )}
                    {isAdmin && l.fechamento?.status === 'fechado' && (
                      <button className="btn secondary small" onClick={() => setReabrindo(l.fechamento)}>Reabrir</button>
                    )}
                  </td>
                </tr>
              )) : <tr className="empty-row"><td colSpan={9}>Nenhum colaborador ativo nesta empresa.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
          Fechar consolida um snapshot do período e bloqueia novos ajustes retroativos (Ponto → Apuração)
          até que um administrador reabra, informando o motivo.
        </p>
      </div>

      {reabrindo && (
        <PromptDialog
          titulo="Reabrir período"
          label="Motivo da reabertura"
          placeholder="Ex.: erro de marcação identificado, ajuste solicitado"
          aoConfirmar={reabrir}
          aoCancelar={() => setReabrindo(null)}
        />
      )}
    </>
  );
}
