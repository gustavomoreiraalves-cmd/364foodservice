'use client';
import { useEffect, useState, useRef, Fragment } from 'react';
import { supabase } from '../../lib/supabase';
import { fmtMoney, fmtDate, hoje, diasEntre, proximosLotes } from '../../lib/format';
import { uploadArquivoRecebimento, signedUrlRecebimento, removerAnexosRecebimento } from '../../lib/storage';
import AppShell from '../../components/AppShell';
import FichaPrint, { imprimirFicha } from '../../components/FichaPrint';
import { useEmpresaAtual } from '../../lib/empresa';

const CONDICOES_EMBALAGEM = ['Íntegra', 'Danificada', 'Violada', 'Amassada', 'Outra'];
const STATUS_QUALIDADE = [
  { valor: 'pendente', label: 'Pendente' },
  { valor: 'aprovado', label: 'Aprovado' },
  { valor: 'aprovado_com_ressalva', label: 'Aprovado com ressalva' },
  { valor: 'quarentena', label: 'Quarentena' },
  { valor: 'rejeitado', label: 'Rejeitado' },
  { valor: 'devolvido', label: 'Devolvido' },
];
const STATUS_LABEL = Object.fromEntries(STATUS_QUALIDADE.map(s => [s.valor, s.label]));
const STATUS_TAG = {
  aprovado: 'ok',
  aprovado_com_ressalva: 'warn',
  pendente: 'warn',
  quarentena: 'bad',
  rejeitado: 'bad',
  devolvido: 'bad',
};
const REGRA_LABEL = { simples: 'Simples', validade: 'Validade controlada', lote: 'Lote completo' };

