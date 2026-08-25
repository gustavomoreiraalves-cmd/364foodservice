'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import AppShell from '../../../components/AppShell';
import PontoTabs from '../../../components/PontoTabs';
import { useEmpresaAtual } from '../../../lib/empresa';
import { apurarPeriodo, resumo, fmtMinutos } from '../../../lib/apuracao';

function mesAtualISO() { return new Date().toISOString().slice(0, 7); }
function limitesDoMes(mesISO) {
  const [ano, mes] = mesISO.split('-').map(Number);
  return { de: `${mesISO}-01`, ate: new Date(ano, mes, 0).toISOString().slice(0, 10) };
}
function hojeISO() { return new Date().toISOString().slice(0, 10); }

export default function PainelPage() {
  return (
    <AppShell modulo="ponto" titulo="Ponto — Painel do gestor" desc="Ranking de atrasos, faltas e banco de horas">
      <PontoTabs />
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const { empresaAtual } = useEmpresaAtual();
  const [mes, setMes] = useState(mesAtualISO());
  const [porColabMes, setPorColabMes] = useState([]);
  const [porColabBanco, setPorColabBanco] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!empresaAtual) return;
    let ativo = true;
    async function carregar() {
      setLoading(true);
      const { data: colabs } = await supabase.from('colaboradores')
        .select('id, nome, banco_horas').eq('empresa_id', empresaAtual.id).eq('status', 'ativo').order('nome');
      const ids = (colabs || []).map(c => c.id);
      if (!ids.length) { if (ativo) { setPorColabMes([]); setPorColabBanco([]); setLoading(false); } return; }

      const [{ data: ces }, { data: escalas }, { data: escalaDias }] = await Promise.all([
        supabase.from('colaborador_escalas').select('*').in('colaborador_id', ids),
        supabase.from('escalas').select('*'),
        supabase.from('escala_dias').select('*'),
      ]);

      // ranking de atrasos/faltas do mês selecionado
      const { de, ate } = limitesDoMes(mes);
      const [{ data: marcMes }, { data: ajusMes }] = await Promise.all([
        supabase.from('ponto_marcacoes').select('colaborador_id, tipo, data_hora_local, status').in('colaborador_id', ids)
          .eq('status', 'valida').gte('data_hora_local', de + 'T00:00:00').lte('data_hora_local', ate + 'T23:59:59'),
        supabase.from('ponto_ajustes').select('*').in('colaborador_id', ids).gte('dia', de).lte('dia', ate),
      ]);
      const apuradoMes = apurarPeriodo({
        colaboradorIds: ids, de, ate, colaboradorEscalas: ces || [], escalas: escalas || [], escalaDias: escalaDias || [],
        marcacoes: marcMes || [], ajustes: ajusMes || [],
      });
      const resumoMes = ids.map(id => ({
        colaborador: colabs.find(c => c.id === id),
        resumo: resumo(apuradoMes.filter(l => l.colaboradorId === id)),
      }));

      // banco de horas: acumulado desde o início do vínculo mais antigo até hoje
      const inicios = (ces || []).map(v => v.data_inicio).filter(Boolean).sort();
      const desde = inicios[0] || de;
      const hoje = hojeISO();
      const idsBanco = ids.filter(id => colabs.find(c => c.id === id)?.banco_horas);
      let resumoBanco = [];
      if (idsBanco.length) {
        const [{ data: marcTudo }, { data: ajusTudo }] = await Promise.all([
          supabase.from('ponto_marcacoes').select('colaborador_id, tipo, data_hora_local, status').in('colaborador_id', idsBanco)
            .eq('status', 'valida').gte('data_hora_local', desde + 'T00:00:00').lte('data_hora_local', hoje + 'T23:59:59'),
          supabase.from('ponto_ajustes').select('*').in('colaborador_id', idsBanco).gte('dia', desde).lte('dia', hoje),
        ]);
        const apuradoBanco = apurarPeriodo({
          colaboradorIds: idsBanco, de: desde, ate: hoje, colaboradorEscalas: ces || [], escalas: escalas || [], escalaDias: escalaDias || [],
          marcacoes: marcTudo || [], ajustes: ajusTudo || [],
        });
        resumoBanco = idsBanco.map(id => ({
          colaborador: colabs.find(c => c.id === id),
          resumo: resumo(apuradoBanco.filter(l => l.colaboradorId === id)),
        }));
      }

      if (ativo) { setPorColabMes(resumoMes); setPorColabBanco(resumoBanco); setLoading(false); }
    }
    carregar();
    return () => { ativo = false; };
  }, [empresaAtual?.id, mes]);

  if (loading) return <p className="muted">Carregando…</p>;

  const topAtrasos = porColabMes.filter(l => l.resumo.atrasoMinutos > 0).sort((a, b) => b.resumo.atrasoMinutos - a.resumo.atrasoMinutos).slice(0, 10);
  const topFaltas = porColabMes.filter(l => l.resumo.diasFalta > 0).sort((a, b) => b.resumo.diasFalta - a.resumo.diasFalta).slice(0, 10);
  const bancoPositivo = porColabBanco.filter(l => l.resumo.saldoMinutos > 0).sort((a, b) => b.resumo.saldoMinutos - a.resumo.saldoMinutos).slice(0, 10);
  const bancoNegativo = porColabBanco.filter(l => l.resumo.saldoMinutos < 0).sort((a, b) => a.resumo.saldoMinutos - b.resumo.saldoMinutos).slice(0, 10);

  return (
    <>
      <div className="panel">
        <h3>Painel do gestor — {empresaAtual?.nome}</h3>
        <div className="form-grid">
          <div><label>Mês de referência (atrasos e faltas)</label><input type="month" value={mes} onChange={e => setMes(e.target.value)} /></div>
        </div>
      </div>

      <div className="kpi-grid">
        <div className={`kpi ${topAtrasos.length ? 'warn' : ''}`}><div className="label">Colaboradores com atraso no mês</div><div className={`value ${topAtrasos.length ? 'warn' : ''}`}>{topAtrasos.length}</div></div>
        <div className={`kpi ${topFaltas.length ? 'warn' : ''}`}><div className="label">Colaboradores com falta no mês</div><div className={`value ${topFaltas.length ? 'warn' : ''}`}>{topFaltas.length}</div></div>
        <div className="kpi"><div className="label">Colaboradores com banco de horas</div><div className="value">{porColabBanco.length}</div></div>
      </div>

      <div className="grid2">
        <div className="panel">
          <h3>Mais atrasos no mês</h3>
          <table>
            <thead><tr><th>Colaborador</th><th>Atraso total</th></tr></thead>
            <tbody>
              {topAtrasos.length ? topAtrasos.map(l => (
                <tr key={l.colaborador.id}><td>{l.colaborador.nome}</td><td className="num">{fmtMinutos(l.resumo.atrasoMinutos)}h</td></tr>
              )) : <tr className="empty-row"><td colSpan={2}>Ninguém com atraso neste mês.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <h3>Mais faltas no mês</h3>
          <table>
            <thead><tr><th>Colaborador</th><th>Dias de falta</th></tr></thead>
            <tbody>
              {topFaltas.length ? topFaltas.map(l => (
                <tr key={l.colaborador.id}><td>{l.colaborador.nome}</td><td className="num">{l.resumo.diasFalta}</td></tr>
              )) : <tr className="empty-row"><td colSpan={2}>Ninguém com falta neste mês.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid2">
        <div className="panel">
          <h3>Banco de horas — maior saldo positivo</h3>
          <table>
            <thead><tr><th>Colaborador</th><th>Saldo acumulado</th></tr></thead>
            <tbody>
              {bancoPositivo.length ? bancoPositivo.map(l => (
                <tr key={l.colaborador.id}><td>{l.colaborador.nome}</td><td className="num">{fmtMinutos(l.resumo.saldoMinutos)}h</td></tr>
              )) : <tr className="empty-row"><td colSpan={2}>Sem saldo positivo acumulado.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <h3>Banco de horas — maior déficit</h3>
          <table>
            <thead><tr><th>Colaborador</th><th>Saldo acumulado</th></tr></thead>
            <tbody>
              {bancoNegativo.length ? bancoNegativo.map(l => (
                <tr key={l.colaborador.id}><td>{l.colaborador.nome}</td>
                  <td className="num" style={{ color: 'var(--danger)' }}>{fmtMinutos(l.resumo.saldoMinutos)}h</td></tr>
              )) : <tr className="empty-row"><td colSpan={2}>Sem déficit acumulado.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 11.5 }}>
        Banco de horas considera só colaboradores com o campo "Banco de horas" marcado no cadastro,
        acumulado desde o início do vínculo mais antigo até hoje.
      </p>
    </>
  );
}
