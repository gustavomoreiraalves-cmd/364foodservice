'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabase';
import { hoje, fmtDate } from '../../lib/format';
import { fmtDateTime, condicaoValidade, conservacaoLabel, STATUS_LABELS } from '../../lib/producao';
import AppShell from '../../components/AppShell';
import ProducaoTabs from '../../components/ProducaoTabs';
import { useEmpresaAtual } from '../../lib/empresa';

export default function ProducoesVisaoGeralPage() {
  return (
    <AppShell modulo="producoes" titulo="Produção" desc="Visão geral das produções completas e internas">
      <ProducaoTabs />
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const { empresaAtual } = useEmpresaAtual();
  const [dados, setDados] = useState(null);

  useEffect(() => {
    let ativo = true;
    async function carregar() {
      if (!empresaAtual) return;
      const eid = empresaAtual.id;
      const hojeStr = hoje();
      const inicioHoje = new Date(hojeStr + 'T00:00:00').toISOString();
      const fimHoje = new Date(hojeStr + 'T23:59:59.999').toISOString();
      const agora = new Date().toISOString();

      const [completasHoje, internasHoje, vencemHoje, vencidos, etiquetasHoje, recentesInternas, recentesCompletas] = await Promise.all([
        supabase.from('producoes').select('id', { count: 'exact', head: true }).eq('empresa_id', eid).eq('data', hojeStr),
        supabase.from('producoes_internas').select('id', { count: 'exact', head: true }).eq('empresa_id', eid).gte('produzido_em', inicioHoje).lte('produzido_em', fimHoje).neq('status', 'cancelada'),
        supabase.from('producoes_internas').select('id', { count: 'exact', head: true }).eq('empresa_id', eid).eq('status', 'finalizada').gte('validade', agora).lte('validade', fimHoje),
        supabase.from('producoes_internas').select('id', { count: 'exact', head: true }).eq('empresa_id', eid).eq('status', 'finalizada').lt('validade', agora),
        supabase.from('etiqueta_impressoes').select('quantidade').eq('empresa_id', eid).gte('created_at', inicioHoje),
        supabase.from('producoes_internas').select('id, codigo, produzido_em, validade, conservacao, quantidade, unidade_medida, status, produtos(nome), unidades(nome)').eq('empresa_id', eid).order('created_at', { ascending: false }).limit(8),
        supabase.from('producoes').select('id, lote, data, quantidade, produtos(nome, unidade)').eq('empresa_id', eid).order('created_at', { ascending: false }).limit(5),
      ]);

      if (!ativo) return;
      setDados({
        completasHoje: completasHoje.count || 0,
        internasHoje: internasHoje.count || 0,
        vencemHoje: vencemHoje.count || 0,
        vencidos: vencidos.count || 0,
        etiquetasHoje: (etiquetasHoje.data || []).reduce((s, e) => s + Number(e.quantidade), 0),
        recentesInternas: recentesInternas.data || [],
        recentesCompletas: recentesCompletas.data || [],
      });
    }
    carregar();
    return () => { ativo = false; };
  }, [empresaAtual?.id]);

  if (!dados) return <p className="muted">Carregando…</p>;

  return (
    <>
      <div className="kpi-grid">
        <div className="kpi"><div className="label">Produções hoje</div><div className="value">{dados.completasHoje + dados.internasHoje}</div></div>
        <div className="kpi"><div className="label">Produções internas hoje</div><div className="value">{dados.internasHoje}</div></div>
        <div className={'kpi' + (dados.vencemHoje ? ' warn' : '')}><div className="label">Vencem hoje</div><div className={'value' + (dados.vencemHoje ? ' warn' : '')}>{dados.vencemHoje}</div></div>
        <div className={'kpi' + (dados.vencidos ? ' warn' : '')}><div className="label">Vencidos</div><div className={'value' + (dados.vencidos ? ' warn' : '')}>{dados.vencidos}</div></div>
        <div className="kpi"><div className="label">Etiquetas impressas hoje</div><div className="value">{dados.etiquetasHoje}</div></div>
      </div>

      <div className="panel">
        <h3>Produções internas recentes</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Código</th><th>Produto</th><th>Unidade</th><th>Produção</th><th>Validade</th><th>Condição</th><th>Conservação</th><th>Qtd</th><th>Status</th></tr></thead>
            <tbody>
              {dados.recentesInternas.length ? dados.recentesInternas.map(p => {
                const cond = p.status === 'finalizada' ? condicaoValidade(p.validade) : null;
                return (
                  <tr key={p.id}>
                    <td className="muted">{p.codigo}</td>
                    <td>{p.produtos?.nome || '—'}</td>
                    <td className="muted">{p.unidades?.nome || '—'}</td>
                    <td>{fmtDateTime(p.produzido_em)}</td>
                    <td>{fmtDateTime(p.validade)}</td>
                    <td>{cond ? <span style={{ color: cond.cor, fontWeight: 600, fontSize: 11.5 }}>{cond.label}</span> : '—'}</td>
                    <td>{conservacaoLabel(p.conservacao)}</td>
                    <td className="num">{p.quantidade != null ? `${Number(p.quantidade)} ${p.unidade_medida || ''}` : '—'}</td>
                    <td className="muted">{STATUS_LABELS[p.status] || p.status}</td>
                  </tr>
                );
              }) : <tr className="empty-row"><td colSpan={9}>Nenhuma produção interna ainda. <Link href="/producoes/nova">Criar a primeira</Link>.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h3>Produções completas recentes</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Lote</th><th>Data</th><th>Produto</th><th>Qtd</th></tr></thead>
            <tbody>
              {dados.recentesCompletas.length ? dados.recentesCompletas.map(p => (
                <tr key={p.id}>
                  <td className="muted">{p.lote}</td>
                  <td>{fmtDate(p.data)}</td>
                  <td>{p.produtos?.nome || '—'}</td>
                  <td className="num">{Number(p.quantidade)} {p.produtos?.unidade || ''}</td>
                </tr>
              )) : <tr className="empty-row"><td colSpan={4}>Nenhuma produção completa lançada. <Link href="/producoes/completa">Ir para Produção Completa</Link>.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
