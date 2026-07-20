---
execution: inline
agent: bento-benchmark
inputFile: squads/conselho-364/output/analise-financeira.md
outputFile: squads/conselho-364/output/indicadores.md
---

# Step 08: Indicadores 📊

## Context Loading

Load these files before executing:
- `squads/conselho-364/output/enquadramento.md` — critério de sucesso do CEO
- `squads/conselho-364/output/plano-operacional.md` — fases e critérios de avanço
- `squads/conselho-364/output/analise-financeira.md` — metas financeiras e premissas
- `squads/conselho-364/pipeline/data/research-brief.md` — benchmarks para calibrar metas

## Instructions

### Process
1. Escolher **2–4 indicadores** que medem diretamente o critério de sucesso do CEO — nem mais, nem menos; métricas de vaidade não entram.
2. Preencher a **tabela padrão** para cada indicador: baseline (ou "não instrumentado"), meta com prazo, frequência de leitura, fonte do dado e dono da leitura.
3. Confrontar metas com os **benchmarks** do research-brief; sinalizar meta irreal (acima do teto do setor sem justificativa) e declarar confiança do confronto.
4. Quando o baseline não existir, a primeira meta é **criar o baseline** (2–4 semanas de medição) — nunca inventar número.
5. Listar o **gap de instrumentação**: o que o sistema-364-web deveria capturar e não captura, como sugestão de pauta futura.

## Output Format

```
# Indicadores — {título da pauta}

**Critério de sucesso da rodada (CEO):** {resumo}

| Indicador | Baseline | Meta | Frequência | Fonte | Dono da leitura |
|---|---|---|---|---|---|
| ... | ... | ... | ... | ... | ... |

**Confronto com benchmark:** {análise curta}. [Confiança: {nível}]

**Gap de instrumentação:** {o que falta no sistema-364-web + sugestão}, ou "nenhum".
```

## Output Example

> # Indicadores — Linha de inverno com defumados
>
> **Critério de sucesso da rodada (CEO):** ≥25 pratos/semana com CMV ≤31%, sem aumento de reclamações.
>
> | Indicador | Baseline | Meta | Frequência | Fonte | Dono da leitura |
> |---|---|---|---|---|---|
> | Pratos de inverno/semana | 0 (lançamento) | ≥25 na Fase 1 | semanal | sistema-364-web (pedidos) | Gustavo |
> | CMV real da linha | não instrumentado | ≤31% | quinzenal | fichas + módulo produções | CFO |
> | Reclamações delivery/semana | 2 (média jun–jul, premissa) | ≤2 | semanal | iFood + WhatsApp | atendente |
> | Margem de contribuição da linha | — | ≥R$ 2.900/mês | mensal | análise CFO | CFO |
>
> **Confronto com benchmark:** CMV-alvo de 31% está no teto da faixa saudável (28–31%) — aceitável para lançamento, revisar na Fase 2. [Confiança: Alta]
>
> **Gap de instrumentação:** o módulo `producoes` não liga lote produzido a prato vendido; CMV real sairá manual. Sugestão: pauta técnica com Átila Automação.

## Veto Conditions

Reject and redo if ANY are true:
1. Mais de 4 indicadores, ou indicador desconectado do critério de sucesso.
2. Tabela com coluna vazia (baseline/meta/frequência/fonte/dono).
3. Meta sem baseline e sem benchmark que a sustente.

## Quality Criteria

- [ ] 2–4 indicadores ligados ao critério de sucesso.
- [ ] Tabela padrão completa.
- [ ] Confronto com benchmark + confiança.
- [ ] Gap de instrumentação declarado.
