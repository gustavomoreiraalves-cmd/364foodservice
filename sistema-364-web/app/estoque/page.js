'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { fmtMoney, fmtDate, hoje, diasEntre, custoMedioMP } from '../../lib/format';
import AppShell from '../../components/AppShell';
import { useEmpresaAtual } from '../../lib/empresa';

function primeiroStatus(inspecoes) {
  const insp = Array.isArray(inspecoes) ? inspecoes[0] : inspecoes;
  return insp?.status ?? null;
}

const STATUS_BLOQUEADO = { quarentena: 'Quarentena', rejeitado: 'Rejeitado', devolvido: 'Devolvido', pendente: 'Pendente' };

export default function EstoquePage() {
  return (
    <AppShell modulo="estoque" titulo="Estoque" desc="Saldo de matéria-prima e produto acabado (calculado automaticamente)">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const { empresaAtual } = useEmpresaAtual();
  const [dados, setDados] = useState(null);

  useEffect(() => {
    if (!empresaAtual) return;
    async function carregar() {
      const eid = empresaAtual.id;
      const [mp, prod, saldos, producoes, lotes] = await Promise.all([
        supabase.from('vw_estoque_materia_prima').select('*').eq('empresa_id', eid).order('nome'),
        supabase.from('vw_estoque_produto').select('*').eq('empresa_id', eid).order('codigo'),
        supabase.from('stock_balances').select('materia_prima_id, quantidade, custo_unitario').eq('empresa_id', eid),
        supabase.from('producoes').select('produto_id, quantidade, custo_total').eq('empresa_id', eid),
        supabase.from('recebimento_itens').select('lote, validade, materia_prima_id, materias_primas(nome), recebimentos(data), inspecoes_qualidade(status)').eq('empresa_id', eid).order('created_at', { ascending: false }),
      ]);
      setDados({
        estoqueMP: mp.data || [],
        estoqueProd: prod.data || [],
        saldosLote: saldos.data || [],
        producoes: producoes.data || [],
        lotes: (lotes.data || []).map(r => ({ ...r, data: r.recebimentos?.data, status_qualidade: primeiroStatus(r.inspecoes_qualidade) })),
      });
    }
    carregar();
  }, [empresaAtual?.id]);

  if (!dados) return <p className="muted">Carregando…</p>;

  function custoUnitProduto(produtoId) {
    const lotesProd = dados.producoes.filter(p => p.produto_id === produtoId);
    const totalQtd = lotesProd.reduce((s, p) => s + Number(p.quantidade), 0);
    const totalCusto = lotesProd.reduce((s, p) => s + Number(p.custo_total), 0);
    return totalQtd ? totalCusto / totalQtd : 0;
  }

  return (
    <>
      <div className="grid2">
        <div className="panel">
          <h3>Estoque de matéria-prima</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Matéria-prima</th><th>Saldo</th><th>Custo médio</th><th>Valor em estoque</th></tr></thead>
              <tbody>
                {dados.estoqueMP.length ? dados.estoqueMP.map(m => {
                  const saldo = Number(m.saldo);
                  const custo = custoMedioMP(m.materia_prima_id, dados.saldosLote, []);
                  return (
                    <tr key={m.materia_prima_id}>
                      <td>{m.nome}</td>
                      <td className={`num ${saldo <= 0 ? 'muted' : ''}`}>{saldo.toFixed(2)} {m.unidade}</td>
                      <td className="num">{fmtMoney(custo)}</td>
                      <td className="num">{fmtMoney(saldo * custo)}</td>
                    </tr>
                  );
                }) : <tr className="empty-row"><td colSpan={4}>Nenhuma matéria-prima cadastrada.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <h3>Estoque de produto acabado</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Produto</th><th>Saldo</th><th>Custo unit.</th><th>Valor em estoque</th></tr></thead>
              <tbody>
                {dados.estoqueProd.length ? dados.estoqueProd.map(p => {
                  const saldo = Number(p.saldo);
                  const custo = custoUnitProduto(p.produto_id);
                  return (
                    <tr key={p.produto_id}>
                      <td>{p.codigo} — {p.nome}</td>
                      <td className={`num ${saldo <= 0 ? 'muted' : ''}`}>{saldo.toFixed(2)} {p.unidade}</td>
                      <td className="num">{fmtMoney(custo)}</td>
                      <td className="num">{fmtMoney(saldo * custo)}</td>
                    </tr>
                  );
                }) : <tr className="empty-row"><td colSpan={4}>Nenhum produto cadastrado.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>Lotes de matéria-prima em aberto</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Lote</th><th>Matéria-prima</th><th>Recebido em</th><th>Validade</th><th>Situação</th></tr></thead>
            <tbody>
              {dados.lotes.length ? dados.lotes.map((r, i) => {
                const d = r.validade ? diasEntre(hoje(), r.validade) : null;
                let sit = <span className="tag ok">OK</span>;
                if (d !== null && d < 0) sit = <span className="tag bad">Vencido</span>;
                else if (d !== null && d <= 7) sit = <span className="tag warn">Vence em {d}d</span>;
                if (STATUS_BLOQUEADO[r.status_qualidade]) sit = <span className="tag bad">{STATUS_BLOQUEADO[r.status_qualidade]}</span>;
                return (
                  <tr key={i}>
                    <td className="muted">{r.lote}</td>
                    <td>{r.materias_primas?.nome || '—'}</td>
                    <td>{fmtDate(r.data)}</td>
                    <td>{fmtDate(r.validade)}</td>
                    <td>{sit}</td>
                  </tr>
                );
              }) : <tr className="empty-row"><td colSpan={5}>Sem lotes.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
