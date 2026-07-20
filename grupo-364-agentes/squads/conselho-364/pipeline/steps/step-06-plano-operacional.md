---
execution: inline
agent: otavio-operacao
inputFile: squads/conselho-364/output/contribuicoes.md
outputFile: squads/conselho-364/output/plano-operacional.md
---

# Step 06: Plano Operacional ⚙️

## Context Loading

Load these files before executing:
- `squads/conselho-364/output/enquadramento.md` — pergunta de decisão e critério de sucesso
- `squads/conselho-364/output/contribuicoes.md` — recomendações da mesa (inclui síntese da PMO)
- `squads/conselho-364/output/pesquisa.md` — evidências externas
- `squads/conselho-364/pipeline/data/anti-patterns.md` — em especial os anti-padrões de gestão (1–3)

## Instructions

### Process
1. Extrair das contribuições todas as ações operacionais propostas e validar a **capacidade instalada**: gargalo físico (equipamento, espaço frio, equipe, horário) da unidade afetada, com número.
2. Sequenciar em **fases**: Fase 0 (pré-requisitos), Fase 1 (piloto no menor ambiente possível), Fase 2 (escala) — com **critério de avanço numérico** entre fases.
3. Nomear **responsável por função** para cada ação (contratar/designar quando a função não existe) e sinalizar sobrecarga; nenhuma rotina pode depender da presença integral de Gustavo.
4. Prever **treinamento de reposição** para toda função nova (turnover >70% no setor é premissa, não surpresa).
5. Mapear os **3 principais riscos de execução** com resposta prática para cada um.

## Output Format

```
# Plano Operacional — {título da pauta}

**Capacidade validada:** {gargalo dimensionante com número, por unidade afetada}

## Fase 0 — Pré-requisitos (até {data})
1. {ação} — dono: {função}
...

## Fase 1 — Piloto ({período}) · critério de avanço: {número}
- {ações e escopo do piloto}
- Escala/equipe: {dimensionamento + backup treinado}

## Fase 2 — Escala (a partir de {data}, se critério batido)
- {ações de expansão}

## Riscos de execução
1. **{risco}** → {resposta prática}
2. **{risco}** → {resposta}
3. **{risco}** → {resposta}
```

## Output Example

> # Plano Operacional — Linha de inverno com defumados (Steakhouse)
>
> **Capacidade validada:** defumador com folga de 200 kg/semana; gargalo é a câmara fria — 120 kg/semana disponíveis para esta linha. Cozinha finaliza até 40 pratos/noite sem reforço.
>
> ## Fase 0 — Pré-requisitos (até 28/07)
> 1. Ficha técnica dos 3 pratos com porção e CMV-alvo — dono: chef da Steakhouse
> 2. Regra de prioridade de insumo: B2B confirmado > cardápio interno — dono: Gustavo
> 3. Checklist de finalização impresso na linha — dono: chef
>
> ## Fase 1 — Piloto (29/07 a 25/08) · critério de avanço: ≥25 pratos/semana e CMV real ≤31%
> - Lançar só no delivery e almoço de sábado; medir tempo real de finalização
> - Escala: sem contratação; 1 cozinheiro treinado como backup na primeira semana (checklist assinado)
>
> ## Fase 2 — Escala (a partir de 26/08, se critério batido)
> - Entrada no cardápio completo do salão + combo com chope
>
> ## Riscos de execução
> 1. **Demanda estourando disputa insumo B2B** → regra de prioridade da Fase 0 + teto de 120 kg/semana.
> 2. **Finalização acima de 8 min no pico** → pré-porcionamento na bancada fria.
> 3. **Backup não treinado a tempo** → treinamento na semana 1 da Fase 1, com checklist assinado.

## Veto Conditions

Reject and redo if ANY are true:
1. Plano sem gargalo dimensionante declarado com número.
2. Fase sem critério de avanço numérico, ou ação sem dono por função.
3. Alguma rotina nova que só funciona com Gustavo presente (viola anti-padrão nº 3).

## Quality Criteria

- [ ] Fases 0/1/2 com critérios de avanço numéricos.
- [ ] Todo responsável nomeado por função; sobrecarga sinalizada.
- [ ] Treinamento de reposição previsto para funções novas.
- [ ] 3 riscos de execução com resposta prática.
