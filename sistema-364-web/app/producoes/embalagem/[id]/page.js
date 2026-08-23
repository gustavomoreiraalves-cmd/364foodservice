'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '../../../../lib/supabase';
import { fmtDate } from '../../../../lib/format';
import { buscarPorIdsEmBlocos, CONSERVACOES } from '../../../../lib/producao';
import { saldoDefumado, validadeDoItem, itemEmbalagemValido } from '../../../../lib/embalagem';
import { inspecaoAprovada } from '../../../../lib/qualidade';
import AppShell from '../../../../components/AppShell';
import ProducaoTabs from '../../../../components/ProducaoTabs';
import { useEmpresaAtual } from '../../../../lib/empresa';

const STATUS_LABELS = {
  rascunho: 'Rascunho',
  finalizada: 'Finalizada',
  cancelada: 'Cancelada',
};

const STATUS_TAG = {
  rascunho: 'warn',
  finalizada: 'ok',
  cancelada: 'bad',
};

const ITEM_VAZIO = {
  recebimento_item_id: '',
  produto_id: '',
  // Não é coluna de `embalagem_itens` — só decide, no momento do lançamento,
  // qual das regras de `produto_regras_validade` alimenta `validadeDoItem`
  // quando o produto tem mais de uma permitida. Mesmo papel do `conservacao`
  // de app/producoes/nova/page.js, mas sem persistir: uma vez calculada e
  // gravada, a validade do item vive sozinha (ver validadeDoItem/adicionarItem).
  conservacao: '',
  quantidade: '',
  peso_total_kg: '',
};

// Seleção mínima para o cálculo de saldo (lib/embalagem.js: saldoDefumado):
// só o que aponta para o lote e o peso, mais o status da ficha-mãe (é ele que
// decide se o peso conta como disponível). `defumacoes!inner(status)`: item
// órfão (defumação apagada) não deveria existir com a FK em pé, mas o inner
// garante que, se existir, ele não entra na conta com status nulo — mesmo
// raciocínio de segurança da ficha de defumação.
const SELECT_ITENS_DEFUMADOS = 'id, recebimento_item_id, peso_final_kg, defumacoes!inner(status)';

// Mesma ideia do lado embalado: só entra na conta quando dá pra saber se
// aquela ficha de embalagem está cancelada (o único status que devolve peso
// ao lote — ver saldoDefumado).
const SELECT_ITENS_EMBALADOS = 'id, embalagem_id, recebimento_item_id, peso_total_kg, embalagens!inner(status)';

function cabecalhoDaFicha(f) {
  return {
    data: f.data || '',
    responsavel_id: f.responsavel_id || '',
    sobra_kg: f.sobra_kg != null ? String(f.sobra_kg) : '',
    obs: f.obs || '',
  };
}

