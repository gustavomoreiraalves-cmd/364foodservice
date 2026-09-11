'use client';
import { fmtDate } from '../lib/format';
import { medidasImpressao } from '../lib/etiquetas';

// Etiqueta de despacho: 101×50mm, coluna única, uma por caixa do romaneio de
// expedição — impressa em couché de caixa secundária, não no rolo BOPP de
// recebimento/produção (ver o comentário do modelo `despacho` em
// lib/etiquetas.js). Mesmo mecanismo de impressão de EtiquetaPrint.js:
// `window.print()` com `@page` em milímetro exato, montada/desmontada pelo
// helper `imprimirEtiquetaDespacho` no fim deste arquivo.
//
// Ao contrário de recebimento/produção-lote, não leva QR: o desenho de
// 20/08 ("3. Despacho") não pede rastreio por QR aqui — o elemento gráfico é
// o selo do Serviço de Inspeção Municipal (número e município do cadastro
// da empresa), desenhado em SVG por `seloSim` abaixo. A cópia da ASCII-art
// do spec reaproveitou o retângulo "▓QR▓" de recebimento/produção por
// engano nesse desenho — o texto da própria seção 3 só descreve o selo
// S.I.M., nunca um QR, e é o texto que vale.
//
// `etiqueta` (mesma ideia de `dados` em ModalEtiquetas/EtiquetaPrint — nunca
// redigitado, sempre o que a tela de expedição já leu do banco):
//   empresa, simNumero, simMunicipio, caixaNumero, caixaTotal,
//   romaneioNumero, conservacao, produtos: [{ codigo, nome, lote,
//   fabricacao, validade, quantidade }] (1 ou 2 linhas — regra de negócio
//   "no máximo 2 produtos distintos por caixa").
export default function EtiquetaDespachoPrint({ etiqueta }) {
  if (!etiqueta) return null;

  const m = medidasImpressao('despacho');
  const produtos = etiqueta.produtos || [];

  return (
    <div className="print-area etiqueta-despacho-print">
      <style>{`
        @media print {
          @page { size: ${m.paginaLargura_mm}mm ${m.paginaAltura_mm}mm; margin: 0; }
        }
        .etiqueta-despacho-print .etd-fileira {
          width: ${m.paginaLargura_mm}mm; height: ${m.etiquetaAltura_mm}mm; box-sizing: border-box;
          display: flex; justify-content: center;
        }
        .etiqueta-despacho-print .etiqueta {
          width: ${m.etiquetaLargura_mm}mm; height: ${m.etiquetaAltura_mm}mm;
          box-sizing: border-box; overflow: hidden;
          padding: 2mm 3mm; color: #000; background: #fff;
          font-family: Arial, Helvetica, sans-serif; line-height: 1.2;
          display: flex; flex-direction: column;
        }
        .etiqueta-despacho-print .etd-empresa { font-size: 9pt; font-weight: 700; text-transform: uppercase; }
        .etiqueta-despacho-print .etd-regra { border: none; border-top: 0.5pt solid #000; margin: 1mm 0; flex-shrink: 0; }
        /* A lista de produtos encolhe antes do rodapé (selo/caixa/romaneio),
           que é o dado de conferência física da caixa e não pode sumir —
           mesmo raciocínio do rodapé de vol. N/total em EtiquetaPrint. */
        .etiqueta-despacho-print .etd-itens { flex: 1; min-height: 0; overflow: hidden; }
        .etiqueta-despacho-print .etd-item + .etd-item { margin-top: 1mm; padding-top: 1mm; border-top: 0.5pt solid #000; }
        .etiqueta-despacho-print .etd-produto { font-size: 8.5pt; font-weight: 700; text-transform: uppercase; }
        .etiqueta-despacho-print .etd-codigo { font-family: 'Courier New', monospace; margin-right: 2mm; }
        .etiqueta-despacho-print .etd-linha { font-size: 7pt; margin-left: 2.5mm; }
        .etiqueta-despacho-print .etd-conservacao { font-size: 8pt; font-weight: 700; text-transform: uppercase; flex-shrink: 0; }
        .etiqueta-despacho-print .etd-rodape { flex-shrink: 0; margin-top: .8mm; display: flex; align-items: center; gap: 2mm; }
        .etiqueta-despacho-print .etd-selo { flex-shrink: 0; line-height: 0; }
        .etiqueta-despacho-print .etd-rodape-texto { flex: 1; display: flex; justify-content: space-between; gap: 2mm; font-size: 7pt; font-weight: 700; white-space: nowrap; }
      `}</style>
      <div className="etd-fileira">
        <div className="etiqueta">
          <div className="etd-empresa">{etiqueta.empresa}</div>
          <hr className="etd-regra" />
          <div className="etd-itens">
            {produtos.map((p, i) => (
              <div className="etd-item" key={i}>
                <div className="etd-produto">
                  {p.codigo ? <span className="etd-codigo">{p.codigo}</span> : null}{p.nome}
                </div>
                <div className="etd-linha">LOTE {p.lote || '—'}</div>
                <div className="etd-linha">FAB {fmtDate(p.fabricacao)}   VAL {fmtDate(p.validade)}    {p.quantidade} un</div>
              </div>
            ))}
          </div>
          <hr className="etd-regra" />
          {etiqueta.conservacao && <div className="etd-conservacao">{etiqueta.conservacao}</div>}
          <div className="etd-rodape">
            <div className="etd-selo" dangerouslySetInnerHTML={{ __html: seloSim(etiqueta.simNumero, etiqueta.simMunicipio) }} />
            <div className="etd-rodape-texto">
              <span>Caixa {etiqueta.caixaNumero}/{etiqueta.caixaTotal}</span>
              <span>Romaneio {etiqueta.romaneioNumero}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Selo do Serviço de Inspeção Municipal — dado do cadastro da empresa
// (`empresas.sim_numero`/`sim_municipio`), nunca texto fixo, desenhado igual
// ao carimbo redondo do rótulo de gráfica (spec de 20/08). Sem número
// cadastrado, não desenha nada: a etiqueta não pode inventar um selo que a
// empresa não tem.
function seloSim(numero, municipio) {
  if (!numero) return '';
  return `<svg width="30" height="30" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg">
    <circle cx="15" cy="15" r="14" fill="none" stroke="#000" stroke-width="1" />
    <circle cx="15" cy="15" r="11.5" fill="none" stroke="#000" stroke-width="0.5" />
    <text x="15" y="11" text-anchor="middle" font-family="Arial, sans-serif" font-size="4" font-weight="700">S.I.M.</text>
    <text x="15" y="17.5" text-anchor="middle" font-family="Arial, sans-serif" font-size="5" font-weight="700">${escapeXml(numero)}</text>
    ${municipio ? `<text x="15" y="23" text-anchor="middle" font-family="Arial, sans-serif" font-size="3">${escapeXml(String(municipio).toUpperCase())}</text>` : ''}
  </svg>`;
}

function escapeXml(valor) {
  return String(valor).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Mesmo padrão de `imprimirEtiquetas` (EtiquetaPrint.js): a impressão
// cancelada ou a falha da impressora nunca desfaz o registro em
// `etiqueta_impressoes` — quem chama já gravou lá ANTES de chamar isto. O
// listener de `afterprint` é registrado antes de `window.print()` porque em
// alguns navegadores essa chamada é bloqueante.
export function imprimirEtiquetaDespacho(setEtiqueta, dados) {
  setEtiqueta(dados);
  setTimeout(() => {
    window.addEventListener('afterprint', () => setEtiqueta(null), { once: true });
    window.print();
  }, 150);
}
