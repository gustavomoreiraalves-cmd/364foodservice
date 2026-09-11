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
// Como recebimento/produção-lote, leva QR — mas UM POR LINHA DE PRODUTO, não
// um só pro rótulo inteiro: uma caixa pode ter até 2 produtos/lotes
// distintos (regra de negócio 6), cada um com seu próprio lote a rastrear, e
// o desenho de 20/08 ("3. Despacho") não define o que um único QR
// representaria numa caixa mista. `qrSvg` chega PRONTO em cada item de
// `etiqueta.produtos` (gerado por quem chama, mesmo contrato de `qrSvg` em
// EtiquetaPrint.js) — `null`/ausente pra item sem lote (produto não
// rastreado), que não tem URL de rastreio nenhuma pra codificar.
//
// `etiqueta` (mesma ideia de `dados` em ModalEtiquetas/EtiquetaPrint — nunca
// redigitado, sempre o que a tela de expedição já leu do banco):
//   empresa, simNumero, simMunicipio, caixaNumero, caixaTotal,
//   romaneioNumero, conservacao, produtos: [{ codigo, nome, lote,
//   fabricacao, validade, quantidade, qrSvg }] (1 ou 2 linhas — regra de
//   negócio "no máximo 2 produtos distintos por caixa").
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
        /* Margens enxutas de propósito: com 2 produtos, cada um com seu
           próprio QR de 12mm (lib/etiquetas.js), a soma do texto fixo
           (empresa/regras/conservação/rodapé) mais 2x12mm de QR já usa quase
           toda a altura útil de 46mm (50mm menos 2mm de padding em cima e
           embaixo) — sobra pouca folga pro texto de cada item. Ver o
           comentário de qr_mm em lib/etiquetas.js sobre confirmar isso na
           impressora física antes de rodar em produção.
        */
        .etiqueta-despacho-print .etd-regra { border: none; border-top: 0.5pt solid #000; margin: .6mm 0; flex-shrink: 0; }
        /* A lista de produtos encolhe antes do rodapé (selo/caixa/romaneio),
           que é o dado de conferência física da caixa e não pode sumir —
           mesmo raciocínio do rodapé de vol. N/total em EtiquetaPrint. */
        .etiqueta-despacho-print .etd-itens { flex: 1; min-height: 0; overflow: hidden; }
        .etiqueta-despacho-print .etd-item {
          display: flex; align-items: center; gap: 2mm;
        }
        .etiqueta-despacho-print .etd-item + .etd-item { margin-top: .6mm; padding-top: .6mm; border-top: 0.5pt solid #000; }
        /* O texto encolhe antes do QR — um QR cortado não escaneia, uma
           palavra cortada ainda se lê (mesmo raciocínio de .et-prod-texto
           em EtiquetaPrint.js). */
        .etiqueta-despacho-print .etd-item-texto { flex: 1; min-width: 0; overflow: hidden; }
        .etiqueta-despacho-print .etd-item-qr { flex-shrink: 0; line-height: 0; }
        .etiqueta-despacho-print .etd-item-qr svg { display: block; }
        .etiqueta-despacho-print .etd-produto { font-size: 8.5pt; font-weight: 700; text-transform: uppercase; }
        .etiqueta-despacho-print .etd-codigo { font-family: 'Courier New', monospace; margin-right: 2mm; }
        .etiqueta-despacho-print .etd-linha { font-size: 7pt; margin-left: 2.5mm; }
        .etiqueta-despacho-print .etd-conservacao { font-size: 8pt; font-weight: 700; text-transform: uppercase; flex-shrink: 0; }
        .etiqueta-despacho-print .etd-rodape { flex-shrink: 0; margin-top: .4mm; display: flex; align-items: center; gap: 2mm; }
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
                <div className="etd-item-texto">
                  <div className="etd-produto">
                    {p.codigo ? <span className="etd-codigo">{p.codigo}</span> : null}{p.nome}
                  </div>
                  <div className="etd-linha">LOTE {p.lote || '—'}</div>
                  <div className="etd-linha">FAB {fmtDate(p.fabricacao)}   VAL {fmtDate(p.validade)}    {p.quantidade} un</div>
                </div>
                {/* Sem lote (produto não rastreado), não há URL de rastreio
                    pra codificar — a linha fica sem QR, não com um QR vazio. */}
                {p.qrSvg && <div className="etd-item-qr" dangerouslySetInnerHTML={{ __html: p.qrSvg }} />}
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
  // width/height em mm, mesma convenção de `qrSvg` (lib/qr.js) — o resto do
  // rótulo inteiro é dimensionado em milímetro exato pro `@page`, então um
  // elemento em pixel sem unidade renderizaria num tamanho que não bate com
  // o resto do layout.
  return `<svg width="9mm" height="9mm" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg">
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
