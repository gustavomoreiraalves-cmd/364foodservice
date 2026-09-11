'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';
import AppShell from '../../../components/AppShell';
import { useEmpresaAtual } from '../../../lib/empresa';
import { sugerirAlocacao, empacotarCaixas, calcularDivergencia } from '../../../lib/expedicao';

// Mesmo padrão de app/pedidos/[id]/page.js: o token da sessão pode ter
// girado desde o mount, então pega sempre na hora da chamada em vez de
// guardar um header calculado uma vez.
async function cabecalhoAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${session?.access_token || ''}`, 'Content-Type': 'application/json' };
}

export default function ExpedicaoDetalhePage() {
  return (
    <AppShell modulo="expedicao" titulo="Romaneio de separação" desc="Lotes, caixas, transporte e emissão da NF-e">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const { id } = useParams();
  const router = useRouter();
  const { empresaAtual } = useEmpresaAtual();
  const [expedicao, setExpedicao] = useState(null);
  const [pedidoItens, setPedidoItens] = useState([]);
  const [alocacao, setAlocacao] = useState([]);
  const [transportadoras, setTransportadoras] = useState([]);
  const [transportadoraId, setTransportadoraId] = useState('');
  const [modoFrete, setModoFrete] = useState('0');
  const [veiculoPlaca, setVeiculoPlaca] = useState('');
  const [veiculoUf, setVeiculoUf] = useState('');
  const [naturezas, setNaturezas] = useState([]);
  const [naturezaEscolhida, setNaturezaEscolhida] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [finalizando, setFinalizando] = useState(false);
  const [erro, setErro] = useState('');
  const [divergencias, setDivergencias] = useState([]);

  useEffect(() => { carregar(); }, [id, empresaAtual?.id]);

  async function carregar() {
    if (!empresaAtual) return;
    const { data: exp } = await supabase.from('expedicoes').select('*').eq('id', id).maybeSingle();
    if (!exp) return;
    setExpedicao(exp);
    setTransportadoraId(exp.transportadora_id || '');
    setModoFrete(exp.modo_frete || '0');
    setVeiculoPlaca(exp.veiculo_placa || '');
    setVeiculoUf(exp.veiculo_uf || '');

    const [{ data: itens }, { data: transp }, { data: nats }] = await Promise.all([
      supabase.from('pedido_itens').select('*, produto:produtos(id, nome, rastreado)').eq('pedido_id', exp.pedido_id),
      supabase.from('transportadoras').select('*').eq('empresa_id', empresaAtual.id).eq('ativo', true).order('nome'),
      supabase.from('naturezas_operacao').select('id, descricao').eq('empresa_id', empresaAtual.id).eq('tipo_operacao', 'saida').eq('ativo', true),
    ]);
    setPedidoItens(itens || []);
    setTransportadoras(transp || []);
    setNaturezas(nats || []);

    // Saldo por lote (vw_estoque_produto_lote, Task 1) só dos produtos deste
    // pedido — só busca se houver produto pra filtrar (`.in()` com array
    // vazio não deveria bater em nada, mas evita depender disso).
    const produtoIds = [...new Set((itens || []).map(i => i.produto_id))];
    const { data: saldosLote } = produtoIds.length
      ? await supabase.from('vw_estoque_produto_lote').select('*').eq('empresa_id', empresaAtual.id).in('produto_id', produtoIds).gt('saldo', 0)
      : { data: [] };

    // Agrupa o saldo por produto — sugerirAlocacao espera { [produtoId]: lotes[] }.
    const porProduto = {};
    for (const l of saldosLote || []) {
      (porProduto[l.produto_id] ||= []).push({ recebimentoItemId: l.recebimento_item_id, validade: l.validade, saldo: l.saldo });
    }

    const itensPedidoParaSugestao = (itens || []).map(i => ({
      pedidoItemId: i.id, produtoId: i.produto_id, quantidade: i.quantidade, rastreado: i.produto?.rastreado,
    }));
    setAlocacao(sugerirAlocacao(itensPedidoParaSugestao, porProduto));
  }

  const caixas = empacotarCaixas(alocacao, Object.fromEntries(pedidoItens.map(i => [i.id, i.produto_id])));

  // Devolve true se salvou com sucesso — finalizar() depende disso pra não
  // seguir pra emissão com uma montagem de caixas que não bateu no servidor.
  async function salvar() {
    setSalvando(true);
    setErro('');
    try {
      const corpo = {
        transportadoraId: transportadoraId || null, modoFrete, veiculoPlaca: veiculoPlaca || null, veiculoUf: veiculoUf || null,
        caixas: caixas.map((itensCaixa, indice) => ({
          numero: indice + 1,
          pesoBrutoKg: null,
          itens: itensCaixa.map(i => ({ pedidoItemId: i.pedidoItemId, produtoId: pedidoItens.find(pi => pi.id === i.pedidoItemId)?.produto_id, recebimentoItemId: i.recebimentoItemId, quantidade: i.quantidade })),
        })),
      };
      const r = await fetch(`/api/expedicao/${id}`, { method: 'PUT', headers: await cabecalhoAuth(), body: JSON.stringify(corpo) });
      const json = await r.json();
      if (!r.ok) { setErro(json.error || 'Falha ao salvar o romaneio.'); return false; }
      return true;
    } catch {
      setErro('Falha ao salvar o romaneio.');
      return false;
    } finally {
      setSalvando(false);
    }
  }

  async function cancelar() {
    if (!confirm('Cancelar este romaneio e voltar o pedido para Pendente?')) return;
    const r = await fetch(`/api/expedicao/${id}/cancelar`, { method: 'POST', headers: await cabecalhoAuth() });
    if (!r.ok) {
      const json = await r.json().catch(() => ({}));
      setErro(json.error || 'Falha ao cancelar o romaneio.');
      return;
    }
    router.push('/expedicao');
  }

  async function finalizar() {
    if (!naturezaEscolhida) { alert('Selecione a natureza da operação.'); return; }
    const divs = calcularDivergencia(pedidoItens, alocacao);
    if (divs.length) { setDivergencias(divs); return; }
    setDivergencias([]);
    setFinalizando(true);
    setErro('');
    try {
      const salvou = await salvar();
      if (!salvou) return;
      const r = await fetch(`/api/expedicao/${id}/finalizar`, {
        method: 'POST', headers: await cabecalhoAuth(), body: JSON.stringify({ naturezaOperacaoId: naturezaEscolhida }),
      });
      const json = await r.json();
      if (!r.ok) { setErro(json.error || 'Falha ao finalizar.'); if (json.divergencias) setDivergencias(json.divergencias); return; }
      router.push(`/pedidos/${expedicao.pedido_id}`);
    } finally {
      setFinalizando(false);
    }
  }

  if (!expedicao) return <p className="muted">Carregando…</p>;

  return (
    <section className="panel">
      <h3>Romaneio {expedicao.numero}</h3>
      {erro && <div className="banner erro">{erro}</div>}
      {!!divergencias.length && (
        <div className="banner erro">
          <p>O romaneio não cobre exatamente o pedido:</p>
          <ul>{divergencias.map(d => <li key={d.pedidoItemId}>item {d.pedidoItemId}: pedido {d.pedido}, alocado {d.alocado} (diferença {d.diferenca})</li>)}</ul>
        </div>
      )}

      <h4>Caixas ({caixas.length})</h4>
      {caixas.map((itensCaixa, i) => (
        <div key={i} className="row-actions" style={{ borderBottom: '1px solid var(--linha)', padding: '4px 0' }}>
          <strong>Caixa {i + 1}</strong> — {itensCaixa.reduce((s, it) => s + it.quantidade, 0)} un.
          {itensCaixa.map((it, j) => <span key={j} className="tag"> {it.recebimentoItemId || 'sem lote'} × {it.quantidade}</span>)}
        </div>
      ))}

      <h4>Transporte</h4>
      <label>Transportadora</label>
      <select value={transportadoraId} onChange={e => setTransportadoraId(e.target.value)}>
        <option value="">Nenhuma (retirada / frota própria)</option>
        {transportadoras.map(t => <option key={t.id} value={t.id}>{t.nome_fantasia || t.nome}</option>)}
      </select>
      <label>Modo de frete</label>
      <select value={modoFrete} onChange={e => setModoFrete(e.target.value)}>
        <option value="0">Contratação por conta do remetente (CIF)</option>
        <option value="1">Contratação por conta do destinatário (FOB)</option>
        <option value="9">Sem frete (retirada)</option>
      </select>
      <div className="row-actions">
        <div><label>Placa do veículo</label><input value={veiculoPlaca} onChange={e => setVeiculoPlaca(e.target.value.toUpperCase())} /></div>
        <div><label>UF do veículo</label><input maxLength={2} value={veiculoUf} onChange={e => setVeiculoUf(e.target.value.toUpperCase())} /></div>
      </div>

      <div className="row-actions" style={{ marginTop: 12 }}>
        <button className="btn secondary" onClick={salvar} disabled={salvando || finalizando}>{salvando ? 'Salvando…' : 'Salvar rascunho'}</button>
        <button className="btn secondary" onClick={cancelar} disabled={salvando || finalizando}>Cancelar romaneio</button>
      </div>

      <h4>Finalizar</h4>
      <label>Natureza da operação</label>
      <select value={naturezaEscolhida} onChange={e => setNaturezaEscolhida(e.target.value)}>
        <option value="">Selecione…</option>
        {naturezas.map(n => <option key={n.id} value={n.id}>{n.descricao}</option>)}
      </select>
      <button className="btn" onClick={finalizar} disabled={finalizando || salvando || !naturezaEscolhida}>
        {finalizando ? 'Finalizando e emitindo…' : 'Finalizar e emitir NF-e'}
      </button>
    </section>
  );
}
