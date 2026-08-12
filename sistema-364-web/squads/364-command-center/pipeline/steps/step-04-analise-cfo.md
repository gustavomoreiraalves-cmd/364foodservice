---
execution: subagent
agent: cfo-364
model_tier: powerful
inputFile: squads/364-command-center/output/executivo/03-selecao-agentes.md
outputFile: squads/364-command-center/output/financeiro/04-analise-cfo.md
---

# Step 04: Análise Financeira — CFO 364

## Context Loading

Load these files before executing:
- `squads/364-command-center/output/executivo/03-selecao-agentes.md` — confirmar se o CFO 364 foi acionado; se "não", produzir apenas a nota de não acionamento (ver Veto Conditions) e encerrar o step.
- `squads/364-command-center/output/executivo/02-verificacao-dados.md` — dados financeiros fornecidos e ausentes.
- `squads/364-command-center/pipeline/data/quality-criteria.md` — critérios específicos do CFO 364.
- `squads/364-command-center/agents/cfo-364.agent.md` — framework operacional, vocabulário e exemplos de referência.

## Instructions

### Process

1. Verificar em `03-selecao-agentes.md` se o CFO 364 foi acionado. Se não, produzir a saída "Não acionado
   nesta demanda" e encerrar imediatamente.
2. Se acionado, reunir os dados financeiros fornecidos (faturamento, custos, despesas) e classificá-los
   como reais, estimados ou hipotéticos.
3. Calcular CMV, margem bruta e margem de contribuição por produto/unidade quando os dados permitirem;
   comparar orçado versus realizado.
4. Produzir a recomendação financeira com impacto estimado em R$ e nível de confiança, listando
   explicitamente todo dado não fornecido.

## Output Format

The output MUST follow this exact structure:
```
# Análise Financeira — CFO 364
**Empresa:** [empresa/unidade] | **Categoria:** financeira

## Dados Reais
[lista com fonte]

## Estimativas
[lista com método de estimativa]

## Cálculos
[CMV, margem bruta, margem de contribuição, ponto de equilíbrio, conforme aplicável]

## Comparação Orçado x Realizado
[quando disponível]

## Insight
[interpretação com "isso significa que..."]

## Recomendação
[ação recomendada, impacto estimado em R$, nível de confiança]

## Dados Não Fornecidos
[lista explícita]
```

## Output Example

```markdown
# Análise Financeira — CFO 364
**Empresa:** 364 Food Services | **Categoria:** financeira

## Dados Reais
Margem bruta da linha de defumados: 34% (60 dias atrás) → 27% (atual), dado real informado por Gustavo.
Custo de matéria-prima subiu 18% no período (dado real, planilha de compras).

## Estimativas
Impacto de reajuste de preço de 7% sobre a margem: estimado em +6,5 p.p. de margem bruta (estimativa
baseada no volume médio dos últimos 30 dias).

## Cálculos
CMV atual: 53% (era 46%). Margem de contribuição não pôde ser calculada com precisão por falta de rateio
de despesas variáveis específico da linha (ver Dados Não Fornecidos).

## Comparação Orçado x Realizado
Sem CMV orçado disponível para esta linha — comparação limitada ao histórico de 60 dias.

## Insight
O aumento de custo de matéria-prima (+18%) combinado à perda de rendimento reportada pelo Guardião 364
explica a maior parte da queda de margem. Isso significa que a solução precisa endereçar tanto preço
quanto processo, não apenas um dos dois.

## Recomendação
Reajustar o preço da linha em 6-8%, com impacto estimado de recuperação de margem bruta para ~33-35%
(confiança média — baseada em 60 dias de dado e projeção de elasticidade não testada).

## Dados Não Fornecidos
CMV orçado para a linha; rateio de despesas variáveis específico; elasticidade de preço real do cliente.
```

## Veto Conditions

Reject and redo if ANY of these are true:
1. O agente não verificou se foi acionado no Step 03 antes de produzir a análise completa.
2. Algum número financeiro foi apresentado sem indicar se é dado real, estimativa ou hipótese.

## Quality Criteria

- [ ] Todo número financeiro tem origem identificada (real/estimativa/hipótese).
- [ ] CMV, margem bruta e margem de contribuição aparecem quando os dados permitirem o cálculo.
- [ ] Nenhuma recomendação de preço ou investimento é apresentada como decisão fechada.
- [ ] Todo dado ausente relevante está listado na seção "Dados Não Fornecidos".
