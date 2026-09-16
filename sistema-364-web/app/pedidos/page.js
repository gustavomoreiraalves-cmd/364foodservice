'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { fmtMoney, fmtDate, hoje } from '../../lib/format';
import AppShell from '../../components/AppShell';
import PedidoForm from '../../components/PedidoForm';
import ThOrdenar from '../../components/ThOrdenar';
import Paginacao from '../../components/Paginacao';
import { useEmpresaAtual } from '../../lib/empresa';
import { totalPedido, saldoDisponivel } from '../../lib/pedidos';
import { filtrarRegistros, alternarOrdenacao, ordenarRegistros, paginar } from '../../lib/listaCadastro';

// Transições que a trigger do banco ainda aceita como diretas por aqui — sem
// motivo, sem passar por /expedicao (atualização 50). Pendente→Separação e
// Separação→Conferido agora exigem uma expedição (romaneio) viva por trás
// (botões "Iniciar romaneio"/"Continuar romaneio", abaixo); Conferido→Faturado
// exige nota autorizada e só acontece sozinho, dentro da emissão (automática
// ao finalizar o romaneio, ou pela retentativa em /pedidos/[id]). Do que
// sobra, só Faturado→Enviado é de fato livre — Faturado→Pendente e
// Enviado→Pendente exigem motivo e só existem no diálogo de reabertura da
// tela do pedido, não aqui na lista.
const PROXIMOS_STATUS_LIVRES = { Faturado: ['Faturado', 'Enviado'], Enviado: ['Enviado'] };

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
  const [condicoesPagamento, setCondicoesPagamento] = useState([]);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erroCarregar, setErroCarregar] = useState('');
  // Expedição viva (rascunho ou finalizada — nunca cancelada) de cada
  // pedido, por pedido_id. É o que sustenta o botão "Continuar romaneio" de
  // um pedido em Separação/Conferido; o índice único
  // expedicoes_pedido_vivo_unico (atualização 50) garante no máximo uma por
  // pedido, então um mapa simples chave→id nunca perde uma linha em silêncio.
  const [expedicaoPorPedido, setExpedicaoPorPedido] = useState({});
  const [iniciandoRomaneio, setIniciandoRomaneio] = useState(null);
  const [erroRomaneio, setErroRomaneio] = useState('');

  const [cabecalho, setCabecalho] = useState({
    data: hoje(), cliente_id: '', responsavel_id: '', observacoes: '', forma_pagamento: '', condicao_pagamento_id: '',
  });
  const [itens, setItens] = useState([]);

  const [busca, setBusca] = useState('');
  const [ordenacao, setOrdenacao] = useState({ campo: 'data', direcao: 'desc' });
  const [pagina, setPagina] = useState(1);
  const [tamanhoPagina, setTamanhoPagina] = useState(10);
  useEffect(() => { setPagina(1); }, [busca, tamanhoPagina]);

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    setErroCarregar('');
    const eid = empresaAtual.id;
    const [r1, r2, r3, r4, r5, r6] = await Promise.all([
      // `pedidos` tem mais de uma FK para `funcionarios` (responsavel_id e
      // cancelado_por_id, da atualização 27), então `funcionarios(nome)` sem
      // qualificação devolve PGRST201. O nome da constraint desambigua — mesmo
      // padrão de app/recebimentos/page.js depois da atualização 09.
      supabase.from('pedidos').select('*, clientes(nome, cnpj, telefone), responsavel:funcionarios!pedidos_responsavel_id_fkey(nome), pedido_itens(id, quantidade, preco_unitario, produtos(codigo, nome, unidade))').eq('empresa_id', eid).order('created_at', { ascending: false }),
      // select('*') em vez de lista de colunas: se `ativo` ainda não existir
      // (migração 26 pendente), uma projeção que citasse a coluna pelo nome
      // devolveria erro 42703 do PostgREST e vazaria a tela inteira. Com '*'
      // a coluna some do objeto quando não existe, `ativo` vira undefined e
      // `ativo !== false` continua mostrando o registro — sem quebrar nada.
      supabase.from('clientes').select('*').eq('empresa_id', eid).order('nome'),
      supabase.from('produtos').select('*').eq('empresa_id', eid).order('codigo'),
      supabase.from('vw_estoque_produto').select('*').eq('empresa_id', eid),
      supabase.from('funcionarios').select('id, nome').eq('empresa_id', eid).eq('ativo', true).order('nome'),
      // Sem filtrar `ativo` aqui: um pedido antigo pode apontar pra uma
      // condição já desativada, e o form (filter c.ativo !== false || c.id ===
      // selecionado, mesmo padrão de clientes/produtos) precisa dela na lista
      // pra não mostrar o select vazio num pedido em modo leitura.
      supabase.from('condicoes_pagamento').select('id, nome, ativo').eq('empresa_id', eid).order('nome'),
    ]);

    // Qualquer uma das seis pode falhar (rede, sessão expirada, RLS, embed
    // ambíguo). Sem essa checagem o `|| []` transformava a falha em lista
    // vazia: a tela dizia "Nenhum pedido lançado" com o banco cheio.
    const falha = [r1, r2, r3, r4, r5, r6].find(r => r.error);
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
    setCondicoesPagamento(r6.data || []);
    setLoading(false);
    // Fora do Promise.all principal de propósito (achado I3 da revisão de
    // 11/09): `expedicoes` só existe depois da atualização 50, que pode não
    // estar aplicada em todo ambiente ainda — mesmo raciocínio já documentado
    // nesta tela para outras tabelas opcionais. Um erro aqui não pode derrubar
    // a lista inteira de pedidos; na pior hipótese, "Continuar romaneio" some
    // e o operador ainda consegue abrir o pedido pra ver o que fazer.
    carregarExpedicoesAtivas(eid);
  }

  // Mapa pedido_id → expedição viva (rascunho ou finalizada — nunca
  // cancelada), pra sustentar o botão "Continuar romaneio" das linhas em
  // Separação/Conferido. Uma linha por pedido no máximo
  // (expedicoes_pedido_vivo_unico), então um mapa simples chave→id nunca
  // perde uma linha em silêncio.
  async function carregarExpedicoesAtivas(eid) {
    const { data, error } = await supabase.from('expedicoes')
      .select('id, pedido_id').eq('empresa_id', eid).neq('status', 'cancelado');
    setExpedicaoPorPedido(error ? {} : Object.fromEntries((data || []).map(e => [e.pedido_id, e.id])));
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
    if (!cabecalho.forma_pagamento) { alert('Selecione a forma de pagamento.'); return; }
    if (!cabecalho.condicao_pagamento_id) { alert('Selecione a condição de pagamento.'); return; }
    setSalvando(true);
    const { data: pedido, error } = await supabase.from('pedidos').insert([{
      data: cabecalho.data,
      cliente_id: cabecalho.cliente_id,
      status: 'Pendente',
      responsavel_id: cabecalho.responsavel_id || null,
      observacoes: cabecalho.observacoes || null,
      forma_pagamento: cabecalho.forma_pagamento,
      condicao_pagamento_id: cabecalho.condicao_pagamento_id,
      empresa_id: empresaAtual.id,
    }]).select().single();
    if (error) { setSalvando(false); alert('Erro ao salvar: ' + error.message); return; }

    const { error: e2 } = await supabase.from('pedido_itens').insert(
      itens.map(i => ({ pedido_id: pedido.id, empresa_id: empresaAtual.id, ...i }))
    );
    setSalvando(false);
    if (e2) { alert('Pedido criado, mas houve erro nos itens: ' + e2.message); }
    setItens([]);
    setCabecalho({ data: hoje(), cliente_id: '', responsavel_id: '', observacoes: '', forma_pagamento: '', condicao_pagamento_id: '' });
    carregar();
  }

  async function mudarStatus(id, status) {
    const { error } = await supabase.from('pedidos').update({ status }).eq('id', id).eq('empresa_id', empresaAtual.id);
    if (error) alert('Erro ao atualizar status: ' + error.message);
    carregar();
  }

  // Mesmo padrão de app/expedicao/page.js (Task 19): cria o romaneio (POST
  // /api/expedicao) e navega direto pra ele. A rota já confere que o pedido
  // está Pendente e avança o status pra Separação — nada disso é feito aqui.
  async function iniciarRomaneio(pedidoId) {
    setIniciandoRomaneio(pedidoId);
    setErroRomaneio('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch('/api/expedicao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ pedidoId }),
      });
      const json = await r.json();
      if (!r.ok) { setErroRomaneio(json.error || 'Falha ao iniciar o romaneio.'); return; }
      router.push(`/expedicao/${json.expedicaoId}`);
    } finally {
      setIniciandoRomaneio(null);
    }
  }

  const totalDoPedido = p => totalPedido(p.pedido_itens);

  // `filtrarRegistros` só busca em campo direto do registro — o nome do
  // cliente vem aninhado (`p.clientes.nome`), por isso a cópia achatada aqui.
  const pedidosComBusca = useMemo(() => pedidos.map(p => ({ ...p, clienteNome: p.clientes?.nome || '' })), [pedidos]);
  const visiveis = useMemo(
    () => filtrarRegistros(pedidosComBusca, { campos: ['clienteNome'], busca, mostrarInativos: true }),
    [pedidosComBusca, busca],
  );

  const COLUNAS_ORDENACAO = [
    { id: 'data', valor: p => p.data || '' },
    { id: 'cliente', valor: p => p.clientes?.nome || '' },
    { id: 'itens', valor: p => (p.pedido_itens || []).length },
    { id: 'total', valor: p => totalDoPedido(p) },
    { id: 'status', valor: p => p.status || '' },
    { id: 'responsavel', valor: p => p.responsavel?.nome || '' },
  ];
  const ordenados = ordenarRegistros(visiveis, COLUNAS_ORDENACAO, ordenacao);
  const paginacao = paginar(ordenados, pagina, tamanhoPagina);

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
          condicoesPagamento={condicoesPagamento}
          saldoProduto={saldoProduto}
        />
        <button className="btn" style={{ marginTop: 12 }} onClick={finalizar} disabled={salvando}>
          {salvando ? 'Salvando…' : 'Finalizar pedido'}
        </button>
      </div>

      <div className="panel">
        <h3>Pedidos lançados</h3>
        {erroRomaneio && <div className="banner bad">{erroRomaneio}</div>}

        <div className="filter-bar" style={{ marginBottom: 10 }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label htmlFor="busca-pedido">Buscar</label>
            <input id="busca-pedido" value={busca} placeholder="nome do cliente"
                   onChange={e => setBusca(e.target.value)} />
          </div>
        </div>

        <div style={{ marginBottom: 8 }}>
          <span className="muted" style={{ fontSize: 11.5 }}>
            {visiveis.length} de {pedidos.length} pedido{pedidos.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <ThOrdenar titulo="Data" campo="data" ordenacao={ordenacao} onOrdenar={campo => setOrdenacao(o => alternarOrdenacao(o, campo))} />
                <ThOrdenar titulo="Cliente" campo="cliente" ordenacao={ordenacao} onOrdenar={campo => setOrdenacao(o => alternarOrdenacao(o, campo))} />
                <ThOrdenar titulo="Itens" campo="itens" ordenacao={ordenacao} onOrdenar={campo => setOrdenacao(o => alternarOrdenacao(o, campo))} />
                <ThOrdenar titulo="Total" campo="total" alinhamento="right" ordenacao={ordenacao} onOrdenar={campo => setOrdenacao(o => alternarOrdenacao(o, campo))} />
                <ThOrdenar titulo="Status" campo="status" ordenacao={ordenacao} onOrdenar={campo => setOrdenacao(o => alternarOrdenacao(o, campo))} />
                <ThOrdenar titulo="Responsável" campo="responsavel" ordenacao={ordenacao} onOrdenar={campo => setOrdenacao(o => alternarOrdenacao(o, campo))} />
                <th></th>
              </tr>
            </thead>
            <tbody>
              {paginacao.linhas.length ? paginacao.linhas.map(p => (
                <tr key={p.id}>
                  <td>{fmtDate(p.data)}</td>
                  <td>{p.clientes?.nome || '—'}</td>
                  <td>{(p.pedido_itens || []).length} item(ns)</td>
                  <td className="num">{fmtMoney(totalDoPedido(p))}</td>
                  <td>
                    <div className="row-actions">
                      {statusTag(p.status)}
                      {p.status === 'Pendente' && (
                        <button className="btn secondary small" disabled={iniciandoRomaneio === p.id}
                          onClick={() => iniciarRomaneio(p.id)}>
                          {iniciandoRomaneio === p.id ? 'Iniciando…' : 'Iniciar romaneio'}
                        </button>
                      )}
                      {(p.status === 'Separação' || p.status === 'Conferido') && (
                        expedicaoPorPedido[p.id]
                          ? <button className="btn secondary small" onClick={() => router.push(`/expedicao/${expedicaoPorPedido[p.id]}`)}>Continuar romaneio</button>
                          : <span className="muted" style={{ fontSize: 12 }}>Romaneio não encontrado — abra o pedido.</span>
                      )}
                      {/*
                        Cancelar exige motivo (check pedidos_cancelamento_motivo) e reabrir
                        exige motivo (trigger fn_pedido_bloquear_cabecalho): as duas coisas
                        só acontecem na página do pedido, onde há diálogo para o motivo.
                        Aqui a lista só avança o status, e só entre as transições que a
                        trigger ainda aceita sem motivo nem romaneio/nota por trás
                        (PROXIMOS_STATUS_LIVRES, acima).
                      */}
                      {(p.status === 'Faturado' || p.status === 'Enviado' || p.status === 'Cancelado') && (
                        <select style={{ width: 'auto' }} value={p.status} onChange={e => mudarStatus(p.id, e.target.value)}
                          disabled={p.status === 'Cancelado'}>
                          {p.status === 'Cancelado'
                            ? <option>Cancelado</option>
                            : (PROXIMOS_STATUS_LIVRES[p.status] || [p.status]).map(s => <option key={s}>{s}</option>)}
                        </select>
                      )}
                    </div>
                  </td>
                  <td className="muted">{p.responsavel?.nome || '—'}</td>
                  <td>
                    <div className="row-actions">
                      <button className="btn secondary small" onClick={() => router.push(`/pedidos/${p.id}`)}>Abrir</button>
                    </div>
                  </td>
                </tr>
              )) : <tr className="empty-row"><td colSpan={7}>{busca ? 'Nenhum pedido encontrado para essa busca.' : 'Nenhum pedido lançado.'}</td></tr>}
            </tbody>
          </table>
        </div>

        {visiveis.length > 0 && (
          <Paginacao paginaAtual={paginacao.paginaAtual} totalPaginas={paginacao.totalPaginas}
                     tamanhoPagina={tamanhoPagina} onMudarPagina={setPagina} onMudarTamanho={setTamanhoPagina} />
        )}
      </div>
    </>
  );
}
