'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { fmtMoney, fmtDate, hoje } from '../../../lib/format';
import { CATEGORIAS_CONTA, FORMAS_PAGAMENTO, gerarParcelas, isVencida } from '../../../lib/financeiro';
import { uploadArquivoContaAPagar, signedUrlContaAPagar } from '../../../lib/storage';
import AppShell from '../../../components/AppShell';
import { useEmpresaAtual } from '../../../lib/empresa';

const LANCAMENTO_VAZIO = () => ({
  descricao: '', categoria_conta: CATEGORIAS_CONTA[0], fornecedor_id: '',
  nota_fiscal_numero: '', notaFiscalArquivo: null,
  data: hoje(), valor_total: '', responsavel_id: '',
  condicao_pagamento: 'À vista', numero_parcelas: 2, intervalo_dias: 30,
});

export default function ContasAPagarPage() {
  return (
    <AppShell modulo="financeiro" titulo="Financeiro" desc="Categorias de conta e contas a pagar">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const { empresaAtual } = useEmpresaAtual();
  const [lista, setLista] = useState([]);
  const [fornecedores, setFornecedores] = useState([]);
  const [funcionarios, setFuncionarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [lancamento, setLancamento] = useState(LANCAMENTO_VAZIO());
  const [baixaAtiva, setBaixaAtiva] = useState(null);

  const [filtroStatus, setFiltroStatus] = useState('');
  const [filtroCategoria, setFiltroCategoria] = useState('');
  const [filtroFornecedor, setFiltroFornecedor] = useState('');

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    const [r1, r2, r3] = await Promise.all([
      supabase.from('contas_a_pagar')
        .select('*, fornecedores(nome), responsavel:funcionarios(nome), recebimentos(data, nota_fiscal), contas_a_pagar_parcelas(*)')
        .eq('empresa_id', empresaAtual.id)
        .order('created_at', { ascending: false }),
      // select('*') em vez de lista de colunas: se `ativo` ainda não existir
      // (migração 26 pendente), uma projeção que citasse a coluna pelo nome
      // devolveria erro 42703 do PostgREST e vazaria a tela inteira. Com '*' a
      // coluna some do objeto quando não existe, `ativo` vira undefined e
      // `ativo !== false` continua mostrando o registro — sem quebrar nada.
      // Voltar para `select('id, nome')` é pior ainda: desliga o filtro de
      // inativos em silêncio, sem erro nenhum e sem teste que pegue.
      supabase.from('fornecedores').select('*').eq('empresa_id', empresaAtual.id).order('nome'),
      supabase.from('funcionarios').select('id, nome').eq('empresa_id', empresaAtual.id).eq('ativo', true).order('nome'),
    ]);
    if (r1.error) console.error(r1.error);
    setLista(r1.data || []);
    setFornecedores(r2.data || []);
    setFuncionarios(r3.data || []);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  function origemConta(c) {
    if (c.recebimento_id) return 'Recebimento';
    if (c.nota_fiscal_numero) return 'Nota fiscal avulsa';
    return 'Despesa manual';
  }

  async function registrarConta(e) {
    e.preventDefault();
    if (!lancamento.descricao || !lancamento.fornecedor_id || !lancamento.valor_total) {
      alert('Preencha descrição, fornecedor e valor.');
      return;
    }
    setSalvando(true);
    try {
      const { data: conta, error } = await supabase.from('contas_a_pagar').insert([{
        descricao: lancamento.descricao,
        categoria_conta: lancamento.categoria_conta,
        fornecedor_id: lancamento.fornecedor_id,
        nota_fiscal_numero: lancamento.nota_fiscal_numero || null,
        valor_total: Number(lancamento.valor_total),
        responsavel_id: lancamento.responsavel_id || null,
        empresa_id: empresaAtual.id,
      }]).select('id').single();

      if (error) { alert('Erro ao salvar: ' + error.message); return; }

      if (lancamento.notaFiscalArquivo) {
        try {
          const path = await uploadArquivoContaAPagar(empresaAtual.id, conta.id, 'nota-fiscal', lancamento.notaFiscalArquivo);
          await supabase.from('contas_a_pagar').update({ nota_fiscal_anexo_path: path }).eq('id', conta.id);
        } catch (upErr) {
          alert('Conta salva, mas o anexo da nota fiscal falhou: ' + upErr.message);
        }
      }

      const numeroParcelas = lancamento.condicao_pagamento === 'Parcelado' ? Number(lancamento.numero_parcelas) : 1;
      const parcelas = gerarParcelas(lancamento.data, Number(lancamento.valor_total), numeroParcelas, Number(lancamento.intervalo_dias));
      const { error: e2 } = await supabase.from('contas_a_pagar_parcelas').insert(
        parcelas.map(p => ({
          conta_a_pagar_id: conta.id, numero: p.numero, valor: p.valor, vencimento: p.vencimento,
          empresa_id: empresaAtual.id,
        }))
      );
      if (e2) {
        await supabase.from('contas_a_pagar').delete().eq('id', conta.id);
        alert('Erro ao gerar as parcelas — o lançamento foi desfeito, tente novamente: ' + e2.message);
        carregar();
        return;
      }

      setLancamento(LANCAMENTO_VAZIO());
      carregar();
    } finally {
      setSalvando(false);
    }
  }

  function abrirBaixa(parcela) {
    setBaixaAtiva({ parcelaId: parcela.id, data_pagamento: hoje(), forma_pagamento: FORMAS_PAGAMENTO[0], comprovanteArquivo: null });
  }

  async function confirmarBaixa() {
    const { parcelaId, data_pagamento, forma_pagamento, comprovanteArquivo } = baixaAtiva;
    let comprovante_path = null;
    if (comprovanteArquivo) {
      try {
        comprovante_path = await uploadArquivoContaAPagar(empresaAtual.id, parcelaId, 'comprovante', comprovanteArquivo);
      } catch (upErr) {
        alert('Erro ao enviar comprovante: ' + upErr.message);
        return;
      }
    }
    const { error } = await supabase.from('contas_a_pagar_parcelas').update({
      status: 'Pago', data_pagamento, forma_pagamento, comprovante_path,
    }).eq('id', parcelaId);
    if (error) { alert('Erro ao dar baixa: ' + error.message); return; }
    setBaixaAtiva(null);
    carregar();
  }

  async function verAnexo(path) {
    if (!path) return;
    try {
      const url = await signedUrlContaAPagar(path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      alert('Não foi possível abrir o anexo: ' + err.message);
    }
  }

  if (loading) return <p className="muted">Carregando…</p>;

  if (!fornecedores.length) {
    return (
      <div className="banner info">
        Cadastre ao menos um <b>fornecedor</b> antes de lançar uma conta a pagar.
      </div>
    );
  }

  const parcelasFlat = lista.flatMap(c => (c.contas_a_pagar_parcelas || []).map(p => ({ ...p, conta: c })));
  const parcelasFiltradas = parcelasFlat
    .filter(p => {
      const vencida = isVencida(p);
      if (filtroStatus === 'Vencida' && !vencida) return false;
      if (filtroStatus === 'Pendente' && (p.status !== 'Pendente' || vencida)) return false;
      if (filtroStatus === 'Pago' && p.status !== 'Pago') return false;
      if (filtroCategoria && p.conta.categoria_conta !== filtroCategoria) return false;
      if (filtroFornecedor && p.conta.fornecedor_id !== filtroFornecedor) return false;
      return true;
    })
    .sort((a, b) => (a.vencimento < b.vencimento ? -1 : 1));

  return (
    <>
      <div className="panel">
        <h3>Lançar conta a pagar</h3>
        <form onSubmit={registrarConta} className="form-grid">
          <div><label>Descrição</label>
            <input required placeholder="Aluguel, energia, serviço..." value={lancamento.descricao}
              onChange={e => setLancamento({ ...lancamento, descricao: e.target.value })} />
          </div>
          <div><label>Categoria</label>
            <select value={lancamento.categoria_conta} onChange={e => setLancamento({ ...lancamento, categoria_conta: e.target.value })}>
              {CATEGORIAS_CONTA.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div><label>Fornecedor</label>
            <select required value={lancamento.fornecedor_id} onChange={e => setLancamento({ ...lancamento, fornecedor_id: e.target.value })}>
              <option value="">Selecione…</option>
              {fornecedores
                .filter(f => f.ativo !== false || f.id === lancamento.fornecedor_id)
                .map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </div>
          <div><label>Nota fiscal (nº, opcional)</label>
            <input value={lancamento.nota_fiscal_numero} onChange={e => setLancamento({ ...lancamento, nota_fiscal_numero: e.target.value })} />
          </div>
          <div><label>Anexo da nota fiscal (opcional)</label>
            <input type="file" accept="application/pdf,image/*" onChange={e => setLancamento({ ...lancamento, notaFiscalArquivo: e.target.files?.[0] || null })} />
          </div>
          <div><label>Data</label>
            <input type="date" value={lancamento.data} onChange={e => setLancamento({ ...lancamento, data: e.target.value })} />
          </div>
          <div><label>Valor total (R$)</label>
            <input type="number" step="0.01" required value={lancamento.valor_total} onChange={e => setLancamento({ ...lancamento, valor_total: e.target.value })} />
          </div>
          <div><label>Responsável</label>
            <select value={lancamento.responsavel_id} onChange={e => setLancamento({ ...lancamento, responsavel_id: e.target.value })}>
              <option value="">Selecione…</option>
              {funcionarios.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </div>
          <div><label>Condição de pagamento</label>
            <select value={lancamento.condicao_pagamento} onChange={e => setLancamento({ ...lancamento, condicao_pagamento: e.target.value })}>
              <option>À vista</option>
              <option>Parcelado</option>
            </select>
          </div>
          {lancamento.condicao_pagamento === 'Parcelado' && (
            <>
              <div><label>Nº de parcelas</label>
                <input type="number" min="2" value={lancamento.numero_parcelas} onChange={e => setLancamento({ ...lancamento, numero_parcelas: e.target.value })} />
              </div>
              <div><label>Intervalo entre parcelas (dias)</label>
                <input type="number" min="1" value={lancamento.intervalo_dias} onChange={e => setLancamento({ ...lancamento, intervalo_dias: e.target.value })} />
              </div>
            </>
          )}
          <div><button className="btn" type="submit" disabled={salvando}>{salvando ? 'Lançando…' : 'Lançar conta'}</button></div>
        </form>
      </div>

      <div className="panel">
        <h3>Contas a pagar ({parcelasFiltradas.length})</h3>
        <div className="form-grid" style={{ marginBottom: 12 }}>
          <div><label>Status</label>
            <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}>
              <option value="">Todas</option>
              <option value="Pendente">Pendente</option>
              <option value="Vencida">Vencida</option>
              <option value="Pago">Pago</option>
            </select>
          </div>
          <div><label>Categoria</label>
            <select value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value)}>
              <option value="">Todas</option>
              {CATEGORIAS_CONTA.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div><label>Fornecedor</label>
            <select value={filtroFornecedor} onChange={e => setFiltroFornecedor(e.target.value)}>
              <option value="">Todos</option>
              {fornecedores.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Vencimento</th><th>Descrição</th><th>Fornecedor</th><th>Categoria</th><th>Origem</th><th>Parcela</th><th>Valor</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {parcelasFiltradas.length ? parcelasFiltradas.map(p => {
                const vencida = isVencida(p);
                const tagStatus = p.status === 'Pago' ? 'ok' : vencida ? 'bad' : 'warn';
                const totalParcelas = (p.conta.contas_a_pagar_parcelas || []).length;
                return (
                  <tr key={p.id}>
                    <td>{fmtDate(p.vencimento)}</td>
                    <td>{p.conta.descricao}</td>
                    <td className="muted">{p.conta.fornecedores?.nome || '—'}</td>
                    <td className="muted">{p.conta.categoria_conta}</td>
                    <td className="muted">{origemConta(p.conta)}</td>
                    <td className="num">{p.numero}/{totalParcelas}</td>
                    <td className="num">{fmtMoney(p.valor)}</td>
                    <td><span className={`tag ${tagStatus}`}>{p.status === 'Pago' ? 'Pago' : vencida ? 'Vencida' : 'Pendente'}</span></td>
                    <td>
                      <div className="row-actions">
                        {p.status === 'Pendente' && (
                          <button className="btn secondary small" onClick={() => abrirBaixa(p)}>Dar baixa</button>
                        )}
                        <button className="btn secondary small" disabled={!p.conta.nota_fiscal_anexo_path} onClick={() => verAnexo(p.conta.nota_fiscal_anexo_path)}>Ver NF</button>
                        <button className="btn secondary small" disabled={!p.comprovante_path} onClick={() => verAnexo(p.comprovante_path)}>Ver comprovante</button>
                      </div>
                      {baixaAtiva?.parcelaId === p.id && (
                        <div className="items-list" style={{ marginTop: 8 }}>
                          <div className="form-grid">
                            <div><label>Data do pagamento</label>
                              <input type="date" value={baixaAtiva.data_pagamento} onChange={e => setBaixaAtiva({ ...baixaAtiva, data_pagamento: e.target.value })} />
                            </div>
                            <div><label>Forma de pagamento</label>
                              <select value={baixaAtiva.forma_pagamento} onChange={e => setBaixaAtiva({ ...baixaAtiva, forma_pagamento: e.target.value })}>
                                {FORMAS_PAGAMENTO.map(f => <option key={f}>{f}</option>)}
                              </select>
                            </div>
                            <div><label>Comprovante (opcional)</label>
                              <input type="file" accept="application/pdf,image/*" onChange={e => setBaixaAtiva({ ...baixaAtiva, comprovanteArquivo: e.target.files?.[0] || null })} />
                            </div>
                            <div className="row-actions">
                              <button className="btn small" onClick={confirmarBaixa}>Confirmar pagamento</button>
                              <button className="btn secondary small" onClick={() => setBaixaAtiva(null)}>Cancelar</button>
                            </div>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              }) : <tr className="empty-row"><td colSpan={9}>Nenhuma conta a pagar encontrada.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
