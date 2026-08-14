'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../lib/auth';
import {
  STATUS_LABELS, MOTIVOS_DESCARTE, condicaoValidade, conservacaoLabel,
  fmtDateTime, temPermissao,
} from '../../../lib/producao';
import AppShell from '../../../components/AppShell';
import ProducaoTabs from '../../../components/ProducaoTabs';
import EtiquetaPrint from '../../../components/EtiquetaPrint';
import ModalEtiquetas from '../../../components/ModalEtiquetas';
import { useEmpresaAtual } from '../../../lib/empresa';

export default function ProducoesInternasPage() {
  const [etiqueta, setEtiqueta] = useState(null);
  return (
    <>
      <AppShell modulo="producoes" titulo="Produções Internas" desc="Produções sintéticas das cozinhas: rascunhos, finalizadas e etiquetas">
        <ProducaoTabs />
        <Conteudo setEtiqueta={setEtiqueta} />
      </AppShell>
      <EtiquetaPrint etiqueta={etiqueta} />
    </>
  );
}

const FILTROS = [
  { id: 'andamento', label: 'Em andamento' },
  { id: 'finalizadas', label: 'Finalizadas' },
  { id: 'todas', label: 'Todas' },
];

function Conteudo({ setEtiqueta }) {
  const { empresaAtual } = useEmpresaAtual();
  const { session, permissoes, isAdmin } = useAuth();
  const [lista, setLista] = useState([]);
  const [impressoes, setImpressoes] = useState([]);
  const [descartes, setDescartes] = useState([]);
  const [filtro, setFiltro] = useState('andamento');
  const [detalheId, setDetalheId] = useState(null);
  const [modalImpressao, setModalImpressao] = useState(null); // { producao, tipo }
  const [modalDescarte, setModalDescarte] = useState(null);   // producao
  const [carregando, setCarregando] = useState(true);

  const podeDescartar = temPermissao(permissoes, isAdmin, 'producoes.descarte');
  const nomeUsuario = session?.user?.user_metadata?.nome || session?.user?.email || '';

  async function carregar() {
    if (!empresaAtual) return;
    setCarregando(true);
    const eid = empresaAtual.id;
    const [r1, r2, r3] = await Promise.all([
      supabase.from('producoes_internas')
        .select('*, produtos(nome, codigo, modelo_etiqueta), unidades(nome), funcionarios:responsavel_funcionario_id(nome)')
        .eq('empresa_id', eid).order('created_at', { ascending: false }).limit(300),
      supabase.from('etiqueta_impressoes').select('*').eq('empresa_id', eid).eq('source_type', 'producao_interna').order('created_at', { ascending: false }),
      supabase.from('producao_descartes').select('*').eq('empresa_id', eid).order('created_at', { ascending: false }),
    ]);
    setLista(r1.data || []);
    setImpressoes(r2.data || []);
    setDescartes(r3.data || []);
    setCarregando(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  const filtradas = lista.filter(p => {
    if (filtro === 'andamento') return ['rascunho', 'em_producao'].includes(p.status);
    if (filtro === 'finalizadas') return p.status === 'finalizada';
    return true;
  });

  function nomeResponsavel(p) {
    return p.funcionarios?.nome || (p.responsavel_user_id === session?.user?.id ? nomeUsuario : '—');
  }

  function dadosModal(p) {
    return {
      ...p,
      produtoNome: p.produtos?.nome,
      produtoCodigo: p.produtos?.codigo,
      unidadeNome: p.unidades?.nome,
      modelo: p.produtos?.modelo_etiqueta || 'validade-cozinha',
    };
  }

  async function finalizarRascunho(p) {
    const { error } = await supabase.rpc('finalizar_producao_interna', { p_id: p.id });
    if (error) { alert('Não foi possível finalizar: ' + error.message); return; }
    await carregar();
    const { data } = await supabase.from('producoes_internas').select('*, produtos(nome, codigo, modelo_etiqueta), unidades(nome), funcionarios:responsavel_funcionario_id(nome)').eq('id', p.id).single();
    if (data) setModalImpressao({ producao: dadosModal(data), tipo: temImpressao(p.id) ? 'reimpressao' : 'original' });
  }

  function temImpressao(producaoId) {
    return impressoes.some(i => i.source_id === producaoId);
  }

  async function duplicar(p) {
    // Copia produto/unidade/conservação/medida/qtd/recipientes.
    // NÃO copia: código, datas, validade, responsável, impressões, status.
    const { data: nova, error } = await supabase.from('producoes_internas').insert([{
      empresa_id: p.empresa_id,
      unidade_id: p.unidade_id,
      produto_id: p.produto_id,
      produzido_em: new Date().toISOString(),
      conservacao: p.conservacao,
      quantidade: p.quantidade,
      unidade_medida: p.unidade_medida,
      recipientes: p.recipientes,
      responsavel_user_id: session?.user?.id || null,
      responsavel_funcionario_id: null,
      status: 'rascunho',
    }]).select().single();
    if (error) { alert('Erro ao duplicar: ' + error.message); return; }
    if (confirm(`Rascunho ${nova.codigo} criado a partir de ${p.codigo}. Finalizar agora (validade será recalculada)?`)) {
      const { error: e2 } = await supabase.rpc('finalizar_producao_interna', { p_id: nova.id });
      if (e2) alert('Rascunho criado, mas não foi possível finalizar: ' + e2.message);
    }
    carregar();
  }

  async function cancelar(p) {
    const motivo = prompt(`Cancelar a produção ${p.codigo}? Informe o motivo:`);
    if (motivo == null) return;
    const { error } = await supabase.rpc('cancelar_producao_interna', { p_id: p.id, p_motivo: motivo });
    if (error) { alert('Não foi possível cancelar: ' + error.message); return; }
    carregar();
  }

  async function excluirRascunho(p) {
    if (!confirm(`Excluir o rascunho ${p.codigo}?`)) return;
    const { error } = await supabase.from('producoes_internas').delete().eq('id', p.id);
    if (error) alert('Não foi possível excluir: ' + error.message);
    carregar();
  }

  if (carregando) return <p className="muted">Carregando…</p>;

  return (
    <>
      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {FILTROS.map(f => (
              <button key={f.id} className={'btn small' + (filtro === f.id ? '' : ' secondary')} onClick={() => setFiltro(f.id)}>{f.label}</button>
            ))}
          </div>
          <Link href="/producoes/nova" className="btn">+ Nova produção interna</Link>
        </div>

        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table>
            <thead>
              <tr><th>Código</th><th>Produto</th><th>Unidade</th><th>Produção</th><th>Validade</th><th>Condição</th><th>Conservação</th><th>Qtd</th><th>Responsável</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {filtradas.length ? filtradas.map(p => {
                const cond = p.status === 'finalizada' ? condicaoValidade(p.validade) : null;
                const aberto = detalheId === p.id;
                return [
                  <tr key={p.id}>
                    <td className="muted">{p.codigo}</td>
                    <td>{p.produtos?.nome || '—'}</td>
                    <td className="muted">{p.unidades?.nome || '—'}</td>
                    <td>{fmtDateTime(p.produzido_em)}</td>
                    <td>{fmtDateTime(p.validade)}</td>
                    <td>{cond ? <span style={{ color: cond.cor, fontWeight: 600, fontSize: 11.5 }}>{cond.label}</span> : '—'}</td>
                    <td>{conservacaoLabel(p.conservacao)}</td>
                    <td className="num">{p.quantidade != null ? `${Number(p.quantidade)} ${p.unidade_medida || ''}` : '—'}</td>
                    <td className="muted">{nomeResponsavel(p)}</td>
                    <td className="muted">{STATUS_LABELS[p.status] || p.status}</td>
                    <td>
                      <div className="row-actions">
                        <button className="btn secondary small" onClick={() => setDetalheId(aberto ? null : p.id)}>{aberto ? 'Fechar' : 'Detalhe'}</button>
                        {['rascunho', 'em_producao'].includes(p.status) && (
                          <>
                            <button className="btn small" onClick={() => finalizarRascunho(p)}>Finalizar</button>
                            <button className="btn danger" onClick={() => excluirRascunho(p)}>Excluir</button>
                          </>
                        )}
                        {p.status === 'finalizada' && (
                          <>
                            <button className="btn secondary small" onClick={() => setModalImpressao({ producao: dadosModal(p), tipo: temImpressao(p.id) ? 'reimpressao' : 'original' })}>
                              {temImpressao(p.id) ? 'Reimprimir' : 'Imprimir etiquetas'}
                            </button>
                            {podeDescartar && <button className="btn danger" onClick={() => setModalDescarte(p)}>Descarte</button>}
                          </>
                        )}
                        {['rascunho', 'em_producao', 'finalizada'].includes(p.status) && (
                          <button className="btn danger" onClick={() => cancelar(p)}>Cancelar</button>
                        )}
                        {p.status !== 'cancelada' && <button className="btn secondary small" onClick={() => duplicar(p)}>Duplicar</button>}
                      </div>
                    </td>
                  </tr>,
                  aberto && (
                    <tr key={p.id + '-det'}>
                      <td colSpan={11}>
                        <Detalhe p={p} impressoes={impressoes.filter(i => i.source_id === p.id)} descartes={descartes.filter(d => d.producao_interna_id === p.id)} responsavel={nomeResponsavel(p)} />
                      </td>
                    </tr>
                  ),
                ];
              }) : <tr className="empty-row"><td colSpan={11}>Nenhuma produção interna {filtro === 'andamento' ? 'em andamento' : filtro === 'finalizadas' ? 'finalizada' : ''}.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {modalImpressao && (
        <ModalEtiquetas
          producao={modalImpressao.producao}
          empresaNome={empresaAtual?.nome}
          responsavelNome={nomeResponsavel(modalImpressao.producao)}
          tipo={modalImpressao.tipo}
          onFechar={() => { setModalImpressao(null); carregar(); }}
          setEtiqueta={setEtiqueta}
        />
      )}

      {modalDescarte && (
        <ModalDescarte p={modalDescarte} onFechar={ok => { setModalDescarte(null); if (ok) carregar(); }} />
      )}
    </>
  );
}

function Detalhe({ p, impressoes, descartes, responsavel }) {
  const cond = p.status === 'finalizada' ? condicaoValidade(p.validade) : null;
  return (
    <div style={{ padding: '10px 4px', fontSize: 12.5 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
        <div><span className="muted">Identificação</span><br /><b>{p.codigo}</b></div>
        <div><span className="muted">Produto</span><br />{p.produtos?.codigo ? `${p.produtos.codigo} — ` : ''}{p.produtos?.nome}</div>
        <div><span className="muted">Origem</span><br />{p.unidades?.nome || '—'}</div>
        <div><span className="muted">Produção</span><br />{fmtDateTime(p.produzido_em)}</div>
        <div><span className="muted">Conservação</span><br />{conservacaoLabel(p.conservacao)}</div>
        <div><span className="muted">Validade</span><br />{fmtDateTime(p.validade)} {cond && <span style={{ color: cond.cor, fontWeight: 600 }}>({cond.label})</span>}</div>
        <div><span className="muted">Quantidade</span><br />{p.quantidade != null ? `${Number(p.quantidade)} ${p.unidade_medida || ''}` : '—'}</div>
        <div><span className="muted">Recipientes</span><br />{p.recipientes ?? '—'}</div>
        <div><span className="muted">Responsável</span><br />{responsavel}</div>
      </div>
      {p.validade_manual && (
        <div className="banner info" style={{ marginTop: 10 }}>
          Validade alterada manualmente. Calculada: {fmtDateTime(p.validade_calculada)} · Informada: {fmtDateTime(p.validade)} · Motivo: {p.validade_motivo}
        </div>
      )}
      {p.observacoes && <p style={{ marginTop: 8 }}><span className="muted">Observações:</span> {p.observacoes}</p>}

      <h4 style={{ margin: '12px 0 6px' }}>Impressões ({impressoes.length})</h4>
      {impressoes.length ? (
        <table>
          <thead><tr><th>Data</th><th>Usuário</th><th>Qtd</th><th>Impressora</th><th>Tipo</th><th>Motivo</th></tr></thead>
          <tbody>
            {impressoes.map(i => (
              <tr key={i.id}>
                <td>{fmtDateTime(i.created_at)}</td>
                <td>{i.usuario_nome || '—'}</td>
                <td className="num">{i.quantidade}</td>
                <td>{i.impressora || '—'}</td>
                <td>{i.tipo === 'reimpressao' ? 'Reimpressão' : 'Original'}</td>
                <td className="muted">{i.motivo || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="muted">Nenhuma etiqueta impressa ainda.</p>}

      {descartes.length > 0 && (
        <>
          <h4 style={{ margin: '12px 0 6px' }}>Descartes</h4>
          <table>
            <thead><tr><th>Data</th><th>Usuário</th><th>Qtd</th><th>Motivo</th><th>Observação</th></tr></thead>
            <tbody>
              {descartes.map(d => (
                <tr key={d.id}>
                  <td>{fmtDateTime(d.created_at)}</td>
                  <td>{d.usuario_nome || '—'}</td>
                  <td className="num">{d.quantidade != null ? `${Number(d.quantidade)} ${d.unidade_medida || ''}` : '—'}</td>
                  <td>{d.motivo}</td>
                  <td className="muted">{d.observacao || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function ModalDescarte({ p, onFechar }) {
  const [form, setForm] = useState({ quantidade: p.quantidade || '', unidade: p.unidade_medida || '', motivo: MOTIVOS_DESCARTE[0], outro: '', observacao: '' });
  const [salvando, setSalvando] = useState(false);

  async function registrar(e) {
    e.preventDefault();
    const motivo = form.motivo === 'Outro' ? form.outro.trim() : form.motivo;
    if (!motivo) { alert('Descreva o motivo do descarte.'); return; }
    setSalvando(true);
    const { error } = await supabase.rpc('registrar_descarte_interno', {
      p_id: p.id,
      p_quantidade: form.quantidade ? Number(String(form.quantidade).replace(',', '.')) : null,
      p_unidade: form.unidade || null,
      p_motivo: motivo,
      p_observacao: form.observacao || null,
    });
    setSalvando(false);
    if (error) { alert('Não foi possível registrar o descarte: ' + error.message); return; }
    onFechar(true);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}>
      <form className="panel" style={{ maxWidth: 460, width: '100%', margin: 0 }} onSubmit={registrar}>
        <h3>Registrar descarte — {p.codigo}</h3>
        <p className="muted" style={{ fontSize: 12 }}>{p.produtos?.nome} · validade {fmtDateTime(p.validade)}</p>
        <div className="form-grid">
          <div><label>Quantidade descartada</label>
            <input type="number" step="0.001" min="0" value={form.quantidade} onChange={e => setForm({ ...form, quantidade: e.target.value })} />
          </div>
          <div><label>Unidade de medida</label>
            <select value={form.unidade} onChange={e => setForm({ ...form, unidade: e.target.value })}>
              <option value="">—</option>
              <option value="kg">kg</option><option value="g">g</option><option value="L">L</option>
              <option value="ml">ml</option><option value="un">unidade</option><option value="pct">pacote</option>
            </select>
          </div>
          <div><label>Motivo</label>
            <select value={form.motivo} onChange={e => setForm({ ...form, motivo: e.target.value })}>
              {MOTIVOS_DESCARTE.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          {form.motivo === 'Outro' && (
            <div><label>Descreva o motivo</label>
              <input required value={form.outro} onChange={e => setForm({ ...form, outro: e.target.value })} />
            </div>
          )}
        </div>
        <div style={{ marginTop: 10 }}>
          <label>Observação</label>
          <textarea rows={2} value={form.observacao} onChange={e => setForm({ ...form, observacao: e.target.value })} style={{ width: '100%' }} />
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button className="btn" type="submit" disabled={salvando}>{salvando ? 'Registrando…' : 'Registrar descarte'}</button>
          <button className="btn secondary" type="button" onClick={() => onFechar(false)}>Voltar</button>
        </div>
      </form>
    </div>
  );
}
