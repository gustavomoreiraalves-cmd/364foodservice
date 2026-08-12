# Análise Operacional — COO 364
**Empresa(s):** 364 Food Services | **Categoria:** operacional

## Situação Atual
A planilha `FICHA TECNICA FOOD SERVICE.xlsx` traz 13 produtos com custo, peso e formas de porcionamento (500g/180g/desfiada/moída) na aba "CUSTOS PRODUÇÃO", mas não contém tempo de processo por produto, throughput por hora nem capacidade instalada — não há como calcular quantas unidades a central de produção consegue entregar por semana.

A aba "PROJEÇÃO DE VENDAS" define uma meta comercial de 72 unidades/pedido x 33 pedidos/mês = 2.376 unidades/mês, distribuídas em 8 SKUs (Costela Defumada, Costela Desfiada, Cupim, Costelinha BBQ, Torresmo de Rolo, Hambúrguer Defumado, Croquete, Escondidinho). Esse número é uma **meta comercial**, não uma demanda observada nem uma capacidade validada.

O comparativo varejo vs. atacado existe para apenas 2 dos 13 produtos (panceta 98 un, costelinha 68 un), sem indicação do período de produção — não é uma amostra suficiente para caracterizar o fluxo operacional por canal.

O custo operacional fixo mensal é R$19.195,00, dos quais R$3.600,00/mês são Mão de Obra — dado real, mas sem detalhamento de headcount ou horas alocadas por etapa do processo (defumação, porcionamento, embalagem, expedição).

Não há checklist de abertura/fechamento, POP de produção ou POP de expedição documentado na planilha fornecida — o fluxo pedido → produção → expedição hoje não está formalizado por escrito, nem diferenciado por canal (varejo, atacado, futura assinatura).

## Análise
Não há múltiplas unidades operacionais no escopo desta rodada (o foco é a central de produção da 364 Food Services), portanto nenhuma comparação entre unidades foi feita — não há base para isso nos dados fornecidos.

O gargalo central é estrutural, não operacional-no-chão-de-fábrica: **a meta comercial foi definida sem que a capacidade produtiva real tenha sido apurada.** Sem tempo de processo e throughput/hora por produto, é impossível afirmar se 2.376 unidades/mês (ou os 33 pedidos/mês) cabem na capacidade instalada, e é igualmente impossível afirmar que não cabem — o dado simplesmente não existe hoje.

Um segundo gargalo é a ausência de fluxo operacional padrão por canal. Varejo, atacado e a futura assinatura têm perfis de pedido muito diferentes (recorrência, volume por pedido, prazo de expedição), mas hoje não há POP que diferencie como cada um é recebido, priorizado na produção e expedido. Isso tende a gerar disputa por capacidade entre canais sem critério definido — típico ponto de perda de throughput.

Um terceiro ponto é a concentração de custo fixo em Mão de Obra (R$3.600/mês) sem visibilidade de quantas pessoas/horas isso representa. Sem cruzar esse dado com throughput real, não é possível saber se há capacidade ociosa (custo fixo subutilizado) ou sobrecarga (equipe insuficiente para a meta) — qualquer conclusão nesse sentido seria impressão subjetiva, não dado.

## Desperdício Identificado
A planilha possui colunas de "perda"/"sobra" por produto, mas elas não estão consolidadas em uma taxa de desperdício (%). Mesmo não sendo o foco original da demanda, taxa de desperdício é indicador obrigatório de acompanhamento operacional em produção de defumados/processados (perda de matéria-prima tem impacto direto em margem, que é justamente o que a Ficha Técnica pretende precificar). Recomenda-se consolidar esse dado junto ao levantamento de capacidade (ver Plano de Melhoria, etapa 2), sem o que a margem por produto calculada no restante do projeto permanece incompleta.

## Plano de Melhoria
1. **Levantamento de capacidade produtiva real por produto/semana** — cronometrar tempo de processo (defumação, porcionamento, embalagem) dos 13 produtos e calcular throughput/hora e capacidade semanal.
   Responsável: liderança de produção da 364 Food Services (a designar por Gustavo Moreira Alves) | Prazo: 10 dias úteis, dividido em 2 blocos de produtos por semana.

