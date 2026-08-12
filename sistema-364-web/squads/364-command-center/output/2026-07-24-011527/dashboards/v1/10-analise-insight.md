# Preparação de Dados — Insight 364
**Empresas:** 364 Food Services | **Período:** não determinado — fonte é planilha única sem data de apuração/período interno, representando a referência vigente na data de fornecimento (2026-07-24). Sem série temporal disponível, não é possível apurar tendência histórica; a análise é um retrato estático desta base.

## Fontes Utilizadas
- Planilha `FICHA TECNICA FOOD SERVICE.xlsx`, fornecida por Gustavo em 2026-07-24, sem data de apuração/período informada — aba "CUSTOS PRODUÇÃO" (13 produtos com custo/margem).
- Mesma planilha, aba "PROJEÇÃO DE VENDAS" (8 SKUs com preços e CMV por canal — atacado/varejo).
- Mesma planilha, dados de Custo Operacional fixo mensal e Projeção mensal (meta, não histórico).
- Inconsistências já identificadas no Step 02 (herdadas para aprofundamento, não recalculadas do zero).

## Limpeza Realizada
- Cálculo de CMV e lucro unitário para **Chutney de Abacaxi**, ausente na planilha original: CMV = R$11,40 / R$24,90 = 45,8%; Lucro unitário = R$24,90 − R$11,40 = R$13,50. Documentado como cálculo derivado nesta análise, não como dado original da fonte.
- **Farofa Crocante** excluída do ranking de margem por não ter preço de revenda definido na fonte (sem preço → impossível calcular CMV/lucro). Permanece listada em "Dados Não Fornecidos".
- Nenhum outro valor foi alterado, arredondado adicionalmente ou corrigido. Divergências entre abas foram mantidas exatamente como constam na fonte, sem preencher lacuna com suposição.

## Cruzamento
- Cruzamento entre a aba "CUSTOS PRODUÇÃO" (13 produtos, valor de revenda único) e a aba "PROJEÇÃO DE VENDAS" (8 SKUs, dois canais) mostra sobreposição parcial. Os seguintes itens aparecem nas duas abas com o mesmo custo unitário, o que confirma consistência entre as duas fontes para eles: Costela Bovina 2 = SKU 0364-001 Costela Defumada (R$34,06); Costela Desfiada = 0364-002 (R$39,10); Cupim = 0364-004 (R$33,13); Costelinha BBQ 4 = 0364-003 (R$30,28); Panceta 2 = 0364-005 Torresmo de Rolo (R$20,30); Hambúrguer 140g = 0364-006 (R$26,25); Croquete = 0364-008 (R$16,65); Escondidinho = 0364-007 (R$17,85).
- Produtos sem correspondência na aba "PROJEÇÃO DE VENDAS" (sem dado de canal atacado/varejo): Costela Bovina 1, Panceta 1, Costelinha BBQ 1, Costelinha BBQ 2, Costelinha BBQ 3, Farofa Crocante, Chutney de Abacaxi. Esta é uma lacuna de dado, não um erro — sinalizada em "Dados Não Fornecidos".
- Cruzamento entre o CMV único (aba custos) e o CMV por canal (aba projeção) mostra que o CMV único reportado na aba "CUSTOS PRODUÇÃO" coincide, nos 8 itens em comum, com o CMV do canal Atacado (ex.: Cupim 66,3% na aba custos = CMV atacado 66,3% na aba projeção). Isso sugere que "Valor Revenda Atual" da aba de custos usa como referência o preço de atacado — hipótese a validar com Gustavo, não confirmada por fórmula visível na planilha.
- Sem período/data de apuração disponível, não foi possível cruzar esta base com dados anteriores para avaliar tendência de custo ou margem ao longo do tempo.

## Ranking

### Ranking de margem por produto (14 itens com preço de revenda definido)
Critério: % de lucro = Lucro Unitário ÷ Preço de Venda, ordenado do maior para o menor. Fonte: aba "CUSTOS PRODUÇÃO", planilha `FICHA TECNICA FOOD SERVICE.xlsx`, sem período definido. Farofa Crocante excluída por falta de preço de revenda (ver Dados Não Fornecidos).

| # | Produto | Custo Unitário | Preço Venda | CMV | Lucro Unitário | % Lucro |
|---|---|---|---|---|---|---|
| 1 | Chutney de Abacaxi | R$11,40 | R$24,90 | 45,8%* | R$13,50* | 54,22%* |
| 2 | Croquete | R$16,65 | R$35 | 47,6% | R$18,35 | 52,43% |
| 3 | Costelinha BBQ 2 | R$24,10 | R$45 | 53,6% | R$20,90 | 46,44% |
| 4 | Panceta 1 | R$19,35 | R$35 | 55,3% | R$15,65 | 44,71% |
| 5 | Escondidinho | R$17,85 | R$32 | 55,8% | R$14,15 | 44,22% |
| 6 | Costela Bovina 1 | R$25,23 | R$45 | 56,1% | R$19,77 | 43,93% |
| 7 | Panceta 2 | R$20,30 | R$35 | 58,0% | R$14,70 | 42,00% |
| 8 | Costelinha BBQ 3 | R$27,33 | R$45 | 60,7% | R$17,67 | 39,27% |
| 9 | Costelinha BBQ 1 | R$28,79 | R$45 | 64,0% | R$16,21 | 36,02% |
| 10 | Hambúrguer 140g | R$26,25 | R$40 | 65,6% | R$13,75 | 34,38% |
| 11 | Cupim | R$33,13 | R$50 | 66,3% | R$16,87 | 33,74% |
| 12 | Costelinha BBQ 4 | R$30,28 | R$45 | 67,3% | R$14,72 | 32,71% |
| 13 | Costela Bovina 2 | R$34,06 | R$45 | 75,7% | R$10,94 | 24,31% |
| 14 | Costela Desfiada | R$39,10 | R$50 | 78,2% | R$10,90 | 21,80% |

