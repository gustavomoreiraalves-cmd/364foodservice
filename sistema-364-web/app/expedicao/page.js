// app/expedicao/page.js
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import AppShell from '../../components/AppShell';
import { useEmpresaAtual } from '../../lib/empresa';
import { fmtDate, fmtMoney } from '../../lib/format';
import { totalPedido } from '../../lib/pedidos';

export default function ExpedicaoPage() {
  return (
    <AppShell modulo="expedicao" titulo="Expedição" desc="Romaneio de separação: escolha o pedido pendente pra começar">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const { empresaAtual } = useEmpresaAtual();
  const router = useRouter();
  const [pedidos, setPedidos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [iniciando, setIniciando] = useState(null);
  const [erro, setErro] = useState('');

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    const { data } = await supabase.from('pedidos')
      .select('*, cliente:clientes(nome), pedido_itens(quantidade, preco_unitario)')
      .eq('empresa_id', empresaAtual.id).eq('status', 'Pendente').order('data');
    setPedidos(data || []);
    setLoading(false);
  }
  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  async function iniciar(pedidoId) {
    setIniciando(pedidoId);
    setErro('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch('/api/expedicao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ pedidoId }),
      });
      const json = await r.json();
      if (!r.ok) { setErro(json.error || 'Falha ao iniciar o romaneio.'); return; }
      router.push(`/expedicao/${json.expedicaoId}`);
    } finally {
      setIniciando(null);
    }
  }

  if (loading) return <p className="muted">Carregando…</p>;

  return (
    <section className="panel">
      {erro && <p className="erro">{erro}</p>}
      {!pedidos.length && <p className="muted">Nenhum pedido pendente pra separar.</p>}
      {pedidos.map(p => (
        <div key={p.id} className="row-actions" style={{ justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--linha)' }}>
          <div>
            <strong>{p.cliente?.nome}</strong> — {fmtDate(p.data)} — {fmtMoney(totalPedido(p.pedido_itens))}
          </div>
          <button className="btn small" disabled={iniciando === p.id} onClick={() => iniciar(p.id)}>
            {iniciando === p.id ? 'Iniciando…' : 'Iniciar romaneio'}
          </button>
        </div>
      ))}
    </section>
  );
}
