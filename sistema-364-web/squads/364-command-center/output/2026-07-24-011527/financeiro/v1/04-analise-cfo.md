# Análise Financeira — CFO 364
**Empresa:** 364 Food Services | **Categoria:** financeira

## Dados Reais

- Ficha técnica de custo e venda de 13 produtos numerados + Chutney de Abacaxi (14 com preço de venda definido), com Custo Unitário Final, Valor de Revenda, CMV (%) e Lucro Unitário — fonte: planilha `FICHA TECNICA FOOD SERVICE.xlsx`, aba de custos, fornecida por Gustavo em 2026-07-24. Custo Unitário Final já incorpora custo de compra ratado por peso + temperos (R$0,25/produto) + embalagem (R$3,85/produto).
- Farofa Crocante: custo unitário R$17,50, **sem preço de venda definido** — não é possível calcular CMV nem margem.
- Custo Operacional mensal total: **R$19.195,00**, aberto em Aluguel R$1.000, Energia R$1.500, Mão de Obra R$3.600, Impostos R$10.395, Temperos R$200, Carvão R$900, Butcher Paper R$1.600 — fonte: aba de custos fixos.
- Comparativo de lote real de produção (Panceta: 98 un.; Costelinha: 68 un.) com custo de produção, receita e lucro por canal (varejo/atacado), **sem rateio de custos fixos** (nota explícita da própria planilha) — fonte: aba de comparativo varejo x atacado.
- Preços atuais por canal (atacado/varejo) e CMV por canal para 8 SKUs (0364-001 a 0364-008) — fonte: aba de precificação por canal.
- Projeção de Vendas mensal (pedido base de 72 un. × 33 pedidos/mês): Faturamento R$103.950,00, Custo R$62.684,71, "Lucro" R$41.265,29, "Lucro Real" R$22.070,29 — fonte: aba "Projeção de Vendas". **Atenção: é meta/projeção, não histórico realizado.**

## Estimativas

- **Hipótese (não confirmada por fórmula visível na planilha):** "Lucro Real" = "Lucro" − Custo Operacional mensal. Verificação aritmética própria: R$41.265,29 − R$22.070,29 = **R$19.195,00**, valor idêntico ao Custo Operacional mensal. É uma coincidência numérica forte, mas trato como hipótese a validar com Gustavo, não como fórmula confirmada, pois não há evidência de que o rateio foi aplicado com este critério (ex.: rateio por produto, por canal, por SKU) nem de que cobre 100% do custo fixo em todos os meses.
- **Estimativa própria (não fornecida na planilha):** margem de contribuição percentual agregada da Projeção de Vendas = 41.265,29 / 103.950,00 = **39,70%**. Método: divisão direta de "Lucro" (receita − custo variável) pela receita projetada, assumindo que o "Custo" de R$62.684,71 é integralmente variável (não há evidência de custo fixo embutido nele).
- **Estimativa própria:** ponto de equilíbrio mensal em R$ e em pedidos, calculado a partir do Custo Operacional (dado real) e da margem de contribuição estimada acima — ver seção Cálculos. Nível de confiança: **média** (depende da hipótese acima ser válida e do mix de produtos projetado se manter estável).
- **Hipótese não confirmada (herdada do Step 02):** possível divergência entre custo de embalagem R$3,82 (aba cotações) e R$3,85 (aba custos usada nos cálculos) — impacto de R$0,03/produto, não corrigido aqui.
- **Hipótese não confirmada (herdada do Step 02):** rótulo "Custo Temperos R$0,25" pode estar trocado com "Emb. Vácuo R$0,25".
- **Observação a validar com Gustavo, não tratada como fato:** a tabela de 8 SKUs (0364-001 a 008) parece consolidar variantes da tabela de 13 produtos (ex.: possíveis médias de Costela Bovina 1/2 em "Costela Defumada", de Panceta 1/2 em "Torresmo de Rolo", de Costelinha BBQ 1-4 em "Costelinha BBQ"), mas o critério de consolidação não está explícito nos dados recebidos — não assumo essa correspondência como certa.
- **Cenário ilustrativo do canal Assinaturas** (seção Cálculos, item 4): valores de ticket médio, desconto e margem são **exemplos hipotéticos para demonstrar o mecanismo de cálculo**, não são dado real nem projeção de mercado.

## Cálculos

### 1. CMV e margem bruta por produto (dado real de CMV; margem bruta = 100% − CMV, cálculo próprio)