2. **Consolidação da taxa de desperdício por produto** — usar as colunas "perda"/"sobra" já existentes na planilha e calcular % de perda nos últimos meses de produção disponíveis.
   Responsável: liderança de produção, em paralelo à etapa 1 | Prazo: 5 dias úteis.

3. **Desenho de fluxo operacional padrão por canal** (pedido → produção → expedição) para varejo e atacado — a assinatura fica de fora deste desenho até a etapa 5 validar viabilidade.
   Responsável: COO 364, com validação final de Gustavo Moreira Alves | Prazo: 5 dias úteis, iniciando após conclusão da etapa 1.

4. **Criação de checklist/POP de expedição por canal** (varejo e atacado), com critérios de conferência, embalagem e documentação de saída.
   Responsável: liderança de produção/expedição (a designar), com aprovação do COO 364 | Prazo: 5 dias úteis, em sequência à etapa 3.

5. **Checkpoint de viabilidade do canal de assinatura** — confrontar a capacidade apurada na etapa 1 com a meta de 33 pedidos/mês e decidir se, quando e em que volume o plano de assinatura pode ser lançado.
   Responsável: COO 364 + Comercial 364, decisão final de Gustavo Moreira Alves | Prazo: 3 dias úteis após conclusão da etapa 1.

Cada etapa é executável isoladamente em até 2 semanas; as etapas 3–5 dependem do resultado da etapa 1 e por isso estão sequenciadas, não paralelas.

## Indicador de Sucesso
Capacidade produtiva semanal (unidades/semana, por produto) apurada e documentada para os 13 produtos ao final da etapa 1; POP de expedição por canal (varejo e atacado) publicado e em uso ao final da etapa 4; percentual de desvio entre a meta comercial (2.376 un/mês) e a capacidade real apurada, calculado e reportado ao checkpoint de aprovação de Gustavo Moreira Alves.

## Riscos
- **Lançamento do canal de assinatura sem capacidade validada** é o risco operacional mais crítico: assinatura implica compromisso de entrega recorrente, e prometer recorrência sem throughput comprovado pode gerar quebra de entrega e dano de imagem junto a um cliente que paga por previsibilidade.
- **Meta comercial de 33 pedidos/mês definida sem validação de capacidade**: se a área comercial vender acima do que a produção sustenta, o resultado provável é atraso de pedido ou queda de padrão de qualidade sob pressão de prazo.
- **Ausência de POP/checklist de expedição por canal** gera variabilidade na separação e expedição de pedidos, aumentando risco de erro (produto trocado, quantidade incorreta) especialmente à medida que o volume de pedidos crescer.
- **Mão de obra sem detalhamento de headcount/horas**: se o levantamento de capacidade (etapa 1) indicar necessidade de ajuste de quadro (contratação ou realocação), essa decisão deve ser encaminhada ao People 364 — não é decidida nesta análise nem nesta rodada.
- **Rastreabilidade**: a ausência de fluxo e POP documentados também compromete rastreabilidade em caso de eventual necessidade de recall — ponto já sinalizado pelo Guardião sob a ótica de qualidade sanitária, aqui reforçado sob a ótica de processo.

## Dados Não Fornecidos
- Capacidade produtiva mensal/semanal real da central de produção da 364 Food Services.
- Tempo de processo por produto (defumação, porcionamento, embalagem) para os 13 SKUs.
- Fluxo atual de venda documentado (como um pedido varejo vs. atacado é hoje recebido, processado e expedido).
- Quantidade de pessoas na produção e alocação de mão de obra por etapa do processo.
- Taxa de desperdício consolidada em % (as colunas "perda"/"sobra" existem na planilha mas não estão consolidadas).
- Período de produção dos lotes usados no comparativo varejo vs. atacado (panceta 98 un, costelinha 68 un).
- Checklist de abertura/fechamento e POP de produção e de expedição documentados.
