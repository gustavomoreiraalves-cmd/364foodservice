'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';
import { fmtMoney, fmtDate } from '../../../lib/format';
import AppShell from '../../../components/AppShell';
import PedidoForm from '../../../components/PedidoForm';
import FichaPrint, { imprimirFicha } from '../../../components/FichaPrint';
import { useEmpresaAtual } from '../../../lib/empresa';
import { podeEditar, totalPedido, diffItens, STATUS_PEDIDO } from '../../../lib/pedidos';

export default function PedidoPage() {
  const [ficha, setFicha] = useState(null);
  return (
    <>
      <AppShell modulo="pedidos" titulo="Pedido de Venda" desc="Detalhe, edição e cancelamento do pedido">
        <Conteudo setFicha={setFicha} />
      </AppShell>
      <FichaPrint ficha={ficha} />
    </>
  );
}

function Conteudo({ setFicha }) {
  const { id } = useParams();
  const router = useRouter();
  const { empresaAtual } = useEmpresaAtual();

  const [pedido, setPedido] = useState(null);
  const [cabecalho, setCabecalho] = useState({ data: '', cliente_id: '', responsavel_id: '', observacoes: '' });
  const [itensOriginais, setItensOriginais] = useState([]);
  const [itens, setItens] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [funcionarios, setFuncionarios] = useState([]);
  const [estoqueProd, setEstoqueProd] = useState([]);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    setErro('');
    const eid = empresaAtual.id;
    const [r1, r2, r3, r4, r5] = await Promise.all([
      // O filtro por empresa_id é o que impede alcançar pedido de outra marca
      // do grupo adivinhando o uuid da URL.
      supabase.from('pedidos')
        .select('*, clientes(nome, cnpj, telefone), funcionarios(nome), pedido_itens(id, produto_id, quantidade, preco_unitario, produtos(codigo, nome, unidade))')
        .eq('id', id).eq('empresa_id', eid).maybeSingle(),
      supabase.from('clientes').select('id, nome').eq('empresa_id', eid).order('nome'),
      supabase.from('produtos').select('*').eq('empresa_id', eid).order('codigo'),
      supabase.from('funcionarios').select('id, nome').eq('empresa_id', eid).eq('ativo', true).order('nome'),
      supabase.from('vw_estoque_produto').select('*').eq('empresa_id', eid),
    ]);
    setClientes(r2.data || []);
    setProdutos(r3.data || []);
    setFuncionarios(r4.data || []);
    setEstoqueProd(r5.data || []);

    const p = r1.data;
    setPedido(p || null);
    if (p) {
      setCabecalho({
        data: p.data,
        cliente_id: p.cliente_id || '',
        responsavel_id: p.responsavel_id || '',
        observacoes: p.observacoes || '',
      });
      const lista = (p.pedido_itens || []).map(i => ({
        id: i.id, produto_id: i.produto_id,
        quantidade: Number(i.quantidade), preco_unitario: Number(i.preco_unitario),
      }));
      setItensOriginais(lista);
      setItens(lista);
    }
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id, id]);

  function saldoProduto(pid) {
    return Number(estoqueProd.find(e => e.produto_id === pid)?.saldo || 0);
  }

  async function salvar() {
    if (!itens.length) { alert('O pedido precisa de ao menos um item.'); return; }
    if (!cabecalho.cliente_id) { alert('Selecione o cliente.'); return; }
    setSalvando(true);
    setErro('');
    const eid = empresaAtual.id;

    const { error: eCab } = await supabase.from('pedidos').update({
      data: cabecalho.data,
      cliente_id: cabecalho.cliente_id,
      responsavel_id: cabecalho.responsavel_id || null,
      observacoes: cabecalho.observacoes || null,
    }).eq('id', id).eq('empresa_id', eid);
    if (eCab) { setSalvando(false); setErro(eCab.message); carregar(); return; }

    const { inserir, atualizar, remover } = diffItens(itensOriginais, itens);

    if (remover.length) {
      const { error } = await supabase.from('pedido_itens').delete().in('id', remover);
      if (error) { setSalvando(false); setErro(error.message); carregar(); return; }
    }
    for (const it of atualizar) {
      const { error } = await supabase.from('pedido_itens')
        .update({ produto_id: it.produto_id, quantidade: it.quantidade, preco_unitario: it.preco_unitario })
        .eq('id', it.id);
      if (error) { setSalvando(false); setErro(error.message); carregar(); return; }
    }
    if (inserir.length) {
      const { error } = await supabase.from('pedido_itens').insert(
        inserir.map(it => ({
          pedido_id: id, empresa_id: eid, produto_id: it.produto_id,
          quantidade: it.quantidade, preco_unitario: it.preco_unitario,
        })),
      );
      if (error) { setSalvando(false); setErro(error.message); carregar(); return; }
    }

    setSalvando(false);
    await carregar();
  }

  async function mudarStatus(status) {
    const { error } = await supabase.from('pedidos').update({ status }).eq('id', id).eq('empresa_id', empresaAtual.id);
    if (error) setErro(error.message);
    carregar();
  }

  function imprimir() {
    imprimirFicha(setFicha, {
      titulo: 'Pedido de Venda',
      numero: `Pedido ${String(pedido.id).slice(0, 8).toUpperCase()} · ${fmtDate(pedido.data)}`,
      campos: [
        { rot: 'Data', valor: fmtDate(pedido.data) },
        { rot: 'Status', valor: pedido.status },
        { rot: 'Cliente', valor: pedido.clientes?.nome },
        { rot: 'CNPJ/CPF', valor: pedido.clientes?.cnpj },
        { rot: 'Telefone', valor: pedido.clientes?.telefone },
        { rot: 'Responsável', valor: pedido.funcionarios?.nome },
        { rot: 'Observações', valor: pedido.observacoes },
      ],
      itens: {
        headers: ['Código', 'Produto', 'Qtd', 'Preço unit.', 'Subtotal'],
        rows: (pedido.pedido_itens || []).map(i => [
          i.produtos?.codigo || '—',
          i.produtos?.nome || '—',
          `${Number(i.quantidade)} ${i.produtos?.unidade || ''}`,
          fmtMoney(i.preco_unitario),
          fmtMoney(Number(i.quantidade) * Number(i.preco_unitario)),
        ]),
      },
      totais: `Total do pedido: ${fmtMoney(totalPedido(pedido.pedido_itens))}`,
      assinaturas: ['Vendedor', 'Cliente'],
    });
  }

  if (loading) return <p className="muted">Carregando…</p>;
  if (!pedido) {
    return (
      <div className="banner info">
        Pedido não encontrado nesta empresa. <button className="btn secondary small" onClick={() => router.push('/pedidos')}>Voltar para a lista</button>
      </div>
    );
  }

  const editavel = podeEditar(pedido.status);

  return (
    <>
      {erro && <div className="banner bad">Não foi possível salvar: {erro}</div>}

      <div className="panel">
        <div className="row-actions" style={{ justifyContent: 'space-between' }}>
          <h3>Pedido {String(pedido.id).slice(0, 8).toUpperCase()}</h3>
          <div className="row-actions">
            <select style={{ width: 'auto' }} value={pedido.status}
              onChange={e => mudarStatus(e.target.value)}
              disabled={pedido.status === 'Cancelado'}>
              {STATUS_PEDIDO.filter(s => s !== 'Cancelado').map(s => <option key={s}>{s}</option>)}
              {pedido.status === 'Cancelado' && <option>Cancelado</option>}
            </select>
            <button className="btn secondary small" onClick={imprimir}>Imprimir pedido</button>
            <button className="btn secondary small" onClick={() => router.push('/pedidos')}>Voltar</button>
          </div>
        </div>

        {!editavel && (
          <div className="banner info">
            Pedido {pedido.status.toLowerCase()} — somente leitura. Para corrigir, cancele com motivo e lance outro pedido.
          </div>
        )}

        <PedidoForm
          cabecalho={cabecalho} setCabecalho={setCabecalho}
          itens={itens} setItens={setItens}
          clientes={clientes} produtos={produtos} funcionarios={funcionarios}
          saldoProduto={saldoProduto} somenteLeitura={!editavel}
        />

        {editavel && (
          <button className="btn" style={{ marginTop: 12 }} onClick={salvar} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar alterações'}
          </button>
        )}
      </div>
    </>
  );
}
