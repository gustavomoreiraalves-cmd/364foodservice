'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { fmtMoney, fmtDate } from '../../../lib/format';
import { signedUrlExtrato } from '../../../lib/storage';
import AppShell from '../../../components/AppShell';
import ImportarExtrato from '../../../components/ImportarExtrato';
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
  const [selecionada, setSelecionada] = useState(null);
  const [lancamentos, setLancamentos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtroStatus, setFiltroStatus] = useState('');
  const [mostrarEntradas, setMostrarEntradas] = useState(false);

  async function carregarBase() {
    if (!empresaAtual) return;
    setLoading(true);
    const [r1, r2] = await Promise.all([
      supabase.from('contas_bancarias').select('*').eq('empresa_id', empresaAtual.id).order('nome'),
      supabase.from('extrato_importacoes')
        .select('*, contas_bancarias(nome, instituicao, tipo)')
        .eq('empresa_id', empresaAtual.id).order('created_at', { ascending: false }).limit(30),
    ]);
    if (r2.error) console.error(r2.error);
    setContas(r1.data || []);
    setImportacoes(r2.data || []);
    setLoading(false);
    return r2.data || [];
  }

  async function carregarLancamentos(importacaoId) {
    if (!importacaoId) { setLancamentos([]); return; }
    const { data, error } = await supabase.from('extrato_lancamentos')
      .select('*, parcela_sugerida:contas_a_pagar_parcelas!parcela_sugerida_id('
        + 'id, valor, vencimento, contas_a_pagar(descricao, fornecedores(nome)))')
      .eq('importacao_id', importacaoId).order('data');
    if (error) console.error(error);
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
                      {/* Task 12 monta as ações aqui */}
                      {l.status === 'sugerido' && l.parcela_sugerida && (
                        <span className="muted">
                          {l.parcela_sugerida.contas_a_pagar?.fornecedores?.nome} ·{' '}
                          {fmtMoney(l.parcela_sugerida.valor)} · vence{' '}
                          {fmtDate(l.parcela_sugerida.vencimento)}
                        </span>
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
