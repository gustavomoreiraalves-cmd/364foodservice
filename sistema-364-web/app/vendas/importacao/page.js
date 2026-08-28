'use client';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { fmtMoney } from '../../../lib/format';
import AppShell from '../../../components/AppShell';
import { useEmpresaAtual } from '../../../lib/empresa';
import BarraParticipacao from '../../../components/charts/BarraParticipacao';
import SerieDiariaPdv from '../../../components/charts/SerieDiariaPdv';
import {
  periodoPadrao, periodoAnterior, kpis, variacao, porDia, porOrigem, porForma,
  itensPeriodo, statusImportacao,
} from '../../../lib/pdvVendas';

export default function VendasPdvPage() {
  return (
    <AppShell modulo="pedidos" titulo="Vendas PDV" desc="364 Steakhouse e 364 Foodtruck/Afya — importado do Consumer Connect">
      <Conteudo />
    </AppShell>
  );
}

function Delta({ pct }) {
  if (pct === null || !isFinite(pct)) return <span className="muted" style={{ fontSize: 11 }}>—</span>;
  const subiu = pct >= 0;
  return <span style={{ fontSize: 11, color: subiu ? 'var(--amber-bright)' : 'var(--danger)' }}>{subiu ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}% vs período anterior</span>;
}

function Kpi({ label, valor, delta }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value">{valor}</div>
      {delta !== undefined && <Delta pct={delta} />}
    </div>
  );
}

const fmtDia = d => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

const fmtDataHora = s => {
  if (!s) return '—';
  const d = new Date(new Date(s).getTime() - 4 * 36e5);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
};

