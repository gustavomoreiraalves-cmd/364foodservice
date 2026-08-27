# Importação de produtos do PDV Consumer

Desenho aprovado em 26/08/2026.

## Problema

O cadastro de produtos do 364 OS tem 11 linhas e o de matérias-primas tem 7, todas
digitadas à mão. O PDV Consumer, em uso desde 2022, tem 699 produtos com preço, custo,
categoria e — o que não se esperava — dados fiscais.

Enquanto os dois cadastros não se encontram, `pdv_vendas_itens_dia` (94.542 linhas do
Steakhouse desde março de 2022, mais 1.480 do Foodtruck/Afya) é uma tabela de números
soltos: sabe-se quanto cada `codigo_produto` vendeu, mas não a que produto do sistema ele
corresponde. Custo, margem e curva ABC por produto ficam presos aí.

## Objetivo

Espelhar o cadastro do Consumer no 364 OS, de modo que:

1. `pdv_vendas_itens_dia.codigo_produto` passe a amarrar num produto de verdade;
2. a ficha técnica tenha insumos reais em vez de sete nomes digitados à mão;
3. os dados fiscais que já existem no PDV cheguem junto, sem que ninguém emita nota por
   eles antes de conferir.

O terceiro item é consequência, não motivação. Nenhum produto importado nasce liberado
para emissão.

## O que o Consumer tem

Levantado em 26/08/2026 no backup restaurado (container `fb364`, `CONSUMER.FDB` da loja
Dois de Abril / 364 Steakhouse).

O Consumer classifica cada produto em `PRODUTOTIPO`:

| Tipo | Total | Vivos (`DESCONTINUADO = 'N'`) |
|------|-------|-------------------------------|
| Produto | 364 | 295 |
| Insumo | 176 | 163 |
| Complemento | 108 | 52 |
| Combo | 29 | 24 |
| Produto por Tamanho | 20 | 2 |
| Serviço | 2 | 2 |

Essa divisão encaixa nas duas tabelas do 364 OS: **Produto** vira `produtos`, **Insumo**
vira `materias_primas`. Complemento, Combo, Produto por Tamanho e Serviço ficam de fora —
não são item de estoque nem de ficha técnica, e trariam 80 linhas de ruído.

A tributação **não** está nas colunas de `PRODUTOS` (só 12 têm CFOP lá). Ela vive em
`CONFIGICMS`, uma linha por produto, sem nenhum produto com duas configs — relação 1:1
limpa, com CFOP, CSOSN, origem, alíquota de ICMS e redução de base.

Cobertura dos 295 produtos vivos do tipo Produto:

| Campo | Preenchido |
|-------|-----------|
| NCM (8 dígitos) | 295 |
| Origem da mercadoria (em `CONFIGICMS`) | 295 |
| CEST (7 dígitos) | 241 |
| CSOSN 500 (ST retido) | 135 |

Os 163 insumos vivos têm **zero** campos fiscais preenchidos, o que é coerente: insumo é
compra, não saída.

Três campos foram descartados do de-para por estarem vazios em 100% das linhas:
`VALIDADEDIAS`, `EXTIPI` e `CNPJFABRICANTE`.

Toda a tributação dos produtos colapsa em quatro combinações:

| CFOP / CSOSN | Produtos |
|--------------|----------|
| 5101 / 102 | 228 |
| 5102 / 102 | 148 |
| 5405 / 500 | 141 |
| 5102 / 400 | 10 |

## Decisões

### Chave de casamento

`produtos` e `materias_primas` ganham `pdv_codigo_produto`, que guarda `PRODUTOS.CODIGO`
do Consumer. É por ele que a importação encontra a linha na rodada seguinte, e é ele que
amarra `pdv_vendas_itens_dia`.

Não se usa `produtos.codigo` para isso. Aquele campo é humano (`0364-001`, `STK-001`) e vai
virar o `cProd` da NF-e; largar o número cru do Consumer nele estragaria as duas coisas. O
código dos importados é gerado como `<prefixo da empresa>-P<número do PDV>` — `STK-P339`.

`materias_primas` não tem coluna `codigo` e não tem nenhuma constraint `unique`. É por isso
que "Costela Suina" e "Costela Suína" convivem lá hoje. O `unique` novo, sobre
`pdv_codigo_produto`, é a primeira chave que essa tabela ganha; as duplicatas antigas
continuam onde estão, com o campo nulo, e limpá-las é outra tarefa.

### Re-execução nunca sobrescreve edição humana

Cada linha importada guarda em `pdv_valores` um retrato do que a importação gravou. Na
rodada seguinte, campo a campo:

```
novo    = o que o PDV diz agora
atual   = o que está no 364 OS
retrato = pdv_valores[campo]

linha nova           -> grava
atual == retrato     -> grava novo    (ninguém tocou desde a última vez)
atual != retrato     -> não toca      (mão humana aqui) e vai para o relatório
```

