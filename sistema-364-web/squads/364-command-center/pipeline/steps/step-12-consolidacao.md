---
execution: inline
agent: atlas-364
outputFile: squads/364-command-center/output/executivo/12-consolidacao.md
---

# Step 12: Consolidação das Análises

## Context Loading

Load these files before executing:
- `squads/364-command-center/output/executivo/01-classificacao.md` — classificação e empresa envolvida.
- `squads/364-command-center/output/executivo/03-selecao-agentes.md` — quais especialistas foram acionados.
- Todas as saídas dos especialistas acionados: `output/financeiro/04-analise-cfo.md`,
  `output/operacoes/05-analise-coo.md`, `output/producao/06-analise-guardiao.md`,
  `output/comercial/07-analise-growth.md`, `output/marketing/08-analise-brand.md`,
  `output/pessoas/09-analise-people.md`, `output/dashboards/10-analise-insight.md`,
  `output/projetos/11-analise-pmo.md` (ignorar os marcados "Não acionado nesta demanda").
- `squads/364-command-center/pipeline/data/domain-framework.md` — Etapa 5 (Consolidação).

## Instructions

### Process

1. Ler todas as análises dos especialistas efetivamente acionados.
2. Verificar coerência numérica entre especialistas (ex: CMV do CFO 364 e rendimento do Guardião 364
   devem se sustentar mutuamente); resolver ou explicitar qualquer contradição encontrada.
3. Identificar e explicitar conflitos de prioridade entre empresas do grupo, se existirem.
4. Consolidar em uma visão executiva única com as 10 seções obrigatórias do Atlas 364: resumo executivo,
   situação atual, evidências, riscos, recomendação, plano de ação (referência, detalhado no Step 13),
   responsáveis, prazos, indicadores de sucesso, assuntos pendentes de aprovação de Gustavo.

## Output Format

The output MUST follow this exact structure:
```
# Consolidação Executiva — Atlas 364
**Empresa:** [empresa] | **Categoria:** [categorias]

## Resumo Executivo
[3-5 frases objetivas]

## Situação Atual
[contexto]

## Principais Evidências
[lista, com origem: real/estimativa/hipótese]

## Riscos
[financeiros, operacionais, sanitários, jurídicos, de imagem — conforme identificados pelos especialistas]

## Recomendação
[síntese da recomendação geral]

## Responsáveis
[lista]

## Prazos
[lista]

## Indicadores de Sucesso
[lista]

## Assuntos que Dependem da Aprovação de Gustavo
[lista]

## Conflitos entre Empresas do Grupo
[se houver, ou "nenhum identificado"]
```

## Output Example

```markdown
# Consolidação Executiva — Atlas 364
**Empresa:** 364 Food Services | **Categoria:** financeira, produção, qualidade

## Resumo Executivo
A margem bruta da linha de defumados caiu de 34% para 27% em 60 dias. A causa combina aumento de 18% no
custo de matéria-prima com perda de rendimento de produção acima do padrão (76,4% vs. 80%).

## Situação Atual
Custo de matéria-prima subiu; rendimento caiu; nenhum reajuste de preço desde outubro/2025.

## Principais Evidências
- CMV subiu de 46% para 53% (CFO 364, dado real).
- Rendimento 76,4% vs. padrão de 80% (Guardião 364, dado real).
- Fornecedor alternativo 9% mais barato ainda não validado (hipótese).

## Riscos
Financeiro: erosão contínua de margem. Sanitário: processo de defumação deve ser revalidado por
responsável técnico (recomendação preliminar do Guardião 364).

## Recomendação
Revisar tempo de defumação; reajustar preço em 6-8%; buscar cotação de fornecedor alternativo.

## Responsáveis
Guardião 364 (processo), CFO 364 (precificação), Gustavo (aprovação do reajuste).

## Prazos
Diagnóstico de processo: 5 dias úteis. Proposta de reajuste: 10 dias úteis.

## Indicadores de Sucesso
Margem bruta ≥ 32% em 60 dias; rendimento ≥ 80%.

## Assuntos que Dependem da Aprovação de Gustavo
Reajuste de preço; troca de fornecedor de matéria-prima.

## Conflitos entre Empresas do Grupo
Nenhum identificado nesta demanda.
```

## Veto Conditions

Reject and redo if ANY of these are true:
1. Uma contradição numérica entre especialistas foi ignorada em vez de resolvida ou explicitada.
2. A consolidação omite um risco relevante levantado por qualquer especialista acionado.

## Quality Criteria

- [ ] As 10 seções obrigatórias estão presentes.
- [ ] Toda evidência indica sua origem (real/estimativa/hipótese).
- [ ] Conflitos entre empresas do grupo são explicitamente avaliados, mesmo quando o resultado é "nenhum identificado".
