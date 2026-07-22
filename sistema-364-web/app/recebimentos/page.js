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

const FORM_VAZIO = () => ({
  data: hoje(), fornecedor_id: '', materia_prima_id: '',
  quantidade: '', peso_nota_kg: '', custo_unitario: '',
  numero_lote_fornecedor: '', temperatura_c: '', condicao_embalagem: 'Íntegra',
  status_recebimento: 'Aceito', local_armazenamento: '',
  nota_fiscal: '', validade: '', responsavel_id: '', aprovado_por_id: '',
  notaFiscalArquivo: null, fotoProdutoArquivo: null,
});

export default function RecebimentosPage() {
  const [ficha, setFicha] = useState(null);
  return (
    <>
      <AppShell modulo="recebimentos" titulo="Recebimento" desc="Entrada de matéria-prima, controle de qualidade e geração de lotes">
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
  const [form, setForm] = useState(FORM_VAZIO());
  const [expandido, setExpandido] = useState({});

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    const [r1, r2, r3, r4] = await Promise.all([
      supabase.from('recebimento_itens')
        .select(`
          *,
          materias_primas(nome, unidade, preco_alvo_kg),
          aprovado_por:funcionarios!recebimento_itens_aprovado_por_id_fkey(nome),
          recebimentos!inner(
            data, fornecedor_id, nota_fiscal, responsavel_id, temperatura_c, nota_fiscal_arquivo_url,
            fornecedores(nome),
            responsavel:funcionarios!recebimentos_responsavel_id_fkey(nome)
          )
        `)
        .eq('empresa_id', empresaAtual.id)
        .order('created_at', { ascending: false }),
      supabase.from('materias_primas').select('*').eq('empresa_id', empresaAtual.id).order('nome'),
      supabase.from('fornecedores').select('id, nome').eq('empresa_id', empresaAtual.id).order('nome'),
      supabase.from('funcionarios').select('id, nome').eq('empresa_id', empresaAtual.id).eq('ativo', true).order('nome'),
    ]);
    if (r1.error) console.error(r1.error);
    setLista((r1.data || []).map(item => ({
      ...item,
      ...item.recebimentos,
      fornecedores: item.recebimentos?.fornecedores,
      responsavel: item.recebimentos?.responsavel,
    })));
    setMps(r2.data || []);
    setFornecedores(r3.data || []);
    setFuncionarios(r4.data || []);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  async function registrar(e) {
    e.preventDefault();
    setSalvando(true);
    try {
      const lote = await proximoLote(form.data, empresaAtual.id);

      const { data: cabecalho, error: errCabecalho } = await supabase.from('recebimentos').insert([{
        data: form.data,
        fornecedor_id: form.fornecedor_id || null,
        nota_fiscal: form.nota_fiscal || null,
        responsavel_id: form.responsavel_id || null,
        temperatura_c: form.temperatura_c ? Number(form.temperatura_c) : null,
        empresa_id: empresaAtual.id,
      }]).select('id').single();

      if (errCabecalho) { alert('Erro ao salvar: ' + errCabecalho.message); return; }

      const { data: item, error: errItem } = await supabase.from('recebimento_itens').insert([{
        recebimento_id: cabecalho.id,
        lote,
        materia_prima_id: form.materia_prima_id,
        quantidade: Number(form.quantidade),
        peso_nota_kg: form.peso_nota_kg ? Number(form.peso_nota_kg) : null,
        custo_unitario: Number(form.custo_unitario),
        numero_lote_fornecedor: form.numero_lote_fornecedor || null,
        condicao_embalagem: form.condicao_embalagem || null,
        status_recebimento: form.status_recebimento,
        local_armazenamento: form.local_armazenamento || null,
        validade: form.validade || null,
        aprovado_por_id: form.aprovado_por_id || null,
        empresa_id: empresaAtual.id,
      }]).select('id').single();

      if (errItem) {
        alert('Erro ao salvar: ' + errItem.message);
        await supabase.from('recebimentos').delete().eq('id', cabecalho.id);
        return;
      }

      if (form.notaFiscalArquivo) {
        try {
          const url = await uploadArquivoRecebimento(empresaAtual.id, cabecalho.id, 'nota-fiscal', form.notaFiscalArquivo);
          await supabase.from('recebimentos').update({ nota_fiscal_arquivo_url: url }).eq('id', cabecalho.id);
        } catch (upErr) {
          alert('Recebimento salvo, mas o anexo da nota fiscal falhou: ' + upErr.message);
        }
      }
      if (form.fotoProdutoArquivo) {
        try {
          const url = await uploadArquivoRecebimento(empresaAtual.id, item.id, 'foto', form.fotoProdutoArquivo);
          await supabase.from('recebimento_itens').update({ foto_produto_url: url }).eq('id', item.id);
        } catch (upErr) {
          alert('Recebimento salvo, mas o anexo da foto falhou: ' + upErr.message);
        }
      }

      setForm(FORM_VAZIO());
      carregar();
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(r) {
    if (!confirm('Excluir este recebimento? O saldo de estoque será recalculado.')) return;
    await removerAnexosRecebimento([r.foto_produto_url]);
    const { error } = await supabase.from('recebimento_itens').delete().eq('id', r.id);
    if (error) { alert('Erro ao excluir: ' + error.message); return; }

    const { count } = await supabase.from('recebimento_itens')
      .select('id', { count: 'exact', head: true })
      .eq('recebimento_id', r.recebimento_id);
    if (!count) {
      await removerAnexosRecebimento([r.nota_fiscal_arquivo_url]);
      await supabase.from('recebimentos').delete().eq('id', r.recebimento_id);
    }
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
    imprimirFicha(setFicha, {
      titulo: 'Ficha de Recebimento de Mercadoria',
      numero: `Lote ${r.lote}`,
      campos: [
        { rot: 'Lote (interno)', valor: r.lote },
        { rot: 'Lote do fornecedor', valor: r.numero_lote_fornecedor },
        { rot: 'Data do recebimento', valor: fmtDate(r.data) },
        { rot: 'Fornecedor', valor: r.fornecedores?.nome },
        { rot: 'Matéria-prima', valor: r.materias_primas?.nome },
        { rot: 'Peso conferido', valor: `${Number(r.quantidade)} ${r.materias_primas?.unidade || ''}` },
        { rot: 'Peso na nota fiscal', valor: r.peso_nota_kg != null ? `${Number(r.peso_nota_kg)} ${r.materias_primas?.unidade || ''}` : '—' },
        { rot: 'Custo unitário', valor: fmtMoney(r.custo_unitario) },
        { rot: 'Custo total', valor: fmtMoney(Number(r.quantidade) * Number(r.custo_unitario)) },
        { rot: 'Temperatura no recebimento', valor: r.temperatura_c != null ? `${r.temperatura_c} °C` : '—' },
        { rot: 'Condição da embalagem', valor: r.condicao_embalagem },
        { rot: 'Status do recebimento', valor: r.status_recebimento },
        { rot: 'Nota fiscal (nº)', valor: r.nota_fiscal },
        { rot: 'Validade', valor: fmtDate(r.validade) },
        { rot: 'Local de armazenamento', valor: r.local_armazenamento },
        { rot: 'Recebido por', valor: r.responsavel?.nome },
        { rot: 'Aprovado por (qualidade)', valor: r.aprovado_por?.nome },
      ],
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

  const mpSelecionada = mps.find(m => m.id === form.materia_prima_id);
  const alvo = mpSelecionada?.preco_alvo_kg ? Number(mpSelecionada.preco_alvo_kg) : null;
  const custoAcimaDoAlvo = alvo && Number(form.custo_unitario) > alvo;

  return (
    <>
      <div className="panel">
        <h3>Novo recebimento de mercadoria</h3>
        <form onSubmit={registrar} className="form-grid">
          <div><label>Data</label><input type="date" required value={form.data} onChange={e => setForm({ ...form, data: e.target.value })} /></div>
          <div><label>Fornecedor</label>
            <select required value={form.fornecedor_id} onChange={e => setForm({ ...form, fornecedor_id: e.target.value })}>
              <option value="">Selecione…</option>
              {fornecedores.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </div>
          <div><label>Lote do fornecedor</label><input value={form.numero_lote_fornecedor} onChange={e => setForm({ ...form, numero_lote_fornecedor: e.target.value })} /></div>
          <div><label>Matéria-prima</label>
            <select required value={form.materia_prima_id} onChange={e => setForm({ ...form, materia_prima_id: e.target.value })}>
              <option value="">Selecione…</option>
              {mps.map(m => <option key={m.id} value={m.id}>{m.nome} ({m.unidade})</option>)}
            </select>
          </div>
          <div><label>Peso conferido</label><input type="number" step="0.001" required value={form.quantidade} onChange={e => setForm({ ...form, quantidade: e.target.value })} /></div>
          <div><label>Peso na nota fiscal (kg)</label><input type="number" step="0.001" value={form.peso_nota_kg} onChange={e => setForm({ ...form, peso_nota_kg: e.target.value })} /></div>
          <div>
            <label>Custo unitário (R$)</label>
            <input type="number" step="0.01" required value={form.custo_unitario} onChange={e => setForm({ ...form, custo_unitario: e.target.value })} />
            {custoAcimaDoAlvo && (
              <span style={{ display: 'block', marginTop: 4, fontSize: 11, color: 'var(--amber-bright)' }}>
                ⚠ Acima do preço-alvo ({fmtMoney(alvo)}/kg)
              </span>
            )}
          </div>
          <div><label>Temperatura no recebimento (°C)</label><input type="number" step="0.1" value={form.temperatura_c} onChange={e => setForm({ ...form, temperatura_c: e.target.value })} /></div>
          <div><label>Condição da embalagem</label>
            <select value={form.condicao_embalagem} onChange={e => setForm({ ...form, condicao_embalagem: e.target.value })}>
              {CONDICOES_EMBALAGEM.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div><label>Status do recebimento</label>
            <select value={form.status_recebimento} onChange={e => setForm({ ...form, status_recebimento: e.target.value })}>
              {STATUS_OPCOES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div><label>Local de armazenamento</label><input placeholder="Câmara fria 2..." value={form.local_armazenamento} onChange={e => setForm({ ...form, local_armazenamento: e.target.value })} /></div>
          <div><label>Nota fiscal (nº)</label><input value={form.nota_fiscal} onChange={e => setForm({ ...form, nota_fiscal: e.target.value })} /></div>
          <div><label>Validade</label><input type="date" value={form.validade} onChange={e => setForm({ ...form, validade: e.target.value })} /></div>
          <div><label>Recebido por</label>
            <select value={form.responsavel_id} onChange={e => setForm({ ...form, responsavel_id: e.target.value })}>
              <option value="">Selecione…</option>
              {funcionarios.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </div>
          <div><label>Aprovado por (qualidade)</label>
            <select value={form.aprovado_por_id} onChange={e => setForm({ ...form, aprovado_por_id: e.target.value })}>
              <option value="">Selecione…</option>
              {funcionarios.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </div>
          <div><label>Anexo da nota fiscal (PDF ou imagem)</label>
            <input type="file" accept="application/pdf,image/*" onChange={e => setForm({ ...form, notaFiscalArquivo: e.target.files?.[0] || null })} />
          </div>
          <div><label>Foto do produto</label>
            <input type="file" accept="image/*" onChange={e => setForm({ ...form, fotoProdutoArquivo: e.target.files?.[0] || null })} />
          </div>
          <div><button className="btn" type="submit" disabled={salvando}>{salvando ? 'Gerando lote…' : 'Registrar e gerar lote'}</button></div>
        </form>
        <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
          Arquivos até 10 MB. Só recebimentos &quot;Aceito&quot; ou &quot;Aceito com ressalva&quot; contam no saldo de estoque.
        </p>
      </div>

      <div className="panel">
        <h3>Recebimentos ({lista.length})</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Lote</th><th>Data</th><th>Matéria-prima</th><th>Fornecedor</th><th>Peso conferido</th><th>Peso nota</th><th>Custo unit.</th><th>Custo total</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {lista.length ? lista.map(r => {
                const alvoR = r.materias_primas?.preco_alvo_kg ? Number(r.materias_primas.preco_alvo_kg) : null;
                const acimaAlvo = alvoR && Number(r.custo_unitario) > alvoR;
                const diffPeso = r.peso_nota_kg != null ? Number(r.quantidade) - Number(r.peso_nota_kg) : null;
                const divergePeso = diffPeso !== null && Math.abs(diffPeso) > 0.01;
                const tagStatus = r.status_recebimento === 'Rejeitado' ? 'bad' : r.status_recebimento === 'Aceito com ressalva' ? 'warn' : 'ok';
                return (
                  <Fragment key={r.id}>
                    <tr>
                      <td className="muted">{r.lote}</td>
                      <td>{fmtDate(r.data)}</td>
                      <td>{r.materias_primas?.nome || '—'}</td>
                      <td>{r.fornecedores?.nome || '—'}</td>
                      <td className="num">
                        {Number(r.quantidade)} {r.materias_primas?.unidade || ''}
                        {divergePeso && <div><span className="tag warn">Diverge {diffPeso > 0 ? '+' : ''}{diffPeso.toFixed(3)}</span></div>}
                      </td>
                      <td className="num">{r.peso_nota_kg != null ? Number(r.peso_nota_kg) : '—'}</td>
                      <td className="num">
                        {fmtMoney(r.custo_unitario)}
                        {acimaAlvo && <div><span className="tag warn">Acima do alvo</span></div>}
                      </td>
                      <td className="num">{fmtMoney(Number(r.quantidade) * Number(r.custo_unitario))}</td>
                      <td><span className={`tag ${tagStatus}`}>{r.status_recebimento}</span></td>
                      <td>
                        <div className="row-actions">
                          <button className="btn secondary small" onClick={() => setExpandido({ ...expandido, [r.id]: !expandido[r.id] })}>
                            {expandido[r.id] ? 'Ocultar' : 'Detalhes'}
                          </button>
                          <button className="btn secondary small" onClick={() => imprimir(r)}>Imprimir ficha</button>
                          <button className="btn danger" onClick={() => excluir(r)}>Excluir</button>
                        </div>
                      </td>
                    </tr>
                    {expandido[r.id] && (
                      <tr>
                        <td colSpan={10}>
                          <div className="items-list" style={{ fontSize: 12.5 }}>
                            <div><span className="muted">Lote do fornecedor:</span> {r.numero_lote_fornecedor || '—'}</div>
                            <div><span className="muted">Temperatura:</span> {r.temperatura_c != null ? `${r.temperatura_c} °C` : '—'}</div>
                            <div><span className="muted">Condição da embalagem:</span> {r.condicao_embalagem || '—'}</div>
                            <div><span className="muted">Local de armazenamento:</span> {r.local_armazenamento || '—'}</div>
                            <div><span className="muted">Nota fiscal (nº):</span> {r.nota_fiscal || '—'}</div>
                            <div><span className="muted">Validade:</span> {fmtDate(r.validade)}</div>
                            <div><span className="muted">Recebido por:</span> {r.responsavel?.nome || '—'}</div>
                            <div><span className="muted">Aprovado por (qualidade):</span> {r.aprovado_por?.nome || '—'}</div>
                            <div className="row-actions" style={{ marginTop: 8 }}>
                              <button className="btn secondary small" disabled={!r.nota_fiscal_arquivo_url} onClick={() => verAnexo(r.nota_fiscal_arquivo_url)}>Ver nota fiscal anexada</button>
                              <button className="btn secondary small" disabled={!r.foto_produto_url} onClick={() => verAnexo(r.foto_produto_url)}>Ver foto do produto</button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              }) : <tr className="empty-row"><td colSpan={10}>Nenhum recebimento lançado.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
