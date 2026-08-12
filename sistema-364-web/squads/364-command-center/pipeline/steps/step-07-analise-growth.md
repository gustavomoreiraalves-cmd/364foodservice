---
execution: subagent
agent: growth-364
model_tier: powerful
inputFile: squads/364-command-center/output/executivo/03-selecao-agentes.md
outputFile: squads/364-command-center/output/comercial/07-analise-growth.md
---

# Step 07: Análise Comercial — Growth 364

## Context Loading

Load these files before executing:
- `squads/364-command-center/output/executivo/03-selecao-agentes.md` — confirmar se o Growth 364 foi acionado; se "não", produzir apenas a nota de não acionamento e encerrar.
- `squads/364-command-center/output/executivo/02-verificacao-dados.md` — dados comerciais fornecidos e ausentes.
- `squads/364-command-center/pipeline/data/quality-criteria.md` — critérios específicos do Growth 364.
- `squads/364-command-center/agents/growth-364.agent.md` — framework operacional e exemplos de referência.

## Instructions

### Process

1. Verificar se o Growth 364 foi acionado no Step 03. Se não, produzir "Não acionado nesta demanda" e encerrar.
2. Segmentar a análise de vendas por canal (salão, delivery, WhatsApp, iFood, MenuDino, retirada,
   eventos, distribuidores, venda corporativa) — nunca agregar canais sem justificativa.
3. Analisar ticket médio, mix de produtos e identificar clientes inativos ou oportunidades de expansão B2B.
4. Propor recomendação comercial quantificada, com público-alvo e estimativa de impacto.

## Output Format

The output MUST follow this exact structure:
```
# Análise Comercial — Growth 364
**Empresa:** [empresa]

## Análise por Canal
[tabela: canal, volume, ticket médio, variação]

## Insight
[interpretação com "isso significa que..."]

## Mix de Produtos
[quando aplicável]

## Recomendação
[ação comercial, público-alvo, impacto estimado, confiança]

## Oportunidade de Expansão
[clientes inativos, B2B, quantificado]

## Dados Não Fornecidos
[lista explícita]
```

## Output Example

```markdown
# Análise Comercial — Growth 364
**Empresa:** 364 Steakhouse

## Análise por Canal
| Canal | Pedidos | Ticket Médio | Var. vs. mês anterior |
|---|---|---|---|
| Salão | 1.240 | R$ 68,40 | +3,1% |
| iFood | 890 | R$ 52,10 | -9,8% |

## Insight
O ticket médio do iFood caiu 9,8% enquanto os demais canais se mantiveram estáveis. Isso significa que o
problema é específico do canal, associado ao aumento de pedidos com cupom (34% vs. 18% no mês anterior).

## Mix de Produtos
Combos com desconto responderam por 41% do volume do iFood (dado real).

## Recomendação
Revisar estratégia de cupons no iFood, elevando o valor mínimo de pedido para proteger o ticket médio
(confiança média — 1 mês de dado).

## Oportunidade de Expansão
47 clientes do WhatsApp com 3+ pedidos em 90 dias e nenhum nos últimos 20 dias — oportunidade de
reativação via campanha direta.

## Dados Não Fornecidos
Custo de aquisição por canal; taxa de conversão do funil de WhatsApp.
```

## Veto Conditions

Reject and redo if ANY of these are true:
1. O agente não verificou se foi acionado no Step 03 antes de produzir a análise completa.
2. Canais de venda diferentes foram agregados em uma única média sem justificativa.

## Quality Criteria

- [ ] Toda análise de vendas é segmentada por canal.
- [ ] Toda oportunidade comercial é quantificada.
- [ ] Nenhuma recomendação implica fechamento de contrato já realizado.
- [ ] Todo dado ausente relevante está listado na seção "Dados Não Fornecidos".
