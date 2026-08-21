'use client';
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { fmtDateTime, MOTIVOS_REIMPRESSAO } from '../lib/producao';
import { fmtDate } from '../lib/format';
import { imprimirEtiquetas } from './EtiquetaPrint';

// Modal pós-finalização/reimpressão: quantidade de etiquetas, visualizar/
// imprimir/agora não. "Agora não" nunca desfaz nada. Em reimpressão o motivo
// é obrigatório (auditado no banco).
//
// `producao`: a origem da etiqueta — pode ser uma produção (com recipientes,
// produto, validade…) ou, no modelo `recebimento`, um item de recebimento
// (só precisa de `id` e `modelo`; o resto vem em `dados`).
// sourceType: 'producao_interna' (padrão), 'producao' (produção completa) ou
// 'recebimento_item' (etiqueta de volume).
//
// `dados`: quando vem preenchido (modelo `recebimento`), é usado no lugar do
// `dadosEtiqueta` montado internamente — a tela chamadora já monta os dados
// (com o QR resolvido) e `dados.copias` vira a sugestão inicial de cópias.
// Sem `dados`, o modal segue o caminho antigo: monta os dados a partir de
// `producao` e sugere cópias a partir de `producao.recipientes` — é o que as
// telas de produção (nova, internas, completa) continuam usando.
export default function ModalEtiquetas({
  producao, empresaNome, responsavelNome, onFechar, setEtiqueta,
  tipo = 'original', sourceType = 'producao_interna',
  modelo = 'validade-cozinha', dados, titulo,
}) {
  const [copias, setCopias] = useState((dados ? dados.copias : producao.recipientes) || 1);
  const [verPreview, setVerPreview] = useState(false);
  const [impressora, setImpressora] = useState('');
  const [motivoSel, setMotivoSel] = useState(MOTIVOS_REIMPRESSAO[0]);
  const [motivoOutro, setMotivoOutro] = useState('');

  // Sem `dados`, o modelo efetivo é o da produção (caminho antigo, preservado
  // ao pé da letra); com `dados`, é a prop `modelo` que a tela chamadora passou.
  const modeloEfetivo = dados ? modelo : (producao.modelo || 'validade-cozinha');

  const dadosEtiqueta = dados
    ? { ...dados, modelo: modeloEfetivo, copias }
    : {
        modelo: modeloEfetivo,
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
      p_modelo: modeloEfetivo,
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
        <h3>{titulo || (tipo === 'reimpressao' ? 'Reimprimir etiquetas' : 'Produção Finalizada')}</h3>
        {modeloEfetivo === 'recebimento' ? (
          <p style={{ margin: '6px 0' }}>
            <b>Lote {dadosEtiqueta.lote}</b><br />
            {dadosEtiqueta.materiaPrima}<br />
            Fornecedor: {dadosEtiqueta.fornecedor}<br />
            Nota fiscal: {dadosEtiqueta.notaFiscal}
          </p>
        ) : (
          <p style={{ margin: '6px 0' }}>
            <b>{producao.produtoNome}</b> · {producao.codigo}<br />
            Produção: {fmtDateTime(producao.produzido_em)}<br />
            Validade: {fmtDateTime(producao.validade)}<br />
            {producao.recipientes ? <>Recipientes: {producao.recipientes}<br /></> : null}
          </p>
        )}
        <div className="form-grid">
          <div><label>Quantidade de etiquetas</label>
            <input type="number" min="1" step="1" value={copias} onChange={e => setCopias(e.target.value)} style={{ minHeight: 44 }} />
          </div>
          <div><label>Modelo</label>
            <select value={modeloEfetivo} disabled>
              <option value="validade-cozinha">Validade Cozinha (50×30 mm)</option>
              <option value="recebimento">Recebimento (50×30 mm)</option>
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
            {modeloEfetivo === 'recebimento' ? (
              <>
                <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'monospace' }}>LOTE {dadosEtiqueta.lote}</div>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', margin: '2px 0' }}>{dadosEtiqueta.materiaPrima}</div>
                <div style={{ fontSize: 11 }}>Receb.: {fmtDate(dadosEtiqueta.recebidoEm)}</div>
                <div style={{ fontSize: 11 }}>Forn.: {dadosEtiqueta.fornecedor}</div>
                <div style={{ fontSize: 11 }}>NF {dadosEtiqueta.notaFiscal} · vol. 1/{copias}</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 10, textTransform: 'uppercase' }}>{dadosEtiqueta.empresa}{dadosEtiqueta.unidade ? ` · ${dadosEtiqueta.unidade}` : ''}</div>
                <div style={{ fontSize: 15, fontWeight: 700, textTransform: 'uppercase', margin: '2px 0' }}>{dadosEtiqueta.produto}</div>
                <div style={{ fontSize: 11 }}>Produção: <b>{fmtDateTime(dadosEtiqueta.producao)}</b></div>
                <div style={{ fontSize: 11 }}>Validade: <b>{fmtDateTime(dadosEtiqueta.validade)}</b></div>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>{dadosEtiqueta.conservacao}</div>
                <div style={{ fontSize: 11 }}>Resp.: {dadosEtiqueta.responsavel}</div>
                <div style={{ fontSize: 11, fontFamily: 'monospace' }}>{dadosEtiqueta.codigo}</div>
              </>
            )}
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
