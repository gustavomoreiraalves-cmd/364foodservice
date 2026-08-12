---
execution: inline
agent: conselho-364
inputFile: squads/364-command-center/output/planos-de-acao/13-plano-de-acao.md
outputFile: squads/364-command-center/output/executivo/14-revisao-conselho.md
on_reject: 13
---

# Step 14: Revisão pelo Conselho 364

## Context Loading

Load these files before executing:
- `squads/364-command-center/output/executivo/12-consolidacao.md` — consolidação executiva.
- `squads/364-command-center/output/planos-de-acao/13-plano-de-acao.md` — plano de ação a revisar.
- `squads/364-command-center/pipeline/data/quality-criteria.md` — limiares de rejeição do Conselho 364.
- Todas as análises setoriais dos especialistas acionados, para checagem de coerência numérica.

## Instructions

### Process

1. Ler integralmente a consolidação e o plano de ação antes de julgar.
2. Verificar coerência numérica entre especialistas; avaliar viabilidade das recomendações frente a
   recursos e prazos realistas do grupo.
3. Checar explicitamente riscos financeiros, operacionais, sanitários, jurídicos e de imagem; verificar
   conflito de prioridade entre empresas do grupo.
4. Confirmar que todo item do plano de ação tem responsável, prazo e indicador; confirmar que toda
   lacuna de dado está sinalizada, não preenchida por suposição.
5. Emitir veredito: APROVADO ou REJEITADO. Se REJEITADO, listar caminho de correção específico — o
   pipeline retorna ao Step 13 (`on_reject: 13`) para nova consolidação/plano de ação.

## Output Format

The output MUST follow this exact structure:
```
# Revisão — Conselho 364
**Veredito: [APROVADO/REJEITADO]**

## Verificação de Coerência
[avaliação]

## Viabilidade das Recomendações
[avaliação]

## Riscos Verificados
[financeiro, operacional, sanitário, jurídico, de imagem — status de cada um]

## Itens Sem Responsável, Prazo ou Indicador
[lista, ou "nenhum"]

## Caminho de Correção
[apenas se REJEITADO — passos específicos e acionáveis]
```

## Output Example

```markdown
# Revisão — Conselho 364
**Veredito: REJEITADO**

## Verificação de Coerência
Os números de CMV do CFO 364 (44%) e a análise de rendimento do Guardião 364 (76,4% vs. 80%) são
coerentes entre si.

## Viabilidade das Recomendações
Reajuste de 6-8% é viável financeiramente, mas o plano não avalia o risco de imagem de um reajuste sem
comunicação transparente aos clientes de assinatura.

## Riscos Verificados
Financeiro: endereçado. Operacional: endereçado. Sanitário: endereçado (recomendação preliminar do
Guardião 364). Jurídico: não aplicável nesta demanda. Imagem: NÃO ENDEREÇADO.

## Itens Sem Responsável, Prazo ou Indicador
Item 3 ("buscar cotação de fornecedor alternativo") sem responsável definido.

## Caminho de Correção
1. Adicionar item de comunicação de reajuste a assinantes, com responsável (Brand 364) e prazo.
2. Atribuir responsável ao item 3.
3. Reencaminhar para nova consolidação/plano de ação (Step 13).
```

## Veto Conditions

Reject and redo if ANY of these are true:
1. O veredito foi emitido sem verificação explícita de todas as 5 categorias de risco (financeiro, operacional, sanitário, jurídico, de imagem).
2. Um veredito REJEITADO foi emitido sem caminho de correção específico e acionável.

## Quality Criteria

- [ ] Todas as 5 categorias de risco foram explicitamente verificadas.
- [ ] O veredito é inequívoco (APROVADO ou REJEITADO), sem ambiguidade.
- [ ] Toda rejeição inclui caminho de correção específico e acionável.
