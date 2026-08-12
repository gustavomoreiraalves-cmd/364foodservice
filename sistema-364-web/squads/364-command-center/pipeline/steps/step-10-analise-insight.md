---
execution: subagent
agent: insight-364
model_tier: powerful
inputFile: squads/364-command-center/output/executivo/03-selecao-agentes.md
outputFile: squads/364-command-center/output/dashboards/10-analise-insight.md
---

# Step 10: Análise de Dados Dedicada — Insight 364

## Context Loading

Load these files before executing:
- `squads/364-command-center/output/executivo/03-selecao-agentes.md` — confirmar se o Insight 364 foi acionado para análise dedicada (distinta da verificação já feita no Step 02); se "não", produzir apenas a nota de não acionamento e encerrar.
- `squads/364-command-center/output/executivo/02-verificacao-dados.md` — dados já organizados na verificação inicial.
- Planilhas/exports adicionais fornecidos especificamente para cruzamento de dados.
- `squads/364-command-center/agents/insight-364.agent.md` — framework operacional e exemplos de referência.

## Instructions

### Process

1. Verificar se o Insight 364 foi acionado para análise dedicada no Step 03. Se não, produzir "Não
   acionado nesta demanda" e encerrar.
2. Cruzar informações entre fontes diferentes (ex: vendas x estoque x compras) exigidas pela demanda.
3. Comparar períodos e unidades, gerando rankings e identificando tendências e inconsistências.
4. Entregar os dados organizados, prontos para uso pelos demais especialistas na consolidação.

## Output Format

The output MUST follow this exact structure:
```
# Preparação de Dados — Insight 364
**Empresas:** [unidades envolvidas] | **Período:** [período analisado]

## Fontes Utilizadas
[lista com data de exportação/atualização]

## Limpeza Realizada
[o que foi corrigido]

## Cruzamento
[achados do cruzamento entre fontes]

## Ranking
[tabela, quando aplicável]

## Inconsistência Sinalizada
[se houver, marcada como hipótese a validar]

## Dados Não Fornecidos
[lista explícita]
```

## Output Example

```markdown
# Preparação de Dados — Insight 364
**Empresas:** 364 Steakhouse e 364 Food Services | **Período:** últimos 30 dias

## Fontes Utilizadas
Planilha de vendas (sistema de pedidos, exportada 14/07/2026); planilha de estoque (controle manual,
atualizada 13/07/2026).

## Limpeza Realizada
Removidas 6 linhas duplicadas na planilha de vendas; padronizado formato de data.

## Cruzamento
Produto "Costela Defumada 500g" teve 4 dias com estoque zerado no sistema de vendas, sem registro
correspondente na planilha de estoque físico.

## Ranking (top 5 produtos por volume, 30 dias)
| Posição | Produto | Volume (un) | Var. vs. período anterior |
|---|---|---|---|
| 1 | Hambúrguer Clássico | 1.840 | +6,2% |
| 2 | Costela Defumada 500g | 620 | -14,0% |

## Inconsistência Sinalizada
Hipótese de ruptura real não registrada no controle físico — requer validação com o responsável de
estoque.

## Dados Não Fornecidos
Motivo da divergência entre sistema de vendas e planilha física; dados de perda por vencimento.
```

## Veto Conditions

Reject and redo if ANY of these are true:
1. O agente não verificou se foi acionado no Step 03 antes de produzir a análise completa.
2. Uma inconsistência foi apresentada como causa confirmada em vez de hipótese a validar.

## Quality Criteria

- [ ] Toda lacuna de dado é explicitamente marcada como "dados não fornecidos".
- [ ] Toda limpeza de dados realizada é documentada.
- [ ] Todo ranking/cruzamento cita fonte e período dos dados.
- [ ] Nenhuma inconsistência é apresentada como causa confirmada sem validação.
