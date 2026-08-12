'use client';
import { useEffect, useState, Fragment } from 'react';
import { supabase } from '../../lib/supabase';
import { fmtMoney, fmtDate, hoje, proximoLote } from '../../lib/format';
import { uploadArquivoRecebimento, signedUrlRecebimento, removerAnexosRecebimento } from '../../lib/storage';
import AppShell from '../../components/AppShell';
import FichaPrint, { imprimirFicha } from '../../components/FichaPrint';
import { useEmpresaAtual } from '../../lib/empresa';

const CONDICOES_EMBALAGEM = ['Íntegra', 'Danificada', 'Violada', 'Amassada', 'Outra'];
const STATUS_OPCOES = ['Aceito', 'Aceito com ressalva', 'Rejeitado'];

const CABECALHO_VAZIO = () => ({
  data: hoje(), fornecedor_id: '', nota_fiscal: '', responsavel_id: '',
  temperatura_c: '', notaFiscalArquivo: null,
});

const ITEM_VAZIO = () => ({
  materia_prima_id: '', numero_lote_fornecedor: '', quantidade: '', peso_nota_kg: '',
  custo_unitario: '', condicao_embalagem: 'Íntegra', status_recebimento: 'Aceito',
  local_armazenamento: '', validade: '', aprovado_por_id: '', fotoProdutoArquivo: null,
});

export default function RecebimentosPage() {
  const [ficha, setFicha] = useState(null);
  return (
    <>
      <AppShell modulo="recebimentos" titulo="Recebimento" desc="Entrada de mercadoria por nota (múltiplas matérias-primas), controle de qualidade e geração de lotes">
        <Conteudo setFicha={setFicha} />
      </AppShell>
      <FichaPrint ficha={ficha} />
    </>
  );
}

