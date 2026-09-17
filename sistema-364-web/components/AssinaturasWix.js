'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { fmtMoney, fmtDate, hoje } from '../lib/format';
import FichaPrint, { imprimirFicha } from './FichaPrint';

const FREQ_ROTULO = { DAY: 'diária', WEEK: 'semanal', MONTH: 'mensal', YEAR: 'anual' };

const STATUS_PAGAMENTO = {
  PAID: { rotulo: 'Pago', classe: 'ok' },
  PENDING: { rotulo: 'Pendente', classe: 'warn' },
  FAILED: { rotulo: 'Falhou', classe: 'bad' },
  REFUNDED: { rotulo: 'Reembolsado', classe: 'neutro' },
  UNPAID: { rotulo: 'Não pago', classe: 'bad' },
  NOT_APPLICABLE: { rotulo: '—', classe: 'neutro' },
};

function enderecoLinha(a) {
  const partes = [
    [a.enderecoRua, a.enderecoNumero].filter(Boolean).join(', '),
    a.enderecoComplemento,
    [a.enderecoCidade, a.enderecoUf].filter(Boolean).join('/'),
    a.enderecoCep,
  ].filter(Boolean);
  return partes.length ? partes.join(' — ') : null;
}

// Lista ao vivo das assinaturas do site Wix (compra recorrente de produto),
// casadas por CPF com os clientes cadastrados. Sem tabela própria pros dados
// da assinatura em si — busca direto em GET /api/pedidos/assinaturas a cada
// vez que a aba abre. A confirmação de envio de cada ciclo (cada pedido do
// Wix já É um ciclo) é o único dado que este sistema grava, na tabela
// assinatura_wix_envios (atualização 57).
export default function AssinaturasWix({ empresaId }) {
  const [assinaturas, setAssinaturas] = useState([]);
  const [envios, setEnvios] = useState({}); // wix_order_id -> {data_envio, confirmado_em}
  const [dataDigitada, setDataDigitada] = useState({}); // wix_order_id -> valor do input, antes de confirmar
  const [confirmando, setConfirmando] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [ficha, setFicha] = useState(null);

  async function carregarEnvios() {
    const { data } = await supabase.from('assinatura_wix_envios')
      .select('wix_order_id, data_envio, confirmado_em').eq('empresa_id', empresaId);
    setEnvios(Object.fromEntries((data || []).map(e => [e.wix_order_id, e])));
  }

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
      carregarEnvios();
    })();
    return () => { cancelado = true; };
  }, [empresaId]);

  async function confirmarEnvio(wixOrderId) {
    const data_envio = dataDigitada[wixOrderId] || hoje();
    setConfirmando(wixOrderId);
    const { error } = await supabase.from('assinatura_wix_envios')
      .upsert([{ empresa_id: empresaId, wix_order_id: wixOrderId, data_envio, confirmado_em: new Date().toISOString() }], { onConflict: 'empresa_id,wix_order_id' });
    setConfirmando(null);
    if (error) { alert('Erro ao confirmar envio: ' + error.message); return; }
    carregarEnvios();
  }

  function imprimir(a) {
    const envio = envios[a.wixOrderId];
    imprimirFicha(setFicha, {
      titulo: 'Assinatura (Wix)',
      numero: `Pedido Wix #${a.numeroWix} · Ciclo ${a.cicloNumero ?? '—'}`,
      campos: [
        { rot: 'Cliente', valor: a.clienteNome || a.compradorNome },
        { rot: 'CPF', valor: a.compradorCpf },
        { rot: 'Telefone', valor: a.compradorTelefone },
        { rot: 'E-mail', valor: a.compradorEmail },
        { rot: 'Endereço de entrega', valor: enderecoLinha(a) },
        { rot: 'Plano', valor: a.produtoNome },
        { rot: 'Valor', valor: fmtMoney(a.valor) },
        { rot: 'Frequência', valor: FREQ_ROTULO[a.frequencia] || a.frequencia },
        { rot: 'Data da cobrança', valor: fmtDate(a.dataCompra) },
        { rot: 'Data de envio confirmada', valor: envio ? fmtDate(envio.data_envio) : 'ainda não confirmada' },
      ],
      assinaturas: ['Confirmação de entrega'],
    });
  }

  if (loading) return <p className="muted">Buscando assinaturas no Wix…</p>;
  if (erro) return <div className="banner bad">{erro}</div>;

  return (
    <>
      <FichaPrint ficha={ficha} />
      {!assinaturas.length ? <p className="muted">Nenhuma assinatura encontrada no site Wix.</p> : (
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
                <th>Envio</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {assinaturas.map(a => {
                const status = STATUS_PAGAMENTO[a.statusPagamento] || { rotulo: a.statusPagamento || '—', classe: 'neutro' };
                const envio = envios[a.wixOrderId];
                return (
                  <tr key={a.wixOrderId}>
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
                    <td>
                      {envio ? (
                        <span className="tag ok">Enviado {fmtDate(envio.data_envio)}</span>
                      ) : (
                        <div className="row-actions">
                          <input type="date" style={{ width: 130 }} value={dataDigitada[a.wixOrderId] || hoje()}
                                 onChange={e => setDataDigitada(d => ({ ...d, [a.wixOrderId]: e.target.value }))} />
                          <button className="btn secondary small" disabled={confirmando === a.wixOrderId}
                                  onClick={() => confirmarEnvio(a.wixOrderId)}>
                            {confirmando === a.wixOrderId ? 'Confirmando…' : 'Confirmar envio'}
                          </button>
                        </div>
                      )}
                    </td>
                    <td>
                      <button className="btn secondary small" onClick={() => imprimir(a)}>Imprimir</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
