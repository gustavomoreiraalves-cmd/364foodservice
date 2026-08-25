'use client';
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import RegraTributariaForm from './RegraTributariaForm';
import Icone from './Icone';
import { resumoRegra, descreverDestinatario, validarRegraTributaria, ST_RESPONSAVEL } from '../lib/fiscalRegras';

// A configuração fiscal aberta de dentro do produto, como no cadastro do PDV
// Consumer: quem está cadastrando não precisa ir a outra tela para dizer como o
// item tributa. A configuração continua sendo uma entidade própria e
// reaproveitável — é ela que evita repetir CFOP e MVA em cada SKU —, mas passa
// a nascer e a ser corrigida aqui.

const REGRA_VAZIA = {
  natureza_operacao_id: '', uf_destino: '*',
  destinatario_contribuinte: null, destinatario_consumidor_final: null,
  cfop: '', csosn: '', st_responsavel: ST_RESPONSAVEL.NAO_APLICAVEL,
  mod_bc: null, reducao_base_percentual: '', mod_bc_st: null,
  reducao_base_st_percentual: '', mva_percentual: '', aliquota_interna_destino: '',
  aliquota_st_retido: '', cst_pis: '', cst_cofins: '',
  permite_credito_simples: false, base_legal: '', observacao_fiscal: '',
  vigencia_inicio: '', vigencia_fim: null,
};

function hoje() {
  return new Date().toISOString().slice(0, 10);
}

