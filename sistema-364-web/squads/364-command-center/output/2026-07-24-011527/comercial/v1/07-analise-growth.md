# Análise Comercial — Growth 364
**Empresa:** 364 Food Services

## Análise por Canal

| Canal | Volume real segregado | Preço médio unitário do mix (8 SKUs precificados) | Ticket médio (valor por pedido) | Variação vs. outro canal |
|---|---|---|---|---|
| Atacado | Dado não fornecido — a meta de 33 pedidos/mês (R$103.950, 2.376 un.) não é segregada por canal na planilha | R$43,13 (média simples dos 8 preços de atacado) | Dado não fornecido | Referência (base 1,00x) |
| Varejo | Dado não fornecido — mesma limitação acima | R$56,06 (média simples dos 8 preços de varejo) | Dado não fornecido | +30% vs. atacado (regra fixa Varejo = Atacado × 1,30, aplicada uniformemente aos 8 SKUs) |

Nota metodológica: os dois canais NÃO foram agregados em uma média única — a tabela mantém atacado e varejo em linhas separadas, exatamente porque misturá-los esconderia o efeito da regra de precificação. O único ponto de comparação direta e confiável hoje é o preço unitário por SKU (dado real da planilha), não o volume ou o ticket médio por pedido (dados não fornecidos).

Adicionalmente, há um comparativo simulado — não uma divisão real observada de vendas — disponível para 2 produtos (Panceta e Costelinha), em que a mesma quantidade produzida foi projetada como "se vendida 100% no varejo" vs. "se vendida 100% no atacado":
- Panceta (98 un.): receita simulada varejo R$4.459 vs. atacado R$3.430 (diferença de R$1.029, coerente com o fator 1,30x).
- Costelinha (68 un.): receita simulada varejo R$3.978 vs. atacado R$3.060 (diferença de R$918).

Isso é um exercício de cenário (what-if), não um dado de mix real de vendas entre canais, e não deve ser lido como "68% das vendas vão para varejo" ou qualquer proporção — não existe essa proporção nos dados.

## Insight

Isso significa que hoje a 364 Food Services tem uma REGRA de precificação por canal (atacado vs. varejo, diferença fixa de 30%), mas não tem um FUNIL COMERCIAL observável — não sabemos quantos pedidos, clientes ou receita real cada canal de fato gera. A meta de 33 pedidos/mês / R$103.950 é uma projeção agregada, sem desvio calculável contra realizado, porque não há dado de vendas realizadas por canal para comparar. Não é possível, com os dados atuais, afirmar se o atacado ou o varejo está performando melhor ou pior — qualquer afirmação nesse sentido seria inventada.

Isso também significa que não sabemos, hoje, se o canal de venda é físico (loja), digital (WhatsApp, e-commerce) ou via distribuidor — os rótulos "atacado" e "varejo" na planilha são categorias de PREÇO, não canais de venda operacionais. Essa é uma lacuna a esclarecer diretamente com Gustavo antes de qualquer plano de expansão comercial: como o cliente hoje efetivamente compra?

## Mix de Produtos

Catálogo comercial: 10 SKUs cadastrados na aba "CODIGOS", dos quais apenas 8 têm preço definido em ambos os canais. 2 SKUs estão "órfãos" comercialmente — cadastrados no catálogo, mas sem preço de venda:

| SKU | Produto | Situação | Custo de produção conhecido |
|---|---|---|---|
| 0364-009 | Farofa Crocante | Sem preço em nenhum canal | R$17,50 |
| 0364-010 | Chutney/Geléia de Abacaxi | Sem preço em nenhum canal (varejo aparece como R$0 por erro de fórmula na planilha original) | R$11,40 |

Todos os 8 SKUs precificados seguem a MESMA regra fixa (Varejo = Atacado × 1,30), sem qualquer diferenciação por elasticidade, categoria de produto (proteína nobre vs. acompanhamento, por exemplo) ou posicionamento. Isso é uma oportunidade de revisão de precificação — não uma decisão a ser tomada por este agente.

## Recomendação

1. **Precificar os 2 SKUs órfãos (Farofa Crocante e Chutney de Abacaxi).** Ação comercial: aplicar a mesma regra vigente (Varejo = Atacado × 1,30) sobre um preço-base de atacado a ser definido pelo CFO 364 com margem sobre o custo de produção já conhecido (Farofa: custo R$17,50; Chutney: custo R$11,40). Não é atribuição deste agente definir o preço-base final. Público-alvo: mesmo público que já compra o mix defumado (varejo e atacado atuais). Impacto estimado: como referência de ordem de grandeza — se o preço de atacado desses 2 SKUs for fixado próximo à média do mix atual (R$43,13), a receita potencial por unidade vendida seria da ordem de R$43 (atacado) a R$56 (varejo) por SKU, hoje R$0. Confiança: baixa — depende inteiramente da definição de preço-base pelo CFO e não há dado de demanda projetada para esses 2 SKUs especificamente.

