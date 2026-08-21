'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { fmtMoney, fmtDate, hoje } from '../../lib/format';
import AppShell from '../../components/AppShell';
import PedidoForm from '../../components/PedidoForm';
import { useEmpresaAtual } from '../../lib/empresa';
import { totalPedido, saldoDisponivel, STATUS_PEDIDO } from '../../lib/pedidos';

export default function PedidosPage() {
  return (
    <AppShell modulo="pedidos" titulo="Pedidos de Venda" desc="Pedidos, faturamento e baixa de estoque">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const router = useRouter();
  const { empresaAtual } = useEmpresaAtual();
  const [pedidos, setPedidos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [estoqueProd, setEstoqueProd] = useState([]);
  const [funcionarios, setFuncionarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erroCarregar, setErroCarregar] = useState('');

  const [cabecalho, setCabecalho] = useState({ data: hoje(), cliente_id: '', responsavel_id: '', observacoes: '' });
  const [itens, setItens] = useState([]);

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    setErroCarregar('');
    const eid = empresaAtual.id;
    const [r1, r2, r3, r4, r5] = await Promise.all([
      // `pedidos` tem mais de uma FK para `funcionarios` (responsavel_id e
      // cancelado_por_id, da atualização 24), então `funcionarios(nome)` sem
      // qualificação devolve PGRST201. O nome da constraint desambigua — mesmo
      // padrão de app/recebimentos/page.js depois da atualização 09.
      supabase.from('pedidos').select('*, clientes(nome, cnpj, telefone), responsavel:funcionarios!pedidos_responsavel_id_fkey(nome), pedido_itens(id, quantidade, preco_unitario, produtos(codigo, nome, unidade))').eq('empresa_id', eid).order('created_at', { ascending: false }),
      supabase.from('clientes').select('id, nome').eq('empresa_id', eid).order('nome'),
      supabase.from('produtos').select('*').eq('empresa_id', eid).order('codigo'),
      supabase.from('vw_estoque_produto').select('*').eq('empresa_id', eid),
      supabase.from('funcionarios').select('id, nome').eq('empresa_id', eid).eq('ativo', true).order('nome'),
    ]);

    // Qualquer uma das cinco pode falhar (rede, sessão expirada, RLS, embed
    // ambíguo). Sem essa checagem o `|| []` transformava a falha em lista
    // vazia: a tela dizia "Nenhum pedido lançado" com o banco cheio.
    const falha = [r1, r2, r3, r4, r5].find(r => r.error);
    if (falha) {
      setErroCarregar(falha.error.message);
      setLoading(false);
      return;
    }

    setPedidos(r1.data || []);
    setClientes(r2.data || []);
    setProdutos(r3.data || []);
    setEstoqueProd(r4.data || []);
    setFuncionarios(r5.data || []);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  // Pedido novo: nenhum item foi gravado ainda, então não há nada que a view já
  // tenha descontado deste pedido para somar de volta.
  function saldoProduto(id) {
    return saldoDisponivel(estoqueProd, [], id);
  }

  async function finalizar() {
    if (!itens.length) { alert('Adicione ao menos um item ao pedido.'); return; }
    if (!cabecalho.cliente_id) { alert('Selecione o cliente.'); return; }
    setSalvando(true);
    const { data: pedido, error } = await supabase.from('pedidos').insert([{
      data: cabecalho.data,
      cliente_id: cabecalho.cliente_id,
      status: 'Pendente',
      responsavel_id: cabecalho.responsavel_id || null,
      observacoes: cabecalho.observacoes || null,
      empresa_id: empresaAtual.id,
    }]).select().single();
    if (error) { setSalvando(false); alert('Erro ao salvar: ' + error.message); return; }

    const { error: e2 } = await supabase.from('pedido_itens').insert(
      itens.map(i => ({ pedido_id: pedido.id, empresa_id: empresaAtual.id, ...i }))
    );
    setSalvando(false);
    if (e2) { alert('Pedido criado, mas houve erro nos itens: ' + e2.message); }
    setItens([]);
    setCabecalho({ data: hoje(), cliente_id: '', responsavel_id: '', observacoes: '' });
    carregar();
  }

  async function mudarStatus(id, status) {
    const { error } = await supabase.from('pedidos').update({ status }).eq('id', id).eq('empresa_id', empresaAtual.id);
    if (error) alert('Erro ao atualizar status: ' + error.message);
    carregar();
  }

  const totalDoPedido = p => totalPedido(p.pedido_itens);

  if (loading) return <p className="muted">Carregando…</p>;

  if (erroCarregar) {
    return (
      <div className="banner bad">
        Não foi possível carregar os pedidos: {erroCarregar}{' '}
        <button className="btn secondary small" onClick={carregar}>Tentar novamente</button>
      </div>
    );
  }

  if (!clientes.length || !produtos.length) {
    return (
      <div className="banner info">
        Cadastre ao menos um <b>cliente</b> e um <b>produto</b> antes de lançar um pedido de venda.
      </div>
    );
  }

  const statusTag = s => {
    const map = { Pendente: 'warn', Faturado: 'ok', Enviado: 'ok', Cancelado: 'bad' };
    return <span className={`tag ${map[s] || 'warn'}`}>{s}</span>;
  };

  return (
    <>
      <div className="panel">
        <h3>Novo pedido de venda</h3>
        <PedidoForm
          cabecalho={cabecalho} setCabecalho={setCabecalho}
          itens={itens} setItens={setItens}
          clientes={clientes} produtos={produtos} funcionarios={funcionarios}
          saldoProduto={saldoProduto}
        />
        <button className="btn" style={{ marginTop: 12 }} onClick={finalizar} disabled={salvando}>
          {salvando ? 'Salvando…' : 'Finalizar pedido'}
        </button>
      </div>

      <div className="panel">
        <h3>Pedidos lançados ({pedidos.length})</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Data</th><th>Cliente</th><th>Itens</th><th>Total</th><th>Status</th><th>Responsável</th><th></th></tr></thead>
            <tbody>
              {pedidos.length ? pedidos.map(p => (
                <tr key={p.id}>
                  <td>{fmtDate(p.data)}</td>
                  <td>{p.clientes?.nome || '—'}</td>
                  <td>{(p.pedido_itens || []).length} item(ns)</td>
                  <td className="num">{fmtMoney(totalDoPedido(p))}</td>
                  <td>
                    <div className="row-actions">
                      {statusTag(p.status)}
                      <select style={{ width: 'auto' }} value={p.status} onChange={e => mudarStatus(p.id, e.target.value)}
                        disabled={p.status === 'Cancelado'}>
                        {/* Cancelar exige motivo (check pedidos_cancelamento_motivo) — só na página do pedido. */}
                        {STATUS_PEDIDO.filter(s => s !== 'Cancelado').map(s => <option key={s}>{s}</option>)}
                        {p.status === 'Cancelado' && <option>Cancelado</option>}
                      </select>
                    </div>
                  </td>
                  <td className="muted">{p.responsavel?.nome || '—'}</td>
                  <td>
                    <div className="row-actions">
                      <button className="btn secondary small" onClick={() => router.push(`/pedidos/${p.id}`)}>Abrir</button>
                    </div>
                  </td>
                </tr>
              )) : <tr className="empty-row"><td colSpan={7}>Nenhum pedido lançado.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
