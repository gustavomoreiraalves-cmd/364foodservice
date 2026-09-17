'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { fmtMoney, fmtDate } from '../lib/format';

const FREQ_ROTULO = { DAY: 'diária', WEEK: 'semanal', MONTH: 'mensal', YEAR: 'anual' };

const STATUS_PAGAMENTO = {
  PAID: { rotulo: 'Pago', classe: 'ok' },
  PENDING: { rotulo: 'Pendente', classe: 'warn' },
  FAILED: { rotulo: 'Falhou', classe: 'bad' },
  REFUNDED: { rotulo: 'Reembolsado', classe: 'neutro' },
  UNPAID: { rotulo: 'Não pago', classe: 'bad' },
  NOT_APPLICABLE: { rotulo: '—', classe: 'neutro' },
};

// Lista ao vivo das assinaturas do site Wix (compra recorrente de produto),
// casadas por CPF com os clientes cadastrados. Sem tabela própria — busca
// direto em GET /api/pedidos/assinaturas a cada vez que a aba abre.
export default function AssinaturasWix({ empresaId }) {
  const [assinaturas, setAssinaturas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!empresaId) return;
    let cancelado = false;
    (async () => {
      setLoading(true);
      setErro('');
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch(`/api/pedidos/assinaturas?empresaId=${empresaId}`, {
        headers: { Authorization: `Bearer ${session?.access_token || ''}` },
      });
      const json = await r.json();
      if (cancelado) return;
      if (!r.ok) { setErro(json.error || 'Falha ao importar assinaturas do Wix.'); setLoading(false); return; }
      setAssinaturas(json.assinaturas || []);
      setLoading(false);
    })();
    return () => { cancelado = true; };
  }, [empresaId]);

  if (loading) return <p className="muted">Buscando assinaturas no Wix…</p>;
  if (erro) return <div className="banner bad">{erro}</div>;
  if (!assinaturas.length) return <p className="muted">Nenhuma assinatura encontrada no site Wix.</p>;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Cliente</th>
            <th>Plano</th>
            <th className="num">Valor</th>
            <th>Frequência</th>
            <th>Status</th>
            <th>Ciclo</th>
            <th>Última cobrança</th>
          </tr>
        </thead>
        <tbody>
          {assinaturas.map(a => {
            const status = STATUS_PAGAMENTO[a.statusPagamento] || { rotulo: a.statusPagamento || '—', classe: 'neutro' };
            return (
              <tr key={`${a.wixOrderId}-${a.subscriptionId}`}>
                <td>
                  {a.clienteNome
                    ? a.clienteNome
                    : <span>{a.compradorNome || '—'} <span className="tag bad">não cadastrado</span></span>}
                </td>
                <td>{a.produtoNome}</td>
                <td className="num">{fmtMoney(a.valor)}</td>
                <td>{FREQ_ROTULO[a.frequencia] || a.frequencia || '—'}</td>
                <td><span className={`tag ${status.classe}`}>{status.rotulo}</span></td>
                <td>{a.cicloNumero ?? '—'}</td>
                <td>{fmtDate(a.dataCompra)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
