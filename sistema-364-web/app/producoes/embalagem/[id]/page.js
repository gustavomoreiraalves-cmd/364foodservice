'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '../../../../lib/supabase';
import { fmtDate } from '../../../../lib/format';
import { buscarPorIdsEmBlocos, CONSERVACOES, fmtDateTime } from '../../../../lib/producao';
import { saldoDefumado, validadeDoItem, itemEmbalagemValido, STATUS_LABELS, STATUS_TAG } from '../../../../lib/embalagem';
import { inspecaoAprovada } from '../../../../lib/qualidade';
import { useAuth } from '../../../../lib/auth';
import { qrSvg } from '../../../../lib/qr';
import { urlRastreio, medidasImpressao } from '../../../../lib/etiquetas';
import AppShell from '../../../../components/AppShell';
import ProducaoTabs from '../../../../components/ProducaoTabs';
import FichaPrint, { imprimirFicha } from '../../../../components/FichaPrint';
import EtiquetaPrint from '../../../../components/EtiquetaPrint';
import ModalEtiquetas from '../../../../components/ModalEtiquetas';
import { useEmpresaAtual } from '../../../../lib/empresa';

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

// Cada uuid custa ~39 caracteres no query string do `.in(...)` — busca em
// blocos para não depender de quantos itens esta ficha tem. Filtrada por
// `source_type = 'embalagem_item'` (não usa buscarPorIdsEmBlocos, de
// lib/producao.js: aquele helper não aceita um filtro extra de coluna, e sem
// o filtro de source_type um uuid de outra tabela que por acaso colidisse com
// um id de embalagem_item entraria na conta). Mesmo padrão de
// app/recebimentos/page.js (carregarImpressoesDosItens) e de
// app/producoes/completa/page.js (`impressoes.some(...)`) — os dois defeitos
// reais da Fase 1 que a Task 6 fecha aqui: reimpressão gravada como
// "original" sem motivo, e falha de carga tratada como "nada impresso ainda".
const BLOCO_IDS_IMPRESSOES = 100;

async function carregarImpressoesDosItens(empresaId, ids) {
  if (!ids.length) return { data: [], error: null };
  const blocos = [];
  for (let i = 0; i < ids.length; i += BLOCO_IDS_IMPRESSOES) blocos.push(ids.slice(i, i + BLOCO_IDS_IMPRESSOES));
  const respostas = await Promise.all(blocos.map(bloco =>
    supabase.from('etiqueta_impressoes')
      .select('source_id, quantidade')
      .eq('empresa_id', empresaId)
      .eq('source_type', 'embalagem_item')
      .in('source_id', bloco)
  ));
  const comErro = respostas.find(r => r.error);
  if (comErro) return { data: [], error: comErro.error };
  return { data: respostas.flatMap(r => r.data || []), error: null };
}

export default function EmbalagemFichaPage() {
  // FichaPrint (A4) e EtiquetaPrint (108×32mm) SEMPRE montados os dois, mas
  // nunca com dado nos dois ao mesmo tempo: cada `imprimir*` só preenche o
  // próprio estado, e o `afterprint` de cada um zera o próprio depois — mesmo
  // desenho de app/recebimentos/page.js, a tela que primeiro precisou dos
  // dois convivendo. Sem isso, o `@page` de 108×32mm de EtiquetaPrint
  // contaminaria a impressão A4 da ficha (e vice-versa) enquanto o outro
  // estado ficasse preenchido.
  const [fichaImpressao, setFichaImpressao] = useState(null);
  const [etiqueta, setEtiqueta] = useState(null);
  return (
    <>
      <AppShell modulo="producoes" titulo="Ficha de Embalagem" desc="Cabeçalho, itens e validade prevista da ficha">
        <ProducaoTabs />
        <Conteudo setFichaImpressao={setFichaImpressao} setEtiqueta={setEtiqueta} />
      </AppShell>
      <FichaPrint ficha={fichaImpressao} />
      <EtiquetaPrint etiqueta={etiqueta} />
    </>
  );
}

