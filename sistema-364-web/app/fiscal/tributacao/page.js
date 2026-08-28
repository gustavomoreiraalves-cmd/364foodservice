'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import AppShell from '../../../components/AppShell';
import { useEmpresaAtual } from '../../../lib/empresa';
import RegraTributariaForm from '../../../components/RegraTributariaForm';
import {
  validarRegraTributaria, resumoRegra, descreverDestinatario, descreverAlvo,
  ST_RESPONSAVEL,
} from '../../../lib/fiscalRegras';

// Grupos e regras tributárias: o lugar onde CFOP, CSOSN e MVA são decididos.
// O produto guarda só o que é da mercadoria (NCM, CEST, origem); a tributação
// depende também da operação e do destinatário, e é resolvida aqui.

const REGRA_VAZIA = {
  natureza_operacao_id: '', uf_destino: '*',
  destinatario_contribuinte: null, destinatario_consumidor_final: null,
  cfop: '', csosn: '', st_responsavel: ST_RESPONSAVEL.NAO_APLICAVEL,
  mod_bc: null, reducao_base_percentual: '', mod_bc_st: null,
  reducao_base_st_percentual: '', mva_percentual: '', aliquota_interna_destino: '',
  aliquota_st_retido: '', cst_pis: '', cst_cofins: '',
  aliquota_pis: '', aliquota_cofins: '',
  permite_credito_simples: false, base_legal: '', observacao_fiscal: '',
  vigencia_inicio: '', vigencia_fim: null,
};

