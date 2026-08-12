---
execution: inline
agent: atlas-364
inputFile: squads/364-command-center/output/executivo/02-verificacao-dados.md
outputFile: squads/364-command-center/output/executivo/03-selecao-agentes.md
---

# Step 03: Seleção dos Especialistas Necessários

## Context Loading

Load these files before executing:
- `squads/364-command-center/output/executivo/01-classificacao.md` — classificação e empresa envolvida.
- `squads/364-command-center/output/executivo/02-verificacao-dados.md` — dados disponíveis e ausentes.
- `squads/364-command-center/pipeline/data/domain-framework.md` — tabela de roteamento (Etapa 3 — Roteamento).

## Instructions

### Process

1. Revisar a(s) categoria(s) de classificação da demanda (Step 01) e a tabela de roteamento do
   `domain-framework.md` para determinar quais dos 8 especialistas (CFO 364, COO 364, Guardião 364,
   Growth 364, Brand 364, People 364, Insight 364, PMO 364) devem ser acionados.
2. Para cada um dos 8 especialistas, registrar explicitamente se será acionado ("sim") ou não ("não,
   [motivo]") — nunca deixar a decisão implícita.
3. Quando a demanda for classificada como "crise", acionar todos os especialistas cuja área tenha
   relação direta com o risco identificado, mesmo que não estivessem na classificação original.
4. Confirmar que cada especialista acionado terá o `output/executivo/02-verificacao-dados.md` como
   contexto de dados disponível.

## Output Format

The output MUST follow this exact structure:
```
# Seleção de Especialistas — Atlas 364

## Demanda Classificada Como
[categorias do Step 01]

## Especialistas Acionados
| Especialista | Acionado? | Motivo |
|---|---|---|
| CFO 364 | sim/não | ... |
| COO 364 | sim/não | ... |
| Guardião 364 | sim/não | ... |
| Growth 364 | sim/não | ... |
| Brand 364 | sim/não | ... |
| People 364 | sim/não | ... |
| Insight 364 | sim/não | ... |
| PMO 364 | sim/não | ... |

## Observação sobre Dados
[nota indicando que os especialistas acionados devem considerar o step-02 como fonte de dados disponíveis/ausentes]
```

## Output Example

```markdown
# Seleção de Especialistas — Atlas 364

## Demanda Classificada Como
financeira, produção, qualidade

## Especialistas Acionados
| Especialista | Acionado? | Motivo |
|---|---|---|
| CFO 364 | sim | Demanda envolve queda de margem — análise de CMV e rentabilidade necessária. |
| COO 364 | não | Não há indício de problema operacional de atendimento/expedição nesta demanda. |
| Guardião 364 | sim | Possível causa raiz em rendimento/processo de produção da linha de defumados. |
| Growth 364 | não | Nenhuma variação de canal de venda foi mencionada na demanda. |
| Brand 364 | sim | Se houver reajuste de preço, a comunicação ao cliente recorrente precisa ser planejada. |
| People 364 | não | Nenhum aspecto de pessoas/cultura envolvido nesta demanda. |
| Insight 364 | não | Já acionado no Step 02 para verificação de dados; não há necessidade de análise dedicada adicional. |
| PMO 364 | não | Não é um projeto com cronograma formal. |

## Observação sobre Dados
CFO 364 e Guardião 364 devem considerar as lacunas de dado já identificadas no Step 02 (rateio de
despesas fixas, ficha técnica e logs de lote) e marcá-las como "dados não fornecidos" em suas análises.
```

## Veto Conditions

Reject and redo if ANY of these are true:
1. Todos os 8 especialistas foram acionados sem justificativa individual proporcional à classificação da demanda.
2. Algum especialista com relação direta e óbvia à categoria classificada não foi acionado nem justificado como "não".

## Quality Criteria

- [ ] Todos os 8 especialistas têm uma decisão explícita (sim/não) com motivo.
- [ ] A seleção é proporcional à classificação da demanda, não uma ativação padrão de todos.
- [ ] A observação sobre dados referencia corretamente o Step 02.