function Conteudo({ setFichaImpressao, setEtiqueta }) {
  const { id } = useParams();
  const router = useRouter();
  const { empresaAtual } = useEmpresaAtual();
  const { session } = useAuth();

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

  const [finalizando, setFinalizando] = useState(false);
  const [salvandoFinalizar, setSalvandoFinalizar] = useState(false);
  const [erroFinalizar, setErroFinalizar] = useState('');
  // Marcado só quando algum item ficaria sem validade mesmo na hora de
  // finalizar — o item pode ter sido lançado assim de propósito (com
  // `confirmaSemValidade` marcado lá no formulário do item). Este é o
  // segundo — e último — portão antes da imutabilidade: mesmo padrão do
  // `confirmaSemPesoFinal` da ficha de defumação.
  const [confirmaSemValidadeFinalizar, setConfirmaSemValidadeFinalizar] = useState(false);
  // Mesmo papel de `confirmaSemValidadeFinalizar`, para o responsável pela
  // manipulação (achado da revisão final: `finalizar()` não exigia esse
  // campo). É o campo do registro sanitário na ficha de papel — sai "—" na
  // ficha impressa — e `producoes.responsavel_id` herda o que estiver aqui;
  // depois de finalizar a imutabilidade do cabeçalho impede preencher depois.
  const [confirmaSemResponsavelFinalizar, setConfirmaSemResponsavelFinalizar] = useState(false);

  const [cancelando, setCancelando] = useState(false);
  const [motivoCancelamento, setMotivoCancelamento] = useState('');
  const [salvandoCancelar, setSalvandoCancelar] = useState(false);
  const [erroCancelar, setErroCancelar] = useState('');

  // Histórico de etiqueta_impressoes dos itens desta ficha — decide se o
  // botão de um item mostra "Imprimir etiquetas" ou "Reimprimir etiquetas".
  // `erroImpressoes` true desabilita a impressão em vez de assumir "nada
  // impresso ainda": mesmo padrão de app/recebimentos/page.js.
  const [impressoesItens, setImpressoesItens] = useState([]);
  const [erroImpressoes, setErroImpressoes] = useState(false);
  // { tipo, item, dados } do item cuja modal de etiquetas está aberta — dados
  // já vem com o QR resolvido (ver abrirEtiquetasItem).
  const [etiquetaItem, setEtiquetaItem] = useState(null);

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
    // `funcionarios!embalagens_responsavel_id_fkey` / `..._cancelada_por_id_fkey`:
    // desde a atualização 30, `embalagens` tem duas FKs para `funcionarios`
    // (responsavel_id e cancelada_por_id), então `funcionarios(nome)` sem
    // qualificação devolveria PGRST201. Mesmo caso resolvido em
    // app/producoes/defumacao/[id]/page.js e em app/producoes/embalagem/page.js.
    // `cancelada_por` entra para a ficha impressa e o banner de cancelamento
    // mostrarem quem cancelou, não só o motivo.
    const [r1, r2, r3, r4, r5, r6] = await Promise.all([
      supabase.from('embalagens')
        .select('*, responsavel:funcionarios!embalagens_responsavel_id_fkey(nome), cancelada_por:funcionarios!embalagens_cancelada_por_id_fkey(nome)')
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

    // Histórico de impressão dos ITENS desta ficha (não da empresa toda) —
    // decide "Imprimir etiquetas" x "Reimprimir etiquetas" por item. Falha de
    // carga desabilita a impressão em vez de assumir "nada impresso ainda"
    // (ver `erroImpressoes` acima).
    const idsItens = (r6.data || []).map(i => i.id);
    const rImpressoes = await carregarImpressoesDosItens(eid, idsItens);
    if (rImpressoes.error) {
      setErroImpressoes(true);
      setImpressoesItens([]);
    } else {
      setErroImpressoes(false);
      setImpressoesItens(rImpressoes.data);
    }

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

  // TODAS as regras cadastradas do produto, permitidas ou não — usada só para
  // diferenciar "nenhuma regra cadastrada" (cai no validade_dias) de
  // "nenhuma regra PERMITIDA" (as conservações cadastradas foram todas
  // proibidas — não cai em lugar nenhum, ver regraParaItem).
  function regrasDoProduto(produtoId) {
    return regras.filter(r => r.produto_id === produtoId);
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
  //
  // "Nenhuma regra permitida" só cai nesse fallback quando o produto também
  // não tem NENHUMA regra cadastrada — achado da revisão da Task 5: o código
  // tratava "as três conservações explicitamente proibidas" (permitidas.length
  // === 0 com regras cadastradas) igual a "nada cadastrado", calculando
  // validade por um caminho que a empresa vetou. app/producoes/nova/page.js:
  // 111-113 já recusa esse caso com "não possui conservação autorizada" em vez
  // de calcular — `adicionarItem`, abaixo, faz o mesmo aqui.
  function regraParaItem(produto, conservacao) {
    if (!produto) return null;
    const permitidas = regrasPermitidasDoProduto(produto.id);
    if (permitidas.length === 1) return permitidas[0];
    if (permitidas.length > 1) return permitidas.find(r => r.conservacao === conservacao) || null;
    if (regrasDoProduto(produto.id).length > 0) return null; // proibido, não "sem dado"
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
    //
    // O lançamento usa `cabecalhoSalvo.data` (não `cabecalho.data`, o estado
    // do formulário) e recusa enquanto os dois divergirem: achado da revisão
    // da Task 5. Se um `salvarCampo('data')` falhar (rede caiu no meio do
    // blur), `cabecalho.data` fica com o valor digitado e `cabecalhoSalvo.data`
    // com o que está gravado de fato. Lançar com `cabecalho.data` nesse
    // intervalo grava o item com prazo calculado a partir de uma data que a
    // ficha não tem — e se o operador tentar de novo e a gravação for bem
    // (`atualizarValidadeItensAposMudarData`), o DESLOCAMENTO aplica por cima
    // do item que já nasceu com a data nova, dobrando o erro.
    if (!cabecalhoSalvo.data) {
      setErroItem('Informe e salve a data da embalagem antes de lançar itens — ela é usada para calcular a validade.');
      return;
    }
    if (cabecalho.data !== cabecalhoSalvo.data) {
      setErroItem('A data da embalagem foi alterada nesta tela mas ainda não foi salva (ou a última gravação falhou) — corrija ou aguarde a gravação antes de lançar itens, para não calcular a validade com a data errada.');
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

    // Produto com regra(s) cadastrada(s) mas NENHUMA permitida (as três
    // conservações explicitamente proibidas) não tem resposta possível — não
    // é "sem validade" (que a tela aceita com confirmação), é recusa, mesmo
    // padrão de app/producoes/nova/page.js:111-113.
    const permitidas = regrasPermitidasDoProduto(produto.id);
    if (!permitidas.length && regrasDoProduto(produto.id).length > 0) {
      setErroItem(`O produto "${produto.nome}" não possui conservação autorizada para produção — não pode ser embalado. Ajuste as regras de conservação em Produtos.`);
      return;
    }

    // Mais de uma regra permitida para o produto exige que o operador
    // escolha a conservação no formulário — não há como a tela adivinhar
    // qual das regras vale (ver regraParaItem). Isto é diferente de "sem
    // validade": aqui existe uma resposta certa, só falta escolher.
    if (permitidas.length > 1 && !novoItem.conservacao) {
      setErroItem('Escolha o tipo de conservação deste produto para calcular a validade.');
      return;
    }

    // Contrato da migração 30: a validade é calculada e GRAVADA aqui, ainda
    // em rascunho — a imutabilidade impede corrigir depois de finalizar, e o
    // trigger de finalização só propaga o que já está gravado no item, sem
    // calcular nada. Se o item for gravado sem validade, o produto acabado
    // nasce sem prazo. `cabecalhoSalvo.data`, não `cabecalho.data` — ver o
    // comentário no início desta função.
    const regra = regraParaItem(produto, novoItem.conservacao);
    const validade = validadeDoItem(cabecalhoSalvo.data, regra);

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

  // Quem finaliza/cancela é o usuário logado — não necessariamente o
  // responsável pela manipulação gravado no cabeçalho. Mesmo padrão de
  // app/producoes/nova/page.js (meuFuncionario) e de
  // app/producoes/defumacao/[id]/page.js (cancelada_por_id).
  const meuFuncionario = funcionarios.find(f => f.user_id === session?.user?.id);

  // Só envia os campos que mudam: reenviar o cabeçalho inteiro esbarraria nas
  // travas de imutabilidade de fn_embalagem_cabecalho assim que a ficha sair
  // de rascunho — o trigger recusa qualquer um desses campos "mudando" mesmo
  // que o valor enviado seja igual ao que já está gravado, porque o
  // `is distinct from` roda sobre o payload inteiro do update. A validade dos
  // itens já foi calculada e gravada no momento do lançamento
  // (`adicionarItem`) — não há nada para recalcular aqui, o trigger da
  // migração 30 só propaga o que o item já tem.
  async function finalizar() {
    if (!ficha || !empresaAtual || ficha.status !== 'rascunho') return;
    // Guarda de tela espelhando o aviso do painel de confirmação — o botão
    // já fica desabilitado sem a caixa marcada, isto é o cinto e suspensório
    // contra clique disparado por outro caminho.
    if (itensSemValidade.length > 0 && !confirmaSemValidadeFinalizar) return;
    if (semResponsavel && !confirmaSemResponsavelFinalizar) return;
    setSalvandoFinalizar(true);
    setErroFinalizar('');
    const { data, error } = await supabase.from('embalagens')
      .update({ status: 'finalizada' })
      .eq('id', id).eq('empresa_id', empresaAtual.id)
      .select('id')
      .maybeSingle();
    setSalvandoFinalizar(false);
    if (error) {
      // As quatro recusas de fn_embalagem_gerar_producao (item sem lote, item
      // sem peso, lote reprovado, lote sem rendimento de defumação
      // finalizada) e qualquer corrida com outra aba chegam aqui em
      // português. Mostra a mensagem e relê o status real em vez de insistir
      // — a ficha pode ter sido finalizada ou cancelada por outra aba entre a
      // carga e o clique.
      setErroFinalizar(mensagemErro('Não foi possível finalizar a ficha.', error));
      relerStatusFicha();
      return;
    }
    if (!data) {
      setErroFinalizar('Esta ficha não está mais disponível nesta empresa. Recarregue a página.');
      return;
    }
    setFinalizando(false);
    setErroFinalizar('');
    setConfirmaSemValidadeFinalizar(false);
    await carregar();
  }

  async function cancelar() {
    // Mesma trava de finalizar(): sem ela, uma corrida onde outra aba já
    // cancelou a ficha passaria por todas as travas do banco (o `update`
    // continua válido, só troca motivo/por_id de um cancelamento que já
    // aconteceu) e sobrescreveria o cancelamento original em silêncio.
    if (!ficha || !empresaAtual || !motivoCancelamento.trim() || ficha.status === 'cancelada') return;
    setSalvandoCancelar(true);
    setErroCancelar('');
    // `cancelada_em` não vai daqui: quem carimba é o trigger
    // fn_embalagem_cabecalho, com o relógio do banco — o relógio do
    // navegador pode estar em qualquer hora.
    const { data, error } = await supabase.from('embalagens')
      .update({
        status: 'cancelada',
        cancelada_motivo: motivoCancelamento.trim(),
        cancelada_por_id: meuFuncionario?.id || null,
      })
      .eq('id', id).eq('empresa_id', empresaAtual.id)
      .select('id')
      .maybeSingle();
    setSalvandoCancelar(false);
    if (error) {
      setErroCancelar(mensagemErro('Não foi possível cancelar a ficha.', error));
      relerStatusFicha();
      return;
    }
    if (!data) {
      setErroCancelar('Esta ficha não está mais disponível nesta empresa. Recarregue a página.');
      return;
    }
    setCancelando(false);
    setMotivoCancelamento('');
    setErroCancelar('');
    await carregar();
  }

  // Só monta FichaPrint/EtiquetaPrint no componente pai (EmbalagemFichaPage),
  // nunca aqui. Os campos vêm do estado AO VIVO (`cabecalho`), não de `ficha`:
  // `ficha` só é atualizado inteiro em carregar() e por relerStatusFicha()
  // (que só relê `status`), enquanto a gravação campo a campo por blur
  // (salvarCampo) atualiza `cabecalho`/`cabecalhoSalvo`. Numa ficha impressa
  // antes de finalizar com `ficha` desatualizado, a ficha impressa saía em
  // branco — defeito real da Fase 2 que esta tela evita do mesmo jeito.
  function imprimir() {
    const campos = [
      { rot: 'Data da embalagem', valor: fmtDate(cabecalho.data) },
      { rot: 'Responsável pela manipulação', valor: nomeResponsavel(cabecalho.responsavel_id) },
      { rot: 'Sobra de material', valor: cabecalho.sobra_kg ? `${fmtKg(cabecalho.sobra_kg)} kg` : '—' },
      { rot: 'Status', valor: STATUS_LABELS[ficha.status] || ficha.status },
      { rot: 'Observações', valor: cabecalho.obs },
    ];
    // Ficha cancelada impressa precisa levar o porquê — papel arquivado sem
    // motivo, data e quem cancelou não serve de registro. Mesmo padrão de
    // app/producoes/defumacao/[id]/page.js.
    if (ficha.status === 'cancelada') {
      campos.push(
        { rot: 'Cancelada em', valor: fmtDateTime(ficha.cancelada_em) },
        { rot: 'Cancelada por', valor: ficha.cancelada_por?.nome || '—' },
        { rot: 'Motivo do cancelamento', valor: ficha.cancelada_motivo },
      );
    }
    imprimirFicha(setFichaImpressao, {
      titulo: 'Ficha de Embalagem',
      numero: ficha.lote,
      campos,
      itens: {
        headers: ['Lote', 'Produto', 'Quantidade', 'Peso', 'Validade'],
        rows: itensDaFicha.map(it => [
          it.recebimento_itens?.lote || '—',
          it.produtos?.nome || '—',
          `${fmtUn(it.quantidade)} un`,
          fmtKgOuTraco(it.peso_total_kg),
          it.validade ? fmtDate(it.validade) : 'sem validade',
        ]),
      },
      totais: `Unidades embaladas: ${fmtUn(totalUnidades)} · Peso final total: ${fmtKg(totalPeso)} kg`,
      assinaturas: ['Responsável pela embalagem', 'Conferido por'],
    });
  }

  // Deriva o tipo de impressão do histórico em vez de um botão fixo por tipo
  // — mesmo padrão de app/recebimentos/page.js e app/producoes/completa/page.js.
  function jaImprimiuItem(it) {
    return impressoesItens.some(i => i.source_id === it.id);
  }

  // O QR é resolvido ANTES de abrir o modal: window.print() é síncrono e não
  // espera promessa nenhuma. O conteúdo é o rastreio do LOTE DA FICHA
  // (embalagens.lote, ex. EMB-260822-001) — é ele que identifica o evento de
  // embalagem que originou esta unidade, não o lote de matéria-prima que
  // entrou (esse já não cabe numa etiqueta por unidade de produto acabado, e
  // a mesma ficha pode ter consumido mais de um lote de origem).
  async function abrirEtiquetasItem(it, tipo) {
    if (!empresaAtual?.prefixo_codigo) {
      alert('Esta empresa não tem prefixo de código cadastrado. Cadastre o prefixo antes de imprimir '
        + 'etiquetas de produção — sem ele o QR pode ficar ambíguo entre empresas.');
      return;
    }
    try {
      const tamanhoQr = medidasImpressao('producao-lote').qrTamanho_mm;
      const svg = await qrSvg(
        urlRastreio(empresaAtual.prefixo_codigo, ficha.lote, process.env.NEXT_PUBLIC_SITE_URL),
        tamanhoQr,
      );
      setEtiquetaItem({
        tipo,
        item: it,
        dados: {
          modelo: 'producao-lote',
          produto: it.produtos?.nome || '—',
          lote: ficha.lote,
          fabricacao: ficha.data,
          validade: it.validade,
          qrSvg: svg,
          // Sugestão inicial = quantidade embalada deste item: 50 unidades
          // embaladas sugerem 50 etiquetas — o operador ainda pode ajustar no
          // modal (ex.: reimpressão avulsa de poucas etiquetas perdidas).
          copias: Number(it.quantidade) || 1,
        },
      });
    } catch (e) {
      alert('Não foi possível gerar o QR do lote: ' + e.message);
    }
  }

  // Produtos rastreados primeiro (é o caso comum desta ficha), mas todos
  // aparecem — ver comentário no `useState` de `produtos`. `sort` estável do
  // V8 preserva a ordem alfabética (já vinda do `order('nome')` da consulta)
  // dentro de cada grupo.
  const produtosOrdenados = [...produtos].sort((a, b) => (b.rastreado ? 1 : 0) - (a.rastreado ? 1 : 0));

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

  // Daqui para baixo `cabecalho`/`cabecalhoSalvo` já estão garantidamente
  // preenchidos (carregar() rodou com sucesso — os três guardas acima
  // cobrem loading, erro de carga e ficha não encontrada). Achado da
  // revisão final: estas derivações ficavam ANTES dos guardas, e como os
  // dois estados nascem `useState(null)` e só ganham valor dentro do
  // `useEffect` de carregar() — depois da primeira renderização —, a
  // primeira renderização estourava aqui (`cabecalho.data` de `null`) e a
  // tela inteira da Fase 3 não abria. Mesmo padrão que a ficha de
  // defumação já segue (app/producoes/defumacao/[id]/page.js).

  // Enquanto a data digitada (`cabecalho.data`) e a data gravada
  // (`cabecalhoSalvo.data`) divergirem — `salvarCampo('data')` ainda não
  // rodou, ou falhou —, o lançamento de item fica bloqueado (ver
  // `adicionarItem`): achado da revisão da Task 5.
  const dataDivergente = cabecalho.data !== cabecalhoSalvo.data;

  const produtoNovoItem = produtos.find(p => p.id === novoItem.produto_id);
  const permitidasNovoItem = produtoNovoItem ? regrasPermitidasDoProduto(produtoNovoItem.id) : [];
  const precisaEscolherConservacao = permitidasNovoItem.length > 1;
  // As três conservações cadastradas e todas proibidas: não há "resposta sem
  // validade" possível aqui, é recusa (ver regraParaItem/adicionarItem).
  const semConservacaoAutorizada = !!(produtoNovoItem && !permitidasNovoItem.length
    && regrasDoProduto(produtoNovoItem.id).length > 0);
  const regraAoVivo = produtoNovoItem ? regraParaItem(produtoNovoItem, novoItem.conservacao) : null;
  const validadeAoVivo = produtoNovoItem && cabecalhoSalvo?.data && !dataDivergente
    ? validadeDoItem(cabecalhoSalvo.data, regraAoVivo) : null;
  // Só pede confirmação quando NADA daria validade — nem regra de
  // conservação, nem o `validade_dias` do cadastro — e o produto não está no
  // caso de recusa (semConservacaoAutorizada). Enquanto falta escolher a
  // conservação (produto com mais de uma regra permitida), o problema é
  // outro — a tela pede a escolha, não a confirmação de "sem validade".
  const precisaConfirmarSemValidade = !!(produtoNovoItem && cabecalhoSalvo?.data && !dataDivergente
    && !precisaEscolherConservacao && !semConservacaoAutorizada && !validadeAoVivo);

  const totalUnidades = itensDaFicha.reduce((s, i) => s + (Number(i.quantidade) || 0), 0);
  const totalPeso = itensDaFicha.reduce((s, i) => s + (Number(i.peso_total_kg) || 0), 0);
  // Quantos PRODUTOS distintos entraram na ficha — não o número de itens
  // (dois lotes do mesmo produto contam um só). Mesmo raciocínio de
  // `qtdMateriasPrimasLancadas` na ficha de defumação.
  const qtdProdutosLancados = new Set(itensDaFicha.map(i => i.produto_id)).size;
  // Item sem validade calculada — o resumo de finalização avisa quais
  // ficaram assim antes de travar de vez (imutabilidade). Mesmo padrão de
  // `itensSemPesoFinal` na ficha de defumação.
  const itensSemValidade = itensDaFicha.filter(it => !it.validade);

  // Produtos lançados nesta ficha que NÃO estão marcados `rastreado` — achado
  // da revisão final (Important 3). A ficha aceita qualquer produto ativo de
  // propósito (filtrar por `rastreado` deixaria a tela inoperante enquanto a
  // marcação nasce `false` para todo produto já cadastrado — ver comentário
  // no `useState` de `produtos`, acima), mas isso significa que um produto
  // lançado aqui sem a marcação entra no estoque por ESTA ficha E continua
  // lançável pela Produção Completa — exatamente o caminho duplo que a
  // marcação existe para eliminar. Não trava (marcar como rastreado é decisão
  // do dono do cadastro, não algo que esta tela deva impor): só avisa, no
  // mesmo painel e formato de `itensSemValidade`, mas sem checkbox de
  // confirmação — o "Confirmar finalização" já basta como reconhecimento.
  // `[...new Map(...).values()]` deduplica por produto (dois itens do mesmo
  // produto não repetem o nome na lista), mesma técnica de `qtdProdutosLancados`.
  const produtosNaoRastreadosNaFicha = [...new Map(
    itensDaFicha
      .map(it => produtos.find(p => p.id === it.produto_id))
      .filter(p => p && !p.rastreado)
      .map(p => [p.id, p])
  ).values()];

  // Responsável pela manipulação em branco no momento de finalizar — achado
  // da revisão final. Usa `cabecalhoSalvo`, não `cabecalho`: mesma regra de
  // fonte de verdade que `dataDivergente` já segue (o que importa é o que
  // está GRAVADO, não o que está digitado e ainda não salvo).
  const semResponsavel = !cabecalhoSalvo.responsavel_id;

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
            {ficha.status === 'rascunho' && itensDaFicha.length > 0 && !finalizando && (
              <button className="btn small" onClick={() => { setConfirmaSemValidadeFinalizar(false); setConfirmaSemResponsavelFinalizar(false); setFinalizando(true); }}>Finalizar ficha</button>
            )}
            {ficha.status !== 'cancelada' && !cancelando && (
              <button className="btn danger small" onClick={() => setCancelando(true)}>Cancelar ficha</button>
            )}
            <button className="btn secondary small" onClick={imprimir}>Imprimir ficha</button>
            <button className="btn secondary small" onClick={() => router.push('/producoes/embalagem')}>Voltar</button>
          </div>
        </div>

        {somenteLeitura && (
          <div className="banner info" style={{ marginTop: 14 }}>
            Esta ficha está {STATUS_LABELS[ficha.status]?.toLowerCase() || ficha.status} — cabeçalho e itens ficam em modo leitura.
          </div>
        )}

        {ficha.status === 'rascunho' && itensDaFicha.length === 0 && (
          <div className="banner info" style={{ marginTop: 14 }}>
            Lance ao menos um produto para poder finalizar a ficha.
          </div>
        )}

        {finalizando && (
          <div className="panel" style={{ marginTop: 14 }}>
            {erroFinalizar && <div className="banner bad">{erroFinalizar}</div>}
            <p><b>Confirmar finalização da ficha {ficha.lote}?</b></p>
            <ul style={{ fontSize: 12.5, lineHeight: 1.8 }}>
              <li>{qtdProdutosLancados} produto(s) lançado(s)</li>
              <li>Unidades embaladas: <b>{fmtUn(totalUnidades)}</b></li>
              <li>Peso final total: <b>{fmtKg(totalPeso)} kg</b></li>
            </ul>
            <p className="muted" style={{ fontSize: 12 }}>
              Ao finalizar, o sistema gera o estoque de produto acabado a partir destes itens. Depois de
              finalizada, o cabeçalho e os itens ficam travados. Para corrigir, cancele com motivo e refaça.
            </p>
            {itensSemValidade.length > 0 && (
              <div className="banner" style={{ marginTop: 10 }}>
                <p style={{ margin: 0 }}>
                  <b>{itensSemValidade.length}</b> {itensSemValidade.length === 1 ? 'item ficou' : 'itens ficaram'} sem
                  validade calculada. Validade em branco na etiqueta é problema de rótulo — depois de finalizar,
                  o item trava e a validade {itensSemValidade.length === 1 ? 'dele' : 'deles'} <b>não poderá mais ser preenchida</b>:
                  {' '}{itensSemValidade.map(it => it.produtos?.nome || '—').join(', ')}.
                </p>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 10, fontWeight: 400 }}>
                  <input type="checkbox" checked={confirmaSemValidadeFinalizar}
                    onChange={e => setConfirmaSemValidadeFinalizar(e.target.checked)}
                    style={{ marginTop: 2 }} />
                  <span>Estou ciente e quero finalizar mesmo assim.</span>
                </label>
              </div>
            )}
            {produtosNaoRastreadosNaFicha.length > 0 && (
              <div className="banner" style={{ marginTop: 10 }}>
                <p style={{ margin: 0 }}>
                  {produtosNaoRastreadosNaFicha.length === 1 ? 'Este produto não está' : 'Estes produtos não estão'} marcado{produtosNaoRastreadosNaFicha.length === 1 ? '' : 's'} como
                  {' '}<b>rastreado</b> no cadastro: {produtosNaoRastreadosNaFicha.map(p => p.nome).join(', ')}.
                  {' '}{produtosNaoRastreadosNaFicha.length === 1 ? 'Ele' : 'Eles'} também pode{produtosNaoRastreadosNaFicha.length === 1 ? '' : 'm'} ser lançado{produtosNaoRastreadosNaFicha.length === 1 ? '' : 's'} pela Produção Completa — marcar como rastreado em Produtos evita a contagem dupla do mesmo estoque pelos dois caminhos. Isto é só um aviso; não impede finalizar.
                </p>
              </div>
            )}
            {semResponsavel && (
              <div className="banner" style={{ marginTop: 10 }}>
                <p style={{ margin: 0 }}>
                  Nenhum <b>responsável pela manipulação</b> foi informado no cabeçalho. É campo do registro
                  sanitário — sai "—" na ficha impressa, e a produção gerada por esta ficha herda esse
                  responsável em branco. Depois de finalizar, o cabeçalho trava e <b>não será mais possível
                  preencher</b>.
                </p>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 10, fontWeight: 400 }}>
                  <input type="checkbox" checked={confirmaSemResponsavelFinalizar}
                    onChange={e => setConfirmaSemResponsavelFinalizar(e.target.checked)}
                    style={{ marginTop: 2 }} />
                  <span>Estou ciente e quero finalizar mesmo assim.</span>
                </label>
              </div>
            )}
            <div className="row-actions">
              <button className="btn" onClick={finalizar}
                disabled={salvandoFinalizar
                  || (itensSemValidade.length > 0 && !confirmaSemValidadeFinalizar)
                  || (semResponsavel && !confirmaSemResponsavelFinalizar)}>
                {salvandoFinalizar ? 'Finalizando…' : 'Confirmar finalização'}
              </button>
              <button className="btn secondary" onClick={() => { setFinalizando(false); setErroFinalizar(''); setConfirmaSemValidadeFinalizar(false); setConfirmaSemResponsavelFinalizar(false); }}>Voltar</button>
            </div>
          </div>
        )}

        {ficha.status === 'cancelada' && (
          <div className="banner bad" style={{ marginTop: 14 }}>
            <b>Ficha cancelada</b> em {fmtDateTime(ficha.cancelada_em)}
            {ficha.cancelada_por?.nome ? ` por ${ficha.cancelada_por.nome}` : ''} — {ficha.cancelada_motivo}
          </div>
        )}

        {cancelando && (
          <div className="panel" style={{ marginTop: 14 }}>
            {erroCancelar && <div className="banner bad">{erroCancelar}</div>}
            <label>Motivo do cancelamento</label>
            <input type="text" value={motivoCancelamento} autoFocus
              placeholder="Ex.: erro de lançamento, refazer a ficha"
              onChange={e => setMotivoCancelamento(e.target.value)} />
            <p className="muted" style={{ fontSize: 12 }}>
              {ficha.status === 'finalizada'
                ? 'Cancelar esta ficha remove o estoque de produto acabado gerado por ela. '
                : ''}
              A ficha cancelada não volta para rascunho ou finalizada.
            </p>
            <div className="row-actions">
              <button className="btn danger" onClick={cancelar} disabled={salvandoCancelar || !motivoCancelamento.trim()}>
                {salvandoCancelar ? 'Cancelando…' : 'Confirmar cancelamento'}
              </button>
              <button className="btn secondary" onClick={() => { setCancelando(false); setMotivoCancelamento(''); setErroCancelar(''); }}>Voltar</button>
            </div>
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

            {/* Mais de uma regra permitida para o produto: o operador escolhe a
                conservação, mesmo padrão de app/producoes/nova/page.js (botão
                por conservação, com o prazo de cada uma já visível). Isto não é
                um caso de "sem validade" — existe uma resposta certa, falta só
                escolher. Dentro do <form>, ANTES do botão de submit — achado
                da revisão da Task 5: fora e depois do <form>, o operador só
                descobria o campo depois de tentar gravar sem ele. */}
            {produtoNovoItem && precisaEscolherConservacao && (
              <div style={{ gridColumn: '1 / -1' }}>
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

            {produtoNovoItem && (
              <p style={{ fontSize: 12.5, gridColumn: '1 / -1', margin: 0 }}>
                {!cabecalhoSalvo.data ? (
                  <span className="muted">Informe e salve a data da embalagem para calcular a validade.</span>
                ) : dataDivergente ? (
                  <span className="muted">A data da embalagem ainda não foi salva — aguarde a gravação para calcular a validade e lançar itens.</span>
                ) : semConservacaoAutorizada ? (
                  <span className="erro">Este produto não possui conservação autorizada para produção — não pode ser embalado. Ajuste as regras de conservação em Produtos.</span>
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

            {precisaConfirmarSemValidade && (
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, gridColumn: '1 / -1', fontWeight: 400, fontSize: 12.5 }}>
                <input type="checkbox" checked={confirmaSemValidade}
                  onChange={e => setConfirmaSemValidade(e.target.checked)}
                  style={{ marginTop: 2 }} />
                <span>Estou ciente de que este item será gravado <b>sem validade</b> — depois de finalizar a ficha não será mais possível corrigir.</span>
              </label>
            )}

            <div><button className="btn secondary" type="submit" disabled={salvandoItem || dataDivergente || semConservacaoAutorizada}>
              {salvandoItem ? 'Gravando…' : 'Adicionar item'}
            </button></div>
          </form>
        )}

        {erroItem && <div className="banner bad" style={{ marginTop: 10 }}>{erroItem}</div>}
        {erroRemover && <div className="banner bad" style={{ marginTop: 10 }}>{erroRemover}</div>}

        {/* Etiqueta de produção só faz sentido com a ficha finalizada — dado
            que ainda pode mudar em rascunho não deveria virar rótulo colado
            numa caixa. */}
        {ficha.status === 'finalizada' && erroImpressoes && (
          <div className="banner" style={{ marginTop: 10 }}>
            Não foi possível carregar o histórico de impressão de etiquetas desta ficha. A impressão foi
            desabilitada para não gravar uma reimpressão como se fosse a primeira. Recarregue a página.
          </div>
        )}

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
              {ficha.status === 'finalizada' && (
                <button className="btn secondary small" type="button"
                  disabled={erroImpressoes}
                  title={erroImpressoes
                    ? 'Não foi possível conferir o histórico de impressão desta ficha — impressão desabilitada para não gravar uma reimpressão como se fosse a primeira. Recarregue a página.'
                    : undefined}
                  onClick={() => abrirEtiquetasItem(it, jaImprimiuItem(it) ? 'reimpressao' : 'original')}>
                  {jaImprimiuItem(it) ? 'Reimprimir etiquetas' : 'Imprimir etiquetas'}
                </button>
              )}
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

      {etiquetaItem && (
        <ModalEtiquetas
          producao={{
            id: etiquetaItem.item.id,
            modelo: 'producao-lote',
            produtoNome: etiquetaItem.item.produtos?.nome || '—',
            codigo: etiquetaItem.item.produtos?.codigo || '',
            produzido_em: ficha.data,
            validade: etiquetaItem.item.validade,
          }}
          dados={etiquetaItem.dados}
          modelo="producao-lote"
          titulo={etiquetaItem.tipo === 'reimpressao' ? 'Reimprimir etiquetas de produção' : 'Etiquetas de produção'}
          tipo={etiquetaItem.tipo}
          sourceType="embalagem_item"
          empresaNome={empresaAtual?.nome}
          setEtiqueta={setEtiqueta}
          onFechar={() => { setEtiquetaItem(null); carregar(); }}
        />
      )}
    </>
  );
}