Uma trava a mais por cima: **em linha com `revisado_em` preenchido, os campos fiscais nunca
são tocados**, nem quando o valor bate com o retrato. Quem clicou "Liberar para emissão"
conferiu aqueles campos, e a importação não desfaz conferência. São eles: `ncm`, `cest`,
`origem_mercadoria`, `sujeito_st`, `aliquota_transparencia`, `grupo_tributario_id`,
`unidade_tributavel` e `fator_conversao_tributavel`. Nome, categoria, preço, custo e `ativo`
continuam sendo atualizados normalmente — são justamente o que se quer espelhado.

A alternativa considerada — congelar a linha inteira no primeiro toque humano, usando
`sugerido_automaticamente` — foi descartada porque a granularidade é errada: corrigir um
nome congelaria o preço junto, e preço é justamente o que muda no PDV.

### CFOP e CSOSN não viram regra tributária

`regras_tributarias` exige `natureza_operacao_id` e `uf_destino`, e `fn_resolver_regra_tributaria`
resolve por empresa, produto, natureza, UF, contribuinte, consumidor final e data. O
Consumer não tem nenhum desses eixos: a config dele é por produto e ponto. Gerar regras a
partir dele exigiria inventar uma natureza de operação para o dado caber, o que é fabricar
informação fiscal — exatamente o que o cabeçalho da migração 36 diz para não fazer.

A carga cria, em vez disso, **quatro grupos tributários**, um por combinação encontrada,
com a origem registrada na descrição:

```
PDV 5101/102  — CFOP 5101, CSOSN 102, origem 0
PDV 5102/102  — CFOP 5102, CSOSN 102, origem 0
PDV 5405/500  — CFOP 5405, CSOSN 500, origem 0   (ST retido)
PDV 5102/400  — CFOP 5102, CSOSN 400, origem 0
```

Cada produto aponta para o seu grupo. Quando chegar a hora de emitir, a pessoa cria uma
regra por grupo: quatro decisões fiscais em vez de 458.

### Descontinuados

Produto descontinuado entra apenas se tiver venda no histórico, com `ativo = false`. São 4
no Steakhouse; sem eles o join com as vendas de 2022 fica com buraco.

## Modelo — migração 46

Três colunas iguais em `produtos` e `materias_primas`:

| Coluna | Papel |
|--------|-------|
| `pdv_codigo_produto int` | `PRODUTOS.CODIGO` do Consumer; chave de casamento |
| `pdv_valores jsonb` | retrato do que a última importação gravou |
| `pdv_importado_em timestamptz` | quando foi |

Mais, nas duas tabelas:

```sql
unique (empresa_id, pdv_codigo_produto) where pdv_codigo_produto is not null
```

Parcial porque as 18 linhas atuais foram digitadas à mão e ficam com o campo nulo.

A migração não cria trigger, não mexe em `ativo_fiscal` e não toca em nenhuma linha
existente.

O número é **46**. O branch `feat/cadastro-produtos-ux` carrega um
`atualizacao_38_cabecalho_produto.sql` que colide com o `atualizacao_38_cliente_nome_fantasia.sql`
já em `main`; o cabeçalho desta migração registra que aquele deve ser renumerado para
**47**, para a colisão não nascer de novo.

## Componentes

### `scripts/importar-produtos-pdv.mjs`

Reusa o que `scripts/importar-pdv-backup.mjs` já resolveu: `baixarBackup` (hoje não
exportado, passa a ser), `restaurarNoContainer`, `derrubarContainer`, o mesmo container
efêmero e a mesma limpeza no `finally`. Como isto é cadastro e não movimento, não há janela
de datas — roda inteiro.

```
para cada loja em pdv_lojas onde origem = 'backup':
  baixa .fbconsumer -> restaura em container efêmero -> lê:
    PRODUTOS ⨝ CONFIGICMS ⨝ UNIDADECOMERCIALIZACAO ⨝ ETIQUETAS ⨝ PRODUTOTIPO
    + PRODUTODETALHE (preço e custo)
  normaliza (módulo puro)
  roteia: tipo 1 -> produtos, tipo 2 -> materias_primas
  grava campo a campo pela regra de merge
  derruba container, apaga arquivo
```

`--dry-run` roda tudo e imprime o relatório sem gravar nada. É obrigatório na primeira
carga, que são 458 linhas. O relatório traz: novos, atualizados, congelados por revisão e
conflitos, cada conflito com o nome do campo e os dois valores.

### `lib/pdvBackup/consultasProdutos.js`

Só o SQL contra o Firebird, no estilo de `consultas.js`: consulta única com os joins acima,
sem parâmetros de janela.

### `lib/pdvBackup/normalizaProdutos.js`

Puro, sem banco. Recebe as linhas do Firebird e devolve os objetos prontos para gravar,
já roteados por tabela. É onde vivem o de-para de unidade, a geração de código, a validação
de formato e a decisão de `sujeito_st`.

### `lib/pdvBackup/mergeProdutos.js`

Puro. A regra de campo isolada num só lugar, para poder ser testada sem simular Postgres.

