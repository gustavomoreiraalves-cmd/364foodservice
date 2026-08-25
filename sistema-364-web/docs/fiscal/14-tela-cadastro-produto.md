# Tela de cadastro de produto — especificação

Base: os oito screenshots do cadastro de produto do PDV Consumer, enviados em
24/08/2026, e a tela que já existe em `app/produtos/page.js` (372 linhas, uma
única página com formulário e lista).

## O que o Consumer confirma

A tela deles separa o produto em seis abas: **Principal, Estoque, Fiscal, Ficha
Técnica, Perguntas, Complementos**. Duas decisões importam para nós.

**A configuração fiscal é uma entidade nomeada e reutilizável, não campos soltos
no produto.** Na aba Fiscal existe "Selecione uma configuração de ICMS/IS/IBS/CBS
pré-cadastrada", e essa configuração abre numa janela própria com nome, CFOP,
origem da mercadoria, situação tributária e sete abas de imposto (ICMS, ICMS ST,
ICMS Retido, Simples Nacional, ICMS Desonerado, IS, IBS/CBS). É o mesmo modelo da
migração 36: `grupos_tributarios` mais `regras_tributarias`, com o produto
carregando apenas NCM, CEST e origem.

**Há um atalho de "copiar configuração fiscal de outro produto".** Vale ter o
equivalente, e o nosso é melhor: em vez de copiar valores — que depois divergem
em silêncio — basta apontar o produto para o mesmo grupo tributário.

## O que faltava na migração 36

Quatro campos vieram diretamente da tela deles e um quinto da nota do frigorífico:

| Campo | Onde | Por quê |
|---|---|---|
| `ind_escala` | produto | Tag `<indEscala>`. "Indicador Produção" na tela deles. Quando é N (escala não relevante), a nota exige o CNPJ do fabricante e a MVA aplicável pode ser outra. |
| `cnpj_fabricante` | produto | Tag `<CNPJFab>`, obrigatória quando `ind_escala` é N. |
| `aliquota_transparencia` | produto | "Alíquota da Transparência (%)" — Lei 12.741/2012, tabela IBPT, alimenta `<vTotTrib>`. Não é tributo devido, é informação ao consumidor. |
| `cst_pis`, `cst_cofins`, `aliquota_pis`, `aliquota_cofins` | regra tributária | No Simples eles estão no DAS, mas as tags continuam obrigatórias no XML. A nota do frigorífico sai com CST 06 e alíquota zero pela Lei 10.925/2004. |
| `codigo_credito_presumido`, `percentual_credito_presumido` | regra tributária | "Código Crédito Presumido" e "(%) Crédito Presumido" na tela deles. |
| `aliquota_st_retido` | regra tributária | Tag `<pST>`, necessária no CSOSN 500 junto de `vBCSTRet` e `vICMSSubstituto`. |

Cobertos pelos cenários 14 e 15 de `tests/migracao-36/cenarios.sql`.

## Divergência a resolver

O Consumer cadastra o CEST `1707900` (item 79.0) para o NCM `16025000`. A
pesquisa apontou `1707906` (item 79.6), que é o específico de "outras preparações
e conservas de carne bovina" — 79.0 é o genérico do grupo. Como Rondônia não
adotou nenhum dos dois (a Tabela XVII salta de 78.0 para 83.0), a diferença não
muda a tributação hoje, mas muda o que vai na tag `<CEST>`. Vale alinhar com o
contador qual dos dois usar, e usar o mesmo nos dois sistemas.

## Desenho da nossa tela

`app/produtos/page.js` hoje é um formulário único com nome, categoria, unidade,
custo, preço, validade, conservação, produção interna e ficha técnica. A adição
do bloco fiscal dobraria o tamanho do formulário, então a tela passa a ter abas:

**Geral** — o que já existe: nome, categoria, unidade de venda, custo, preço,
validade, conservação, produção interna, modelo de etiqueta.

**Fiscal** — o bloco novo, na ordem em que uma pessoa consegue preencher:
1. *Classificação*: NCM (com busca por descrição em `tabela_ncm`), EX-TIPI, CEST
   (o seletor só oferece os CEST correlacionados ao NCM escolhido, via
   `tabela_cest`), origem da mercadoria.
2. *Medidas*: unidade comercial, unidade tributável, fator de conversão, peso
   líquido e bruto. O fator só aparece quando as duas unidades diferem.
3. *Códigos de barras*: GTIN e GTIN tributável, com o dígito verificador
   conferido na hora e o atalho "sem código de barras" preenchendo `SEM GTIN`.
4. *Produção*: indicador de escala e, quando N, o CNPJ do fabricante.
5. *Grupo tributário*: um seletor, com link para criar ou editar o grupo. É aqui
   que a tributação de verdade é definida — o resto desta aba é a mercadoria.
6. *Transparência*: alíquota da Lei 12.741.
7. *IBS/CBS*: `cClassTrib`, escondido atrás de um "avançado" até 2027.

Um painel no topo da aba mostra o que falta para o produto poder ser faturado, e
o botão **Liberar para emissão** (que grava `ativo_fiscal`) só habilita quando a
lista zera. Produto com `sugerido_automaticamente` mostra a origem do dado ("veio
da NF-e 34.840 do fornecedor") e pede confirmação campo a campo.

**Ficha técnica** — a que já existe, com a coluna de percentual do custo que o
Consumer tem e a nossa não. É informação boa: mostra de onde vem o custo.

## Fora de escopo

Estoque controlado, perguntas e complementos são do PDV e não afetam a NF-e.
A aba Estoque deles é só um histórico de movimentação, que no nosso sistema já
mora em Produção e Recebimento.
