'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { fmtMoney, fmtDate, hoje, proximoLote, custoMedioMP } from '../../lib/format';
import AppShell from '../../components/AppShell';
import FichaPrint, { imprimirFicha } from '../../components/FichaPrint';

const CABECALHO_VAZIO = () => ({ data: hoje(), hora_inicio: '', hora_fim: '', temperatura_c: '', responsavel_id: '', obs: '' });
const ITEM_VAZIO = () => ({ materia_prima_id: '', peso_bruto_kg: '', perda_limpeza_kg: '', sobra_kg: '', peso_final_kg: '' });

// Aproveitamento global do item: defumado obtido ÷ MP bruta que entrou
function aproveitamento(it) {
  const bruto = Number(it.peso_bruto_kg);
  const final = Number(it.peso_final_kg);
  if (!bruto || !final) return null;
  return final / bruto;
}

export default function ProducoesPage() {
  const [ficha, setFicha] = useState(null);
  return (
    <>
      <AppShell modulo="producoes" titulo="Produção · Defumação" desc="Ficha de defumação: manipulação, perdas, sobras e rendimento">
        <Conteudo setFicha={setFicha} />
      </AppShell>
      <FichaPrint ficha={ficha} />
    </>
  );
}

function Conteudo({ setFicha }) {
  const [lista, setLista] = useState([]);
  const [mps, setMps] = useState([]);
  const [recebimentos, setRecebimentos] = useState([]);
  const [estoqueMP, setEstoqueMP] = useState([]);
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
      supabase.from('defumacoes').select('*, funcionarios(nome), defumacao_itens(id, materia_prima_id, peso_bruto_kg, perda_limpeza_kg, sobra_kg, peso_final_kg, materias_primas(nome))').order('created_at', { ascending: false }),
      supabase.from('materias_primas').select('*').order('nome'),
      supabase.from('recebimentos').select('materia_prima_id, quantidade, custo_unitario'),
      supabase.from('vw_estoque_materia_prima').select('*'),
      supabase.from('funcionarios').select('id, nome').eq('ativo', true).order('nome'),
    ]);
    if (r1.error && /defumacoes/.test(r1.error.message)) { setSemTabela(true); setLoading(false); return; }
    setLista(r1.data || []);
    setMps(r2.data || []);
    setRecebimentos(r3.data || []);
    setEstoqueMP(r4.data || []);
    setFuncionarios(r5.data || []);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, []);

  function addItem(e) {
    e.preventDefault();
    if (!novoItem.materia_prima_id || !novoItem.peso_bruto_kg || !novoItem.peso_final_kg) return;
    const bruto = Number(novoItem.peso_bruto_kg);
    const perda = Number(novoItem.perda_limpeza_kg) || 0;
    const sobra = Number(novoItem.sobra_kg) || 0;
    const final = Number(novoItem.peso_final_kg);

    if (perda + sobra >= bruto && !confirm(`Perda (${perda} kg) + sobra (${sobra} kg) igual ou maior que o peso bruto (${bruto} kg). Confere? Adicionar mesmo assim?`)) return;
    const rend = final / bruto;
    if (rend > 1 && !confirm(`Peso defumado (${final} kg) maior que o peso bruto (${bruto} kg). Confere? Adicionar mesmo assim?`)) return;
    if (rend < 0.4 && !confirm(`Aproveitamento de ${(rend * 100).toFixed(1)}% — abaixo do alerta de 40%. Verifique pesagem, limpeza ou tempo de defumação. Adicionar mesmo assim?`)) return;

    const saldo = Number(estoqueMP.find(x => x.materia_prima_id === novoItem.materia_prima_id)?.saldo || 0);
    if (saldo < bruto && !confirm(`Estoque de matéria-prima insuficiente (saldo ${saldo.toFixed(2)} kg, informado ${bruto} kg). Adicionar mesmo assim?`)) return;

    setItens([...itens, { ...novoItem }]);
    setNovoItem(ITEM_VAZIO());
  }

  async function registrar() {
    if (!itens.length) { alert('Adicione ao menos uma matéria-prima defumada à ficha.'); return; }
    setSalvando(true);
    const lote = await proximoLote(cabecalho.data);
    const { data: nova, error } = await supabase.from('defumacoes').insert([{
      lote,
      data: cabecalho.data,
      hora_inicio: cabecalho.hora_inicio || null,
      hora_fim: cabecalho.hora_fim || null,
      temperatura_c: cabecalho.temperatura_c ? Number(cabecalho.temperatura_c) : null,
      responsavel_id: cabecalho.responsavel_id || null,
      obs: cabecalho.obs || null,
    }]).select().single();
    if (error) { setSalvando(false); alert('Erro ao salvar: ' + error.message); return; }

    const { error: e2 } = await supabase.from('defumacao_itens').insert(itens.map(it => ({
      defumacao_id: nova.id,
      materia_prima_id: it.materia_prima_id,
      peso_bruto_kg: Number(it.peso_bruto_kg),
      perda_limpeza_kg: Number(it.perda_limpeza_kg) || 0,
      sobra_kg: Number(it.sobra_kg) || 0,
      peso_final_kg: Number(it.peso_final_kg),
    })));
    setSalvando(false);
    if (e2) { alert('Ficha salva, mas houve erro ao gravar os itens: ' + e2.message); }
    setItens([]);
    setCabecalho(CABECALHO_VAZIO());
    carregar();
  }

  async function excluir(id) {
    if (!confirm('Excluir esta ficha de defumação? O consumo de matéria-prima e o defumado gerado serão estornados.')) return;
    const { error } = await supabase.from('defumacoes').delete().eq('id', id);
    if (error) alert('Erro ao excluir: ' + error.message);
    carregar();
  }

  function custoItens(its) {
    return its.reduce((s, it) => s + Number(it.peso_bruto_kg) * custoMedioMP(it.materia_prima_id, recebimentos, mps), 0);
  }

  function imprimir(d) {
    const its = d.defumacao_itens || [];
    const totalBruto = its.reduce((s, i) => s + Number(i.peso_bruto_kg), 0);
    const totalFinal = its.reduce((s, i) => s + Number(i.peso_final_kg), 0);
    imprimirFicha(setFicha, {
      titulo: 'Ficha de Produção — Defumação',
      numero: `Lote ${d.lote}`,
      campos: [
        { rot: 'Lote', valor: d.lote },
        { rot: 'Data da produção', valor: fmtDate(d.data) },
        { rot: 'Início da defumação', valor: d.hora_inicio ? String(d.hora_inicio).slice(0, 5) : '—' },
        { rot: 'Fim da defumação', valor: d.hora_fim ? String(d.hora_fim).slice(0, 5) : '—' },
        { rot: 'Temperatura de defumação', valor: d.temperatura_c ? `${Number(d.temperatura_c)} °C` : '—' },
        { rot: 'Responsável pela defumação', valor: d.funcionarios?.nome },
        { rot: 'Peso bruto total', valor: `${totalBruto.toFixed(3)} kg` },
        { rot: 'Peso defumado total', valor: `${totalFinal.toFixed(3)} kg` },
        { rot: 'Aproveitamento geral', valor: totalBruto ? `${((totalFinal / totalBruto) * 100).toFixed(1)}%` : '—' },
        { rot: 'Custo da matéria-prima', valor: fmtMoney(custoItens(its)) },
        { rot: 'Observações', valor: d.obs },
      ],
      itens: {
        headers: ['Matéria-prima', 'Peso bruto', 'Perda limpeza', 'Sobra', 'Peso defumado', 'Aproveit.'],
        rows: its.map(i => [
          i.materias_primas?.nome || '—',
          `${Number(i.peso_bruto_kg).toFixed(3)} kg`,
          `${Number(i.perda_limpeza_kg).toFixed(3)} kg`,
          `${Number(i.sobra_kg).toFixed(3)} kg`,
          `${Number(i.peso_final_kg).toFixed(3)} kg`,
          aproveitamento(i) !== null ? `${(aproveitamento(i) * 100).toFixed(1)}%` : '—',
        ]),
      },
      assinaturas: ['Responsável pela defumação', 'Controle de qualidade'],
    });
  }

  if (loading) return <p className="muted">Carregando…</p>;

  if (semTabela) {
    return (
      <div className="banner info">
        As tabelas de defumação ainda não existem no banco. Rode o script <b>supabase/atualizacao_06_defumacao_embalagem.sql</b> no SQL Editor do Supabase e recarregue esta página.
      </div>
    );
  }

  if (!mps.length) {
    return <div className="banner info">Cadastre ao menos uma <b>matéria-prima</b> (aba Produtos) antes de lançar uma defumação.</div>;
  }

  const mpNova = mps.find(m => m.id === novoItem.materia_prima_id);
  const saldoMPNova = mpNova ? Number(estoqueMP.find(x => x.materia_prima_id === mpNova.id)?.saldo || 0) : null;
  const totalBrutoLista = itens.reduce((s, i) => s + Number(i.peso_bruto_kg || 0), 0);
  const totalFinalLista = itens.reduce((s, i) => s + Number(i.peso_final_kg || 0), 0);

  return (
    <>
      <div className="panel">
        <h3>Nova ficha de defumação</h3>
        <div className="form-grid">
          <div><label>Data da produção</label><input type="date" required value={cabecalho.data} onChange={e => setCabecalho({ ...cabecalho, data: e.target.value })} /></div>
          <div><label>Início da defumação</label><input type="time" value={cabecalho.hora_inicio} onChange={e => setCabecalho({ ...cabecalho, hora_inicio: e.target.value })} /></div>
          <div><label>Fim da defumação</label><input type="time" value={cabecalho.hora_fim} onChange={e => setCabecalho({ ...cabecalho, hora_fim: e.target.value })} /></div>
          <div><label>Temperatura (°C)</label><input type="number" step="0.5" value={cabecalho.temperatura_c} onChange={e => setCabecalho({ ...cabecalho, temperatura_c: e.target.value })} /></div>
          <div><label>Responsável pela defumação</label>
            <select value={cabecalho.responsavel_id} onChange={e => setCabecalho({ ...cabecalho, responsavel_id: e.target.value })}>
              <option value="">Selecione…</option>
              {funcionarios.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </div>
          <div><label>Observações</label><input placeholder="lenha, tempero, ocorrências…" value={cabecalho.obs} onChange={e => setCabecalho({ ...cabecalho, obs: e.target.value })} /></div>
        </div>

        <div style={{ marginTop: 14 }}>
          <label>Matérias-primas defumadas nesta ficha (sem limite de linhas)</label>
          <form className="form-grid" onSubmit={addItem}>
            <div><label>Matéria-prima</label>
              <select required value={novoItem.materia_prima_id} onChange={e => setNovoItem({ ...novoItem, materia_prima_id: e.target.value })}>
                <option value="">Selecione…</option>
                {mps.map(m => <option key={m.id} value={m.id}>{m.nome} ({m.unidade})</option>)}
              </select>
              {mpNova && saldoMPNova !== null && (
                <p className="muted" style={{ fontSize: 11.5, marginTop: 4, marginBottom: 0 }}>Saldo em estoque: {saldoMPNova.toFixed(2)} kg</p>
              )}
            </div>
            <div><label>Peso bruto (kg)</label><input type="number" step="0.001" required value={novoItem.peso_bruto_kg} onChange={e => setNovoItem({ ...novoItem, peso_bruto_kg: e.target.value })} /></div>
            <div><label>Perda na limpeza (kg)</label><input type="number" step="0.001" placeholder="0" value={novoItem.perda_limpeza_kg} onChange={e => setNovoItem({ ...novoItem, perda_limpeza_kg: e.target.value })} /></div>
            <div><label>Sobra aproveitável (kg)</label><input type="number" step="0.001" placeholder="0" value={novoItem.sobra_kg} onChange={e => setNovoItem({ ...novoItem, sobra_kg: e.target.value })} /></div>
            <div><label>Peso defumado (kg)</label>
              <input type="number" step="0.001" required value={novoItem.peso_final_kg} onChange={e => setNovoItem({ ...novoItem, peso_final_kg: e.target.value })} />
              {(() => {
                const rend = aproveitamento(novoItem);
                if (rend === null) return null;
                return (
                  <p style={{ fontSize: 11.5, marginTop: 4, marginBottom: 0 }}>
                    <span style={{ color: rend < 0.4 ? '#b91c1c' : '#15803d', fontWeight: 600 }}>
                      Aproveitamento: {(rend * 100).toFixed(1)}%{rend < 0.4 ? ' ⚠ abaixo de 40%' : ''}
                    </span>
                  </p>
                );
              })()}
            </div>
            <div><button className="btn secondary" type="submit">Adicionar matéria-prima</button></div>
          </form>

          <div className="items-list">
            {itens.length ? itens.map((it, idx) => {
              const mp = mps.find(m => m.id === it.materia_prima_id);
              const rend = aproveitamento(it);
              return (
                <div className="item-line" key={idx}>
                  <span>{mp?.nome || '—'}</span>
                  <span className="num">
                    {Number(it.peso_bruto_kg).toFixed(2)} kg → {Number(it.peso_final_kg).toFixed(2)} kg
                    {rend !== null && <span style={{ color: rend < 0.4 ? '#b91c1c' : '#15803d' }}> ({(rend * 100).toFixed(0)}%)</span>}
                    {Number(it.sobra_kg) > 0 && <span className="muted"> · sobra {Number(it.sobra_kg).toFixed(2)} kg</span>}
                    {Number(it.perda_limpeza_kg) > 0 && <span className="muted"> · perda {Number(it.perda_limpeza_kg).toFixed(2)} kg</span>}
                  </span>
                  <button className="btn danger small" onClick={() => setItens(itens.filter((_, i) => i !== idx))}>×</button>
                </div>
              );
            }) : <p className="muted" style={{ fontSize: 12 }}>Nenhuma matéria-prima adicionada — a ficha pode ter quantas precisar.</p>}
            {itens.length > 0 && (
              <div className="subtotal">
                {itens.length} item(ns) · bruto {totalBrutoLista.toFixed(2)} kg → defumado {totalFinalLista.toFixed(2)} kg
                {totalBrutoLista > 0 && ` (${((totalFinalLista / totalBrutoLista) * 100).toFixed(1)}%)`} · custo MP {fmtMoney(custoItens(itens))}
              </div>
            )}
          </div>
          <button className="btn" style={{ marginTop: 12 }} onClick={registrar} disabled={salvando}>
            {salvando ? 'Gerando lote…' : 'Registrar defumação'}
          </button>
          <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
            A ficha dá baixa na matéria-prima crua (peso bruto) e gera <b>estoque de proteína defumada</b>, que vira produto final na aba <b>Embalagem</b>. Aproveitamento abaixo de 40% dispara alerta.
          </p>
        </div>
      </div>

      <div className="panel">
        <h3>Fichas de defumação ({lista.length})</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Lote</th><th>Data</th><th>Horário</th><th>Temp.</th><th>Itens</th><th>Bruto</th><th>Defumado</th><th>Aproveit.</th><th>Sobras</th><th>Responsável</th><th></th></tr>
            </thead>
            <tbody>
              {lista.length ? lista.map(d => {
                const its = d.defumacao_itens || [];
                const bruto = its.reduce((s, i) => s + Number(i.peso_bruto_kg), 0);
                const fin = its.reduce((s, i) => s + Number(i.peso_final_kg), 0);
                const sobras = its.reduce((s, i) => s + Number(i.sobra_kg), 0);
                const rend = bruto ? fin / bruto : null;
                return (
                  <tr key={d.id}>
                    <td className="muted">{d.lote}</td>
                    <td>{fmtDate(d.data)}</td>
                    <td className="muted">{d.hora_inicio ? String(d.hora_inicio).slice(0, 5) : '—'}–{d.hora_fim ? String(d.hora_fim).slice(0, 5) : '—'}</td>
                    <td className="num">{d.temperatura_c ? `${Number(d.temperatura_c)}°C` : '—'}</td>
                    <td className="num">{its.length}</td>
                    <td className="num">{bruto.toFixed(2)} kg</td>
                    <td className="num">{fin.toFixed(2)} kg</td>
                    <td className="num">{rend !== null ? (
                      rend < 0.4
                        ? <span style={{ color: '#b91c1c', fontWeight: 600 }}>⚠ {(rend * 100).toFixed(1)}%</span>
                        : <span style={{ color: '#15803d' }}>{(rend * 100).toFixed(1)}%</span>
                    ) : '—'}</td>
                    <td className="num">{sobras > 0 ? `${sobras.toFixed(2)} kg` : '—'}</td>
                    <td className="muted">{d.funcionarios?.nome || '—'}</td>
                    <td>
                      <div className="row-actions">
                        <button className="btn secondary small" onClick={() => imprimir(d)}>Imprimir ficha</button>
                        <button className="btn danger" onClick={() => excluir(d.id)}>Excluir</button>
                      </div>
                    </td>
                  </tr>
                );
              }) : <tr className="empty-row"><td colSpan={11}>Nenhuma ficha de defumação lançada.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