*Chutney de Abacaxi: CMV, lucro unitário e % lucro calculados nesta análise (ver Limpeza Realizada), não constavam prontos na planilha original.

### Ranking de CMV por canal (8 SKUs com preço atacado/varejo)
Critério: % CMV por canal, ordenado do pior (maior %) para o melhor (menor %). Fonte: aba "PROJEÇÃO DE VENDAS", mesma planilha, sem período definido.

**Canal Atacado (pior CMV → melhor CMV):**
| # | SKU | Produto | CMV Atacado |
|---|---|---|---|
| 1 | 0364-002 | Costela Desfiada | 78,2% |
| 2 | 0364-001 | Costela Defumada | 75,7% |
| 3 | 0364-003 | Costelinha BBQ | 67,3% |
| 4 | 0364-004 | Cupim | 66,3% |
| 5 | 0364-006 | Hambúrguer Defumado | 65,6% |
| 6 | 0364-005 | Torresmo de Rolo | 58,0% |
| 7 | 0364-007 | Escondidinho | 44,6% |
| 8 | 0364-008 | Croquete | 41,6% |

**Canal Varejo (pior CMV → melhor CMV):**
| # | SKU | Produto | CMV Varejo |
|---|---|---|---|
| 1 | 0364-002 | Costela Desfiada | 60,2% |
| 2 | 0364-001 | Costela Defumada | 58,2% |
| 3 | 0364-003 | Costelinha BBQ | 51,8% |
| 4 | 0364-004 | Cupim | 51,0% |
| 5 | 0364-006 | Hambúrguer Defumado | 50,5% |
| 6 | 0364-005 | Torresmo de Rolo | 44,6% |
| 7 | 0364-007 | Escondidinho | 34,3% |
| 8 | 0364-008 | Croquete | 32,0% |

Cruzamento entre os dois rankings de canal: **Costela Desfiada** ocupa a pior posição de CMV nos dois canais (78,2% atacado / 60,2% varejo), seguida por Costela Defumada em ambos. **Croquete** é o melhor CMV nos dois canais (41,6% atacado / 32,0% varejo), coerente com sua posição no topo do ranking de margem por produto.

## Inconsistência Sinalizada
Todos os itens abaixo são inconsistências identificadas para validação — nenhuma delas é apresentada como causa confirmada.

1. **Divergência de custo de embalagem (R$3,82 vs R$3,85):** a aba de cotações consolidadas registra R$3,82 e a aba de custos usa R$3,85 fixo nos 13 produtos, diferença de R$0,03/produto. Estimativa condicional (não é correção aplicada): se a fonte correta for R$3,82 e essa diferença for sistemática nas 2.376 un/mês projetadas, o impacto financeiro estimado seria de R$0,03 × 2.376 = **R$71,28/mês**. Este valor é ilustrativo e depende de confirmação com Gustavo sobre qual das duas fontes (cotações consolidadas ou aba de custos) reflete o custo de embalagem correto — não foi aplicado a nenhum cálculo de margem deste documento.
2. **"Custo Temperos R$0,25" (aba custos) idêntico a "Emb. Vácuo R$0,25" (aba embalagens):** coincidência de valor identificada, possível rótulo trocado entre as duas abas. Não há dado que confirme troca de rótulo ou erro de digitação — permanece hipótese a validar diretamente com Gustavo, sem afirmação de causa.
3. **"Lucro" (R$41.265,29) vs "Lucro Real" (R$22.070,29):** a diferença entre os dois valores (R$19.195,00) é numericamente idêntica ao Custo Operacional fixo mensal. Cruzamento de dados sugere que "Lucro Real" pode ser "Lucro" menos Custo Operacional, mas essa fórmula não está visível na planilha — hipótese a validar, não fórmula confirmada.
4. **Erros de fórmula em Farofa Crocante e Chutney de Abacaxi** (#VALUE!, #DIV/0! na aba "PROJEÇÃO DE VENDAS"): consistentes com ausência de quantidade projetada para esses dois itens nessa aba, o que impede o cálculo automático. Ligado diretamente ao item "quantidade projetada ausente" em Dados Não Fornecidos.

## Dados Não Fornecidos
- Data de apuração/período de referência da planilha `FICHA TECNICA FOOD SERVICE.xlsx` (apenas a data de fornecimento, 2026-07-24, é conhecida).
- Preço de revenda de Farofa Crocante (impede cálculo de CMV/lucro/inclusão no ranking).
- Quantidade projetada de vendas para Farofa Crocante e Chutney de Abacaxi na aba "PROJEÇÃO DE VENDAS" (causa raiz aparente dos erros de fórmula #VALUE!/#DIV/0!, não confirmada).
- Dado de canal (atacado/varejo) para Costela Bovina 1, Panceta 1, Costelinha BBQ 1, Costelinha BBQ 2 e Costelinha BBQ 3 — só existem com valor de revenda único na aba de custos.
- Fonte/origem oficial que define o valor correto do custo de embalagem (R$3,82 ou R$3,85).
- Fórmula explícita que define "Lucro Real" a partir de "Lucro".
- Histórico de períodos anteriores para permitir análise de tendência de custo/margem ao longo do tempo.
- Dados de outras empresas/unidades do Grupo 364 — apenas 364 Food Services foi fornecida nesta base.