## De-para

### `produtos` ← tipo Produto

| Campo | Origem |
|-------|--------|
| `codigo` | gerado: `<prefixo_codigo da empresa>-P<CODIGO>` |
| `nome` | `PRODUTOS.NOME` |
| `categoria` | `ETIQUETAS.DESCRICAO` |
| `unidade` | `UNIDADECOMERCIALIZACAO.SIGLA`, minúsculo (`un`, `kg`, `l`) |
| `preco_venda` | `PRODUTODETALHE.PRECOVENDA` |
| `custo_unitario` | `PRODUTODETALHE.PRECOCUSTO` |
| `ativo` | `DESCONTINUADO = 'N'` |
| `ncm` | `PRODUTOS.NCM` |
| `cest` | `PRODUTOS.CEST` |
| `origem_mercadoria` | `CONFIGICMS.ORIGEMMERCADORIA` |
| `sujeito_st` | `CONFIGICMS.SITUACAOTRIBUTARIA = '500'` |
| `aliquota_transparencia` | `PRODUTOS.ALIQUOTATRANSPARENCIA` |
| `grupo_tributario_id` | um dos quatro grupos criados na carga |
| `unidade_tributavel` | igual a `unidade` |
| `fator_conversao_tributavel` | `1` |
| `ativo_fiscal` | sempre `false` |
| `sugerido_automaticamente` | `true` |

`unidade_tributavel` e `fator_conversao_tributavel` não existem no Consumer, e o CHECK
`produtos_ativo_fiscal_completo` exige os dois para liberar emissão. O default assume
unidade tributável igual à comercial, que é o caso de `un`, `kg` e `l` — e como
`ativo_fiscal` nasce `false`, ninguém emite em cima do palpite sem revisar.

`gtin` fica de fora: o Consumer tem 2 códigos de barra em 540 linhas de `PRODUTODETALHE`, e
o CHECK `produtos_gtin_valido` exige dígito verificador correto. Dois valores não pagam o
caminho de validação.

`produtos.unidade` não tem chave estrangeira para `tabela_unidade_medida`; as 11 linhas
atuais usam minúsculo (`un`, `kg`), e a importação segue essa convenção.

### `materias_primas` ← tipo Insumo

`nome`, `unidade`, `custo_unitario` (de `PRODUTODETALHE.PRECOCUSTO`), `categoria`, `ativo`,
mais as três colunas de rastro. Nada fiscal, porque não há nada fiscal a trazer.

## Erros

Falhar cedo, alto e nomeando o campo — a mesma postura de `lib/nfe/resolverNota.js`:

- Antes de gravar, valida NCM (`^\d{8}$`), CEST (`^\d{7}$`) e origem (0 a 8). Linha que não
  passa não entra e sai no relatório com o código do produto e o valor recusado. Nunca vira
  `null` silencioso.
- Produto sem linha em `CONFIGICMS` entra sem grupo tributário e sem origem. Nenhum dos 295
  produtos vivos está nessa situação; o caso só alcança os descontinuados-com-venda, dos
  quais 41 dos 69 não têm config. Insumo não usa `CONFIGICMS` e por isso nunca cai aqui.
- Container e arquivo baixado morrem no `finally`, como já acontece hoje.
- A gravação é por lotes com `upsert` na chave `(empresa_id, pdv_codigo_produto)`. Falha no
  meio não deixa carga pela metade: rodar de novo continua de onde parou sem duplicar.

## Testes

Espelham `tests/pdv-backup-normaliza.test.mjs`, que já existe.

- `tests/produtos-pdv-normaliza.test.mjs` — módulo puro: roteamento por tipo, geração de
  código, de-para de unidade, origem vindo de `CONFIGICMS` e não de `PRODUTOS`, `sujeito_st`
  apenas no CSOSN 500, NCM e CEST malformados recusados.
- `tests/produtos-pdv-merge.test.mjs` — a regra de campo isolada: linha nova grava;
  `atual == retrato` grava; `atual != retrato` não toca e reporta conflito; campo fiscal com
  `revisado_em` nunca é tocado.
- `tests/migracao-46/` — fixture, cenários e `verificar.sh` no molde da 45: o `unique`
  parcial aceita as linhas manuais com nulo, barra `pdv_codigo_produto` repetido na mesma
  empresa, permite o mesmo número em empresas diferentes, e o rollback devolve o estado
  anterior.

## Fora de escopo

- Tela de importação. O caminho é o script, como nas outras cargas do PDV.
- Execução por cron. A carga é sob demanda: cadastro não muda todo dia, e a primeira
  rodada precisa de olho humano no relatório.
- Limpeza das duplicatas por acento em `materias_primas`.
- Criação das regras tributárias — só os grupos.
- Complemento, Combo, Produto por Tamanho e Serviço.
- Ligação retroativa de `pdv_vendas_itens_dia` ao produto. A coluna que torna isso possível
  nasce aqui; usá-la em relatório é o passo seguinte.
