// A regra de "atualiza ou não atualiza", isolada num arquivo só.
//
// Existe separada porque é a única parte da importação que pode destruir
// trabalho humano, e porque a decisão é por campo, não por linha. Fica pura
// para poder ser testada sem simular Postgres nenhum.
//
// A pergunta que ela responde: o valor que está no 364 OS ainda é o que a
// importação passada gravou? Se sim, o PDV pode mandar nele. Se não, alguém
// mexeu, e a importação passa longe.

export const CAMPOS_FISCAIS = [
  'ncm', 'cest', 'origem_mercadoria', 'sujeito_st', 'aliquota_transparencia',
  'grupo_tributario_id', 'unidade_tributavel', 'fator_conversao_tributavel',
];

// numeric volta do supabase-js como string ('49.90') e do Firebird como número
// (49.9). Comparar cru faria todo preço virar conflito na segunda rodada, e a
// importação pararia de atualizar exatamente o que mais muda.
export function mesmoValor(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && String(a).trim() !== '' && String(b).trim() !== '') {
    return na === nb;
  }
  return String(a).trim() === String(b).trim();
}

export function mesclar({ novo, atual, retrato, revisado }) {
  if (!atual) return { valores: { ...novo }, conflitos: [], congelados: [] };

  const valores = {};
  const conflitos = [];
  const congelados = [];

  for (const [campo, valorNovo] of Object.entries(novo)) {
    if (revisado && CAMPOS_FISCAIS.includes(campo)) {
      congelados.push(campo);
      continue;
    }
    const valorAtual = atual[campo];
    // Sem retrato não há como saber se o valor atual é da importação ou de
    // uma pessoa. O desempate é a favor da pessoa.
    const daImportacao = retrato ? mesmoValor(valorAtual, retrato[campo]) : false;
    if (!daImportacao) {
      if (!mesmoValor(valorAtual, valorNovo)) {
        conflitos.push({ campo, atual: valorAtual, novo: valorNovo });
      }
      continue;
    }
    if (!mesmoValor(valorAtual, valorNovo)) valores[campo] = valorNovo;
  }

  return { valores, conflitos, congelados };
}
