---
execution: inline
agent: rebeca-rigor
inputFile: squads/conselho-364/output/parecer-executivo.md
outputFile: squads/conselho-364/output/revisao.md
---

# Step 10: Revisão do Parecer 🔎

## Context Loading

Load these files before executing:
- `squads/conselho-364/pipeline/data/quality-criteria.md` — os 8 critérios e os gatilhos duros (LER ANTES do parecer)
- `squads/conselho-364/pipeline/data/domain-framework.md` — estrutura obrigatória
- `squads/conselho-364/pipeline/data/output-examples.md` — calibragem do "bom"
- `squads/conselho-364/pipeline/data/anti-patterns.md` — regras que o parecer não pode violar
- `squads/conselho-364/output/parecer-executivo.md` — o documento sob revisão

## Instructions

### Process
1. Carregar critérios e exemplo de referência ANTES de ler o parecer; depois ler o parecer completo sem pontuar na primeira passada.
2. Pontuar os **8 critérios** (1–10), cada nota com justificativa e localização exata ("seção X, item Y"); verificar nominalmente os **4 gatilhos duros** (ação órfã, número sem fonte, anti-padrão violado sem justificativa, unidade afetada ignorada).
3. Calcular o veredito: média ≥7 sem nota <4 → **APROVA**; média ≥7 com notas 4–6 → **APROVA CONDICIONAL** (ajustes obrigatórios listados); média <7 OU gatilho duro → **REJEITA**.
4. Compilar a revisão no formato fixo, separando **mudanças obrigatórias** de **sugestões não-bloqueantes**, com ao menos 1 ponto forte. Registrar o número do ciclo (1 de 3, 2 de 3...).
5. Se REJEITA → o pipeline volta ao passo 9 (PMO refaz com as mudanças obrigatórias). No 3º ciclo com o mesmo problema → ESCALAR ao usuário.

## Output Format

```
==============================
**VEREDITO: {APROVA | APROVA CONDICIONAL | REJEITA}** · Ciclo de revisão: {N} de 3
==============================

| Critério | Nota | Observação |
|---|---|---|
| 1. Resposta direta | {n} | {justificativa curta} |
| ... (8 critérios) |
**Média: {n} · Gatilhos duros: {nenhum | qual}**

**Mudanças obrigatórias:** (se houver)
1. {o quê, onde, como consertar}

**Sugestões não-bloqueantes:**
- {melhoria desejável}

**Ponto forte:** {o que deve se repetir}
```

## Output Example

> ==============================
> **VEREDITO: APROVA CONDICIONAL** · Ciclo de revisão: 1 de 3
> ==============================
>
> | Critério | Nota | Observação |
> |---|---|---|
> | 1. Resposta direta | 9 | Decisão clara no 1º parágrafo |
> | 2. Base em dados | 8 | Fontes presentes em todos os argumentos |
> | 3. Acionabilidade | 6 | Linha 4 do plano sem indicador |
> | 4. Aderência ao Grupo 364 | 8 | Unidades e região corretas |
> | 5. Rigor financeiro | 8 | Premissas declaradas, cenários ok |
> | 6. Riscos com mitigação | 7 | 2 riscos, mitigação prática |
> | 7. Confiança declarada | 7 | Presente nas 4 recomendações |
> | 8. Formato | 9 | Estrutura completa |
> **Média: 7,75 · Gatilhos duros: nenhum**
>
> **Mudanças obrigatórias:**
> 1. Plano de ação, linha 4 ("orçar embalagens"): adicionar indicador de conclusão (ex.: "2 orçamentos recebidos").
>
> **Sugestões não-bloqueantes:**
> - Mover a tabela de cenários para antes dos riscos — melhora a leitura.
>
> **Ponto forte:** enquadramento e critério de sucesso exemplares — replicar nas próximas rodadas.

## Veto Conditions

Reject and redo (a própria revisão) if ANY are true:
1. Alguma nota sem justificativa localizada.
2. Veredito contradizendo as notas (ex.: APROVA com critério < 4).

## Quality Criteria

- [ ] 8 critérios pontuados, gatilhos verificados nominalmente.
- [ ] Obrigatório separado de sugestão.
- [ ] Ponto forte registrado.
- [ ] Ciclo numerado.
