'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { fmtMoney, fmtDate, hoje, proximoLote, custoMedioMP } from '../../lib/format';
import AppShell from '../../components/AppShell';
import FichaPrint, { imprimirFicha } from '../../components/FichaPrint';

const CABECALHO_VAZIO = () => ({ data: hoje(), fornecedor_id: '', nota_fiscal: '', responsavel_id: '' });
const ITEM_VAZIO = () => ({ materia_prima_id: '', quantidade: '', custo_unitario: '', validade: '' });

export default function RecebimentosPage() {
  const [ficha, setFicha] = useState(null);
  return (
    <>
      <AppShell modulo="recebimentos" titulo="Recebimento" desc="Entrada de matéria-prima e geração de lotes">
        <Conteudo setFicha={setFicha} />
      </AppShell>
      <FichaPrint ficha={ficha} />
    </>
  );
}

function Conteudo({ setFicha }) {
  const [lista, setLista] = useState([]);
  const [mps, setMps] = useState([]);
  const [fornecedores, setFornecedores] = useState([]);
  const [funcionarios, setFuncionarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const [cabecalho, setCabecalho] = useState(CABECALHO_VAZIO());
  const [itens, setItens] = useState([]);        // itens da nota em preparação
  const [novoItem, setNovoItem] = useState(ITEM_VAZIO());

  async function carregar() {
    setLoading(true);
    const [r1, r2, r3, r4] = await Promise.all([
      supabase.from('recebimentos').select('*, materias_primas(nome, unidade), fornecedores(nome), funcionarios(nome)').order('created_at', { ascending: false }),
      supabase.from('materias_primas').select('*').order('nome'),
      supabase.from('fornecedores').select('id, nome').order('nome'),
      supabase.from('funcionarios').select('id, nome').eq('ativo', true).order('nome'),
    ]);
    setLista(r1.data || []);
    setMps(r2.data || []);
    setFornecedores(r3.data || []);
    setFuncionarios(r4.data || []);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, []);

  function addItem(e) {
    e.preventDefault();
    if (!novoItem.materia_prima_id || !novoItem.quantidade || !novoItem.custo_unitario) return;
    setItens([...itens, { ...novoItem }]);
    setNovoItem(ITEM_VAZIO());
  }

  async function registrar() {
    if (!itens.length) { alert('Adicione ao menos um item de matéria-prima à nota.'); return; }
    setSalvando(true);

    // um lote sequencial por item: LT-DD/MM/AA-XXX, XXX contínuo no dia
    const primeiroLote = await proximoLote(cabecalho.data);   // ex.: LT-19/07/26-004
    const prefixo = primeiroLote.slice(0, -3);
    const base = parseInt(primeiroLote.slice(-3), 10);

    const linhas = itens.map((it, idx) => ({
      lote: prefixo + String(base + idx).padStart(3, '0'),
      data: cabecalho.data,
      fornecedor_id: cabecalho.fornecedor_id || null,
      materia_prima_id: it.materia_prima_id,
      quantidade: Number(it.quantidade),
      custo_unitario: Number(it.custo_unitario),
      nota_fiscal: cabecalho.nota_fiscal || null,
      validade: it.validade || null,
      responsavel_id: cabecalho.responsavel_id || null,
    }));

    const { error } = await supabase.from('recebimentos').insert(linhas);
    setSalvando(false);
    if (error) { alert('Erro ao salvar: ' + error.message); return; }
    setItens([]);
    setCabecalho(CABECALHO_VAZIO());
    setNovoItem(ITEM_VAZIO());
    carregar();
  }

  async function excluir(id) {
    if (!confirm('Excluir este recebimento? O saldo de estoque será recalculado.')) return;
    const { error } = await supabase.from('recebimentos').delete().eq('id', id);
    if (error) alert('Erro ao excluir: ' + error.message);
    carregar();
  }

  function imprimir(r) {
    // agrupa na ficha todos os itens da mesma nota fiscal (mesma NF + data + fornecedor)
    const grupo = r.nota_fiscal
      ? lista.filter(x => x.nota_fiscal === r.nota_fiscal && x.data === r.data && x.fornecedor_id === r.fornecedor_id)
      : [r];
    const total = grupo.reduce((s, x) => s + Number(x.quantidade) * Number(x.custo_unitario), 0);
    imprimirFicha(setFicha, {
      titulo: 'Ficha de Recebimento de Mercadoria',
      numero: r.nota_fiscal ? `NF ${r.nota_fiscal} · ${fmtDate(r.data)}` : `Lote ${r.lote}`,
      campos: [
        { rot: 'Data do recebimento', valor: fmtDate(r.data) },
        { rot: 'Fornecedor', valor: r.fornecedores?.nome },
        { rot: 'Nota fiscal', valor: r.nota_fiscal },
        { rot: 'Itens na nota', valor: String(grupo.length) },
        { rot: 'Responsável', valor: r.funcionarios?.nome },
      ],
      itens: {
        headers: ['Lote', 'Matéria-prima', 'Qtd', 'Custo unit.', 'Subtotal', 'Validade'],
        rows: grupo.map(x => [
          x.lote,
          x.materias_primas?.nome || '—',
          `${Number(x.quantidade)} ${x.materias_primas?.unidade || ''}`,
          fmtMoney(x.custo_unitario),
          fmtMoney(Number(x.quantidade) * Number(x.custo_unitario)),
          fmtDate(x.validade),
        ]),
      },
      totais: `Total da nota: ${fmtMoney(total)}`,
      assinaturas: ['Responsável pelo recebimento', 'Conferido por'],
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

  const mpDoNovoItem = mps.find(m => m.id === novoItem.materia_prima_id);
  const totalNota = itens.reduce((s, i) => s + Number(i.quantidade) * Number(i.custo_unitario), 0);

  return (
    <>
      <div className="panel">
        <h3>Novo recebimento de mercadoria</h3>
        <div className="form-grid">
          <div><label>Data</label><input type="date" required value={cabecalho.data} onChange={e => setCabecalho({ ...cabecalho, data: e.target.value })} /></div>
          <div><label>Fornecedor</label>
            <select required value={cabecalho.fornecedor_id} onChange={e => setCabecalho({ ...cabecalho, fornecedor_id: e.target.value })}>
              <option value="">Selecione…</option>
              {fornecedores.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </div>
          <div><label>Nota fiscal</label><input value={cabecalho.nota_fiscal} onChange={e => setCabecalho({ ...cabecalho, nota_fiscal: e.target.value })} /></div>
          <div><label>Responsável</label>
            <select value={cabecalho.responsavel_id} onChange={e => setCabecalho({ ...cabecalho, responsavel_id: e.target.value })}>
              <option value="">Selecione…</option>
              {funcionarios.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <label>Itens da nota (matérias-primas — sem limite de linhas)</label>
          <form className="form-grid" onSubmit={addItem}>
            <div><label>Matéria-prima</label>
              <select required value={novoItem.materia_prima_id} onChange={e => setNovoItem({ ...novoItem, materia_prima_id: e.target.value })}>
                <option value="">Selecione…</option>
                {mps.map(m => <option key={m.id} value={m.id}>{m.nome} ({m.unidade})</option>)}
              </select>
            </div>
            <div><label>Quantidade</label><input type="number" step="0.001" required value={novoItem.quantidade} onChange={e => setNovoItem({ ...novoItem, quantidade: e.target.value })} /></div>
            <div><label>Custo unitário (R$)</label>
              <input type="number" step="0.01" required value={novoItem.custo_unitario} onChange={e => setNovoItem({ ...novoItem, custo_unitario: e.target.value })} />
              {(() => {
                const custo = Number(novoItem.custo_unitario);
                if (!mpDoNovoItem || !custo) return null;
                const media = custoMedioMP(mpDoNovoItem.id, lista, mps);
                const alvo = Number(mpDoNovoItem.preco_alvo);
                const difPct = media ? ((custo - media) / media) * 100 : 0;
                return (
                  <p style={{ fontSize: 11.5, marginTop: 4, marginBottom: 0 }}>
                    {media > 0 && (
                      <span className="muted">
                        Custo médio histórico: {fmtMoney(media)}{' '}
                        {Math.abs(difPct) >= 1 && (
                          <span style={{ color: difPct > 0 ? '#b91c1c' : '#15803d', fontWeight: 600 }}>
                            ({difPct > 0 ? '+' : ''}{difPct.toFixed(0)}%)
                          </span>
                        )}
                      </span>
                    )}
                    {alvo > 0 && custo <= alvo && (
                      <span style={{ color: '#15803d', fontWeight: 600 }}> 🟢 No preço-alvo ({fmtMoney(alvo)}) — bom momento para estocar!</span>
                    )}
                    {alvo > 0 && custo > alvo && (
                      <span className="muted"> · preço-alvo: {fmtMoney(alvo)}</span>
                    )}
                  </p>
                );
              })()}
            </div>
            <div><label>Validade</label><input type="date" value={novoItem.validade} onChange={e => setNovoItem({ ...novoItem, validade: e.target.value })} /></div>
            <div><button className="btn secondary" type="submit">Adicionar item</button></div>
          </form>

          <div className="items-list">
            {itens.length ? itens.map((it, idx) => {
              const mp = mps.find(m => m.id === it.materia_prima_id);
              return (
                <div className="item-line" key={idx}>
                  <span>{mp?.nome || '—'}</span>
                  <span className="num">{it.quantidade} {mp?.unidade || ''} × {fmtMoney(it.custo_unitario)}{it.validade ? ` · val. ${fmtDate(it.validade)}` : ''}</span>
                  <button className="btn danger small" onClick={() => setItens(itens.filter((_, i) => i !== idx))}>×</button>
                </div>
              );
            }) : <p className="muted" style={{ fontSize: 12 }}>Nenhum item adicionado ainda — uma mesma nota pode ter quantos itens precisar.</p>}
            {itens.length > 0 && (
              <div className="subtotal">Total da nota ({itens.length} item(ns)): {fmtMoney(totalNota)}</div>
            )}
          </div>
          <button className="btn" style={{ marginTop: 12 }} onClick={registrar} disabled={salvando}>
            {salvando ? 'Gerando lotes…' : `Registrar recebimento (${itens.length} lote${itens.length === 1 ? '' : 's'})`}
          </button>
          <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
            Cada item da nota gera seu próprio lote (LT-DD/MM/AA-XXX, numeração sequencial do dia). A ficha impressa agrupa todos os itens da mesma nota fiscal.
          </p>
        </div>
      </div>

      <div className="panel">
        <h3>Recebimentos ({lista.length})</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Lote</th><th>Data</th><th>NF</th><th>Matéria-prima</th><th>Fornecedor</th><th>Qtd</th><th>Custo unit.</th><th>Custo total</th><th>Validade</th><th>Responsável</th><th></th></tr>
            </thead>
            <tbody>
              {lista.length ? lista.map(r => (
                <tr key={r.id}>
                  <td className="muted">{r.lote}</td>
                  <td>{fmtDate(r.data)}</td>
                  <td className="muted">{r.nota_fiscal || '—'}</td>
                  <td>{r.materias_primas?.nome || '—'}</td>
                  <td>{r.fornecedores?.nome || '—'}</td>
                  <td className="num">{Number(r.quantidade)} {r.materias_primas?.unidade || ''}</td>
                  <td className="num">{fmtMoney(r.custo_unitario)}</td>
                  <td className="num">{fmtMoney(Number(r.quantidade) * Number(r.custo_unitario))}</td>
                  <td>{fmtDate(r.validade)}</td>
                  <td className="muted">{r.funcionarios?.nome || '—'}</td>
                  <td>
                    <div className="row-actions">
                      <button className="btn secondary small" onClick={() => imprimir(r)}>Imprimir ficha</button>
                      <button className="btn danger" onClick={() => excluir(r.id)}>Excluir</button>
                    </div>
                  </td>
                </tr>
              )) : <tr className="empty-row"><td colSpan={11}>Nenhum recebimento lançado.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
