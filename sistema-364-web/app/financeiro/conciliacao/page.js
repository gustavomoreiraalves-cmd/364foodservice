'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { fmtMoney, fmtDate } from '../../../lib/format';
import { signedUrlExtrato } from '../../../lib/storage';
import { chamarApi } from '../../../lib/extratos/cliente';
import AppShell from '../../../components/AppShell';
import ImportarExtrato from '../../../components/ImportarExtrato';
import AcoesConciliacao from '../../../components/AcoesConciliacao';
import AssociarFatura from '../../../components/AssociarFatura';
import { useEmpresaAtual } from '../../../lib/empresa';

const TAG_IMPORTACAO = {
  processando: 'warn', aguardando_conciliacao: 'warn', concluida: 'ok', erro: 'bad',
};
const ROTULO_IMPORTACAO = {
  processando: 'Processando', aguardando_conciliacao: 'A conciliar',
  concluida: 'Conciliada', erro: 'Erro',
};
const TAG_LANCAMENTO = { pendente: 'warn', sugerido: 'warn', conciliado: 'ok', ignorado: '' };
const ROTULO_LANCAMENTO = {
  pendente: 'Sem correspondência', sugerido: 'Sugerido', conciliado: 'Conciliado', ignorado: 'Entrada',
};

export default function ConciliacaoPage() {
  return (
    <AppShell modulo="financeiro" titulo="Conciliação Bancária"
      desc="Extratos e faturas importados, e a associação com o contas a pagar">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const { empresaAtual } = useEmpresaAtual();
  const [contas, setContas] = useState([]);
  const [importacoes, setImportacoes] = useState([]);
  const [fornecedores, setFornecedores] = useState([]);
  const [funcionarios, setFuncionarios] = useState([]);
  const [selecionada, setSelecionada] = useState(null);
  const [lancamentos, setLancamentos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtroStatus, setFiltroStatus] = useState('');
  const [mostrarEntradas, setMostrarEntradas] = useState(false);
  const [confirmandoLote, setConfirmandoLote] = useState(false);

  async function carregarBase() {
    if (!empresaAtual) return;
    setLoading(true);
    const [r1, r2, r3, r4] = await Promise.all([
      supabase.from('contas_bancarias').select('*').eq('empresa_id', empresaAtual.id).order('nome'),
      supabase.from('extrato_importacoes')
        .select('*, contas_bancarias(nome, instituicao, tipo)')
        .eq('empresa_id', empresaAtual.id).order('created_at', { ascending: false }).limit(30),
      supabase.from('fornecedores').select('*').eq('empresa_id', empresaAtual.id).order('nome'),
      supabase.from('funcionarios').select('id, nome').eq('empresa_id', empresaAtual.id)
        .eq('ativo', true).order('nome'),
    ]);
    // As quatro consultas alimentam a tela inteira, e cada uma que falha em
    // silêncio some como se o cadastro estivesse vazio: sem contas bancárias o
    // formulário de importar não abre, sem fornecedores o "criar conta a
    // pagar" fica sem opção nenhuma. Nada disso é a mesma coisa que "não há
    // nada cadastrado", e antes só r2 era registrada.
    const falhas = [
      ['contas bancárias', r1.error], ['importações', r2.error],
      ['fornecedores', r3.error], ['funcionários', r4.error],
    ].filter(([, erro]) => erro);
    for (const [nome, erro] of falhas) console.error(`Falha ao carregar ${nome}:`, erro);
    if (falhas.length) {
      alert('Parte da tela não carregou:\n'
        + falhas.map(([nome, erro]) => `· ${nome}: ${erro.message}`).join('\n')
        + '\n\nRecarregue antes de conciliar — uma lista vazia aqui não quer dizer '
        + 'que não há nada cadastrado.');
    }
    setContas(r1.data || []);
    setImportacoes(r2.data || []);
    setFornecedores(r3.data || []);
    setFuncionarios(r4.data || []);
    setLoading(false);
    return r2.data || [];   // aposImportar e recarregar dependem deste retorno
  }

  async function carregarLancamentos(importacaoId) {
    if (!importacaoId) { setLancamentos([]); return; }
    const { data, error } = await supabase.from('extrato_lancamentos')
      .select('*, parcela_sugerida:contas_a_pagar_parcelas!parcela_sugerida_id('
        + 'id, valor, vencimento, contas_a_pagar(descricao, fornecedores(nome)))')
      .eq('importacao_id', importacaoId).order('data');
    if (error) {
      console.error(error);
      alert('Não consegui carregar os lançamentos desta importação: ' + error.message
        + '\n\nO painel abaixo pode aparecer vazio por causa disso, não por falta de lançamento.');
    }
    setLancamentos(data || []);
  }

  useEffect(() => { carregarBase(); }, [empresaAtual?.id]);
  useEffect(() => { carregarLancamentos(selecionada?.id); }, [selecionada?.id]);

  // Depois de qualquer ação de conciliação: a lista e os contadores mudam juntos.
  async function recarregar() {
    const lista = await carregarBase();
    if (selecionada) {
      setSelecionada(lista.find(i => i.id === selecionada.id) || null);
      await carregarLancamentos(selecionada.id);
    }
  }

  // Importar contra a conta errada é o erro mais provável do primeiro dia: o
  // hash_dedupe inclui a conta bancária, então importar de novo contra a conta
  // certa gera um SEGUNDO conjunto completo, e o errado ficava na tela para
  // sempre. Cada lançamento dele segura um parcela_sugerida_id que some do
  // pool de sugestões de toda importação futura.
  async function excluirImportacao(imp) {
    const { count } = await supabase.from('extrato_lancamentos')
      .select('id', { count: 'exact', head: true }).eq('importacao_id', imp.id);
    const quantos = count == null ? 'todos os' : `os ${count}`;
    const rotulo = imp.arquivo_nome || (imp.tipo === 'fatura_cartao' ? 'fatura' : 'extrato');
    const periodo = imp.periodo_inicio
      ? ` (${fmtDate(imp.periodo_inicio)} a ${fmtDate(imp.periodo_fim)})` : '';
    if (!confirm(
      `Excluir a importação "${rotulo}"${periodo}, da conta ${imp.contas_bancarias?.nome || '—'}?\n\n`
      + `Isso apaga ${quantos} lançamento(s) dela e o arquivo guardado no sistema. As parcelas `
      + `que esses lançamentos estavam segurando voltam a ser oferecidas nas próximas `
      + `importações.\n\nNão dá para desfazer — para trazer de volta, é só importar o arquivo `
      + `de novo.`)) return;

    const r = await chamarApi('/api/financeiro/conciliacao', {
      method: 'POST', body: JSON.stringify({ acao: 'excluir-importacao', importacaoId: imp.id }),
    });
    const j = await r.json();
    if (!r.ok) { alert(j.error || 'Não foi possível excluir a importação.'); return; }
    if (selecionada?.id === imp.id) { setSelecionada(null); setLancamentos([]); }
    await carregarBase();
    if (j.arquivoRemovido === false) {
      alert('Importação excluída, mas o arquivo continuou no armazenamento. '
        + 'Os lançamentos foram removidos — isso é o que destrava as sugestões.');
    }
  }

  async function abrirArquivo(path) {
    try {
      window.open(await signedUrlExtrato(path), '_blank', 'noopener,noreferrer');
    } catch (e) {
      alert('Não consegui abrir o arquivo: ' + e.message);
    }
  }

  async function aposImportar(resumo) {
    const lista = await carregarBase();
    setSelecionada(lista.find(i => i.id === resumo.importacaoId) || null);
    let mensagem;
    if (resumo.novas === 0 && resumo.duplicadas > 0) {
      // Todas as linhas bateram no dedupe: a importação nasce "concluída" e
      // vazia (fn_recalcular_importacao não tem saída aberta pra contar), o
      // que sem esta mensagem parece um sucesso sem sentido — e o colaborador
      // tenta importar de novo achando que algo falhou. É o arquivo repetido,
      // não um erro: dizer isso evita o reenvio em loop.
      mensagem = `Este arquivo já tinha sido importado antes — nenhum lançamento novo entrou. `
        + `Os ${resumo.duplicadas} lançamento(s) já estavam no sistema. Se esperava novidades, `
        + `confira se é o arquivo certo ou um período mais recente do banco.`;
    } else {
      const partes = [`${resumo.novas} lançamento(s) importado(s)`];
      if (resumo.duplicadas) partes.push(`${resumo.duplicadas} já estavam no sistema`);
      if (resumo.sugeridas) partes.push(`${resumo.sugeridas} já vieram com sugestão`);
      mensagem = partes.join(', ') + '.';
    }
    alert(mensagem + (resumo.alerta ? `\n\nAtenção: ${resumo.alerta}` : ''));
  }

  const visiveis = lancamentos.filter(l => {
    if (!mostrarEntradas && l.tipo === 'entrada') return false;
    if (filtroStatus && l.status !== filtroStatus) return false;
    return true;
  });

  return (
    <>
      <ImportarExtrato empresaId={empresaAtual?.id} contas={contas} onImportado={aposImportar} />

      <div className="panel">
        <strong>Importações recentes</strong>
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table>
            <thead>
              <tr>
                <th>Conta</th><th>Documento</th><th>Período</th><th>Formato</th>
                <th>Conciliados</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr className="empty-row"><td colSpan={7}>Carregando…</td></tr>}
              {!loading && !importacoes.length && (
                <tr className="empty-row"><td colSpan={7}>
                  Nenhum extrato importado ainda. Envie o primeiro arquivo acima.
                </td></tr>
              )}
              {importacoes.map(i => (
                <tr key={i.id} style={selecionada?.id === i.id
                  ? { outline: '1px solid var(--amber)' } : undefined}>
                  <td>{i.contas_bancarias?.nome || '—'}</td>
                  <td>{i.tipo === 'fatura_cartao' ? 'Fatura' : 'Extrato'}</td>
                  <td>{i.periodo_inicio ? `${fmtDate(i.periodo_inicio)} a ${fmtDate(i.periodo_fim)}` : '—'}</td>
                  <td>{String(i.formato).toUpperCase()}</td>
                  <td className="num">{i.conciliados}/{i.total_lancamentos}</td>
                  <td>
                    <span className={'tag ' + (TAG_IMPORTACAO[i.status] || '')}>
                      {ROTULO_IMPORTACAO[i.status] || i.status}
                    </span>
                  </td>
                  <td className="row-actions">
                    <button className="btn small" onClick={() => setSelecionada(i)}>Abrir</button>
                    <button className="btn secondary small" onClick={() => abrirArquivo(i.arquivo_path)}>
                      Arquivo
                    </button>
                    {/* Importação com lançamento conciliado não se apaga: o
                        cascade levaria vínculos e baixas junto, em silêncio.
                        O servidor recusa de novo — este disabled é só para o
                        botão não parecer disponível. */}
                    <button className="btn secondary small" disabled={i.conciliados > 0}
                      title={i.conciliados > 0
                        ? 'Tem lançamento já conciliado. Desfaça as conciliações antes de excluir.'
                        : 'Excluir esta importação e seus lançamentos'}
                      onClick={() => excluirImportacao(i)}>
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {importacoes.some(i => i.alerta) && importacoes.filter(i => i.alerta).map(i => (
          <div className="banner" key={i.id} style={{ marginTop: 10 }}>{i.alerta}</div>
        ))}
        {importacoes.some(i => i.status === 'erro') && importacoes.filter(i => i.status === 'erro').map(i => (
          <div className="banner" key={'e' + i.id} style={{ marginTop: 10 }}>
            {i.arquivo_nome}: {i.erro}
          </div>
        ))}
      </div>

      {selecionada && (
        <div className="panel">
          <strong>Lançamentos — {selecionada.contas_bancarias?.nome}</strong>
          <div className="filter-bar" style={{ marginTop: 10 }}>
            <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}>
              <option value="">Todos os status</option>
              <option value="pendente">Sem correspondência</option>
              <option value="sugerido">Sugeridos</option>
              <option value="conciliado">Conciliados</option>
            </select>
            <label className="check-line">
              <input type="checkbox" checked={mostrarEntradas}
                onChange={e => setMostrarEntradas(e.target.checked)} />
              Mostrar entradas (não conciliadas nesta fase)
            </label>
          </div>
          {(() => {
            const sugeridos = visiveis.filter(l => l.status === 'sugerido');
            if (!sugeridos.length) return null;
            return (
              <div className="banner info" style={{ marginTop: 10 }}>
                {sugeridos.length} lançamento(s) já vieram com sugestão do sistema.
                <button className="btn small" style={{ marginLeft: 10 }} disabled={confirmandoLote}
                  onClick={async () => {
                    if (!confirm(`Confirmar as ${sugeridos.length} sugestões?`)) return;
                    setConfirmandoLote(true);
                    try {
                      const r = await chamarApi('/api/financeiro/conciliacao', {
                        method: 'POST',
                        body: JSON.stringify({ acao: 'confirmar-lote',
                          lancamentoIds: sugeridos.map(l => l.id) }),
                      });
                      const j = await r.json();
                      if (!r.ok) { alert(j.error || 'Não foi possível confirmar em lote.'); return; }
                      await recarregar();
                      if (j.falhas?.length) {
                        alert(`${j.confirmados} confirmado(s). ${j.falhas.length} ficaram de fora:\n`
                          + j.falhas.map(f => '· ' + f.erro).join('\n'));
                      }
                    } finally {
                      setConfirmandoLote(false);
                    }
                  }}>
                  {confirmandoLote ? 'Confirmando…' : `Confirmar ${sugeridos.length} sugestões`}
                </button>
              </div>
            );
          })()}
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table>
              <thead>
                <tr><th>Data</th><th>Descrição</th><th>Valor</th><th>Status</th><th>Ação</th></tr>
              </thead>
              <tbody>
                {!visiveis.length && (
                  <tr className="empty-row"><td colSpan={5}>Nenhum lançamento com esse filtro.</td></tr>
                )}
                {visiveis.map(l => (
                  <tr key={l.id}>
                    <td>{fmtDate(l.data)}</td>
                    <td>{l.descricao}</td>
                    <td className="num">{fmtMoney(l.valor)}</td>
                    <td>
                      <span className={'tag ' + (TAG_LANCAMENTO[l.status] || '')}>
                        {ROTULO_LANCAMENTO[l.status] || l.status}
                      </span>
                    </td>
                    <td>
                      <AcoesConciliacao lancamento={l} empresaId={empresaAtual?.id}
                        fornecedores={fornecedores} funcionarios={funcionarios}
                        tipoImportacao={selecionada.tipo} onMudou={recarregar} />
                      {selecionada.tipo === 'extrato' && l.tipo === 'saida'
                        && l.status !== 'conciliado' && (
                        <AssociarFatura lancamento={l} empresaId={empresaAtual?.id}
                          onMudou={recarregar} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
