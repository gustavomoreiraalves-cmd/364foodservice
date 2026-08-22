'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '../../../../lib/supabase';
import { fmtDate } from '../../../../lib/format';
import { fmtDateTime } from '../../../../lib/producao';
import { rendimento, condicaoRendimento, saldoLote, pesosValidos, rendimentoDaFicha } from '../../../../lib/defumacao';
import { inspecaoAprovada } from '../../../../lib/qualidade';
import { useAuth } from '../../../../lib/auth';
import AppShell from '../../../../components/AppShell';
import ProducaoTabs from '../../../../components/ProducaoTabs';
import FichaPrint, { imprimirFicha } from '../../../../components/FichaPrint';
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
  peso_bruto_kg: '',
  perda_limpeza_kg: '',
  sobra_kg: '',
  peso_final_kg: '',
};

function cabecalhoDaFicha(f) {
  return {
    data: f.data || '',
    // <input type="time"> só aceita HH:MM (sem step de segundos) — a coluna
    // do banco é `time` e volta como HH:MM:SS.
    hora_inicio: f.hora_inicio ? String(f.hora_inicio).slice(0, 5) : '',
    hora_fim: f.hora_fim ? String(f.hora_fim).slice(0, 5) : '',
    temperatura_c: f.temperatura_c != null ? String(f.temperatura_c) : '',
    responsavel_id: f.responsavel_id || '',
    obs: f.obs || '',
  };
}

