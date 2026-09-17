'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';
import { fmtMoney, fmtDate, hoje } from '../../../lib/format';
import { FORMAS_PAGAMENTO, isVencida } from '../../../lib/financeiro';
import { signedUrlRecebimento } from '../../../lib/storage';
import { arquivosDaNota } from '../../../lib/nfe/arquivos';
import AppShell from '../../../components/AppShell';
import CondicoesPagamento from '../../../components/CondicoesPagamento';
import { useEmpresaAtual } from '../../../lib/empresa';

// Diferente de contas_a_pagar (bucket 'recebimentos', prefixo de pasta
// 'contas-a-pagar/'), aqui não existe uma uploadArquivoContaAReceber em
// lib/storage.js — esta task só pode criar este arquivo. O upload do
// comprovante de recebimento é feito diretamente aqui, no mesmo bucket
// privado 'recebimentos' (a policy de storage só olha o primeiro segmento do
// path, que é o empresa_id — ver atualizacao_09_recebimento_qualidade.sql),
// só que na pasta 'contas-a-receber/' em vez de 'contas-a-pagar/'. A leitura
// (signed URL) já é genérica o bastante — signedUrlRecebimento serve tanto
// para o comprovante quanto para os arquivos da NF-e (xml/nfeProc).
const BUCKET_RECEBIMENTOS = 'recebimentos';

function extensaoSegura(nomeArquivo) {
  const m = /\.([a-zA-Z0-9]+)$/.exec(nomeArquivo || '');
  return (m ? m[1] : 'bin').toLowerCase();
}

