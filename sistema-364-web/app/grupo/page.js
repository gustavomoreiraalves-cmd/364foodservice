'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { fmtMoney } from '../../lib/format';
import AppShell from '../../components/AppShell';
import { useEmpresaAtual } from '../../lib/empresa';
import {
  consolidar, porEmpresa, variacao, serie12,
  mesesAte, mesAnterior, mesCorrente,
} from '../../lib/consolidado';
import SerieMensal from '../../components/charts/SerieMensal';
import BarraParticipacao from '../../components/charts/BarraParticipacao';

export default function GrupoPage() {
  return (
    <AppShell modulo="grupo" titulo="Grupo 364" desc="Consolidado de todas as empresas">
      <Conteudo />
    </AppShell>
  );
}

// Variação contra o mês anterior. Base zero vira "—": afirmar crescimento
// percentual sobre nada seria inventar número.
function Delta({ pct }) {
  if (pct === null || !isFinite(pct)) return <span className="muted" style={{ fontSize: 11 }}>—</span>;
  const cor = pct >= 0 ? 'var(--amber-bright)' : '#e5806c';
  return (
    <span style={{ fontSize: 11, color: cor }}>
      {pct >= 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}% vs mês anterior
    </span>
  );
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

// Tag de confiança do CMV daquela empresa no mês.
function TagCusto({ semCusto, porFicha }) {
  if (semCusto > 0) return <span className="tag bad">{semCusto} sem custo</span>;
  if (porFicha > 0) return <span className="tag warn">{porFicha} pela ficha</span>;
  return <span className="tag ok">custo cadastrado</span>;
}

function Conteudo() {
  const { empresas } = useEmpresaAtual();
  const [mes, setMes] = useState(mesCorrente());
  const [linhas, setLinhas] = useState(null);
  const [erro, setErro] = useState(null);

  // Chave estável: `empresas` é um array novo a cada render do AppShell, e usá-lo
  // direto como dependência refaria a consulta em laço.
  const idsEmpresas = (empresas || []).map(e => e.id).join(',');

  useEffect(() => {
    if (!idsEmpresas) return;
    let cancelado = false;
    async function carregar() {
      setLinhas(null);
      setErro(null);
      const janela = mesesAte(mes, 12);
      const { data, error } = await supabase
        .from('vw_consolidado_mensal')
        .select('*')
        .in('empresa_id', idsEmpresas.split(','))
        .gte('mes', janela[0])
        .lte('mes', mes);
      if (cancelado) return;
      if (error) {
        setErro(/vw_consolidado_mensal/.test(error.message)
          ? 'A view do consolidado não existe neste banco. Rode supabase/atualizacao_21_dashboard_grupo.sql no SQL Editor do Supabase.'
          : error.message);
        return;
      }
      setLinhas(data || []);
    }
    carregar();
    return () => { cancelado = true; };
  }, [idsEmpresas, mes]);

  if (erro) return <p className="erro">{erro}</p>;
  if (!linhas) return <p className="muted">Carregando…</p>;

  const anterior = mesAnterior(mes);
  const doMes = linhas.filter(l => l.mes === mes);
  const doAnterior = linhas.filter(l => l.mes === anterior);
  const t = consolidar(doMes);
  const ta = consolidar(doAnterior);
  const ranking = porEmpresa(doMes, empresas);
  const serie = serie12(linhas, mes);
  const rotulo = new Date(`${mes}-02T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const semMovimento = t.receitaCompetencia === 0 && t.despesaCompetencia === 0 && t.compras === 0;

  return (
    <>
      <div className="panel">
        <h3>Período</h3>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div><label>Mês</label><input type="month" value={mes} onChange={e => setMes(e.target.value || mesCorrente())} /></div>
          <p className="muted" style={{ fontSize: 11.5, margin: 0 }}>
            Somando {empresas.length} empresa(s). O seletor de empresa da barra lateral não afeta esta tela.
          </p>
        </div>
      </div>

      {semMovimento ? (
        <div className="panel"><p className="muted">Sem movimento em {rotulo}.</p></div>
      ) : (
        <>
          <div className="kpi-grid">
            <Kpi label="Receita do grupo" valor={fmtMoney(t.receitaCompetencia)} delta={variacao(t.receitaCompetencia, ta.receitaCompetencia)} />
            <Kpi label="CMV" valor={fmtMoney(t.cmv)} delta={variacao(t.cmv, ta.cmv)} />
            <Kpi label="Margem bruta" valor={`${t.margemBrutaPct.toFixed(1)}%`} delta={variacao(t.margemBrutaPct, ta.margemBrutaPct)} />
            <Kpi label="Despesas" valor={fmtMoney(t.despesaCompetencia)} delta={variacao(t.despesaCompetencia, ta.despesaCompetencia)} />
            <Kpi label="Lucro líquido" valor={fmtMoney(t.lucroLiquido)} delta={variacao(t.lucroLiquido, ta.lucroLiquido)} />
            <Kpi label="Pedidos" valor={t.pedidos} delta={variacao(t.pedidos, ta.pedidos)} />
            <Kpi label="Ticket médio" valor={fmtMoney(t.ticketMedio)} delta={variacao(t.ticketMedio, ta.ticketMedio)} />
            <Kpi label="Saldo de caixa" valor={fmtMoney(t.saldoCaixa)} delta={variacao(t.saldoCaixa, ta.saldoCaixa)} />
          </div>

          <div className="grid2">
            <div className="panel">
              <h3>Resultado por competência ({rotulo})</h3>
              <table>
                <tbody>
                  <tr><td>Receita de vendas</td><td className="num">{fmtMoney(t.receitaCompetencia)}</td></tr>
                  <tr><td>(–) CMV</td><td className="num">{fmtMoney(t.cmv)}</td></tr>
                  <tr><td><b>= Lucro bruto</b></td><td className="num"><b>{fmtMoney(t.lucroBruto)}</b></td></tr>
                  <tr><td>(–) Despesas operacionais</td><td className="num">{fmtMoney(t.despesaCompetencia)}</td></tr>
                  <tr><td><b>= Lucro líquido</b></td><td className="num" style={{ color: 'var(--amber-bright)' }}><b>{fmtMoney(t.lucroLiquido)}</b></td></tr>
                </tbody>
              </table>
            </div>
            <div className="panel">
              <h3>Caixa ({rotulo})</h3>
              <table>
                <tbody>
                  <tr><td>Entradas (pedidos faturados/enviados)</td><td className="num">{fmtMoney(t.receitaCaixa)}</td></tr>
                  <tr><td>Saídas (compras de matéria-prima)</td><td className="num">{fmtMoney(t.compras)}</td></tr>
                  <tr><td>Saídas (parcelas pagas)</td><td className="num">{fmtMoney(t.despesaCaixa)}</td></tr>
                  <tr><td><b>= Saldo</b></td><td className="num"><b>{fmtMoney(t.saldoCaixa)}</b></td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel">
            <h3>Últimos 12 meses</h3>
            <SerieMensal dados={serie} />
          </div>

          <div className="panel">
            <h3>Por empresa ({rotulo})</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Empresa</th><th>Receita</th><th>Participação</th><th>CMV</th>
                    <th>Margem</th><th>Despesas</th><th>Lucro</th><th>Pedidos</th>
                    <th>Ticket médio</th><th>Custo</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.map(e => (
                    <tr key={e.id}>
                      <td>{e.nome}</td>
                      <td className="num">{fmtMoney(e.receitaCompetencia)}</td>
                      <td style={{ minWidth: 130 }}><BarraParticipacao pct={e.participacaoPct} /></td>
                      <td className="num">{fmtMoney(e.cmv)}</td>
                      <td className="num">{e.margemBrutaPct.toFixed(1)}%</td>
                      <td className="num">{fmtMoney(e.despesaCompetencia)}</td>
                      <td className="num">{fmtMoney(e.lucroLiquido)}</td>
                      <td className="num">{e.pedidos}</td>
                      <td className="num">{fmtMoney(e.ticketMedio)}</td>
                      <td><TagCusto semCusto={e.produtosSemCusto} porFicha={e.produtosCustoFicha} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
              A coluna Custo indica de onde veio o CMV: produto sem custo cadastrado nem ficha técnica entra com zero e infla a margem.
            </p>
          </div>
        </>
      )}
    </>
  );
}
