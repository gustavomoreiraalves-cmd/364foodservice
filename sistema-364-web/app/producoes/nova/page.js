'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../lib/auth';
import {
  CONSERVACOES, calcularValidadePreview, fmtDateTime, temPermissao,
  isoParaInputLocal, inputLocalParaIso,
} from '../../../lib/producao';
import AppShell from '../../../components/AppShell';
import ProducaoTabs from '../../../components/ProducaoTabs';
import EtiquetaPrint from '../../../components/EtiquetaPrint';
import ModalEtiquetas from '../../../components/ModalEtiquetas';
import { useEmpresaAtual } from '../../../lib/empresa';

export default function NovaProducaoPage() {
  const [etiqueta, setEtiqueta] = useState(null);
  return (
    <>
      <AppShell modulo="producoes" titulo="Nova Produção" desc="Escolha o tipo de produção">
        <ProducaoTabs />
        <Conteudo setEtiqueta={setEtiqueta} />
      </AppShell>
      <EtiquetaPrint etiqueta={etiqueta} />
    </>
  );
}

const FORM_VAZIO = () => ({
  produto_id: '', conservacao: '', produzido_em: isoParaInputLocal(),
  quantidade: '', unidade_medida: '', recipientes: '',
  responsavel_funcionario_id: '', observacoes: '',
  usarValidadeManual: false, validade_manual: '', motivo_validade: '',
});

