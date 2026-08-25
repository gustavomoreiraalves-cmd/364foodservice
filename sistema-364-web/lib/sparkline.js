// Cálculo do minigráfico que acompanha um KPI. Fica separado do componente
// para poder ser testado sem renderizar nada.

function apenasNumeros(serie) {
  // `Number(null)` é 0, e num KPI "sem dado" não é "zero" — um dia sem venda
  // registrada desenharia um vale que não aconteceu. Por isso null, undefined e
  // string vazia caem fora antes da conversão.
  return (serie || [])
    .filter(v => v !== null && v !== undefined && v !== '')
    .map(Number)
    .filter(Number.isFinite);
}

/**
 * Converte a série em coordenadas dentro de uma caixa, com o menor valor no pé
 * e o maior no topo. Série constante fica na linha do meio — encostá-la na
 * borda faria "sem variação" parecer "no fundo do poço".
 */
export function pontosDaSerie(serie, { largura = 80, altura = 22 } = {}) {
  const valores = apenasNumeros(serie);
  if (!valores.length) return [];
  if (valores.length === 1) return [{ x: 0, y: altura / 2 }];

  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const amplitude = max - min;
  const passo = largura / (valores.length - 1);

  return valores.map((v, i) => ({
    x: Math.round(i * passo * 100) / 100,
    y: amplitude === 0
      ? altura / 2
      : Math.round((altura - ((v - min) / amplitude) * altura) * 100) / 100,
  }));
}

// Percentual entre o primeiro e o último ponto. Base zero não tem percentual —
// devolver Infinity aqui viraria "∞%" na tela.
export function variacao(serie) {
  const valores = apenasNumeros(serie);
  if (valores.length < 2) return null;
  const inicio = valores[0];
  const fim = valores[valores.length - 1];
  if (inicio === 0) return null;
  return Math.round(((fim - inicio) / Math.abs(inicio)) * 1000) / 10;
}
