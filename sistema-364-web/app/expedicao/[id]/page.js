'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';
import AppShell from '../../../components/AppShell';
import { useEmpresaAtual } from '../../../lib/empresa';
import { sugerirAlocacao, empacotarCaixas, calcularDivergencia } from '../../../lib/expedicao';
import { medidasImpressao, urlRastreio } from '../../../lib/etiquetas';
import { fmtDate } from '../../../lib/format';
import { qrSvg } from '../../../lib/qr';
import EtiquetaDespachoPrint, { imprimirEtiquetaDespacho } from '../../../components/EtiquetaDespachoPrint';

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
  // Caixas já gravadas no banco (com id real de `expedicao_caixas` e os
  // produtos/lote de cada item) — só existe depois de `salvar()`. É o que a
  // etiqueta de despacho usa; `caixas` (linha abaixo, calculado a partir de
  // `alocacao`) não carrega id nenhum, só serve pra exibir a montagem.
  const [caixasSalvas, setCaixasSalvas] = useState([]);
  // Nome/S.I.M. da empresa atual — não vem em `empresaAtual` (lib/empresa.js
  // só seleciona id/nome/slug/prefixo/grupo/logo/empregador_id pro seletor
  // de empresas do topo, sem os dois campos do selo).
  const [empresaSim, setEmpresaSim] = useState(null);
  // Saldo por produto+embalagem (Task 1: vw_estoque_produto_lote agrupada
  // por embalagem, não mais por matéria-prima) — alimenta a sugestão FEFO
  // de um rascunho novo E as opções de lote da seção de alocação editável
  // (Task 4). Sem filtrar saldo>0 aqui: reabrindo um rascunho salvo, o
  // lote que ele já usa precisa aparecer mesmo com saldo zerado por si
  // mesmo (mesmo raciocínio que já existia pra não re-rodar sugerirAlocacao
  // num rascunho salvo, comentário abaixo).
  const [lotesPorProduto, setLotesPorProduto] = useState({});
  const [etiquetaDespacho, setEtiquetaDespacho] = useState(null);
  const [imprimindoCaixaId, setImprimindoCaixaId] = useState(null);
  const [erroEtiqueta, setErroEtiqueta] = useState('');
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
  // true quando uma falha em finalizar() pode ter deixado o romaneio
  // travado no servidor (já 'finalizado', ainda 'rascunho' aqui na tela) —
  // as três rotas exigem 'rascunho', então depois disso salvar/cancelar/
  // finalizar de novo só devolvem 400 e o usuário fica sem saída por aqui.
  const [emissaoTravada, setEmissaoTravada] = useState(false);

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

    const [{ data: itens }, { data: transp }, { data: nats }, { data: caixasSalvas }, { data: empresaLinha }] = await Promise.all([
      supabase.from('pedido_itens').select('*, produto:produtos(id, nome, rastreado)').eq('pedido_id', exp.pedido_id),
      supabase.from('transportadoras').select('*').eq('empresa_id', empresaAtual.id).eq('ativo', true).order('nome'),
      supabase.from('naturezas_operacao').select('id, descricao').eq('empresa_id', empresaAtual.id).eq('tipo_operacao', 'saida').eq('ativo', true),
      // produtos/embalagens aninhados só pra etiqueta de despacho — o resto
      // da tela (caixas calculadas a partir de `alocacao`, mais abaixo)
      // nunca usou esses campos e continua sem usar.
      supabase.from('expedicao_caixas')
        .select('*, expedicao_itens(*, produtos(codigo, nome, conservacao_texto), embalagens(lote, data))')
        .eq('expedicao_id', exp.id).order('numero'),
      // Nome e selo S.I.M. da empresa — `empresaAtual` (lib/empresa.js) não
      // traz `sim_numero`/`sim_municipio`, só o necessário pro seletor do
      // topo.
      supabase.from('empresas').select('nome, sim_numero, sim_municipio').eq('id', empresaAtual.id).maybeSingle(),
    ]);
    setPedidoItens(itens || []);
    setTransportadoras(transp || []);
    setNaturezas(nats || []);
    setCaixasSalvas(caixasSalvas || []);
    setEmpresaSim(empresaLinha || null);

    // Saldo por produto+embalagem (Task 1) dos produtos deste pedido — sem
    // filtro de saldo>0 na consulta (ver comentário do estado
    // lotesPorProduto, acima); o filtro pra sugestão de rascunho novo é
    // feito abaixo, em JS, só ali onde faz diferença.
    const produtoIds = [...new Set((itens || []).map(i => i.produto_id))];
    const { data: saldosLote } = produtoIds.length
      ? await supabase.from('vw_estoque_produto_lote').select('*').eq('empresa_id', empresaAtual.id).in('produto_id', produtoIds)
      : { data: [] };
    const porProduto = {};
    for (const l of saldosLote || []) {
      (porProduto[l.produto_id] ||= []).push({
        embalagemId: l.embalagem_id, lote: l.lote, fabricacao: l.fabricacao, validade: l.validade, saldo: Number(l.saldo),
      });
    }
    setLotesPorProduto(porProduto);

    // Reabrindo um rascunho que já foi salvo antes: usa a alocação que já
    // está gravada, não uma sugestão nova. `vw_estoque_produto_lote.saldo`
    // já desconta as PRÓPRIAS linhas deste rascunho (via total_expedido),
    // então rodar sugerirAlocacao de novo aqui leria esse lote como
    // consumido e degradaria a alocação rastreada pra "sem lote" em
    // silêncio — o total bateria (calcularDivergencia não vê problema), mas
    // a rastreabilidade do lote se perderia sem nenhum aviso.
    const itensSalvos = (caixasSalvas || []).flatMap(c => c.expedicao_itens || []);
    if (itensSalvos.length) {
      setAlocacao(itensSalvos.map(i => ({
        pedidoItemId: i.pedido_item_id, embalagemId: i.embalagem_id, quantidade: i.quantidade,
      })));
      return;
    }

    // Rascunho novo, sem nada salvo ainda — sugere a alocação FEFO a partir
    // do saldo de lote (vw_estoque_produto_lote, Task 1) dos produtos deste
    // pedido, só com saldo>0 (porProduto acima não filtra — ver comentário
    // do estado lotesPorProduto).
    const itensPedidoParaSugestao = (itens || []).map(i => ({
      pedidoItemId: i.id, produtoId: i.produto_id, quantidade: i.quantidade, rastreado: i.produto?.rastreado,
    }));
    const porProdutoComSaldo = Object.fromEntries(
      Object.entries(porProduto).map(([pid, lotes]) => [pid, lotes.filter(l => l.saldo > 0)])
    );
    setAlocacao(sugerirAlocacao(itensPedidoParaSugestao, porProdutoComSaldo));
  }

  const caixas = empacotarCaixas(alocacao, Object.fromEntries(pedidoItens.map(i => [i.id, i.produto_id])));
  // Nome do produto por pedidoItemId — a alocação/caixa só carrega ids
  // (pedidoItemId, embalagemId), e quem monta a caixa fisicamente
  // precisa ver o nome do produto, não um uuid de lote.
  const nomeProdutoPorPedidoItemId = Object.fromEntries(pedidoItens.map(i => [i.id, i.produto?.nome || i.produto_id]));

  // produto_id por pedidoItemId — usado pra buscar as opções de lote
  // (lotesPorProduto é indexado por produto_id) a partir de uma linha de
  // alocação, que só carrega pedidoItemId.
  const produtoIdPorPedidoItemId = Object.fromEntries(pedidoItens.map(i => [i.id, i.produto_id]));

  // Lote/fabricação por embalagem_id vindo do embed de `caixasSalvas`
  // (`expedicao_itens(*, embalagens(lote, data))`, carregado em carregar()) —
  // esse embed é um join simples por FK, sem o `status = 'finalizada'` que
  // `vw_estoque_produto_lote` exige. Serve de fallback quando uma embalagem
  // referenciada por um rascunho salvo some da view (status mudou depois da
  // alocação) — ver comentário de `opcoesLoteComExtras`, abaixo.
  const loteInfoPorEmbalagemId = Object.fromEntries(
    caixasSalvas.flatMap(c => (c.expedicao_itens || [])
      .filter(i => i.embalagem_id)
      .map(i => [i.embalagem_id, { lote: i.embalagens?.lote || null, fabricacao: i.embalagens?.data || null }]))
  );

  // Rótulo do lote pra exibição (código de embalagens.lote, não o uuid) —
  // usado tanto na seção de alocação quanto no resumo de "Caixas", abaixo.
  function labelLote(produtoId, embalagemId) {
    if (!embalagemId) return 'sem lote';
    const encontrado = (lotesPorProduto[produtoId] || []).find(l => l.embalagemId === embalagemId);
    if (encontrado) return encontrado.lote;
    return loteInfoPorEmbalagemId[embalagemId]?.lote || embalagemId;
  }

  // Opções do select de lote pra um item do pedido: a lista "viva" de
  // lotesPorProduto (Task 1, filtrada por status='finalizada' na view) mais
  // — achado 2 da revisão final — qualquer embalagemId já selecionado em uma
  // linha deste item que não esteja mais nessa lista (embalagem cancelada
  // depois que o rascunho já alocou contra ela). Mesmo padrão de
  // PedidoForm.js (`.filter(c => c.ativo !== false || c.id === ...)`) pra
  // não deixar o select em branco e a linha de "Caixas" caindo pro uuid cru.
  function opcoesLoteComExtras(opcoesLote, linhasItem) {
    const idsExistentes = new Set(opcoesLote.map(l => l.embalagemId));
    const extras = [];
    for (const linha of linhasItem) {
      if (linha.embalagemId && !idsExistentes.has(linha.embalagemId) && !extras.some(e => e.embalagemId === linha.embalagemId)) {
        const info = loteInfoPorEmbalagemId[linha.embalagemId];
        extras.push({
          embalagemId: linha.embalagemId,
          lote: `${info?.lote || linha.embalagemId} (lote removido?)`,
          validade: null,
          saldo: null,
        });
      }
    }
    return extras.length ? [...opcoesLote, ...extras] : opcoesLote;
  }

  function atualizarLinhaAlocacao(indice, campo, valor) {
    setAlocacao(alocacao.map((linha, i) => (i === indice ? { ...linha, [campo]: valor } : linha)));
  }

  function adicionarLinhaAlocacao(pedidoItemId) {
    setAlocacao([...alocacao, { pedidoItemId, embalagemId: null, quantidade: 0 }]);
  }

  function removerLinhaAlocacao(indice) {
    setAlocacao(alocacao.filter((_, i) => i !== indice));
  }

  // Imprime a etiqueta de despacho de UMA caixa — registra a impressão
  // ANTES de montar a etiqueta (mesma ordem de ModalEtiquetas.imprimir():
  // se `registrar_impressao` falhar, nada chega a `window.print()`). Cada
  // caixa tem seu próprio botão porque a etiqueta é "uma por caixa" (spec
  // de 20/08), não um lote de N cópias como recebimento/produção.
  //
  // `caixa` vem de `caixasSalvas` (linha do banco, com id real e
  // `expedicao_itens` já com produto/lote aninhados) — nunca do `caixas`
  // calculado acima, que não carrega id nenhum.
  async function imprimirEtiquetaCaixa(caixa) {
    if (imprimindoCaixaId) return; // trava de duplo clique, mesmo padrão de ModalEtiquetas.
    const itensCaixa = caixa.expedicao_itens || [];
    // QR por linha (não um só pro rótulo inteiro — ver EtiquetaDespachoPrint.js):
    // só as linhas com lote (produto rastreado) precisam de prefixo de
    // empresa pra montar a URL de rastreio sem ambiguidade entre empresas
    // (mesma checagem de app/recebimentos/page.js:abrirEtiquetas).
    const algumaLinhaTemLote = itensCaixa.some(i => i.embalagens?.lote);
    if (algumaLinhaTemLote && !empresaAtual?.prefixo_codigo) {
      setErroEtiqueta('Esta empresa não tem prefixo de código cadastrado. Cadastre o prefixo antes de imprimir '
        + 'etiquetas de despacho — sem ele o QR pode ficar ambíguo entre empresas.');
      return;
    }
    setImprimindoCaixaId(caixa.id);
    setErroEtiqueta('');
    try {
      const { error } = await supabase.rpc('registrar_impressao', {
        p_source_type: 'expedicao_caixa',
        p_source_id: caixa.id,
        p_tipo: 'original',
        p_quantidade: 1,
        p_modelo: 'despacho',
        p_impressora: null,
        p_motivo: null,
      });
      if (error) { setErroEtiqueta('Não foi possível registrar a impressão: ' + error.message); return; }

      // O QR é resolvido ANTES de window.print() (síncrono, não espera
      // promessa nenhuma) — mesma ordem de app/recebimentos/page.js. Se
      // falhar, a impressão em si não sai, mas o registro acima já foi
      // gravado (produção e impressão são independentes, spec de 20/08).
      const tamanhoQr = medidasImpressao('despacho').qrTamanho_mm;
      let produtos;
      try {
        produtos = await Promise.all(itensCaixa.map(async i => {
          const fv = (lotesPorProduto[i.produto_id] || []).find(l => l.embalagemId === i.embalagem_id) || {};
          const lote = i.embalagens?.lote || null;
          const qr = lote
            ? await qrSvg(urlRastreio(empresaAtual.prefixo_codigo, lote, process.env.NEXT_PUBLIC_SITE_URL), tamanhoQr)
            : null; // sem lote (não rastreado) — nada pra apontar, a linha sai sem QR.
          return {
            codigo: i.produtos?.codigo,
            nome: i.produtos?.nome,
            lote,
            quantidade: i.quantidade,
            fabricacao: i.embalagens?.data || fv.fabricacao,
            validade: fv.validade,
            qrSvg: qr,
          };
        }));
      } catch (e) {
        setErroEtiqueta('Não foi possível gerar o QR do lote: ' + e.message);
        return;
      }

      // Até 2 produtos distintos por caixa (regra de negócio 6) podem, em
      // tese, ter dizeres de conservação diferentes — a etiqueta nunca
      // esconde isso: mostra os dois, não só o primeiro.
      const conservacoes = [...new Set(itensCaixa.map(i => i.produtos?.conservacao_texto).filter(Boolean))];

      imprimirEtiquetaDespacho(setEtiquetaDespacho, {
        empresa: empresaSim?.nome || empresaAtual?.nome,
        simNumero: empresaSim?.sim_numero,
        simMunicipio: empresaSim?.sim_municipio,
        caixaNumero: caixa.numero,
        caixaTotal: caixasSalvas.length,
        romaneioNumero: expedicao?.numero,
        conservacao: conservacoes.join(' / '),
        produtos,
      });
    } finally {
      setImprimindoCaixaId(null);
    }
  }

  // Devolve true se salvou com sucesso — finalizar() depende disso pra não
  // seguir pra emissão com uma montagem de caixas que não bateu no servidor.
  async function salvar() {
    // NF-e recusa <veicTransp> com placa e sem UF — checagem barata antes de
    // gravar ou finalizar (regra 5 do achado I5 da revisão de 10/09).
    if (veiculoPlaca && !veiculoUf) { alert('Informe a UF do veículo.'); return false; }
    setSalvando(true);
    setErro('');
    try {
      const corpo = {
        transportadoraId: transportadoraId || null, modoFrete, veiculoPlaca: veiculoPlaca || null, veiculoUf: veiculoUf || null,
        caixas: caixas.map((itensCaixa, indice) => ({
          numero: indice + 1,
          pesoBrutoKg: null,
          itens: itensCaixa.map(i => ({ pedidoItemId: i.pedidoItemId, produtoId: pedidoItens.find(pi => pi.id === i.pedidoItemId)?.produto_id, embalagemId: i.embalagemId, quantidade: i.quantidade })),
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
    if (veiculoPlaca && !veiculoUf) { alert('Informe a UF do veículo.'); return; }
    const divs = calcularDivergencia(pedidoItens, alocacao);
    if (divs.length) { setDivergencias(divs); return; }
    setDivergencias([]);
    setFinalizando(true);
    setErro('');
    setEmissaoTravada(false);
    try {
      const salvou = await salvar();
      if (!salvou) return;
      let r, json;
      try {
        r = await fetch(`/api/expedicao/${id}/finalizar`, {
          method: 'POST', headers: await cabecalhoAuth(), body: JSON.stringify({ naturezaOperacaoId: naturezaEscolhida }),
        });
        json = await r.json();
      } catch {
        // Rede caiu, ou o gateway devolveu algo que não é JSON (ex.: 504 de
        // um SEFAZ lento — finalizar/route.js tem maxDuration 60). O
        // `finally` ainda reabilita os botões, mas sem isto o erro
        // desaparecia em silêncio (achado I1 da revisão de 10/09).
        setErro('Falha ao finalizar: não foi possível confirmar a resposta do servidor.');
        setEmissaoTravada(true);
        return;
      }
      if (!r.ok) {
        setErro(json.error || 'Falha ao finalizar.');
        if (json.divergencias) {
          // Divergência: nada foi travado no servidor (a checagem roda
          // antes do UPDATE que marca 'finalizado') — o usuário corrige as
          // caixas aqui mesmo, sem precisar sair da tela.
          setDivergencias(json.divergencias);
        } else {
          // Qualquer outra falha aqui (já finalizado por outra tentativa,
          // erro dentro de emitirNfe, etc.) — finalizar/route.js já marcou
          // 'finalizado' e o pedido 'Conferido' ANTES de chamar emitirNfe, e
          // não desfaz isso se a emissão falhar (regra 13 do spec de 25/08).
          // Esta tela exige 'rascunho' pra qualquer ação, então fica sem
          // saída sem o link abaixo (achado I2 da revisão de 10/09).
          setEmissaoTravada(true);
        }
        return;
      }
      router.push(`/pedidos/${expedicao.pedido_id}`);
    } finally {
      setFinalizando(false);
    }
  }

  if (!expedicao) return <p className="muted">Carregando…</p>;

  // Salvar/Cancelar/Finalizar exigem status 'rascunho' nas três rotas de API
  // — passado disso elas só devolvem 400. Um romaneio finalizado continua
  // acessível aqui (é daqui que se reimprime a etiqueta de despacho), então
  // esconde as ações que não funcionam mais em vez de deixá-las clicáveis
  // pra sempre falhar (achado I2 da revisão final de 10/09).
  const somenteLeitura = expedicao.status !== 'rascunho';

  return (
    <>
    <EtiquetaDespachoPrint etiqueta={etiquetaDespacho} />
    <section className="panel">
      <h3>Romaneio {expedicao.numero}</h3>
      {erro && <div className="banner erro">{erro}</div>}
      {emissaoTravada && (
        <div className="banner erro">
          <p>O romaneio pode já ter sido finalizado no servidor mesmo com esse erro — as ações desta tela deixam de funcionar depois disso.</p>
          <button className="btn secondary" onClick={() => router.push(`/pedidos/${expedicao.pedido_id}`)}>Ver o pedido para tentar novamente</button>
        </div>
      )}
      {!!divergencias.length && (
        <div className="banner erro">
          <p>O romaneio não cobre exatamente o pedido:</p>
          <ul>{divergencias.map(d => <li key={d.pedidoItemId}>item {d.pedidoItemId}: pedido {d.pedido}, alocado {d.alocado} (diferença {d.diferenca})</li>)}</ul>
        </div>
      )}

      <h4>Alocação por produto</h4>
      {pedidoItens.map(item => {
        const linhas = alocacao.map((a, idx) => ({ ...a, idx })).filter(a => a.pedidoItemId === item.id);
        const totalAlocado = linhas.reduce((s, a) => s + Number(a.quantidade || 0), 0);
        const totalPedido = Number(item.quantidade);
        const opcoesLote = lotesPorProduto[item.produto_id] || [];
        const opcoesLoteExibidas = opcoesLoteComExtras(opcoesLote, linhas);
        return (
          <div key={item.id} style={{ borderBottom: '1px solid var(--linha)', padding: '6px 0' }}>
            <strong>{item.produto?.nome}</strong> — pedido {totalPedido}, alocado {totalAlocado}
            {totalAlocado !== totalPedido && (
              <span className="tag warn" style={{ marginLeft: 8 }}>diferente do pedido</span>
            )}
            {linhas.map(a => {
              // Saldo real do lote selecionado (não a lista com extras
              // injetados de opcoesLoteComExtras — um lote "removido" tem
              // saldo null ali, e a quantidade digitada não deveria ser
              // comparada contra isso). Mesmo alerta de PedidoForm.js
              // (excedeSaldo/"acima do saldo") pro caso equivalente.
              const loteReal = a.embalagemId ? opcoesLote.find(l => l.embalagemId === a.embalagemId) : null;
              const acimaDoSaldo = !!loteReal && Number(a.quantidade || 0) > Number(loteReal.saldo);
              return (
                <div key={a.idx} className="row-actions" style={{ marginTop: 4 }}>
                  <select disabled={somenteLeitura} value={a.embalagemId || ''}
                    onChange={e => atualizarLinhaAlocacao(a.idx, 'embalagemId', e.target.value || null)}>
                    <option value="">Sem lote</option>
                    {opcoesLoteExibidas.map(l => (
                      <option key={l.embalagemId} value={l.embalagemId}>
                        {l.lote}{l.validade ? ` — val. ${fmtDate(l.validade)}` : ''}{l.saldo != null ? ` — saldo ${l.saldo}` : ''}
                      </option>
                    ))}
                  </select>
                  <input type="number" min="0" max={totalPedido} step="0.001" style={{ width: 90 }} disabled={somenteLeitura}
                    value={a.quantidade}
                    onChange={e => atualizarLinhaAlocacao(a.idx, 'quantidade', Number(e.target.value))} />
                  {acimaDoSaldo && <span className="tag warn">acima do saldo</span>}
                  {!somenteLeitura && (
                    <button className="btn danger small" type="button" onClick={() => removerLinhaAlocacao(a.idx)}>×</button>
                  )}
                </div>
              );
            })}
            {!somenteLeitura && (
              <button className="btn secondary small" type="button" style={{ marginTop: 4 }}
                onClick={() => adicionarLinhaAlocacao(item.id)}>
                + lote
              </button>
            )}
          </div>
        );
      })}

      <h4>Caixas ({caixas.length})</h4>
      {caixas.map((itensCaixa, i) => (
        <div key={i} className="row-actions" style={{ borderBottom: '1px solid var(--linha)', padding: '4px 0' }}>
          <strong>Caixa {i + 1}</strong> — {itensCaixa.reduce((s, it) => s + it.quantidade, 0)} un.
          {itensCaixa.map((it, j) => (
            <span key={j} className="tag"> {nomeProdutoPorPedidoItemId[it.pedidoItemId] || '?'} — lote {labelLote(produtoIdPorPedidoItemId[it.pedidoItemId], it.embalagemId)} × {it.quantidade}</span>
          ))}
        </div>
      ))}

      {/* Só depois de finalizado: a etiqueta é gerada a partir da caixa já
          gravada em `expedicao_caixas` (com id real), que só existe depois
          de finalizar() ⇒ salvar() (Task 20). */}
      {expedicao.status === 'finalizado' && !!caixasSalvas.length && (
        <>
          <h4>Etiquetas de despacho</h4>
          {erroEtiqueta && <div className="banner erro">{erroEtiqueta}</div>}
          {caixasSalvas.map(c => (
            <div key={c.id} className="row-actions" style={{ justifyContent: 'space-between', borderBottom: '1px solid var(--linha)', padding: '4px 0' }}>
              <span>Caixa {c.numero}</span>
              <button
                className="btn secondary small"
                onClick={() => imprimirEtiquetaCaixa(c)}
                disabled={imprimindoCaixaId === c.id}
              >
                {imprimindoCaixaId === c.id ? 'Imprimindo…' : 'Imprimir etiqueta de despacho'}
              </button>
            </div>
          ))}
        </>
      )}

      <h4>Transporte</h4>
      <label>Transportadora</label>
      <select value={transportadoraId} onChange={e => setTransportadoraId(e.target.value)} disabled={somenteLeitura}>
        <option value="">Nenhuma (retirada / frota própria)</option>
        {transportadoras.map(t => <option key={t.id} value={t.id}>{t.nome_fantasia || t.nome}</option>)}
      </select>
      <label>Modo de frete</label>
      <select value={modoFrete} onChange={e => setModoFrete(e.target.value)} disabled={somenteLeitura}>
        <option value="0">Contratação por conta do remetente (CIF)</option>
        <option value="1">Contratação por conta do destinatário (FOB)</option>
        <option value="9">Sem frete (retirada)</option>
      </select>
      <div className="row-actions">
        <div><label>Placa do veículo</label><input value={veiculoPlaca} onChange={e => setVeiculoPlaca(e.target.value.toUpperCase())} disabled={somenteLeitura} /></div>
        <div><label>UF do veículo</label><input maxLength={2} value={veiculoUf} onChange={e => setVeiculoUf(e.target.value.toUpperCase())} disabled={somenteLeitura} /></div>
      </div>

      {somenteLeitura ? (
        <div className="row-actions" style={{ marginTop: 12, alignItems: 'center' }}>
          <span>Romaneio <strong>{expedicao.status}</strong> — salvar, cancelar e finalizar só valem para rascunho.</span>
          <button className="btn secondary" onClick={() => router.push(`/pedidos/${expedicao.pedido_id}`)}>Ver o pedido</button>
        </div>
      ) : (
        <>
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
        </>
      )}
    </section>
    </>
  );
}
