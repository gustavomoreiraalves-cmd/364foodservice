---
execution: inline
agent: priscila-prazo
inputFile: squads/conselho-364/output/indicadores.md
outputFile: squads/conselho-364/output/parecer-executivo.md
---

# Step 09: Parecer Executivo 📋

## Context Loading

Load these files before executing:
- `squads/conselho-364/output/enquadramento.md` — pergunta de decisão e critério de sucesso
- `squads/conselho-364/output/pesquisa.md` — evidências externas
- `squads/conselho-364/output/contribuicoes.md` — mesa de especialistas (com síntese e conflitos)
- `squads/conselho-364/output/plano-operacional.md` — fases do COO
- `squads/conselho-364/output/analise-financeira.md` — posição da CFO
- `squads/conselho-364/output/indicadores.md` — tabela do BI
- `squads/conselho-364/pipeline/data/domain-framework.md` — estrutura obrigatória do parecer
- `squads/conselho-364/pipeline/data/output-examples.md` — padrão de qualidade de referência

## Instructions

### Process
1. Consolidar todas as saídas na **estrutura obrigatória** do domain-framework — o parecer deve caber em ~2 páginas; detalhes técnicos ficam nos arquivos de apoio (citados como anexos).
2. Escrever a **Decisão recomendada** em 1 parágrafo que responde diretamente a pergunta de decisão (quem lê só esse bloco sabe o que fazer).
3. Compilar o **Plano de ação** em tabela (ação | responsável | prazo | indicador), máximo 7 linhas no horizonte 30–90 dias; validar os 4 campos em toda linha.
4. Registrar **Dissidências**: conflitos reais da mesa ou entre COO/CFO/CMO, com o desempate de Vicente Visão justificado. Se não houver: "Nenhuma nesta rodada".
5. Marcar **confiança** (Alta/Média/Baixa) em cada recomendação e listar as premissas declaradas em bloco único.

## Output Format

```
# Parecer Executivo — {título da pauta}
**Data:** {YYYY-MM-DD} · **Pauta:** {tipo} · **Especialistas convocados:** {lista}

## Decisão recomendada
{1 parágrafo, começa com a resposta}

## Por quê
1. {argumento com dado + fonte}
2. ...
(3–5 argumentos)

## Plano de ação
| Ação | Responsável | Prazo | Indicador |
|---|---|---|---|

## Riscos e mitigação
- **{risco}** → {mitigação}
(2–4)

## Indicadores de acompanhamento
{tabela resumida do BI + frequência}

## Dissidências
{registro + desempate do CEO, ou "Nenhuma nesta rodada"}

## Premissas declaradas
- {premissa 1}

*Anexos: pesquisa.md, contribuicoes.md, plano-operacional.md, analise-financeira.md, indicadores.md*
```

## Output Example

Ver exemplo completo e integral em `pipeline/data/output-examples.md` (Parecer "Precificação da linha de defumados congelados") — é o padrão mínimo de qualidade. Resumo do que o exemplo demonstra:

> - Decisão recomendada em 1 parágrafo com números ("duas tabelas: varejo 45%, B2B 32%, pedido mínimo R$ 400")
> - 4 argumentos, cada um citando benchmark ou achado da investigação com fonte
> - Plano de ação de 4 linhas completas (ação | responsável | prazo | indicador)
> - 2 riscos com mitigação prática ("se custo logístico >8%, subir pedido mínimo, não o preço")
> - 3 indicadores com meta e frequência de leitura
> - Seção Dissidências presente ("Nenhuma nesta rodada")
> - Rodapé com crédito de revisão ("revisado por Rebeca Rigor — APROVA, média 8,4")

## Veto Conditions

Reject and redo if ANY are true:
1. Alguma seção da estrutura obrigatória ausente ou fora de ordem.
2. Linha do plano de ação com campo vazio (ação/responsável/prazo/indicador).
3. Número no texto sem fonte nem premissa declarada.
4. Parecer acima de ~3 páginas (falta de edição não é profundidade).

## Quality Criteria

- [ ] Decisão respondida no primeiro bloco.
- [ ] Argumentos com dado + fonte.
- [ ] Plano ≤7 linhas, todas completas.
- [ ] Dissidências e premissas presentes.
- [ ] Confiança marcada nas recomendações.
