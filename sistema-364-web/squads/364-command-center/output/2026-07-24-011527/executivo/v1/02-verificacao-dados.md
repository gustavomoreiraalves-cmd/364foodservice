# Verificação de Dados — Insight 364

## Dados Fornecidos

**Fonte de todos os dados abaixo:** planilha `FICHA TECNICA FOOD SERVICE.xlsx`, fornecida por Gustavo em 2026-07-24. Não há indicação de período de coleta/apuração na planilha — os valores parecem representar uma referência de custo/preço vigente na data de fornecimento, não uma série histórica. Onde a planilha é uma projeção (meta), isso está sinalizado explicitamente.

### Financeiro
- Estrutura de custo por produto (13 produtos, aba "CUSTOS PRODUÇÃO"): custo de compra, peso, custo final por KG, custo de temperos (R$0,25 fixo por produto), custo de embalagem (R$3,85 fixo por produto), custo unitário, valor de revenda, CMV (%) e lucro (R$) — por unidade produzida.
- Custos operacionais fixos mensais consolidados (aba "CUSTOS PRODUÇÃO"): Aluguel R$1.000, Energia R$1.500, Mão de Obra R$3.600, Impostos R$10.395, Temperos R$200, Carvão R$900, Butcher Paper R$1.600 — total R$19.195,00/mês.
- Comparativo varejo vs. atacado para 2 produtos (panceta, costelinha): unidades produzidas, custo de produção, receita de venda em cada canal, lucro e % de lucro — com nota explícita da própria planilha de que os valores **não incluem despesas fixas e operacionais**.
- Projeção financeira mensal (aba "PROJEÇÃO DE VENDAS"): faturamento projetado R$103.950, custo projetado R$62.684,71, "Lucro" R$41.265,29, "Lucro Real" R$22.070,29 — projeção/meta, não histórico realizado.
- Cotações de fornecedores de embalagem (aba "CUSTO EMBALAGEM"): valores unitários por tipo de embalagem, consolidados sem identificação do fornecedor vencedor por linha.

### Comercial
- Preços de venda por canal (atacado e varejo) para 8 dos 10 SKUs da aba "PROJEÇÃO DE VENDAS", com CMV% calculado por canal.
- Tabela mestre de 10 SKUs (aba "CODIGOS"): nome do produto, código interno, código de barras (EAN-13) — completa apenas nessas 3 colunas.
- Quantidades de "pedido base" projetadas por SKU (aba "PROJEÇÃO DE VENDAS"): 72 unidades/pedido, projetado para 33 pedidos/mês — trata-se de meta de vendas, não de demanda histórica observada.

### Produção
- Ficha técnica detalhada de 1 produto (Costela Suína Defumada, aba "INF NUTRICIONAL"): ingredientes com rendimento e custo apenas para o ingrediente principal (Costela Suína 1,5kg, custo R$30); demais ingredientes (temperos) listados só com quantidade em unidades caseiras (colher), sem custo/rendimento individual.
- Registro sanitário: Serviço de Inspeção Municipal Nº 30 (dado real, aba "INF NUTRICIONAL").
- Composição de custo de produção por produto para os 13 produtos da aba "CUSTOS PRODUÇÃO": peso bruto, perda, sobra, formas de porcionamento (500g/180g/desfiada/moída).

## Limpeza Realizada

Nenhuma duplicata de registro foi identificada nos dados fornecidos — as 13 linhas da aba "CUSTOS PRODUÇÃO" e os 10 SKUs da aba "CODIGOS"/"PROJEÇÃO DE VENDAS" representam produtos distintos, sem repetição. Não houve normalização de formato de número, texto ou data realizada nesta etapa, pois os dados foram recebidos já estruturados em tabela.

Inconsistências identificadas nos dados (documentadas, não corrigidas — cruzamento de dados entre abas da mesma planilha):

1. **Divergência de custo de embalagem:** a aba "CUSTO EMBALAGEM" consolida um "Custo por embalagem" de R$3,82, enquanto a aba "CUSTOS PRODUÇÃO" usa R$3,85 fixo como "Custo Emb." em todos os 13 produtos. Diferença de R$0,03. Hipótese a validar: arredondamento ou atualização de cotação não propagada — não confirmado.
2. **Rótulo "Custo Temperos" possivelmente trocado:** a aba "CUSTOS PRODUÇÃO" usa R$0,25 fixo como "Custo Temperos" por produto, valor que na aba "CUSTO EMBALAGEM" aparece como "Emb. Vácuo R$0,25". Hipótese a validar: possível erro de rótulo ou cópia entre células na planilha original — não confirmado como erro, apenas coincidência de valor identificada.
3. **Relação "Lucro" vs. "Lucro Real" não confirmada:** na aba "PROJEÇÃO DE VENDAS", a diferença entre "Lucro" (R$41.265,29) e "Lucro Real" (R$22.070,29) é de R$19.195,00 — valor idêntico ao Custo Operacional total mensal da aba "CUSTOS PRODUÇÃO". Hipótese a validar: "Lucro Real" pode ser o lucro líquido após dedução dos custos fixos mensais — mas nenhuma fórmula visível na planilha confirma esse cálculo; tratada como coincidência numérica observada, não como fato.
4. **SKUs com erro de fórmula:** 0364-009 (Farofa Crocante) e 0364-010 (Chutney de Abacaxi) apresentam ERRO #VALUE! e ERRO #DIV/0! na aba "PROJEÇÃO DE VENDAS", indicando célula de referência ausente ou quebrada na planilha original (provavelmente por falta de quantidade projetada preenchida para esses SKUs).
5. **Farofa Crocante sem preço de venda:** na aba "CUSTOS PRODUÇÃO", Farofa Crocante tem custo final (R$17,50) mas nenhum valor de revenda, CMV ou lucro preenchido.

