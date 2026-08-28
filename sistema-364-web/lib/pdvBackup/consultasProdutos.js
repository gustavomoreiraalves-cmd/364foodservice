// SQL da extração de cadastro do backup Firebird do PDV Consumer.
//
// Diferente de consultas.js, que extrai movimento numa janela de datas, aqui
// é cadastro: sem parâmetro, lê tudo de uma vez.
//
// A tributação NÃO vem das colunas de PRODUTOS — só 12 das 699 linhas têm
// CFOP lá. Ela vive em CONFIGICMS, uma linha por produto (conferido: nenhum
// produto tem duas). ORIGEMMERCADORIA é o caso mais gritante: nula em 687
// linhas de PRODUTOS e preenchida em 526 de 527 de CONFIGICMS.
//
// PRODUTOTIPO 1 é "Produto" e 2 é "Insumo" — a divisão que separa `produtos`
// de `materias_primas` no 364 OS. Complemento (3), Combo (4), Produto por
// Tamanho (5) e Serviço (6) ficam de fora: não são item de estoque nem de
// ficha técnica.
//
// Preço e custo vêm de PRODUTODETALHE por subconsulta, e não por join, porque
// um produto tem N detalhes (tamanhos) e o join multiplicaria a linha do
// produto por eles.
export const SQL_PRODUTOS = `
  select p.codigo, p.nome, p.descontinuado, p.codigoprodutotipo,
         p.ncm, p.cest, p.aliquotatransparencia,
         u.sigla as unidade,
         e.descricao as categoria,
         c.cfop, c.situacaotributaria, c.origemmercadoria,
         (select min(d.precovenda) from produtodetalhe d
           where d.codigoproduto = p.codigo and d.datadelete is null) as precovenda,
         (select min(d.precocusto) from produtodetalhe d
           where d.codigoproduto = p.codigo and d.datadelete is null) as precocusto
    from produtos p
    left join unidadecomercializacao u on u.codigo = p.codigounidadecomercial
    left join etiquetas e on e.codigo = p.codigoetiqueta
    left join configicms c on c.codigoproduto = p.codigo
   where p.codigoprodutotipo in (1, 2)
   order by p.codigo`;
