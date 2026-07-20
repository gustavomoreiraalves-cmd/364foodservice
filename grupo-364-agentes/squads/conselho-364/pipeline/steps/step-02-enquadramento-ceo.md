---
execution: inline
agent: vicente-visao
inputFile: squads/conselho-364/output/pauta.md
outputFile: squads/conselho-364/output/enquadramento.md
---

# Step 02: Enquadramento do CEO 🎯

## Context Loading

Load these files before executing:
- `squads/conselho-364/output/pauta.md` — a pauta bruta e os dados internos fornecidos pelo usuário
- `_opensquad/_memory/company.md` — perfil completo do Grupo 364 e suas unidades
- `squads/conselho-364/pipeline/data/especialistas.md` — os 8 especialistas convocáveis do Nível 2
- `squads/conselho-364/pipeline/data/domain-framework.md` — regras de deliberação do conselho
- `squads/conselho-364/_memory/memories.md` — aprendizados de rodadas anteriores

## Instructions

### Process
1. Ler a pauta e classificá-la: **decisão**, **problema** ou **projeto** (Nível 3). Se a pauta for vaga, reformulá-la — nunca devolvê-la vaga ao usuário.
2. Reformular como **pergunta de decisão** com **critério de sucesso mensurável** (número + prazo, horizonte padrão 90 dias).
3. Avaliar o **efeito nas demais unidades** do grupo (Steakhouse, Burguer, Foodservices, Buffet) — registrar mesmo que seja "nenhum".
4. Definir **2–4 perguntas de pesquisa** específicas para Samuel Sonda responder com evidência externa. Se a pauta for 100% interna com dados fornecidos, dispensar a pesquisa declarando o motivo.
5. **Convocar 2–3 especialistas** de `especialistas.md`, com justificativa de 1 linha por convocação (e dispensa explícita de quem seria óbvio mas não é necessário). Convocar Juvenal Jurídico sempre que houver contrato, rotulagem, promoção com álcool ou sociedade.
6. Registrar os **riscos que já enxerga** (1–3) para orientar a mesa.

## Output Format

```
# Enquadramento — {título da pauta}
**Data:** {YYYY-MM-DD} · **Tipo:** {decisão|problema|projeto} · **Horizonte:** {90 dias}

## Pergunta de decisão
{pergunta única e respondível}

## Critério de sucesso
{número + prazo}

## Por que importa agora
{1 parágrafo com o dado ou contexto que dá urgência}

## Efeito nas demais unidades
{análise curta por unidade afetada, ou "nenhum"}

## Especialistas convocados
- {Nome} — {justificativa em 1 linha}
- {Nome} — {justificativa}
{Dispensas relevantes: {quem e por quê}}

## Perguntas para a pesquisa (Samuel Sonda)
1. {pergunta específica}
2. {pergunta específica}
{ou "Pesquisa dispensada: {motivo}"}

## Riscos que o CEO já enxerga
1. {risco}
```

## Output Example

> # Enquadramento — Delivery próprio da Steakhouse
> **Data:** 2026-07-18 · **Tipo:** decisão · **Horizonte:** 90 dias
>
> ## Pergunta de decisão
> Devemos lançar canal próprio de delivery (WhatsApp + retirada) em paralelo ao iFood, ou concentrar 100% no iFood por mais 6 meses?
>
> ## Critério de sucesso
> Margem líquida por pedido ≥ 18% no canal escolhido, sem aumento de reclamações de atraso, medido até 15/10.
>
> ## Por que importa agora
> O iFood consome 23–27% do pedido em taxas; a cada 100 pedidos/mês migrados para canal próprio, o grupo retém aproximadamente um salário de atendente.
>
> ## Efeito nas demais unidades
> 364 Burguer: aprendizado do funil WhatsApp reaproveitável na Afya. Foodservices: nenhum.
>
> ## Especialistas convocados
> - Diego Digital — desenhar o funil e a operação de pedidos via WhatsApp
> - Cecília CX — garantir que a jornada própria não piore tempo de entrega
> Dispensa: Juvenal Jurídico — sem implicação contratual nova nesta fase.
>
> ## Perguntas para a pesquisa (Samuel Sonda)
> 1. Taxas e regras 2026 do iFood para restaurantes do porte da 364
> 2. Benchmarks de conversão de delivery via WhatsApp em cidades médias
> 3. Custo mensal de apps brasileiros de pedido próprio
>
> ## Riscos que o CEO já enxerga
> 1. WhatsApp mal atendido piora CX em vez de melhorar margem — plano do COO deve definir quem responde e em quanto tempo.

## Veto Conditions

Reject and redo if ANY are true:
1. A pergunta de decisão continua vaga (tema, não decisão) ou não tem critério de sucesso mensurável.
2. Especialistas convocados sem justificativa, ou mais de 3 sem motivo excepcional declarado.
3. Perguntas de pesquisa genéricas demais para orientar buscas (ex.: "pesquisar o mercado").

## Quality Criteria

- [ ] Cabe em 1 página e abre com a pergunta de decisão.
- [ ] Efeito nas demais unidades avaliado.
- [ ] 2–4 perguntas de pesquisa específicas (ou dispensa justificada).
- [ ] Riscos iniciais registrados.