function fmtKg(v) {
  return Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

function fmtUn(v) {
  return Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

// `peso_total_kg` é nulável (ficha legada, anterior a esta tela) — "0 kg"
// mentiria que o item já foi pesado. Mesma convenção de
// app/producoes/defumacao/[id]/page.js (fmtKgOuTraco).
function fmtKgOuTraco(v) {
  return v === null || v === undefined || v === '' ? '—' : `${fmtKg(v)} kg`;
}

// Soma `dias` (pode ser negativo) a uma data `AAAA-MM-DD`, sem depender de
// fuso — meio-dia local evita o dia anterior/seguinte por causa do horário
// de verão. Usada para DESLOCAR a validade já gravada de um item quando o
// cabeçalho da ficha é corrigido depois do lançamento (ver salvarCampo),
// preservando o prazo originalmente calculado sem precisar saber de novo
// qual regra gerou aquele prazo.
function somarDias(dataIso, dias) {
  if (!dataIso) return dataIso;
  const d = new Date(`${dataIso}T12:00:00`);
  if (isNaN(d)) return dataIso;
  d.setDate(d.getDate() + dias);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Diferença em dias inteiros entre duas datas `AAAA-MM-DD` (b - a).
function diasEntre(dataA, dataB) {
  if (!dataA || !dataB) return 0;
  const a = new Date(`${dataA}T12:00:00`);
  const b = new Date(`${dataB}T12:00:00`);
  if (isNaN(a) || isNaN(b)) return 0;
  return Math.round((b - a) / (24 * 3600 * 1000));
}

// error.message chega cru do Supabase — em inglês numa falha de rede, ou como
// o texto interno de uma policy do RLS. A frase em português vem na frente, o
// detalhe técnico fica em segundo plano. Mesmo padrão de
// app/producoes/defumacao/[id]/page.js.
function mensagemErro(prefixoPt, error) {
  return `${prefixoPt} (detalhe técnico: ${error?.message || 'erro desconhecido'})`;
}

// Só entra na lista de opções o lote que já teve ALGUMA defumação
// finalizada — não basta ter sido recebido. Sem este filtro o operador
// escolheria um lote que a defumação ainda nem começou, e o único aviso viria
// no botão de finalizar (a recusa nº 4 de fn_embalagem_gerar_producao,
// atualização 30): "lote sem rendimento de defumação finalizada".
function temDefumacaoFinalizada(loteId, itensDefumados) {
  return itensDefumados.some(i => i.recebimento_item_id === loteId && i.defumacoes?.status === 'finalizada');
}

export default function EmbalagemFichaPage() {
  return (
    <AppShell modulo="producoes" titulo="Ficha de Embalagem" desc="Cabeçalho, itens e validade prevista da ficha">
      <ProducaoTabs />
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const { id } = useParams();
  const router = useRouter();
  const { empresaAtual } = useEmpresaAtual();

  const [loading, setLoading] = useState(true);
  const [erroCarregar, setErroCarregar] = useState('');
  const [ficha, setFicha] = useState(null);
  const [naoEncontrada, setNaoEncontrada] = useState(false);

  const [cabecalho, setCabecalho] = useState(null);
  const [cabecalhoSalvo, setCabecalhoSalvo] = useState(null);
  const [salvandoCampo, setSalvandoCampo] = useState('');
  const [erroCampo, setErroCampo] = useState({});

  const [funcionarios, setFuncionarios] = useState([]);
  // Todos os produtos ativos da empresa — `rastreado` é "este produto só
  // entra no estoque pela ficha de embalagem" (Task 4), não "só produto
  // rastreado pode ser embalado": não há trava nenhuma nesse sentido no
  // banco, e filtrar por ele aqui deixaria a ficha inoperante no dia em que
  // a migração 30 subir (a coluna nasce `false` para todo produto já
  // cadastrado). Produtos rastreados aparecem primeiro na lista — ver
  // `produtosOrdenados`, abaixo do carregamento.
  const [produtos, setProdutos] = useState([]);
  const [regras, setRegras] = useState([]); // produto_regras_validade da empresa

  const [lotesDisponiveis, setLotesDisponiveis] = useState([]); // recebimento_itens da empresa, com joins
  const [itensJaDefumados, setItensJaDefumados] = useState([]); // defumacao_itens dos lotes exibidos — só para o saldo
  const [itensJaEmbalados, setItensJaEmbalados] = useState([]); // embalagem_itens dos lotes exibidos — só para o saldo
  // true quando algum bloco de buscarPorIdsEmBlocos (defumados OU embalados)
  // bateu no teto de 1000 linhas do Supabase — o saldo exibido pode estar
  // MAIOR que o real para algum lote.
  const [saldoPossivelmenteIncompleto, setSaldoPossivelmenteIncompleto] = useState(false);
  const [itensDaFicha, setItensDaFicha] = useState([]); // embalagem_itens desta ficha

  const [novoItem, setNovoItem] = useState(ITEM_VAZIO);
  const [erroItem, setErroItem] = useState('');
  const [salvandoItem, setSalvandoItem] = useState(false);
  const [removendoId, setRemovendoId] = useState('');
  const [erroRemover, setErroRemover] = useState('');
  // Marcado só quando o item ficaria SEM validade mesmo depois de tentar a
  // regra de conservação e o `validade_dias` do produto — exige confirmação
  // explícita antes de gravar, porque depois de finalizar a imutabilidade
  // impede corrigir (mesmo padrão do `confirmaSemPesoFinal` da ficha de
  // defumação).
  const [confirmaSemValidade, setConfirmaSemValidade] = useState(false);

  async function carregar() {
    if (!empresaAtual || !id) return;
    setLoading(true);
    setErroCarregar('');
    setNaoEncontrada(false);
    setSaldoPossivelmenteIncompleto(false);
    const eid = empresaAtual.id;

    // O filtro por empresa_id na ficha é o que impede alcançar ficha de outra
    // empresa adivinhando o uuid da URL — ela some da consulta e devolve
    // "não encontrada", sem revelar que o id existe.
    //
    // `funcionarios!embalagens_responsavel_id_fkey`: desde a atualização 30,
    // `embalagens` tem duas FKs para `funcionarios` (responsavel_id e
    // cancelada_por_id), então `funcionarios(nome)` sem qualificação devolveria
    // PGRST201. Mesmo caso resolvido em app/producoes/defumacao/[id]/page.js e
    // em app/producoes/embalagem/page.js.
    const [r1, r2, r3, r4, r5, r6] = await Promise.all([
      supabase.from('embalagens')
        .select('*, responsavel:funcionarios!embalagens_responsavel_id_fkey(nome)')
        .eq('id', id).eq('empresa_id', eid).maybeSingle(),
      supabase.from('funcionarios').select('id, nome, user_id').eq('empresa_id', eid).eq('ativo', true).order('nome'),
      // TODOS os produtos ativos — não só `rastreado` (ver comentário no
      // `useState` de `produtos`, acima). `validade_dias` entra na seleção
      // porque é o fallback de validade quando o produto não tem nenhuma
      // regra de conservação cadastrada (mesmo dado que
      // app/producoes/completa/page.js já usa).
      supabase.from('produtos').select('id, nome, codigo, unidade, rastreado, validade_dias').eq('empresa_id', eid).eq('ativo', true).order('nome'),
      supabase.from('produto_regras_validade').select('*').eq('empresa_id', eid).eq('ativo', true),
      // Lotes de matéria-prima recebidos por esta empresa — mesma consulta
      // (sem recorte de período) e mesmo `order` de topo por data de
      // recebimento que a ficha de defumação usa. Ver os comentários lá.
      supabase.from('recebimento_itens')
        .select('id, lote, quantidade, materia_prima_id, materias_primas(nome, unidade), recebimentos(data), inspecoes_qualidade(status)')
        .eq('empresa_id', eid)
        .order('recebimentos(data)', { ascending: false })
        .limit(1000),
      // Itens desta ficha específica, sem recorte de período.
      supabase.from('embalagem_itens')
        .select('id, embalagem_id, produto_id, recebimento_item_id, quantidade, peso_total_kg, validade, produtos(nome, codigo, unidade), recebimento_itens(lote)')
        .eq('empresa_id', eid).eq('embalagem_id', id)
        .order('id'),
    ]);

    // Falha de carga precisa aparecer como falha, não como "ficha não
    // encontrada" — achado real na Fase 1, repetido aqui de propósito.
    const falhaInicial = [r1, r2, r3, r4, r5, r6].find(r => r.error);
    if (falhaInicial) {
      setErroCarregar(falhaInicial.error.message);
      setLoading(false);
      return;
    }

    if (!r1.data) {
      setNaoEncontrada(true);
      setLoading(false);
      return;
    }

    // Itens de defumação e de embalagem para o SALDO dos lotes carregados
    // acima (r5) — não toda a empresa. O `.in(...)` precisa ir em blocos, não
    // numa lista só: ver buscarPorIdsEmBlocos, em lib/producao.js.
    const idsLotes = (r5.data || []).map(l => l.id);
    const [rDefumados, rEmbalados] = await Promise.all([
      buscarPorIdsEmBlocos(supabase, { tabela: 'defumacao_itens', coluna: 'recebimento_item_id', empresaId: eid, ids: idsLotes, selectStr: SELECT_ITENS_DEFUMADOS }),
      buscarPorIdsEmBlocos(supabase, { tabela: 'embalagem_itens', coluna: 'recebimento_item_id', empresaId: eid, ids: idsLotes, selectStr: SELECT_ITENS_EMBALADOS }),
    ]);

    if (rDefumados.error || rEmbalados.error) {
      setErroCarregar((rDefumados.error || rEmbalados.error).message);
      setLoading(false);
      return;
    }
    setSaldoPossivelmenteIncompleto(rDefumados.estourouTeto || rEmbalados.estourouTeto);

    setFicha(r1.data);
    const cab = cabecalhoDaFicha(r1.data);
    setCabecalho(cab);
    setCabecalhoSalvo(cab);
    setFuncionarios(r2.data || []);
    setProdutos(r3.data || []);
    setRegras(r4.data || []);
    setLotesDisponiveis(r5.data || []);
    setItensJaDefumados(rDefumados.data || []);
    setItensJaEmbalados(rEmbalados.data || []);
    setItensDaFicha(r6.data || []);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id, id]);

  const somenteLeitura = !ficha || ficha.status !== 'rascunho';

  // Best-effort, silencioso: usado depois de uma gravação de campo falhar,
  // para saber se a ficha mudou de status por baixo sem recarregar a página
  // inteira. Mesmo padrão de app/producoes/defumacao/[id]/page.js.
  async function relerStatusFicha() {
    if (!empresaAtual) return;
    const { data } = await supabase.from('embalagens')
      .select('status').eq('id', id).eq('empresa_id', empresaAtual.id).maybeSingle();
    if (data) setFicha(prev => (prev ? { ...prev, status: data.status } : prev));
  }

  // A data da ficha muda depois que itens já foram lançados (ex.: embalagem
  // feita no fim do turno anterior, corrigida só no dia seguinte) — sem
  // isso, os itens já lançados ficam com a validade calculada a partir da
  // data ERRADA, propagada por `fn_embalagem_gerar_producao` até a etiqueta,
  // sem como corrigir depois de finalizar (Important 2 da revisão).
  //
  // A correção DESLOCA a validade já gravada pelo mesmo número de dias que a
  // data moveu, em vez de recalcular do zero com a regra do produto: a
  // regra usada no lançamento (uma entre várias permitidas, ou o
  // `validade_dias` de fallback) não fica gravada no item — só o resultado
  // —, então não há como reconstruir qual delas valia. Deslocar preserva o
  // prazo originalmente escolhido, qualquer que ele tenha sido, sem precisar
  // saber de novo qual regra o gerou.
  async function atualizarValidadeItensAposMudarData(dataAntiga, dataNova) {
    const dias = diasEntre(dataAntiga, dataNova);
    if (!dias) return;
    const itensComValidade = itensDaFicha.filter(it => it.validade);
    if (!itensComValidade.length) return;

    const respostas = await Promise.all(itensComValidade.map(it => {
      const novaValidade = somarDias(it.validade, dias);
      return supabase.from('embalagem_itens')
        .update({ validade: novaValidade })
        .eq('id', it.id).eq('empresa_id', empresaAtual.id)
        .select('id, validade')
        .maybeSingle();
    }));

    setItensDaFicha(prev => prev.map(it => {
      const resp = respostas.find((r, idx) => itensComValidade[idx].id === it.id);
      return resp?.data ? { ...it, validade: resp.data.validade } : it;
    }));

    const falhou = respostas.find(r => r.error || !r.data);
    if (falhou) {
      // O cabeçalho já foi salvo (isto roda depois do sucesso do update de
      // `data`) — não dá para desfazer isso, só avisar que a validade de
      // algum item pode ter ficado desatualizada.
      setErroCampo(prev => ({ ...prev, data: 'A data foi salva, mas não foi possível atualizar a validade de todos os itens já lançados — confira a lista de itens antes de continuar.' }));
    }
  }

  async function salvarCampo(campo) {
    if (!ficha || !empresaAtual || ficha.status !== 'rascunho') return;
    const valor = cabecalho[campo];
    if (valor === cabecalhoSalvo[campo]) return; // nada mudou, não grava à toa

    setSalvandoCampo(campo);
    setErroCampo(prev => ({ ...prev, [campo]: '' }));
    // `sobra_kg` é `not null default 0` no banco — campo limpo vira 0, não
    // null (diferente de temperatura/pesos da ficha de defumação, que são
    // "ainda não medido"). "Sem sobra" É zero aqui, não "não informado".
    const valorGravar = campo === 'sobra_kg'
      ? Number(valor || 0)
      : (valor === '' ? null : valor);

    const { data, error } = await supabase.from('embalagens')
      .update({ [campo]: valorGravar })
      .eq('id', id).eq('empresa_id', empresaAtual.id)
      .select('id')
      .maybeSingle();

    setSalvandoCampo('');
    if (error) {
      // As travas da migração 30 levantam mensagem em português (ex.: ficha
      // finalizada por outra aba entre a carga e o blur) — mostra ela e relê
      // só o status real, em vez de insistir ou recarregar a ficha inteira.
      setErroCampo(prev => ({ ...prev, [campo]: mensagemErro('Não foi possível salvar este campo.', error) }));
      relerStatusFicha();
      return;
    }
    if (!data) {
      setErroCampo(prev => ({ ...prev, [campo]: 'Esta ficha não está mais disponível nesta empresa. Recarregue a página.' }));
      return;
    }
    if (campo === 'data' && cabecalhoSalvo.data) {
      await atualizarValidadeItensAposMudarData(cabecalhoSalvo.data, valor);
    }
    setCabecalhoSalvo(prev => ({ ...prev, [campo]: valor }));
  }

  // Lotes reprovados/pendentes na inspeção não aparecem (mesmo critério de
  // app/producoes/defumacao/[id]/page.js: inspecaoAprovada, lib/qualidade.js)
  // — na prática nenhum lote chega aqui sem inspeção aprovada, porque a
  // própria ficha de defumação já filtra por ela antes de aceitar o lote,
  // mas o filtro fica aqui também por segurança. Dos aprovados, só entra na
  // lista o que já teve defumação finalizada (temDefumacaoFinalizada) — os
  // demais nem aparecem, desabilitados ou não: escolhê-los não levaria a
  // lugar nenhum. Dentre esses, o que não tem saldo aparece desabilitado com
  // o motivo visível, não some.
  const opcoesLote = lotesDisponiveis
    .filter(inspecaoAprovada)
    .filter(l => temDefumacaoFinalizada(l.id, itensJaDefumados))
    .map(l => ({ ...l, saldo: saldoDefumado(l.id, itensJaDefumados, itensJaEmbalados) }))
    .sort((a, b) => String(a.lote).localeCompare(String(b.lote)));

  function labelLote(l) {
    const mp = l.materias_primas?.nome || '—';
    const disponibilidade = l.saldo > 0
      ? `${fmtKg(l.saldo)} kg defumados disponíveis`
      : 'sem saldo defumado disponível';
    return `${l.lote} · ${mp} · ${disponibilidade}`;
  }

  function regrasPermitidasDoProduto(produtoId) {
    return regras.filter(r => r.produto_id === produtoId && r.permitido);
  }

  // A regra de conservação que decide a validade deste produto —
  // `produto_regras_validade` permite até três por produto (ambiente/
  // resfriado/congelado; `unique (produto_id, conservacao)`), e mais de uma
  // permitida é cadastro NORMAL (ex.: um defumado a vácuo que aguenta tanto
  // resfriado quanto congelado), não uma exceção a tratar como "sem
  // validade". Uma única regra permitida é pré-selecionada sem exigir
  // escolha; mais de uma exige que o formulário informe `conservacao`
  // (seletor visível no form, mesmo padrão de app/producoes/nova/page.js) —
  // ver a checagem em `adicionarItem`, que bloqueia o envio sem ela em vez
  // de cair aqui sem escolha. Produto sem regra nenhuma cadastrada cai no
  // `validade_dias` do cadastro do produto — o mesmo dado que
  // app/producoes/completa/page.js usa —, para não entregar um resultado
  // pior do que a tela que esta ficha substitui.
  function regraParaItem(produto, conservacao) {
    if (!produto) return null;
    const permitidas = regrasPermitidasDoProduto(produto.id);
    if (permitidas.length === 1) return permitidas[0];
    if (permitidas.length > 1) return permitidas.find(r => r.conservacao === conservacao) || null;
    const dias = Number(produto.validade_dias);
    return dias > 0 ? { permitido: true, validade_valor: dias, validade_unidade: 'dias' } : null;
  }

  async function adicionarItem(e) {
    e.preventDefault();
    if (!empresaAtual || salvandoItem || somenteLeitura) return;
    setErroItem('');
    setErroRemover(''); // banner de remoção de uma ação anterior não fica preso na tela

    // Sem data não há o que calcular: validadeDoItem já devolve null nesse
    // caso, mas deixar passar em silêncio gravaria o item sem validade por
    // um motivo que nem aparece na tela. Trava aqui, antes de qualquer outra
    // checagem — Important 2 da revisão.
    if (!cabecalho.data) {
      setErroItem('Informe a data da embalagem antes de lançar itens — ela é usada para calcular a validade.');
      return;
    }

    const lote = opcoesLote.find(l => l.id === novoItem.recebimento_item_id);
    if (!lote) {
      setErroItem('Escolha o lote defumado que originou este produto.');
      return;
    }
    if (lote.saldo <= 0) {
      setErroItem('Este lote não tem saldo defumado disponível. Escolha outro.');
      return;
    }
    const produto = produtos.find(p => p.id === novoItem.produto_id);
    if (!produto) {
      setErroItem('Escolha o produto que está sendo embalado.');
      return;
    }

    const validacao = itemEmbalagemValido({ quantidade: novoItem.quantidade, peso_total_kg: novoItem.peso_total_kg });
    if (!validacao.ok) {
      setErroItem(validacao.erro);
      return;
    }

    // O peso final embalado não pode passar do saldo defumado do lote — mesma
    // regra da ficha de defumação (peso bruto x saldo do lote), adaptada:
    // aqui o que limita é o peso DEFUMADO restante, sempre em kg.
    if (Number(novoItem.peso_total_kg) > lote.saldo) {
      setErroItem(`O peso final informado (${fmtKg(novoItem.peso_total_kg)} kg) passa do saldo defumado do lote — restam ${fmtKg(lote.saldo)} kg.`);
      return;
    }

    // Mais de uma regra permitida para o produto exige que o operador
    // escolha a conservação no formulário — não há como a tela adivinhar
    // qual das regras vale (ver regraParaItem). Isto é diferente de "sem
    // validade": aqui existe uma resposta certa, só falta escolher.
    const permitidas = regrasPermitidasDoProduto(produto.id);
    if (permitidas.length > 1 && !novoItem.conservacao) {
      setErroItem('Escolha o tipo de conservação deste produto para calcular a validade.');
      return;
    }

    // Contrato da migração 30: a validade é calculada e GRAVADA aqui, ainda
    // em rascunho — a imutabilidade impede corrigir depois de finalizar, e o
    // trigger de finalização só propaga o que já está gravado no item, sem
    // calcular nada. Se o item for gravado sem validade, o produto acabado
    // nasce sem prazo.
    const regra = regraParaItem(produto, novoItem.conservacao);
    const validade = validadeDoItem(cabecalho.data, regra);

    // Só chega aqui sem validade quando o produto não tem regra nenhuma
    // cadastrada E o `validade_dias` do cadastro também está zerado/ausente
    // — não há mais nenhum dado para calcular a partir daí. É irreversível
    // depois de finalizar (imutabilidade), então exige confirmação
    // explícita em vez de gravar em silêncio.
    if (!validade && !confirmaSemValidade) {
      setErroItem('Este produto não tem regra de validade nem validade padrão cadastrada — marque a confirmação abaixo para gravar mesmo assim, sem validade.');
      return;
    }

    setSalvandoItem(true);
    const payload = {
      embalagem_id: id,
      empresa_id: empresaAtual.id,
      produto_id: produto.id,
      recebimento_item_id: lote.id,
      quantidade: Number(novoItem.quantidade),
      peso_total_kg: Number(novoItem.peso_total_kg),
      validade,
    };

    const { data, error } = await supabase.from('embalagem_itens')
      .insert([payload])
      .select('id, embalagem_id, produto_id, recebimento_item_id, quantidade, peso_total_kg, validade, produtos(nome, codigo, unidade), recebimento_itens(lote)')
      .single();

    setSalvandoItem(false);
    if (error) {
      setErroItem(mensagemErro('Não foi possível gravar o item.', error));
      return;
    }
    // adicionarItem só roda com !somenteLeitura, ou seja, ficha em rascunho —
    // por isso é seguro carimbar `embalagens: { status: 'rascunho' }` aqui em
    // vez de recarregar a ficha inteira: itensJaEmbalados (usado por
    // saldoDefumado) precisa do status da ficha-mãe para não deixar de
    // descontar o item recém-lançado do saldo do lote.
    setItensJaEmbalados(prev => [...prev, { ...data, embalagens: { status: 'rascunho' } }]);
    setItensDaFicha(prev => [...prev, data]);
    setNovoItem(ITEM_VAZIO);
    setConfirmaSemValidade(false);
  }

  async function removerItem(itemId) {
    if (!empresaAtual || somenteLeitura) return;
    setRemovendoId(itemId);
    setErroRemover('');
    setErroItem(''); // banner de gravação de item de uma ação anterior não fica preso na tela
    const { error } = await supabase.from('embalagem_itens')
      .delete()
      .eq('id', itemId).eq('empresa_id', empresaAtual.id);
    setRemovendoId('');
    if (error) {
      setErroRemover(mensagemErro('Não foi possível remover o item.', error));
      return;
    }
    setItensJaEmbalados(prev => prev.filter(i => i.id !== itemId));
    setItensDaFicha(prev => prev.filter(i => i.id !== itemId));
  }

  // O responsável gravado pode ter sido desativado depois — mesmo fallback
  // do <select> do cabeçalho na ficha de defumação (funcionarios só traz
  // ativo=true).
  function nomeResponsavel(fid) {
    if (!fid) return '—';
    const ativo = funcionarios.find(f => f.id === fid);
    if (ativo) return ativo.nome;
    if (fid === ficha.responsavel_id) return ficha.responsavel?.nome || 'Responsável desativado';
    return '—';
  }

  // Produtos rastreados primeiro (é o caso comum desta ficha), mas todos
  // aparecem — ver comentário no `useState` de `produtos`. `sort` estável do
  // V8 preserva a ordem alfabética (já vinda do `order('nome')` da consulta)
  // dentro de cada grupo.
  const produtosOrdenados = [...produtos].sort((a, b) => (b.rastreado ? 1 : 0) - (a.rastreado ? 1 : 0));

  const produtoNovoItem = produtos.find(p => p.id === novoItem.produto_id);
  const permitidasNovoItem = produtoNovoItem ? regrasPermitidasDoProduto(produtoNovoItem.id) : [];
  const precisaEscolherConservacao = permitidasNovoItem.length > 1;
  const regraAoVivo = produtoNovoItem ? regraParaItem(produtoNovoItem, novoItem.conservacao) : null;
  const validadeAoVivo = produtoNovoItem && cabecalho?.data ? validadeDoItem(cabecalho.data, regraAoVivo) : null;
  // Só pede confirmação quando NADA daria validade — nem regra de
  // conservação, nem o `validade_dias` do cadastro. Enquanto falta escolher
  // a conservação (produto com mais de uma regra permitida), o problema é
  // outro — a tela pede a escolha, não a confirmação de "sem validade".
  const precisaConfirmarSemValidade = !!(produtoNovoItem && cabecalho?.data && !precisaEscolherConservacao && !validadeAoVivo);

  const totalUnidades = itensDaFicha.reduce((s, i) => s + (Number(i.quantidade) || 0), 0);
  const totalPeso = itensDaFicha.reduce((s, i) => s + (Number(i.peso_total_kg) || 0), 0);

  if (loading) return <p className="muted">Carregando…</p>;

  if (erroCarregar) {
    return (
      <div className="banner bad">
        Não foi possível carregar a ficha de embalagem: {erroCarregar}{' '}
        <button className="btn secondary small" onClick={carregar}>Tentar novamente</button>
      </div>
    );
  }

  if (naoEncontrada) {
    return (
      <div className="banner info">
        Ficha de embalagem não encontrada nesta empresa.{' '}
        <button className="btn secondary small" onClick={() => router.push('/producoes/embalagem')}>Voltar para a lista</button>
      </div>
    );
  }

  return (
    <>
      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h3 style={{ margin: 0, border: 0, padding: 0 }}>Ficha {ficha.lote}</h3>
            <span className={`tag ${STATUS_TAG[ficha.status] || ''}`} style={{ marginTop: 6, display: 'inline-block' }}>
              {STATUS_LABELS[ficha.status] || ficha.status}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn secondary small" onClick={() => router.push('/producoes/embalagem')}>Voltar</button>
          </div>
        </div>

        {somenteLeitura && (
          <div className="banner info" style={{ marginTop: 14 }}>
            Esta ficha está {STATUS_LABELS[ficha.status]?.toLowerCase() || ficha.status} — cabeçalho e itens ficam em modo leitura.
          </div>
        )}

        {ficha.status === 'cancelada' && (
          <div className="banner bad" style={{ marginTop: 14 }}>
            <b>Ficha cancelada</b>{ficha.cancelada_motivo ? ` — ${ficha.cancelada_motivo}` : ''}
          </div>
        )}

        <div className="form-grid" style={{ marginTop: 14 }}>
          <div>
            <label>Data da embalagem</label>
            <input type="date" disabled={somenteLeitura} value={cabecalho.data}
              onChange={e => setCabecalho({ ...cabecalho, data: e.target.value })}
              onBlur={() => salvarCampo('data')} />
            {erroCampo.data && <p className="erro" style={{ fontSize: 11, marginTop: 4 }}>{erroCampo.data}</p>}
          </div>
          <div>
            <label>Responsável pela manipulação</label>
            <select disabled={somenteLeitura} value={cabecalho.responsavel_id}
              onChange={e => setCabecalho({ ...cabecalho, responsavel_id: e.target.value })}
              onBlur={() => salvarCampo('responsavel_id')}>
              <option value="">Selecione…</option>
              {cabecalho.responsavel_id && !funcionarios.some(f => f.id === cabecalho.responsavel_id) && (
                <option value={cabecalho.responsavel_id}>{ficha.responsavel?.nome || 'Responsável desativado'} (inativo)</option>
              )}
              {funcionarios.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
            {erroCampo.responsavel_id && <p className="erro" style={{ fontSize: 11, marginTop: 4 }}>{erroCampo.responsavel_id}</p>}
          </div>
          <div>
            <label>Sobra de material (kg)</label>
            <input type="number" inputMode="decimal" step="0.001" min="0" disabled={somenteLeitura} value={cabecalho.sobra_kg}
              onChange={e => setCabecalho({ ...cabecalho, sobra_kg: e.target.value })}
              onBlur={() => salvarCampo('sobra_kg')} />
            {erroCampo.sobra_kg && <p className="erro" style={{ fontSize: 11, marginTop: 4 }}>{erroCampo.sobra_kg}</p>}
          </div>
          <div>
            <label>Observações</label>
            <textarea rows={3} disabled={somenteLeitura} value={cabecalho.obs}
              onChange={e => setCabecalho({ ...cabecalho, obs: e.target.value })}
              onBlur={() => salvarCampo('obs')} />
            {erroCampo.obs && <p className="erro" style={{ fontSize: 11, marginTop: 4 }}>{erroCampo.obs}</p>}
          </div>
        </div>
        {salvandoCampo && <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>Salvando…</p>}
      </div>

      <div className="panel">
        <h3>Produtos embalados nesta ficha</h3>

        {saldoPossivelmenteIncompleto && (
          <div className="banner" style={{ marginTop: 10 }}>
            O volume de lançamentos de defumação ou de embalagem está grande demais para o cálculo de
            saldo conferir tudo de uma vez — o saldo mostrado abaixo pode estar MAIOR do que o real para
            algum lote. Fale com o suporte antes de confiar no saldo aqui.
          </div>
        )}

        {!somenteLeitura && !produtos.length && (
          <div className="banner info" style={{ marginTop: 10 }}>
            Nenhum produto ativo cadastrado nesta empresa. Cadastre em <b>Produtos</b> antes de lançar
            itens aqui.
          </div>
        )}

        {!somenteLeitura && (
          <form className="form-grid" onSubmit={adicionarItem}>
            <div>
              <label>Lote defumado</label>
              <select required value={novoItem.recebimento_item_id}
                onChange={e => setNovoItem({ ...novoItem, recebimento_item_id: e.target.value })}>
                <option value="">Selecione…</option>
                {opcoesLote.map(l => (
                  <option key={l.id} value={l.id} disabled={l.saldo <= 0}>{labelLote(l)}</option>
                ))}
              </select>
            </div>
            <div>
              <label>Produto</label>
              <select required value={novoItem.produto_id}
                onChange={e => setNovoItem({ ...novoItem, produto_id: e.target.value, conservacao: '' })}>
                <option value="">Selecione…</option>
                {produtosOrdenados.map(p => (
                  <option key={p.id} value={p.id}>{p.nome}{p.rastreado ? ' · rastreado' : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label>Quantidade embalada (un)</label>
              <input type="number" inputMode="numeric" step="1" min="1" required value={novoItem.quantidade}
                onChange={e => setNovoItem({ ...novoItem, quantidade: e.target.value })} />
            </div>
            <div>
              <label>Peso final (kg)</label>
              <input type="number" inputMode="decimal" step="0.001" required value={novoItem.peso_total_kg}
                onChange={e => setNovoItem({ ...novoItem, peso_total_kg: e.target.value })} />
            </div>
            <div><button className="btn secondary" type="submit" disabled={salvandoItem}>
              {salvandoItem ? 'Gravando…' : 'Adicionar item'}
            </button></div>
          </form>
        )}

        {/* Mais de uma regra permitida para o produto: o operador escolhe a
            conservação, mesmo padrão de app/producoes/nova/page.js (botão
            por conservação, com o prazo de cada uma já visível). Isto não é
            um caso de "sem validade" — existe uma resposta certa, falta só
            escolher. */}
        {!somenteLeitura && produtoNovoItem && precisaEscolherConservacao && (
          <div style={{ marginTop: 10 }}>
            <label>Tipo de conservação deste produto</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
              {CONSERVACOES.map(c => {
                const regraC = permitidasNovoItem.find(r => r.conservacao === c.id);
                const ativa = novoItem.conservacao === c.id;
                if (!regraC) return null; // só mostra as conservações realmente permitidas para este produto
                return (
                  <button key={c.id} type="button"
                    className={'btn small' + (ativa ? '' : ' secondary')}
                    onClick={() => setNovoItem({ ...novoItem, conservacao: c.id })}>
                    {c.label}
                    <span style={{ display: 'block', fontSize: 10.5, opacity: .8 }}>{regraC.validade_valor} {regraC.validade_unidade}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {!somenteLeitura && produtoNovoItem && (
          <p style={{ fontSize: 12.5, marginTop: 10 }}>
            {!cabecalho.data ? (
              <span className="muted">Informe a data da embalagem para calcular a validade.</span>
            ) : (
              <>
                Validade prevista: <b>{validadeAoVivo ? fmtDate(validadeAoVivo) : '—'}</b>
                {!validadeAoVivo && precisaEscolherConservacao && (
                  <span className="muted"> — escolha o tipo de conservação acima.</span>
                )}
                {!validadeAoVivo && !precisaEscolherConservacao && (
                  <span className="muted"> — este produto não tem regra de conservação nem validade padrão cadastrada; o item ficará sem validade.</span>
                )}
              </>
            )}
          </p>
        )}

        {!somenteLeitura && precisaConfirmarSemValidade && (
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 6, fontWeight: 400, fontSize: 12.5 }}>
            <input type="checkbox" checked={confirmaSemValidade}
              onChange={e => setConfirmaSemValidade(e.target.checked)}
              style={{ marginTop: 2 }} />
            <span>Estou ciente de que este item será gravado <b>sem validade</b> — depois de finalizar a ficha não será mais possível corrigir.</span>
          </label>
        )}

        {erroItem && <div className="banner bad" style={{ marginTop: 10 }}>{erroItem}</div>}
        {erroRemover && <div className="banner bad" style={{ marginTop: 10 }}>{erroRemover}</div>}

        <div className="items-list" style={{ marginTop: 10 }}>
          {itensDaFicha.length ? itensDaFicha.map(it => (
            <div className="item-line" key={it.id}>
              <span>
                {it.produtos?.nome || '—'}
                <span className="muted"> · lote {it.recebimento_itens?.lote || '—'}</span>
              </span>
              <span className="num">
                {fmtUn(it.quantidade)} un · {fmtKgOuTraco(it.peso_total_kg)}
              </span>
              <span className="num">
                Validade: {it.validade
                  ? fmtDate(it.validade)
                  : <span className="tag warn" title="Item sem validade calculada — confira o cadastro do produto">sem validade</span>}
              </span>
              {!somenteLeitura && (
                <button className="btn danger small" type="button"
                  disabled={removendoId === it.id}
                  onClick={() => removerItem(it.id)}>
                  {removendoId === it.id ? '…' : '×'}
                </button>
              )}
            </div>
          )) : <p className="muted" style={{ fontSize: 12 }}>Nenhum produto lançado ainda.</p>}
        </div>

        <div style={{ borderTop: '1px solid var(--border)', marginTop: 14, paddingTop: 10, display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 12.5 }}>
          <span>Unidades embaladas: <b>{fmtUn(totalUnidades)}</b></span>
          <span>Peso final total: <b>{fmtKg(totalPeso)} kg</b></span>
        </div>
      </div>
    </>
  );
}