function Conteudo({ setEtiqueta }) {
  const { empresaAtual } = useEmpresaAtual();
  const { session, permissoes, isAdmin } = useAuth();
  const [produtos, setProdutos] = useState([]);
  const [unidades, setUnidades] = useState([]);
  const [regras, setRegras] = useState([]);
  const [funcionarios, setFuncionarios] = useState([]);
  const [form, setForm] = useState(FORM_VAZIO());
  const [unidadeId, setUnidadeId] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [finalizada, setFinalizada] = useState(null); // produção retornada pela RPC → abre modal de etiquetas

  const podeOutroResponsavel = temPermissao(permissoes, isAdmin, 'producoes.responsavel_outro');
  const podeOverrideValidade = temPermissao(permissoes, isAdmin, 'producoes.validade_override');
  const nomeUsuario = session?.user?.user_metadata?.nome || session?.user?.email || '';

  useEffect(() => {
    let ativo = true;
    async function carregar() {
      if (!empresaAtual) return;
      const eid = empresaAtual.id;
      const [r1, r2, r3, r4] = await Promise.all([
        // `producao_interna` é filtro de domínio e continua na consulta. `ativo`
        // não: o filtro de situação fica onde as <option> são montadas, com a
        // escotilha que preserva o valor já escolhido, para não esconder o produto
        // de onde ele ainda precisa aparecer.
        //
        // select('*') em vez de lista de colunas: se `ativo` ainda não existir
        // (migração 26 pendente), uma projeção que citasse a coluna pelo nome
        // devolveria erro 42703 do PostgREST e vazaria a tela inteira. Com '*' a
        // coluna some do objeto quando não existe, `ativo` vira undefined e
        // `ativo !== false` continua mostrando o registro. Voltar para
        // `select('id, nome, unidade, …')` parece higiene, mas desliga o recurso em
        // silêncio ou quebra a tela — o custo aceito é trazer colunas não usadas.
        supabase.from('produtos').select('*').eq('empresa_id', eid).eq('producao_interna', true).order('nome'),
        supabase.from('unidades').select('id, nome').eq('empresa_id', eid).eq('ativo', true).order('nome'),
        supabase.from('produto_regras_validade').select('*').eq('empresa_id', eid).eq('ativo', true),
        supabase.from('funcionarios').select('id, nome, user_id').eq('empresa_id', eid).eq('ativo', true).order('nome'),
      ]);
      if (!ativo) return;
      setProdutos(r1.data || []);
      setUnidades(r2.data || []);
      setRegras(r3.data || []);
      setFuncionarios(r4.data || []);
      if ((r2.data || []).length === 1) setUnidadeId(r2.data[0].id);
    }
    carregar();
    return () => { ativo = false; };
  }, [empresaAtual?.id]);

  const produto = produtos.find(p => p.id === form.produto_id);
  // A tarja de ajuda e o <select> têm que ler a MESMA lista. Decidir a tarja por
  // `produtos` (sem filtro) e montar as opções pela lista filtrada deixava a tela
  // sem tarja nenhuma e com um campo obrigatório sem uma única opção quando todos
  // os produtos de produção interna estavam desativados: beco sem saída.
  const produtosSelecionaveis = produtos.filter(p => p.ativo !== false || p.id === form.produto_id);
  const regrasProduto = useMemo(
    () => Object.fromEntries(regras.filter(r => r.produto_id === form.produto_id).map(r => [r.conservacao, r])),
    [regras, form.produto_id]
  );
  const regraSelecionada = regrasProduto[form.conservacao];
  const validadePrevista = regraSelecionada
    ? calcularValidadePreview(inputLocalParaIso(form.produzido_em), regraSelecionada)
    : null;
  const meuFuncionario = funcionarios.find(f => f.user_id === session?.user?.id);

  function selecionarProduto(id) {
    const p = produtos.find(x => x.id === id);
    setForm({ ...form, produto_id: id, conservacao: '', unidade_medida: p?.unidade || '' });
  }

  async function salvar(finalizar) {
    if (!form.produto_id) { alert('Selecione o produto.'); return; }
    if (!form.conservacao) { alert('Selecione o tipo de conservação.'); return; }
    const regra = regrasProduto[form.conservacao];
    if (!regra || !regra.permitido) {
      alert(`O produto ${produto?.nome} não possui conservação em ${CONSERVACOES.find(c => c.id === form.conservacao)?.label?.toLowerCase()} autorizada.`);
      return;
    }
    if (form.usarValidadeManual && !form.motivo_validade.trim()) {
      alert('Informe o motivo da alteração manual da validade.');
      return;
    }
    setSalvando(true);
    const { data: nova, error } = await supabase.from('producoes_internas').insert([{
      empresa_id: empresaAtual.id,
      unidade_id: unidadeId || null,
      produto_id: form.produto_id,
      produzido_em: inputLocalParaIso(form.produzido_em),
      conservacao: form.conservacao,
      quantidade: form.quantidade ? Number(String(form.quantidade).replace(',', '.')) : null,
      unidade_medida: form.unidade_medida || null,
      recipientes: form.recipientes ? Number(form.recipientes) : null,
      responsavel_user_id: session?.user?.id || null,
      responsavel_funcionario_id: form.responsavel_funcionario_id || meuFuncionario?.id || null,
      observacoes: form.observacoes || null,
      status: 'rascunho',
    }]).select().single();

    if (error) { setSalvando(false); alert('Erro ao salvar: ' + error.message); return; }

    if (!finalizar) {
      setSalvando(false);
      setForm(FORM_VAZIO());
      alert(`Rascunho ${nova.codigo} salvo. Finalize em Produções Internas.`);
      return;
    }

    const { data: fin, error: e2 } = await supabase.rpc('finalizar_producao_interna', {
      p_id: nova.id,
      p_validade_manual: form.usarValidadeManual && form.validade_manual ? inputLocalParaIso(form.validade_manual) : null,
      p_motivo_validade: form.usarValidadeManual ? form.motivo_validade : null,
    });
    setSalvando(false);
    if (e2) { alert('Produção salva como rascunho, mas não foi possível finalizar: ' + e2.message); return; }
    const prod = Array.isArray(fin) ? fin[0] : fin;
    setFinalizada({ ...prod, produtoNome: produto?.nome, produtoCodigo: produto?.codigo, unidadeNome: unidades.find(u => u.id === unidadeId)?.nome, modelo: produto?.modelo_etiqueta || 'validade-cozinha' });
    setForm(FORM_VAZIO());
  }

  const btnGrande = { padding: '14px 18px', fontSize: 14 };

  return (
    <>
      <div className="panel">
        <h3>Tipo de produção</h3>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link href="/producoes/completa" className="btn secondary" style={btnGrande}>
            Defumação — matéria-prima, lotes e rastreabilidade
          </Link>
          <span className="btn" style={{ ...btnGrande, cursor: 'default' }}>
            Produção Interna — preparos de cozinha e etiquetas
          </span>
        </div>
      </div>

      <div className="panel">
        <h3>Nova Produção Interna</h3>
        {!produtosSelecionaveis.length ? (
          <div className="banner info">
            Nenhum produto <b>ativo</b> marcado como <b>produção interna</b> nesta empresa — ou não há nenhum cadastrado, ou todos foram desativados. Marque (ou reative) produtos na aba <Link href="/produtos">Produtos</Link> e defina as regras de conservação.
          </div>
        ) : (
          <form onSubmit={e => { e.preventDefault(); salvar(true); }}>
            <div className="form-grid">
              <div><label>Produto</label>
                <select required value={form.produto_id} onChange={e => selecionarProduto(e.target.value)} style={{ minHeight: 44 }}>
                  <option value="">Selecione…</option>
                  {produtosSelecionaveis.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
              </div>
              {unidades.length > 0 && (
                <div><label>Unidade</label>
                  <select value={unidadeId} onChange={e => setUnidadeId(e.target.value)} style={{ minHeight: 44 }}>
                    <option value="">—</option>
                    {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
                  </select>
                </div>
              )}
              <div><label>Data e hora da produção</label>
                <input type="datetime-local" required value={form.produzido_em} onChange={e => setForm({ ...form, produzido_em: e.target.value })} style={{ minHeight: 44 }} />
              </div>
            </div>

            {form.produto_id && (
              <div style={{ marginTop: 14 }}>
                <label>Tipo de conservação</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                  {CONSERVACOES.map(c => {
                    const regra = regrasProduto[c.id];
                    const permitida = !!regra?.permitido;
                    const ativa = form.conservacao === c.id;
                    return (
                      <button key={c.id} type="button"
                        className={'btn' + (ativa ? '' : ' secondary')}
                        style={{ ...btnGrande, opacity: permitida ? 1 : 0.4 }}
                        onClick={() => {
                          if (!permitida) {
                            alert(`O produto ${produto?.nome} não possui conservação em ${c.label.toLowerCase()} autorizada.`);
                            return;
                          }
                          setForm({ ...form, conservacao: c.id });
                        }}>
                        {c.label}
                        {permitida && <span style={{ display: 'block', fontSize: 10.5, opacity: .8 }}>{regra.validade_valor} {regra.validade_unidade}</span>}
                        {!permitida && <span style={{ display: 'block', fontSize: 10.5, opacity: .8 }}>não permitido</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {validadePrevista && (
              <div className="banner info" style={{ marginTop: 14 }}>
                Validade calculada: <b>{fmtDateTime(validadePrevista)}</b>
                {' '}· Produção: {fmtDateTime(inputLocalParaIso(form.produzido_em))} · Responsável: <b>{
                  form.responsavel_funcionario_id
                    ? funcionarios.find(f => f.id === form.responsavel_funcionario_id)?.nome
                    : nomeUsuario
                }</b>
              </div>
            )}

            <div className="form-grid" style={{ marginTop: 14 }}>
              <div><label>Quantidade produzida</label>
                <input type="number" step="0.001" min="0" placeholder="Ex.: 5,5" value={form.quantidade} onChange={e => setForm({ ...form, quantidade: e.target.value })} style={{ minHeight: 44 }} />
              </div>
              <div><label>Unidade de medida</label>
                <select value={form.unidade_medida} onChange={e => setForm({ ...form, unidade_medida: e.target.value })} style={{ minHeight: 44 }}>
                  <option value="">—</option>
                  <option value="kg">kg</option><option value="g">g</option><option value="L">L</option>
                  <option value="ml">ml</option><option value="un">unidade</option><option value="pct">pacote</option>
                </select>
              </div>
              <div><label>Quantidade de recipientes</label>
                <input type="number" min="1" step="1" placeholder="Ex.: 5" value={form.recipientes} onChange={e => setForm({ ...form, recipientes: e.target.value })} style={{ minHeight: 44 }} />
              </div>
              {podeOutroResponsavel && (
                <div><label>Responsável pela produção</label>
                  <select value={form.responsavel_funcionario_id} onChange={e => setForm({ ...form, responsavel_funcionario_id: e.target.value })} style={{ minHeight: 44 }}>
                    <option value="">{nomeUsuario} (eu)</option>
                    {funcionarios.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
                  </select>
                </div>
              )}
            </div>

            <div style={{ marginTop: 14 }}>
              <label>Observações</label>
              <textarea rows={2} placeholder="Opcional — ex.: produção destinada ao atendimento de sexta-feira" value={form.observacoes} onChange={e => setForm({ ...form, observacoes: e.target.value })} style={{ width: '100%' }} />
            </div>

            {podeOverrideValidade && validadePrevista && (
              <div style={{ marginTop: 14 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.usarValidadeManual} onChange={e => setForm({ ...form, usarValidadeManual: e.target.checked })} />
                  Alterar validade manualmente (fica auditado)
                </label>
                {form.usarValidadeManual && (
                  <div className="form-grid" style={{ marginTop: 8 }}>
                    <div><label>Validade informada</label>
                      <input type="datetime-local" value={form.validade_manual} onChange={e => setForm({ ...form, validade_manual: e.target.value })} />
                    </div>
                    <div><label>Motivo (obrigatório)</label>
                      <input required={form.usarValidadeManual} value={form.motivo_validade} onChange={e => setForm({ ...form, motivo_validade: e.target.value })} placeholder="Ex.: alteração determinada pelo responsável técnico" />
                    </div>
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
              <button className="btn" type="submit" disabled={salvando} style={btnGrande}>
                {salvando ? 'Salvando…' : `Finalizar${form.recipientes ? ` e imprimir ${form.recipientes} etiqueta${Number(form.recipientes) > 1 ? 's' : ''}` : ''}`}
              </button>
              <button className="btn secondary" type="button" disabled={salvando} style={btnGrande} onClick={() => salvar(false)}>
                Salvar rascunho
              </button>
            </div>
          </form>
        )}
      </div>

      {finalizada && (
        <ModalEtiquetas
          producao={finalizada}
          empresaNome={empresaAtual?.nome}
          responsavelNome={
            funcionarios.find(f => f.id === finalizada.responsavel_funcionario_id)?.nome || nomeUsuario
          }
          onFechar={() => setFinalizada(null)}
          setEtiqueta={setEtiqueta}
        />
      )}
    </>
  );
}
