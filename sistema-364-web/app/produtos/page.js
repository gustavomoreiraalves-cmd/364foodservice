'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { fmtMoney, proximoCodigoProduto } from '../../lib/format';
import AppShell from '../../components/AppShell';
import { useEmpresaAtual } from '../../lib/empresa';

const MP_VAZIA = {
  nome: '', categoria: '', unidade: 'kg', custo_unitario: '', preco_alvo_kg: '',
  controle_recebimento: 'simples', exige_temperatura: false, exige_inspecao: false,
  exige_foto: false, exige_documento_sanitario: false, dias_minimos_validade: '',
  permite_recebimento_parcial: true,
};
const PROD_VAZIO = { nome: '', categoria: '', unidade: 'un', preco_venda: '', validade_dias: 90 };
const CONTROLES_RECEBIMENTO = [
  { valor: 'simples', label: 'Tipo A — Simples (sem lote/validade)' },
  { valor: 'validade', label: 'Tipo B — Validade controlada (FEFO)' },
  { valor: 'lote', label: 'Tipo C — Lote completo (rastreável)' },
];

export default function ProdutosPage() {
  return (
    <AppShell modulo="produtos" titulo="Produtos" desc="Catálogo, ficha técnica, custo e preço de venda">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const { empresaAtual } = useEmpresaAtual();
  const [mps, setMps] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [fichas, setFichas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formMP, setFormMP] = useState(MP_VAZIA);
  const [formProd, setFormProd] = useState(PROD_VAZIO);
  const [itemFicha, setItemFicha] = useState({});

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    const [r1, r2, r3] = await Promise.all([
      supabase.from('materias_primas').select('*').eq('empresa_id', empresaAtual.id).order('nome'),
      supabase.from('produtos').select('*').eq('empresa_id', empresaAtual.id).order('codigo'),
      supabase.from('ficha_tecnica').select('*, materias_primas(nome, unidade)').eq('empresa_id', empresaAtual.id),
    ]);
    setMps(r1.data || []);
    setProdutos(r2.data || []);
    setFichas(r3.data || []);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  async function addMP(e) {
    e.preventDefault();
    const { error } = await supabase.from('materias_primas').insert([{
      nome: formMP.nome,
      categoria: formMP.categoria || null,
      unidade: formMP.unidade,
      custo_unitario: Number(formMP.custo_unitario),
      preco_alvo_kg: formMP.preco_alvo_kg ? Number(formMP.preco_alvo_kg) : null,
      controle_recebimento: formMP.controle_recebimento,
      controla_validade: formMP.controle_recebimento !== 'simples',
      controla_lote: formMP.controle_recebimento === 'lote',
      exige_temperatura: formMP.exige_temperatura,
      exige_inspecao: formMP.exige_inspecao,
      exige_foto: formMP.exige_foto,
      exige_documento_sanitario: formMP.exige_documento_sanitario,
      dias_minimos_validade: formMP.dias_minimos_validade ? Number(formMP.dias_minimos_validade) : null,
      permite_recebimento_parcial: formMP.permite_recebimento_parcial,
      empresa_id: empresaAtual.id,
    }]);
    if (error) { alert('Erro ao salvar: ' + error.message); return; }
    setFormMP(MP_VAZIA);
    carregar();
  }

  async function delMP(id) {
    if (!confirm('Excluir esta matéria-prima?')) return;
    const { error } = await supabase.from('materias_primas').delete().eq('id', id);
    if (error) alert('Não foi possível excluir (ela pode estar em uso em fichas técnicas ou recebimentos): ' + error.message);
    carregar();
  }

  async function addProduto(e) {
    e.preventDefault();
    const codigo = await proximoCodigoProduto(empresaAtual.id, empresaAtual.prefixo_codigo);
    const { error } = await supabase.from('produtos').insert([{
      codigo,
      nome: formProd.nome,
      categoria: formProd.categoria || null,
      unidade: formProd.unidade,
      preco_venda: Number(formProd.preco_venda),
      validade_dias: Number(formProd.validade_dias) || 90,
      empresa_id: empresaAtual.id,
    }]);
    if (error) { alert('Erro ao salvar: ' + error.message); return; }
    setFormProd(PROD_VAZIO);
    carregar();
  }

  async function delProduto(id) {
    if (!confirm('Excluir este produto (e sua ficha técnica)?')) return;
    const { error } = await supabase.from('produtos').delete().eq('id', id);
    if (error) alert('Não foi possível excluir (pode haver produções ou pedidos vinculados): ' + error.message);
    carregar();
  }

  async function addItemFicha(e, produtoId) {
    e.preventDefault();
    const item = itemFicha[produtoId] || {};
    if (!item.materia_prima_id || !item.quantidade) return;
    const { error } = await supabase.from('ficha_tecnica').insert([{
      produto_id: produtoId,
      materia_prima_id: item.materia_prima_id,
      quantidade: Number(item.quantidade),
      empresa_id: empresaAtual.id,
    }]);
    if (error) { alert('Erro ao salvar: ' + error.message); return; }
    setItemFicha({ ...itemFicha, [produtoId]: { materia_prima_id: item.materia_prima_id, quantidade: '' } });
    carregar();
  }

  async function delItemFicha(id) {
    await supabase.from('ficha_tecnica').delete().eq('id', id);
    carregar();
  }

  function custoTeorico(produtoId) {
    return fichas
      .filter(f => f.produto_id === produtoId)
      .reduce((s, f) => {
        const mp = mps.find(m => m.id === f.materia_prima_id);
        return s + (mp ? Number(f.quantidade) * Number(mp.custo_unitario) : 0);
      }, 0);
  }

  if (loading) return <p className="muted">Carregando…</p>;

  return (
    <>
      <div className="panel">
        <h3>Matérias-primas cadastradas</h3>
        <form onSubmit={addMP} className="form-grid">
          <div><label>Nome</label><input required value={formMP.nome} onChange={e => setFormMP({ ...formMP, nome: e.target.value })} /></div>
          <div><label>Categoria</label><input placeholder="Carnes, Temperos, Embalagens..." value={formMP.categoria} onChange={e => setFormMP({ ...formMP, categoria: e.target.value })} /></div>
          <div><label>Unidade</label>
            <select value={formMP.unidade} onChange={e => setFormMP({ ...formMP, unidade: e.target.value })}>
              <option value="kg">kg</option><option value="g">g</option><option value="un">un</option><option value="L">L</option>
            </select>
          </div>
          <div><label>Custo unitário padrão (R$)</label><input type="number" step="0.01" required value={formMP.custo_unitario} onChange={e => setFormMP({ ...formMP, custo_unitario: e.target.value })} /></div>
          <div><label>Preço-alvo (R$/kg)</label><input type="number" step="0.01" placeholder="Opcional" value={formMP.preco_alvo_kg} onChange={e => setFormMP({ ...formMP, preco_alvo_kg: e.target.value })} /></div>
          <div><label>Regra de recebimento</label>
            <select value={formMP.controle_recebimento} onChange={e => setFormMP({ ...formMP, controle_recebimento: e.target.value })}>
              {CONTROLES_RECEBIMENTO.map(c => <option key={c.valor} value={c.valor}>{c.label}</option>)}
            </select>
          </div>
          <div><label>Validade mínima na entrada (dias)</label><input type="number" placeholder="Opcional" value={formMP.dias_minimos_validade} onChange={e => setFormMP({ ...formMP, dias_minimos_validade: e.target.value })} /></div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={formMP.exige_temperatura} onChange={e => setFormMP({ ...formMP, exige_temperatura: e.target.checked })} /> Exige temperatura
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={formMP.exige_inspecao} onChange={e => setFormMP({ ...formMP, exige_inspecao: e.target.checked })} /> Exige inspeção
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={formMP.exige_foto} onChange={e => setFormMP({ ...formMP, exige_foto: e.target.checked })} /> Exige foto
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={formMP.exige_documento_sanitario} onChange={e => setFormMP({ ...formMP, exige_documento_sanitario: e.target.checked })} /> Exige documento sanitário
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={formMP.permite_recebimento_parcial} onChange={e => setFormMP({ ...formMP, permite_recebimento_parcial: e.target.checked })} /> Permite recebimento parcial
            </label>
          </div>
          <div><button className="btn" type="submit">Adicionar matéria-prima</button></div>
        </form>
        <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
          O preço-alvo é usado no Recebimento para avisar quando o custo do lote vier acima do esperado. A regra de
          recebimento define os campos exigidos na tela de Recebimento para este item (Simples, Validade controlada ou Lote completo).
        </p>
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table>
            <thead><tr><th>Nome</th><th>Categoria</th><th>Unidade</th><th>Custo padrão</th><th>Preço-alvo</th><th>Regra de recebimento</th><th></th></tr></thead>
            <tbody>
              {mps.length ? mps.map(m => (
                <tr key={m.id}>
                  <td>{m.nome}</td>
                  <td className="muted">{m.categoria || '—'}</td>
                  <td>{m.unidade}</td>
                  <td className="num">{fmtMoney(m.custo_unitario)}</td>
                  <td className="num">{m.preco_alvo_kg != null ? fmtMoney(m.preco_alvo_kg) : '—'}</td>
                  <td className="muted">{CONTROLES_RECEBIMENTO.find(c => c.valor === m.controle_recebimento)?.label || m.controle_recebimento || '—'}</td>
                  <td><button className="btn danger" onClick={() => delMP(m.id)}>Excluir</button></td>
                </tr>
              )) : <tr className="empty-row"><td colSpan={7}>Nenhuma matéria-prima.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h3>Novo produto</h3>
        <form onSubmit={addProduto} className="form-grid">
          <div><label>Nome</label><input required value={formProd.nome} onChange={e => setFormProd({ ...formProd, nome: e.target.value })} /></div>
          <div><label>Categoria</label><input placeholder="Defumado, Embutido..." value={formProd.categoria} onChange={e => setFormProd({ ...formProd, categoria: e.target.value })} /></div>
          <div><label>Unidade de venda</label>
            <select value={formProd.unidade} onChange={e => setFormProd({ ...formProd, unidade: e.target.value })}>
              <option value="un">un</option><option value="kg">kg</option><option value="pct">pacote</option>
            </select>
          </div>
          <div><label>Preço de venda (R$)</label><input type="number" step="0.01" required value={formProd.preco_venda} onChange={e => setFormProd({ ...formProd, preco_venda: e.target.value })} /></div>
          <div><label>Validade do produto (dias)</label><input type="number" value={formProd.validade_dias} onChange={e => setFormProd({ ...formProd, validade_dias: e.target.value })} /></div>
          <div><button className="btn" type="submit">Adicionar produto</button></div>
        </form>
        <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
          O código (0364-XXX) é gerado automaticamente. Depois de criar, defina a ficha técnica (matérias-primas usadas) na lista abaixo.
        </p>
      </div>

      <div className="panel">
        <h3>Catálogo de produtos ({produtos.length})</h3>
        {produtos.length ? produtos.map(p => {
          const custoT = custoTeorico(p.id);
          const margem = Number(p.preco_venda) ? ((Number(p.preco_venda) - custoT) / Number(p.preco_venda) * 100) : 0;
          const itens = fichas.filter(f => f.produto_id === p.id);
          const item = itemFicha[p.id] || { materia_prima_id: mps[0]?.id || '', quantidade: '' };
          return (
            <div className="items-list" style={{ marginBottom: 12 }} key={p.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div><b>{p.codigo}</b> — {p.nome} <span className="muted">({p.categoria || 'sem categoria'})</span></div>
                <div className="row-actions">
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    Custo teórico: {fmtMoney(custoT)} · Preço: {fmtMoney(p.preco_venda)} · Margem: {margem.toFixed(1)}%
                  </span>
                  <button className="btn danger" onClick={() => delProduto(p.id)}>Excluir produto</button>
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <label style={{ marginBottom: 6 }}>Ficha técnica (matéria-prima por unidade produzida)</label>
                {itens.length ? itens.map(f => (
                  <div className="item-line" key={f.id}>
                    <span>{f.materias_primas?.nome || '—'}</span>
                    <span className="num">{Number(f.quantidade)} {f.materias_primas?.unidade || ''}</span>
                    <button className="btn danger small" onClick={() => delItemFicha(f.id)}>×</button>
                  </div>
                )) : <p className="muted" style={{ fontSize: 12 }}>Nenhum item na ficha técnica ainda.</p>}
                <form className="form-grid" style={{ marginTop: 8 }} onSubmit={e => addItemFicha(e, p.id)}>
                  <div><label>Matéria-prima</label>
                    <select value={item.materia_prima_id} onChange={e => setItemFicha({ ...itemFicha, [p.id]: { ...item, materia_prima_id: e.target.value } })}>
                      {mps.map(m => <option key={m.id} value={m.id}>{m.nome} ({m.unidade})</option>)}
                    </select>
                  </div>
                  <div><label>Qtd por unidade</label>
                    <input type="number" step="0.001" required value={item.quantidade} onChange={e => setItemFicha({ ...itemFicha, [p.id]: { ...item, quantidade: e.target.value } })} />
                  </div>
                  <div><button className="btn secondary" type="submit">Adicionar à ficha técnica</button></div>
                </form>
              </div>
            </div>
          );
        }) : <p className="muted">Nenhum produto cadastrado ainda.</p>}
      </div>
    </>
  );
}