export default function TributacaoPage() {
  return (
    <AppShell modulo="fiscal" titulo="Tributação" desc="Grupos e regras que definem CFOP, CSOSN e ST de cada operação">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const { empresaAtual } = useEmpresaAtual();
  const [loading, setLoading] = useState(true);
  const [indisponivel, setIndisponivel] = useState(false);
  const [grupos, setGrupos] = useState([]);
  const [regras, setRegras] = useState([]);
  const [naturezas, setNaturezas] = useState([]);
  const [cfops, setCfops] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [grupoAberto, setGrupoAberto] = useState(null);
  const [formGrupo, setFormGrupo] = useState({ codigo: '', descricao: '' });
  const [formRegra, setFormRegra] = useState(null);
  const [editandoRegra, setEditandoRegra] = useState(null);
  const [salvando, setSalvando] = useState(false);

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    const [g, r, n, c, p] = await Promise.all([
      supabase.from('grupos_tributarios').select('*').eq('empresa_id', empresaAtual.id).order('codigo'),
      supabase.from('regras_tributarias').select('*').eq('empresa_id', empresaAtual.id).order('created_at'),
      supabase.from('naturezas_operacao').select('*').eq('empresa_id', empresaAtual.id).eq('ativo', true).order('descricao'),
      supabase.from('tabela_cfop').select('cfop, descricao').order('cfop'),
      supabase.from('produtos').select('id, codigo, nome, ncm, grupo_tributario_id').eq('empresa_id', empresaAtual.id).order('codigo'),
    ]);
    // Sem a atualização 36 no banco, a tela inteira não tem o que mostrar —
    // melhor dizer isso do que exibir listas vazias como se fosse normal.
    if (g.error || r.error || n.error) { setIndisponivel(true); setLoading(false); return; }
    setIndisponivel(false);
    setGrupos(g.data || []);
    setRegras(r.data || []);
    setNaturezas(n.data || []);
    setCfops(c.data || []);
    setProdutos(p.data || []);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  async function salvarGrupo(e) {
    e.preventDefault();
    if (!formGrupo.codigo.trim() || !formGrupo.descricao.trim()) return;
    const { error } = await supabase.from('grupos_tributarios').insert([{
      empresa_id: empresaAtual.id,
      codigo: formGrupo.codigo.trim().toUpperCase().replace(/\s+/g, '_'),
      descricao: formGrupo.descricao.trim(),
    }]);
    if (error) { alert('Não foi possível criar o grupo: ' + error.message); return; }
    setFormGrupo({ codigo: '', descricao: '' });
    carregar();
  }

  async function alternarGrupo(g) {
    const { error } = await supabase.from('grupos_tributarios').update({ ativo: !g.ativo }).eq('id', g.id);
    if (error) { alert('Não foi possível alterar: ' + error.message); return; }
    carregar();
  }

  function novaRegra(grupoId) {
    setFormRegra({ ...REGRA_VAZIA, grupo_tributario_id: grupoId, vigencia_inicio: hoje() });
    setEditandoRegra(null);
    setGrupoAberto(grupoId);
  }

  function editarRegra(regra) {
    setFormRegra({
      ...REGRA_VAZIA,
      ...regra,
      vigencia_inicio: regra.vigencia_inicio || '',
      vigencia_fim: regra.vigencia_fim || null,
    });
    setEditandoRegra(regra.id);
    setGrupoAberto(regra.grupo_tributario_id);
  }

  async function salvarRegra() {
    const natureza = naturezas.find(n => n.id === formRegra.natureza_operacao_id);
    if (validarRegraTributaria({ ...formRegra, tipo_operacao: natureza?.tipo_operacao }).length) return;
    setSalvando(true);
    try {
      const campos = camposRegra(formRegra, empresaAtual.id);
      const { error } = editandoRegra
        ? await supabase.from('regras_tributarias').update(campos).eq('id', editandoRegra)
        : await supabase.from('regras_tributarias').insert([campos]);
      if (error) { alert('Não foi possível salvar a regra: ' + error.message); return; }
      setFormRegra(null);
      setEditandoRegra(null);
      await carregar();
    } finally {
      setSalvando(false);
    }
  }

  async function excluirRegra(id) {
    if (!confirm('Excluir esta regra? As notas já emitidas não mudam.')) return;
    const { error } = await supabase.from('regras_tributarias').delete().eq('id', id);
    if (error) { alert('Não foi possível excluir: ' + error.message); return; }
    carregar();
  }

  if (loading) return <p className="muted">Carregando…</p>;
  if (indisponivel) {
    return (
      <div className="panel">
        <p className="muted">
          Esta tela precisa da atualização 36 aplicada no banco desta empresa. Enquanto ela não roda,
          não há grupos nem regras tributárias para exibir.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="panel">
        <h3>Novo grupo tributário</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Um grupo reúne produtos que se comportam igual — todo defumado bovino em ST, por exemplo. As regras
          são escritas uma vez no grupo e valem para todos os produtos dele.
        </p>
        <form className="form-grid" onSubmit={salvarGrupo}>
          <div>
            <label>Código</label>
            <input required placeholder="DEFUMADO_BOVINO_ST" value={formGrupo.codigo}
                   onChange={e => setFormGrupo({ ...formGrupo, codigo: e.target.value })} />
          </div>
          <div>
            <label>Descrição</label>
            <input required placeholder="Defumado bovino, NCM 0210, em substituição tributária"
                   value={formGrupo.descricao}
                   onChange={e => setFormGrupo({ ...formGrupo, descricao: e.target.value })} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button className="btn" type="submit">Criar grupo</button>
          </div>
        </form>
      </div>

      <div className="panel">
        <h3>Grupos ({grupos.length})</h3>
        {grupos.length === 0 && (
          <p className="muted">
            Nenhum grupo ainda. Sem grupo, nenhum produto libera para emissão — é a trava que impede
            nota com CFOP adivinhado.
          </p>
        )}
        {grupos.map(g => {
          const daqui = regras.filter(r => r.grupo_tributario_id === g.id);
          const produtosDoGrupo = produtos.filter(p => p.grupo_tributario_id === g.id);
          const aberto = grupoAberto === g.id;
          return (
            <div className="items-list" key={g.id} style={{ marginBottom: 12, ...(g.ativo ? {} : { opacity: 0.55 }) }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <b>{g.codigo}</b> — {g.descricao}
                  <span className="muted" style={{ fontSize: 11.5, marginLeft: 8 }}>
                    {daqui.length} regra{daqui.length === 1 ? '' : 's'} · {produtosDoGrupo.length} produto{produtosDoGrupo.length === 1 ? '' : 's'}
                  </span>
                  {!g.ativo && <span className="tag warn" style={{ marginLeft: 8 }}>inativo</span>}
                </div>
                <div className="row-actions">
                  <button className="btn secondary small" onClick={() => setGrupoAberto(aberto ? null : g.id)}>
                    {aberto ? 'Fechar' : 'Ver regras'}
                  </button>
                  <button className="btn secondary small" onClick={() => novaRegra(g.id)}>Nova regra</button>
                  <button className="btn secondary small" onClick={() => alternarGrupo(g)}>
                    {g.ativo ? 'Desativar' : 'Reativar'}
                  </button>
                </div>
              </div>

              {aberto && (
                <div style={{ marginTop: 10 }}>
                  {daqui.length ? daqui.map(r => {
                    const n = naturezas.find(x => x.id === r.natureza_operacao_id);
                    return (
                      <div className="item-line" key={r.id} style={{ flexWrap: 'wrap', gap: 8 }}>
                        <span style={{ minWidth: 200 }}>
                          <b>{n?.descricao || 'natureza removida'}</b>
                          <span className="muted" style={{ fontSize: 11.5 }}>
                            {' · '}{r.uf_destino === '*' ? 'qualquer UF' : r.uf_destino}
                            {' · '}{descreverDestinatario(r)}
                          </span>
                        </span>
                        <span className="muted" style={{ fontSize: 11.5, flex: 1 }}>{resumoRegra(r)}</span>
                        {!r.ativo && <span className="tag warn">inativa</span>}
                        <button className="btn secondary small" onClick={() => editarRegra(r)}>Editar</button>
                        <button className="btn danger small" onClick={() => excluirRegra(r.id)}>×</button>
                      </div>
                    );
                  }) : <p className="muted" style={{ fontSize: 12 }}>Nenhuma regra neste grupo ainda.</p>}

                  {produtosDoGrupo.length > 0 && (
                    <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
                      Produtos: {produtosDoGrupo.map(p => p.codigo).join(', ')}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {formRegra && (
        <div className="panel">
          <h3>{editandoRegra ? 'Editar regra' : 'Nova regra'}</h3>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            Alvo: {descreverAlvo(formRegra, { grupos, produtos })}
          </p>
          <RegraTributariaForm form={formRegra} setForm={setFormRegra} naturezas={naturezas}
                               cfops={cfops} produtos={produtos} salvando={salvando}
                               onSalvar={salvarRegra} onCancelar={() => { setFormRegra(null); setEditandoRegra(null); }} />
        </div>
      )}

      <Simulador empresaId={empresaAtual?.id} produtos={produtos} naturezas={naturezas} />
    </>
  );
}

// Pergunta ao banco qual regra ganharia numa venda de verdade. É a única forma
// honesta de conferir precedência: a ordem produto > grupo > NCM está na função
// SQL, não aqui, e reimplementá-la em JavaScript só criaria uma segunda verdade.
function Simulador({ empresaId, produtos, naturezas }) {
  const [pergunta, setPergunta] = useState({
    produto_id: '', natureza_operacao_id: '', uf: 'RO', contribuinte: 'sim', consumidorFinal: 'nao',
  });
  const [resposta, setResposta] = useState(null);
  const [consultando, setConsultando] = useState(false);

  async function simular(e) {
    e.preventDefault();
    setConsultando(true);
    setResposta(null);
    const { data, error } = await supabase.rpc('fn_resolver_regra_tributaria', {
      p_empresa_id: empresaId,
      p_produto_id: pergunta.produto_id,
      p_natureza_operacao_id: pergunta.natureza_operacao_id,
      p_uf_destino: pergunta.uf,
      p_contribuinte: pergunta.contribuinte === 'sim',
      p_consumidor_final: pergunta.consumidorFinal === 'sim',
    });
    setConsultando(false);
    if (error) { setResposta({ erro: error.message }); return; }
    setResposta({ regra: (data || [])[0] || null });
  }

  return (
    <div className="panel">
      <h3>Simular</h3>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        Escolha um produto e uma operação: o banco responde qual regra ganharia se a nota saísse agora.
      </p>
      <form className="form-grid" onSubmit={simular}>
        <div>
          <label>Produto</label>
          <select required value={pergunta.produto_id}
                  onChange={e => setPergunta({ ...pergunta, produto_id: e.target.value })}>
            <option value="">Selecione…</option>
            {produtos.map(p => <option key={p.id} value={p.id}>{p.codigo} — {p.nome}</option>)}
          </select>
        </div>
        <div>
          <label>Natureza</label>
          <select required value={pergunta.natureza_operacao_id}
                  onChange={e => setPergunta({ ...pergunta, natureza_operacao_id: e.target.value })}>
            <option value="">Selecione…</option>
            {naturezas.map(n => <option key={n.id} value={n.id}>{n.descricao}</option>)}
          </select>
        </div>
        <div>
          <label>UF</label>
          <input value={pergunta.uf} maxLength={2}
                 onChange={e => setPergunta({ ...pergunta, uf: e.target.value.toUpperCase() })} />
        </div>
        <div>
          <label>Contribuinte</label>
          <select value={pergunta.contribuinte} onChange={e => setPergunta({ ...pergunta, contribuinte: e.target.value })}>
            <option value="sim">Sim</option><option value="nao">Não</option>
          </select>
        </div>
        <div>
          <label>Consumidor final</label>
          <select value={pergunta.consumidorFinal} onChange={e => setPergunta({ ...pergunta, consumidorFinal: e.target.value })}>
            <option value="nao">Não</option><option value="sim">Sim</option>
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button className="btn" type="submit" disabled={consultando}>
            {consultando ? 'Consultando…' : 'Simular'}
          </button>
        </div>
      </form>

      {resposta?.erro && <p className="muted" style={{ marginTop: 10 }}>Erro na consulta: {resposta.erro}</p>}
      {resposta && !resposta.erro && !resposta.regra && (
        <p style={{ marginTop: 10 }}>
          <span className="tag bad">Nenhuma regra</span>{' '}
          <span className="muted" style={{ fontSize: 12 }}>
            A emissão pararia aqui, em vez de chutar um CFOP. Crie a regra que falta.
          </span>
        </p>
      )}
      {resposta?.regra && (
        <div className="items-list" style={{ marginTop: 10 }}>
          <div><b>{resumoRegra(resposta.regra)}</b></div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Vale para {descreverDestinatario(resposta.regra)} em{' '}
            {resposta.regra.uf_destino === '*' ? 'qualquer UF' : resposta.regra.uf_destino}
            {resposta.regra.base_legal ? ` · ${resposta.regra.base_legal}` : ''}
          </div>
        </div>
      )}
    </div>
  );
}

function hoje() {
  return new Date().toISOString().slice(0, 10);
}

// Campo numérico em branco vira null: os checks do banco testam `is null or ...`,
// e string vazia não é nula.
function numeroOuNulo(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function textoOuNulo(v) {
  const t = String(v ?? '').trim();
  return t === '' ? null : t;
}

function camposRegra(form, empresaId) {
  return {
    empresa_id: empresaId,
    grupo_tributario_id: form.grupo_tributario_id || null,
    produto_id: form.produto_id || null,
    ncm_generico: textoOuNulo(form.ncm_generico),
    natureza_operacao_id: form.natureza_operacao_id,
    uf_destino: form.uf_destino || '*',
    destinatario_contribuinte: form.destinatario_contribuinte,
    destinatario_consumidor_final: form.destinatario_consumidor_final,
    cfop: form.cfop,
    csosn: textoOuNulo(form.csosn),
    mod_bc: numeroOuNulo(form.mod_bc),
    reducao_base_percentual: numeroOuNulo(form.reducao_base_percentual),
    mod_bc_st: numeroOuNulo(form.mod_bc_st),
    reducao_base_st_percentual: numeroOuNulo(form.reducao_base_st_percentual),
    mva_percentual: numeroOuNulo(form.mva_percentual),
    aliquota_interna_destino: numeroOuNulo(form.aliquota_interna_destino),
    aliquota_st_retido: numeroOuNulo(form.aliquota_st_retido),
    cst_pis: textoOuNulo(form.cst_pis),
    cst_cofins: textoOuNulo(form.cst_cofins),
    aliquota_pis: numeroOuNulo(form.aliquota_pis),
    aliquota_cofins: numeroOuNulo(form.aliquota_cofins),
    st_responsavel: form.st_responsavel || ST_RESPONSAVEL.NAO_APLICAVEL,
    permite_credito_simples: !!form.permite_credito_simples,
    base_legal: textoOuNulo(form.base_legal),
    observacao_fiscal: textoOuNulo(form.observacao_fiscal),
    vigencia_inicio: form.vigencia_inicio || hoje(),
    vigencia_fim: form.vigencia_fim || null,
  };
}
