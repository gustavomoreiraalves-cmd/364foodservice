// Geração do QR das etiquetas. Único ponto do sistema que fala com o pacote
// `qrcode`.
//
// Devolve SVG (não PNG) porque a etiqueta é impressa em 203 dpi numa área de
// poucos milímetros: vetor sai nítido em qualquer resolução, e não depende de
// canvas nem de rede. O QR é resolvido ANTES da impressão — `window.print()` é
// síncrono e não espera promessa nenhuma.
import QRCode from 'qrcode';

export async function qrSvg(texto, tamanhoMm = 12) {
  if (!texto || !String(texto).trim()) {
    throw new Error('QR sem conteúdo: texto vazio.');
  }
  const svg = await QRCode.toString(String(texto), {
    type: 'svg',
    // Sem quiet zone: a margem padrão de 4 módulos comeria metade da área útil
    // numa etiqueta de 50×30 mm. O espaço em branco ao redor vem do layout.
    margin: 0,
    // M tolera ~15% de dano — suficiente para etiqueta em câmara fria, sem
    // inflar a matriz como o nível H faria.
    errorCorrectionLevel: 'M',
  });
  // O pacote não emite width/height quando margin é 0 — só viewBox. Insere os
  // dois atributos logo depois de `<svg` em vez de tentar substituir algo que
  // não existe.
  return svg
    .replace(/^<svg /, `<svg width="${tamanhoMm}mm" height="${tamanhoMm}mm" `)
    .trim();
}