| Produto | Custo Unit. Final | Preço Venda | CMV (real) | Margem Bruta (calc.) | Lucro Unit. (real) |
|---|---|---|---|---|---|
| Costela Bovina 1 | R$25,23 | R$45,00 | 56,1% | 43,9% | R$19,77 |
| Costela Bovina 2 | R$34,06 | R$45,00 | 75,7% | 24,3% | R$10,94 |
| Costela Desfiada | R$39,10 | R$50,00 | 78,2% | 21,8% | R$10,90 |
| Cupim | R$33,13 | R$50,00 | 66,3% | 33,7% | R$16,87 |
| Panceta 1 | R$19,35 | R$35,00 | 55,3% | 44,7% | R$15,65 |
| Panceta 2 | R$20,30 | R$35,00 | 58,0% | 42,0% | R$14,70 |
| Costelinha BBQ 1 | R$28,79 | R$45,00 | 64,0% | 36,0% | R$16,21 |
| Costelinha BBQ 2 | R$24,10 | R$45,00 | 53,6% | 46,4% | R$20,90 |
| Costelinha BBQ 3 | R$27,33 | R$45,00 | 60,7% | 39,3% | R$17,67 |
| Costelinha BBQ 4 | R$30,28 | R$45,00 | 67,3% | 32,7% | R$14,72 |
| Croquete | R$16,65 | R$35,00 | 47,6% | 52,4% | R$18,35 |
| Escondidinho | R$17,85 | R$32,00 | 55,8% | 44,2% | R$14,15 |
| Hambúrguer 140g | R$26,25 | R$40,00 | 65,6% | 34,4% | R$13,75 |
| Chutney de Abacaxi | R$11,40 | R$24,90 | 45,8% (calc.) | 54,2% (calc.) | R$13,50 (calc.) |
| Farofa Crocante | R$17,50 | **sem preço** | n/a | n/a | n/a |

Nota metodológica: como o Custo Unitário Final já é 100% custo variável (compra + temperos + embalagem), **margem bruta = margem de contribuição unitária** nesta tabela — não há rateio de custo fixo aplicado. Isso significa que os valores de "Lucro Unitário" da planilha são, tecnicamente, margem de contribuição, não lucro líquido.

Produtos com CMV mais alto (menor margem de contribuição, sinalizados para atenção, sem recomendação de reajuste): Costela Desfiada (78,2%), Costela Bovina 2 (75,7%), Costelinha BBQ 4 (67,3%).
Produtos com CMV mais baixo (maior margem de contribuição): Chutney de Abacaxi (45,8%), Croquete (47,6%), Costelinha BBQ 2 (53,6%).

### 2. CMV por canal — 8 SKUs (dado real; margem bruta = 100% − CMV, cálculo próprio)

| SKU | Produto | CMV Atacado | Margem Atacado | CMV Varejo | Margem Varejo |
|---|---|---|---|---|---|
| 0364-001 | Costela Defumada | 75,7% | 24,3% | 58,2% | 41,8% |
| 0364-002 | Costela Desfiada | 78,2% | 21,8% | 60,2% | 39,8% |
| 0364-003 | Costelinha BBQ | 67,3% | 32,7% | 51,8% | 48,2% |
| 0364-004 | Cupim | 66,3% | 33,7% | 51,0% | 49,0% |
| 0364-005 | Torresmo de Rolo | 58,0% | 42,0% | 44,6% | 55,4% |
| 0364-006 | Hambúrguer Defumado | 65,6% | 34,4% | 50,5% | 49,5% |
| 0364-007 | Escondidinho | 44,6% | 55,4% | 34,3% | 65,7% |
| 0364-008 | Croquete | 41,6% | 58,4% | 32,0% | 68,0% |

Isso significa que, produto a produto, o canal atacado sempre entrega margem bruta/de contribuição menor que o varejo (mesmo custo, preço mais baixo) — padrão consistente em todos os 8 SKUs, sem exceção.

### 3. Ponto de equilíbrio mensal (cálculo próprio, a partir de dado real de custo fixo + estimativa de margem de contribuição da Projeção de Vendas)

- Custo Operacional fixo mensal (real): R$19.195,00
- Margem de contribuição % estimada (Projeção de Vendas, 33 pedidos/mês): 39,70%
- **Ponto de equilíbrio em faturamento** = Custo Fixo / Margem de Contribuição % = 19.195,00 / 0,3970 ≈ **R$48.350,00/mês**
- Ponto de equilíbrio como % do faturamento projetado (R$103.950,00) = **46,5%**
- Contribuição por pedido-base (R$3.150,00 receita − R$1.899,54 custo) = R$1.250,46
- **Ponto de equilíbrio em pedidos** = 19.195,00 / 1.250,46 ≈ **15,4 pedidos/mês** (arredondando para cima: 16 pedidos)
- Margem de segurança frente à meta de 33 pedidos/mês = (33 − 15,4) / 33 ≈ **53,5%**

