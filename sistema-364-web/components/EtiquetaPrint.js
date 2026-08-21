'use client';
import { fmtDateTime, conservacaoLabel } from '../lib/producao';

// Etiqueta "Validade Cozinha" 50×30 mm, impressa em rolo de 108 mm com duas
// colunas. Os dados vêm SEMPRE da produção (completa ou interna) — nunca são
// redigitados. Cada página de impressão corresponde a uma LINHA do rolo (duas
// etiquetas lado a lado); `copias` controla quantas etiquetas saem no total.
//
// A geometria do rolo está toda nas constantes abaixo. Se trocar de rolo ou de
// impressora, ajuste só elas — o resto do layout se recalcula sozinho.
const ROLO_MM = 108;        // largura total do rolo
const ETIQUETA_W_MM = 50;   // largura de cada etiqueta
const ETIQUETA_H_MM = 30;   // altura de cada etiqueta
const GAP_COLUNA_MM = 2.5;  // espaço horizontal entre as duas colunas
const GAP_LINHA_MM = 2;     // espaço vertical entre linhas do rolo (medido no
                            // rolo em uso). Errar esse valor acumula
                            // desalinhamento a cada linha impressa.
const COLUNAS = 2;

// Sobra da largura, dividida igualmente entre as duas bordas (rolo centralizado).
const MARGEM_LATERAL_MM =
  (ROLO_MM - (ETIQUETA_W_MM * COLUNAS + GAP_COLUNA_MM * (COLUNAS - 1))) / 2;
const PAGINA_H_MM = ETIQUETA_H_MM + GAP_LINHA_MM;

// etiqueta = {
//   empresa, unidade, produto, produtoCodigo, codigo (PRD-INT-000482 ou lote),
//   producao (iso), validade (iso), conservacao ('resfriado'...), responsavel,
//   copias (int), lote (opcional, produção completa)
// }
export default function EtiquetaPrint({ etiqueta }) {
  if (!etiqueta) return null;
  const copias = Math.max(1, Number(etiqueta.copias) || 1);

  // Agrupa as etiquetas em linhas do rolo. Uma linha incompleta (número ímpar
  // de cópias) sai com a coluna da direita em branco, sem desalinhar as demais.
  const linhas = [];
  for (let i = 0; i < copias; i += COLUNAS) {
    linhas.push(Array.from({ length: Math.min(COLUNAS, copias - i) }, (_, j) => i + j));
  }

  return (
    <div className="print-area etiquetas-print">
      <style>{`
        @media print {
          @page { size: ${ROLO_MM}mm ${PAGINA_H_MM}mm; margin: 0; }
          .etiquetas-print .et-fileira { page-break-after: always; }
          .etiquetas-print .et-fileira:last-child { page-break-after: auto; }
        }
        .etiquetas-print .et-fileira {
          width: ${ROLO_MM}mm; height: ${ETIQUETA_H_MM}mm; box-sizing: border-box;
          padding: 0 ${MARGEM_LATERAL_MM}mm; display: flex; gap: ${GAP_COLUNA_MM}mm;
        }
        .etiquetas-print .etiqueta {
          width: ${ETIQUETA_W_MM}mm; height: ${ETIQUETA_H_MM}mm;
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
      `}</style>
      {linhas.map((linha, i) => (
        <div className="et-fileira" key={i}>
          {linha.map(n => (
            <div className="etiqueta" key={n}>
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
