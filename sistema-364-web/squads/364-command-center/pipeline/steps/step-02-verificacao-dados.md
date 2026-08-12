---
execution: subagent
agent: insight-364
model_tier: powerful
inputFile: squads/364-command-center/output/executivo/01-classificacao.md
outputFile: squads/364-command-center/output/executivo/02-verificacao-dados.md
---

# Step 02: Verificação dos Dados Fornecidos e Identificação de Dados Ausentes

## Context Loading

Load these files before executing:
- `squads/364-command-center/output/executivo/01-classificacao.md` — classificação da demanda, empresa
  envolvida e dados já mencionados na solicitação original.
- `squads/364-command-center/pipeline/data/anti-patterns.md` — regra global de nunca inventar dado ausente.
- Quaisquer planilhas, exports ou relatórios brutos fornecidos junto com a solicitação original.

## Instructions

### Process

1. Reunir todos os dados fornecidos junto com a solicitação (planilhas, exports, valores mencionados em
   texto) e organizá-los por tipo (financeiro, operacional, comercial, produção, pessoas, projeto).
2. Para cada categoria de classificação identificada no Step 01, listar quais dados essenciais para uma
   análise de qualidade nessa categoria estão disponíveis e quais estão ausentes.
3. Limpar inconsistências óbvias nos dados fornecidos (duplicatas, formatos divergentes) e documentar a
   limpeza realizada.
4. Escrever explicitamente "dados não fornecidos" para cada informação relevante ausente — nunca supor
   ou estimar silenciosamente.

## Output Format

The output MUST follow this exact structure:
```
# Verificação de Dados — Insight 364

## Dados Fornecidos
[lista organizada por categoria, com fonte e período de cada dado]

## Limpeza Realizada
[duplicatas, formatos ou inconsistências corrigidas, se houver]

## Dados Não Fornecidos
[lista explícita de informações relevantes ausentes, por categoria]

## Recomendação de Escopo
[nota sobre se os dados disponíveis são suficientes para uma análise robusta na(s) categoria(s)
classificada(s), ou se a análise deverá ser marcada como preliminar por falta de dado]
```

## Output Example

```markdown
# Verificação de Dados — Insight 364

## Dados Fornecidos
- Financeiro: margem bruta da linha de defumados (34% há 60 dias, 27% atual) — dado real, mencionado
  por Gustavo. Planilha de custo de matéria-prima dos últimos 90 dias — dado real, exportada do sistema.
- Produção: nenhuma ficha técnica ou log de lote foi anexado a esta solicitação.

## Limpeza Realizada
Removidas 2 linhas duplicadas na planilha de custo de matéria-prima (mesmo lançamento importado duas
vezes). Padronizado formato de data.

## Dados Não Fornecidos
- Produção: ficha técnica atual da linha de defumados; registros de rendimento por lote dos últimos 60
  dias; log de temperatura da defumadeira.
- Financeiro: rateio de despesas fixas aplicado à linha; CMV segmentado por SKU dentro da linha de
  defumados.

## Recomendação de Escopo
A análise financeira pode prosseguir com os dados disponíveis, mas a análise de produção (Guardião 364)
precisará solicitar dados adicionais de lote e ficha técnica para ser conclusiva — sinalizar isso na
consolidação final do Atlas 364.
```

## Veto Conditions

Reject and redo if ANY of these are true:
1. Alguma lacuna de dado relevante foi preenchida por suposição em vez de marcada como "dados não fornecidos".
2. A limpeza de dados realizada não foi documentada.

## Quality Criteria

- [ ] Todo dado fornecido está organizado por categoria, com fonte e período.
- [ ] Toda lacuna relevante está explicitamente listada como "dados não fornecidos".
- [ ] A recomendação de escopo indica claramente se a análise poderá ser conclusiva ou apenas preliminar.
