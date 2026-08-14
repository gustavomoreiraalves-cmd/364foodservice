'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { CONSERVACOES, condicaoValidade, conservacaoLabel, fmtDateTime } from '../../../lib/producao';
import AppShell from '../../../components/AppShell';
import ProducaoTabs from '../../../components/ProducaoTabs';
import { useEmpresaAtual } from '../../../lib/empresa';

export default function ValidadesPage() {
  return (
    <AppShell modulo="producoes" titulo="Validades" desc="Acompanhamento de validade das produções internas">
      <ProducaoTabs />
      <Conteudo />
    </AppShell>
  );
}

const ATALHOS = [
  { id: 'vencidos', label: 'Vencidos' },
  { id: 'vence_hoje', label: 'Vencem hoje' },
  { id: 'proximos3', label: 'Próximos 3 dias' },
  { id: 'ativos', label: 'Todos ativos' },
];

const FILTRO_VAZIO = { unidade_id: '', produto_id: '', conservacao: '', condicao: '', producao_de: '', producao_ate: '', validade_de: '', validade_ate: '' };

function Conteudo() {
  const { empresaAtual } = useEmpresaAtual();
  const [lista, setLista] = useState([]);
  const [unidades, setUnidades] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [atalho, setAtalho] = useState('ativos');
  const [filtro, setFiltro] = useState(FILTRO_VAZIO);

  useEffect(() => {
    let ativo = true;
    async function carregar() {
      if (!empresaAtual) return;
      setCarregando(true);
      const eid = empresaAtual.id;
      const [r1, r2] = await Promise.all([
        // só produções internas finalizadas (não descartadas/canceladas) são operacionalmente relevantes
        supabase.from('producoes_internas')
          .select('*, produtos(nome, codigo), unidades(nome), funcionarios:responsavel_funcionario_id(nome)')
          .eq('empresa_id', eid).eq('status', 'finalizada').order('validade', { ascending: true }),
        supabase.from('unidades').select('id, nome').eq('empresa_id', eid).order('nome'),
      ]);
      if (!ativo) return;
      setLista(r1.data || []);
      setUnidades(r2.data || []);
      setCarregando(false);
    }
    carregar();
    return () => { ativo = false; };
  }, [empresaAtual?.id]);

  const produtosUsados = useMemo(() => {
    const map = new Map();
    lista.forEach(p => { if (p.produtos) map.set(p.produto_id, p.produtos.nome); });
    return [...map.entries()];
  }, [lista]);

  const responsaveis = useMemo(() => {
    const set = new Set(lista.map(p => p.funcionarios?.nome).filter(Boolean));
    return [...set];
  }, [lista]);
  const [respFiltro, setRespFiltro] = useState('');

  const agora = new Date();
  const filtradas = lista.filter(p => {
    const cond = condicaoValidade(p.validade, agora);
    if (atalho === 'vencidos' && cond.id !== 'vencido') return false;
    if (atalho === 'vence_hoje' && cond.id !== 'vence_hoje') return false;
    if (atalho === 'proximos3') {
      if (cond.id === 'vencido') return false;
      if (!p.validade || new Date(p.validade) - agora > 3 * 86400000) return false;
    }
    if (filtro.unidade_id && p.unidade_id !== filtro.unidade_id) return false;
    if (filtro.produto_id && p.produto_id !== filtro.produto_id) return false;
    if (filtro.conservacao && p.conservacao !== filtro.conservacao) return false;
    if (filtro.condicao && cond.id !== filtro.condicao) return false;
    if (respFiltro && p.funcionarios?.nome !== respFiltro) return false;
    if (filtro.producao_de && new Date(p.produzido_em) < new Date(filtro.producao_de + 'T00:00:00')) return false;
    if (filtro.producao_ate && new Date(p.produzido_em) > new Date(filtro.producao_ate + 'T23:59:59')) return false;
    if (filtro.validade_de && p.validade && new Date(p.validade) < new Date(filtro.validade_de + 'T00:00:00')) return false;
    if (filtro.validade_ate && p.validade && new Date(p.validade) > new Date(filtro.validade_ate + 'T23:59:59')) return false;
    return true;
  });

  if (carregando) return <p className="muted">Carregando…</p>;

  return (
    <div className="panel">
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {ATALHOS.map(a => (
          <button key={a.id} className={'btn small' + (atalho === a.id ? '' : ' secondary')} onClick={() => setAtalho(a.id)}>{a.label}</button>
        ))}
      </div>

      <div className="form-grid" style={{ marginTop: 12 }}>
        <div><label>Unidade</label>
          <select value={filtro.unidade_id} onChange={e => setFiltro({ ...filtro, unidade_id: e.target.value })}>
            <option value="">Todas</option>
            {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
        </div>
        <div><label>Produto</label>
          <select value={filtro.produto_id} onChange={e => setFiltro({ ...filtro, produto_id: e.target.value })}>
            <option value="">Todos</option>
            {produtosUsados.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
          </select>
        </div>
        <div><label>Conservação</label>
          <select value={filtro.conservacao} onChange={e => setFiltro({ ...filtro, conservacao: e.target.value })}>
            <option value="">Todas</option>
            {CONSERVACOES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
        <div><label>Responsável</label>
          <select value={respFiltro} onChange={e => setRespFiltro(e.target.value)}>
            <option value="">Todos</option>
            {responsaveis.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div><label>Condição</label>
          <select value={filtro.condicao} onChange={e => setFiltro({ ...filtro, condicao: e.target.value })}>
            <option value="">Todas</option>
            <option value="valido">Válido</option>
            <option value="vence_em_breve">Vence em breve</option>
            <option value="vence_hoje">Vence hoje</option>
            <option value="vencido">Vencido</option>
          </select>
        </div>
        <div><label>Produção de</label><input type="date" value={filtro.producao_de} onChange={e => setFiltro({ ...filtro, producao_de: e.target.value })} /></div>
        <div><label>Produção até</label><input type="date" value={filtro.producao_ate} onChange={e => setFiltro({ ...filtro, producao_ate: e.target.value })} /></div>
        <div><label>Validade de</label><input type="date" value={filtro.validade_de} onChange={e => setFiltro({ ...filtro, validade_de: e.target.value })} /></div>
        <div><label>Validade até</label><input type="date" value={filtro.validade_ate} onChange={e => setFiltro({ ...filtro, validade_ate: e.target.value })} /></div>
        <div><button className="btn secondary" onClick={() => { setFiltro(FILTRO_VAZIO); setRespFiltro(''); setAtalho('ativos'); }}>Limpar filtros</button></div>
      </div>

      <div className="table-wrap" style={{ marginTop: 14 }}>
        <table>
          <thead>
            <tr><th>Condição</th><th>Produto</th><th>Unidade</th><th>Produção</th><th>Validade</th><th>Conservação</th><th>Qtd</th><th>Responsável</th><th>Identificação</th></tr>
          </thead>
          <tbody>
            {filtradas.length ? filtradas.map(p => {
              const cond = condicaoValidade(p.validade, agora);
              return (
                <tr key={p.id}>
                  <td><span style={{ color: cond.cor, fontWeight: 600, fontSize: 11.5 }}>{cond.label}</span></td>
                  <td>{p.produtos?.nome || '—'}</td>
                  <td className="muted">{p.unidades?.nome || '—'}</td>
                  <td>{fmtDateTime(p.produzido_em)}</td>
                  <td>{fmtDateTime(p.validade)}</td>
                  <td>{conservacaoLabel(p.conservacao)}</td>
                  <td className="num">{p.quantidade != null ? `${Number(p.quantidade)} ${p.unidade_medida || ''}` : '—'}</td>
                  <td className="muted">{p.funcionarios?.nome || '—'}</td>
                  <td className="muted">{p.codigo}</td>
                </tr>
              );
            }) : <tr className="empty-row"><td colSpan={9}>Nenhuma produção interna nesta condição.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
