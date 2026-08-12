---
execution: subagent
agent: people-364
model_tier: powerful
inputFile: squads/364-command-center/output/executivo/03-selecao-agentes.md
outputFile: squads/364-command-center/output/pessoas/09-analise-people.md
---

# Step 09: Análise de Pessoas e Cultura — People 364

## Context Loading

Load these files before executing:
- `squads/364-command-center/output/executivo/03-selecao-agentes.md` — confirmar se o People 364 foi acionado; se "não", produzir apenas a nota de não acionamento e encerrar.
- `squads/364-command-center/output/executivo/02-verificacao-dados.md` — dados de RH/relatos fornecidos e ausentes.
- `squads/364-command-center/_memory/memories.md` — valores do grupo já registrados.
- `squads/364-command-center/agents/people-364.agent.md` — framework operacional e exemplos de referência.

## Instructions

### Process

1. Verificar se o People 364 foi acionado no Step 03. Se não, produzir "Não acionado nesta demanda" e encerrar.
2. Identificar a pessoa, cargo, equipe ou unidade envolvida; separar fatos observáveis de interpretação.
3. Avaliar a situação à luz dos valores do grupo (verdade, excelência, serviço, respeito, responsabilidade,
   hospitalidade, senso de dono, melhoria contínua).
4. Propor plano de desenvolvimento com prazo de reavaliação, marcando qualquer aspecto disciplinar como
   recomendação preliminar sujeita a validação jurídica/trabalhista.

## Output Format

The output MUST follow this exact structure:
```
# Plano de Pessoas — People 364
**Empresa:** [empresa] | **Contexto:** [equipe/cargo]

## Situação Observada
[contexto geral]

## Fatos Observáveis (não interpretação)
[lista de fatos]

## Avaliação à Luz dos Valores do Grupo
[análise]

## Plano de Desenvolvimento Proposto
[etapas numeradas com responsável e prazo]

## Recomendação Preliminar
[quando envolver aspecto disciplinar/jurídico]

## Indicador de Sucesso
[métrica objetiva]

## Dados Não Fornecidos
[lista explícita]
```

## Output Example

```markdown
# Plano de Pessoas — People 364
**Empresa:** 364 Steakhouse | **Contexto:** Liderança de cozinha, unidade centro

## Situação Observada
Três colaboradores relataram dificuldade de comunicação com o líder de cozinha nos últimos 30 dias.

## Fatos Observáveis (não interpretação)
3 relatos independentes; nenhum registro formal de advertência; líder há 8 meses no cargo.

## Avaliação à Luz dos Valores do Grupo
O padrão tensiona respeito e hospitalidade internos; indica necessidade de desenvolvimento, não
necessariamente má intenção.

## Plano de Desenvolvimento Proposto
1. Conversa de feedback estruturado em até 3 dias úteis.
2. Mentoria de 4 semanas com líder mais experiente.
3. Reavaliação do clima da equipe em 30 dias.

## Recomendação Preliminar
Persistência do padrão pode exigir medida disciplinar formal, sujeita a validação de RH/jurídico.

## Indicador de Sucesso
Nenhum novo relato de comunicação agressiva em 30 dias.

## Dados Não Fornecidos
Histórico de avaliações de desempenho anteriores do líder.
```

## Veto Conditions

Reject and redo if ANY of these are true:
1. O agente não verificou se foi acionado no Step 03 antes de produzir a análise completa.
2. Fatos observáveis e interpretação subjetiva não foram claramente separados.

## Quality Criteria

- [ ] Fatos observáveis e interpretação estão claramente separados.
- [ ] Todo plano de desenvolvimento tem prazo de reavaliação.
- [ ] Nenhuma recomendação disciplinar é apresentada como definitiva sem validação jurídica.
- [ ] Todo dado ausente relevante está listado na seção "Dados Não Fornecidos".
