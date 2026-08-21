'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { fmtMoney } from '../../lib/format';
import AppShell from '../../components/AppShell';
import { useEmpresaAtual } from '../../lib/empresa';
import { useCadastro } from '../../lib/cadastro';

const MP_VAZIA = { nome: '', categoria: '', unidade: 'kg', custo_unitario: '', preco_alvo_kg: '' };

export default function MateriasPrimasPage() {
  return (
    <AppShell modulo="produtos" titulo="Matéria-prima e insumos" desc="Cadastro de insumos, custo padrão e preço-alvo">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const { empresaAtual } = useEmpresaAtual();
  const [mps, setMps] = useState([]);
  const [loading, setLoading] = useState(true);

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    const { data } = await supabase.from('materias_primas').select('*').eq('empresa_id', empresaAtual.id).order('nome');
    setMps(data || []);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  const [mostrarInativos, setMostrarInativos] = useState(false);
  const { form, setForm, editando, salvando, iniciarEdicao, cancelarEdicao, salvar, alternarAtivo, excluir } =
    useCadastro({
      tabela: 'materias_primas',
      formVazio: MP_VAZIA,
      empresaId: empresaAtual?.id,
      aoTerminar: carregar,
      paraGravar: f => ({
        nome: f.nome,
        categoria: f.categoria || null,
        unidade: f.unidade,
        custo_unitario: Number(f.custo_unitario),
        // Distinguir "campo vazio" (null) de "zero digitado" (0): input type=number em branco vira '', não falsy check
        preco_alvo_kg: f.preco_alvo_kg === '' || f.preco_alvo_kg === null || f.preco_alvo_kg === undefined
          ? null
          : Number(f.preco_alvo_kg),
      }),
    });

  const emEdicao = editando ? mps.find(m => m.id === editando) : null;
  const visiveis = mostrarInativos ? mps : mps.filter(m => m.ativo !== false);

  if (loading) return <p className="muted">Carregando…</p>;

  return (
    <div className="panel">
      <h3>{emEdicao ? `Editando: ${emEdicao.nome}` : 'Nova matéria-prima'}</h3>
      <form onSubmit={salvar} className="form-grid">
        <div><label>Nome</label><input required value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} /></div>
        <div><label>Categoria</label><input placeholder="Carnes, Temperos, Embalagens..." value={form.categoria} onChange={e => setForm({ ...form, categoria: e.target.value })} /></div>
        <div><label>Unidade</label>
          <select value={form.unidade} onChange={e => setForm({ ...form, unidade: e.target.value })}>
            <option value="kg">kg</option><option value="g">g</option><option value="un">un</option><option value="L">L</option>
          </select>
        </div>
        <div><label>Custo unitário padrão (R$)</label><input type="number" step="0.01" required value={form.custo_unitario} onChange={e => setForm({ ...form, custo_unitario: e.target.value })} /></div>
        <div><label>Preço-alvo (R$/kg)</label><input type="number" step="0.01" placeholder="Opcional" value={form.preco_alvo_kg} onChange={e => setForm({ ...form, preco_alvo_kg: e.target.value })} /></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <button className="btn" type="submit" disabled={salvando}>
            {salvando ? 'Salvando…' : (editando ? 'Salvar alterações' : 'Adicionar matéria-prima')}
          </button>
          {editando && <button className="btn secondary" type="button" onClick={cancelarEdicao}>Cancelar</button>}
        </div>
      </form>
      <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
        O preço-alvo é usado no Recebimento para avisar quando o custo do lote vier acima do esperado.
      </p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={mostrarInativos} onChange={e => setMostrarInativos(e.target.checked)} />
          Mostrar inativas
        </label>
      </div>
      <div className="table-wrap" style={{ marginTop: 8 }}>
        <table>
          <thead><tr><th>Nome</th><th>Categoria</th><th>Unidade</th><th>Custo padrão</th><th>Preço-alvo</th><th></th></tr></thead>
          <tbody>
            {visiveis.length ? visiveis.map(m => {
              const inativa = m.ativo === false;
              return (
                <tr key={m.id} style={inativa ? { opacity: 0.55 } : undefined}>
                  <td>{m.nome} {inativa && <span className="tag warn">inativa</span>}</td>
                  <td className="muted">{m.categoria || '—'}</td>
                  <td>{m.unidade}</td>
                  <td className="num">{fmtMoney(m.custo_unitario)}</td>
                  <td className="num">{m.preco_alvo_kg != null ? fmtMoney(m.preco_alvo_kg) : '—'}</td>
                  <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button className="btn secondary" onClick={() => iniciarEdicao(m)}>Editar</button>
                    <button className="btn secondary" onClick={() => alternarAtivo(m)}>{inativa ? 'Reativar' : 'Desativar'}</button>
                    <button className="btn danger" onClick={() => excluir(m, `Excluir a matéria-prima ${m.nome}?`)}>Excluir</button>
                  </td>
                </tr>
              );
            }) : <tr className="empty-row"><td colSpan={6}>Nenhuma matéria-prima {mostrarInativos ? 'cadastrada' : 'ativa'}.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