function numeroOuNulo(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function textoOuNulo(v) {
  const t = String(v ?? '').trim();
  return t === '' ? null : t;
}

export default function ConfiguracaoFiscalModal({
  empresaId, grupo, naturezas, cfops, regras, onFechar, onSalvo,
}) {
  const [codigo, setCodigo] = useState(grupo?.codigo || '');
  const [descricao, setDescricao] = useState(grupo?.descricao || '');
  const [grupoId, setGrupoId] = useState(grupo?.id || null);
  const [formRegra, setFormRegra] = useState(null);
  const [editandoRegra, setEditandoRegra] = useState(null);
  const [salvando, setSalvando] = useState(false);

  const minhasRegras = regras.filter(r => r.grupo_tributario_id === grupoId);

  async function salvarGrupo() {
    if (!codigo.trim() || !descricao.trim()) {
      alert('A configuração precisa de um código curto e de uma descrição.');
      return null;
    }
    setSalvando(true);
    try {
      const campos = {
        codigo: codigo.trim().toUpperCase().replace(/\s+/g, '_'),
        descricao: descricao.trim(),
      };
      if (grupoId) {
        const { error } = await supabase.from('grupos_tributarios').update(campos).eq('id', grupoId);
        if (error) { alert('Não foi possível salvar: ' + error.message); return null; }
        await onSalvo(grupoId);
        return grupoId;
      }
      const { data, error } = await supabase.from('grupos_tributarios')
        .insert([{ ...campos, empresa_id: empresaId }]).select('id').maybeSingle();
      if (error) { alert('Não foi possível criar: ' + error.message); return null; }
      setGrupoId(data.id);
      await onSalvo(data.id);
      return data.id;
    } finally {
      setSalvando(false);
    }
  }

  // A regra precisa de um grupo com id. Se a pessoa clicou em "adicionar regra"
  // antes de salvar o cabeçalho, salvamos o cabeçalho primeiro em vez de pedir
  // que ela faça isso na ordem certa.
  async function novaRegra() {
    const id = grupoId || await salvarGrupo();
    if (!id) return;
    setFormRegra({ ...REGRA_VAZIA, grupo_tributario_id: id, vigencia_inicio: hoje() });
    setEditandoRegra(null);
  }

  function editarRegra(r) {
    setFormRegra({ ...REGRA_VAZIA, ...r, vigencia_inicio: r.vigencia_inicio || '', vigencia_fim: r.vigencia_fim || null });
    setEditandoRegra(r.id);
  }

  async function salvarRegra() {
    const natureza = naturezas.find(n => n.id === formRegra.natureza_operacao_id);
    if (validarRegraTributaria({ ...formRegra, tipo_operacao: natureza?.tipo_operacao }).length) return;
    setSalvando(true);
    try {
      const campos = {
        empresa_id: empresaId,
        grupo_tributario_id: grupoId,
        produto_id: null,
        ncm_generico: null,
        natureza_operacao_id: formRegra.natureza_operacao_id,
        uf_destino: formRegra.uf_destino || '*',
        destinatario_contribuinte: formRegra.destinatario_contribuinte,
        destinatario_consumidor_final: formRegra.destinatario_consumidor_final,
        cfop: formRegra.cfop,
        csosn: textoOuNulo(formRegra.csosn),
        mod_bc: numeroOuNulo(formRegra.mod_bc),
        reducao_base_percentual: numeroOuNulo(formRegra.reducao_base_percentual),
        mod_bc_st: numeroOuNulo(formRegra.mod_bc_st),
        reducao_base_st_percentual: numeroOuNulo(formRegra.reducao_base_st_percentual),
        mva_percentual: numeroOuNulo(formRegra.mva_percentual),
        aliquota_interna_destino: numeroOuNulo(formRegra.aliquota_interna_destino),
        aliquota_st_retido: numeroOuNulo(formRegra.aliquota_st_retido),
        cst_pis: textoOuNulo(formRegra.cst_pis),
        cst_cofins: textoOuNulo(formRegra.cst_cofins),
        st_responsavel: formRegra.st_responsavel || ST_RESPONSAVEL.NAO_APLICAVEL,
        permite_credito_simples: !!formRegra.permite_credito_simples,
        base_legal: textoOuNulo(formRegra.base_legal),
        observacao_fiscal: textoOuNulo(formRegra.observacao_fiscal),
        vigencia_inicio: formRegra.vigencia_inicio || hoje(),
        vigencia_fim: formRegra.vigencia_fim || null,
      };
      const { error } = editandoRegra
        ? await supabase.from('regras_tributarias').update(campos).eq('id', editandoRegra)
        : await supabase.from('regras_tributarias').insert([campos]);
      if (error) { alert('Não foi possível salvar a regra: ' + error.message); return; }
      setFormRegra(null);
      setEditandoRegra(null);
      await onSalvo(grupoId);
    } finally {
      setSalvando(false);
    }
  }

  async function excluirRegra(id) {
    if (!confirm('Excluir esta regra? As notas já emitidas não mudam.')) return;
    const { error } = await supabase.from('regras_tributarias').delete().eq('id', id);
    if (error) { alert('Não foi possível excluir: ' + error.message); return; }
    await onSalvo(grupoId);
  }

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onFechar(); }}>
      <div className="modal-box wide" role="dialog" aria-modal="true" aria-label="Configuração fiscal">
        <div className="modal-head">
          <h3>{grupo ? 'Configuração fiscal' : 'Nova configuração fiscal'}</h3>
          <button className="btn secondary small" type="button" onClick={onFechar} aria-label="Fechar">
            <Icone nome="fechar" tamanho={14} />
          </button>
        </div>

        <div className="modal-body">
          <div className="form-grid">
            <div className="secao">Identificação</div>
            <div>
              <label htmlFor="cf-codigo">Código</label>
              <input id="cf-codigo" required placeholder="DEFUMADO_BOVINO_ST" value={codigo}
                     onChange={e => setCodigo(e.target.value)} />
            </div>
            <div>
              <label htmlFor="cf-desc">Descrição</label>
              <input id="cf-desc" required placeholder="Defumado bovino, NCM 0210, em ST"
                     value={descricao} onChange={e => setDescricao(e.target.value)} />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button className="btn secondary" type="button" onClick={salvarGrupo} disabled={salvando}>
                {grupoId ? 'Salvar identificação' : 'Criar configuração'}
              </button>
            </div>
            <p className="ajuda largo" style={{ marginTop: 0 }}>
              Esta configuração vale para todos os produtos apontados para ela. Corrigir aqui corrige
              todos de uma vez — é por isso que ela não vive dentro de um produto só.
            </p>
          </div>

          <div className="form-grid" style={{ marginTop: 8 }}>
            <div className="secao">Como tributa, operação por operação</div>
          </div>

          {grupoId ? (
            minhasRegras.length ? (
              <div className="items-list">
                {minhasRegras.map(r => {
                  const n = naturezas.find(x => x.id === r.natureza_operacao_id);
                  return (
                    <div className="item-line" key={r.id} style={{ flexWrap: 'wrap', gap: 8 }}>
                      <span style={{ flex: '1 1 180px', minWidth: 0 }}>
                        <b>{n?.descricao || 'natureza removida'}</b>
                        <span className="muted" style={{ fontSize: 11.5, display: 'block' }}>
                          {r.uf_destino === '*' ? 'qualquer UF' : r.uf_destino} · {descreverDestinatario(r)}
                        </span>
                      </span>
                      <span className="muted" style={{ flex: '1 1 200px', fontSize: 11.5 }}>{resumoRegra(r)}</span>
                      <button className="btn secondary small" type="button" onClick={() => editarRegra(r)}>
                        <Icone nome="lapis" tamanho={13} /> Editar
                      </button>
                      <button className="btn danger" type="button" onClick={() => excluirRegra(r.id)}
                              aria-label="Excluir regra">
                        <Icone nome="lixeira" tamanho={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="muted" style={{ fontSize: 12.5 }}>
                Nenhuma regra ainda. Sem pelo menos uma regra de venda, os produtos desta configuração
                não liberam para emissão.
              </p>
            )
          ) : (
            <p className="muted" style={{ fontSize: 12.5 }}>
              Dê um código e uma descrição acima; as regras vêm em seguida.
            </p>
          )}

          {!formRegra && (
            <button className="btn secondary" type="button" style={{ marginTop: 12 }} onClick={novaRegra}>
              <Icone nome="mais" tamanho={14} /> Adicionar regra
            </button>
          )}

          {formRegra && (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--seam)' }}>
              <RegraTributariaForm
                form={formRegra} setForm={setFormRegra} naturezas={naturezas} cfops={cfops}
                produtos={[]} salvando={salvando} onSalvar={salvarRegra}
                onCancelar={() => { setFormRegra(null); setEditandoRegra(null); }} />
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn" type="button" onClick={onFechar}>Concluir</button>
        </div>
      </div>
    </div>
  );
}
