// Leitura paginada do PostgREST.
//
// O PostgREST devolve no máximo 1000 linhas por requisição e não avisa que
// truncou: a resposta é um 200 com um array curto. Toda leitura que possa
// passar de mil linhas precisa vir por aqui, senão o script trabalha em cima
// de um recorte silencioso e conclui coisas erradas sobre o que existe.
//
// Puro de propósito: recebe uma função que busca UMA página e não conhece
// supabase-js. É o que permite testar a paginação sem banco nenhum.

export const TAMANHO_PAGINA = 1000;

// Teto de segurança: 1000 páginas são 1 milhão de linhas, muito acima de
// qualquer leitura deste projeto. Existe para transformar um chamador que
// esqueceu o .range() — e por isso devolve sempre a mesma página cheia — num
// erro nomeado, em vez de um laço infinito que ninguém entende.
const MAXIMO_PAGINAS = 1000;

export async function lerPaginado(buscarPagina, tamanhoPagina = TAMANHO_PAGINA) {
  const linhas = [];
  for (let pagina = 0; ; pagina++) {
    if (pagina >= MAXIMO_PAGINAS) {
      throw new Error(
        `leitura paginada passou de ${MAXIMO_PAGINAS} páginas — o chamador provavelmente ignora o intervalo pedido`,
      );
    }
    const inicio = pagina * tamanhoPagina;
    const bloco = await buscarPagina(inicio, inicio + tamanhoPagina - 1);
    linhas.push(...bloco);
    // Bloco menor que o pedido: era a última página. Também cobre a tabela
    // vazia, que sai do laço na primeira volta.
    if (bloco.length < tamanhoPagina) return linhas;
  }
}
