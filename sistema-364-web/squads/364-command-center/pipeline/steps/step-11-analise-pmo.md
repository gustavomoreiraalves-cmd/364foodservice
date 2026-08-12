---
execution: subagent
agent: pmo-364
model_tier: powerful
inputFile: squads/364-command-center/output/executivo/03-selecao-agentes.md
outputFile: squads/364-command-center/output/projetos/11-analise-pmo.md
---

# Step 11: Análise de Projeto — PMO 364

## Context Loading

Load these files before executing:
- `squads/364-command-center/output/executivo/03-selecao-agentes.md` — confirmar se o PMO 364 foi acionado; se "não", produzir apenas a nota de não acionamento e encerrar.
- `squads/364-command-center/output/executivo/02-verificacao-dados.md` — dados de projeto fornecidos e ausentes.
- `squads/364-command-center/_memory/memories.md` — seção "Projetos" para histórico relevante.
- `squads/364-command-center/agents/pmo-364.agent.md` — framework operacional e exemplos de referência.

## Instructions

### Process

1. Verificar se o PMO 364 foi acionado no Step 03. Se não, produzir "Não acionado nesta demanda" e encerrar.
2. Identificar o projeto envolvido e levantar o status atual (concluído, em andamento, pendente).
3. Construir/atualizar o cronograma com marcos, responsáveis, prazos e dependências; classificar riscos
   por probabilidade e impacto.
4. Registrar atrasos e causa raiz quando conhecida; listar decisões pendentes de aprovação de Gustavo.

## Output Format

The output MUST follow this exact structure:
```
# Status Report — PMO 364
**Projeto:** [nome do projeto] | **Data:** [data]

## Status Geral
[percentual concluído, status geral]

## Marcos
[tabela: marco, responsável, prazo, status]

## Atraso Identificado
[se houver, com causa raiz]

## Dependências
[relações entre etapas]

## Riscos
[probabilidade x impacto]

## Decisões Pendentes de Aprovação de Gustavo
[lista explícita]
```

## Output Example

```markdown
# Status Report — PMO 364
**Projeto:** Abertura da unidade 364 Steakhouse — Zona Norte | **Data:** 2026-07-21

## Status Geral
65% concluído. No prazo geral, com 1 marco atrasado.

## Marcos
| Marco | Responsável | Prazo | Status |
|---|---|---|---|
| Reforma do espaço | Empreiteira parceira | 2026-07-15 | Atrasado (novo prazo: 2026-07-30) |
| Contratação da equipe | People 364 + gerente | 2026-08-10 | Em andamento |

## Atraso Identificado
Reforma atrasou 15 dias por pendência de material elétrico.

## Dependências
Homologação sanitária depende da conclusão da reforma.

## Riscos
Probabilidade média / impacto alto: atraso pode empurrar abertura para depois da alta temporada.

## Decisões Pendentes de Aprovação de Gustavo
Confirmar se a data de abertura é mantida com risco, ou replanejada com margem de segurança.
```

## Veto Conditions

Reject and redo if ANY of these are true:
1. O agente não verificou se foi acionado no Step 03 antes de produzir a análise completa.
2. Um marco foi reportado sem responsável, prazo ou status definidos.

## Quality Criteria

- [ ] Todo marco tem responsável, prazo e status.
- [ ] Todo risco é classificado por probabilidade e impacto.
- [ ] Toda mudança de escopo/prazo estratégico é sinalizada como pendente de aprovação de Gustavo.
- [ ] Todo atraso identificado inclui causa raiz quando conhecida.
