'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { fmtDate, hoje, proximoLote } from '../../lib/format';
import AppShell from '../../components/AppShell';
import FichaPrint, { imprimirFicha } from '../../components/FichaPrint';

const CABECALHO_VAZIO = () => ({ data: hoje(), responsavel_id: '', sobra_kg: '', obs: '' });
const ITEM_VAZIO = () => ({ produto_id: '', quantidade: '', peso_total_kg: '' });

export default function EmbalagemPage() {
  const [ficha, setFicha] = useState(null);
  return (
    <>
      <AppShell modulo="embalagem" titulo="Embalagem" desc="Manipulação das proteínas defumadas e geração do produto final">
        <Conteudo setFicha={setFicha} />
      </AppShell>
      <FichaPrint ficha={ficha} />
    </>
  );
}

function Conteudo({ setFicha }) {
  const [lista, setLista] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [fichasTec, setFichasTec] = useState([]);
  const [estoqueDefumado, setEstoqueDefumado] = useState([]);
  const [funcionarios, setFuncionarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [semTabela, setSemTabela] = useState(false);

  const [cabecalho, setCabecalho] = useState(CABECALHO_VAZIO());
  const [itens, setItens] = useState([]);
  const [novoItem, setNovoItem] = useState(ITEM_VAZIO());

  async function carregar() {
    setLoading(true);
    const [r1, r2, r3, r4, r5] = await Promise.all([
      supabase.from('embalagens').select('*, funcionarios(nome), embalagem_itens(id, produto_id, quantidade, peso_total_kg, produtos(codigo, nome, unidade))').order('created_at', { ascending: false }),
      supabase.from('produtos').select('*').order('codigo'),
      supabase.from('ficha_tecnica').select('*'),
      supabase.from('vw_estoque_defumado').select('*'),
      supabase.from('funcionarios').select('id, nome').eq('ativo', true).order('nome'),
    ]);
    if (r1.error && /embalagens/.test(r1.error.message)) { setSemTabela(true); setLoading(false); return; }
    setLista(r1.data || []);
    setProdutos(r2.data || []);
    setFichasTec(r3.data || []);
    setEstoqueDefumado(r4.error ? [] : (r4.data || []));
    setFuncionarios(r5.data || []);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, []);

  // kg de defumado que uma quantidade do produto consome, pela ficha técnica
  function consumoDefumado(produtoId, qtd) {
    return fichasTec
      .filter(f => f.produto_id === produtoId)
      .map(f => ({ materia_prima_id: f.materia_prima_id, kg: Number(f.quantidade) * qtd }));
  }

  function addItem(e) {
    e.preventDefault();
    if (!novoItem.produto_id || !novoItem.quantidade) return;
    const qtd = Number(novoItem.quantidade);
    const consumo = consumoDefumado(novoItem.produto_id, qtd);
    if (!consumo.length && !confirm('Este produto não tem ficha técnica (kg de defumado por unidade) — o estoque de defumado não será baixado. Adicionar mesmo assim?')) return;
    for (const c of consumo) {
      const saldo = Number(estoqueDefumado.find(x => x.materia_prima_id === c.materia_prima_id)?.saldo_kg || 0);
      const mpNome = estoqueDefumado.find(x => x.materia_prima_id === c.materia_prima_id)?.nome || 'defumado';
      if (saldo < c.kg && !confirm(`Defumado insuficiente de "${mpNome}" (disponível ${saldo.toFixed(2)} kg, necessário ${c.kg.toFixed(2)} kg). Adicionar mesmo assim?`)) return;
    }
    setItens([...itens, { ...novoItem }]);
    setNovoItem(ITEM_VAZIO());
  }

  async function registrar() {
    if (!itens.length) { alert('Adicione ao menos um produto embalado à ficha.'); return; }
    setSalvando(true);
    const lote = await proximoLote(cabecalho.data);
    const { data: nova, error } = await supabase.from('embalagens').insert([{
      lote,
      data: cabecalho.data,
      responsavel_id: cabecalho.responsavel_id || null,
      sobra_kg: Number(cabecalho.sobra_kg) || 0,
      obs: cabecalho.obs || null,
    }]).select().single();
    if (error) { setSalvando(false); alert('Erro ao salvar: ' + error.message); return; }

    const { error: e2 } = await supabase.from('embalagem_itens').insert(itens.map(it => ({
      embalagem_id: nova.id,
      produto_id: it.produto_id,
      quantidade: Number(it.quantidade),
      peso_total_kg: it.peso_total_kg ? Number(it.peso_total_kg) : null,
    })));
    setSalvando(false);
    if (e2) { alert('Ficha salva, mas houve erro ao gravar os itens: ' + e2.message); }
    setItens([]);
    setCabecalho(CABECALHO_VAZIO());
    carregar();
  }

  async function excluir(id) {
    if (!confirm('Excluir esta ficha de embalagem? O estoque de produto acabado será recalculado.')) return;
    const { error } = await supabase.from('embalagens').delete().eq('id', id);
    if (error) alert('Erro ao excluir: ' + error.message);
    carregar();
  }

  function imprimir(em) {
    const its = em.embalagem_itens || [];
    const totalUn = its.reduce((s, i) => s + Number(i.quantidade), 0);
    const totalKg = its.reduce((s, i) => s + Number(i.peso_total_kg || 0), 0);
    imprimirFicha(setFicha, {
      titulo: 'Ficha de Embalagem',
      numero: `Lote ${em.lote}`,
      campos: [
        { rot: 'Lote', valor: em.lote },
        { rot: 'Data da embalagem', valor: fmtDate(em.data) },
        { rot: 'Responsável pela manipulação', valor: em.funcionarios?.nome },
        { rot: 'Produtos embalados', valor: `${totalUn} un` },
        { rot: 'Peso final dos produtos', valor: totalKg ? `${totalKg.toFixed(3)} kg` : '—' },
        { rot: 'Sobra de material', valor: `${Number(em.sobra_kg || 0).toFixed(3)} kg` },
        { rot: 'Observações', valor: em.obs },
      ],
      itens: {
        headers: ['Código', 'Produto', 'Qtd embalada', 'Peso final'],
        rows: its.map(i => [
          i.produtos?.codigo || '—',
          i.produtos?.nome || '—',
          `${Number(i.quantidade)} ${i.produtos?.unidade || 'un'}`,
          i.peso_total_kg ? `${Number(i.peso_total_kg).toFixed(3)} kg` : '—',
        ]),
      },
      assinaturas: ['Responsável pela manipulação', 'Controle de qualidade'],
    });
  }

  if (loading) return <p className="muted">Carregando…</p>;

  if (semTabela) {
    return (
      <div className="banner info">
        As tabelas de embalagem ainda não existem no banco. Rode o script <b>supabase/atualizacao_06_defumacao_embalagem.sql</b> no SQL Editor do Supabase e recarregue esta página.
      </div>
    );
  }

  if (!produtos.length) {
    return <div className="banner info">Cadastre os <b>produtos</b> (aba Produtos) antes de lançar uma embalagem.</div>;
  }

  const totalUnLista = itens.reduce((s, i) => s + Number(i.quantidade || 0), 0);
  const totalKgLista = itens.reduce((s, i) => s + Number(i.peso_total_kg || 0), 0);
  const defumadosDisponiveis = estoqueDefumado.filter(d => Number(d.saldo_kg) > 0.001);

  return (
    <>
      {defumadosDisponiveis.length > 0 && (
        <div className="banner info">
          <b>Defumado disponível para embalar:</b>{' '}
          {defumadosDisponiveis.map(d => `${d.nome}: ${Number(d.saldo_kg).toFixed(2)} kg`).join(' · ')}
        </div>
      )}

      <div className="panel">
        <h3>Nova ficha de embalagem</h3>
        <div className="form-grid">
          <div><label>Data da embalagem</label><input type="date" required value={cabecalho.data} onChange={e => setCabecalho({ ...cabecalho, data: e.target.value })} /></div>
          <div><label>Responsável pela manipulação</label>
            <select value={cabecalho.responsavel_id} onChange={e => setCabecalho({ ...cabecalho, responsavel_id: e.target.value })}>
              <option value="">Selecione…</option>
              {funcionarios.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </div>
          <div><label>Sobra de material (kg)</label><input type="number" step="0.001" placeholder="0" value={cabecalho.sobra_kg} onChange={e => setCabecalho({ ...cabecalho, sobra_kg: e.target.value })} /></div>
          <div><label>Observações</label><input placeholder="ocorrências da manipulação…" value={cabecalho.obs} onChange={e => setCabecalho({ ...cabecalho, obs: e.target.value })} /></div>
        </div>

        <div style={{ marginTop: 14 }}>
          <label>Produtos embalados nesta ficha (sem limite de linhas)</label>
          <form className="form-grid" onSubmit={addItem}>
            <div><label>Produto</label>
              <select required value={novoItem.produto_id} onChange={e => setNovoItem({ ...novoItem, produto_id: e.target.value })}>
                <option value="">Selecione…</option>
                {produtos.map(p => <option key={p.id} value={p.id}>{p.codigo} — {p.nome}</option>)}
              </select>
            </div>
            <div><label>Quantidade embalada (un)</label><input type="number" step="1" required value={novoItem.quantidade} onChange={e => setNovoItem({ ...novoItem, quantidade: e.target.value })} /></div>
            <div><label>Peso final dos produtos (kg)</label>
              <input type="number" step="0.001" placeholder="peso real na balança" value={novoItem.peso_total_kg} onChange={e => setNovoItem({ ...novoItem, peso_total_kg: e.target.value })} />
              {(() => {
                const qtd = Number(novoItem.quantidade);
                const peso = Number(novoItem.peso_total_kg);
                if (!qtd || !peso) return null;
                return <p className="muted" style={{ fontSize: 11.5, marginTop: 4, marginBottom: 0 }}>Média por unidade: {(peso / qtd * 1000).toFixed(0)} g</p>;
              })()}
            </div>
            <div><button className="btn secondary" type="submit">Adicionar produto</button></div>
          </form>

          <div className="items-list">
            {itens.length ? itens.map((it, idx) => {
              const prod = produtos.find(p => p.id === it.produto_id);
              return (
                <div className="item-line" key={idx}>
                  <span>{prod ? `${prod.codigo} — ${prod.nome}` : '—'}</span>
                  <span className="num">{it.quantidade} un{it.peso_total_kg ? ` · ${Number(it.peso_total_kg).toFixed(3)} kg` : ''}</span>
                  <button className="btn danger small" onClick={() => setItens(itens.filter((_, i) => i !== idx))}>×</button>
                </div>
              );
            }) : <p className="muted" style={{ fontSize: 12 }}>Nenhum produto adicionado — a ficha pode ter quantos precisar.</p>}
            {itens.length > 0 && (
              <div className="subtotal">{itens.length} produto(s) · {totalUnLista} un{totalKgLista > 0 ? ` · ${totalKgLista.toFixed(3)} kg` : ''}</div>
            )}
          </div>
          <button className="btn" style={{ marginTop: 12 }} onClick={registrar} disabled={salvando}>
            {salvando ? 'Gerando lote…' : 'Registrar embalagem'}
          </button>
          <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
            A ficha baixa o <b>defumado disponível</b> (pela ficha técnica do produto: kg de defumado por unidade) e gera o <b>estoque de produto acabado</b> pronto para venda. O peso real registra a variação de gramas da embalagem.
          </p>
        </div>
      </div>

      <div className="panel">
        <h3>Fichas de embalagem ({lista.length})</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Lote</th><th>Data</th><th>Produtos</th><th>Unidades</th><th>Peso final</th><th>Sobra</th><th>Responsável</th><th></th></tr>
            </thead>
            <tbody>
              {lista.length ? lista.map(em => {
                const its = em.embalagem_itens || [];
                const un = its.reduce((s, i) => s + Number(i.quantidade), 0);
                const kg = its.reduce((s, i) => s + Number(i.peso_total_kg || 0), 0);
                return (
                  <tr key={em.id}>
                    <td className="muted">{em.lote}</td>
                    <td>{fmtDate(em.data)}</td>
                    <td>{its.map(i => i.produtos?.nome).filter(Boolean).join(', ') || '—'}</td>
                    <td className="num">{un}</td>
                    <td className="num">{kg > 0 ? `${kg.toFixed(3)} kg` : '—'}</td>
                    <td className="num">{Number(em.sobra_kg) > 0 ? `${Number(em.sobra_kg).toFixed(3)} kg` : '—'}</td>
                    <td className="muted">{em.funcionarios?.nome || '—'}</td>
                    <td>
                      <div className="row-actions">
                        <button className="btn secondary small" onClick={() => imprimir(em)}>Imprimir ficha</button>
                        <button className="btn danger" onClick={() => excluir(em.id)}>Excluir</button>
                      </div>
                    </td>
                  </tr>
                );
              }) : <tr className="empty-row"><td colSpan={8}>Nenhuma ficha de embalagem lançada.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