async function uploadComprovanteRecebimento(empresaId, parcelaId, file) {
  const ext = extensaoSegura(file.name);
  const path = `${empresaId}/contas-a-receber/${parcelaId}/comprovante-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET_RECEBIMENTOS).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) throw error;
  return path;
}

export default function ContasAReceberPage() {
  return (
    <AppShell modulo="financeiro" titulo="Financeiro" desc="Contas a receber">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const router = useRouter();
  const { empresaAtual } = useEmpresaAtual();
  const [lista, setLista] = useState([]);
  const [condicoesPagamento, setCondicoesPagamento] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erroCarregar, setErroCarregar] = useState('');
  const [baixaAtiva, setBaixaAtiva] = useState(null);

  const [filtroStatus, setFiltroStatus] = useState('');
  const [filtroCliente, setFiltroCliente] = useState('');
  const [filtroVencDe, setFiltroVencDe] = useState('');
  const [filtroVencAte, setFiltroVencAte] = useState('');

  // Toda conta a receber nasce da emissão de uma NF-e de saída (Task 11) —
  // não existe lançamento manual nesta tela, por isso não há formulário nem
  // dependência de carregar um cadastro auxiliar (fornecedores/categorias)
  // antes de mostrar a lista, ao contrário de contas-a-pagar.
  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    setErroCarregar('');
    const { data, error } = await supabase.from('contas_a_receber')
      .select('*, clientes(nome), responsavel:funcionarios(nome), nfe_saida_documentos(chave, numero, xml_path, nfeproc_path), contas_a_receber_parcelas(*)')
      .eq('empresa_id', empresaAtual.id)
      .order('created_at', { ascending: false });
    if (error) { setErroCarregar(error.message); setLoading(false); return; }
    setLista(data || []);
    setLoading(false);
  }

  // Independente de carregar(): uma falha aqui (ex.: migração 53 ainda não
  // aplicada neste ambiente) não pode derrubar a lista de contas a receber,
  // só a seção de condições de pagamento fica vazia.
  async function carregarCondicoesPagamento() {
    if (!empresaAtual) return;
    const { data, error } = await supabase.from('condicoes_pagamento')
      .select('id, nome, numero_parcelas, intervalo_dias, ativo')
      .eq('empresa_id', empresaAtual.id).order('nome');
    setCondicoesPagamento(error ? [] : (data || []));
  }

  useEffect(() => { carregar(); carregarCondicoesPagamento(); }, [empresaAtual?.id]);

  function abrirBaixa(parcela) {
    setBaixaAtiva({ parcelaId: parcela.id, data_recebimento: hoje(), forma_recebimento: FORMAS_PAGAMENTO[0], comprovanteArquivo: null });
  }

  async function confirmarBaixa() {
    const { parcelaId, data_recebimento, forma_recebimento, comprovanteArquivo } = baixaAtiva;
    let comprovante_path = null;
    if (comprovanteArquivo) {
      try {
        comprovante_path = await uploadComprovanteRecebimento(empresaAtual.id, parcelaId, comprovanteArquivo);
      } catch (upErr) {
        alert('Erro ao enviar comprovante: ' + upErr.message);
        return;
      }
    }
    const { error } = await supabase.from('contas_a_receber_parcelas').update({
      status: 'Recebido', data_recebimento, forma_recebimento, comprovante_path,
    }).eq('id', parcelaId);
    if (error) { alert('Erro ao dar baixa: ' + error.message); return; }
    setBaixaAtiva(null);
    carregar();
  }

  async function verArquivo(path) {
    if (!path) return;
    try {
      const url = await signedUrlRecebimento(path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      alert('Não foi possível abrir o arquivo: ' + err.message);
    }
  }

  if (loading) return <p className="muted">Carregando…</p>;
  if (erroCarregar) return <p className="erro">{erroCarregar}</p>;

  // Lista de clientes para o filtro é derivada das próprias contas
  // carregadas (não existe cadastro auxiliar a buscar à parte, como
  // fornecedores em contas-a-pagar): só interessa quem já tem conta a
  // receber nesta empresa.
  const clientesDaLista = Array.from(
    new Map(lista.filter(c => c.cliente_id).map(c => [c.cliente_id, c.clientes?.nome || '—'])).entries()
  ).sort((a, b) => a[1].localeCompare(b[1]));

  const parcelasFlat = lista.flatMap(c => (c.contas_a_receber_parcelas || []).map(p => ({ ...p, conta: c })));
  const parcelasFiltradas = parcelasFlat
    .filter(p => {
      const vencida = isVencida(p);
      if (filtroStatus === 'Vencida' && !vencida) return false;
      if (filtroStatus === 'Pendente' && (p.status !== 'Pendente' || vencida)) return false;
      if (filtroStatus === 'Recebido' && p.status !== 'Recebido') return false;
      if (filtroCliente && p.conta.cliente_id !== filtroCliente) return false;
      if (filtroVencDe && p.vencimento < filtroVencDe) return false;
      if (filtroVencAte && p.vencimento > filtroVencAte) return false;
      return true;
    })
    .sort((a, b) => (a.vencimento < b.vencimento ? -1 : 1));

  return (
    <>
    <CondicoesPagamento empresaId={empresaAtual.id} condicoes={condicoesPagamento} onAtualizar={carregarCondicoesPagamento} />
    <div className="panel">
      <h3>Contas a receber ({parcelasFiltradas.length})</h3>
      <div className="form-grid" style={{ marginBottom: 12 }}>
        <div><label>Status</label>
          <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}>
            <option value="">Todas</option>
            <option value="Pendente">Pendente</option>
            <option value="Vencida">Vencida</option>
            <option value="Recebido">Recebido</option>
          </select>
        </div>
        <div><label>Cliente</label>
          <select value={filtroCliente} onChange={e => setFiltroCliente(e.target.value)}>
            <option value="">Todos</option>
            {clientesDaLista.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
          </select>
        </div>
        <div><label>Vencimento de</label>
          <input type="date" value={filtroVencDe} onChange={e => setFiltroVencDe(e.target.value)} />
        </div>
        <div><label>Vencimento até</label>
          <input type="date" value={filtroVencAte} onChange={e => setFiltroVencAte(e.target.value)} />
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Vencimento</th><th>Descrição</th><th>Cliente</th><th>Parcela</th><th>Valor</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {parcelasFiltradas.length ? parcelasFiltradas.map(p => {
              const vencida = isVencida(p);
              const tagStatus = p.status === 'Recebido' ? 'ok' : vencida ? 'bad' : 'warn';
              const totalParcelas = (p.conta.contas_a_receber_parcelas || []).length;
              // Arquivo principal da NF-e de origem — mesma prioridade de
              // app/pedidos/[id]/page.js: nfeProc (assinado + protocolo) antes
              // do XML sozinho, quando os dois existem.
              const arquivosNota = arquivosDaNota(p.conta.nfe_saida_documentos || {});
              const arquivoPrincipal = arquivosNota.find(a => a.principal) || arquivosNota[0];
              return (
                <tr key={p.id}>
                  <td>{fmtDate(p.vencimento)}</td>
                  <td>{p.conta.descricao}</td>
                  <td className="muted">{p.conta.clientes?.nome || '—'}</td>
                  <td className="num">{p.numero}/{totalParcelas}</td>
                  <td className="num">{fmtMoney(p.valor)}</td>
                  <td><span className={`tag ${tagStatus}`}>{p.status === 'Recebido' ? 'Recebido' : vencida ? 'Vencida' : 'Pendente'}</span></td>
                  <td>
                    <div className="row-actions">
                      {p.status === 'Pendente' && (
                        <button className="btn secondary small" onClick={() => abrirBaixa(p)}>Dar baixa</button>
                      )}
                      <button className="btn secondary small" onClick={() => router.push(`/pedidos/${p.conta.pedido_id}`)}>Ver pedido</button>
                      <button className="btn secondary small" disabled={!arquivoPrincipal} onClick={() => verArquivo(arquivoPrincipal?.path)}>Ver NF-e</button>
                      <button className="btn secondary small" disabled={!p.comprovante_path} onClick={() => verArquivo(p.comprovante_path)}>Ver comprovante</button>
                    </div>
                    {baixaAtiva?.parcelaId === p.id && (
                      <div className="items-list" style={{ marginTop: 8 }}>
                        <div className="form-grid">
                          <div><label>Data do recebimento</label>
                            <input type="date" value={baixaAtiva.data_recebimento} onChange={e => setBaixaAtiva({ ...baixaAtiva, data_recebimento: e.target.value })} />
                          </div>
                          <div><label>Forma de recebimento</label>
                            <select value={baixaAtiva.forma_recebimento} onChange={e => setBaixaAtiva({ ...baixaAtiva, forma_recebimento: e.target.value })}>
                              {FORMAS_PAGAMENTO.map(f => <option key={f}>{f}</option>)}
                            </select>
                          </div>
                          <div><label>Comprovante (opcional)</label>
                            <input type="file" accept="application/pdf,image/*" onChange={e => setBaixaAtiva({ ...baixaAtiva, comprovanteArquivo: e.target.files?.[0] || null })} />
                          </div>
                          <div className="row-actions">
                            <button className="btn small" onClick={confirmarBaixa}>Confirmar recebimento</button>
                            <button className="btn secondary small" onClick={() => setBaixaAtiva(null)}>Cancelar</button>
                          </div>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              );
            }) : <tr className="empty-row"><td colSpan={7}>Nenhuma conta a receber encontrada.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
    </>
  );
}