Nível de confiança: **média** — depende (a) da hipótese de que o "Custo" de R$62.684,71 da projeção é 100% variável, (b) da meta de 33 pedidos/mês ser efetivamente atingível (capacidade produtiva real não foi validada, ver Dados Não Fornecidos), e (c) do mix de produtos projetado se manter estável.

### 4. Cenário ilustrativo — canal Assinaturas (estrutura de lógica, NÃO é dado real nem projeção de mercado)

Como não há dado-base de assinatura (não existe o canal ainda), não calculo viabilidade financeira real. Apresento apenas a lógica de precificação e ponto de equilíbrio de assinantes, com números fictícios de exemplo:

**Lógica:**
1. Preço de assinatura = Preço Varejo × (1 − desconto de fidelização)
2. Margem de Contribuição Assinatura (%) = (Preço Assinatura − Custo Variável Unitário Equivalente) / Preço Assinatura
3. Ponto de equilíbrio de assinantes = (Custo Fixo Mensal × % do custo fixo alocado ao canal, critério de rateio pendente) / Contribuição em R$ por assinante

**Exemplo puramente ilustrativo (valores fictícios, apenas para demonstrar o mecanismo):**

| Ticket médio mensal (hipotético) | Margem de contribuição assumida (hipotética) | Contribuição R$/assinante | Nº assinantes p/ PE (100% do custo fixo, cenário extremo) | Nº assinantes p/ PE (rateio hipotético de 30% do custo fixo) |
|---|---|---|---|---|
| R$100,00 | 40% | R$40,00 | 480 | 144 |
| R$150,00 | 40% | R$60,00 | 320 | 96 |
| R$150,00 | 50% | R$75,00 | 256 | 77 |
| R$200,00 | 45% | R$90,00 | 213 | 64 |

Isso significa que a viabilidade da assinatura depende diretamente de três variáveis ainda não definidas: (1) o ticket médio real que o mercado aceita, (2) o desconto de fidelização frente ao varejo (que precisa ficar acima da margem mínima observada no atacado, hoje entre 21,8% e 58,4% conforme SKU, para não descaracterizar o canal), e (3) o critério de rateio de custo fixo aplicado ao canal — nenhuma dessas três está definida nos dados recebidos.

## Comparação Orçado x Realizado

Não há histórico de vendas realizado fornecido — a Projeção de Vendas é meta/orçado, não realizado. A comparação possível é entre dois cenários dentro do próprio orçado:

| Cenário (orçado, 33 pedidos/mês) | Faturamento | Custo | Resultado | Margem sobre Faturamento |
|---|---|---|---|---|
| "Lucro" (contribuição bruta, sem custo fixo) | R$103.950,00 | R$62.684,71 | R$41.265,29 | 39,70% |
| "Lucro Real" (hipótese: após dedução do Custo Operacional de R$19.195,00) | R$103.950,00 | R$62.684,71 + R$19.195,00 (hipótese) | R$22.070,29 | 21,23% |

Comparativo real de canal (lote de produção, sem rateio de fixos):

| Canal | Receita | Custo Produção | Lucro (contribuição) | Margem |
|---|---|---|---|---|
| Varejo (Panceta + Costelinha) | R$8.437,00 | R$4.047,98 | R$4.389,01 | 52,0% |
| Atacado (Panceta + Costelinha) | R$6.490,00 | R$4.047,98 | R$2.442,01 | 37,6% |

Isso significa que, mesmo no cenário mais favorável (100% varejo, margem de 52,0%), o ponto de equilíbrio cairia para cerca de R$36.913,00/mês (19.195,00 / 0,52); e no cenário mais conservador (100% atacado, margem de 37,6%), o ponto de equilíbrio subiria para cerca de R$51.050,00/mês (19.195,00 / 0,376) — acima do ponto de equilíbrio de R$48.350,00 estimado com o mix atual da Projeção de Vendas. Ambos os cálculos de PE por canal são estimativa própria, não dado da planilha.

## Insight

