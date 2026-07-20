---
execution: subagent
agent: samuel-sonda
model_tier: powerful
inputFile: squads/conselho-364/output/enquadramento.md
outputFile: squads/conselho-364/output/pesquisa.md
---

# Step 04: Pesquisa de Mercado 🔍

## Context Loading

Load these files before executing:
- `squads/conselho-364/output/enquadramento.md` — o enquadramento aprovado, com as perguntas de pesquisa numeradas
- `squads/conselho-364/pipeline/data/research-brief.md` — benchmarks já compilados (não repesquisar o que já está aqui)
- `_opensquad/_memory/company.md` — porte e região do grupo, para o filtro de aplicabilidade

**Se o enquadramento declarar "Pesquisa dispensada":** gravar em `output/pesquisa.md` apenas a nota "Pesquisa dispensada nesta rodada: {motivo}" e encerrar o passo.

## Instructions

### Process
1. Extrair as perguntas de pesquisa numeradas do enquadramento; planejar 1–3 buscas por pergunta, priorizando fontes primárias (plataformas oficiais, órgãos, associações do setor) sobre blogs.
2. Executar as buscas (web_search) e aprofundar os melhores resultados (web_fetch). Registrar fonte + data de cada achado no próprio parágrafo.
3. Cruzar os achados centrais em 2 fontes independentes; onde só houver 1 fonte, marcar confiança Baixa. Fontes divergindo >10% → reportar ambas e indicar a primária.
4. Aplicar o filtro 364: descartar ou ressalvar o que só vale para redes grandes ou capitais; o contexto é food service de porte pequeno-médio em Ji-Paraná/RO.
5. Compilar o briefing com resposta direta por pergunta (máx. ~1 página cada) e fechar com a seção "O que não foi encontrado" + como obter.

## Output Format

```
# Pesquisa — {título da pauta}
Rodada: {YYYY-MM-DD} · Perguntas: {N} · Buscas executadas: {N}

## Pergunta 1 — {texto}
**Resposta:** {resposta direta}. [Confiança: Alta|Média|Baixa]
- Fonte: {nome/página} ({data})
- Fonte: {nome} ({data})
**Aplicável ao porte da 364:** {sim/não/com ressalva}

## Pergunta 2 — {...}
{mesmo formato}

## O que não foi encontrado
- {lacuna} — {como obter: medição interna, orçamento direto, etc.}
```

## Output Example

> # Pesquisa — Delivery próprio vs. iFood
> Rodada: 2026-07-18 · Perguntas: 3 · Buscas executadas: 7
>
> ## Pergunta 1 — Taxas do iFood 2026 para o porte da 364
> **Resposta:** plano básico ~12% + mensalidade; plano com entrega do iFood entre 23–27% por pedido, variando por categoria e cidade. [Confiança: Alta]
> - Fonte: página oficial de planos para restaurantes do iFood (acesso 2026-07-18)
> - Fonte: reportagem setorial sobre taxas de marketplaces (2026-05)
> **Aplicável ao porte da 364:** sim — taxa exata depende de negociação local.
>
> ## Pergunta 2 — Conversão de delivery via WhatsApp em cidades médias
> **Resposta:** sem estudo público regionalizado; benchmark geral (2025) indica que canal direto converte 2–3× melhor que marketplace quando a marca já é conhecida, exigindo resposta < 5 min. [Confiança: Baixa — fonte única]
> - Fonte: relatório de mercado de delivery Brasil (2025)
> **Aplicável ao porte da 364:** com ressalva — validar com piloto interno de 2 semanas.
>
> ## O que não foi encontrado
> - Custo de apps brancos de pedido (preço sob consulta) — orçar diretamente com 2 fornecedores.

## Veto Conditions

Reject and redo if ANY are true:
1. Qualquer achado sem fonte + data colados no parágrafo.
2. Pergunta do enquadramento ignorada (sem resposta nem declaração de "não localizado").
3. Número apresentado como fato quando é estimativa sem base declarada.

## Quality Criteria

- [ ] Resposta direta no topo de cada pergunta, com confiança declarada.
- [ ] Achados centrais cruzados em 2 fontes (ou confiança Baixa explícita).
- [ ] Filtro de aplicabilidade ao porte/região em toda resposta.
- [ ] Seção final de lacunas presente.
