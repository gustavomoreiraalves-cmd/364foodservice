'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { hoje, fmtDate } from '../../../lib/format';
import { STATUS_LABELS, conservacaoLabel, fmtDateTime } from '../../../lib/producao';
import AppShell from '../../../components/AppShell';
import ProducaoTabs from '../../../components/ProducaoTabs';
import { useEmpresaAtual } from '../../../lib/empresa';

export default function HistoricoProducaoPage() {
  return (
    <AppShell modulo="producoes" titulo="Histórico de Produção" desc="Produções, cancelamentos, descartes e impressões">
      <ProducaoTabs />
      <Conteudo />
    </AppShell>
  );
}

function inicioMes() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function Conteudo() {
  const { empresaAtual } = useEmpresaAtual();
  const [periodo, setPeriodo] = useState({ de: inicioMes(), ate: hoje() });
  const [eventos, setEventos] = useState(null);

  useEffect(() => {
    let ativo = true;
    async function carregar() {
      if (!empresaAtual) return;
      const eid = empresaAtual.id;
      const deIso = new Date(periodo.de + 'T00:00:00').toISOString();
      const ateIso = new Date(periodo.ate + 'T23:59:59.999').toISOString();

      const [completas, internas, impressoes, descartes] = await Promise.all([
        supabase.from('producoes').select('id, lote, data, quantidade, created_at, produtos(nome, unidade), funcionarios(nome)')
          .eq('empresa_id', eid).gte('data', periodo.de).lte('data', periodo.ate).order('created_at', { ascending: false }),
        supabase.from('producoes_internas').select('*, produtos(nome), unidades(nome), funcionarios:responsavel_funcionario_id(nome)')
          .eq('empresa_id', eid).gte('created_at', deIso).lte('created_at', ateIso).order('created_at', { ascending: false }),
        supabase.from('etiqueta_impressoes').select('*')
          .eq('empresa_id', eid).gte('created_at', deIso).lte('created_at', ateIso).order('created_at', { ascending: false }),
        supabase.from('producao_descartes').select('*, producoes_internas(codigo, produtos(nome))')
          .eq('empresa_id', eid).gte('created_at', deIso).lte('created_at', ateIso).order('created_at', { ascending: false }),
      ]);
      if (!ativo) return;

      const evs = [];
      (completas.data || []).forEach(p => evs.push({
        quando: p.created_at, tipo: 'Produção completa',
        descricao: `Lote ${p.lote} · ${p.produtos?.nome || '—'} · ${Number(p.quantidade)} ${p.produtos?.unidade || ''} · ${fmtDate(p.data)}`,
        quem: p.funcionarios?.nome || '—',
      }));
      (internas.data || []).forEach(p => {
        evs.push({
          quando: p.created_at, tipo: 'Produção interna',
          descricao: `${p.codigo} · ${p.produtos?.nome || '—'} · ${conservacaoLabel(p.conservacao)} · status: ${STATUS_LABELS[p.status] || p.status}${p.validade_manual ? ' · validade alterada manualmente' : ''}`,
          quem: p.funcionarios?.nome || '—',
        });
        if (p.cancelada_em) evs.push({ quando: p.cancelada_em, tipo: 'Cancelamento', descricao: `${p.codigo} · ${p.produtos?.nome || '—'}`, quem: '—' });
      });
      (impressoes.data || []).forEach(i => evs.push({
        quando: i.created_at, tipo: i.tipo === 'reimpressao' ? 'Reimpressão' : 'Impressão',
        descricao: `${i.quantidade} etiqueta(s) · modelo ${i.modelo}${i.impressora ? ` · impressora ${i.impressora}` : ''}${i.motivo ? ` · motivo: ${i.motivo}` : ''}`,
        quem: i.usuario_nome || '—',
      }));
      (descartes.data || []).forEach(d => evs.push({
        quando: d.created_at, tipo: 'Descarte',
        descricao: `${d.producoes_internas?.codigo || ''} · ${d.producoes_internas?.produtos?.nome || '—'}${d.quantidade != null ? ` · ${Number(d.quantidade)} ${d.unidade_medida || ''}` : ''} · motivo: ${d.motivo}`,
        quem: d.usuario_nome || '—',
      }));
      evs.sort((a, b) => new Date(b.quando) - new Date(a.quando));
      setEventos(evs);
    }
    carregar();
    return () => { ativo = false; };
  }, [empresaAtual?.id, periodo.de, periodo.ate]);

  return (
    <div className="panel">
      <div className="form-grid">
        <div><label>De</label><input type="date" value={periodo.de} onChange={e => setPeriodo({ ...periodo, de: e.target.value })} /></div>
        <div><label>Até</label><input type="date" value={periodo.ate} onChange={e => setPeriodo({ ...periodo, ate: e.target.value })} /></div>
      </div>
      {!eventos ? <p className="muted" style={{ marginTop: 12 }}>Carregando…</p> : (
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table>
            <thead><tr><th>Data/hora</th><th>Evento</th><th>Descrição</th><th>Responsável/Usuário</th></tr></thead>
            <tbody>
              {eventos.length ? eventos.map((e, i) => (
                <tr key={i}>
                  <td>{fmtDateTime(e.quando)}</td>
                  <td>{e.tipo}</td>
                  <td>{e.descricao}</td>
                  <td className="muted">{e.quem}</td>
                </tr>
              )) : <tr className="empty-row"><td colSpan={4}>Nenhum evento no período.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
