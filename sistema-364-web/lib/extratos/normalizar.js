// A descrição que o banco manda vem suja de tudo que não ensina nada: data,
// número de documento, CNPJ, valor. O que sobra ("PIX ENVIADO BOI FORTE") é a
// chave do aprendizado em conciliacao_padroes — precisa ser igual em agosto e
// em setembro para o padrão pegar.
const LIMITE = 120;

export function normalizarDescricao(descricao) {
  return String(descricao ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // tira acento (marcas combinantes)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')                      // pontuação vira espaço
    .split(' ')
    .filter(t => t && !/^\d+$/.test(t))               // token só de dígito não ensina nada
    .join(' ')
    .trim()
    .slice(0, LIMITE);
}