2. **Esclarecer o canal de venda real com Gustavo antes de qualquer campanha ou expansão.** Ação: mapear se "atacado" e "varejo" correspondem a WhatsApp, distribuidor, loja física ou e-commerce — sem esse dado, nenhuma campanha pode ter público-alvo definido com precisão. Impacto estimado: não quantificável sem o dado. Confiança: alta de que essa é uma lacuna bloqueante (o próprio Step 02 já sinalizou a ausência).

3. **Revisar a regra de precificação uniforme (1,30x) por elasticidade de produto**, encaminhando ao CFO 364 uma análise de margem por SKU (cortes nobres como Cupim e Costela Desfiada podem sustentar diferencial de canal maior que 30%; itens de menor valor agregado, como Torresmo, podem não sustentar). Este agente não decide o novo percentual — apenas recomenda a revisão. Impacto estimado: não quantificável sem dados de margem por SKU do CFO 364. Confiança: média (padrão de mercado em defumados indica diferenciação por categoria, mas não há benchmark de concorrência nos dados fornecidos).

## Estrutura Proposta — Canal "Assinatura" (RASCUNHO, pendente de aprovação de Gustavo)

Este é um funil de decisão a ser validado por Gustavo, não uma definição de preço ou lançamento:

- **Periodicidade:** proposta inicial mensal (a validar — pode haver demanda por quinzenal).
- **Mix:** duas opções a decidir — (a) kit fixo curado pela 364 (facilita produção e padronização) vs. (b) escolha do cliente dentro de um teto de valor (maior atratividade, maior complexidade operacional). Recomenda-se validar capacidade produtiva com o COO 364 antes de decidir.
- **Preço:** proposta de posicionamento ENTRE o preço de atacado e o de varejo por SKU (racional: menor custo de aquisição recorrente para a 364, compensado por exigência de capacidade garantida) — nenhum valor final é definido aqui; depende de aprovação de Gustavo e de validação de capacidade com o COO 364.
- **Público-alvo:** clientes de varejo recorrente (hipótese — não há dado de recorrência real de clientes hoje; ver seção "Dados Não Fornecidos").
- **Status:** RASCUNHO. Não deve ser comunicado a clientes ou precificado publicamente até checkpoint de aprovação de Gustavo Moreira Alves.

## Oportunidade de Expansão

**Clientes inativos:** dados não fornecidos. Não existe hoje nenhuma base de clientes, histórico de recorrência ou critério de inatividade na planilha fornecida — portanto não há "cliente inativo" a reportar nesta rodada. Esta seção fica em aberto até que uma base de clientes com histórico de pedidos seja disponibilizada.

**Funil B2B (atacado):** não é possível analisar separadamente do consumidor final além da diferença de preço, porque não há dado de clientes de atacado (quantidade, distribuidores, recorrência, ticket médio real). A estrutura de preço de atacado existe; o funil comercial de atacado (prospecção, negociação, fechamento) não está documentado nos dados fornecidos.

**Canal assinatura:** conforme seção anterior — é a maior oportunidade de expansão identificada na demanda de Gustavo, mas depende de decisões estruturais (periodicidade, mix, preço, capacidade) ainda não tomadas.

## Dados Não Fornecidos

- Canal de venda real associado a "atacado" e "varejo" (WhatsApp, loja física, e-commerce, distribuidor).
- Volume de pedidos e receita realizada segregados por canal (a meta de 33 pedidos/mês / R$103.950 é agregada, sem split).
- Ticket médio real por pedido, por canal.
- Base de clientes por canal: número de clientes ativos, recorrência, critério e lista de clientes inativos.
- Preço-base para os 2 SKUs órfãos (Farofa Crocante, Chutney de Abacaxi) — apenas custo de produção é conhecido.
- Dados de concorrência e benchmark de preço de mercado para defumados/processados.
- Qualquer dado-base do plano de assinaturas: preço, periodicidade, mix, público-alvo real, capacidade produtiva disponível para o canal (a validar com COO 364).
- Dados de margem por SKU (necessários para avaliar se a regra de precificação 1,30x deveria variar por produto) — atribuição do CFO 364.
