// SQL das extrações do backup Firebird do PDV Consumer (CONSUMER.FDB).
//
// Cada consulta recebe dois parâmetros `?` — início (inclusivo) e fim
// (exclusivo) da janela, como `timestamp` em hora local de Porto Velho, que é
// exatamente como o Firebird guarda as datas (sem fuso). A conversão para o
// instante real (+4 h) acontece na normalização, não aqui.
//
// Os nomes de coluna em maiúsculas são os que o `node-firebird` devolve; os
// apelidos (`origem_descricao`, `qtd_itens`, ...) chegam também em maiúsculas.
// Tudo validado contra o banco restaurado (container `fb364`, backup de
// 23/08/2026): ver `docs/superpowers/plans/2026-08-23-importacao-pdv-backup.md`.

// Pedidos da janela, inclusive os excluídos (`DATADELETE`), porque é assim que
// uma exclusão feita no PDV chega ao nosso banco.
//
// - `TAG` é o discriminador de tipo do PDV: `M-*` são mesa/comanda, `D` é
//   balcão/delivery. `PEDIDOMESAS` está vazia e `NUMEROMESA` é sempre nulo
//   nesta base, então a mesa NÃO pode ser derivada delas.
// - `QTD_ITENS` soma a quantidade só dos itens pai vivos, que é o número que o
//   painel Connect mostra (pedido 74941 → 6).
// - Cliente: contato do pedido e, na falta dele, o nome digitado na comanda.
export const SQL_PEDIDOS = `
  select p.codigo, p.dataabertura, p.datafechamento, p.datadelete, p.tag,
         p.valortotal, p.valortotalitens, p.totaldesconto, p.totalservico,
         p.totalacrescimo, p.valorentrega, p.numero, p.quantidadepessoas,
         p.subtotalpago,
         po.descricao as origem_descricao,
         col.nome as colaborador,
         coalesce(cli.nome, p.nome) as cliente,
         (select coalesce(sum(ii.quantidade), 0) from itenspedido ii
           where ii.codigopedido = p.codigo
             and ii.datadelete is null and ii.codigopai is null) as qtd_itens,
         (case when exists(select 1 from delivery d where d.codigopedido = p.codigo)
               then 1 else 0 end) as tem_delivery
    from pedidos p
    left join pedidoorigem po on po.codigo = p.codigopedidoorigem
    left join contatos col on col.codigo = p.codigocolaborador
    left join contatos cli on cli.codigo = p.codigocontatocliente
   where p.dataabertura >= ? and p.dataabertura < ?
   order by p.codigo`;

// Itens vivos dos pedidos da janela. `VALORITEM` é o valor da linha como o
// painel mostra (quantidade × unitário); `VALORTOTAL` do pai já embute os
// filhos, por isso não serve como valor da linha.
export const SQL_ITENS = `
  select i.codigo, i.codigopedido, i.codigopai, i.nomeproduto, i.detalhes,
         i.quantidade, i.valorunitario, i.valoritem, i.valortotal,
         i.precocusto, i.codigoprodutodetalhe
    from itenspedido i
    join pedidos p on p.codigo = i.codigopedido
   where p.dataabertura >= ? and p.dataabertura < ?
     and i.datadelete is null
   order by i.codigopedido, i.codigo`;

const PAGAMENTOS_SELECT = `
  select pg.codigo, pg.codigopedido, pg.codigocaixa, pg.valor, pg.datapagamento,
         pg.datacredito, pg.percentualtaxa, pg.nroparcela, pg.observacao,
         fp.descricao as forma,
         oc.nome as operadora,
         cc.descricao as categoria
    from pagamentos pg
    join formaspagamento fp on fp.codigo = pg.codigoformapagamento
    left join operadoracartao oc on oc.codigo = pg.operadoracartao
    left join categoriacontas cc on cc.codigo = pg.codigocategoriacontas
    left join pedidos p on p.codigo = pg.codigopedido`;

