// Modelos de etiqueta e a geometria do rolo.
//
// A impressora (Postek EM210) enxerga uma PÁGINA por linha do rolo: com rolo de
// duas colunas, cada página carrega duas etiquetas lado a lado. Por isso a
// paginação é do domínio, não da folha de estilo — e por isso ela é testada.
//
// Trocar de rolo ou de impressora se resolve mexendo só aqui.

export const MODELOS = {
  'validade-cozinha': {
    id: 'validade-cozinha',
    nome: 'Validade cozinha',
    largura_mm: 50, altura_mm: 30, colunas: 2,
    rolo_mm: 108, gap_coluna_mm: 2.5, gap_linha_mm: 2,
  },
  recebimento: {
    id: 'recebimento',
    nome: 'Recebimento',
    largura_mm: 50, altura_mm: 30, colunas: 2,
    rolo_mm: 108, gap_coluna_mm: 2.5, gap_linha_mm: 2,
    // URL com prefixo de empresa (/rastreio/<prefixo>/<lote>) gera matriz
    // 33×33 no nível de correção M. Em 16 mm dá 0,4848 mm/módulo — 3,88
    // pontos a 203 dpi, acima do mínimo prático de 3 e perto de um número
    // inteiro de pontos (arredonda para 4 na impressora). Cabe nos 46 mm
    // úteis da etiqueta (50 mm − 2×2 mm de padding) ao lado dos 28,5 mm que
    // sobram para o texto.
    qr_mm: 16,
  },
  'producao-lote': {
    id: 'producao-lote',
    nome: 'Produção (lote)',
    largura_mm: 50, altura_mm: 30, colunas: 2,
    rolo_mm: 108, gap_coluna_mm: 2.5, gap_linha_mm: 2,
    // Mesma etiqueta física e mesmo rolo do modelo `recebimento` — uma por
    // unidade embalada, com QR do rastreio do lote ao lado do texto. A conta
    // de 16 mm é a mesma feita ali em cima: cabe nos 46 mm úteis (50 mm −
    // 2×2 mm de padding) ao lado do texto de produto/lote/fabricação/validade.
    qr_mm: 16,
  },
};

// A produção roda em https://364foodservice.vercel.app (projeto Vercel
// `364foodservice`, org `364-steakhouse`) — não em "sistema-364", que nunca
// existiu. O QR é impresso uma vez e cola na caixa por meses, então o valor
// aqui precisa ser o host real, para sempre.
export const URL_RASTREIO_PADRAO = 'https://364foodservice.vercel.app';

export function modelo(id) {
  const m = MODELOS[id];
  if (!m) throw new Error(`Modelo de etiqueta desconhecido: ${id}`);
  return m;
}

export function medidasImpressao(id) {
  const m = modelo(id);
  const ocupado = m.largura_mm * m.colunas + m.gap_coluna_mm * (m.colunas - 1);
  return {
    paginaLargura_mm: m.rolo_mm,
    paginaAltura_mm: m.altura_mm + m.gap_linha_mm,
    // Sobra da largura dividida entre as duas bordas: o rolo é centralizado.
    margemLateral_mm: (m.rolo_mm - ocupado) / 2,
    etiquetaLargura_mm: m.largura_mm,
    etiquetaAltura_mm: m.altura_mm,
    gapColuna_mm: m.gap_coluna_mm,
    colunas: m.colunas,
    // Só o modelo `recebimento` tem QR; nos demais fica `undefined` — quem
    // usa esse campo (EtiquetaPrint, app/recebimentos) só chama para esse
    // modelo, então não precisa de um valor de reserva aqui.
    qrTamanho_mm: m.qr_mm,
  };
}

// Agrupa N etiquetas em linhas do rolo. A última linha sai incompleta quando a
// contagem não fecha as colunas — comportamento esperado, não erro.
export function paginarEtiquetas(total, colunas) {
  const n = Math.floor(Number(total) || 0);
  const c = Math.max(1, Math.floor(Number(colunas) || 1));
  const linhas = [];
  for (let i = 0; i < n; i += c) {
    linhas.push(Array.from({ length: Math.min(c, n - i) }, (_, j) => i + j));
  }
  return linhas;
}

// Conteúdo do QR: sempre a URL pública do lote. A página só existe a partir da
// Fase 5; a etiqueta é impressa uma vez e vive meses, então o conteúdo já nasce
// definitivo.
//
// O lote (`LT-AAMMDD-###`) é numerado por empresa, sem garantia de unicidade
// global — a mesma sequência pode existir ao mesmo tempo na Food Service e no
// Steakhouse. Por isso o caminho leva o prefixo da empresa
// (`empresas.prefixo_codigo`, ex. "0364", "STK") antes do lote: sem ele, a
// página pública da Fase 5 receberia um lote ambíguo. Chamador sem prefixo
// cadastrado NÃO deve chamar esta função — precisa barrar antes, na tela.
export function urlRastreio(prefixo, lote, base = URL_RASTREIO_PADRAO) {
  return `${String(base).replace(/\/+$/, '')}/rastreio/${encodeURIComponent(prefixo)}/${encodeURIComponent(lote)}`;
}
