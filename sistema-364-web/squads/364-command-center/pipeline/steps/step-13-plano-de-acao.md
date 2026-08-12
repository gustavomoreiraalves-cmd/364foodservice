---
execution: inline
agent: atlas-364
inputFile: squads/364-command-center/output/executivo/12-consolidacao.md
outputFile: squads/364-command-center/output/planos-de-acao/13-plano-de-acao.md
---

# Step 13: Criação do Plano de Ação

## Context Loading

Load these files before executing:
- `squads/364-command-center/output/executivo/12-consolidacao.md` — consolidação executiva.
- `squads/364-command-center/pipeline/data/quality-criteria.md` — critérios de completude do plano de ação.
- Se este step é reexecutado após rejeição do Conselho 364 (Step 14, `on_reject: 13`):
  `squads/364-command-center/output/executivo/14-revisao-conselho.md` — caminho de correção apontado.

## Instructions

### Process

1. Ler a consolidação executiva e, se aplicável, o caminho de correção do Conselho 364 de uma execução
   anterior deste step.
2. Para cada recomendação da consolidação, criar um item de plano de ação com TODOS os campos
   obrigatórios: ação, empresa, área, responsável, prazo, prioridade (P0/P1/P2/P3), custo estimado
   (quando aplicável), resultado esperado, indicador de sucesso, status, dependências, riscos.
3. Classificar prioridade: P0 (crítico e imediato), P1 (alta prioridade), P2 (importante), P3 (melhoria
   futura) — com base no risco e no impacto identificados na consolidação.
4. Se este step foi reexecutado após rejeição, confirmar explicitamente que cada ponto do caminho de
   correção foi endereçado.

## Output Format

The output MUST follow this exact structure:
```
# Plano de Ação — Atlas 364
**Empresa:** [empresa] | **Revisão:** [nº da tentativa, ex: 1 de 3]

| # | Ação | Empresa | Área | Responsável | Prazo | Prioridade | Custo Estimado | Resultado Esperado | Indicador | Status | Dependências | Riscos |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | ... | ... | ... | ... | ... | P0-P3 | ... | ... | ... | Pendente | ... | ... |

## Notas de Correção (se aplicável)
[como cada ponto do caminho de correção do Conselho 364 foi endereçado, se este é um reenvio]
```

## Output Example

```markdown
# Plano de Ação — Atlas 364
**Empresa:** 364 Food Services | **Revisão:** 2 de 3

| # | Ação | Empresa | Área | Responsável | Prazo | Prioridade | Custo Estimado | Resultado Esperado | Indicador | Status | Dependências | Riscos |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Reajustar preço da linha em 7% | 364 Food Services | Financeiro | CFO 364 + Gustavo | 2026-08-01 | P0 | Nenhum (reajuste, não investimento) | Margem bruta ≥ 32% | Margem bruta em 60 dias | Pendente | Nenhuma | Reação negativa de clientes |
| 2 | Comunicar reajuste a assinantes | 364 Food Services | Marketing | Brand 364 | 2026-07-30 | P0 | R$ 0 (comunicação orgânica) | Transparência preservada | 0 reclamações formais | Pendente | Depende do item 1 | Percepção negativa se mal comunicado |
| 3 | Revisar tempo de defumação com validação técnica | 364 Food Services | Produção | Guardião 364 | 2026-08-05 | P1 | R$ 500 (consultoria técnica) | Rendimento normalizado | Rendimento ≥ 80% | Pendente | Nenhuma | Processo pode exigir ajuste maior que o previsto |
| 4 | Buscar cotação de fornecedor alternativo | 364 Food Services | Financeiro | CFO 364 | 2026-08-10 | P2 | Nenhum (cotação) | Redução de custo de MP | Cotação obtida | Pendente | Nenhuma | Fornecedor pode não atender volume necessário |

## Notas de Correção
Item 2 adicionado conforme solicitado pelo Conselho 364 na revisão anterior (risco de imagem não
endereçado). Responsável atribuído ao item 4, que estava sem responsável na versão anterior.
```

## Veto Conditions

Reject and redo if ANY of these are true:
1. Qualquer item do plano de ação está sem responsável, prazo, prioridade ou indicador de sucesso.
2. Em caso de reenvio pós-rejeição, algum ponto do caminho de correção do Conselho 364 não foi endereçado.

## Quality Criteria

- [ ] Todo item tem os 12 campos obrigatórios preenchidos.
- [ ] Prioridades seguem a escala P0-P3 com critério consistente.
- [ ] Custos estimados estão presentes quando aplicável, ou explicitamente "nenhum"/"dado não fornecido".