// Pagamentos dos pedidos da janela (viram `pdv_pagamentos`).
//
// `PAGAMENTOS.DATADELETE` é obrigatório no filtro: a view `VWPAGAMENTOS` do
// PDV não o aplica e traria pagamento estornado. Conferido no pedido 74941,
// que tem 4 linhas em `PAGAMENTOS` e 3 pagamentos de R$ 53,57 = R$ 160,71.
export const SQL_PAGAMENTOS = `${PAGAMENTOS_SELECT}
   where p.dataabertura >= ? and p.dataabertura < ?
     and pg.datadelete is null
   order by pg.codigopedido, pg.codigo`;

// Recebimentos da janela por data de pagamento (viram `pdv_recebimentos`).
// Pagamento avulso (sem pedido) entra; pagamento de pedido excluído, não —
// mesma regra da `VWPAGAMENTOS`.
export const SQL_RECEBIMENTOS = `${PAGAMENTOS_SELECT}
   where pg.datapagamento >= ? and pg.datapagamento < ?
     and pg.datadelete is null
     and (p.codigo is null or p.datadelete is null)
   order by pg.codigo`;

// Caixas abertos na janela. `CAIXA` não tem status nem nome de usuário: o
// status sai de `DATAFECHAMENTO` e o nome vem de `USUARIOS` → `CONTATOS`.
export const SQL_CAIXAS = `
  select c.codigo, c.dataabertura, c.datafechamento, c.saldoinicial,
         c.saldofinal, c.saldofinalinformado,
         ct.nome as usuario,
         c.observacao
    from caixa c
    left join usuarios u on u.codigo = c.codigousuario
    left join contatos ct on ct.codigo = u.codigocontato
   where c.dataabertura >= ? and c.dataabertura < ?
   order by c.codigo`;

// Operações dos caixas abertos na janela.
//
// `TIPO`: A = suprimento (entrada), S = sangria e D = despesa (saídas),
// E = estorno de pagamento. O estorno também grava em `VALORSAIDA`, mas o
// pagamento correspondente já saiu da conta por `DATADELETE` — contá-lo
// duplicaria a baixa (ver `movimentosDeCaixa` em normaliza.js).
export const SQL_CAIXA_OPERACOES = `
  select co.codigo, co.codigocaixa, co.tipo, co.valorentrada, co.valorsaida,
         co.dataoperacao, co.observacao,
         fp.descricao as forma
    from caixaoperacao co
    join caixa c on c.codigo = co.codigocaixa
    left join formaspagamento fp on fp.codigo = co.codigoformapagamento
   where c.dataabertura >= ? and c.dataabertura < ?
     and co.datadelete is null
   order by co.codigocaixa, co.codigo`;

// Itens vendidos por dia × produto.
//
// A agregação fica no SQL, não em JS: `DATAABERTURA` já é hora local, então
// `cast(... as date)` é o dia local sem nenhuma conversão, e a carga histórica
// (75 mil pedidos desde 2022) não precisa trafegar linha a linha. O que sobra
// para o JS é só o que depende do conjunto do dia — lucro, margem,
// participação e curva ABC (ver `itensDiaFb`).
//
// Categoria: `PRODUTOS.CODIGOETIQUETA` → `ETIQUETAS.DESCRICAO` ("Churrasco",
// "Acompanhamentos"), que é a mesma categoria que o painel Connect mostra.
export const SQL_ITENS_DIA = `
  select cast(p.dataabertura as date) as dia,
         pd.codigoproduto as codigo_produto,
         i.codigoprodutodetalhe as codigo_detalhe,
         min(i.nomeproduto) as nome,
         min(e.descricao) as categoria,
         sum(i.quantidade) as quantidade,
         sum(i.valoritem) as valor_vendido,
         sum(i.precocusto * i.quantidade) as custo,
         min(pd.precovenda) as preco_venda,
         min(pd.precocusto) as preco_custo
    from itenspedido i
    join pedidos p on p.codigo = i.codigopedido
    left join produtodetalhe pd on pd.codigo = i.codigoprodutodetalhe
    left join produtos pr on pr.codigo = pd.codigoproduto
    left join etiquetas e on e.codigo = pr.codigoetiqueta
   where p.dataabertura >= ? and p.dataabertura < ?
     and p.datadelete is null
     and i.datadelete is null
   group by cast(p.dataabertura as date), pd.codigoproduto, i.codigoprodutodetalhe
   order by cast(p.dataabertura as date), sum(i.valoritem) desc`;
