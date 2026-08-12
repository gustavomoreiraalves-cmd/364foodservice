---
execution: subagent
agent: coo-364
model_tier: powerful
inputFile: squads/364-command-center/output/executivo/03-selecao-agentes.md
outputFile: squads/364-command-center/output/operacoes/05-analise-coo.md
---

# Step 05: Análise Operacional — COO 364

## Context Loading

Load these files before executing:
- `squads/364-command-center/output/executivo/03-selecao-agentes.md` — confirmar se o COO 364 foi acionado; se "não", produzir apenas a nota de não acionamento e encerrar.
- `squads/364-command-center/output/executivo/02-verificacao-dados.md` — dados operacionais fornecidos e ausentes.
- `squads/364-command-center/pipeline/data/quality-criteria.md` — critérios específicos do COO 364.
- `squads/364-command-center/agents/coo-364.agent.md` — framework operacional e exemplos de referência.

## Instructions

### Process

1. Verificar se o COO 364 foi acionado no Step 03. Se não, produzir "Não acionado nesta demanda" e encerrar.
2. Levantar os processos operacionais envolvidos (abertura/fechamento, cozinha, delivery, estoque,
   atendimento) e o estado atual de padronização, comparando unidades quando houver mais de uma envolvida.
3. Identificar gargalos de produtividade e desperdício com dados quantificados quando disponíveis.
4. Propor plano de melhoria com etapas concretas, responsável e prazo por unidade.

## Output Format

The output MUST follow this exact structure:
```
# Análise Operacional — COO 364
**Empresa(s):** [unidade(s)] | **Categoria:** operacional

## Situação Atual
[processos, dados quantificados]

## Análise
[gargalos, comparação entre unidades quando aplicável]

## Desperdício Identificado
[se aplicável]

## Plano de Melhoria
[etapas numeradas com responsável e prazo]

## Indicador de Sucesso
[métrica objetiva]

## Riscos
[riscos operacionais relevantes]

## Dados Não Fornecidos
[lista explícita]
```

## Output Example

```markdown
# Análise Operacional — COO 364
**Empresa:** 364 Steakhouse (unidade centro)

## Situação Atual
Tempo médio de expedição de delivery: 22 min (dado real, 30 dias, sistema de pedidos). Sem checklist
visual de expedição na unidade centro (observação registrada em visita).

## Análise
O foodtruck do grupo, com checklist visual na bancada, tem tempo médio de 14 min — indicando que a
diferença está na etapa de montagem final, não no preparo.

## Desperdício Identificado
Taxa de reembalagem por erro de pedido: 4,1% na unidade centro (dado real).

## Plano de Melhoria
1. Implantar checklist visual de expedição (responsável: gerente da unidade, prazo 7 dias).
2. Treinamento de 30 min com a equipe (responsável: COO 364 + gerente, prazo 10 dias).
3. Reavaliar tempo médio após 15 dias.

## Indicador de Sucesso
Tempo médio de expedição abaixo de 16 min; taxa de erro abaixo de 2%.

## Riscos
Resistência da equipe à mudança de rotina — mitigar com treinamento prático.

## Dados Não Fornecidos
Custo de mão de obra da etapa de expedição; volume de pedidos por horário de pico.
```

## Veto Conditions

Reject and redo if ANY of these are true:
1. O agente não verificou se foi acionado no Step 03 antes de produzir a análise completa.
2. Uma comparação entre unidades foi feita sem considerar diferenças estruturais (porte, tipo de operação).

## Quality Criteria

- [ ] Toda comparação entre unidades usa métricas quantificadas.
- [ ] Todo plano de melhoria tem responsável e prazo por etapa.
- [ ] Riscos operacionais relevantes são sinalizados mesmo se fora do escopo original.
- [ ] Todo dado ausente relevante está listado na seção "Dados Não Fornecidos".
