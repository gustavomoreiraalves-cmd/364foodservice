'use client';
import { fmtDateTime, conservacaoLabel } from '../lib/producao';
import { fmtDate } from '../lib/format';
import { medidasImpressao, paginarEtiquetas } from '../lib/etiquetas';

// Etiquetas em rolo, impressas por `window.print()` com medidas em milímetro
// exato. Cada página de impressão é uma LINHA do rolo: com duas colunas, duas
// etiquetas lado a lado. A geometria mora em lib/etiquetas.js.
//
// Dois modelos hoje:
//   validade-cozinha — produção completa e interna (comportamento original)
//   recebimento      — volume de matéria-prima, com lote e QR
//
// Os dados vêm SEMPRE do registro de origem — nunca redigitados. O QR chega
// pronto em `qrSvg`, gerado antes da impressão.
export default function EtiquetaPrint({ etiqueta }) {
  if (!etiqueta) return null;

  const modeloId = etiqueta.modelo || 'validade-cozinha';
  const m = medidasImpressao(modeloId);
  const copias = Math.max(1, Number(etiqueta.copias) || 1);
  const linhas = paginarEtiquetas(copias, m.colunas);

  return (
    <div className="print-area etiquetas-print">
      <style>{`
        @media print {
          @page { size: ${m.paginaLargura_mm}mm ${m.paginaAltura_mm}mm; margin: 0; }
          .etiquetas-print .et-fileira { page-break-after: always; }
          .etiquetas-print .et-fileira:last-child { page-break-after: auto; }
        }
        .etiquetas-print .et-fileira {
          width: ${m.paginaLargura_mm}mm; height: ${m.etiquetaAltura_mm}mm; box-sizing: border-box;
          padding: 0 ${m.margemLateral_mm}mm; display: flex; gap: ${m.gapColuna_mm}mm;
        }
        .etiquetas-print .etiqueta {
          width: ${m.etiquetaLargura_mm}mm; height: ${m.etiquetaAltura_mm}mm;
          box-sizing: border-box; overflow: hidden;
          padding: 1.5mm 2mm; color: #000; background: #fff;
          font-family: Arial, Helvetica, sans-serif; line-height: 1.15;
          display: flex; flex-direction: column;
        }
        .etiquetas-print .et-empresa { font-size: 6pt; text-transform: uppercase; letter-spacing: .3px; white-space: nowrap; overflow: hidden; }
        .etiquetas-print .et-produto { font-size: 9pt; font-weight: 700; text-transform: uppercase; margin: .5mm 0; }
        .etiquetas-print .et-linha { font-size: 6.5pt; }
        .etiquetas-print .et-linha b { font-size: 7pt; }
        .etiquetas-print .et-conservacao { font-size: 7pt; font-weight: 700; text-transform: uppercase; margin-top: .3mm; }
        .etiquetas-print .et-codigo { font-family: 'Courier New', monospace; font-size: 6.5pt; margin-top: auto; }
        /* recebimento: coluna de texto à esquerda, QR fixo à direita */
        .etiquetas-print .et-receb { display: flex; gap: 1.5mm; height: 100%; width: 100%; }
        .etiquetas-print .et-receb-texto { flex: 1; min-width: 0; display: flex; flex-direction: column; }
        .etiquetas-print .et-receb-qr { width: 14mm; display: flex; align-items: center; justify-content: center; }
        .etiquetas-print .et-receb-qr svg { display: block; }
        .etiquetas-print .et-lote { font-family: 'Courier New', monospace; font-size: 8pt; font-weight: 700; }
        .etiquetas-print .et-mp { font-size: 8pt; font-weight: 700; text-transform: uppercase; margin: .3mm 0; overflow: hidden; }
        .etiquetas-print .et-rodape { margin-top: auto; display: flex; justify-content: space-between; gap: 1mm; font-size: 6.5pt; }
        .etiquetas-print .et-vol { font-weight: 700; white-space: nowrap; }
      `}</style>
      {linhas.map((linha, i) => (
        <div className="et-fileira" key={i}>
          {linha.map(n => (
            <div className="etiqueta" key={n}>
              {modeloId === 'recebimento'
                ? <Recebimento etiqueta={etiqueta} indice={n} copias={copias} />
                : <ValidadeCozinha etiqueta={etiqueta} />}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ValidadeCozinha({ etiqueta }) {
  return (
    <>
      <div className="et-empresa">{etiqueta.empresa}{etiqueta.unidade ? ` · ${etiqueta.unidade}` : ''}</div>
      <div className="et-produto">{etiqueta.produto}</div>
      <div className="et-linha">Produção: <b>{fmtDateTime(etiqueta.producao)}</b></div>
      <div className="et-linha">Validade: <b>{fmtDateTime(etiqueta.validade)}</b></div>
      {etiqueta.conservacao && <div className="et-conservacao">{conservacaoLabel(etiqueta.conservacao)}</div>}
      <div className="et-linha">Resp.: {etiqueta.responsavel || '—'}</div>
      <div className="et-codigo">
        {etiqueta.codigo}{etiqueta.lote ? ` · Lote ${etiqueta.lote}` : ''}
      </div>
    </>
  );
}

// Uma etiqueta por volume: o número do volume muda a cada cópia, o resto não.
function Recebimento({ etiqueta, indice, copias }) {
  return (
    <div className="et-receb">
      <div className="et-receb-texto">
        <div className="et-lote">LOTE {etiqueta.lote}</div>
        <div className="et-mp">{etiqueta.materiaPrima}</div>
        <div className="et-linha">Receb. {fmtDate(etiqueta.recebidoEm)}</div>
        <div className="et-linha">Forn. {etiqueta.fornecedor || '—'}</div>
        <div className="et-rodape">
          <span>NF {etiqueta.notaFiscal || '—'}</span>
          <span className="et-vol">vol. {indice + 1}/{copias}</span>
        </div>
      </div>
      <div className="et-receb-qr" dangerouslySetInnerHTML={{ __html: etiqueta.qrSvg || '' }} />
    </div>
  );
}

// Renderiza as etiquetas e abre a impressão. A falha ou o cancelamento da
// impressão física não desfaz nada — o registro e a impressão são independentes.
export function imprimirEtiquetas(setEtiqueta, dados) {
  setEtiqueta(dados);
  setTimeout(() => window.print(), 150);
}
