'use client';
import { useEffect, useState, useRef } from 'react';
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

// Mesmo padrão de app/fiscal/emissor/page.js e app/empresas/page.js: o token
// da sessão pode ter girado desde o mount, então pega sempre na hora da
// chamada em vez de guardar um header calculado uma vez.
async function cabecalhoAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${session?.access_token || ''}`, 'Content-Type': 'application/json' };
}

// Rótulo e cor de tag para cada status de nfe_saida_documentos (atualização
// 43). 'enviado' e 'erro_comunicacao' são os dois estados "indeterminados" de
// lib/nfe/emitir.js (STATUS_INDETERMINADO): a nota foi transmitida, mas o que
// a SEFAZ decidiu não ficou confirmado neste sistema — visualmente e
// textualmente isto precisa ficar diferente de uma rejeição comum, porque o
// que resolve não é clicar de novo, é conferir na SEFAZ.
const SITUACAO_NOTA = {
  rascunho: { rotulo: 'Rascunho', classe: 'neutro' },
  numero_reservado: { rotulo: 'Número reservado', classe: 'neutro' },
  assinado: { rotulo: 'Assinada — não transmitida', classe: 'neutro' },
  enviado: { rotulo: 'Enviada — resultado não confirmado', classe: 'warn' },
  erro_comunicacao: { rotulo: 'Falha de comunicação — resultado não confirmado', classe: 'warn' },
  autorizado: { rotulo: 'Autorizada', classe: 'ok' },
  rejeitado: { rotulo: 'Rejeitada pela SEFAZ', classe: 'bad' },
  contingencia: { rotulo: 'Contingência', classe: 'warn' },
  cancelado: { rotulo: 'Cancelada', classe: 'neutro' },
};
const STATUS_INDETERMINADO_UI = ['enviado', 'erro_comunicacao'];

// A rota (app/api/fiscal/emitir-nfe/route.js) devolve só { error: mensagem } —
// não há campo estruturado para "resultado indeterminado". O texto abaixo é o
// mesmo, palavra por palavra, que lib/nfe/emitir.js usa para os dois casos de
// STATUS_INDETERMINADO; se aquele texto mudar, esta função precisa acompanhar.
function erroDeResultadoIndeterminado(status, mensagem) {
  return status === 409 && /resultado.*não ficou confirmado/.test(mensagem || '');
}

// Rótulo do botão de ação: propositalmente diferente para o caso
// indeterminado ("Emitir mesmo assim", não "Tentar novamente") — a palavra
// "tentar de novo" sugere um clique despreocupado, e é exatamente o que não
// se quer sugerir quando o resultado da tentativa anterior é desconhecido.
function rotuloBotaoEmitir(notaFiscal) {
  if (!notaFiscal) return 'Emitir NF-e';
  if (notaFiscal.status === 'rejeitado') return 'Tentar novamente';
  if (STATUS_INDETERMINADO_UI.includes(notaFiscal.status)) return 'Emitir mesmo assim';
  return 'Continuar emissão'; // rascunho/numero_reservado/assinado: retomar uma tentativa interrompida antes do envio é seguro.
}

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
  const [erroCancelar, setErroCancelar] = useState('');
  const [reabrindo, setReabrindo] = useState(false);
  const [motivoReabertura, setMotivoReabertura] = useState('');
  const [erroReabrir, setErroReabrir] = useState('');

  // notaFiscal é o último nfe_saida_documentos deste pedido (ou null se nunca
  // emitiu). Carregado à parte do resto do pedido (carregarFiscal), não dentro
  // do Promise.all principal de carregar(): a tabela só existe depois da
  // atualização 43 (ainda não aplicada em todo ambiente), e um erro aqui não
  // pode derrubar a tela do pedido inteira — só a seção fiscal fica ausente.
  const [notaFiscal, setNotaFiscal] = useState(null);
  const [erroFiscalCarregar, setErroFiscalCarregar] = useState('');
  const [naturezas, setNaturezas] = useState([]);
  const [naturezaEscolhida, setNaturezaEscolhida] = useState('');
  const [escolhendoNatureza, setEscolhendoNatureza] = useState(false);
  const [emitindoNota, setEmitindoNota] = useState(false);
  const [erroEmissao, setErroEmissao] = useState('');
  const [emissaoIndeterminada, setEmissaoIndeterminada] = useState(false);
  // Mesmo papel do geracaoRef de app/fiscal/emissor/page.js: identifica a
  // "sessão de pedido" vigente. Incrementado sempre que o efeito de troca de
  // pedido/empresa roda, para que uma resposta de carregarFiscal/emitir ainda
  // em voo possa ser descartada se o operador já tiver saído deste pedido —
  // sem isto, o resultado de uma marca/pedido ficaria exibido por cima de
  // outro, silenciosamente afirmando algo falso sobre o recém-selecionado
  // (a mesma armadilha de estado obsoleto que a tela do emissor já teve).
  const geracaoNotaRef = useRef(0);

  // Carrega a situação fiscal deste pedido (documento mais recente) e as
  // naturezas de operação de saída ativas da marca, para o passo de escolha.
  // Separado de carregar() de propósito — ver comentário de notaFiscal acima.
  async function carregarFiscal(pedidoAtual, eid) {
    const minhaGeracao = geracaoNotaRef.current;
    const [{ data: doc, error: eDoc }, { data: nats, error: eNats }] = await Promise.all([
      // A mais recente: um pedido pode acumular mais de um documento ao longo
      // do tempo (mesmo critério de lib/nfe/emitir.js) — só a última importa
      // para a tela.
      supabase.from('nfe_saida_documentos')
        .select('status, chave, numero, protocolo_autorizacao, motivo_rejeicao')
        .eq('pedido_id', pedidoAtual.id).eq('empresa_id', eid)
        .order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('naturezas_operacao')
        .select('id, descricao')
        .eq('empresa_id', eid).eq('tipo_operacao', 'saida').eq('ativo', true)
        .order('descricao'),
    ]);
    if (geracaoNotaRef.current !== minhaGeracao) return; // pedido/empresa já trocou
    setNotaFiscal(eDoc ? null : (doc || null));
    setErroFiscalCarregar(eDoc ? eDoc.message : '');
    const listaNats = eNats ? [] : (nats || []);
    setNaturezas(listaNats);
    // Pré-seleciona quando só houver uma para a marca — como pede a task.
    setNaturezaEscolhida(listaNats.length === 1 ? listaNats[0].id : '');
  }

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    setErroCarregar('');
    const eid = empresaAtual.id;
    const [r1, r2, r3, r4, r5] = await Promise.all([
      // O filtro por empresa_id é o que impede alcançar pedido de outra marca
      // do grupo adivinhando o uuid da URL.
      //
      // `pedidos` tem mais de uma FK para `funcionarios` (responsavel_id e
      // cancelado_por_id, da atualização 27), então `funcionarios(nome)` sem
      // qualificação devolve PGRST201. O nome da constraint desambigua — mesmo
      // padrão de app/recebimentos/page.js depois da atualização 09.
      supabase.from('pedidos')
        .select('*, clientes(nome, cnpj, telefone), responsavel:funcionarios!pedidos_responsavel_id_fkey(nome), cancelado_por:funcionarios!pedidos_cancelado_por_id_fkey(nome), reaberto_por:funcionarios!pedidos_reaberto_por_id_fkey(nome), pedido_itens(id, produto_id, quantidade, preco_unitario, produtos(codigo, nome, unidade))')
        .eq('id', id).eq('empresa_id', eid).maybeSingle(),
      // select('*') em vez de lista de colunas: se `ativo` ainda não existir
      // (migração 26 pendente), uma projeção que citasse a coluna pelo nome
      // devolveria erro 42703 do PostgREST e vazaria a tela inteira. Com '*' a
      // coluna some do objeto quando não existe, `ativo` vira undefined e
      // `ativo !== false` continua mostrando o registro — sem quebrar nada.
      // Voltar para `select('id, nome')` é pior ainda: desliga o filtro de
      // inativos em silêncio, sem erro nenhum e sem teste que pegue.
      supabase.from('clientes').select('*').eq('empresa_id', eid).order('nome'),
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
      await carregarFiscal(p, eid);
    }
    setLoading(false);
  }

  // `erro` (falha de gravação) é limpo aqui, e não dentro de `carregar()`:
  // limpar lá apagava a mensagem no mesmo ciclo de render em que ela era
  // setada, e nenhum erro de gravação chegava a aparecer na tela. Aqui a
  // tarja só sobrevive à troca de pedido ou de empresa se ninguém mandar
  // ela sumir antes — o que é exatamente o que queremos: ao trocar de
  // pedido/empresa, a última ação relevante para esta tela terminou.
  //
  // O estado de emissão fiscal (notaFiscal, escolha de natureza, erro de
  // emissão) é resetado aqui do mesmo jeito, e por um motivo mais sério que
  // "última ação irrelevante": deixar o resultado de UM pedido exibido depois
  // de trocar para OUTRO afirmaria, em silêncio, algo falso sobre o pedido
  // recém-aberto — numa tela que emite documento fiscal, isso é pior do que
  // cosmético. geracaoNotaRef avança junto para que qualquer resposta de
  // carregarFiscal/emitir ainda em voo da troca anterior seja descartada ao
  // chegar.
  useEffect(() => {
    setErro('');
    geracaoNotaRef.current += 1;
    setNotaFiscal(null);
    setErroFiscalCarregar('');
    setNaturezas([]);
    setNaturezaEscolhida('');
    setEscolhendoNatureza(false);
    setEmitindoNota(false);
    setErroEmissao('');
    setEmissaoIndeterminada(false);
    carregar();
  }, [empresaAtual?.id, id]);

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
    //
    // Os três desfechos ruins são diferentes e mereciam mensagens diferentes:
    // a consulta falhou (rede, sessão), o pedido sumiu da empresa, ou alguém
    // realmente trocou o status. A mensagem única culpava "outra pessoa" até
    // quando o Wi-Fi tinha caído.
    const { data: atual, error: eStatus } = await supabase.from('pedidos')
      .select('status').eq('id', id).eq('empresa_id', eid).maybeSingle();
    if (eStatus) {
      setSalvando(false);
      setErro(`Não foi possível conferir a situação do pedido antes de salvar: ${eStatus.message}. Nada foi gravado — tente de novo.`);
      return;
    }
    if (!atual) {
      setSalvando(false);
      setErro('Este pedido não está mais nesta empresa. Nada foi gravado.');
      await carregar();
      return;
    }
    if (atual.status !== 'Pendente') {
      setSalvando(false);
      setErro(`Este pedido foi alterado por outra pessoa e agora está ${atual.status}. Nada foi gravado e a tela foi recarregada.`);
      await carregar();
      return;
    }

    const { error: eCab } = await supabase.from('pedidos').update({
      data: cabecalho.data,
      cliente_id: cabecalho.cliente_id,
      responsavel_id: cabecalho.responsavel_id || null,
      observacoes: cabecalho.observacoes || null,
    }).eq('id', id).eq('empresa_id', eid);
    if (eCab) { setSalvando(false); setErro(`Não foi possível salvar as alterações do cabeçalho do pedido: ${eCab.message}`); carregar(); return; }

    const { inserir, atualizar, remover } = diffItens(itensOriginais, itens);

    if (remover.length) {
      const { error } = await supabase.from('pedido_itens').delete().in('id', remover).eq('empresa_id', eid);
      if (error) { setSalvando(false); setErro(`Não foi possível remover um item do pedido ao salvar: ${error.message}`); carregar(); return; }
    }
    for (const it of atualizar) {
      const { error } = await supabase.from('pedido_itens')
        .update({ produto_id: it.produto_id, quantidade: it.quantidade, preco_unitario: it.preco_unitario })
        .eq('id', it.id).eq('empresa_id', eid);
      if (error) { setSalvando(false); setErro(`Não foi possível atualizar um item do pedido ao salvar: ${error.message}`); carregar(); return; }
    }
    if (inserir.length) {
      const { error } = await supabase.from('pedido_itens').insert(
        inserir.map(it => ({
          pedido_id: id, empresa_id: eid, produto_id: it.produto_id,
          quantidade: it.quantidade, preco_unitario: it.preco_unitario,
        })),
      );
      if (error) { setSalvando(false); setErro(`Não foi possível inserir um item novo no pedido ao salvar: ${error.message}`); carregar(); return; }
    }

    setSalvando(false);
    await carregar();
  }

  async function mudarStatus(status) {
    // Segunda trava além do select desabilitado: se por algum motivo chegar
    // aqui com edição pendente, não troca o status por baixo do operador.
    if (temAlteracoesNaoSalvas()) return;
    setErro('');
    // Reabrir não passa direto: abre o diálogo de motivo, como o cancelamento.
    if (exigeMotivoReabertura(pedido.status, status)) { setReabrindo(true); return; }
    const { error } = await supabase.from('pedidos').update({ status }).eq('id', id).eq('empresa_id', empresaAtual.id);
    if (error) setErro(`Não foi possível trocar o status do pedido: ${error.message}`);
    carregar();
  }

  async function reabrir() {
    if (!motivoReabertura.trim()) { alert('Informe o motivo da reabertura.'); return; }
    setSalvando(true);
    setErro('');
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
    setErroCancelar('');
    // `cancelado_em` não vai daqui: quem carimba é o trigger
    // fn_pedido_bloquear_cabecalho, com o relógio do banco. O relógio do
    // navegador pode estar em qualquer hora.
    const { error } = await supabase.from('pedidos').update({
      status: 'Cancelado',
      cancelado_motivo: motivo.trim(),
      cancelado_por_id: meuFuncionario?.id || null,
    }).eq('id', id).eq('empresa_id', empresaAtual.id);
    setSalvando(false);
    if (error) { setErroCancelar(error.message); carregar(); return; }
    setCancelando(false);
    setMotivo('');
    carregar();
  }

  // Emite a NF-e para este pedido (POST /api/fiscal/emitir-nfe, Task 6).
  // Corpo e retorno conferidos lendo app/api/fiscal/emitir-nfe/route.js e
  // lib/nfe/emitir.js: { pedidoId, naturezaOperacaoId } →
  // { status, chave, numero, protocolo, motivo } no sucesso (200 — inclusive
  // quando a SEFAZ rejeita, que não é erro HTTP), ou { error } com o status
  // vindo de emitirNfe() (400/404/409/500/502) na falha.
  async function emitir() {
    if (!naturezaEscolhida) { alert('Selecione a natureza da operação.'); return; }
    // Captura a geração vigente no momento do clique: se o operador sair
    // deste pedido antes da resposta chegar, ela é descartada — pertence ao
    // pedido antigo, não ao que está na tela agora.
    const minhaGeracao = geracaoNotaRef.current;
    const pedidoAlvo = pedido;
    const eid = empresaAtual.id;
    // Desabilita o botão durante toda a chamada, inclusive o caminho de erro
    // (o finally cobre as duas saídas) — um duplo clique aqui gastaria
    // numeração fiscal de verdade e pode pôr duas notas na rua para o mesmo
    // pedido; o pipeline (lib/nfe/emitir.js) não tem trava própria contra
    // isso, então esta é a única barreira contra o clique duplo hoje.
    setEmitindoNota(true);
    setErroEmissao('');
    setEmissaoIndeterminada(false);
    try {
      const r = await fetch('/api/fiscal/emitir-nfe', {
        method: 'POST',
        headers: await cabecalhoAuth(),
        body: JSON.stringify({ pedidoId: id, naturezaOperacaoId: naturezaEscolhida }),
      });
      const json = await r.json();
      if (geracaoNotaRef.current !== minhaGeracao) return;
      if (!r.ok) {
        // "Resultado indeterminado" (a nota foi transmitida mas o veredito da
        // SEFAZ não ficou confirmado neste sistema) é informação de natureza
        // diferente de uma rejeição comum: aqui ninguém sabe o que a SEFAZ
        // decidiu, e tentar de novo sem conferir arrisca autorizar duas notas
        // para o mesmo pedido. Sinalizado à parte para o JSX tratar diferente
        // de um erro qualquer — não é "clique de novo", é "confira na SEFAZ".
        if (erroDeResultadoIndeterminado(r.status, json.error)) setEmissaoIndeterminada(true);
        setErroEmissao(json.error || 'Falha ao emitir a NF-e.');
        return;
      }
      // Sucesso inclui rejeição da SEFAZ (200 com status: 'rejeitado') — não é
      // erro HTTP, é um veredito válido registrado no documento. Recarrega do
      // banco (fonte da verdade) em vez de montar o objeto a partir da
      // resposta: mesmo padrão de cancelar/reabrir/salvar acima.
      setEscolhendoNatureza(false);
      await carregarFiscal(pedidoAlvo, eid);
    } catch (e) {
      if (geracaoNotaRef.current !== minhaGeracao) return;
      setErroEmissao(e.message);
    } finally {
      if (geracaoNotaRef.current === minhaGeracao) setEmitindoNota(false);
    }
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
      {erro && <div className="banner bad">{erro}</div>}

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
            Pedido {pedido.status.toLowerCase()} — somente leitura. {pedido.status === 'Cancelado'
              ? 'Para corrigir, lance outro pedido.'
              : 'Para corrigir, reabra com motivo (volta para Pendente) ou cancele com motivo e lance outro pedido.'}
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

        {/* Emissão de NF-e. O bloco de status (chave/número/situação) aparece
            sempre que existe um documento para este pedido, mesmo depois de o
            pedido avançar para Enviado — esconder a chave de uma nota já
            emitida só porque o pedido mudou de status seria fazer
            desaparecer informação fiscal verdadeira, o mesmo tipo de erro que
            esta task existe para evitar. A AÇÃO de emitir (seletor de
            natureza + botão) já é mais restrita: só com o pedido Faturado, e
            nunca quando já existe documento autorizado — emitir de novo
            duplicaria a nota. */}
        {(pedido.status === 'Faturado' || notaFiscal) && (
          <div className="panel" style={{ marginTop: 12 }}>
            <h4 style={{ marginTop: 0 }}>Nota fiscal (NF-e)</h4>

            {erroFiscalCarregar ? (
              <div className="banner bad">
                Não foi possível carregar a situação fiscal deste pedido: {erroFiscalCarregar}{' '}
                <button className="btn secondary small" onClick={() => carregarFiscal(pedido, empresaAtual.id)}>Tentar novamente</button>
              </div>
            ) : (
              <>
                {notaFiscal && (
                  <div style={{ marginBottom: 12, fontSize: 13 }}>
                    <div>
                      <b>Situação:</b>{' '}
                      <span className={`tag ${(SITUACAO_NOTA[notaFiscal.status] || {}).classe || 'neutro'}`}>
                        {(SITUACAO_NOTA[notaFiscal.status] || {}).rotulo || notaFiscal.status}
                      </span>
                    </div>
                    {notaFiscal.chave && <div style={{ marginTop: 4 }}><b>Chave de acesso:</b> {notaFiscal.chave}</div>}
                    {notaFiscal.numero != null && <div style={{ marginTop: 4 }}><b>Número:</b> {notaFiscal.numero}</div>}
                    {notaFiscal.protocolo_autorizacao && (
                      <div style={{ marginTop: 4 }}><b>Protocolo de autorização:</b> {notaFiscal.protocolo_autorizacao}</div>
                    )}
                  </div>
                )}

                {/* Rejeição: o motivo da própria SEFAZ (cStat + xMotivo), verbatim —
                    é a única coisa acionável que o operador tem, não pode virar uma
                    mensagem genérica. */}
                {notaFiscal?.status === 'rejeitado' && notaFiscal.motivo_rejeicao && (
                  <div className="banner bad">
                    <b>Rejeitada pela SEFAZ:</b> {notaFiscal.motivo_rejeicao}
                  </div>
                )}

                {/* Resultado indeterminado (nota transmitida, veredito não confirmado
                    aqui) — visual e texto de propósito diferentes de uma rejeição: o
                    que resolve é conferir a chave na SEFAZ, não clicar de novo. */}
                {notaFiscal && STATUS_INDETERMINADO_UI.includes(notaFiscal.status) && (
                  <div className="banner bad">
                    <b>Situação desconhecida.</b> Esta nota foi transmitida à SEFAZ, mas o resultado não
                    ficou confirmado neste sistema. Antes de tentar de novo, confira a chave{' '}
                    {notaFiscal.chave || '(sem chave registrada)'} diretamente na SEFAZ (consulta de
                    protocolo) — emitir agora arrisca autorizar duas notas para o mesmo pedido.
                  </div>
                )}

                {emissaoIndeterminada ? (
                  <div className="banner bad">
                    <b>Situação desconhecida — não tente de novo sem conferir.</b> {erroEmissao}
                  </div>
                ) : erroEmissao && (
                  <div className="banner bad">{erroEmissao}</div>
                )}

                {pedido.status === 'Faturado' && notaFiscal?.status !== 'autorizado' && (
                  escolhendoNatureza ? (
                    <div style={{ marginTop: 8 }}>
                      <label>Natureza da operação</label>
                      <select value={naturezaEscolhida} onChange={e => setNaturezaEscolhida(e.target.value)} disabled={emitindoNota}>
                        <option value="">Selecione…</option>
                        {naturezas.map(n => <option key={n.id} value={n.id}>{n.descricao}</option>)}
                      </select>
                      {!naturezas.length && (
                        <p className="muted" style={{ fontSize: 12 }}>
                          Nenhuma natureza de operação de saída ativa para esta marca — cadastre em /fiscal/tributacao antes de emitir.
                        </p>
                      )}
                      <div className="row-actions" style={{ marginTop: 8 }}>
                        <button className="btn" onClick={emitir} disabled={emitindoNota || !naturezaEscolhida}>
                          {emitindoNota ? 'Emitindo…' : 'Confirmar emissão'}
                        </button>
                        <button className="btn secondary" disabled={emitindoNota}
                          onClick={() => { setEscolhendoNatureza(false); setErroEmissao(''); setEmissaoIndeterminada(false); }}>
                          Voltar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button className="btn" onClick={() => setEscolhendoNatureza(true)} disabled={emitindoNota}>
                      {rotuloBotaoEmitir(notaFiscal)}
                    </button>
                  )
                )}
              </>
            )}
          </div>
        )}

        {pedido.status === 'Cancelado' && (
          <div className="banner bad" style={{ marginTop: 12 }}>
            <b>Pedido cancelado</b> em {fmtDateTime(pedido.cancelado_em)}
            {pedido.cancelado_por?.nome ? ` por ${pedido.cancelado_por.nome}` : ''} — {pedido.cancelado_motivo}
          </div>
        )}

        {pedido.status !== 'Cancelado' && (
          cancelando ? (
            <div className="panel" style={{ marginTop: 12 }}>
              {erroCancelar && <div className="banner bad">Não foi possível cancelar o pedido: {erroCancelar}</div>}
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
                <button className="btn secondary" onClick={() => { setCancelando(false); setMotivo(''); setErroCancelar(''); }}>Voltar</button>
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
