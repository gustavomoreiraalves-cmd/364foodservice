---
execution: subagent
agent: brand-364
model_tier: powerful
inputFile: squads/364-command-center/output/executivo/03-selecao-agentes.md
outputFile: squads/364-command-center/output/marketing/08-analise-brand.md
---

# Step 08: Análise de Marketing — Brand 364

## Context Loading

Load these files before executing:
- `squads/364-command-center/output/executivo/03-selecao-agentes.md` — confirmar se o Brand 364 foi acionado; se "não", produzir apenas a nota de não acionamento e encerrar.
- `squads/364-command-center/output/executivo/02-verificacao-dados.md` — dados de desempenho de conteúdo fornecidos e ausentes.
- `squads/364-command-center/pipeline/data/research-brief.md` — posicionamento de cada marca do grupo.
- `squads/364-command-center/agents/brand-364.agent.md` — framework operacional e exemplos de referência.

## Instructions

### Process

1. Verificar se o Brand 364 foi acionado no Step 03. Se não, produzir "Não acionado nesta demanda" e encerrar.
2. Identificar a marca envolvida e revisar seu posicionamento formal antes de propor qualquer copy.
3. Rascunhar copy, roteiro ou briefing alinhado ao tom de voz específico da marca, sempre marcado como
   rascunho pendente de aprovação.
4. Analisar desempenho de conteúdo anterior com dados reais quando disponíveis.

## Output Format

The output MUST follow this exact structure:
```
# Briefing de Marketing — Brand 364
**Marca:** [marca] | **Posicionamento:** [posicionamento formal]

## Objetivo
[objetivo da peça/campanha]

## Aderência ao Posicionamento
[verificação explícita]

## Copy/Roteiro Rascunho (não publicado — aguarda aprovação)
[conteúdo rascunho]

## Calendário Sugerido
[se aplicável]

## Assuntos que Dependem da Aprovação de Gustavo
[publicação, envio, fechamento de parceria]

## Dados Não Fornecidos
[lista explícita]
```

## Output Example

```markdown
# Briefing de Marketing — Brand 364
**Marca:** 364 Food Services | **Posicionamento:** defumação artesanal, conveniência, padronização e qualidade

## Objetivo
Apresentar a nova linha de defumados em porção individual para o canal de supermercados.

## Aderência ao Posicionamento
Mensagem de "praticidade sem perder o artesanal" alinhada ao posicionamento; evitar linguagem de "fast
food" ou "industrializado".

## Copy Rascunho (não publicado — aguarda aprovação)
"Defumação de verdade, na medida certa pra sua semana. Conheça a nova linha individual da 364 Food
Services."

## Calendário Sugerido
Semana 1: teaser. Semana 2: lançamento. Semana 3: depoimentos. Semana 4: análise de desempenho.

## Assuntos que Dependem da Aprovação de Gustavo
Publicação de qualquer peça; envio de mensagens; fechamento de parceria com criador de conteúdo.

## Dados Não Fornecidos
Desempenho histórico de lançamentos anteriores da linha; orçamento disponível para mídia paga.
```

## Veto Conditions

Reject and redo if ANY of these are true:
1. O agente não verificou se foi acionado no Step 03 antes de produzir a análise completa.
2. Uma peça de comunicação foi apresentada sem a marcação explícita de rascunho pendente de aprovação.

## Quality Criteria

- [ ] Toda peça de comunicação está marcada como rascunho pendente de aprovação.
- [ ] O tom de voz aplicado corresponde à marca específica da demanda.
- [ ] Nenhuma saída implica publicação, envio ou fechamento de parceria já realizado.
- [ ] Todo dado ausente relevante está listado na seção "Dados Não Fornecidos".
