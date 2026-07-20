# Domain Framework — Como o Conselho 364 delibera

Fluxo canônico (do PDF "Estrutura Estratégica do Squad de IA — Grupo 364"):
**CEO define prioridades → PMO organiza → Especialistas elaboram → COO coordena → CFO acompanha → BI consolida indicadores.**

## 1. Enquadramento (CEO)

Toda pauta entra por uma pergunta de decisão, não por um tema vago.
- Transformar "falar sobre delivery" em "devemos assinar o plano X de delivery próprio ou seguir só no iFood?"
- Classificar a pauta: **decisão** (escolher entre opções) / **problema** (diagnóstico + solução) / **projeto** (planejamento do Nível 3).
- Definir o critério de sucesso da rodada e quais especialistas do Nível 2 são convocados (mínimo necessário).

## 2. Evidências antes de opinião (Pesquisa + BI)

- Nenhuma recomendação sem pelo menos 1 dado externo (mercado) e 1 dado interno (operação/sistema-364-web, quando o usuário fornecer).
- Benchmarks de referência ficam em `research-brief.md`; a pesquisa da rodada foca APENAS no que a pauta exige.

## 3. Deliberação (Especialistas → COO → CFO → BI)

- Cada especialista convocado contribui no seu domínio, com posição clara (recomendo X porque Y) — nunca "depende".
- COO converte recomendações em plano executável por unidade (quem, o quê, quando).
- CFO quantifica: investimento, impacto no CMV/prime cost, ponto de equilíbrio, risco de caixa.
- BI define como mediremos: 2–4 indicadores com meta e frequência de leitura.

## 4. Parecer Executivo (PMO) — formato de entrega

Estrutura obrigatória do parecer (inspirada nos padrões da investigação — tese direta + frases-martelo + plano):

```
# Parecer Executivo — {título da pauta}
**Data | Pauta | Tipo | Especialistas convocados**

## Decisão recomendada  (1 parágrafo, começa com a resposta)
## Por quê  (3–5 argumentos com dados)
## Plano de ação  (tabela: ação | responsável | prazo | indicador)
## Riscos e mitigação  (2–4 riscos)
## Indicadores de acompanhamento  (metas + frequência)
## Dissidências  (se algum agente discordou, registrar aqui)
```

## 5. Regras de deliberação

- **Divergência é registrada, não apagada**: se CFO e CMO discordam, o parecer mostra as duas posições e o CEO desempata com justificativa.
- **YAGNI de especialistas**: convocar só quem a pauta exige; rodada típica usa 2–3 especialistas.
- **Toda ação tem dono e prazo** — ação sem responsável não entra no parecer.
- **Confiança declarada**: recomendações marcadas como Alta/Média/Baixa confiança conforme a base de dados (padrão data-analysis).
- **Anomalia >25%** em qualquer métrica citada = destaque imediato no parecer.
