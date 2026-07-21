'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { fmtMoney, fmtDate, hoje, proximoLote } from '../../lib/format';
import AppShell from '../../components/AppShell';
import FichaPrint, { imprimirFicha } from '../../components/FichaPrint';
import { useEmpresaAtual } from '../../lib/empresa';

const FORM_VAZIO = () => ({
  data: hoje(), fornecedor_id: '', materia_prima_id: '', quantidade: '',
  custo_unitario: '', nota_fiscal: '', validade: '', responsavel_id: '',
});

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
  const { empresaAtual } = useEmpresaAtual();
  const [lista, setLista] = useState([]);
  const [mps, setMps] = useState([]);
  const [fornecedores, setFornecedores] = useState([]);
  const [funcionarios, setFuncionarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState(FORM_VAZIO());

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    const [r1, r2, r3, r4] = await Promise.all([
      supabase.from('recebimentos').select('*, materias_primas(nome, unidade), fornecedores(nome), funcionarios(nome)').eq('empresa_id', empresaAtual.id).order('created_at', { ascending: false }),
      supabase.from('materias_primas').select('*').eq('empresa_id', empresaAtual.id).order('nome'),
      supabase.from('fornecedores').select('id, nome').eq('empresa_id', empresaAtual.id).order('nome'),
      supabase.from('funcionarios').select('id, nome').eq('empresa_id', empresaAtual.id).eq('ativo', true).order('nome'),
    ]);
    setLista(r1.data || []);
    setMps(r2.data || []);
    setFornecedores(r3.data || []);
    setFuncionarios(r4.data || []);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  async function registrar(e) {
    e.preventDefault();
    setSalvando(true);
    const lote = await proximoLote(form.data, empresaAtual.id);
    const { error } = await supabase.from('recebimentos').insert([{
      lote,
      data: form.data,
      fornecedor_id: form.fornecedor_id || null,
      materia_prima_id: form.materia_prima_id,
      quantidade: Number(form.quantidade),
      custo_unitario: Number(form.custo_unitario),
      nota_fiscal: form.nota_fiscal || null,
      validade: form.validade || null,
      responsavel_id: form.responsavel_id || null,
      empresa_id: empresaAtual.id,
    }]);
    setSalvando(false);
    if (error) { alert('Erro ao salvar: ' + error.message); return; }
    setForm(FORM_VAZIO());
    carregar();
  }

  async function excluir(id) {
    if (!confirm('Excluir este recebimento? O saldo de estoque será recalculado.')) return;
    const { error } = await supabase.from('recebimentos').delete().eq('id', id);
    if (error) alert('Erro ao excluir: ' + error.message);
    carregar();
  }

  function imprimir(r) {
    imprimirFicha(setFicha, {
      titulo: 'Ficha de Recebimento de Mercadoria',
      numero: `Lote ${r.lote}`,
      campos: [
        { rot: 'Lote', valor: r.lote },
        { rot: 'Data do recebimento', valor: fmtDate(r.data) },
        { rot: 'Fornecedor', valor: r.fornecedores?.nome },
        { rot: 'Matéria-prima', valor: r.materias_primas?.nome },
        { rot: 'Quantidade', valor: `${Number(r.quantidade)} ${r.materias_primas?.unidade || ''}` },
        { rot: 'Custo unitário', valor: fmtMoney(r.custo_unitario) },
        { rot: 'Custo total', valor: fmtMoney(Number(r.quantidade) * Number(r.custo_unitario)) },
        { rot: 'Nota fiscal', valor: r.nota_fiscal },
        { rot: 'Validade', valor: fmtDate(r.validade) },
        { rot: 'Responsável', valor: r.funcionarios?.nome },
      ],
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
          <div><label>Matéria-prima</label>
            <select required value={form.materia_prima_id} onChange={e => setForm({ ...form, materia_prima_id: e.target.value })}>
              <option value="">Selecione…</option>
              {mps.map(m => <option key={m.id} value={m.id}>{m.nome} ({m.unidade})</option>)}
            </select>
          </div>
          <div><label>Quantidade</label><input type="number" step="0.001" required value={form.quantidade} onChange={e => setForm({ ...form, quantidade: e.target.value })} /></div>
          <div><label>Custo unitário (R$)</label><input type="number" step="0.01" required value={form.custo_unitario} onChange={e => setForm({ ...form, custo_unitario: e.target.value })} /></div>
          <div><label>Nota fiscal</label><input value={form.nota_fiscal} onChange={e => setForm({ ...form, nota_fiscal: e.target.value })} /></div>
          <div><label>Validade</label><input type="date" value={form.validade} onChange={e => setForm({ ...form, validade: e.target.value })} /></div>
          <div><label>Responsável</label>
            <select value={form.responsavel_id} onChange={e => setForm({ ...form, responsavel_id: e.target.value })}>
              <option value="">Selecione…</option>
              {funcionarios.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </div>
          <div><button className="btn" type="submit" disabled={salvando}>{salvando ? 'Gerando lote…' : 'Registrar e gerar lote'}</button></div>
        </form>
      </div>

      <div className="panel">
        <h3>Recebimentos ({lista.length})</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Lote</th><th>Data</th><th>Matéria-prima</th><th>Fornecedor</th><th>Qtd</th><th>Custo unit.</th><th>Custo total</th><th>Validade</th><th>Responsável</th><th></th></tr>
            </thead>
            <tbody>
              {lista.length ? lista.map(r => (
                <tr key={r.id}>
                  <td className="muted">{r.lote}</td>
                  <td>{fmtDate(r.data)}</td>
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
              )) : <tr className="empty-row"><td colSpan={10}>Nenhum recebimento lançado.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
