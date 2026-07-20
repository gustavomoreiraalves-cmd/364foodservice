# Análise do Conselho — Sobras de limpeza e manipulação (crua e defumada)
**Data:** 2026-07-19 · **Solicitante:** Gustavo · **Analistas:** Fernanda Fluxo (CFO), Bento Benchmark (BI), com Gastão Gastronomia e Ivone Indústria convocados
**Fonte de dados:** FICHA TECNICA FOOD SERVICE.xlsx (lotes reais) + novo módulo de Defumação do sistema

## O tamanho real do problema (seus próprios números)

A ficha técnica mostra que a sobra não é um detalhe — na costelinha suína ela é **quase metade do peso comprado**:

| Lote (ficha) | Peso comprado | Sobra | % sobra |
|---|---|---|---|
| Costelinha BBQ 1 | 2,644 kg | 1,300 kg | **49,2%** |
| Costelinha BBQ 2 | 2,714 kg | 1,264 kg | **46,6%** |
| Costelinha BBQ 3 | 3,100 kg | 1,338 kg | **43,2%** |
| Costelinha BBQ 4 | 2,574 kg | 1,288 kg | **50,0%** |
| Panceta 1 | 5,656 kg | 0,454 kg | 8,0% |
| Panceta 2 | 6,125 kg | 0,698 kg | 11,4% |
| Costela Bovina 1 | 9,530 kg | 0,534 kg | 5,6% |

**Tradução financeira (CFO):** a R$ 20/kg de compra, cada lote de costelinha "empata" ~R$ 26 em sobra. O custo REAL por kg defumado de costelinha só fecha a conta da ficha (R$ 49,89/kg) porque a sobra hoje é tratada como custo perdido. **Não é prejuízo — mas é capital parado em proteína, e vai crescer linearmente com a produção.**

## A grande sacada: a sobra é matéria-prima já paga — MAS as sobras têm espécies diferentes

**Correção do usuário (19/07):** as fichas técnicas confirmam que **Croquete e Escondidinho usam APENAS Costela Mindinha (bovina)** — não carne suína. Isso divide o problema em dois fluxos distintos:

**Fluxo bovino (resolvido):** a sobra da Costela Mindinha (~5,6% por lote) é pequena e já tem destino natural nos derivados de maior margem — Croquete (68%) e Escondidinho (65,7%). Toda sobra bovina reaproveitada "devolve" seu custo ao lote.

**Fluxo suíno (o problema real — SEM destino de produto hoje):** a costelinha suína gera a sobra gigante (43–50%) e nenhum derivado do catálogo a consome. Recomendação do Gastão Gastronomia: **criar um SKU de aproveitamento suíno** — o candidato óbvio é o **Pulled Pork Defumado** (a sobra de costelinha desfiada É pulled pork): produto clássico do American BBQ, presente no nicho (o benchmark Tio Jack vende exatamente isso para food service — "creme de abóbora com pulled pork" [Fonte: Investigação]), com custo de insumo praticamente zero (sobra já paga) e margem potencial na faixa dos derivados (60%+). Alternativas: croquete de porco, panelinha de costelinha, linguiça defumada artesanal.

> Conta do Pulled Pork: sobra suína ~1,3 kg/lote já paga → embalado a 500g com custo marginal só de tempero+embalagem (~R$ 4,10) → vendido na faixa de R$ 35–40 = margem ~85% no insumo aproveitado. Até o novo SKU existir, a sobra suína segue a hierarquia: cota da janta → congelar etiquetado → retalho B2B.

## Recomendações (em ordem de prioridade)

1. **Hierarquia oficial de destino da sobra** (registrar em cada ficha de defumação), **separada por espécie**:
   **Bovina (Costela Mindinha):** 1º derivados existentes (croquete/escondidinho); 2º congelar etiquetado como banco de insumo.
   **Suína (costelinha/panceta):** 1º desenvolver o **SKU Pulled Pork Defumado** (teste de receita com o Gastão + validação de preço na degustação do lançamento); 2º janta dos funcionários com cota fixa (ex.: 4 kg/semana); 3º congelar etiquetado aguardando o SKU; 4º retalho B2B (preço de recuperação).
2. **Novo indicador do BI — "custo por kg aproveitável"** (não por kg comprado): costelinha a R$ 20/kg com ~47% de sobra + rendimento térmico ≈ custo real de R$ 38–40/kg utilizável se a sobra for desperdiçada, ~R$ 25/kg se reaproveitada. Leitura quinzenal por matéria-prima.
3. **Compra mais inteligente (gatilho revisado):** sobra de ~50% indica especificação de corte do fornecedor. Cotar **costelinha mais limpa/peça magra**: vale pagar até ~R$ 25–28/kg por um corte com sobra ≤ 20%, porque o custo por kg aproveitável fica menor que o corte "barato" de R$ 20. Comparar SEMPRE pelo custo aproveitável.
4. **Balancear produção de derivados com a geração de sobra:** regra prática — a cada ~2 lotes de costelinha defumada, programar 1 produção de croquete/escondidinho para consumir a sobra acumulada antes do shelf-life.
5. **Sistema já instrumentado:** a nova Ficha de Defumação registra `sobra_kg` e `perda_limpeza_kg` por matéria-prima e por lote — em 30 dias teremos a média real por corte para transformar estas premissas em metas oficiais.

## Metas propostas (validar após 30 dias de dados reais)

| Indicador | Meta inicial | Leitura |
|---|---|---|
| % sobra costelinha suína | ≤ 35% (hoje ~47%) via espec de compra | por lote |
| % sobra reaproveitada em derivados | ≥ 70% da sobra gerada | quinzenal |
| Cota janta funcionários | definida por Gustavo (sugestão: 4 kg/sem) | semanal |
| Custo por kg aproveitável (costelinha) | ≤ R$ 30 | quinzenal |

*Análise registrada pelo Conselho 364. Próxima revisão: com 30 dias de dados das fichas de defumação.*
