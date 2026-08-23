'use client';
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { fmtDateTime, MOTIVOS_REIMPRESSAO } from '../lib/producao';
import { fmtDate } from '../lib/format';
import { MODELOS } from '../lib/etiquetas';
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
  // A partir de qual volume esta reimpressão começa a numerar — quem perde a
  // etiqueta da caixa 7 de 20 digita 7 aqui e imprime só "vol. 7/20", em vez
  // de reimprimir as 20 ou receber uma etiqueta "vol. 1/1" errada. Só existe
  // no modelo `recebimento`; nas telas de produção fica sempre em 1 e não
  // aparece na tela.
  const [volumeInicial, setVolumeInicial] = useState(1);
  // Trava de duplo clique: sem ela, dois cliques em "Imprimir" chamam a RPC
  // duas vezes e gravam duas linhas em etiqueta_impressoes — tabela
  // append-only, então a duplicata não tem como ser apagada depois.
  const [enviando, setEnviando] = useState(false);

  // Sem `dados`, o modelo efetivo é o da produção (caminho antigo, preservado
  // ao pé da letra); com `dados`, é a prop `modelo` que a tela chamadora passou.
  // `produtos.modelo_etiqueta` é texto livre, sem constraint de banco nem
  // tela que valide o valor contra MODELOS (lib/etiquetas.js) — se algum
  // registro tiver um valor que não exista lá, cai no padrão em vez de deixar
  // `EtiquetaPrint` lançar e derrubar o render da tela de produção.
  const modeloValido = m => (m && MODELOS[m] ? m : 'validade-cozinha');
  const modeloEfetivo = modeloValido(dados ? modelo : producao.modelo);

  const dadosEtiqueta = dados
    ? { ...dados, modelo: modeloEfetivo, copias, volumeInicial }
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

  // Teto de segurança: um "20" digitado como "2000" não deve virar 2000
  // etiquetas nem 1000 páginas na impressora sem confirmação.
  const COPIAS_MAX = 500;

  async function imprimir() {
    if (enviando) return; // trava de duplo clique — ver estado `enviando` acima.
    const qtd = Number(copias);
    // copias === '' (campo apagado) chega aqui como 0 — Number('') é 0, não
    // NaN — e falha em `qtd > 0` do mesmo jeito. Sem esta checagem, esse 0
    // seguiria até a RPC e o operador veria o erro cru do Postgres em inglês
    // (violação do check quantidade > 0) em vez de um aviso em português.
    if (!(Number.isInteger(qtd) && qtd > 0)) {
      alert('Informe a quantidade de etiquetas (um número inteiro maior que zero).');
      return;
    }
    if (qtd > COPIAS_MAX) {
      alert(`Quantidade de etiquetas não pode passar de ${COPIAS_MAX} por impressão.`);
      return;
    }
    // "Reimprimir a partir do volume nº" só existe para recebimento +
    // reimpressão (ver o campo mais abaixo). O `max` do input só limita o
    // spinner das setinhas — digitar um valor direto (ou reduzir o `max`
    // depois de já ter digitado a quantidade) não é barrado por HTML sozinho,
    // e o campo não está dentro de um <form> com submit para validar
    // nativamente. Sem esta checagem, início 18 + 5 cópias imprime
    // "vol. 23/20" numa caixa física.
    if (modeloEfetivo === 'recebimento' && tipo === 'reimpressao') {
      const inicio = Number(volumeInicial);
      if (!(Number.isInteger(inicio) && inicio > 0)) {
        alert('Informe um volume inicial válido (um número inteiro maior que zero).');
        return;
      }
      const total = Number(dadosEtiqueta.volumesTotal) || 0;
      if (total > 0 && inicio + qtd - 1 > total) {
        alert(`O volume inicial (${inicio}) mais a quantidade (${qtd}) passa do total de volumes do item `
          + `(${total}). Ajuste o volume inicial ou a quantidade.`);
        return;
      }
    }
    let motivo = null;
    if (tipo === 'reimpressao') {
      motivo = motivoSel === 'Outro' ? motivoOutro.trim() : motivoSel;
      if (!motivo) { alert('Descreva o motivo da reimpressão.'); return; }
    }
    setEnviando(true);
    try {
      const { error } = await supabase.rpc('registrar_impressao', {
        p_source_type: sourceType,
        p_source_id: producao.id,
        p_tipo: tipo,
        p_quantidade: qtd,
        p_modelo: modeloEfetivo,
        p_impressora: impressora || null,
        p_motivo: motivo,
      });
      if (error) { alert('Não foi possível registrar a impressão: ' + error.message); return; }
      imprimirEtiquetas(setEtiqueta, dadosEtiqueta);
      onFechar();
    } finally {
      setEnviando(false);
    }
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
            <input type="number" min="1" max={COPIAS_MAX} step="1" value={copias} onChange={e => setCopias(e.target.value)} style={{ minHeight: 44 }} />
          </div>
          {modeloEfetivo === 'recebimento' && tipo === 'reimpressao' && (
            <div><label>Reimprimir a partir do volume nº</label>
              <input
                type="number" min="1" max={dadosEtiqueta.volumesTotal || undefined} step="1"
                value={volumeInicial} onChange={e => setVolumeInicial(e.target.value)}
                style={{ minHeight: 44 }}
              />
            </div>
          )}
          <div><label>Modelo</label>
            <select value={modeloEfetivo} disabled>
              <option value="validade-cozinha">Validade Cozinha (50×30 mm)</option>
              <option value="recebimento">Recebimento (50×30 mm)</option>
              {/* Fase 3 do controle de lote (Task 6): sem esta opção, o valor
                  'producao-lote' não batia com nenhuma <option> e o <select>
                  desabilitado renderizava em branco — não muda o que é
                  gravado nem impresso, só a conferência visual do modal. */}
              <option value="producao-lote">Produção (lote) (50×30 mm)</option>
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
                <div style={{ fontSize: 11 }}>NF {dadosEtiqueta.notaFiscal} · vol. {volumeInicial}/{dadosEtiqueta.volumesTotal || copias}</div>
              </>
            ) : modeloEfetivo === 'producao-lote' ? (
              // Fase 3 (Task 6): mesmos campos que EtiquetaPrint.ProducaoLote
              // realmente imprime — produto, lote, fabricação e validade, com
              // o QR já resolvido em `dados.qrSvg` (a tela chamadora resolve
              // ANTES de abrir o modal). Sem este ramo, o "Visualizar" caía no
              // genérico abaixo e mostrava "Produção: —" sem lote nem QR —
              // divergente do que sai impresso.
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, textTransform: 'uppercase' }}>{dadosEtiqueta.produto}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'monospace', margin: '2px 0' }}>LOTE {dadosEtiqueta.lote}</div>
                  <div style={{ fontSize: 11 }}>Fab. {fmtDate(dadosEtiqueta.fabricacao)}</div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>VAL {fmtDate(dadosEtiqueta.validade)}</div>
                </div>
                {dadosEtiqueta.qrSvg && (
                  <div style={{ width: 60, flexShrink: 0 }} dangerouslySetInnerHTML={{ __html: dadosEtiqueta.qrSvg }} />
                )}
              </div>
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
          <button className="btn" onClick={imprimir} disabled={enviando} style={{ padding: '12px 16px' }}>
            {enviando ? 'Enviando…' : `Imprimir ${copias} etiqueta${Number(copias) > 1 ? 's' : ''}`}
          </button>
          <button className="btn secondary" onClick={() => setVerPreview(v => !v)} disabled={enviando}>{verPreview ? 'Ocultar' : 'Visualizar'}</button>
          <button className="btn secondary" onClick={onFechar} disabled={enviando}>Agora não</button>
        </div>
      </div>
    </div>
  );
}
