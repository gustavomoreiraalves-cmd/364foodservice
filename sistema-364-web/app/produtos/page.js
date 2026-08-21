'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { fmtMoney, proximoCodigoProduto, parseCustoUnitario } from '../../lib/format';
import { CONSERVACOES } from '../../lib/producao';
import AppShell from '../../components/AppShell';
import { useEmpresaAtual } from '../../lib/empresa';
import { camposDoFormulario } from '../../lib/cadastro';

const PROD_VAZIO = { nome: '', categoria: '', unidade: 'un', custo_unitario: '', preco_venda: '', validade_dias: 90, producao_interna: false };

const CUSTO_INVALIDO = 'Custo inválido. Informe um número igual ou maior que zero (ex.: 45,50), sem separador de milhar. Deixe em branco para usar o custo da ficha técnica.';

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
  const [formProd, setFormProd] = useState(PROD_VAZIO);
  const [itemFicha, setItemFicha] = useState({});
  const [regras, setRegras] = useState([]);
  const [regraForm, setRegraForm] = useState({});
  const [editandoProduto, setEditandoProduto] = useState(null);
  const [mostrarInativos, setMostrarInativos] = useState(false);

  const produtoEmEdicao = editandoProduto ? produtos.find(p => p.id === editandoProduto) : null;
  const produtosVisiveis = mostrarInativos ? produtos : produtos.filter(p => p.ativo !== false);

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    const [r1, r2, r3, r4] = await Promise.all([
      supabase.from('materias_primas').select('*').eq('empresa_id', empresaAtual.id).order('nome'),
      supabase.from('produtos').select('*').eq('empresa_id', empresaAtual.id).order('codigo'),
      supabase.from('ficha_tecnica').select('*, materias_primas(nome, unidade)').eq('empresa_id', empresaAtual.id),
      supabase.from('produto_regras_validade').select('*').eq('empresa_id', empresaAtual.id),
    ]);
    setMps(r1.data || []);
    setProdutos(r2.data || []);
    setFichas(r3.data || []);
    setRegras(r4.data || []);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  async function salvarProduto(e) {
    e.preventDefault();
    // Mesma validação do "Editar custo": sem ela `Number('-5') || 0` gravaria
    // -5 e um texto inválido viraria 0 em silêncio.
    const custo = parseCustoUnitario(formProd.custo_unitario);
    if (custo === null) { alert(CUSTO_INVALIDO); return; }

    const campos = {
      nome: formProd.nome,
      categoria: formProd.categoria || null,
      unidade: formProd.unidade,
      custo_unitario: custo,
      preco_venda: Number(formProd.preco_venda),
      // Teste tem que ser "campo em branco", não falsy: `|| 90` apagaria um
      // validade_dias = 0 salvo de propósito ao reabrir o produto para editar.
      validade_dias: formProd.validade_dias === '' || formProd.validade_dias === null || formProd.validade_dias === undefined
        ? 90
        : Number(formProd.validade_dias),
      producao_interna: !!formProd.producao_interna,
    };

    let error;
    if (editandoProduto) {
      ({ error } = await supabase.from('produtos').update(campos).eq('id', editandoProduto));
    } else {
      const codigo = await proximoCodigoProduto(empresaAtual.id, empresaAtual.prefixo_codigo);
      ({ error } = await supabase.from('produtos').insert([{ ...campos, codigo, empresa_id: empresaAtual.id }]));
    }
    if (error) { alert('Erro ao salvar: ' + error.message); return; }
    cancelarEdicaoProduto();
    carregar();
  }

  function iniciarEdicaoProduto(p) {
    setFormProd(camposDoFormulario(p, PROD_VAZIO));
    setEditandoProduto(p.id);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelarEdicaoProduto() {
    setFormProd(PROD_VAZIO);
    setEditandoProduto(null);
  }

  async function alternarAtivoProduto(p) {
    const { error } = await supabase.from('produtos')
      .update({ ativo: !(p.ativo !== false) }).eq('id', p.id);
    if (error) { alert('Não foi possível mudar a situação: ' + error.message); return; }
    carregar();
  }

  async function delProduto(id) {
    if (!confirm('Excluir este produto (e sua ficha técnica)?')) return;
    const { error } = await supabase.from('produtos').delete().eq('id', id);
    if (error) { alert('Não foi possível excluir (pode haver produções ou pedidos vinculados): ' + error.message); return; }
    // Sem isto, excluir o produto que está aberto para edição deixava o
    // formulário preso em "Editando: …" apontando para um id que já era.
    if (editandoProduto === id) cancelarEdicaoProduto();
    carregar();
  }

  async function salvarCusto(produtoId, valor) {
    // prompt() cancelado devolve null: não é "custo vazio", é "desisti".
    if (valor === null || valor === undefined) return;
    // Campo apagado devolve '' e vira 0 — que é exatamente "usar a ficha
    // técnica", como o texto de ajuda do formulário promete.
    const custo = parseCustoUnitario(valor);
    if (custo === null) { alert(CUSTO_INVALIDO); return; }
    const { error } = await supabase.from('produtos')
      .update({ custo_unitario: custo })
      .eq('id', produtoId);
    if (error) { alert('Erro ao salvar o custo: ' + error.message); return; }
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

  async function toggleProducaoInterna(p) {
    const { error } = await supabase.from('produtos').update({ producao_interna: !p.producao_interna }).eq('id', p.id);
    if (error) { alert('Erro ao atualizar: ' + error.message); return; }
    carregar();
  }

  function regraDe(produtoId, conservacao) {
    return regras.find(r => r.produto_id === produtoId && r.conservacao === conservacao);
  }

  async function salvarRegra(produtoId, conservacao) {
    const chave = `${produtoId}:${conservacao}`;
    const atual = regraDe(produtoId, conservacao);
    const f = regraForm[chave] || {
      permitido: atual ? atual.permitido : true,
      valor: atual?.validade_valor || '',
      unidade: atual?.validade_unidade || 'dias',
    };
    if (f.permitido && !Number(f.valor)) { alert('Informe o prazo de validade para conservação permitida.'); return; }
    const { error } = await supabase.from('produto_regras_validade').upsert([{
      empresa_id: empresaAtual.id,
      produto_id: produtoId,
      conservacao,
      permitido: !!f.permitido,
      validade_valor: f.permitido ? Number(f.valor) : null,
      validade_unidade: f.permitido ? f.unidade : null,
      ativo: true,
    }], { onConflict: 'produto_id,conservacao' });
    if (error) { alert('Erro ao salvar regra: ' + error.message); return; }
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
        <h3>{produtoEmEdicao ? `Editando: ${produtoEmEdicao.codigo} — ${produtoEmEdicao.nome}` : 'Novo produto'}</h3>
        <form onSubmit={salvarProduto} className="form-grid">
          <div><label>Nome</label><input required value={formProd.nome} onChange={e => setFormProd({ ...formProd, nome: e.target.value })} /></div>
          <div><label>Categoria</label><input placeholder="Defumado, Embutido..." value={formProd.categoria} onChange={e => setFormProd({ ...formProd, categoria: e.target.value })} /></div>
          <div><label>Unidade de venda</label>
            <select value={formProd.unidade} onChange={e => setFormProd({ ...formProd, unidade: e.target.value })}>
              <option value="un">un</option><option value="kg">kg</option><option value="pct">pacote</option>
            </select>
          </div>
          <div>
            <label>Custo unitário (R$)</label>
            <input type="number" step="0.01" placeholder="0,00" value={formProd.custo_unitario}
                   onChange={e => setFormProd({ ...formProd, custo_unitario: e.target.value })} />
          </div>
          <div><label>Preço de venda (R$)</label><input type="number" step="0.01" required value={formProd.preco_venda} onChange={e => setFormProd({ ...formProd, preco_venda: e.target.value })} /></div>
          <div><label>Validade do produto (dias)</label><input type="number" value={formProd.validade_dias} onChange={e => setFormProd({ ...formProd, validade_dias: e.target.value })} /></div>
          <div><label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={formProd.producao_interna} onChange={e => setFormProd({ ...formProd, producao_interna: e.target.checked })} />
            Produto de produção interna
          </label></div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <button className="btn" type="submit">{editandoProduto ? 'Salvar alterações' : 'Adicionar produto'}</button>
            {editandoProduto && <button className="btn secondary" type="button" onClick={cancelarEdicaoProduto}>Cancelar</button>}
          </div>
        </form>
        <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
          O código (0364-XXX) é gerado automaticamente. Depois de criar, defina a ficha técnica (matérias-primas usadas) na lista abaixo. Deixar o custo em branco faz o sistema usar o custo teórico da ficha técnica no cálculo de CMV.
        </p>
      </div>

      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h3>Catálogo de produtos ({produtosVisiveis.length})</h3>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={mostrarInativos} onChange={e => setMostrarInativos(e.target.checked)} />
            Mostrar inativos
          </label>
        </div>
        {produtosVisiveis.length ? produtosVisiveis.map(p => {
          const custoT = custoTeorico(p.id);
          const custoEfetivo = Number(p.custo_unitario) > 0 ? Number(p.custo_unitario) : custoT;
          const margem = Number(p.preco_venda) ? ((Number(p.preco_venda) - custoEfetivo) / Number(p.preco_venda) * 100) : 0;
          const itens = fichas.filter(f => f.produto_id === p.id);
          const item = itemFicha[p.id] || { materia_prima_id: mps[0]?.id || '', quantidade: '' };
          return (
            <div className="items-list" style={{ marginBottom: 12, ...(p.ativo === false ? { opacity: 0.55 } : {}) }} key={p.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <b>{p.codigo}</b> — {p.nome} <span className="muted">({p.categoria || 'sem categoria'})</span>
                  {p.producao_interna && <span style={{ marginLeft: 8, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--amber-bright)', border: '1px solid var(--amber)', borderRadius: 4, padding: '2px 6px' }}>Produção interna</span>}
                  {p.ativo === false && <span className="tag warn" style={{ marginLeft: 8 }}>inativo</span>}
                </div>
                <div className="row-actions">
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    Custo: {fmtMoney(custoEfetivo)}
                    {Number(p.custo_unitario) > 0
                      ? <span className="tag ok" style={{ marginLeft: 6 }}>cadastrado</span>
                      : custoT > 0
                        ? <span className="tag warn" style={{ marginLeft: 6 }}>pela ficha</span>
                        : <span className="tag bad" style={{ marginLeft: 6 }}>sem custo</span>}
                    {' · '}Preço: {fmtMoney(p.preco_venda)} · Margem: {margem.toFixed(1)}%
                  </span>
                  <button className="btn secondary small"
                          onClick={() => salvarCusto(p.id, prompt(`Custo unitário de ${p.nome} (R$). Custo teórico da ficha: ${fmtMoney(custoT)}`, p.custo_unitario || custoT.toFixed(2)))}>
                    Editar custo
                  </button>
                  <button className="btn secondary small" onClick={() => toggleProducaoInterna(p)}>
                    {p.producao_interna ? 'Remover de produção interna' : 'Marcar como produção interna'}
                  </button>
                  <button className="btn secondary" onClick={() => iniciarEdicaoProduto(p)}>Editar</button>
                  <button className="btn secondary" onClick={() => alternarAtivoProduto(p)}>{p.ativo === false ? 'Reativar' : 'Desativar'}</button>
                  <button className="btn danger" onClick={() => delProduto(p.id)}>Excluir produto</button>
                </div>
              </div>
              {p.producao_interna && (
                <div style={{ marginTop: 10 }}>
                  <label style={{ marginBottom: 6 }}>Conservação e validade (usadas na Produção Interna)</label>
                  {CONSERVACOES.map(c => {
                    const chave = `${p.id}:${c.id}`;
                    const atual = regraDe(p.id, c.id);
                    const f = regraForm[chave] || {
                      permitido: atual ? atual.permitido : false,
                      valor: atual?.validade_valor || '',
                      unidade: atual?.validade_unidade || 'dias',
                    };
                    const setF = novo => setRegraForm({ ...regraForm, [chave]: { ...f, ...novo } });
                    return (
                      <div className="item-line" key={c.id} style={{ gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ minWidth: 90 }}>{c.label}</span>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', margin: 0 }}>
                          <input type="checkbox" checked={!!f.permitido} onChange={e => setF({ permitido: e.target.checked })} />
                          Permitido
                        </label>
                        {f.permitido && (
                          <>
                            <input type="number" min="1" style={{ width: 80 }} placeholder="Prazo" value={f.valor} onChange={e => setF({ valor: e.target.value })} />
                            <select value={f.unidade} onChange={e => setF({ unidade: e.target.value })}>
                              <option value="dias">dias</option><option value="horas">horas</option>
                            </select>
                          </>
                        )}
                        <button className="btn secondary small" type="button" onClick={() => salvarRegra(p.id, c.id)}>Salvar</button>
                        <span className="muted" style={{ fontSize: 11 }}>
                          {atual ? (atual.permitido ? `Regra atual: ${atual.validade_valor} ${atual.validade_unidade}` : 'Regra atual: não permitido') : 'Sem regra definida'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
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
