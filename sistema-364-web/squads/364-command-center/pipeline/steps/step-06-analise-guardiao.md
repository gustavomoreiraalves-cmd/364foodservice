---
execution: subagent
agent: guardiao-364
model_tier: powerful
inputFile: squads/364-command-center/output/executivo/03-selecao-agentes.md
outputFile: squads/364-command-center/output/producao/06-analise-guardiao.md
---

# Step 06: Análise de Produção, Qualidade e Rastreabilidade — Guardião 364

## Context Loading

Load these files before executing:
- `squads/364-command-center/output/executivo/03-selecao-agentes.md` — confirmar se o Guardião 364 foi acionado; se "não", produzir apenas a nota de não acionamento e encerrar.
- `squads/364-command-center/output/executivo/02-verificacao-dados.md` — dados de produção fornecidos e ausentes.
- `squads/364-command-center/pipeline/data/quality-criteria.md` — critérios específicos do Guardião 364.
- `squads/364-command-center/agents/guardiao-364.agent.md` — framework operacional e exemplos de referência.

## Instructions

### Process

1. Verificar se o Guardião 364 foi acionado no Step 03. Se não, produzir "Não acionado nesta demanda" e encerrar.
2. Identificar a matéria-prima, ficha técnica, lote de recebimento ou de produção envolvido e verificar
   rastreabilidade completa (origem, data, validade, cadeia fria).
3. Calcular rendimento e perda comparando com o padrão da ficha técnica; classificar não conformidades
   por gravidade.
4. Separar a análise por empresa e centro de custo; marcar orientações sanitárias/regulatórias como
   recomendação preliminar.

## Output Format

The output MUST follow this exact structure:
```
# Análise de Produção — Guardião 364
**Empresa:** [empresa] | **Centro de Custo:** [centro de custo]

## Rastreabilidade
[lote, data, origem, validade, cadeia fria]

## Rendimento
[realizado vs. padrão da ficha técnica]

## Não Conformidade Identificada
[classificação: crítica/maior/menor]

## Cadeia Fria
[status]

## Recomendação Preliminar
[ação recomendada, com marcação de validação por profissional habilitado quando aplicável]

## Separação por Centro de Custo
[explicitar alocação]

## Dados Não Fornecidos
[lista explícita]
```

## Output Example

```markdown
# Análise de Produção — Guardião 364
**Empresa:** 364 Food Services | **Centro de Custo:** Central de Produção — Linha Defumados

## Rastreabilidade
Lote de recebimento MP-2026-0714, recebido em 14/07/2026, validade 30 dias sob refrigeração -2°C a 2°C
(dado real). Ordem de produção OP-2026-0341 gerada em 16/07/2026.

## Rendimento
Peso de entrada: 220 kg | Peso de saída: 168 kg | Rendimento: 76,4% | Padrão da ficha técnica: 80,0%.

## Não Conformidade Identificada
Classificação: Maior. Tempo de defumação (5h40) abaixo do especificado (6h30).

## Cadeia Fria
Sem ruptura registrada entre recebimento e produção (dado real).

## Recomendação Preliminar
Revisar o tempo de defumação e implantar registro de temperatura a cada 30 min. Qualquer ajuste que
impacte rotulagem ou validade declarada requer validação de profissional técnico habilitado
(recomendação preliminar).

## Separação por Centro de Custo
Produção alocada 100% à 364 Food Services.

## Dados Não Fornecidos
Log de temperatura da defumadeira; laudo de análise sensorial do lote.
```

## Veto Conditions

Reject and redo if ANY of these are true:
1. O agente não verificou se foi acionado no Step 03 antes de produzir a análise completa.
2. Uma orientação sanitária/regulatória foi apresentada sem a marcação de recomendação preliminar.

## Quality Criteria

- [ ] Toda análise de lote cita número de lote, data e origem.
- [ ] Rendimento realizado é comparado ao padrão da ficha técnica.
- [ ] Toda orientação sanitária/regulatória inclui a marcação de recomendação preliminar.
- [ ] Todo dado ausente relevante está listado na seção "Dados Não Fornecidos".
