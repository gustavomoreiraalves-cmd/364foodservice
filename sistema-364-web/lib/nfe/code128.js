// Code 128, subconjunto C — o que o DANFE exige para a chave de acesso.
//
// Só o subconjunto C, de propósito: a chave é sempre 44 dígitos, numérica e de
// comprimento par, que é exatamente o caso em que o C codifica um par de
// dígitos por símbolo. Uma biblioteca genérica traria as três tabelas, os
// caracteres de troca entre elas e dezenas de simbologias que este projeto
// nunca vai usar — e viraria dependência a manter.
//
// Erro aqui é silencioso: um código de barras errado imprime bonito e só falha
// no leitor da fiscalização, com a mercadoria já parada. Por isso os testes
// conferem o dígito verificador à mão e a contagem de módulos de todos os 107
// padrões contra a especificação.

// Larguras dos 107 símbolos (0..106): cada string são as larguras de barra e
// espaço alternados, começando por barra. Todos somam 11 módulos, menos o
// Stop (106), que soma 13.
export const PADROES_CODE128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const START_C = 105;
const STOP = 106;

// Devolve as larguras dos módulos, alternando barra e espaço, começando por
// barra. Quem desenha (SVG, canvas, o que for) não precisa saber de Code 128.
export function code128c(digitos) {
  const s = String(digitos ?? '');
  if (!s) throw new Error('Código de barras: a sequência está vazia.');
  if (!/^\d+$/.test(s)) throw new Error('Código de barras: o Code 128-C aceita só sequência numérica.');
  if (s.length % 2 !== 0) throw new Error('Código de barras: o Code 128-C exige comprimento par.');

  const valores = [];
  for (let i = 0; i < s.length; i += 2) valores.push(Number(s.slice(i, i + 2)));

  // O verificador é a soma ponderada módulo 103. O Start entra como valor
  // inicial — é o peso 1 dele, implícito.
  let soma = START_C;
  valores.forEach((v, i) => { soma += v * (i + 1); });
  const verificador = soma % 103;

  return [START_C, ...valores, verificador, STOP]
    .flatMap(v => PADROES_CODE128[v].split('').map(Number));
}