## Dados Não Fornecidos

### Financeiro
- Rateio de custo fixo mensal (R$19.195,00) por produto ou por canal — não fornecido; a planilha não detalha critério de alocação.
- Margem líquida por produto e por canal considerando custos fixos — dados não fornecidos, exceto o indício não confirmado do "Lucro Real" agregado (item 3 da Limpeza Realizada), que não é aberto por produto/canal.
- Histórico de vendas realizado (valores efetivamente vendidos/faturados em meses anteriores) — dados não fornecidos. A "Projeção de Vendas" é uma meta/projeção, não um registro de vendas passadas.
- Fluxo de caixa, inadimplência, prazo médio de recebimento por canal — dados não fornecidos.
- Custo de frete/logística por canal (varejo vs. atacado vs. assinatura) — dados não fornecidos.

### Comercial
- Qualquer dado-base sobre o plano de assinaturas (preço, periodicidade, mix de produtos, público-alvo, capacidade operacional) — dados não fornecidos. O plano de assinaturas ainda não existe e não há nenhuma referência na planilha.
- Preços atacado/varejo e CMV para os SKUs 0364-009 (Farofa Crocante) e 0364-010 (Chutney de Abacaxi) — dados não fornecidos (erro de fórmula na origem, ver Limpeza Realizada).
- Colunas "CUSTO", "DISTRIBUIÇÃO", "VENDA", "CMV" da aba "CODIGOS" — dados não fornecidos (células vazias).
- Dados de demanda real por canal (quantos clientes/pedidos de fato em varejo vs. atacado) — dados não fornecidos; existe apenas a projeção de 72 unidades/pedido x 33 pedidos/mês, que é meta, não demanda observada.
- Base de clientes por canal (número de clientes ativos, ticket médio real, recorrência) — dados não fornecidos.
- Concorrência e posicionamento de preço no mercado (benchmark externo) — dados não fornecidos.

### Produção
- Dados nutricionais completos (Valor Energético, Carboidratos, Açúcares, Proteínas, Gorduras, Fibras, Sódio) para a Costela Suína Defumada — dados não fornecidos (template presente, valores vazios).
- Data de Fabricação, Validade e Lote da ficha técnica da Costela Suína Defumada — dados não fornecidos (campos vazios).
- Custo e rendimento individualizado dos temperos (Açúcar Mascavo, Sal de Parrila, Páprica Defumada, Pimenta do Reino, Alho em Pó, Cebola em Pó) — dados não fornecidos; apenas quantidade em medida caseira (colher) está disponível, sem custo unitário nem conversão de rendimento.
- Ficha técnica completa (com custo/rendimento) para os demais 12 produtos além da Costela Suína Defumada — dados não fornecidos; a aba "INF NUTRICIONAL" cobre apenas 1 produto.
- Capacidade produtiva mensal real (limite de produção da central da 364 Food Services) — dados não fornecidos; não é possível validar se a meta de 33 pedidos/mês é operacionalmente viável.
- Perdas e desperdício em % (mencionadas como colunas "perda"/"sobra" na aba de custos, mas sem valores numéricos apresentados no resumo desta etapa) — dados não fornecidos nesta verificação.

## Recomendação de Escopo

Os dados fornecidos são suficientes para uma **análise financeira preliminar de margem bruta por produto** (CMV e lucro bruto por unidade, com base em custo direto de produção, tempero e embalagem) e para uma **reprecificação pontual** dos produtos já mapeados nas abas "CUSTOS PRODUÇÃO" e "PROJEÇÃO DE VENDAS", incluindo comparação varejo vs. atacado nos 2 produtos com dado explícito (panceta, costelinha) — sempre citando que essa comparação está sem custos fixos rateados, conforme nota da própria planilha.

Essa análise deve ser marcada como **preliminar**, pelos seguintes motivos:
1. Não há histórico de vendas real — apenas uma projeção/meta —, o que impede qualquer análise de tendência de vendas ou dimensionamento realista de demanda por canal.
2. Não há rateio de custo fixo por produto/canal, então a margem líquida real por produto permanece dados não fornecidos, com exceção do indício não confirmado do "Lucro Real" agregado (hipótese a validar, não fato).
3. Duas inconsistências de valor (R$3,82 vs. R$3,85 em embalagem; possível rótulo trocado em "Custo Temperos") precisam ser esclarecidas com Gustavo antes de qualquer reprecificação oficial ser aprovada, para não propagar erro de origem.
4. O plano de assinaturas não tem nenhum dado-base na planilha e deverá ser desenhado do zero — inclusive premissas de preço, mix e capacidade — pelo Growth 364 e pelo CFO 364, em etapa própria do squad, não nesta verificação de dados.

Qualquer análise de projeção de vendas por canal (varejo, atacado, assinatura) deverá deixar explícito, em todas as tabelas e rankings subsequentes do squad, que os números de quantidade e faturamento têm como fonte a aba "PROJEÇÃO DE VENDAS" (meta), não vendas realizadas — para não induzir os demais especialistas do squad a tratar meta como resultado histórico.
