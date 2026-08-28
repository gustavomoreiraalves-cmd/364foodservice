# Fixtures do backup Firebird do PDV

Extraídas em 23/08/2026 do `CONSUMER.FDB` da 364 Steakhouse restaurado num
container Firebird 5 (`gbak -c` do backup diário do Drive), só com `SELECT`.
As colunas e os apelidos são exatamente os de `lib/pdvBackup/consultas.js`, em
maiúsculas, como o `node-firebird` devolve.

Janela de referência: **2026-08-21 a 2026-08-22** (hora local de Porto Velho).

## Formatos

- **Timestamps** são strings `AAAA-MM-DD HH:MM:SS.mmm` em hora local de Porto
  Velho, sem fuso — igual ao que está gravado no Firebird. O instante real é
  esse valor + 4 h (`dataFirebird`). O driver devolve `Date` em vez de string;
  `dataFirebird` aceita os dois, e há teste para as duas formas.
- **Numéricos** vêm como número JS; nulo é `null`.

## Anonimização

- `PEDIDOS.CLIENTE`: nomes reais trocados por `Cliente Um`, `Cliente Dois`, …
- `PEDIDOS.COLABORADOR`: trocados por `Colaboradora Teste`, `Colaborador
  Teste`, `Atendente Teste`.
- Telefones (a operadora do "Pix Manual" é o telefone da chave): trocados por
  `(69)90000-0000`.

Nada além disso foi editado — valores, datas, códigos e textos de produto,
observação e categoria são os do banco.

## O que cada arquivo cobre

| Arquivo | Linhas | Casos |
|---|---|---|
| `pedidos.json` | 4 | 75088 mesa finalizada (`TAG` `M-P`, Comanda Mobile); 75089 delivery MenuDino com entrega de R$ 9,00; 75114 balcão (`TAG` `D` sem linha em `DELIVERY`); 75138 com `DATADELETE` preenchido (exclusão real, não sintética) |
| `itens.json` | 9 | itens vivos de 75088 e 75089, incluindo três filhos (`CODIGOPAI` = 507305) e itens com e sem `DETALHES` |
| `pagamentos.json` | 4 | dois cartões de crédito com operadora (pedido 75088), um do delivery 75089, um em dinheiro (pedido 75162) |
| `recebimentos.json` | 5 | crédito Mastercard, Pix Manual (operadora = telefone), iFood Online Voucher, dinheiro e Vale Alimentação Alelo |
| `caixas.json` | 2 | caixa 1561 fechado (saldo final R$ 7.902,13, o mesmo do painel) e 1562 fechado |
| `caixa-operacoes.json` | 4 | um de cada `TIPO`: `A` suprimento, `S` sangria, `E` estorno, `D` despesa |
| `itens-dia.json` | 18 | agregado de 21/08 por produto |
| `produtos.json` | 7 | cadastro (`lib/pdvBackup/consultasProdutos.js`), não movimento — ver seção própria abaixo |

### Ressalvas

- **`caixa-operacoes.json`**: as linhas `E` (9371, caixa 1561) e `S` (9380,
  caixa 1562) são da janela. Não houve suprimento nem despesa em 21–22/08, então
  as linhas `A` (9256) e `D` (9025) são reais mas de caixas anteriores (1536 e
  1503, julho e junho). O teste as reaproveita apontando para o caixa 1562 e
  ajustando `DATAOPERACAO`, para exercitar a ordenação dos movimentos.
- **`itens-dia.json`** é um recorte: só os produtos de 21/08 com mais de R$ 150
  vendidos, para o arquivo não ficar com as 174 linhas do dia. A participação no
  lucro e a curva ABC que o teste confere são, portanto, do recorte, não do dia
  inteiro.
- **`pagamentos.json`** traz um pagamento (101384) de um pedido que não está em
  `pedidos.json`; ele serve só para o caso "dinheiro".

## Como foram regeradas

Consultas equivalentes às de `lib/pdvBackup/consultas.js`, rodadas com
`isql -ch UTF8` no container, filtrando pelos códigos citados acima.

## `produtos.json`

Diferente dos demais arquivos, é cadastro, não movimento numa janela: veio de
`lib/pdvBackup/consultasProdutos.js` (`SQL_PRODUTOS`), rodada em 26/08/2026 no
mesmo container `fb364` (backup do Steakhouse restaurado).

Cinco linhas são reais, filtradas por `codigo in (16, 157, 165, 3, 17)`:

- **16** (Salsa) — insumo (`CODIGOPRODUTOTIPO` 2) vivo, com `PRECOCUSTO`
  positivo (17,50) e `PRECOVENDA` zerado.
- **157** (Black) — produto (`CODIGOPRODUTOTIPO` 1) vivo, com `NCM`
  (`16025000`) e `CEST` (`1707900`) preenchidos, `SITUACAOTRIBUTARIA` "102"
  (CSOSN, sem ST retida) e `CFOP` 5102.
- **165** (Assado de Tira) — produto vivo com `NCM`/`CEST` iguais ao 157, mas
  `SITUACAOTRIBUTARIA` "500" (ST retida) e `CFOP` 5405 — o par 157/165 cobre
  "produto vivo sem ST" vs. "produto vivo com ST retida", ambos com NCM e
  CEST.
- **3** (`* Excluído * Batata c/ Cheddar e Bacon`) — produto (`CODIGOPRODUTOTIPO`
  1) descontinuado, com config e com `NCM` preenchido (`21069090`).
- **17** (`* Excluído * Hambúrguer de Picanha`) — insumo descontinuado sem
  config (`CFOP`, `SITUACAOTRIBUTARIA` e `ORIGEMMERCADORIA` nulos).

As linhas **9001** e **9002** são sintéticas, escritas à mão para os casos de
recusa de NCM curto e CEST fora do padrão — não existem no banco real.

**Correção em relação à primeira extração (26/08/2026):** a fixture original
trazia 339 (Costela Bovina) e 431 (Costela Defumada) como os casos "produto
vivo com config" e "produto vivo com CSOSN e NCM". Na prática os dois eram
`CODIGOPRODUTOTIPO` 2 (insumo) e sem `NCM` preenchido — o plano tinha
escolhido os códigos errados. Trocados em 27/08/2026 por **157** e **165**,
que são de fato `CODIGOPRODUTOTIPO` 1 (produto) e têm `NCM`/`CEST`
preenchidos, cobrindo os casos "produto vivo sem ST" (157) e "produto vivo
com ST retida, NCM e CEST" (165). Os demais três códigos (16, 3, 17) não
mudaram.
