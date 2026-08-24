'use client';
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { fmtMoney, fmtDate } from '../lib/format';
import { CATEGORIAS_CONTA } from '../lib/financeiro';
import { candidatosParaLancamento } from '../lib/extratos/matching';
import { chamarApi } from '../lib/extratos/cliente';

// O embed de contas_a_pagar_parcelas -> contas_a_pagar volta objeto no
// muitos-para-um, mas blindar contra as duas formas evita que o aprendizado
// (conciliacao_padroes) degrade em silêncio se o formato do embed mudar —
// mesma guarda de lib/extratosServer.js (comoObjeto), pelo mesmo motivo: sem
// isso, fornecedorId/categoriaConta viram undefined sem erro nenhum.
function comoObjeto(valor) {
  return Array.isArray(valor) ? (valor[0] || null) : valor;
}

// Ações inline da linha do extrato. Segue o padrão da baixa de parcela em
// contas a pagar: o formulário abre dentro da própria célula, sem modal.
export default function AcoesConciliacao({ lancamento, empresaId, fornecedores, funcionarios, onMudou }) {
  const [aberto, setAberto] = useState('');   // '' | 'associar' | 'criar'
  const [ocupado, setOcupado] = useState(false);
  const [candidatos, setCandidatos] = useState([]);
  const [parcelasPorId, setParcelasPorId] = useState({});
  const [novaConta, setNovaConta] = useState(null);

  async function chamar(corpo) {
    setOcupado(true);
    try {
      const r = await chamarApi('/api/financeiro/conciliacao', {
        method: 'POST', body: JSON.stringify(corpo),
      });
      const j = await r.json();
      if (!r.ok) { alert(j.error || 'Não foi possível concluir a ação.'); return false; }
      await onMudou();
      return true;
    } catch (e) {
      alert('Falha: ' + e.message);
      return false;
    } finally {
      setOcupado(false);
    }
  }

  // Ranqueia as parcelas em aberto com a mesma régua da importação, para o
  // colaborador ver primeiro o candidato mais provável.
  async function abrirAssociar() {
    setOcupado(true);
    try {
      const [rp, rpad] = await Promise.all([
        supabase.from('contas_a_pagar_parcelas')
          .select('id, valor, vencimento, contas_a_pagar(descricao, fornecedor_id, categoria_conta, fornecedores(nome))')
          .eq('empresa_id', empresaId).eq('status', 'Pendente'),
        supabase.from('conciliacao_padroes').select('fornecedor_id, categoria_conta')
          .eq('empresa_id', empresaId).eq('padrao', lancamento.descricao_normalizada).maybeSingle(),
      ]);
      const parcelas = (rp.data || []).map(p => ({
        id: p.id, valor: Number(p.valor), vencimento: p.vencimento,
        fornecedorId: comoObjeto(p.contas_a_pagar)?.fornecedor_id || null,
      }));
      const mapa = {};
      for (const p of rp.data || []) mapa[p.id] = p;
      setParcelasPorId(mapa);
      const padrao = rpad.data
        ? { fornecedorId: rpad.data.fornecedor_id, categoriaConta: rpad.data.categoria_conta }
        : null;
      setCandidatos(candidatosParaLancamento(
        { data: lancamento.data, valor: Number(lancamento.valor), tipo: lancamento.tipo,
          descricao: lancamento.descricao },
        parcelas, padrao));
      setNovaConta({
        descricao: lancamento.descricao,
        categoriaConta: padrao?.categoriaConta || CATEGORIAS_CONTA[0],
        fornecedorId: padrao?.fornecedorId || '',
        responsavelId: '',
      });
      setAberto('associar');
    } finally {
      setOcupado(false);
    }
  }

  async function confirmarParcela(parcelaId) {
    const parcela = parcelasPorId[parcelaId];
    const contaPagar = comoObjeto(parcela?.contas_a_pagar);
    const ok = await chamar({
      acao: 'confirmar', lancamentoId: lancamento.id,
      parcelas: [{ parcelaId, valorAplicado: Number(lancamento.valor) }],
      fornecedorId: contaPagar?.fornecedor_id || null,
      categoriaConta: contaPagar?.categoria_conta || null,
    });
    if (ok) setAberto('');
  }

  // Confirmar a sugestão que veio da importação: os dados do fornecedor saem
  // da própria parcela sugerida, já embutida na linha.
  async function confirmarSugestao() {
    await chamar({ acao: 'confirmar-lote', lancamentoIds: [lancamento.id] });
  }

  async function criar() {
    if (!novaConta?.fornecedorId) { alert('Escolha o fornecedor.'); return; }
    const ok = await chamar({
      acao: 'criar-conta', lancamentoId: lancamento.id,
      descricao: novaConta.descricao, categoriaConta: novaConta.categoriaConta,
      fornecedorId: novaConta.fornecedorId, responsavelId: novaConta.responsavelId || null,
    });
    if (ok) setAberto('');
  }

  if (lancamento.tipo === 'entrada') {
    return <span className="muted">Entrada — fora da conciliação nesta fase</span>;
  }

  if (lancamento.status === 'conciliado') {
    return (
      <button className="btn secondary small" disabled={ocupado}
        onClick={() => { if (confirm('Desfazer esta conciliação?')) chamar({ acao: 'desfazer', lancamentoId: lancamento.id }); }}>
        {ocupado ? 'Desfazendo…' : 'Desfazer'}
      </button>
    );
  }

  return (
    <>
      <div className="row-actions">
        {lancamento.status === 'sugerido' && lancamento.parcela_sugerida && (
          <>
            <span className="muted" style={{ marginRight: 8 }}>
              {lancamento.parcela_sugerida.contas_a_pagar?.fornecedores?.nome} ·{' '}
              {fmtMoney(lancamento.parcela_sugerida.valor)} · vence{' '}
              {fmtDate(lancamento.parcela_sugerida.vencimento)}
            </span>
            <button className="btn small" disabled={ocupado} onClick={confirmarSugestao}>
              {ocupado ? '…' : 'Confirmar'}
            </button>
          </>
        )}
        <button className="btn secondary small" disabled={ocupado} onClick={abrirAssociar}>
          {lancamento.status === 'sugerido' ? 'Trocar' : 'Associar'}
        </button>
      </div>

      {aberto === 'associar' && (
        <div className="items-list" style={{ marginTop: 8 }}>
          {!candidatos.length && (
            <div className="item-line muted">
              Nenhuma parcela em aberto casa com este valor e data. Crie a conta a pagar abaixo.
            </div>
          )}
          {candidatos.map(c => {
            const p = parcelasPorId[c.parcelaId];
            const contaPagar = comoObjeto(p?.contas_a_pagar);
            return (
              <div className="item-line" key={c.parcelaId}>
                <span>
                  {contaPagar?.fornecedores?.nome || '—'} · {contaPagar?.descricao} ·{' '}
                  {fmtMoney(p?.valor)} · vence {fmtDate(p?.vencimento)}
                  <span className="muted"> — {c.motivos.join(', ')}</span>
                </span>
                <button className="btn small" disabled={ocupado}
                  onClick={() => confirmarParcela(c.parcelaId)}>Conciliar</button>
              </div>
            );
          })}

          <div className="item-line" style={{ display: 'block' }}>
            <strong>Criar conta a pagar para esta saída</strong>
            <div className="form-grid" style={{ marginTop: 8 }}>
              <div>
                <label>Descrição</label>
                <input value={novaConta?.descricao || ''}
                  onChange={e => setNovaConta({ ...novaConta, descricao: e.target.value })} />
              </div>
              <div>
                <label>Categoria</label>
                <select value={novaConta?.categoriaConta || ''}
                  onChange={e => setNovaConta({ ...novaConta, categoriaConta: e.target.value })}>
                  {CATEGORIAS_CONTA.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label>Fornecedor</label>
                <select value={novaConta?.fornecedorId || ''}
                  onChange={e => setNovaConta({ ...novaConta, fornecedorId: e.target.value })}>
                  <option value="">Escolha…</option>
                  {(fornecedores || []).filter(f => f.ativo !== false)
                    .map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
                </select>
              </div>
              <div>
                <label>Responsável</label>
                <select value={novaConta?.responsavelId || ''}
                  onChange={e => setNovaConta({ ...novaConta, responsavelId: e.target.value })}>
                  <option value="">—</option>
                  {(funcionarios || []).map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
                </select>
              </div>
              <div style={{ alignSelf: 'end' }}>
                <button className="btn" disabled={ocupado} onClick={criar}>
                  {ocupado ? 'Criando…' : 'Criar e conciliar'}
                </button>
              </div>
            </div>
            <p className="muted" style={{ marginTop: 6 }}>
              A conta nasce com uma parcela única já paga em {fmtDate(lancamento.data)}, no valor de{' '}
              {fmtMoney(lancamento.valor)}.
            </p>
          </div>

          <div className="item-line">
            <button className="btn secondary small" onClick={() => setAberto('')}>Fechar</button>
          </div>
        </div>
      )}
    </>
  );
}
