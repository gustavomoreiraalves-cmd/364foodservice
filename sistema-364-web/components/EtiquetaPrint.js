'use client';
import { fmtDateTime, conservacaoLabel } from '../lib/producao';

// Etiqueta "Validade Cozinha" 60×40 mm. Os dados vêm SEMPRE da produção
// (completa ou interna) — nunca são redigitados. Uma página por etiqueta;
// `copias` controla quantas etiquetas saem na impressão.
//
// etiqueta = {
//   empresa, unidade, produto, produtoCodigo, codigo (PRD-INT-000482 ou lote),
//   producao (iso), validade (iso), conservacao ('resfriado'...), responsavel,
//   copias (int), lote (opcional, produção completa)
// }
export default function EtiquetaPrint({ etiqueta }) {
  if (!etiqueta) return null;
  const copias = Math.max(1, Number(etiqueta.copias) || 1);

  return (
    <div className="print-area etiquetas-print">
      <style>{`
        @media print {
          @page { size: 60mm 40mm; margin: 0; }
          .etiquetas-print .etiqueta { page-break-after: always; }
          .etiquetas-print .etiqueta:last-child { page-break-after: auto; }
        }
        .etiquetas-print .etiqueta {
          width: 60mm; height: 40mm; box-sizing: border-box; overflow: hidden;
          padding: 2mm 2.5mm; color: #000; background: #fff;
          font-family: Arial, Helvetica, sans-serif; line-height: 1.15;
          display: flex; flex-direction: column;
        }
        .etiquetas-print .et-empresa { font-size: 7pt; text-transform: uppercase; letter-spacing: .5px; white-space: nowrap; overflow: hidden; }
        .etiquetas-print .et-produto { font-size: 10.5pt; font-weight: 700; text-transform: uppercase; margin: .6mm 0; }
        .etiquetas-print .et-linha { font-size: 7.5pt; }
        .etiquetas-print .et-linha b { font-size: 8pt; }
        .etiquetas-print .et-conservacao { font-size: 8pt; font-weight: 700; text-transform: uppercase; margin-top: .4mm; }
        .etiquetas-print .et-codigo { font-family: 'Courier New', monospace; font-size: 7.5pt; margin-top: auto; }
      `}</style>
      {Array.from({ length: copias }, (_, i) => (
        <div className="etiqueta" key={i}>
          <div className="et-empresa">{etiqueta.empresa}{etiqueta.unidade ? ` · ${etiqueta.unidade}` : ''}</div>
          <div className="et-produto">{etiqueta.produto}</div>
          <div className="et-linha">Produção: <b>{fmtDateTime(etiqueta.producao)}</b></div>
          <div className="et-linha">Validade: <b>{fmtDateTime(etiqueta.validade)}</b></div>
          {etiqueta.conservacao && <div className="et-conservacao">{conservacaoLabel(etiqueta.conservacao)}</div>}
          <div className="et-linha">Resp.: {etiqueta.responsavel || '—'}</div>
          <div className="et-codigo">
            {etiqueta.codigo}{etiqueta.lote ? ` · Lote ${etiqueta.lote}` : ''}
          </div>
        </div>
      ))}
    </div>
  );
}

// Renderiza as etiquetas e abre a impressão. A falha/cancelamento da
// impressão física não desfaz nada — produção e impressão são independentes.
export function imprimirEtiquetas(setEtiqueta, dados) {
  setEtiqueta(dados);
  setTimeout(() => window.print(), 150);
}
