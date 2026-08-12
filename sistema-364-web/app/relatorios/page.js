'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { fmtMoney, fmtDate, custoMedioMP } from '../../lib/format';
import AppShell from '../../components/AppShell';
import { useEmpresaAtual } from '../../lib/empresa';

export default function RelatoriosPage() {
  return (
    <AppShell modulo="relatorios" titulo="Relatórios" desc="DRE simplificado, fluxo de caixa, produção e compras">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const { empresaAtual } = useEmpresaAtual();
  const [dTodos, setDTodos] = useState(null);
  const [periodo, setPeriodo] = useState(''); // '' = acumulado (tudo); 'AAAA-MM' = mês específico

  useEffect(() => {
    if (!empresaAtual) return;
    async function carregar() {
      const eid = empresaAtual.id;
      const [pedidos, producoes, recebimentos, despesas, fornecedores, fichas, mps, produtos] = await Promise.all([
        supabase.from('pedidos').select('status, data, pedido_itens(produto_id, quantidade, preco_unitario)').eq('empresa_id', eid),
        supabase.from('producoes').select('*, produtos(nome)').eq('empresa_id', eid).order('data'),
        supabase.from('recebimento_itens').select('materia_prima_id, quantidade, custo_unitario, status_recebimento, recebimentos(fornecedor_id, data)').eq('empresa_id', eid),
        supabase.from('despesas').select('valor, data').eq('empresa_id', eid),
        supabase.from('fornecedores').select('id, nome').eq('empresa_id', eid).order('nome'),
        supabase.from('ficha_tecnica').select('*').eq('empresa_id', eid),
        supabase.from('materias_primas').select('*').eq('empresa_id', eid),
        supabase.from('produtos').select('id, nome').eq('empresa_id', eid),
      ]);
      setDTodos({
        pedidos: pedidos.data || [],
        producoes: producoes.data || [],
        recebimentos: recebimentos.data || [],
        despesas: despesas.data || [],
        fornecedores: fornecedores.data || [],
        fichas: fichas.data || [],
        mps: mps.data || [],
        produtos: produtos.data || [],
      });
    }
    carregar();
  }, [empresaAtual?.id]);

  if (!dTodos) return <p className="muted">Carregando…</p>;

  const noPeriodo = data => !periodo || (data || '').slice(0, 7) === periodo;
  const d = {
    ...dTodos,
    pedidos: dTodos.pedidos.filter(p => noPeriodo(p.data)),
    producoes: dTodos.producoes.filter(p => noPeriodo(p.data)),
    recebimentos: dTodos.recebimentos.filter(r => noPeriodo(r.recebimentos?.data)),
    despesas: dTodos.despesas.filter(x => noPeriodo(x.data)),
  };

  // custo unitário do produto: média dos lotes produzidos; sem produção, custo teórico pela ficha técnica
  function custoUnitProduto(produtoId) {
    const lotes = d.producoes.filter(p => p.produto_id === produtoId);
    if (lotes.length) {
      const qtd = lotes.reduce((s, p) => s + Number(p.quantidade), 0);
      const custo = lotes.reduce((s, p) => s + Number(p.custo_total), 0);
      if (qtd) return custo / qtd;
    }
    return d.fichas
      .filter(f => f.produto_id === produtoId)
      .reduce((s, f) => {
        const mp = d.mps.find(m => m.id === f.materia_prima_id);
        return s + (mp ? Number(f.quantidade) * Number(mp.custo_unitario) : 0);
      }, 0);
  }

  const validos = d.pedidos.filter(p => p.status !== 'Cancelado');
  const receitaTotal = validos.reduce((s, p) => s + (p.pedido_itens || []).reduce((s2, i) => s2 + Number(i.quantidade) * Number(i.preco_unitario), 0), 0);
  const cmvTotal = validos.reduce((s, p) => s + (p.pedido_itens || []).reduce((s2, i) => s2 + Number(i.quantidade) * custoUnitProduto(i.produto_id), 0), 0);
  const recebimentosValidos = d.recebimentos.filter(r => r.status_recebimento == null || ['Aceito', 'Aceito com ressalva'].includes(r.status_recebimento));
  const comprasTotal = recebimentosValidos.reduce((s, r) => s + Number(r.quantidade) * Number(r.custo_unitario), 0);
  const despesasTotal = d.despesas.reduce((s, x) => s + Number(x.valor), 0);
  const lucroBruto = receitaTotal - cmvTotal;
  const lucroLiquido = lucroBruto - despesasTotal;
  const entradasCaixa = d.pedidos
    .filter(p => ['Faturado', 'Enviado'].includes(p.status))
    .reduce((s, p) => s + (p.pedido_itens || []).reduce((s2, i) => s2 + Number(i.quantidade) * Number(i.preco_unitario), 0), 0);

  const margemProdutos = d.produtos.map(prod => {
    const itens = validos.flatMap(p => (p.pedido_itens || []).filter(i => i.produto_id === prod.id));
    const qtd = itens.reduce((s, i) => s + Number(i.quantidade), 0);
    if (!qtd) return null;
    const receita = itens.reduce((s, i) => s + Number(i.quantidade) * Number(i.preco_unitario), 0);
    const custoUnit = custoUnitProduto(prod.id);
    const custo = qtd * custoUnit;
    const margem = receita - custo;
    return { id: prod.id, nome: prod.nome, qtd, precoMedio: receita / qtd, custoUnit, margem, margemPct: receita ? (margem / receita) * 100 : 0 };
  }).filter(Boolean).sort((a, b) => b.margem - a.margem);

  const rotulo = periodo
    ? new Date(periodo + '-02').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    : 'acumulado';

  return (
    <>
      <div className="panel">
        <h3>Período</h3>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
          <div>
            <label>Mês</label>
            <input type="month" value={periodo} onChange={e => setPeriodo(e.target.value)} />
          </div>
          {periodo && <button className="btn secondary" onClick={() => setPeriodo('')}>Ver tudo (acumulado)</button>}
        </div>
      </div>

      <div className="grid2">
        <div className="panel">
          <h3>DRE simplificado ({rotulo})</h3>
          <table>
            <tbody>
              <tr><td>Receita de vendas</td><td className="num">{fmtMoney(receitaTotal)}</td></tr>
              <tr><td>(–) CMV (custo dos produtos vendidos)</td><td className="num">{fmtMoney(cmvTotal)}</td></tr>
              <tr><td><b>= Lucro bruto</b></td><td className="num"><b>{fmtMoney(lucroBruto)}</b></td></tr>
              <tr><td>(–) Despesas operacionais</td><td className="num">{fmtMoney(despesasTotal)}</td></tr>
              <tr><td><b>= Lucro líquido</b></td><td className="num" style={{ color: 'var(--amber-bright)' }}><b>{fmtMoney(lucroLiquido)}</b></td></tr>
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h3>Fluxo de caixa ({rotulo})</h3>
          <table>
            <tbody>
              <tr><td>Entradas (vendas faturadas/enviadas)</td><td className="num">{fmtMoney(entradasCaixa)}</td></tr>
              <tr><td>Saídas (compras de matéria-prima)</td><td className="num">{fmtMoney(comprasTotal)}</td></tr>
              <tr><td>Saídas (despesas operacionais)</td><td className="num">{fmtMoney(despesasTotal)}</td></tr>
              <tr><td><b>= Saldo</b></td><td className="num"><b>{fmtMoney(entradasCaixa - comprasTotal - despesasTotal)}</b></td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h3>Relatório de produção</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Lote</th><th>Data</th><th>Produto</th><th>Qtd produzida</th><th>Custo total</th><th>Custo/un.</th></tr></thead>
            <tbody>
              {d.producoes.length ? d.producoes.map(pr => (
                <tr key={pr.id}>
                  <td className="muted">{pr.lote}</td>
                  <td>{fmtDate(pr.data)}</td>
                  <td>{pr.produtos?.nome || '—'}</td>
                  <td className="num">{Number(pr.quantidade)}</td>
                  <td className="num">{fmtMoney(pr.custo_total)}</td>
                  <td className="num">{fmtMoney(Number(pr.custo_total) / Number(pr.quantidade))}</td>
                </tr>
              )) : <tr className="empty-row"><td colSpan={6}>Sem dados de produção.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h3>Relatório de compras por fornecedor</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Fornecedor</th><th>Nº de recebimentos</th><th>Total comprado</th></tr></thead>
            <tbody>
              {d.fornecedores.length ? d.fornecedores.map(f => {
                const recs = recebimentosValidos.filter(r => r.recebimentos?.fornecedor_id === f.id);
                const total = recs.reduce((s, r) => s + Number(r.quantidade) * Number(r.custo_unitario), 0);
                return (
                  <tr key={f.id}>
                    <td>{f.nome}</td>
                    <td className="num">{recs.length}</td>
                    <td className="num">{fmtMoney(total)}</td>
                  </tr>
                );
              }) : <tr className="empty-row"><td colSpan={3}>Sem fornecedores.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h3>Margem por produto ({rotulo})</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Produto</th><th>Qtd vendida</th><th>Preço médio</th><th>Custo médio</th><th>Margem R$</th><th>Margem %</th></tr></thead>
            <tbody>
              {margemProdutos.length ? margemProdutos.map(m => (
                <tr key={m.id}>
                  <td>{m.nome}</td>
                  <td className="num">{m.qtd}</td>
                  <td className="num">{fmtMoney(m.precoMedio)}</td>
                  <td className="num">{fmtMoney(m.custoUnit)}</td>
                  <td className="num">{fmtMoney(m.margem)}</td>
                  <td className="num">{m.margemPct.toFixed(1)}%</td>
                </tr>
              )) : <tr className="empty-row"><td colSpan={6}>Sem vendas no período.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
