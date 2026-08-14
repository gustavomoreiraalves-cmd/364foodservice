'use client';
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { fmtDateTime, MOTIVOS_REIMPRESSAO } from '../lib/producao';
import { imprimirEtiquetas } from './EtiquetaPrint';

// Modal pós-finalização/reimpressão: quantidade de etiquetas (sugerida =
// recipientes), visualizar/imprimir/agora não. "Agora não" nunca desfaz a
// produção. Em reimpressão o motivo é obrigatório (auditado no banco).
// sourceType: 'producao_interna' (padrão) ou 'producao' (produção completa).
export default function ModalEtiquetas({ producao, empresaNome, responsavelNome, onFechar, setEtiqueta, tipo = 'original', sourceType = 'producao_interna' }) {
  const [copias, setCopias] = useState(producao.recipientes || 1);
  const [verPreview, setVerPreview] = useState(false);
  const [impressora, setImpressora] = useState('');
  const [motivoSel, setMotivoSel] = useState(MOTIVOS_REIMPRESSAO[0]);
  const [motivoOutro, setMotivoOutro] = useState('');

  const dadosEtiqueta = {
    empresa: empresaNome,
    unidade: producao.unidadeNome,
    produto: producao.produtoNome,
    produtoCodigo: producao.produtoCodigo,
    codigo: producao.codigo,
    producao: producao.produzido_em,
    validade: producao.validade,
    conservacao: producao.conservacao,
    responsavel: responsavelNome,
    copias,
  };

  async function imprimir() {
    let motivo = null;
    if (tipo === 'reimpressao') {
      motivo = motivoSel === 'Outro' ? motivoOutro.trim() : motivoSel;
      if (!motivo) { alert('Descreva o motivo da reimpressão.'); return; }
    }
    const { error } = await supabase.rpc('registrar_impressao', {
      p_source_type: sourceType,
      p_source_id: producao.id,
      p_tipo: tipo,
      p_quantidade: Number(copias),
      p_modelo: producao.modelo || 'validade-cozinha',
      p_impressora: impressora || null,
      p_motivo: motivo,
    });
    if (error) { alert('Não foi possível registrar a impressão: ' + error.message); return; }
    imprimirEtiquetas(setEtiqueta, dadosEtiqueta);
    onFechar();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}>
      <div className="panel" style={{ maxWidth: 460, width: '100%', margin: 0 }}>
        <h3>{tipo === 'reimpressao' ? 'Reimprimir etiquetas' : 'Produção Finalizada'}</h3>
        <p style={{ margin: '6px 0' }}>
          <b>{producao.produtoNome}</b> · {producao.codigo}<br />
          Produção: {fmtDateTime(producao.produzido_em)}<br />
          Validade: {fmtDateTime(producao.validade)}<br />
          {producao.recipientes ? <>Recipientes: {producao.recipientes}<br /></> : null}
        </p>
        <div className="form-grid">
          <div><label>Quantidade de etiquetas</label>
            <input type="number" min="1" step="1" value={copias} onChange={e => setCopias(e.target.value)} style={{ minHeight: 44 }} />
          </div>
          <div><label>Modelo</label>
            <select value={producao.modelo || 'validade-cozinha'} disabled>
              <option value="validade-cozinha">Validade Cozinha (60×40 mm)</option>
            </select>
          </div>
          <div><label>Impressora</label>
            <input placeholder="Opcional — ex.: Cozinha" value={impressora} onChange={e => setImpressora(e.target.value)} />
          </div>
        </div>
        {tipo === 'reimpressao' && (
          <div className="form-grid" style={{ marginTop: 10 }}>
            <div><label>Motivo da reimpressão</label>
              <select value={motivoSel} onChange={e => setMotivoSel(e.target.value)}>
                {MOTIVOS_REIMPRESSAO.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            {motivoSel === 'Outro' && (
              <div><label>Descreva o motivo</label>
                <input required value={motivoOutro} onChange={e => setMotivoOutro(e.target.value)} />
              </div>
            )}
          </div>
        )}
        {verPreview && (
          <div style={{ background: '#fff', borderRadius: 6, padding: 10, marginTop: 12, color: '#000', fontFamily: 'Arial, sans-serif', maxWidth: 240 }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase' }}>{dadosEtiqueta.empresa}{dadosEtiqueta.unidade ? ` · ${dadosEtiqueta.unidade}` : ''}</div>
            <div style={{ fontSize: 15, fontWeight: 700, textTransform: 'uppercase', margin: '2px 0' }}>{dadosEtiqueta.produto}</div>
            <div style={{ fontSize: 11 }}>Produção: <b>{fmtDateTime(dadosEtiqueta.producao)}</b></div>
            <div style={{ fontSize: 11 }}>Validade: <b>{fmtDateTime(dadosEtiqueta.validade)}</b></div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>{dadosEtiqueta.conservacao}</div>
            <div style={{ fontSize: 11 }}>Resp.: {dadosEtiqueta.responsavel}</div>
            <div style={{ fontSize: 11, fontFamily: 'monospace' }}>{dadosEtiqueta.codigo}</div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
          <button className="btn" onClick={imprimir} style={{ padding: '12px 16px' }}>
            Imprimir {copias} etiqueta{Number(copias) > 1 ? 's' : ''}
          </button>
          <button className="btn secondary" onClick={() => setVerPreview(v => !v)}>{verPreview ? 'Ocultar' : 'Visualizar'}</button>
          <button className="btn secondary" onClick={onFechar}>Agora não</button>
        </div>
      </div>
    </div>
  );
}