const HEADER_VAZIO = () => ({ data: hoje(), fornecedor_id: '', nota_fiscal: '', responsavel_id: '', notaFiscalArquivo: null });
const ITEM_VAZIO = () => ({
  materia_prima_id: '', quantidade: '', peso_nota_kg: '', custo_unitario: '',
  deposito_id: '', local_armazenamento: '', observacoes: '',
  validade: '', numero_lote_fornecedor: '', condicao_embalagem: 'Íntegra', status_qualidade: 'aprovado',
  motivo_rejeicao: '', temperatura_c: '', inspecionado_por_id: '',
  fotoProdutoArquivo: null, documentoSanitarioArquivo: null,
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
  const [depositos, setDepositos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [header, setHeader] = useState(HEADER_VAZIO());
  const [itemForm, setItemForm] = useState(ITEM_VAZIO());
  const [itens, setItens] = useState([]);
  const [expandido, setExpandido] = useState({});
  const proximaKey = useRef(0);

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    const [r1, r2, r3, r4, r5] = await Promise.all([
      supabase.from('recebimento_itens')
        .select(`
          *,
          materias_primas(nome, unidade, preco_alvo_kg, controle_recebimento),
          depositos(nome, unidades(nome)),
          inspecoes_qualidade(status, condicao_embalagem, temperatura_c, motivo_rejeicao, foto_url, documento_sanitario_url, inspecionado_por:funcionarios(nome)),
          recebimentos!inner(
            data, fornecedor_id, nota_fiscal, responsavel_id, nota_fiscal_arquivo_url,
            fornecedores(nome),
            responsavel:funcionarios!recebimentos_responsavel_id_fkey(nome)
          )
        `)
        .eq('empresa_id', empresaAtual.id)
        .order('created_at', { ascending: false }),
      supabase.from('materias_primas').select('*').eq('empresa_id', empresaAtual.id).eq('ativo', true).order('nome'),
      supabase.from('fornecedores').select('id, nome').eq('empresa_id', empresaAtual.id).order('nome'),
      supabase.from('funcionarios').select('id, nome').eq('empresa_id', empresaAtual.id).eq('ativo', true).order('nome'),
      supabase.from('depositos').select('id, nome, unidades(nome)').eq('empresa_id', empresaAtual.id).eq('ativo', true).order('nome'),
    ]);
    if (r1.error) console.error(r1.error);
    setLista((r1.data || []).map(item => ({
      ...item,
      recebimento_id: item.recebimento_id,
      cabecalho: item.recebimentos,
      inspecao: Array.isArray(item.inspecoes_qualidade) ? item.inspecoes_qualidade[0] : item.inspecoes_qualidade,
    })));
    setMps(r2.data || []);
    setFornecedores(r3.data || []);
    setFuncionarios(r4.data || []);
    setDepositos(r5.data || []);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  const mpSelecionada = mps.find(m => m.id === itemForm.materia_prima_id);
  const regra = mpSelecionada?.controle_recebimento || 'simples';
  const alvo = mpSelecionada?.preco_alvo_kg ? Number(mpSelecionada.preco_alvo_kg) : null;
  const custoAcimaDoAlvo = alvo && Number(itemForm.custo_unitario) > alvo;
  const diasValidade = mpSelecionada?.dias_minimos_validade && itemForm.validade ? diasEntre(hoje(), itemForm.validade) : null;
  const validadeAbaixoDoMinimo = diasValidade != null && diasValidade < mpSelecionada.dias_minimos_validade;
  const exigeMotivo = ['rejeitado', 'quarentena'].includes(itemForm.status_qualidade);

  function adicionarItem(e) {
    e.preventDefault();
    if (!mpSelecionada) { alert('Selecione a matéria-prima.'); return; }
    if (!itemForm.quantidade || !itemForm.custo_unitario) { alert('Preencha peso conferido e custo unitário.'); return; }
    if (regra !== 'simples' && !itemForm.validade) { alert('Este item exige validade (regra: ' + REGRA_LABEL[regra] + ').'); return; }
    if (mpSelecionada.exige_temperatura && !itemForm.temperatura_c) { alert('Este item exige temperatura no recebimento.'); return; }
    if (mpSelecionada.exige_inspecao && !itemForm.inspecionado_por_id) { alert('Este item exige responsável pela inspeção.'); return; }
    if (regra !== 'simples' && exigeMotivo && !itemForm.motivo_rejeicao) { alert('Informe o motivo da rejeição/quarentena.'); return; }
    proximaKey.current += 1;
    setItens([...itens, { ...itemForm, _key: proximaKey.current, _mp: mpSelecionada }]);
    setItemForm(ITEM_VAZIO());
  }

  function removerItemStaged(key) {
    setItens(itens.filter(i => i._key !== key));
  }

  async function registrar(e) {
    e.preventDefault();
    if (!itens.length) { alert('Adicione ao menos um item antes de registrar o recebimento.'); return; }
    setSalvando(true);
    try {
      const { data: cabecalho, error: errCabecalho } = await supabase.from('recebimentos').insert([{
        data: header.data,
        fornecedor_id: header.fornecedor_id || null,
        nota_fiscal: header.nota_fiscal || null,
        responsavel_id: header.responsavel_id || null,
        empresa_id: empresaAtual.id,
      }]).select('id').single();

      if (errCabecalho) { alert('Erro ao salvar: ' + errCabecalho.message); return; }

      const lotes = await proximosLotes(header.data, empresaAtual.id, itens.length);
      const inseridos = [];

      for (let i = 0; i < itens.length; i++) {
        const it = itens[i];
        const ehSimples = it._mp.controle_recebimento === 'simples';
        const { data: itemInserido, error: errItem } = await supabase.from('recebimento_itens').insert([{
          recebimento_id: cabecalho.id,
          lote: lotes[i],
          materia_prima_id: it.materia_prima_id,
          quantidade: Number(it.quantidade),
          peso_nota_kg: it.peso_nota_kg ? Number(it.peso_nota_kg) : null,
          custo_unitario: Number(it.custo_unitario),
          deposito_id: it.deposito_id || null,
          local_armazenamento: it.local_armazenamento || null,
          observacoes: it.observacoes || null,
          validade: !ehSimples ? (it.validade || null) : null,
          numero_lote_fornecedor: it._mp.controle_recebimento === 'lote' ? (it.numero_lote_fornecedor || null) : null,
          empresa_id: empresaAtual.id,
        }]).select('id').single();

        if (errItem) {
          alert(`Erro ao salvar o item ${i + 1} (${it._mp.nome}): ` + errItem.message);
          for (const done of inseridos) await supabase.from('recebimento_itens').delete().eq('id', done.id);
          await supabase.from('recebimentos').delete().eq('id', cabecalho.id);
          return;
        }

        const { data: inspecaoInserida, error: errInspecao } = await supabase.from('inspecoes_qualidade').insert([{
          recebimento_item_id: itemInserido.id,
          empresa_id: empresaAtual.id,
          status: ehSimples ? 'aprovado' : it.status_qualidade,
          condicao_embalagem: !ehSimples ? (it.condicao_embalagem || null) : null,
          temperatura_c: it._mp.exige_temperatura && it.temperatura_c ? Number(it.temperatura_c) : null,
          motivo_rejeicao: !ehSimples && exigeMotivoStatus(it.status_qualidade) ? (it.motivo_rejeicao || null) : null,
          inspecionado_por_id: it._mp.exige_inspecao ? (it.inspecionado_por_id || null) : null,
          inspecionado_em: !ehSimples ? new Date().toISOString() : null,
        }]).select('id').single();

        if (errInspecao) {
          alert(`Erro ao salvar a inspeção do item ${i + 1} (${it._mp.nome}): ` + errInspecao.message);
          for (const done of inseridos) await supabase.from('recebimento_itens').delete().eq('id', done.id);
          await supabase.from('recebimento_itens').delete().eq('id', itemInserido.id);
          await supabase.from('recebimentos').delete().eq('id', cabecalho.id);
          return;
        }

        inseridos.push({
          id: itemInserido.id,
          inspecaoId: inspecaoInserida.id,
          fotoProdutoArquivo: it.fotoProdutoArquivo,
          documentoSanitarioArquivo: it.documentoSanitarioArquivo,
        });
      }

      if (header.notaFiscalArquivo) {
        try {
          const url = await uploadArquivoRecebimento(empresaAtual.id, cabecalho.id, 'nota-fiscal', header.notaFiscalArquivo);
          await supabase.from('recebimentos').update({ nota_fiscal_arquivo_url: url }).eq('id', cabecalho.id);
        } catch (upErr) {
          alert('Recebimento salvo, mas o anexo da nota fiscal falhou: ' + upErr.message);
        }
      }
      for (const done of inseridos) {
        if (done.fotoProdutoArquivo) {
          try {
            const url = await uploadArquivoRecebimento(empresaAtual.id, done.id, 'foto', done.fotoProdutoArquivo);
            await supabase.from('inspecoes_qualidade').update({ foto_url: url }).eq('id', done.inspecaoId);
          } catch (upErr) {
            alert('Item salvo, mas o anexo da foto falhou: ' + upErr.message);
          }
        }
        if (done.documentoSanitarioArquivo) {
          try {
            const url = await uploadArquivoRecebimento(empresaAtual.id, done.id, 'doc-sanitario', done.documentoSanitarioArquivo);
            await supabase.from('inspecoes_qualidade').update({ documento_sanitario_url: url }).eq('id', done.inspecaoId);
          } catch (upErr) {
            alert('Item salvo, mas o anexo do documento sanitário falhou: ' + upErr.message);
          }
        }
      }

      setHeader(HEADER_VAZIO());
      setItens([]);
      carregar();
    } finally {
      setSalvando(false);
    }
  }

  async function excluirItem(r) {
    if (!confirm('Excluir este item do recebimento? O saldo de estoque será recalculado.')) return;
    await removerAnexosRecebimento([r.inspecao?.foto_url, r.inspecao?.documento_sanitario_url]);
    const { error } = await supabase.from('recebimento_itens').delete().eq('id', r.id);
    if (error) { alert('Erro ao excluir: ' + error.message); return; }

    const { count } = await supabase.from('recebimento_itens')
      .select('id', { count: 'exact', head: true })
      .eq('recebimento_id', r.recebimento_id);
    if (!count) {
      await removerAnexosRecebimento([r.cabecalho?.nota_fiscal_arquivo_url]);
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

  function imprimirNota(grupo) {
    imprimirFicha(setFicha, {
      titulo: 'Ficha de Recebimento de Mercadoria',
      numero: grupo.cabecalho.nota_fiscal ? `NF ${grupo.cabecalho.nota_fiscal}` : `Recebimento ${fmtDate(grupo.cabecalho.data)}`,
      campos: [
        { rot: 'Data do recebimento', valor: fmtDate(grupo.cabecalho.data) },
        { rot: 'Fornecedor', valor: grupo.cabecalho.fornecedores?.nome },
        { rot: 'Nota fiscal (nº)', valor: grupo.cabecalho.nota_fiscal },
        { rot: 'Recebido por', valor: grupo.cabecalho.responsavel?.nome },
        ...grupo.itens.flatMap(it => [
          { rot: `— ${it.materias_primas?.nome}`, valor: `Lote ${it.lote} · ${Number(it.quantidade)} ${it.materias_primas?.unidade || ''} · ${fmtMoney(it.custo_unitario)}/un · ${STATUS_LABEL[it.inspecao?.status] || '—'}` },
        ]),
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

  const grupos = [];
  const grupoPorId = {};
  for (const item of lista) {
    let g = grupoPorId[item.recebimento_id];
    if (!g) {
      g = { recebimento_id: item.recebimento_id, cabecalho: item.cabecalho, itens: [] };
      grupoPorId[item.recebimento_id] = g;
      grupos.push(g);
    }
    g.itens.push(item);
  }

  return (
    <>
      <div className="panel">
        <h3>Novo recebimento de mercadoria</h3>
        <form className="form-grid">
          <div><label>Data</label><input type="date" required value={header.data} onChange={e => setHeader({ ...header, data: e.target.value })} /></div>
          <div><label>Fornecedor</label>
            <select required value={header.fornecedor_id} onChange={e => setHeader({ ...header, fornecedor_id: e.target.value })}>
              <option value="">Selecione…</option>
              {fornecedores.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </div>
          <div><label>Nota fiscal (nº)</label><input value={header.nota_fiscal} onChange={e => setHeader({ ...header, nota_fiscal: e.target.value })} /></div>
          <div><label>Recebido por</label>
            <select value={header.responsavel_id} onChange={e => setHeader({ ...header, responsavel_id: e.target.value })}>
              <option value="">Selecione…</option>
              {funcionarios.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </div>
          <div><label>Anexo da nota fiscal (PDF ou imagem)</label>
            <input type="file" accept="application/pdf,image/*" onChange={e => setHeader({ ...header, notaFiscalArquivo: e.target.files?.[0] || null })} />
          </div>
        </form>

        <h4 style={{ marginTop: 18 }}>Itens da nota</h4>
        <div className="form-grid">
          <div><label>Matéria-prima</label>
            <select value={itemForm.materia_prima_id} onChange={e => setItemForm({ ...ITEM_VAZIO(), materia_prima_id: e.target.value })}>
              <option value="">Selecione…</option>
              {mps.map(m => <option key={m.id} value={m.id}>{m.nome} ({m.unidade})</option>)}
            </select>
            {mpSelecionada && <span className="muted" style={{ display: 'block', fontSize: 11.5, marginTop: 4 }}>Regra: {REGRA_LABEL[regra]}</span>}
          </div>
          {mpSelecionada && (
            <>
              <div><label>Peso conferido</label><input type="number" step="0.001" value={itemForm.quantidade} onChange={e => setItemForm({ ...itemForm, quantidade: e.target.value })} /></div>
              <div><label>Peso na nota fiscal</label><input type="number" step="0.001" value={itemForm.peso_nota_kg} onChange={e => setItemForm({ ...itemForm, peso_nota_kg: e.target.value })} /></div>
              <div>
                <label>Custo unitário (R$)</label>
                <input type="number" step="0.01" value={itemForm.custo_unitario} onChange={e => setItemForm({ ...itemForm, custo_unitario: e.target.value })} />
                {custoAcimaDoAlvo && <span style={{ display: 'block', marginTop: 4, fontSize: 11, color: 'var(--amber-bright)' }}>⚠ Acima do preço-alvo ({fmtMoney(alvo)}/kg)</span>}
              </div>
              <div><label>Depósito</label>
                <select value={itemForm.deposito_id} onChange={e => setItemForm({ ...itemForm, deposito_id: e.target.value })}>
                  <option value="">Selecione…</option>
                  {depositos.map(d => <option key={d.id} value={d.id}>{d.nome} — {d.unidades?.nome}</option>)}
                </select>
              </div>

              {regra !== 'simples' && (
                <div>
                  <label>Validade</label>
                  <input type="date" value={itemForm.validade} onChange={e => setItemForm({ ...itemForm, validade: e.target.value })} />
                  {validadeAbaixoDoMinimo && <span style={{ display: 'block', marginTop: 4, fontSize: 11, color: 'var(--amber-bright)' }}>⚠ Abaixo da validade mínima exigida ({mpSelecionada.dias_minimos_validade} dias)</span>}
                </div>
              )}
              {regra !== 'simples' && (
                <div><label>Condição da embalagem</label>
                  <select value={itemForm.condicao_embalagem} onChange={e => setItemForm({ ...itemForm, condicao_embalagem: e.target.value })}>
                    {CONDICOES_EMBALAGEM.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
              )}
              {regra !== 'simples' && (
                <div><label>Status sanitário</label>
                  <select value={itemForm.status_qualidade} onChange={e => setItemForm({ ...itemForm, status_qualidade: e.target.value })}>
                    {STATUS_QUALIDADE.map(s => <option key={s.valor} value={s.valor}>{s.label}</option>)}
                  </select>
                </div>
              )}
              {regra !== 'simples' && exigeMotivo && (
                <div><label>Motivo (rejeição/quarentena)</label><input required value={itemForm.motivo_rejeicao} onChange={e => setItemForm({ ...itemForm, motivo_rejeicao: e.target.value })} /></div>
              )}
              {regra === 'lote' && (
                <div><label>Lote do fornecedor</label><input value={itemForm.numero_lote_fornecedor} onChange={e => setItemForm({ ...itemForm, numero_lote_fornecedor: e.target.value })} /></div>
              )}
              {mpSelecionada.exige_temperatura && (
                <div><label>Temperatura no recebimento (°C)</label><input type="number" step="0.1" value={itemForm.temperatura_c} onChange={e => setItemForm({ ...itemForm, temperatura_c: e.target.value })} /></div>
              )}
              {mpSelecionada.exige_inspecao && (
                <div><label>Responsável pela inspeção</label>
                  <select value={itemForm.inspecionado_por_id} onChange={e => setItemForm({ ...itemForm, inspecionado_por_id: e.target.value })}>
                    <option value="">Selecione…</option>
                    {funcionarios.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
                  </select>
                </div>
              )}
              {mpSelecionada.exige_foto && (
                <div><label>Foto do produto</label>
                  <input type="file" accept="image/*" onChange={e => setItemForm({ ...itemForm, fotoProdutoArquivo: e.target.files?.[0] || null })} />
                </div>
              )}
              {mpSelecionada.exige_documento_sanitario && (
                <div><label>Documento sanitário</label>
                  <input type="file" accept="application/pdf,image/*" onChange={e => setItemForm({ ...itemForm, documentoSanitarioArquivo: e.target.files?.[0] || null })} />
                </div>
              )}
              <div><label>Endereço específico (opcional)</label><input placeholder="Prateleira 3, gaveta 2..." value={itemForm.local_armazenamento} onChange={e => setItemForm({ ...itemForm, local_armazenamento: e.target.value })} /></div>
              <div><label>Observações</label><input value={itemForm.observacoes} onChange={e => setItemForm({ ...itemForm, observacoes: e.target.value })} /></div>
              <div><button className="btn secondary" type="button" onClick={adicionarItem}>Adicionar item à nota</button></div>
            </>
          )}
        </div>

        {itens.length > 0 && (
          <div className="items-list" style={{ marginTop: 14 }}>
            <label>Itens adicionados ({itens.length})</label>
            {itens.map(it => (
              <div className="item-line" key={it._key}>
                <span>{it._mp.nome} <span className="muted">({REGRA_LABEL[it._mp.controle_recebimento]})</span></span>
                <span className="num">{Number(it.quantidade)} {it._mp.unidade} · {fmtMoney(it.custo_unitario)}</span>
                <button className="btn danger small" type="button" onClick={() => removerItemStaged(it._key)}>×</button>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          <button className="btn" type="button" disabled={salvando || !itens.length} onClick={registrar}>
            {salvando ? 'Registrando…' : `Registrar recebimento (${itens.length} ${itens.length === 1 ? 'item' : 'itens'})`}
          </button>
        </div>
        <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
          O formulário do item muda conforme a regra de recebimento cadastrada na matéria-prima (aba Produtos).
          Só itens &quot;Aprovado&quot; ou &quot;Aprovado com ressalva&quot; contam no saldo de estoque; lotes em
          quarentena ou rejeitados ficam registrados, mas fora do saldo disponível.
        </p>
      </div>

      <div className="panel">
        <h3>Recebimentos ({grupos.length})</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Data</th><th>Nota fiscal</th><th>Fornecedor</th><th>Itens</th><th>Valor total</th><th></th></tr>
            </thead>
            <tbody>
              {grupos.length ? grupos.map(g => {
                const valorTotal = g.itens.reduce((s, it) => s + Number(it.quantidade) * Number(it.custo_unitario), 0);
                return (
                  <Fragment key={g.recebimento_id}>
                    <tr>
                      <td>{fmtDate(g.cabecalho.data)}</td>
                      <td className="muted">{g.cabecalho.nota_fiscal || '—'}</td>
                      <td>{g.cabecalho.fornecedores?.nome || '—'}</td>
                      <td className="num">{g.itens.length}</td>
                      <td className="num">{fmtMoney(valorTotal)}</td>
                      <td>
                        <div className="row-actions">
                          <button className="btn secondary small" onClick={() => setExpandido({ ...expandido, [g.recebimento_id]: !expandido[g.recebimento_id] })}>
                            {expandido[g.recebimento_id] ? 'Ocultar' : 'Detalhes'}
                          </button>
                          <button className="btn secondary small" onClick={() => imprimirNota(g)}>Imprimir ficha</button>
                        </div>
                      </td>
                    </tr>
                    {expandido[g.recebimento_id] && (
                      <tr>
                        <td colSpan={6}>
                          <div className="table-wrap">
                            <table>
                              <thead>
                                <tr><th>Lote</th><th>Matéria-prima</th><th>Peso conferido</th><th>Custo unit.</th><th>Depósito</th><th>Validade</th><th>Status sanitário</th><th></th></tr>
                              </thead>
                              <tbody>
                                {g.itens.map(it => {
                                  const alvoR = it.materias_primas?.preco_alvo_kg ? Number(it.materias_primas.preco_alvo_kg) : null;
                                  const acimaAlvo = alvoR && Number(it.custo_unitario) > alvoR;
                                  const diffPeso = it.peso_nota_kg != null ? Number(it.quantidade) - Number(it.peso_nota_kg) : null;
                                  const divergePeso = diffPeso !== null && Math.abs(diffPeso) > 0.01;
                                  const status = it.inspecao?.status;
                                  return (
                                    <tr key={it.id}>
                                      <td className="muted">{it.lote}</td>
                                      <td>{it.materias_primas?.nome || '—'}</td>
                                      <td className="num">
                                        {Number(it.quantidade)} {it.materias_primas?.unidade || ''}
                                        {divergePeso && <div><span className="tag warn">Diverge {diffPeso > 0 ? '+' : ''}{diffPeso.toFixed(3)}</span></div>}
                                      </td>
                                      <td className="num">
                                        {fmtMoney(it.custo_unitario)}
                                        {acimaAlvo && <div><span className="tag warn">Acima do alvo</span></div>}
                                      </td>
                                      <td className="muted">{it.depositos ? `${it.depositos.nome} — ${it.depositos.unidades?.nome}` : '—'}</td>
                                      <td>{fmtDate(it.validade)}</td>
                                      <td>
                                        <span className={`tag ${STATUS_TAG[status] || 'ok'}`}>{STATUS_LABEL[status] || '—'}</span>
                                        {it.inspecao?.motivo_rejeicao && <div className="muted" style={{ fontSize: 11 }}>{it.inspecao.motivo_rejeicao}</div>}
                                      </td>
                                      <td>
                                        <div className="row-actions">
                                          {it.inspecao?.foto_url && <button className="btn secondary small" onClick={() => verAnexo(it.inspecao.foto_url)}>Ver foto</button>}
                                          {it.inspecao?.documento_sanitario_url && <button className="btn secondary small" onClick={() => verAnexo(it.inspecao.documento_sanitario_url)}>Ver documento</button>}
                                          <button className="btn danger small" onClick={() => excluirItem(it)}>Excluir</button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                          {g.cabecalho.nota_fiscal_arquivo_url && (
                            <button className="btn secondary small" style={{ marginTop: 8 }} onClick={() => verAnexo(g.cabecalho.nota_fiscal_arquivo_url)}>Ver nota fiscal anexada</button>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              }) : <tr className="empty-row"><td colSpan={6}>Nenhum recebimento lançado.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function exigeMotivoStatus(status) {
  return status === 'rejeitado' || status === 'quarentena';
}
