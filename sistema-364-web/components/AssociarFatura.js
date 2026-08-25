'use client';
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { fmtMoney, fmtDate } from '../lib/format';
import { chamarApi } from '../lib/extratos/cliente';

// O débito da fatura no extrato bancário não é uma compra: é o pagamento de
// um monte de compras que já estão conciliadas linha a linha na fatura.
// Associar aqui baixa todas aquelas parcelas de uma vez — é o que evita
// contar a mesma despesa duas vezes.
export default function AssociarFatura({ lancamento, empresaId, onMudou }) {
  const [aberto, setAberto] = useState(false);
  const [faturas, setFaturas] = useState([]);
  const [faturaId, setFaturaId] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function abrir() {
    setOcupado(true);
    try {
      // 100 (não 24) e ordenado pelo período de cada fatura, não por quando
      // foi importada: o colaborador procura "a fatura de agosto", e com
      // vários cartões um limite baixo ordenado por created_at esgotava em
      // poucos meses — a fatura mais antiga sumia da lista sem aviso nenhum,
      // e esse dropdown é o único caminho da tela para baixar o pagamento.
      // nullsFirst:false joga fatura sem período preenchido (extração que não
      // achou a data) para o fim, não para o topo; created_at desempata.
      // Sem filtro por cartão de propósito: o débito do pagamento vem do
      // extrato da conta corrente e não carrega qual cartão foi pago — cada
      // opção mostra o nome da conta para o colaborador escolher à mão.
      const { data } = await supabase.from('extrato_importacoes')
        .select('id, periodo_inicio, periodo_fim, total_lancamentos, conciliados, contas_bancarias(nome)')
        .eq('empresa_id', empresaId).eq('tipo', 'fatura_cartao')
        .order('periodo_fim', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(100);
      setFaturas(data || []);
      setAberto(true);
    } finally {
      setOcupado(false);
    }
  }

  async function associar(forcar = false) {
    if (!faturaId) { alert('Escolha a fatura que este débito pagou.'); return; }
    setOcupado(true);
    try {
      const r = await chamarApi('/api/financeiro/conciliacao', {
        method: 'POST',
        body: JSON.stringify({ acao: 'pagar-fatura', lancamentoId: lancamento.id, faturaId, forcar }),
      });
      const j = await r.json();
      if (!r.ok) {
        // Divergência entre o débito e a soma conciliada (pagamento parcial,
        // rotativo): a função devolve o texto explicando, e a baixa só sai
        // com confirmação explícita.
        if (!forcar && /não bate/i.test(j.error || '')) {
          if (confirm(`${j.error}\n\nBaixar as parcelas da fatura assim mesmo?`)) {
            return await associar(true);
          }
          return;
        }
        alert(j.error || 'Não foi possível associar o pagamento.');
        return;
      }
      alert(`${j.baixadas} parcela(s) da fatura baixada(s).`);
      setAberto(false);
      await onMudou();
    } finally {
      setOcupado(false);
    }
  }

  if (!aberto) {
    return (
      <button className="btn secondary small" disabled={ocupado} onClick={abrir}>
        {ocupado ? '…' : 'Associar à fatura'}
      </button>
    );
  }

  return (
    <div className="items-list" style={{ marginTop: 8 }}>
      {!faturas.length && (
        <div className="item-line muted">
          Nenhuma fatura importada. Importe a fatura do cartão antes de baixar o pagamento.
        </div>
      )}
      {!!faturas.length && (
        <div className="item-line" style={{ display: 'block' }}>
          <label>Fatura paga por este débito de {fmtMoney(lancamento.valor)}</label>
          <select value={faturaId} onChange={e => setFaturaId(e.target.value)}>
            <option value="">Escolha…</option>
            {faturas.map(f => (
              <option key={f.id} value={f.id}>
                {f.contas_bancarias?.nome} — {f.periodo_inicio ? fmtDate(f.periodo_inicio) : '?'} a{' '}
                {f.periodo_fim ? fmtDate(f.periodo_fim) : '?'} ({f.conciliados}/{f.total_lancamentos} conciliados)
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="item-line">
        <button className="btn small" disabled={ocupado || !faturaId} onClick={() => associar(false)}>
          {ocupado ? 'Baixando…' : 'Baixar parcelas da fatura'}
        </button>
        <button className="btn secondary small" onClick={() => setAberto(false)}>Fechar</button>
      </div>
    </div>
  );
}
