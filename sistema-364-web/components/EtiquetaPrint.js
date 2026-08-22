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
  // vol. N/total: o denominador é SEMPRE o total de volumes do item
  // (`volumesTotal`), nunca `copias` — `copias` é só quantas etiquetas saem
  // desta impressão, e pode ser 1 numa reimpressão avulsa (etiqueta perdida
  // da caixa 7 de 20). Sem essa separação, reimprimir 1 cópia da caixa 7
  // gravaria "vol. 1/1" numa caixa que é a 7 de 20. `volumeInicial` desloca
  // a numeração para começar no volume perdido, em vez de sempre em 1.
  const volumesTotal = Number(etiqueta.volumesTotal) || copias;
  const volumeInicial = Math.max(1, Number(etiqueta.volumeInicial) || 1);

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
        .etiquetas-print .et-receb-texto { flex: 1; min-width: 0; overflow: hidden; display: flex; flex-direction: column; }
        /* dentro do recebimento, cada linha de texto pode ser cortada — o que
           não pode sumir é o rodapé com a numeração de volume (ver .et-rodape).
           min-height:0 é necessário porque filhos flex em coluna não encolhem
           abaixo da própria altura de conteúdo por padrão; sem isso, o
           overflow:hidden do pai (.et-receb-texto) corta o rodapé em vez do
           texto, que é o oposto do que queremos. */
        .etiquetas-print .et-receb-texto .et-linha { overflow: hidden; min-height: 0; }
        .etiquetas-print .et-receb-qr { width: ${m.qrTamanho_mm || 0}mm; display: flex; align-items: center; justify-content: center; }
        .etiquetas-print .et-receb-qr svg { display: block; }
        .etiquetas-print .et-lote { font-family: 'Courier New', monospace; font-size: 8pt; font-weight: 700; overflow: hidden; min-height: 0; }
        .etiquetas-print .et-mp { font-size: 8pt; font-weight: 700; text-transform: uppercase; margin: .3mm 0; overflow: hidden; min-height: 0; }
        .etiquetas-print .et-rodape { margin-top: auto; flex-shrink: 0; display: flex; justify-content: space-between; gap: 1mm; font-size: 6.5pt; }
        .etiquetas-print .et-vol { font-weight: 700; white-space: nowrap; }
      `}</style>
      {linhas.map((linha, i) => (
        <div className="et-fileira" key={i}>
          {linha.map(n => (
            <div className="etiqueta" key={n}>
              {modeloId === 'recebimento'
                ? <Recebimento etiqueta={etiqueta} indice={n} volumesTotal={volumesTotal} volumeInicial={volumeInicial} />
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
// O rodapé (NF + "vol. N/total") nunca pode sumir — é a numeração de volume,
// dado operacional. Por isso ele tem flex-shrink:0 e todo o texto acima dele,
// dentro de .et-receb-texto, tem overflow:hidden: quem cede espaço quando o
// conteúdo não cabe nos 30mm de altura é o texto (lote/matéria-prima/receb./
// forn.), nunca o rodapé.
//
// `volumesTotal` é sempre o total de volumes do ITEM, nunca a quantidade
// impressa nesta chamada — e `volumeInicial` desloca a numeração para uma
// reimpressão avulsa começar no volume certo (ex.: reimprimir só a caixa 7
// de 20 imprime "vol. 7/20", não "vol. 1/1").
function Recebimento({ etiqueta, indice, volumesTotal, volumeInicial }) {
  return (
    <div className="et-receb">
      <div className="et-receb-texto">
        <div className="et-lote">LOTE {etiqueta.lote || '—'}</div>
        <div className="et-mp">{etiqueta.materiaPrima}</div>
        <div className="et-linha">Receb. {fmtDate(etiqueta.recebidoEm)}</div>
        <div className="et-linha">Forn. {etiqueta.fornecedor || '—'}</div>
        <div className="et-rodape">
          <span>NF {etiqueta.notaFiscal || '—'}</span>
          <span className="et-vol">vol. {volumeInicial + indice}/{volumesTotal}</span>
        </div>
      </div>
      <div className="et-receb-qr" dangerouslySetInnerHTML={{ __html: etiqueta.qrSvg || '' }} />
    </div>
  );
}

// Renderiza as etiquetas e abre a impressão. A falha ou o cancelamento da
// impressão física não desfaz nada — o registro e a impressão são independentes.
//
// O estado é zerado quando a caixa de diálogo de impressão fecha (impresso ou
// cancelado): enquanto `etiqueta` continuar preenchido, o `@page` de
// 108×32mm deste componente fica montado e vale para QUALQUER impressão
// seguinte na mesma tela — inclusive a ficha A4 de FichaPrint, que não
// declara `@page` próprio. O listener é registrado ANTES de `window.print()`
// porque em alguns navegadores essa chamada é bloqueante: se o listener
// entrasse depois, o evento já teria disparado.
export function imprimirEtiquetas(setEtiqueta, dados) {
  setEtiqueta(dados);
  setTimeout(() => {
    window.addEventListener('afterprint', () => setEtiqueta(null), { once: true });
    window.print();
  }, 150);
}