- Isso significa que, ao nível de produto, a operação da 364 Food Services tem margem de contribuição saudável na maioria dos itens (ex.: Croquete 52,4%, Costelinha BBQ 2 46,4%, Chutney de Abacaxi 54,2% calculado), mas três itens (Costela Desfiada, Costela Bovina 2, Costelinha BBQ 4) operam com CMV acima de 65-78%, o que reduz a margem de contribuição individual para a faixa de 21,8% a 32,7% — abaixo da média do mix.
- Isso significa que, se a hipótese "Lucro Real = Lucro − Custo Operacional" estiver correta, a meta de 33 pedidos/mês (Projeção de Vendas) cobriria o Custo Operacional com folga: o ponto de equilíbrio estimado (≈15,4 pedidos/mês ou ≈R$48.350,00 de faturamento) fica bem abaixo da meta, com margem de segurança de ≈53,5%. Isso é uma leitura favorável, mas de **confiança média**, porque a hipótese de rateio não está confirmada e a capacidade produtiva real para sustentar 33 pedidos/mês não foi validada nos dados recebidos.
- Isso significa que o canal atacado, isoladamente, tem margem de contribuição mais apertada (37,6% no lote analisado, variando de 21,8% a 58,4% por SKU) e, em um cenário hipotético de mix 100% atacado, o ponto de equilíbrio subiria para ≈R$51.050,00/mês — acima da margem de segurança atual. Isso reforça a importância de acompanhar o mix real de canais, não apenas o volume total.
- Isso significa que qualquer decisão sobre o canal de assinaturas hoje seria baseada em hipótese, não em dado — a estrutura de cálculo está pronta (fórmulas e exemplo ilustrativo acima), mas falta o dado-base (ticket médio de mercado, taxa de churn esperada, custo de aquisição) para uma recomendação de viabilidade financeira real.

## Recomendação

Todas as recomendações abaixo são análises e sugestões — nenhuma aprovação de preço, investimento ou lançamento de canal está sendo tomada aqui; toda ação está **pendente de aprovação de Gustavo Moreira Alves**.

1. **Definir e validar formalmente um critério de rateio de custo fixo por canal e por produto** (ex.: por receita, por volume, por horas de produção). Impacto estimado: sem essa definição, a margem líquida real por produto/canal permanece indeterminada — hoje só é possível calcular margem de contribuição (bruta), não margem líquida segregada. Confiança: **alta** de que essa é a lacuna mais crítica para decisões de precificação.
2. **Validar a hipótese "Lucro Real = Lucro − Custo Operacional"** com quem construiu a planilha, confirmando se o rateio aplicado (se houver) é integral (100% do custo fixo absorvido pelo mix projetado) ou parcial. Impacto estimado: se confirmada, a margem líquida projetada seria de 21,23% sobre R$103.950,00/mês (R$22.070,29); se não confirmada, esse número não pode ser usado para decisão. Confiança: **média**.
3. **Validar a capacidade produtiva mensal real** frente à meta de 33 pedidos/mês antes de tratar a Projeção de Vendas como orçado confiável — sem isso, o ponto de equilíbrio calculado (≈15,4 pedidos/mês) é matematicamente correto, mas a folga de 53,5% até a meta não tem lastro operacional confirmado. Confiança: **baixa** quanto à viabilidade de atingir 33 pedidos/mês sem esse dado.
4. **Revisar os três produtos de menor margem de contribuição** (Costela Desfiada 21,8% no atacado, Costela Bovina 2 24,3%, Costelinha BBQ 4 32,7%) — não como reajuste de preço decidido, mas como pauta de análise (custo de compra, peso de embalagem proporcional, possível renegociação de fornecedor). Qualquer reajuste de preço permanece pendente de aprovação de Gustavo.
5. **Não avançar com precificação do canal de assinaturas** até obter ao menos: ticket médio-alvo, desconto de fidelização pretendido, e critério de rateio de custo fixo por canal. A estrutura de cálculo (item 4 da seção Cálculos) está pronta para ser aplicada assim que esses dados existirem.
6. **Definir preço de venda da Farofa Crocante** (custo unitário real R$17,50, hoje sem CMV calculável) e completar o comparativo de canal para o Chutney de Abacaxi.

## Dados Não Fornecidos

- Critério de rateio de custo fixo mensal por produto ou por canal.
- Margem líquida (após custos fixos) segregada por produto e por canal — só existe o indício não confirmado do "Lucro Real" agregado.
- Histórico de vendas realizado (todos os números de projeção disponíveis são meta/orçado, não realizado).
- Fluxo de caixa, inadimplência e prazo médio de recebimento por canal.
- Custo de frete/logística por canal (varejo, atacado, assinatura).
- Preço de venda da Farofa Crocante.
- Capacidade produtiva mensal real (necessária para validar se 33 pedidos/mês é uma meta alcançável).
- Qualquer dado-base do canal de assinaturas: ticket médio de mercado, taxa de churn esperada, custo de aquisição de assinante, disposição a pagar.
- Confirmação do critério de consolidação entre a tabela de 13 produtos e a tabela de 8 SKUs por canal (possível correspondência não confirmada).
- Confirmação de qual valor de custo de embalagem é o correto (R$3,82 vs. R$3,85) e se "Custo Temperos R$0,25" está corretamente rotulado.
