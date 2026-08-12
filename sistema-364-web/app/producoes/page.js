'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { fmtMoney, fmtDate, hoje, proximoLote, custoMedioMP } from '../../lib/format';
import AppShell from '../../components/AppShell';
import FichaPrint, { imprimirFicha } from '../../components/FichaPrint';
import { useEmpresaAtual } from '../../lib/empresa';

const FORM_VAZIO = () => ({ data: hoje(), produto_id: '', quantidade: '', responsavel_id: '' });

export default function ProducoesPage() {
  const [ficha, setFicha] = useState(null);
  return (
    <>
      <AppShell modulo="producoes" titulo="Produção" desc="Lançamento de lotes produzidos e cálculo de custo">
        <Conteudo setFicha={setFicha} />
      </AppShell>
      <FichaPrint ficha={ficha} />
    </>
  );
}

function Conteudo({ setFicha }) {
  const { empresaAtual } = useEmpresaAtual();
  const [lista, setLista] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [fichasTec, setFichasTec] = useState([]);
  const [mps, setMps] = useState([]);
  const [recebimentos, setRecebimentos] = useState([]);
  const [estoqueMP, setEstoqueMP] = useState([]);
  const [funcionarios, setFuncionarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState(FORM_VAZIO());

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    const eid = empresaAtual.id;
    const [r1, r2, r3, r4, r5, r6, r7] = await Promise.all([
      supabase.from('producoes').select('*, produtos(nome, codigo, unidade), funcionarios(nome), producao_consumo(quantidade, materias_primas(nome, unidade))').eq('empresa_id', eid).order('created_at', { ascending: false }),
      supabase.from('produtos').select('*').eq('empresa_id', eid).order('codigo'),
      supabase.from('ficha_tecnica').select('*').eq('empresa_id', eid),
      supabase.from('materias_primas').select('*').eq('empresa_id', eid),
      supabase.from('stock_balances').select('materia_prima_id, quantidade, custo_unitario').eq('empresa_id', eid),
      supabase.from('vw_estoque_materia_prima').select('*').eq('empresa_id', eid),
      supabase.from('funcionarios').select('id, nome').eq('empresa_id', eid).eq('ativo', true).order('nome'),
    ]);
    setLista(r1.data || []);
    setProdutos(r2.data || []);
    setFichasTec(r3.data || []);
    setMps(r4.data || []);
    setRecebimentos(r5.data || []);
    setEstoqueMP(r6.data || []);
    setFuncionarios(r7.data || []);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  async function registrar(e) {
    e.preventDefault();
    const produto = produtos.find(p => p.id === form.produto_id);
    const qtd = Number(form.quantidade);
    const itensFicha = fichasTec.filter(f => f.produto_id === form.produto_id);

    if (!itensFicha.length) {
      alert('Este produto ainda não tem ficha técnica definida (aba Produtos). Cadastre antes de lançar produção.');
      return;
    }

    // consumo de matéria-prima = ficha técnica × quantidade produzida
    const consumo = itensFicha.map(it => ({
      materia_prima_id: it.materia_prima_id,
      quantidade: Number(it.quantidade) * qtd,
    }));

    // aviso de estoque insuficiente
    for (const c of consumo) {
      const saldo = Number(estoqueMP.find(x => x.materia_prima_id === c.materia_prima_id)?.saldo || 0);
      if (saldo < c.quantidade) {
        const mp = mps.find(m => m.id === c.materia_prima_id);
        if (!confirm(`Estoque insuficiente de "${mp?.nome}" (saldo ${saldo.toFixed(2)}, necessário ${c.quantidade.toFixed(2)}). Registrar produção mesmo assim?`)) return;
      }
    }

    // custo do lote pelo custo médio de cada matéria-prima
    const custoTotal = consumo.reduce((s, c) => s + c.quantidade * custoMedioMP(c.materia_prima_id, recebimentos, mps), 0);

    // validade = data + validade_dias do produto
    const validade = new Date(form.data + 'T00:00:00');
    validade.setDate(validade.getDate() + Number(produto?.validade_dias || 90));

    setSalvando(true);
    const lote = await proximoLote(form.data, empresaAtual.id);
    const { data: nova, error } = await supabase.from('producoes').insert([{
      lote,
      data: form.data,
      produto_id: form.produto_id,
      quantidade: qtd,
      custo_total: Math.round(custoTotal * 100) / 100,
      validade: validade.toISOString().slice(0, 10),
      responsavel_id: form.responsavel_id || null,
      empresa_id: empresaAtual.id,
    }]).select().single();

    if (error) { setSalvando(false); alert('Erro ao salvar: ' + error.message); return; }

    const { error: e2 } = await supabase.from('producao_consumo').insert(
      consumo.map(c => ({ producao_id: nova.id, empresa_id: empresaAtual.id, ...c }))
    );
    setSalvando(false);
    if (e2) { alert('Produção salva, mas houve erro ao gravar o consumo: ' + e2.message); }
    setForm(FORM_VAZIO());
    carregar();
  }

  async function excluir(id) {
    if (!confirm('Excluir este lote de produção? O consumo de matéria-prima será estornado.')) return;
    const { error } = await supabase.from('producoes').delete().eq('id', id);
    if (error) alert('Erro ao excluir: ' + error.message);
    carregar();
  }

  function imprimir(pr) {
    imprimirFicha(setFicha, {
      titulo: 'Ficha de Produção',
      numero: `Lote ${pr.lote}`,
      campos: [
        { rot: 'Lote', valor: pr.lote },
        { rot: 'Data da produção', valor: fmtDate(pr.data) },
        { rot: 'Produto', valor: `${pr.produtos?.codigo || ''} — ${pr.produtos?.nome || ''}` },
        { rot: 'Quantidade produzida', valor: `${Number(pr.quantidade)} ${pr.produtos?.unidade || ''}` },
        { rot: 'Custo total do lote', valor: fmtMoney(pr.custo_total) },
        { rot: 'Custo unitário', valor: fmtMoney(Number(pr.custo_total) / Number(pr.quantidade)) },
        { rot: 'Validade', valor: fmtDate(pr.validade) },
        { rot: 'Responsável', valor: pr.funcionarios?.nome },
      ],
      itens: {
        headers: ['Matéria-prima consumida', 'Quantidade'],
        rows: (pr.producao_consumo || []).map(c => [
          c.materias_primas?.nome || '—',
          `${Number(c.quantidade).toFixed(3)} ${c.materias_primas?.unidade || ''}`,
        ]),
      },
      assinaturas: ['Responsável pela produção', 'Controle de qualidade'],
    });
  }

  if (loading) return <p className="muted">Carregando…</p>;

  if (!produtos.length) {
    return (
      <div className="banner info">
        Cadastre ao menos um produto (com ficha técnica) na aba <b>Produtos</b> antes de lançar produção.
      </div>
    );
  }

  return (
    <>
      <div className="panel">
        <h3>Novo lote de produção</h3>
        <form onSubmit={registrar} className="form-grid">
          <div><label>Data</label><input type="date" required value={form.data} onChange={e => setForm({ ...form, data: e.target.value })} /></div>
          <div><label>Produto</label>
            <select required value={form.produto_id} onChange={e => setForm({ ...form, produto_id: e.target.value })}>
              <option value="">Selecione…</option>
              {produtos.map(p => <option key={p.id} value={p.id}>{p.codigo} — {p.nome}</option>)}
            </select>
          </div>
          <div><label>Quantidade produzida</label><input type="number" step="0.001" required value={form.quantidade} onChange={e => setForm({ ...form, quantidade: e.target.value })} /></div>
          <div><label>Responsável</label>
            <select value={form.responsavel_id} onChange={e => setForm({ ...form, responsavel_id: e.target.value })}>
              <option value="">Selecione…</option>
              {funcionarios.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </div>
          <div><button className="btn" type="submit" disabled={salvando}>{salvando ? 'Registrando…' : 'Registrar produção'}</button></div>
        </form>
        <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
          O sistema calcula automaticamente o consumo de matéria-prima com base na ficha técnica do produto, dá baixa no estoque e calcula o custo do lote.
        </p>
      </div>

      <div className="panel">
        <h3>Lotes produzidos ({lista.length})</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Lote</th><th>Data</th><th>Produto</th><th>Qtd</th><th>Custo total</th><th>Custo unit.</th><th>Validade</th><th>Responsável</th><th></th></tr>
            </thead>
            <tbody>
              {lista.length ? lista.map(pr => (
                <tr key={pr.id}>
                  <td className="muted">{pr.lote}</td>
                  <td>{fmtDate(pr.data)}</td>
                  <td>{pr.produtos?.nome || '—'}</td>
                  <td className="num">{Number(pr.quantidade)}</td>
                  <td className="num">{fmtMoney(pr.custo_total)}</td>
                  <td className="num">{fmtMoney(Number(pr.custo_total) / Number(pr.quantidade))}</td>
                  <td>{fmtDate(pr.validade)}</td>
                  <td className="muted">{pr.funcionarios?.nome || '—'}</td>
                  <td>
                    <div className="row-actions">
                      <button className="btn secondary small" onClick={() => imprimir(pr)}>Imprimir ficha</button>
                      <button className="btn danger" onClick={() => excluir(pr.id)}>Excluir</button>
                    </div>
                  </td>
                </tr>
              )) : <tr className="empty-row"><td colSpan={9}>Nenhuma produção lançada.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