function Conteudo() {
  const { empresaAtual } = useEmpresaAtual();
  const [periodo, setPeriodo] = useState(periodoPadrao());
  const [temLoja, setTemLoja] = useState(null);
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [caixaAberto, setCaixaAberto] = useState(null);
  const [movimentos, setMovimentos] = useState([]);
  const [filtroCategoria, setFiltroCategoria] = useState('');
  const [busca, setBusca] = useState('');
  const [solicitacaoPendente, setSolicitacaoPendente] = useState(false);
  const [enviandoPedido, setEnviandoPedido] = useState(false);

  useEffect(() => {
    if (!empresaAtual) return;
    let ativo = true;
    (async () => {
      setErro(null); setDados(null);
      const { data: lojas } = await supabase.from('pdv_lojas').select('id_connect').eq('empresa_id', empresaAtual.id);
      if (!ativo) return;
      if (!lojas?.length) { setTemLoja(false); return; }
      setTemLoja(true);
      const ant = periodoAnterior(periodo);
      const e = empresaAtual.id;
      const [vendas, vendasAnt, formas, itens, caixas, importacao, pendente] = await Promise.all([
        supabase.from('vw_pdv_vendas_dia').select('*').eq('empresa_id', e).gte('dia', periodo.de).lte('dia', periodo.ate),
        supabase.from('vw_pdv_vendas_dia').select('*').eq('empresa_id', e).gte('dia', ant.de).lte('dia', ant.ate),
        supabase.from('vw_pdv_caixa_formas_dia').select('*').eq('empresa_id', e).gte('dia', periodo.de).lte('dia', periodo.ate),
        supabase.from('pdv_vendas_itens_dia').select('dia, codigo_detalhe, nome, categoria, quantidade, valor_vendido, lucro').eq('empresa_id', e).gte('dia', periodo.de).lte('dia', periodo.ate),
        supabase.from('pdv_caixas').select('id, codigo, aberto_em, fechado_em, saldo_inicial, saldo_final, status, dia_caixa').eq('empresa_id', e).gte('dia_caixa', periodo.de).lte('dia_caixa', periodo.ate).order('aberto_em', { ascending: false }),
        supabase.from('pdv_importacoes').select('iniciado_em, status, erro').eq('empresa_id', e).order('iniciado_em', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('pdv_importacao_solicitacoes').select('id').is('atendido_em', null).limit(1).maybeSingle(),
      ]);
      if (!ativo) return;
      const falha = [vendas, vendasAnt, formas, itens, caixas, importacao].find(r => r.error);
      if (falha) { setErro(falha.error.message); return; }
      setDados({ vendas: vendas.data, vendasAnt: vendasAnt.data, formas: formas.data, itens: itens.data, caixas: caixas.data, importacao: importacao.data });
      setSolicitacaoPendente(!!pendente.data);
    })();
    return () => { ativo = false; };
  }, [empresaAtual, periodo]);

  // Enquanto o pedido não foi atendido, confere de tempos em tempos se o
  // checador local (cron a cada 15 min) já pegou — quando ele atende, o
  // status da última importação é atualizado pra refletir o resultado.
  useEffect(() => {
    if (!solicitacaoPendente || !empresaAtual) return;
    let ativo = true;
    const intervalo = setInterval(async () => {
      const { data: pendente } = await supabase.from('pdv_importacao_solicitacoes').select('id').is('atendido_em', null).limit(1).maybeSingle();
      if (!ativo || pendente) return;
      setSolicitacaoPendente(false);
      const { data: importacao } = await supabase.from('pdv_importacoes')
        .select('iniciado_em, status, erro').eq('empresa_id', empresaAtual.id).order('iniciado_em', { ascending: false }).limit(1).maybeSingle();
      if (ativo) setDados(d => (d ? { ...d, importacao } : d));
    }, 20000);
    return () => { ativo = false; clearInterval(intervalo); };
  }, [solicitacaoPendente, empresaAtual]);

  async function atualizarAgora() {
    setEnviandoPedido(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resposta = await fetch('/api/pdv/solicitar-importacao', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token || ''}` },
      });
      if (resposta.ok) setSolicitacaoPendente(true);
    } finally {
      setEnviandoPedido(false);
    }
  }

  async function abrirCaixa(caixa) {
    if (caixaAberto === caixa.id) { setCaixaAberto(null); return; }
    const { data } = await supabase.from('pdv_caixa_movimentos').select('*').eq('caixa_id', caixa.id).order('posicao');
    setMovimentos(data || []);
    setCaixaAberto(caixa.id);
  }

  const calc = useMemo(() => {
    if (!dados) return null;
    const k = kpis(dados.vendas), ka = kpis(dados.vendasAnt);
    return {
      k, ka,
      dias: porDia(dados.vendas),
      origens: porOrigem(dados.vendas),
      formas: porForma(dados.formas),
      itens: itensPeriodo(dados.itens),
      status: statusImportacao(dados.importacao),
    };
  }, [dados]);

  if (temLoja === false) {
    return <div className="panel"><h3>Sem PDV Consumer</h3><p className="muted">A empresa selecionada não tem loja no Consumer Connect. Esta tela cobre a 364 Steakhouse e a 364 Foodtruck/Afya.</p></div>;
  }
  if (erro) return <div className="panel"><p style={{ color: 'var(--danger)' }}>Erro ao carregar: {erro}</p></div>;
  if (!calc) return <div className="panel"><p className="muted">Carregando…</p></div>;

  const categorias = [...new Set(calc.itens.map(i => i.categoria).filter(Boolean))].sort();
  const itensFiltrados = calc.itens.filter(i => (!filtroCategoria || i.categoria === filtroCategoria) && (!busca || i.nome.toLowerCase().includes(busca.toLowerCase())));

  return (
    <>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
        <label style={{ fontSize: 12 }}>De <input type="date" value={periodo.de} onChange={e => setPeriodo(p => ({ ...p, de: e.target.value }))} /></label>
        <label style={{ fontSize: 12 }}>Até <input type="date" value={periodo.ate} onChange={e => setPeriodo(p => ({ ...p, ate: e.target.value }))} /></label>
        <button className="btn small secondary" onClick={atualizarAgora} disabled={enviandoPedido || solicitacaoPendente}>
          {solicitacaoPendente ? 'Atualização pedida…' : 'Atualizar agora'}
        </button>
        <span className={`tag ${calc.status.alerta ? 'bad' : 'ok'}`}>{calc.status.texto}</span>
        {dados.importacao?.erro && <span className="muted" style={{ fontSize: 11 }}>{dados.importacao.erro}</span>}
      </div>

      <div className="kpi-grid">
        <Kpi label="Faturamento" valor={fmtMoney(calc.k.faturamento)} delta={variacao(calc.k.faturamento, calc.ka.faturamento)} />
        <Kpi label="Pedidos" valor={calc.k.pedidos} delta={variacao(calc.k.pedidos, calc.ka.pedidos)} />
        <Kpi label="Ticket médio" valor={fmtMoney(calc.k.ticketMedio)} delta={variacao(calc.k.ticketMedio, calc.ka.ticketMedio)} />
        <Kpi label="Itens por pedido" valor={calc.k.itensPorPedido.toFixed(2)} />
        <Kpi label="% delivery" valor={`${calc.k.pctDelivery.toFixed(1)}%`} />
      </div>

      <div className="panel">
        <h3>Venda por dia</h3>
        <SerieDiariaPdv dados={calc.dias} />
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table>
            <thead><tr><th>Dia</th><th className="num">Mesa</th><th className="num">Delivery</th><th className="num">Outro</th><th className="num">Total</th><th className="num">Pedidos</th><th className="num">Ticket</th></tr></thead>
            <tbody>
              {calc.dias.map(d => (
                <tr key={d.dia}><td>{fmtDia(d.dia)}</td><td className="num">{fmtMoney(d.mesa)}</td><td className="num">{fmtMoney(d.delivery)}</td><td className="num">{fmtMoney(d.outro)}</td><td className="num">{fmtMoney(d.total)}</td><td className="num">{d.pedidos}</td><td className="num">{fmtMoney(d.ticket)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h3>Por origem</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Origem</th><th className="num">Pedidos</th><th className="num">Valor</th><th>Participação</th></tr></thead>
            <tbody>
              {calc.origens.map(o => (
                <tr key={o.origem}><td>{o.origem}</td><td className="num">{o.pedidos}</td><td className="num">{fmtMoney(o.valor)}</td><td><BarraParticipacao pct={o.pct} /></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h3>Caixa por forma de pagamento</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Forma</th><th className="num">Qtd</th><th className="num">Bruto</th><th className="num">Taxa</th><th className="num">Líquido</th></tr></thead>
            <tbody>
              {calc.formas.linhas.map(f => (
                <tr key={f.formaGrupo}><td>{f.rotulo}</td><td className="num">{f.qtd}</td><td className="num">{fmtMoney(f.bruto)}</td><td className="num">{fmtMoney(f.taxa)}</td><td className="num">{fmtMoney(f.liquido)}</td></tr>
              ))}
              <tr style={{ fontWeight: 600 }}><td>Total</td><td className="num">{calc.formas.total.qtd}</td><td className="num">{fmtMoney(calc.formas.total.bruto)}</td><td className="num">{fmtMoney(calc.formas.total.taxa)}</td><td className="num">{fmtMoney(calc.formas.total.liquido)}</td></tr>
            </tbody>
          </table>
        </div>
        <h4 style={{ marginTop: 18, fontSize: 12.5, color: 'var(--paper-dim)' }}>Caixas do período</h4>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Caixa</th><th>Abertura</th><th>Fechamento</th><th className="num">Saldo inicial</th><th className="num">Saldo final</th><th>Status</th></tr></thead>
            <tbody>
              {(dados.caixas || []).map(c => (
                <Fragment key={c.id}>
                  <tr onClick={() => abrirCaixa(c)} style={{ cursor: 'pointer' }}>
                    <td>{c.codigo}</td><td>{fmtDataHora(c.aberto_em)}</td><td>{fmtDataHora(c.fechado_em)}</td>
                    <td className="num">{fmtMoney(c.saldo_inicial)}</td><td className="num">{c.saldo_final === null ? '—' : fmtMoney(c.saldo_final)}</td>
                    <td><span className={`tag ${c.status === 'Fechado' ? 'ok' : 'warn'}`}>{c.status}</span></td>
                  </tr>
                  {caixaAberto === c.id && (
                    <tr><td colSpan={6} style={{ padding: 0 }}>
                      <table style={{ fontSize: 11.5 }}>
                        <thead><tr><th>Operação</th><th>Origem</th><th>Hora</th><th className="num">Entrada</th><th className="num">Saída</th><th>Forma</th><th>Obs.</th></tr></thead>
                        <tbody>{movimentos.map(m => (
                          <tr key={m.id}><td>{m.operacao}</td><td>{m.origem}</td><td>{fmtDataHora(m.momento)}</td><td className="num">{m.entrada === null ? '' : fmtMoney(m.entrada)}</td><td className="num">{m.saida === null ? '' : fmtMoney(m.saida)}</td><td>{[m.forma, m.operadora].filter(Boolean).join(' ')}</td><td className="muted">{m.observacao}</td></tr>
                        ))}</tbody>
                      </table>
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h3>Itens vendidos</h3>
        <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
          <input placeholder="Buscar item" value={busca} onChange={e => setBusca(e.target.value)} />
          <select value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value)}>
            <option value="">Todas as categorias</option>
            {categorias.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Item</th><th>Categoria</th><th className="num">Qtd</th><th className="num">Valor</th><th className="num">Lucro</th><th className="num">Margem</th><th>ABC</th><th>Participação</th></tr></thead>
            <tbody>
              {itensFiltrados.map(i => (
                <tr key={i.codigoDetalhe}><td>{i.nome}</td><td className="muted">{i.categoria}</td><td className="num">{i.quantidade}</td><td className="num">{fmtMoney(i.valor)}</td><td className="num">{fmtMoney(i.lucro)}</td><td className="num">{i.margem.toFixed(1)}%</td><td><span className={i.abc === 'A' ? 'tag ok' : i.abc === 'B' ? 'tag warn' : 'tag'}>{i.abc}</span></td><td><BarraParticipacao pct={i.pct} /></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
