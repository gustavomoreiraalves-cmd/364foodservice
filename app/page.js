'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { fmtMoney, fmtDate, hoje, diasEntre } from '../lib/format';
import AppShell from '../components/AppShell';

export default function Home() {
  return (
    <AppShell modulo={null} titulo="Dashboard" desc="Visão geral da operação">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const [dados, setDados] = useState(null);

  useEffect(() => {
    async function carregar() {
      const [pedidos, estoqueMP, recebimentos, produtos, clientes] = await Promise.all([
        supabase.from('pedidos').select('*, clientes(nome), pedido_itens(quantidade, preco_unitario)').order('created_at', { ascending: false }),
        supabase.from('vw_estoque_materia_prima').select('*'),
        supabase.from('recebimentos').select('*, materias_primas(nome, unidade), fornecedores(nome)').order('created_at', { ascending: false }),
        supabase.from('produtos').select('id'),
        supabase.from('clientes').select('id'),
      ]);
      setDados({
        pedidos: pedidos.data || [],
        estoqueMP: estoqueMP.data || [],
        recebimentos: recebimentos.data || [],
        nProdutos: produtos.data?.length || 0,
        nClientes: clientes.data?.length || 0,
      });
    }
    carregar();
  }, []);

  if (!dados) return <p className="muted">Carregando…</p>;

  const mesAtual = hoje().slice(0, 7);
  const totalPedido = p => (p.pedido_itens || []).reduce((s, i) => s + Number(i.quantidade) * Number(i.preco_unitario), 0);

  const receitaMes = dados.pedidos
    .filter(p => p.status !== 'Cancelado' && String(p.data).slice(0, 7) === mesAtual)
    .reduce((s, p) => s + totalPedido(p), 0);
  const pedidosPendentes = dados.pedidos.filter(p => p.status === 'Pendente').length;
  const mpZeradas = dados.estoqueMP.filter(m => Number(m.saldo) <= 0).length;
  const saldoPorMP = Object.fromEntries(dados.estoqueMP.map(m => [m.materia_prima_id, Number(m.saldo)]));
  const vencendo = dados.recebimentos.filter(r => {
    if (!r.validade) return false;
    const d = diasEntre(hoje(), r.validade);
    return d >= 0 && d <= 7 && (saldoPorMP[r.materia_prima_id] || 0) > 0;
  }).length;

  const statusTag = s => {
    const map = { Pendente: 'warn', Faturado: 'ok', Enviado: 'ok', Cancelado: 'bad' };
    return <span className={`tag ${map[s] || 'warn'}`}>{s}</span>;
  };

  return (
    <>
      <div className="kpi-grid">
        <div className="kpi"><div className="label">Receita do mês</div><div className="value">{fmtMoney(receitaMes)}</div></div>
        <div className="kpi"><div className="label">Pedidos pendentes</div><div className="value">{pedidosPendentes}</div></div>
        <div className={`kpi ${mpZeradas ? 'warn' : ''}`}><div className="label">Matérias-primas zeradas</div><div className={`value ${mpZeradas ? 'warn' : ''}`}>{mpZeradas}</div></div>
        <div className={`kpi ${vencendo ? 'warn' : ''}`}><div className="label">Lotes vencendo em 7 dias</div><div className={`value ${vencendo ? 'warn' : ''}`}>{vencendo}</div></div>
        <div className="kpi"><div className="label">Produtos cadastrados</div><div className="value">{dados.nProdutos}</div></div>
        <div className="kpi"><div className="label">Clientes ativos</div><div className="value">{dados.nClientes}</div></div>
      </div>

      <div className="grid2">
        <div className="panel">
          <h3>Últimos recebimentos</h3>
          {dados.recebimentos.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Data</th><th>Matéria-prima</th><th>Fornecedor</th><th>Qtd</th><th>Lote</th></tr></thead>
                <tbody>
                  {dados.recebimentos.slice(0, 6).map(r => (
                    <tr key={r.id}>
                      <td>{fmtDate(r.data)}</td>
                      <td>{r.materias_primas?.nome || '—'}</td>
                      <td>{r.fornecedores?.nome || '—'}</td>
                      <td className="num">{Number(r.quantidade)} {r.materias_primas?.unidade || ''}</td>
                      <td className="muted">{r.lote}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="muted" style={{ fontSize: 12.5 }}>Nenhum registro ainda.</p>}
        </div>
        <div className="panel">
          <h3>Últimos pedidos de venda</h3>
          {dados.pedidos.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Data</th><th>Cliente</th><th>Total</th><th>Status</th></tr></thead>
                <tbody>
                  {dados.pedidos.slice(0, 6).map(p => (
                    <tr key={p.id}>
                      <td>{fmtDate(p.data)}</td>
                      <td>{p.clientes?.nome || '—'}</td>
                      <td className="num">{fmtMoney(totalPedido(p))}</td>
                      <td>{statusTag(p.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="muted" style={{ fontSize: 12.5 }}>Nenhum registro ainda.</p>}
        </div>
      </div>
    </>
  );
}
