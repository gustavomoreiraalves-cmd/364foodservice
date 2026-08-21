'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';
import { fmtMoney, fmtDate } from '../../../lib/format';
import { fmtDateTime } from '../../../lib/producao';
import { useAuth } from '../../../lib/auth';
import AppShell from '../../../components/AppShell';
import PedidoForm from '../../../components/PedidoForm';
import FichaPrint, { imprimirFicha } from '../../../components/FichaPrint';
import { useEmpresaAtual } from '../../../lib/empresa';
import { podeEditar, totalPedido, diffItens, saldoDisponivel, exigeMotivoReabertura, STATUS_PEDIDO } from '../../../lib/pedidos';

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

const CABECALHO_VAZIO = { data: '', cliente_id: '', responsavel_id: '', observacoes: '' };

function Conteudo({ setFicha }) {
  const { id } = useParams();
  const router = useRouter();
  const { empresaAtual } = useEmpresaAtual();
  const { session } = useAuth();

  const [pedido, setPedido] = useState(null);
  const [cabecalho, setCabecalho] = useState(CABECALHO_VAZIO);
  const [cabecalhoOriginal, setCabecalhoOriginal] = useState(CABECALHO_VAZIO);
  const [itensOriginais, setItensOriginais] = useState([]);
  const [itens, setItens] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [funcionarios, setFuncionarios] = useState([]);
  const [estoqueProd, setEstoqueProd] = useState([]);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [erroCarregar, setErroCarregar] = useState('');
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [reabrindo, setReabrindo] = useState(false);
  const [motivoReabertura, setMotivoReabertura] = useState('');
  const [erroReabrir, setErroReabrir] = useState('');

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    setErro('');
    setErroCarregar('');
    const eid = empresaAtual.id;
    const [r1, r2, r3, r4, r5] = await Promise.all([
      // O filtro por empresa_id é o que impede alcançar pedido de outra marca
      // do grupo adivinhando o uuid da URL.
      //
      // `pedidos` tem mais de uma FK para `funcionarios` (responsavel_id e
      // cancelado_por_id, da atualização 24), então `funcionarios(nome)` sem
      // qualificação devolve PGRST201. O nome da constraint desambigua — mesmo
      // padrão de app/recebimentos/page.js depois da atualização 09.
      supabase.from('pedidos')
        .select('*, clientes(nome, cnpj, telefone), responsavel:funcionarios!pedidos_responsavel_id_fkey(nome), cancelado_por:funcionarios!pedidos_cancelado_por_id_fkey(nome), reaberto_por:funcionarios!pedidos_reaberto_por_id_fkey(nome), pedido_itens(id, produto_id, quantidade, preco_unitario, produtos(codigo, nome, unidade))')
        .eq('id', id).eq('empresa_id', eid).maybeSingle(),
      supabase.from('clientes').select('id, nome').eq('empresa_id', eid).order('nome'),
      supabase.from('produtos').select('*').eq('empresa_id', eid).order('codigo'),
      supabase.from('funcionarios').select('id, nome, user_id').eq('empresa_id', eid).eq('ativo', true).order('nome'),
      supabase.from('vw_estoque_produto').select('*').eq('empresa_id', eid),
    ]);

    // Qualquer uma das cinco pode falhar (rede, sessão expirada, RLS). Sem essa
    // checagem a tela seguia com dado parcial e nada avisava o operador — o pior
    // caso é abrir "normal" com saldo e produto errados por baixo.
    const falha = [r1, r2, r3, r4, r5].find(r => r.error);
    if (falha) {
      setErroCarregar(falha.error.message);
      setLoading(false);
      return;
    }

    setClientes(r2.data || []);
    setProdutos(r3.data || []);
    setFuncionarios(r4.data || []);
    setEstoqueProd(r5.data || []);

    const p = r1.data;
    setPedido(p || null);
    if (p) {
      const cab = {
        data: p.data,
        cliente_id: p.cliente_id || '',
        responsavel_id: p.responsavel_id || '',
        observacoes: p.observacoes || '',
      };
      setCabecalho(cab);
      setCabecalhoOriginal(cab);
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

  // `itensOriginais` (o que já está gravado), e não `itens` (o que está na
  // tela): o que a view descontou foi o que está no banco.
  function saldoProduto(pid) {
    return saldoDisponivel(estoqueProd, itensOriginais, pid);
  }

  // Quem cancela é o usuário logado, não o responsável (vendedor) do pedido —
  // ver app/producoes/nova/page.js para o mesmo padrão de resolução.
  const meuFuncionario = funcionarios.find(f => f.user_id === session?.user?.id);

  // Cabeçalho ou itens diferentes do que veio do banco: usado para travar a
  // troca de status pela lateral enquanto há edição não salva na tela — trocar
  // o status sem isso descartava o trabalho em silêncio e ainda podia travar
  // a reinserção dos itens (fn_pedido_bloquear_edicao fora de Pendente).
  function temAlteracoesNaoSalvas() {
    const { inserir, atualizar, remover } = diffItens(itensOriginais, itens);
    if (inserir.length || atualizar.length || remover.length) return true;
    return cabecalho.data !== cabecalhoOriginal.data
      || cabecalho.cliente_id !== cabecalhoOriginal.cliente_id
      || cabecalho.responsavel_id !== cabecalhoOriginal.responsavel_id
      || cabecalho.observacoes !== cabecalhoOriginal.observacoes;
  }

  async function salvar() {
    if (!itens.length) { alert('O pedido precisa de ao menos um item.'); return; }
    if (!cabecalho.cliente_id) { alert('Selecione o cliente.'); return; }
    setSalvando(true);
    setErro('');
    const eid = empresaAtual.id;

    // As gravações abaixo não são uma transação: se outra pessoa faturou o
    // pedido enquanto esta tela estava aberta, o update do cabeçalho pode ir
    // e o dos itens ser recusado pelo trigger, relatando uma falha parcial
    // como se fosse total. Conferimos o status atual antes de escrever nada.
    const { data: atual, error: eStatus } = await supabase.from('pedidos')
      .select('status').eq('id', id).eq('empresa_id', eid).maybeSingle();
    if (eStatus || !atual || atual.status !== 'Pendente') {
      setSalvando(false);
      setErro('Este pedido foi alterado por outra pessoa e não está mais Pendente. A tela foi recarregada.');
      await carregar();
      return;
    }

    const { error: eCab } = await supabase.from('pedidos').update({
      data: cabecalho.data,
      cliente_id: cabecalho.cliente_id,
      responsavel_id: cabecalho.responsavel_id || null,
      observacoes: cabecalho.observacoes || null,
    }).eq('id', id).eq('empresa_id', eid);
    if (eCab) { setSalvando(false); setErro(eCab.message); carregar(); return; }

    const { inserir, atualizar, remover } = diffItens(itensOriginais, itens);

    if (remover.length) {
      const { error } = await supabase.from('pedido_itens').delete().in('id', remover).eq('empresa_id', eid);
      if (error) { setSalvando(false); setErro(error.message); carregar(); return; }
    }
    for (const it of atualizar) {
      const { error } = await supabase.from('pedido_itens')
        .update({ produto_id: it.produto_id, quantidade: it.quantidade, preco_unitario: it.preco_unitario })
        .eq('id', it.id).eq('empresa_id', eid);
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
    // Segunda trava além do select desabilitado: se por algum motivo chegar
    // aqui com edição pendente, não troca o status por baixo do operador.
    if (temAlteracoesNaoSalvas()) return;
    // Reabrir não passa direto: abre o diálogo de motivo, como o cancelamento.
    if (exigeMotivoReabertura(pedido.status, status)) { setReabrindo(true); return; }
    const { error } = await supabase.from('pedidos').update({ status }).eq('id', id).eq('empresa_id', empresaAtual.id);
    if (error) setErro(error.message);
    carregar();
  }

  async function reabrir() {
    if (!motivoReabertura.trim()) { alert('Informe o motivo da reabertura.'); return; }
    setSalvando(true);
    setErroReabrir('');
    // `reaberto_em` fica com o trigger, pelo mesmo motivo de `cancelado_em`.
    const { error } = await supabase.from('pedidos').update({
      status: 'Pendente',
      reaberto_motivo: motivoReabertura.trim(),
      reaberto_por_id: meuFuncionario?.id || null,
    }).eq('id', id).eq('empresa_id', empresaAtual.id);
    setSalvando(false);
    if (error) { setErroReabrir(error.message); carregar(); return; }
    setReabrindo(false);
    setMotivoReabertura('');
    carregar();
  }

  async function cancelar() {
    if (!motivo.trim()) { alert('Informe o motivo do cancelamento.'); return; }
    setSalvando(true);
    setErro('');
    // `cancelado_em` não vai daqui: quem carimba é o trigger
    // fn_pedido_bloquear_cabecalho, com o relógio do banco. O relógio do
    // navegador pode estar em qualquer hora.
    const { error } = await supabase.from('pedidos').update({
      status: 'Cancelado',
      cancelado_motivo: motivo.trim(),
      cancelado_por_id: meuFuncionario?.id || null,
    }).eq('id', id).eq('empresa_id', empresaAtual.id);
    setSalvando(false);
    if (error) { setErro(error.message); carregar(); return; }
    setCancelando(false);
    setMotivo('');
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
        { rot: 'Responsável', valor: pedido.responsavel?.nome },
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

  if (erroCarregar) {
    return (
      <div className="banner bad">
        Não foi possível carregar o pedido: {erroCarregar}{' '}
        <button className="btn secondary small" onClick={carregar}>Tentar novamente</button>
      </div>
    );
  }

  if (!pedido) {
    return (
      <div className="banner info">
        Pedido não encontrado nesta empresa. <button className="btn secondary small" onClick={() => router.push('/pedidos')}>Voltar para a lista</button>
      </div>
    );
  }

  const editavel = podeEditar(pedido.status);
  const alteracoesPendentes = editavel && temAlteracoesNaoSalvas();

  return (
    <>
      {erro && <div className="banner bad">Não foi possível salvar: {erro}</div>}

      <div className="panel">
        <div className="row-actions" style={{ justifyContent: 'space-between' }}>
          <h3>Pedido {String(pedido.id).slice(0, 8).toUpperCase()}</h3>
          <div className="row-actions">
            <select style={{ width: 'auto' }} value={pedido.status}
              onChange={e => mudarStatus(e.target.value)}
              disabled={pedido.status === 'Cancelado' || alteracoesPendentes}
              title={alteracoesPendentes ? 'Salve ou descarte as alterações antes de trocar o status.' : undefined}>
              {STATUS_PEDIDO.filter(s => s !== 'Cancelado').map(s => <option key={s}>{s}</option>)}
              {pedido.status === 'Cancelado' && <option>Cancelado</option>}
            </select>
            <button className="btn secondary small" onClick={imprimir}>Imprimir pedido</button>
            <button className="btn secondary small" onClick={() => router.push('/pedidos')}>Voltar</button>
          </div>
        </div>

        {alteracoesPendentes && (
          <div className="banner info">
            Há alterações não salvas — salve ou recarregue a página antes de trocar o status.
          </div>
        )}

        {!editavel && (
          <div className="banner info">
            Pedido {pedido.status.toLowerCase()} — somente leitura. Para corrigir, cancele com motivo e lance outro pedido.
          </div>
        )}

        {reabrindo && (
          <div className="panel" style={{ marginTop: 12 }}>
            {erroReabrir && <div className="banner bad">Não foi possível reabrir o pedido: {erroReabrir}</div>}
            <label>Motivo da reabertura</label>
            <input type="text" value={motivoReabertura} autoFocus
              placeholder="Ex.: preço errado na nota"
              onChange={e => setMotivoReabertura(e.target.value)} />
            <p className="muted" style={{ fontSize: 12 }}>
              Reabrir devolve o pedido para Pendente e libera de novo a edição de itens e preços.
              O motivo fica gravado com o seu nome e a data.
            </p>
            <div className="row-actions">
              <button className="btn" onClick={reabrir} disabled={salvando}>
                {salvando ? 'Reabrindo…' : 'Confirmar reabertura'}
              </button>
              <button className="btn secondary" onClick={() => { setReabrindo(false); setMotivoReabertura(''); setErroReabrir(''); }}>Voltar</button>
            </div>
          </div>
        )}

        {pedido.reaberto_em && (
          <div className="banner info" style={{ marginTop: 12 }}>
            <b>Pedido reaberto</b> em {fmtDateTime(pedido.reaberto_em)}
            {pedido.reaberto_por?.nome ? ` por ${pedido.reaberto_por.nome}` : ''} — {pedido.reaberto_motivo}
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

        {pedido.status === 'Cancelado' && (
          <div className="banner bad" style={{ marginTop: 12 }}>
            <b>Pedido cancelado</b> em {fmtDateTime(pedido.cancelado_em)} — {pedido.cancelado_motivo}
          </div>
        )}

        {pedido.status !== 'Cancelado' && (
          cancelando ? (
            <div className="panel" style={{ marginTop: 12 }}>
              <label>Motivo do cancelamento</label>
              <input type="text" value={motivo} autoFocus
                placeholder="Ex.: cliente desistiu da compra"
                onChange={e => setMotivo(e.target.value)} />
              <p className="muted" style={{ fontSize: 12 }}>
                O pedido cancelado devolve o saldo dos produtos ao estoque e não volta para Pendente.
              </p>
              <div className="row-actions">
                <button className="btn danger" onClick={cancelar} disabled={salvando}>
                  {salvando ? 'Cancelando…' : 'Confirmar cancelamento'}
                </button>
                <button className="btn secondary" onClick={() => { setCancelando(false); setMotivo(''); }}>Voltar</button>
              </div>
            </div>
          ) : (
            <button className="btn danger" style={{ marginTop: 12 }} onClick={() => setCancelando(true)}>
              Cancelar pedido
            </button>
          )
        )}
      </div>
    </>
  );
}
