---
type: checkpoint
outputFile: squads/conselho-364/output/pauta.md
---

# Step 01: Abertura de Pauta ✅

Checkpoint inicial — coleta a pauta da rodada com o usuário (Gustavo). As respostas são gravadas em `output/pauta.md` e alimentam o enquadramento do CEO.

## Perguntas (via AskUserQuestion, combinadas em uma chamada)

1. **Qual é a pauta desta rodada do conselho?** (texto livre)
   Exemplos para orientar: "precificar a linha de defumados congelados", "decidir se abrimos delivery próprio", "estruturar o lançamento da 364 Kids", "reduzir o CMV da Steakhouse".

2. **Que tipo de resultado você espera?**
   - Decisão entre opções que já tenho em mente
   - Diagnóstico de um problema + solução
   - Planejamento de um projeto novo (Nível 3)

3. **Você tem números ou contexto interno para essa pauta?** (texto livre — vendas, custos, prints do sistema, observações)
   Se não tiver, o conselho trabalhará com premissas declaradas e benchmarks do setor.

## Formato gravado em output/pauta.md

```
# Pauta — {resumo curto}
Data: {YYYY-MM-DD}
Tipo esperado: {decisão | problema | projeto}

## Descrição do usuário
{texto livre da pauta}

## Dados internos fornecidos
{números/contexto, ou "nenhum — usar premissas e benchmarks"}
```