function fmtKg(v) {
  return Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

// Peso defumado é opcional no item (pesosValidos aceita gravar antes de ele
// entrar) — "0 kg" ali mentiria que já foi pesado. "—" segue a mesma
// convenção do rendimento sem dado.
function fmtKgOuTraco(v) {
  return v === null || v === undefined || v === '' ? '—' : `${fmtKg(v)} kg`;
}

// error.message chega cru do Supabase: em inglês numa falha de rede
// ("Failed to fetch") ou como o texto interno de uma policy do RLS. Nenhum
// dos dois é a primeira coisa que o operador precisa ler — a frase em
// português vem na frente, o detalhe técnico fica em segundo plano, mas
// continua visível para quem for investigar.
function mensagemErro(prefixoPt, error) {
  return `${prefixoPt} (detalhe técnico: ${error?.message || 'erro desconhecido'})`;
}

function RendimentoTexto({ r }) {
  const cond = condicaoRendimento(r);
  return (
    <span style={{ color: cond.cor, fontWeight: 600 }}>
      {r === null ? '—' : `${(r * 100).toFixed(1)}%`}
    </span>
  );
}

export default function DefumacaoFichaPage() {
  // A ficha impressa (FichaPrint) fica FORA de Conteudo, no mesmo nível do
  // AppShell — mas ainda assim é a ÚNICA impressão montada nesta tela. Esta
  // página não mexe com EtiquetaPrint (etiqueta é 108×32mm, ficha é A4); as
  // duas convivendo montadas na mesma tela foi o defeito real da Fase 1 que
  // fazia a ficha A4 sair espremida no tamanho da etiqueta.
  const [fichaImpressao, setFichaImpressao] = useState(null);
  return (
    <>
      <AppShell modulo="producoes" titulo="Ficha de Defumação" desc="Cabeçalho, itens e rendimento da ficha">
        <ProducaoTabs />
        <Conteudo setFichaImpressao={setFichaImpressao} />
      </AppShell>
      <FichaPrint ficha={fichaImpressao} />
    </>
  );
}

function Conteudo({ setFichaImpressao }) {
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
  const [lotesDisponiveis, setLotesDisponiveis] = useState([]); // recebimento_itens da empresa, com joins
  const [itensJaDefumados, setItensJaDefumados] = useState([]); // TODOS os defumacao_itens da empresa

  const [novoItem, setNovoItem] = useState(ITEM_VAZIO);
  const [erroItem, setErroItem] = useState('');
  const [salvandoItem, setSalvandoItem] = useState(false);
  const [removendoId, setRemovendoId] = useState('');
  const [erroRemover, setErroRemover] = useState('');

  const [finalizando, setFinalizando] = useState(false);
  const [salvandoFinalizar, setSalvandoFinalizar] = useState(false);
  const [erroFinalizar, setErroFinalizar] = useState('');

  const [cancelando, setCancelando] = useState(false);
  const [motivoCancelamento, setMotivoCancelamento] = useState('');
  const [salvandoCancelar, setSalvandoCancelar] = useState(false);
  const [erroCancelar, setErroCancelar] = useState('');

  async function carregar() {
    if (!empresaAtual || !id) return;
    setLoading(true);
    setErroCarregar('');
    setNaoEncontrada(false);
    const eid = empresaAtual.id;

    // O filtro por empresa_id na ficha é o que impede alcançar ficha de outra
    // empresa adivinhando o uuid da URL — ela some da consulta e devolve
    // "não encontrada", sem revelar que o id existe.
    //
    // `funcionarios!defumacoes_responsavel_id_fkey` / `..._cancelada_por_id_fkey`:
    // desde a atualização 29, `defumacoes` tem duas FKs para `funcionarios`
    // (responsavel_id e cancelada_por_id), então `funcionarios(nome)` sem
    // qualificação devolveria PGRST201. O nome da constraint desambigua —
    // mesmo padrão de app/pedidos/[id]/page.js para responsavel_id x
    // cancelado_por_id.
    //
    // `funcionarios.user_id` entra na lista (r2) para resolver "quem está
    // cancelando" pelo usuário logado (useAuth), no mesmo padrão de
    // app/producoes/nova/page.js — cancelada_por_id é quem clica em Cancelar
    // ficha, não o responsável pela defumação.
    const [r1, r2, r3, r4] = await Promise.all([
      supabase.from('defumacoes')
        .select('*, responsavel:funcionarios!defumacoes_responsavel_id_fkey(nome), cancelada_por:funcionarios!defumacoes_cancelada_por_id_fkey(nome)')
        .eq('id', id).eq('empresa_id', eid).maybeSingle(),
      supabase.from('funcionarios').select('id, nome, user_id').eq('empresa_id', eid).eq('ativo', true).order('nome'),
      // Lotes de matéria-prima recebidos por esta empresa. A condição sanitária
      // mora em inspecoes_qualidade (não existe mais status_recebimento em
      // recebimento_itens) — por isso o join, filtrado depois com
      // inspecaoAprovada.
      supabase.from('recebimento_itens')
        .select('id, lote, quantidade, materia_prima_id, materias_primas(nome, unidade), recebimentos(data), inspecoes_qualidade(status)')
        .eq('empresa_id', eid),
      // Todos os itens de defumação da empresa — não só desta ficha — porque
      // saldoLote precisa descontar o que já foi lançado em qualquer ficha,
      // inclusive esta.
      supabase.from('defumacao_itens')
        .select('id, defumacao_id, recebimento_item_id, materia_prima_id, peso_bruto_kg, perda_limpeza_kg, sobra_kg, peso_final_kg, materias_primas(nome, unidade), recebimento_itens(lote)')
        .eq('empresa_id', eid),
    ]);

    // Falha de carga precisa aparecer como falha, não como "ficha não
    // encontrada" — achado real na Fase 1.
    const falha = [r1, r2, r3, r4].find(r => r.error);
    if (falha) {
      setErroCarregar(falha.error.message);
      setLoading(false);
      return;
    }

    if (!r1.data) {
      setNaoEncontrada(true);
      setLoading(false);
      return;
    }

    setFicha(r1.data);
    const cab = cabecalhoDaFicha(r1.data);
    setCabecalho(cab);
    setCabecalhoSalvo(cab);
    setFuncionarios(r2.data || []);
    setLotesDisponiveis(r3.data || []);
    setItensJaDefumados(r4.data || []);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id, id]);

  const somenteLeitura = !ficha || ficha.status !== 'rascunho';
  const itensDaFicha = itensJaDefumados.filter(i => i.defumacao_id === id);

  // Best-effort, silencioso: usado depois de uma gravação de campo falhar,
  // para saber se a ficha mudou de status por baixo (outra aba finalizou ou
  // cancelou) sem recarregar a página inteira. Se esta consulta também
  // falhar (a mesma oscilação de rede que derrubou a gravação), não
  // sobrescreve o erro do campo com um segundo erro — o operador já está
  // vendo o que precisa ver.
  async function relerStatusFicha() {
    if (!empresaAtual) return;
    const { data } = await supabase.from('defumacoes')
      .select('status').eq('id', id).eq('empresa_id', empresaAtual.id).maybeSingle();
    if (data) setFicha(prev => (prev ? { ...prev, status: data.status } : prev));
  }

  async function salvarCampo(campo) {
    if (!ficha || !empresaAtual || ficha.status !== 'rascunho') return;
    const valor = cabecalho[campo];
    if (valor === cabecalhoSalvo[campo]) return; // nada mudou, não grava à toa

    setSalvandoCampo(campo);
    setErroCampo(prev => ({ ...prev, [campo]: '' }));
    const valorGravar = valor === '' ? null : (campo === 'temperatura_c' ? Number(valor) : valor);

    const { data, error } = await supabase.from('defumacoes')
      .update({ [campo]: valorGravar })
      .eq('id', id).eq('empresa_id', empresaAtual.id)
      .select('id')
      .maybeSingle();

    setSalvandoCampo('');
    if (error) {
      // As travas da migração 29 levantam mensagem em português (ex.: ficha
      // finalizada por outra aba entre a carga e o blur) — mostra ela e
      // relê só o status real, em vez de insistir. Não chama carregar(): se a
      // rede caiu, a busca inteira falha de novo e vira banner de erro por
      // cima da ficha inteira — tiraria o operador de dentro dela por uma
      // oscilação de sinal na cozinha, por causa de UM campo.
      setErroCampo(prev => ({ ...prev, [campo]: mensagemErro('Não foi possível salvar este campo.', error) }));
      relerStatusFicha();
      return;
    }
    if (!data) {
      setErroCampo(prev => ({ ...prev, [campo]: 'Esta ficha não está mais disponível nesta empresa. Recarregue a página.' }));
      return;
    }
    setCabecalhoSalvo(prev => ({ ...prev, [campo]: valor }));
  }

  // Lotes com inspeção reprovada/pendente/quarentena/devolvida não aparecem —
  // a mesma regra que decide se o lote entrou de fato no estoque
  // (inspecaoAprovada, lib/qualidade.js). Os aprovados aparecem sempre, mesmo
  // sem saldo: desabilitados, com o motivo no próprio texto da opção — sumir
  // sem explicação gera chamado.
  const opcoesLote = lotesDisponiveis
    .filter(inspecaoAprovada)
    .map(l => ({ ...l, saldo: saldoLote(l, itensJaDefumados) }))
    .sort((a, b) => String(a.lote).localeCompare(String(b.lote)));

  function labelLote(l) {
    const mp = l.materias_primas?.nome || '—';
    const unidade = l.materias_primas?.unidade || 'kg';
    const dataRecebimento = l.recebimentos?.data ? fmtDate(l.recebimentos.data).slice(0, 5) : '—';
    const disponibilidade = l.saldo > 0
      ? `${fmtKg(l.saldo)} ${unidade} disponíveis`
      : 'sem saldo disponível';
    return `${l.lote} · ${mp} · receb. ${dataRecebimento} · ${disponibilidade}`;
  }

  async function adicionarItem(e) {
    e.preventDefault();
    if (!empresaAtual || salvandoItem || somenteLeitura) return;
    setErroItem('');
    setErroRemover(''); // banner de remoção de uma ação anterior não fica preso na tela

    const lote = opcoesLote.find(l => l.id === novoItem.recebimento_item_id);
    if (!lote) {
      setErroItem('Escolha o lote de matéria-prima que entrou na defumação.');
      return;
    }
    if (lote.saldo <= 0) {
      setErroItem('Este lote não tem saldo disponível. Escolha outro.');
      return;
    }

    const validacao = pesosValidos(novoItem);
    if (!validacao.ok) {
      setErroItem(validacao.erro);
      return;
    }

    // O saldo só é a mesma grandeza que peso_bruto_kg quando a matéria-prima
    // é medida em quilo: `recebimento_itens.quantidade` já sai gravada na
    // unidade de estoque da matéria-prima (a nota converte na entrada — ver
    // atualizacao_22_nfe_documentos.sql), não necessariamente quilo. Numa
    // matéria-prima medida em outra unidade (un, cx…) o saldo não é
    // comparável ao peso digitado aqui, e bloquear estaria comparando
    // grandezas diferentes — ali o saldo já aparece como informação na
    // própria opção do select (labelLote), sem trava.
    const unidadeLote = String(lote.materias_primas?.unidade || '').trim().toLowerCase();
    if (unidadeLote === 'kg' && Number(novoItem.peso_bruto_kg) > lote.saldo) {
      setErroItem(`O peso bruto informado (${fmtKg(novoItem.peso_bruto_kg)} kg) passa do saldo do lote — restam ${fmtKg(lote.saldo)} kg.`);
      return;
    }

    setSalvandoItem(true);
    const payload = {
      defumacao_id: id,
      empresa_id: empresaAtual.id,
      materia_prima_id: lote.materia_prima_id,
      recebimento_item_id: lote.id,
      peso_bruto_kg: Number(novoItem.peso_bruto_kg),
      perda_limpeza_kg: novoItem.perda_limpeza_kg === '' ? null : Number(novoItem.perda_limpeza_kg),
      sobra_kg: novoItem.sobra_kg === '' ? null : Number(novoItem.sobra_kg),
      peso_final_kg: novoItem.peso_final_kg === '' ? null : Number(novoItem.peso_final_kg),
    };

    const { data, error } = await supabase.from('defumacao_itens')
      .insert([payload])
      .select('id, defumacao_id, recebimento_item_id, materia_prima_id, peso_bruto_kg, perda_limpeza_kg, sobra_kg, peso_final_kg, materias_primas(nome, unidade), recebimento_itens(lote)')
      .single();

    setSalvandoItem(false);
    if (error) {
      setErroItem(mensagemErro('Não foi possível gravar o item.', error));
      return;
    }
    setItensJaDefumados(prev => [...prev, data]);
    setNovoItem(ITEM_VAZIO);
  }

  async function removerItem(itemId) {
    if (!empresaAtual || somenteLeitura) return;
    setRemovendoId(itemId);
    setErroRemover('');
    setErroItem(''); // banner de gravação de item de uma ação anterior não fica preso na tela
    const { error } = await supabase.from('defumacao_itens')
      .delete()
      .eq('id', itemId).eq('empresa_id', empresaAtual.id);
    setRemovendoId('');
    if (error) {
      setErroRemover(mensagemErro('Não foi possível remover o item.', error));
      return;
    }
    setItensJaDefumados(prev => prev.filter(i => i.id !== itemId));
  }

  // Quem finaliza/cancela é o usuário logado — não necessariamente o
  // responsável pela defumação gravado no cabeçalho. Mesmo padrão de
  // app/producoes/nova/page.js (meuFuncionario) e de app/pedidos/[id]/page.js
  // (cancelado_por_id).
  const meuFuncionario = funcionarios.find(f => f.user_id === session?.user?.id);

  // Só envia os campos que mudam: reenviar o cabeçalho inteiro (data, hora,
  // temperatura, responsável…) esbarraria nas travas de imutabilidade da
  // migração 29 assim que a ficha sair de rascunho — o trigger recusa
  // qualquer um desses campos "mudando" mesmo que o valor enviado seja igual
  // ao que já está gravado, porque o `is distinct from` roda sobre o payload
  // inteiro do update.
  async function finalizar() {
    if (!ficha || !empresaAtual || ficha.status !== 'rascunho') return;
    setSalvandoFinalizar(true);
    setErroFinalizar('');
    const { data, error } = await supabase.from('defumacoes')
      .update({ status: 'finalizada' })
      .eq('id', id).eq('empresa_id', empresaAtual.id)
      .select('id')
      .maybeSingle();
    setSalvandoFinalizar(false);
    if (error) {
      // A trava "ficha sem item não finaliza" e qualquer corrida com outra
      // aba chegam aqui em português (fn_defumacao_cabecalho, migração 29).
      // Mostra a mensagem e relê o status real em vez de insistir — a
      // ficha pode ter sido finalizada ou cancelada por outra aba entre a
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
    await carregar();
  }

  async function cancelar() {
    if (!motivoCancelamento.trim() || !empresaAtual) return;
    setSalvandoCancelar(true);
    setErroCancelar('');
    // `cancelada_em` não vai daqui: quem carimba é o trigger
    // fn_defumacao_cabecalho, com o relógio do banco — o relógio do
    // navegador pode estar em qualquer hora (mesmo raciocínio do
    // cancelamento de pedido).
    const { data, error } = await supabase.from('defumacoes')
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
    await carregar();
  }

  // Só monta FichaPrint nesta tela — nenhuma EtiquetaPrint aqui (ver
  // comentário em DefumacaoFichaPage). Traz lote, matéria-prima e os quatro
  // pesos de cada item, mais o rendimento por item — o que a ficha de papel
  // trazia.
  function imprimir() {
    imprimirFicha(setFichaImpressao, {
      titulo: 'Ficha de Defumação',
      numero: ficha.lote,
      campos: [
        { rot: 'Data', valor: fmtDate(ficha.data) },
        { rot: 'Início', valor: cabecalho.hora_inicio || '—' },
        { rot: 'Fim', valor: cabecalho.hora_fim || '—' },
        { rot: 'Temperatura', valor: ficha.temperatura_c != null ? `${ficha.temperatura_c} °C` : '—' },
        { rot: 'Responsável', valor: ficha.responsavel?.nome },
        { rot: 'Status', valor: STATUS_LABELS[ficha.status] || ficha.status },
        { rot: 'Observações', valor: ficha.obs },
      ],
      itens: {
        headers: ['Lote', 'Matéria-prima', 'Peso bruto', 'Perda', 'Sobra', 'Peso defumado', 'Rendimento'],
        rows: itensDaFicha.map(it => {
          const r = rendimento(it.peso_bruto_kg, it.peso_final_kg);
          return [
            it.recebimento_itens?.lote || '—',
            it.materias_primas?.nome || '—',
            `${fmtKg(it.peso_bruto_kg)} kg`,
            fmtKgOuTraco(it.perda_limpeza_kg),
            fmtKgOuTraco(it.sobra_kg),
            fmtKgOuTraco(it.peso_final_kg),
            r === null ? '—' : `${(r * 100).toFixed(1)}%`,
          ];
        }),
      },
      totais: `Peso bruto total: ${fmtKg(somaBruto)} kg · Peso defumado total: ${fmtKg(somaFinal)} kg · Rendimento da ficha: ${rFicha === null ? '—' : `${(rFicha * 100).toFixed(1)}%`}`,
      assinaturas: ['Responsável pela defumação', 'Conferido por'],
    });
  }

  const rAoVivo = rendimento(novoItem.peso_bruto_kg, novoItem.peso_final_kg);
  const condAoVivo = condicaoRendimento(rAoVivo);

  // Os totais brutos/defumados somam TODOS os itens (informativo: quanto já
  // entrou, quanto já saiu pesado) — mas o rendimento da ficha usa
  // rendimentoDaFicha, que só pareia bruto e final dos itens já pesados.
  // Somar bruto de item ainda não pesado contra o peso_final_kg || 0 desse
  // mesmo item mentiria "rendimento baixo" numa ficha que só começou.
  const somaBruto = itensDaFicha.reduce((s, i) => s + (Number(i.peso_bruto_kg) || 0), 0);
  const somaFinal = itensDaFicha.reduce((s, i) => s + (Number(i.peso_final_kg) || 0), 0);
  const rFicha = rendimentoDaFicha(itensDaFicha);
  const condFicha = condicaoRendimento(rFicha);

  if (loading) return <p className="muted">Carregando…</p>;

  if (erroCarregar) {
    return (
      <div className="banner bad">
        Não foi possível carregar a ficha de defumação: {erroCarregar}{' '}
        <button className="btn secondary small" onClick={carregar}>Tentar novamente</button>
      </div>
    );
  }

  if (naoEncontrada) {
    return (
      <div className="banner info">
        Ficha de defumação não encontrada nesta empresa.{' '}
        <button className="btn secondary small" onClick={() => router.push('/producoes/defumacao')}>Voltar para a lista</button>
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
            {ficha.status === 'rascunho' && itensDaFicha.length > 0 && !finalizando && (
              <button className="btn small" onClick={() => setFinalizando(true)}>Finalizar ficha</button>
            )}
            {ficha.status !== 'cancelada' && !cancelando && (
              <button className="btn danger small" onClick={() => setCancelando(true)}>Cancelar ficha</button>
            )}
            <button className="btn secondary small" onClick={imprimir}>Imprimir ficha</button>
            <button className="btn secondary small" onClick={() => router.push('/producoes/defumacao')}>Voltar</button>
          </div>
        </div>

        {somenteLeitura && (
          <div className="banner info" style={{ marginTop: 14 }}>
            Esta ficha está {STATUS_LABELS[ficha.status]?.toLowerCase() || ficha.status} — cabeçalho e itens ficam em modo leitura.
          </div>
        )}

        {ficha.status === 'rascunho' && itensDaFicha.length === 0 && (
          <div className="banner info" style={{ marginTop: 14 }}>
            Lance ao menos uma matéria-prima para poder finalizar a ficha.
          </div>
        )}

        {finalizando && (
          <div className="panel" style={{ marginTop: 14 }}>
            {erroFinalizar && <div className="banner bad">{erroFinalizar}</div>}
            <p><b>Confirmar finalização da ficha {ficha.lote}?</b></p>
            <ul style={{ fontSize: 12.5, lineHeight: 1.8 }}>
              <li>{itensDaFicha.length} matéria(s)-prima(s) lançada(s)</li>
              <li>Peso bruto total: <b>{fmtKg(somaBruto)} kg</b></li>
              <li>Peso defumado total: <b>{fmtKg(somaFinal)} kg</b></li>
              <li>Rendimento da ficha: <RendimentoTexto r={rFicha} /></li>
            </ul>
            <p className="muted" style={{ fontSize: 12 }}>
              Depois de finalizada, o cabeçalho e os itens ficam travados. Para corrigir, cancele com motivo e refaça.
            </p>
            <div className="row-actions">
              <button className="btn" onClick={finalizar} disabled={salvandoFinalizar}>
                {salvandoFinalizar ? 'Finalizando…' : 'Confirmar finalização'}
              </button>
              <button className="btn secondary" onClick={() => { setFinalizando(false); setErroFinalizar(''); }}>Voltar</button>
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
            <label>Data da produção</label>
            <input type="date" disabled={somenteLeitura} value={cabecalho.data}
              onChange={e => setCabecalho({ ...cabecalho, data: e.target.value })}
              onBlur={() => salvarCampo('data')} />
            {erroCampo.data && <p className="erro" style={{ fontSize: 11, marginTop: 4 }}>{erroCampo.data}</p>}
          </div>
          <div>
            <label>Início da defumação</label>
            <input type="time" disabled={somenteLeitura} value={cabecalho.hora_inicio}
              onChange={e => setCabecalho({ ...cabecalho, hora_inicio: e.target.value })}
              onBlur={() => salvarCampo('hora_inicio')} />
            {erroCampo.hora_inicio && <p className="erro" style={{ fontSize: 11, marginTop: 4 }}>{erroCampo.hora_inicio}</p>}
          </div>
          <div>
            <label>Fim da defumação</label>
            <input type="time" disabled={somenteLeitura} value={cabecalho.hora_fim}
              onChange={e => setCabecalho({ ...cabecalho, hora_fim: e.target.value })}
              onBlur={() => salvarCampo('hora_fim')} />
            {erroCampo.hora_fim && <p className="erro" style={{ fontSize: 11, marginTop: 4 }}>{erroCampo.hora_fim}</p>}
          </div>
          <div>
            <label>Temperatura (°C)</label>
            <input type="number" inputMode="decimal" step="0.1" disabled={somenteLeitura} value={cabecalho.temperatura_c}
              onChange={e => setCabecalho({ ...cabecalho, temperatura_c: e.target.value })}
              onBlur={() => salvarCampo('temperatura_c')} />
            {erroCampo.temperatura_c && <p className="erro" style={{ fontSize: 11, marginTop: 4 }}>{erroCampo.temperatura_c}</p>}
          </div>
          <div>
            <label>Responsável pela defumação</label>
            <select disabled={somenteLeitura} value={cabecalho.responsavel_id}
              onChange={e => setCabecalho({ ...cabecalho, responsavel_id: e.target.value })}
              onBlur={() => salvarCampo('responsavel_id')}>
              <option value="">Selecione…</option>
              {/* O responsável gravado pode ter sido desativado depois — a
                  lista de funcionários só traz ativo=true (ver r2 em
                  carregar()). Sem esta opção extra, uma ficha assim voltaria
                  a mostrar "Selecione…", como se o campo estivesse vazio. */}
              {cabecalho.responsavel_id && !funcionarios.some(f => f.id === cabecalho.responsavel_id) && (
                <option value={cabecalho.responsavel_id}>{ficha.responsavel?.nome || 'Responsável desativado'} (inativo)</option>
              )}
              {funcionarios.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
            {erroCampo.responsavel_id && <p className="erro" style={{ fontSize: 11, marginTop: 4 }}>{erroCampo.responsavel_id}</p>}
          </div>
          <div>
            <label>Observações</label>
            <input type="text" disabled={somenteLeitura} value={cabecalho.obs}
              onChange={e => setCabecalho({ ...cabecalho, obs: e.target.value })}
              onBlur={() => salvarCampo('obs')} />
            {erroCampo.obs && <p className="erro" style={{ fontSize: 11, marginTop: 4 }}>{erroCampo.obs}</p>}
          </div>
        </div>
        {salvandoCampo && <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>Salvando…</p>}
      </div>

      <div className="panel">
        <h3>Matérias-primas defumadas nesta ficha</h3>

        {!somenteLeitura && (
          <form className="form-grid" onSubmit={adicionarItem}>
            <div>
              <label>Lote</label>
              <select required value={novoItem.recebimento_item_id}
                onChange={e => setNovoItem({ ...novoItem, recebimento_item_id: e.target.value })}>
                <option value="">Selecione…</option>
                {opcoesLote.map(l => (
                  <option key={l.id} value={l.id} disabled={l.saldo <= 0}>{labelLote(l)}</option>
                ))}
              </select>
            </div>
            <div>
              <label>Peso bruto (kg)</label>
              <input type="number" inputMode="decimal" step="0.001" required value={novoItem.peso_bruto_kg}
                onChange={e => setNovoItem({ ...novoItem, peso_bruto_kg: e.target.value })} />
            </div>
            <div>
              <label>Perda na limpeza (kg)</label>
              <input type="number" inputMode="decimal" step="0.001" value={novoItem.perda_limpeza_kg}
                onChange={e => setNovoItem({ ...novoItem, perda_limpeza_kg: e.target.value })} />
            </div>
            <div>
              <label>Sobra aproveitável (kg)</label>
              <input type="number" inputMode="decimal" step="0.001" value={novoItem.sobra_kg}
                onChange={e => setNovoItem({ ...novoItem, sobra_kg: e.target.value })} />
            </div>
            <div>
              <label>Peso defumado (kg)</label>
              <input type="number" inputMode="decimal" step="0.001" value={novoItem.peso_final_kg}
                onChange={e => setNovoItem({ ...novoItem, peso_final_kg: e.target.value })} />
            </div>
            <div><button className="btn secondary" type="submit" disabled={salvandoItem}>
              {salvandoItem ? 'Gravando…' : 'Adicionar item'}
            </button></div>
          </form>
        )}

        {!somenteLeitura && (
          <p style={{ fontSize: 12.5, marginTop: 10 }}>
            Rendimento deste item: <RendimentoTexto r={rAoVivo} />
            {condAoVivo.id === 'baixo' && (
              <span style={{ marginLeft: 8 }} className="tag warn">Rendimento baixo — confira os pesos antes de gravar</span>
            )}
          </p>
        )}

        {erroItem && <div className="banner bad" style={{ marginTop: 10 }}>{erroItem}</div>}
        {erroRemover && <div className="banner bad" style={{ marginTop: 10 }}>{erroRemover}</div>}

        <div className="items-list" style={{ marginTop: 10 }}>
          {itensDaFicha.length ? itensDaFicha.map(it => {
            const r = rendimento(it.peso_bruto_kg, it.peso_final_kg);
            return (
              <div className="item-line" key={it.id}>
                <span>
                  {it.materias_primas?.nome || '—'}
                  <span className="muted"> · lote {it.recebimento_itens?.lote || '—'}</span>
                </span>
                <span className="num">
                  {fmtKg(it.peso_bruto_kg)} kg bruto → {fmtKgOuTraco(it.peso_final_kg)} defumado
                </span>
                <span className="num"><RendimentoTexto r={r} /></span>
                {!somenteLeitura && (
                  <button className="btn danger small" type="button"
                    disabled={removendoId === it.id}
                    onClick={() => removerItem(it.id)}>
                    {removendoId === it.id ? '…' : '×'}
                  </button>
                )}
              </div>
            );
          }) : <p className="muted" style={{ fontSize: 12 }}>Nenhuma matéria-prima lançada ainda.</p>}
        </div>

        <div style={{ borderTop: '1px solid var(--border)', marginTop: 14, paddingTop: 10, display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 12.5 }}>
          <span>Peso bruto total: <b>{fmtKg(somaBruto)} kg</b></span>
          <span>Peso defumado total: <b>{fmtKg(somaFinal)} kg</b></span>
          <span>Rendimento da ficha: <RendimentoTexto r={rFicha} />
            {condFicha.id === 'baixo' && <span style={{ marginLeft: 8 }} className="tag warn">{condFicha.label}</span>}
          </span>
        </div>
      </div>
    </>
  );
}
