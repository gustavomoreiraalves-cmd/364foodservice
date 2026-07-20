---
execution: inline
agent: fernanda-fluxo
inputFile: squads/conselho-364/output/plano-operacional.md
outputFile: squads/conselho-364/output/analise-financeira.md
---

# Step 07: Análise Financeira 💰

## Context Loading

Load these files before executing:
- `squads/conselho-364/output/plano-operacional.md` — o plano do COO com fases e investimentos implícitos
- `squads/conselho-364/output/contribuicoes.md` — recomendações da mesa
- `squads/conselho-364/output/pesquisa.md` — dados externos da rodada
- `squads/conselho-364/output/pauta.md` — dados internos fornecidos pelo usuário
- `squads/conselho-364/pipeline/data/research-brief.md` — faixas de referência do setor

## Instructions

### Process
1. Listar toda ação do plano com implicação financeira; levantar custos e investimentos por fase, usando dados do usuário quando existirem e **premissas declaradas** quando não.
2. Calcular **margem de contribuição** e **ponto de equilíbrio** da decisão; confrontar com as faixas do research-brief (CMV 28–31%, prime cost 60–70%, congelados 30–60%) e apontar desvios.
3. Montar **cenários** (pessimista/base/otimista) para a variável mais incerta, com payback por cenário.
4. Definir **critério de abandono** para qualquer investimento ("paramos se X até Y").
5. Emitir a **posição da CFO**: RECOMENDA / RECOMENDA COM CONDIÇÕES / DESACONSELHA, com confiança declarada. Se o prime cost projetado estourar 70%, devolver alerta ao COO antes de fechar.

## Output Format

```
# Análise Financeira — {título da pauta}

**Posição da CFO: {RECOMENDA | RECOMENDA COM CONDIÇÕES | DESACONSELHA}** (confiança {Alta|Média|Baixa} — {motivo})

## A conta
- Investimento: {valor + o que inclui} — premissa: {base}
- {preço/custo/margem unitária com premissas}
- Ponto de equilíbrio: {unidades e tempo}

## Cenários ({variável incerta})
| Cenário | {variável} | Margem/mês | Payback |
|---|---|---|---|
| Pessimista | ... | ... | ... |
| Base | ... | ... | ... |
| Otimista | ... | ... | ... |

## Condições / Critério de abandono
1. {condição para recomendação plena}
2. Critério de abandono: {gatilho de saída}

## Alerta
{efeitos em prime cost, caixa ou outras unidades; ou "nenhum"}
```

## Output Example

> # Análise Financeira — Linha de inverno com defumados
>
> **Posição da CFO: RECOMENDA COM CONDIÇÕES** (confiança Média — CMV real ainda não instrumentado no sistema)
>
> ## A conta
> - Investimento Fase 0–1: R$ 3.850 (fichas, embalagens, treinamento) — premissa: sem equipamento novo (gargalo validado pelo COO)
> - Escondidinho a R$ 42 · custo variável R$ 12,60 (CMV 30%, premissa) → margem de contribuição R$ 29,40/prato
> - Ponto de equilíbrio: 131 pratos (~5 semanas no cenário base)
>
> ## Cenários (pratos/semana na Fase 1)
> | Cenário | Volume | Margem/mês | Payback |
> |---|---|---|---|
> | Pessimista | 12 | R$ 1.411 | 11 semanas |
> | Base | 25 | R$ 2.940 | 5 semanas |
> | Otimista | 45 | R$ 5.292 | 3 semanas |
>
> ## Condições / Critério de abandono
> 1. Instrumentar CMV real por prato no sistema-364-web antes da Fase 2.
> 2. Critério de abandono: 2 semanas consecutivas < 10 pratos → sair do cardápio.
>
> ## Alerta
> Sem impacto no prime cost (sem contratação). Prioridade B2B > sazonal também vale financeiramente: contrato recorrente > prato de estação.

## Veto Conditions

Reject and redo if ANY are true:
1. Qualquer número sem fonte ou premissa declarada.
2. Ausência de cenário pessimista ou de ponto de equilíbrio.
3. Investimento sem critério de abandono.

## Quality Criteria

- [ ] Posição clara com confiança declarada.
- [ ] Faixas do research-brief confrontadas.
- [ ] Cenários com payback.
- [ ] Percentuais traduzidos em reais quando relevante.
