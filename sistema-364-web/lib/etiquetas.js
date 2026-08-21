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
  },
};

export const URL_RASTREIO_PADRAO = 'https://sistema-364.vercel.app';

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
export function urlRastreio(lote, base = URL_RASTREIO_PADRAO) {
  return `${String(base).replace(/\/+$/, '')}/rastreio/${encodeURIComponent(lote)}`;
}
