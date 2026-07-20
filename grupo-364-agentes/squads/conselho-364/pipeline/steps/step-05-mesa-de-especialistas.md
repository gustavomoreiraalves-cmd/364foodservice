---
execution: inline
agent: priscila-prazo
inputFile: squads/conselho-364/output/pesquisa.md
outputFile: squads/conselho-364/output/contribuicoes.md
---

# Step 05: Mesa de Especialistas 📋

## Context Loading

Load these files before executing:
- `squads/conselho-364/output/enquadramento.md` — pergunta de decisão, critério de sucesso e lista de convocados
- `squads/conselho-364/output/pesquisa.md` — evidências externas da rodada
- `squads/conselho-364/pipeline/data/especialistas.md` — personas completas do Nível 2
- `squads/conselho-364/pipeline/data/anti-patterns.md` — regras "nunca fazer" que toda contribuição deve respeitar
- `squads/conselho-364/_investigations/consolidated-analysis.md` — padrões reais (para especialistas de marketing/branding/CX)

## Instructions

### Process
1. Priscila abre a mesa anunciando a pauta, o critério de sucesso e os convocados. Se Marina Marca (CMO) foi acionada no enquadramento, ela participa como membro do núcleo junto aos especialistas.
2. Para **cada especialista convocado**, assumir a persona descrita em `especialistas.md` (indicando claramente quem fala: "🍖 Gastão Gastronomia:") e produzir a contribuição no formato fixo: **Posição → Por quê (com dado da pesquisa ou benchmark) → Como aplicar no Grupo 364 → Risco que enxergo**.
3. Cada contribuição deve citar ao menos 1 dado (da pesquisa, do research-brief ou fornecido pelo usuário) e respeitar os anti-padrões — exceções precisam ser justificadas na própria contribuição.
4. Ao final, Priscila fecha a mesa com a **síntese**: pontos de convergência, conflitos reais (candidatos a dissidência) e o que segue para o COO.
5. Salvar tudo em `output/contribuicoes.md`.

## Output Format

```
# Mesa de Especialistas — {título da pauta}
**Convocados:** {lista} · **Critério de sucesso:** {resumo}

---

## {emoji} {Nome do Especialista} — {função}
**Posição:** {recomendo X}
**Por quê:** {argumento com dado citado}
**Como aplicar no Grupo 364:** {passos concretos na unidade certa}
**Risco que enxergo:** {risco + mitigação sugerida}

{repetir por convocado}

---

## Síntese da PMO
**Convergências:** {lista}
**Conflitos (candidatos a dissidência):** {lista ou "nenhum"}
**Segue para o COO:** {o que o plano operacional precisa resolver}
```

## Output Example

> # Mesa de Especialistas — Cardápio de inverno da Steakhouse
> **Convocados:** Gastão Gastronomia, Ivone Indústria · **Critério de sucesso:** ≥25 pratos/semana com CMV ≤31%
>
> ---
>
> ## 🍖 Gastão Gastronomia — Engenharia de Cardápio
> **Posição:** lançar 3 pratos quentes usando os defumados da própria Foodservices como insumo.
> **Por quê:** proteína pré-defumada reduz finalização de ~25 para ~8 min; sopas e escondidinhos são "burros de carga" clássicos de inverno (volume alto, margem média).
> **Como aplicar no Grupo 364:** escondidinho de brisket, caldo de costela defumada, panelinha de pulled pork; porção 380 g, CMV-alvo ≤30%.
> **Risco que enxergo:** canibalizar cortes premium do salão — posicionar como linha de almoço/delivery.
>
> ## 🏭 Ivone Indústria — Produção
> **Posição:** a fábrica absorve o insumo sem novo turno até 120 kg/semana.
> **Por quê:** o gargalo é câmara fria (60% de folga), não defumador.
> **Como aplicar:** produzir às segundas junto ao lote B2B, FIFO com etiqueta de lote.
> **Risco que enxergo:** demanda estourando disputa insumo com clientes B2B — definir prioridade antes do lançamento.
>
> ---
>
> ## Síntese da PMO
> **Convergências:** usar insumo próprio; limitar a 120 kg/semana; regra de prioridade B2B necessária.
> **Conflitos:** nenhum.
> **Segue para o COO:** fases de lançamento, treinamento de finalização e regra de prioridade de insumo.

## Veto Conditions

Reject and redo if ANY are true:
1. Alguma contribuição sem os 4 blocos do formato fixo (Posição/Por quê/Como aplicar/Risco).
2. Contribuição sem nenhum dado citado ("achismo puro").
3. Especialista não convocado opinando, ou convocado ausente sem justificativa.

## Quality Criteria

- [ ] Todos os convocados contribuíram no formato fixo.
- [ ] Cada contribuição cita ao menos 1 dado com origem.
- [ ] Anti-padrões respeitados (ou exceção justificada).
- [ ] Síntese da PMO fecha a mesa com conflitos explícitos.
