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
export default function AcoesConciliacao({
  lancamento, empresaId, fornecedores, funcionarios, tipoImportacao, onMudou,
}) {
  const [aberto, setAberto] = useState('');   // '' | 'associar' | 'criar'
  const [ocupado, setOcupado] = useState(false);
  const [candidatos, setCandidatos] = useState([]);
  const [parcelasPorId, setParcelasPorId] = useState({});
  const [novaConta, setNovaConta] = useState(null);

  const ehLinhaDeFatura = tipoImportacao === 'fatura_cartao';

  // Devolve o corpo da resposta (não um booleano) porque nem toda resposta
  // 200 é sucesso: confirmar-lote responde 200 com { confirmados, falhas } e
  // quem chama precisa olhar `falhas`. Null é a falha propriamente dita — os
  // `if (ok)` de quem chama continuam valendo.
  async function chamar(corpo) {
    setOcupado(true);
    try {
      const r = await chamarApi('/api/financeiro/conciliacao', {
        method: 'POST', body: JSON.stringify(corpo),
      });
      const j = await r.json();
      if (!r.ok) { alert(j.error || 'Não foi possível concluir a ação.'); return null; }
      await onMudou();
      return j;
    } catch (e) {
      alert('Falha: ' + e.message);
      return null;
    } finally {
      setOcupado(false);
    }
  }

  // Ranqueia as parcelas em aberto com a mesma régua da importação, para o
  // colaborador ver primeiro o candidato mais provável.
  async function abrirAssociar() {
    setOcupado(true);
    try {
      const [rp, rpad, rvinc] = await Promise.all([
        supabase.from('contas_a_pagar_parcelas')
          .select('id, valor, vencimento, contas_a_pagar(descricao, fornecedor_id, categoria_conta, fornecedores(nome))')
          .eq('empresa_id', empresaId).eq('status', 'Pendente'),
        supabase.from('conciliacao_padroes').select('fornecedor_id, categoria_conta')
          .eq('empresa_id', empresaId).eq('padrao', lancamento.descricao_normalizada).maybeSingle(),
        // Mesma exclusão de lib/extratosServer.js: parcela que já tem vínculo
        // não pode ser oferecida de novo. Filtrar por status = 'Pendente' não
        // basta — a linha de fatura de cartão concilia deixando a parcela em
        // aberto de propósito, e ela reaparecia aqui como candidata livre.
        supabase.from('conciliacao_vinculos').select('parcela_id').eq('empresa_id', empresaId),
      ]);
      // Erro engolido aqui vira "nenhuma parcela casa com este valor", e a
      // tela manda criar uma conta a pagar que na verdade já existe: a mesma
      // despesa lançada duas vezes por causa de um timeout.
      if (rp.error) {
        alert('Não consegui ler as parcelas em aberto: ' + rp.error.message
          + '\n\nTente de novo antes de criar qualquer conta a pagar por aqui.');
        return;
      }
      if (rvinc.error) {
        alert('Não consegui conferir quais parcelas já estão conciliadas: ' + rvinc.error.message
          + '\n\nTente de novo — sem essa conferência a tela pode oferecer uma parcela que '
          + 'outro lançamento já pagou.');
        return;
      }
      if (rpad.error) {
        alert('Não consegui ler o fornecedor aprendido para esta descrição: ' + rpad.error.message
          + '\n\nOs candidatos abaixo vão aparecer sem esse desempate.');
      }
      const vinculadas = new Set((rvinc.data || []).map(v => v.parcela_id));
      const emAberto = (rp.data || []).filter(p => !vinculadas.has(p.id));
      const parcelas = emAberto.map(p => ({
        id: p.id, valor: Number(p.valor), vencimento: p.vencimento,
        fornecedorId: comoObjeto(p.contas_a_pagar)?.fornecedor_id || null,
      }));
      const mapa = {};
      for (const p of emAberto) mapa[p.id] = p;
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
  //
  // confirmar-lote responde 200 mesmo quando o item falha — o lote existe para
  // que um erro não derrube os outros. Aqui o "lote" é de um só, e sem olhar
  // `falhas` o clique não produzia mensagem nenhuma: a linha continuava
  // "Sugerido" e o colaborador clicava para sempre, sem explicação. A barra de
  // lote da tela já inspeciona essa mesma resposta; esta postura é a dela.
  async function confirmarSugestao() {
    const j = await chamar({ acao: 'confirmar-lote', lancamentoIds: [lancamento.id] });
    if (j?.falhas?.length) {
      alert('Não foi possível confirmar esta sugestão:\n\n' + j.falhas[0].erro);
    }
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
          {/* Candidato exige valor exatamente igual, e a confirmação manda uma
              parcela só. Então o débito único que paga três boletos não casa
              com nada — e mandar "crie a conta a pagar abaixo" como se fosse a
              saída natural faz o colaborador criar uma QUARTA conta a pagar
              enquanto as três reais continuam em aberto: a mesma despesa
              lançada duas vezes. Enquanto a seleção de várias parcelas não
              existe nesta tela, o texto tem que dizer isso. */}
          {!candidatos.length && (
            <div className="item-line muted" style={{ display: 'block' }}>
              Nenhuma parcela em aberto casa com este valor e data.
              <br />
              Se este débito pagou <strong>vários boletos de uma vez</strong>, esta tela ainda não
              associa um lançamento a mais de uma parcela — dê baixa nelas por Financeiro › Contas
              a Pagar e deixe esta linha como está.
              <br />
              Só crie a conta a pagar abaixo se a despesa <strong>realmente ainda não estiver
              lançada</strong>: criá-la para um boleto que já existe conta a mesma despesa duas vezes.
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
            {/* A promessa muda com o tipo do documento, e a diferença é a
                regra inteira do cartão: compra da fatura não baixa parcela,
                porque o dinheiro ainda não saiu do banco. Quem baixa é o
                pagamento da fatura. */}
            <p className="muted" style={{ marginTop: 6 }}>
              {ehLinhaDeFatura ? (
                <>
                  Esta é uma compra da fatura do cartão: a conta nasce com uma parcela única{' '}
                  <strong>ainda em aberto</strong>, vencendo em {fmtDate(lancamento.data)}, no valor
                  de {fmtMoney(lancamento.valor)}. Ela é baixada mais tarde, quando o pagamento da
                  fatura for conciliado no extrato da conta corrente — é o que impede a mesma
                  despesa de ser contada duas vezes.
                </>
              ) : (
                <>
                  A conta nasce com uma parcela única já paga em {fmtDate(lancamento.data)}, no
                  valor de {fmtMoney(lancamento.valor)}.
                </>
              )}
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