function Conteudo({ setFicha }) {
  const { empresaAtual } = useEmpresaAtual();
  const [lista, setLista] = useState([]);
  const [mps, setMps] = useState([]);
  const [fornecedores, setFornecedores] = useState([]);
  const [funcionarios, setFuncionarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [expandido, setExpandido] = useState({});

  const [cabecalho, setCabecalho] = useState(CABECALHO_VAZIO());
  const [itensDraft, setItensDraft] = useState([]);
  const [novoItem, setNovoItem] = useState(ITEM_VAZIO());

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    const [r1, r2, r3, r4] = await Promise.all([
      supabase.from('recebimentos')
        .select('*, fornecedores(nome), responsavel:funcionarios!recebimentos_responsavel_id_fkey(nome), recebimento_itens(*, materias_primas(nome, unidade, preco_alvo_kg), aprovado_por:funcionarios!recebimento_itens_aprovado_por_id_fkey(nome))')
        .eq('empresa_id', empresaAtual.id)
        .order('created_at', { ascending: false }),
      supabase.from('materias_primas').select('*').eq('empresa_id', empresaAtual.id).order('nome'),
      supabase.from('fornecedores').select('id, nome').eq('empresa_id', empresaAtual.id).order('nome'),
      supabase.from('funcionarios').select('id, nome').eq('empresa_id', empresaAtual.id).eq('ativo', true).order('nome'),
    ]);
    if (r1.error) console.error(r1.error);
    setLista(r1.data || []);
    setMps(r2.data || []);
    setFornecedores(r3.data || []);
    setFuncionarios(r4.data || []);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  function addItemDraft(e) {
    e.preventDefault();
    if (!novoItem.materia_prima_id || !novoItem.quantidade || !novoItem.custo_unitario) return;
    setItensDraft([...itensDraft, novoItem]);
    setNovoItem(ITEM_VAZIO());
  }

  function removerItemDraft(idx) {
    setItensDraft(itensDraft.filter((_, i) => i !== idx));
  }

  async function registrarNota() {
    if (!itensDraft.length) { alert('Adicione ao menos uma matéria-prima à nota.'); return; }
    if (!cabecalho.fornecedor_id) { alert('Selecione o fornecedor.'); return; }
    setSalvando(true);
    try {
      const { data: nota, error } = await supabase.from('recebimentos').insert([{
        data: cabecalho.data,
        fornecedor_id: cabecalho.fornecedor_id,
        nota_fiscal: cabecalho.nota_fiscal || null,
        responsavel_id: cabecalho.responsavel_id || null,
        temperatura_c: cabecalho.temperatura_c ? Number(cabecalho.temperatura_c) : null,
        empresa_id: empresaAtual.id,
      }]).select('id').single();

      if (error) { alert('Erro ao salvar a nota: ' + error.message); return; }

      if (cabecalho.notaFiscalArquivo) {
        try {
          const path = await uploadArquivoRecebimento(empresaAtual.id, nota.id, 'nota-fiscal', cabecalho.notaFiscalArquivo);
          await supabase.from('recebimentos').update({ nota_fiscal_arquivo_url: path }).eq('id', nota.id);
        } catch (upErr) {
          alert('Nota salva, mas o anexo da nota fiscal falhou: ' + upErr.message);
        }
      }

      for (const item of itensDraft) {
        const lote = await proximoLote(cabecalho.data, empresaAtual.id);
        const { data: itemInserido, error: e2 } = await supabase.from('recebimento_itens').insert([{
          recebimento_id: nota.id,
          materia_prima_id: item.materia_prima_id,
          lote,
          numero_lote_fornecedor: item.numero_lote_fornecedor || null,
          quantidade: Number(item.quantidade),
          peso_nota_kg: item.peso_nota_kg ? Number(item.peso_nota_kg) : null,
          custo_unitario: Number(item.custo_unitario),
          condicao_embalagem: item.condicao_embalagem || null,
          status_recebimento: item.status_recebimento,
          local_armazenamento: item.local_armazenamento || null,
          validade: item.validade || null,
          aprovado_por_id: item.aprovado_por_id || null,
          empresa_id: empresaAtual.id,
        }]).select('id').single();

        if (e2) { alert('Erro ao salvar um item da nota: ' + e2.message); continue; }

        if (item.fotoProdutoArquivo) {
          try {
            const path = await uploadArquivoRecebimento(empresaAtual.id, itemInserido.id, 'foto', item.fotoProdutoArquivo);
            await supabase.from('recebimento_itens').update({ foto_produto_url: path }).eq('id', itemInserido.id);
          } catch (upErr) {
            alert('Item salvo, mas a foto falhou: ' + upErr.message);
          }
        }
      }

      setCabecalho(CABECALHO_VAZIO());
      setItensDraft([]);
      carregar();
    } finally {
      setSalvando(false);
    }
  }

  async function excluirNota(r) {
    if (!confirm('Excluir esta nota inteira (todos os itens)? O saldo de estoque será recalculado.')) return;
    const fotos = (r.recebimento_itens || []).map(it => it.foto_produto_url);
    await removerAnexosRecebimento([r.nota_fiscal_arquivo_url, ...fotos]);
    const { error } = await supabase.from('recebimentos').delete().eq('id', r.id);
    if (error) alert('Erro ao excluir: ' + error.message);
    carregar();
  }

  async function excluirItem(item) {
    if (!confirm('Excluir esta matéria-prima da nota?')) return;
    await removerAnexosRecebimento([item.foto_produto_url]);
    const { error } = await supabase.from('recebimento_itens').delete().eq('id', item.id);
    if (error) alert('Erro ao excluir: ' + error.message);
    carregar();
  }

  async function verAnexo(path) {
    if (!path) return;
    try {
      const url = await signedUrlRecebimento(path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      alert('Não foi possível abrir o anexo: ' + err.message);
    }
  }

  function imprimir(r) {
    const itens = r.recebimento_itens || [];
    const totalGeral = itens.reduce((s, it) => s + Number(it.quantidade) * Number(it.custo_unitario), 0);
    imprimirFicha(setFicha, {
      titulo: 'Ficha de Recebimento de Mercadoria',
      numero: `Nota ${fmtDate(r.data)}${r.nota_fiscal ? ' · NF ' + r.nota_fiscal : ''}`,
      campos: [
        { rot: 'Data do recebimento', valor: fmtDate(r.data) },
        { rot: 'Fornecedor', valor: r.fornecedores?.nome },
        { rot: 'Nota fiscal (nº)', valor: r.nota_fiscal },
        { rot: 'Temperatura no recebimento', valor: r.temperatura_c != null ? `${r.temperatura_c} °C` : '—' },
        { rot: 'Recebido por', valor: r.responsavel?.nome },
      ],
      itens: {
        headers: ['Matéria-prima', 'Lote', 'Peso conferido', 'Peso nota', 'Custo unit.', 'Custo total', 'Status'],
        rows: itens.map(it => [
          it.materias_primas?.nome || '—',
          it.lote,
          `${Number(it.quantidade)} ${it.materias_primas?.unidade || ''}`,
          it.peso_nota_kg != null ? `${Number(it.peso_nota_kg)} ${it.materias_primas?.unidade || ''}` : '—',
          fmtMoney(it.custo_unitario),
          fmtMoney(Number(it.quantidade) * Number(it.custo_unitario)),
          it.status_recebimento,
        ]),
      },
      totais: `Total da nota: ${fmtMoney(totalGeral)}`,
      assinaturas: ['Responsável pelo recebimento', 'Aprovação da qualidade'],
    });
  }

  if (loading) return <p className="muted">Carregando…</p>;

  if (!mps.length || !fornecedores.length) {
    return (
      <div className="banner info">
        Cadastre ao menos um <b>fornecedor</b> e uma <b>matéria-prima</b> (aba Produtos) antes de lançar um recebimento.
      </div>
    );
  }

  const mpDraft = mps.find(m => m.id === novoItem.materia_prima_id);
  const alvoDraft = mpDraft?.preco_alvo_kg ? Number(mpDraft.preco_alvo_kg) : null;
  const custoAcimaDoAlvoDraft = alvoDraft && Number(novoItem.custo_unitario) > alvoDraft;
  const diffPesoDraft = novoItem.peso_nota_kg && novoItem.quantidade
    ? Number(novoItem.quantidade) - Number(novoItem.peso_nota_kg) : null;
  const divergePesoDraft = diffPesoDraft !== null && Math.abs(diffPesoDraft) > 0.01;

  return (
    <>
      <div className="panel">
        <h3>Nova nota de recebimento</h3>
        <div className="form-grid">
          <div><label>Data</label><input type="date" value={cabecalho.data} onChange={e => setCabecalho({ ...cabecalho, data: e.target.value })} /></div>
          <div><label>Fornecedor</label>
            <select value={cabecalho.fornecedor_id} onChange={e => setCabecalho({ ...cabecalho, fornecedor_id: e.target.value })}>
              <option value="">Selecione…</option>
              {fornecedores.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </div>
          <div><label>Nota fiscal (nº)</label><input value={cabecalho.nota_fiscal} onChange={e => setCabecalho({ ...cabecalho, nota_fiscal: e.target.value })} /></div>
          <div><label>Temperatura no recebimento (°C)</label><input type="number" step="0.1" value={cabecalho.temperatura_c} onChange={e => setCabecalho({ ...cabecalho, temperatura_c: e.target.value })} /></div>
          <div><label>Recebido por</label>
            <select value={cabecalho.responsavel_id} onChange={e => setCabecalho({ ...cabecalho, responsavel_id: e.target.value })}>
              <option value="">Selecione…</option>
              {funcionarios.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </div>
          <div><label>Anexo da nota fiscal (PDF ou imagem)</label>
            <input type="file" accept="application/pdf,image/*" onChange={e => setCabecalho({ ...cabecalho, notaFiscalArquivo: e.target.files?.[0] || null })} />
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <label>Matérias-primas desta nota</label>
          <form className="form-grid" onSubmit={addItemDraft}>
            <div><label>Matéria-prima</label>
              <select required value={novoItem.materia_prima_id} onChange={e => setNovoItem({ ...novoItem, materia_prima_id: e.target.value })}>
                <option value="">Selecione…</option>
                {mps.map(m => <option key={m.id} value={m.id}>{m.nome} ({m.unidade})</option>)}
              </select>
            </div>
            <div><label>Lote do fornecedor</label><input value={novoItem.numero_lote_fornecedor} onChange={e => setNovoItem({ ...novoItem, numero_lote_fornecedor: e.target.value })} /></div>
            <div><label>Peso conferido</label>
              <input type="number" step="0.001" required value={novoItem.quantidade} onChange={e => setNovoItem({ ...novoItem, quantidade: e.target.value })} />
              {divergePesoDraft && (
                <span style={{ display: 'block', marginTop: 4, fontSize: 11, color: 'var(--amber-bright)' }}>
                  ⚠ Diverge {diffPesoDraft > 0 ? '+' : ''}{diffPesoDraft.toFixed(3)} da nota
                </span>
              )}
            </div>
            <div><label>Peso na nota fiscal</label><input type="number" step="0.001" value={novoItem.peso_nota_kg} onChange={e => setNovoItem({ ...novoItem, peso_nota_kg: e.target.value })} /></div>
            <div>
              <label>Custo unitário (R$)</label>
              <input type="number" step="0.01" required value={novoItem.custo_unitario} onChange={e => setNovoItem({ ...novoItem, custo_unitario: e.target.value })} />
              {custoAcimaDoAlvoDraft && (
                <span style={{ display: 'block', marginTop: 4, fontSize: 11, color: 'var(--amber-bright)' }}>
                  ⚠ Acima do preço-alvo ({fmtMoney(alvoDraft)}/kg)
                </span>
              )}
            </div>
            <div><label>Condição da embalagem</label>
              <select value={novoItem.condicao_embalagem} onChange={e => setNovoItem({ ...novoItem, condicao_embalagem: e.target.value })}>
                {CONDICOES_EMBALAGEM.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div><label>Status do item</label>
              <select value={novoItem.status_recebimento} onChange={e => setNovoItem({ ...novoItem, status_recebimento: e.target.value })}>
                {STATUS_OPCOES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div><label>Local de armazenamento</label><input placeholder="Câmara fria 2..." value={novoItem.local_armazenamento} onChange={e => setNovoItem({ ...novoItem, local_armazenamento: e.target.value })} /></div>
            <div><label>Validade</label><input type="date" value={novoItem.validade} onChange={e => setNovoItem({ ...novoItem, validade: e.target.value })} /></div>
            <div><label>Aprovado por (qualidade)</label>
              <select value={novoItem.aprovado_por_id} onChange={e => setNovoItem({ ...novoItem, aprovado_por_id: e.target.value })}>
                <option value="">Selecione…</option>
                {funcionarios.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
              </select>
            </div>
            <div><label>Foto do produto</label>
              <input type="file" accept="image/*" onChange={e => setNovoItem({ ...novoItem, fotoProdutoArquivo: e.target.files?.[0] || null })} />
            </div>
            <div><button className="btn secondary" type="submit">Adicionar item à nota</button></div>
          </form>

          <div className="items-list">
            {itensDraft.length ? itensDraft.map((it, idx) => {
              const mp = mps.find(m => m.id === it.materia_prima_id);
              const tagStatus = it.status_recebimento === 'Rejeitado' ? 'bad' : it.status_recebimento === 'Aceito com ressalva' ? 'warn' : 'ok';
              return (
                <div className="item-line" key={idx}>
                  <span>{mp?.nome || '—'} <span className={`tag ${tagStatus}`} style={{ marginLeft: 6 }}>{it.status_recebimento}</span></span>
                  <span className="num">{Number(it.quantidade)} {mp?.unidade || ''} × {fmtMoney(it.custo_unitario)}</span>
                  <button className="btn danger small" onClick={() => removerItemDraft(idx)}>×</button>
                </div>
              );
            }) : <p className="muted" style={{ fontSize: 12 }}>Nenhuma matéria-prima adicionada ainda.</p>}
            {itensDraft.length > 0 && (
              <div className="subtotal">Total da nota: {fmtMoney(itensDraft.reduce((s, i) => s + Number(i.quantidade) * Number(i.custo_unitario), 0))}</div>
            )}
          </div>
          <button className="btn" style={{ marginTop: 12 }} onClick={registrarNota} disabled={salvando}>
            {salvando ? 'Registrando…' : 'Registrar nota'}
          </button>
        </div>
        <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
          Uma nota pode ter várias matérias-primas; cada uma vira um lote separado. Arquivos até 10 MB. Só itens &quot;Aceito&quot; ou &quot;Aceito com ressalva&quot; contam no saldo de estoque.
        </p>
      </div>

      <div className="panel">
        <h3>Notas de recebimento ({lista.length})</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Data</th><th>Fornecedor</th><th>Nota fiscal</th><th>Recebido por</th><th>Itens</th><th>Total</th><th></th></tr>
            </thead>
            <tbody>
              {lista.length ? lista.map(r => {
                const itens = r.recebimento_itens || [];
                const total = itens.reduce((s, it) => s + Number(it.quantidade) * Number(it.custo_unitario), 0);
                return (
                  <Fragment key={r.id}>
                    <tr>
                      <td>{fmtDate(r.data)}</td>
                      <td>{r.fornecedores?.nome || '—'}</td>
                      <td className="muted">{r.nota_fiscal || '—'}</td>
                      <td className="muted">{r.responsavel?.nome || '—'}</td>
                      <td className="num">{itens.length}</td>
                      <td className="num">{fmtMoney(total)}</td>
                      <td>
                        <div className="row-actions">
                          <button className="btn secondary small" onClick={() => setExpandido({ ...expandido, [r.id]: !expandido[r.id] })}>
                            {expandido[r.id] ? 'Ocultar' : 'Detalhes'}
                          </button>
                          <button className="btn secondary small" onClick={() => imprimir(r)}>Imprimir ficha</button>
                          <button className="btn secondary small" disabled={!r.nota_fiscal_arquivo_url} onClick={() => verAnexo(r.nota_fiscal_arquivo_url)}>Ver NF anexada</button>
                          <button className="btn danger" onClick={() => excluirNota(r)}>Excluir nota</button>
                        </div>
                      </td>
                    </tr>
                    {expandido[r.id] && (
                      <tr>
                        <td colSpan={7}>
                          <div className="table-wrap">
                            <table>
                              <thead>
                                <tr><th>Matéria-prima</th><th>Lote</th><th>Lote fornec.</th><th>Peso conferido</th><th>Peso nota</th><th>Custo unit.</th><th>Custo total</th><th>Condição</th><th>Status</th><th>Local</th><th>Validade</th><th>Aprovado por</th><th></th></tr>
                              </thead>
                              <tbody>
                                {itens.length ? itens.map(it => {
                                  const alvoR = it.materias_primas?.preco_alvo_kg ? Number(it.materias_primas.preco_alvo_kg) : null;
                                  const acimaAlvo = alvoR && Number(it.custo_unitario) > alvoR;
                                  const diffPeso = it.peso_nota_kg != null ? Number(it.quantidade) - Number(it.peso_nota_kg) : null;
                                  const divergePeso = diffPeso !== null && Math.abs(diffPeso) > 0.01;
                                  const tagStatus = it.status_recebimento === 'Rejeitado' ? 'bad' : it.status_recebimento === 'Aceito com ressalva' ? 'warn' : 'ok';
                                  return (
                                    <tr key={it.id}>
                                      <td>{it.materias_primas?.nome || '—'}</td>
                                      <td className="muted">{it.lote}</td>
                                      <td className="muted">{it.numero_lote_fornecedor || '—'}</td>
                                      <td className="num">
                                        {Number(it.quantidade)} {it.materias_primas?.unidade || ''}
                                        {divergePeso && <div><span className="tag warn">Diverge {diffPeso > 0 ? '+' : ''}{diffPeso.toFixed(3)}</span></div>}
                                      </td>
                                      <td className="num">{it.peso_nota_kg != null ? Number(it.peso_nota_kg) : '—'}</td>
                                      <td className="num">
                                        {fmtMoney(it.custo_unitario)}
                                        {acimaAlvo && <div><span className="tag warn">Acima do alvo</span></div>}
                                      </td>
                                      <td className="num">{fmtMoney(Number(it.quantidade) * Number(it.custo_unitario))}</td>
                                      <td className="muted">{it.condicao_embalagem || '—'}</td>
                                      <td><span className={`tag ${tagStatus}`}>{it.status_recebimento}</span></td>
                                      <td className="muted">{it.local_armazenamento || '—'}</td>
                                      <td>{fmtDate(it.validade)}</td>
                                      <td className="muted">{it.aprovado_por?.nome || '—'}</td>
                                      <td>
                                        <div className="row-actions">
                                          <button className="btn secondary small" disabled={!it.foto_produto_url} onClick={() => verAnexo(it.foto_produto_url)}>Ver foto</button>
                                          <button className="btn danger small" onClick={() => excluirItem(it)}>×</button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                }) : <tr className="empty-row"><td colSpan={13}>Sem itens.</td></tr>}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              }) : <tr className="empty-row"><td colSpan={7}>Nenhuma nota lançada.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
