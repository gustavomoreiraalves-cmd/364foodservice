---
execution: inline
agent: atlas-364
inputFile: squads/364-command-center/output/executivo/15-aprovacao-gustavo.md
outputFile: squads/364-command-center/output/executivo/16-documento-final.md
---

# Step 16: Geração dos Documentos Finais

## Context Loading

Load these files before executing:
- `squads/364-command-center/output/executivo/15-aprovacao-gustavo.md` — decisão de Gustavo (itens
  aprovados, rejeitados ou ajustados).
- `squads/364-command-center/output/executivo/12-consolidacao.md` — consolidação executiva.
- `squads/364-command-center/output/planos-de-acao/13-plano-de-acao.md` — plano de ação original.
- `squads/364-command-center/output/executivo/01-classificacao.md` — classificação da demanda, para
  determinar a subpasta de output/ correspondente (financeiro, operacoes, comercial, marketing,
  pessoas, producao, projetos, dashboards, reunioes).

## Instructions

### Process

1. Filtrar o plano de ação para incluir apenas os itens efetivamente aprovados por Gustavo no Step 15
   (excluir ou ajustar os itens rejeitados/ajustados conforme instruído).
2. Montar o documento final com resumo executivo, decisão aprovada e plano de ação aprovado.
3. Determinar a subpasta de output/ correspondente à categoria principal da demanda (Step 01) e indicar
   explicitamente que uma cópia do documento final deve também ser salva nessa subpasta específica
   (ex: `output/financeiro/`, `output/producao/`), além do arquivo principal em `output/executivo/`.
4. Nunca incluir no documento final qualquer item que dependa de aprovação ainda não concedida.

## Output Format

The output MUST follow this exact structure:
```
# Documento Final — [empresa/unidade]
**Categoria:** [categorias] | **Aprovado por:** Gustavo Moreira Alves em [data]

## Resumo Executivo
[síntese]

## Decisão Aprovada
[o que foi efetivamente aprovado]

## Plano de Ação Aprovado
| Ação | Empresa | Área | Responsável | Prazo | Prioridade | Indicador |
|---|---|---|---|---|---|---|

## Itens Não Aprovados ou Ajustados
[se houver]

## Subpasta de Arquivamento
[ex: output/financeiro/ — cópia deste documento deve ser salva também nesta subpasta]
```

## Output Example

```markdown
# Documento Final — 364 Food Services
**Categoria:** financeira, produção | **Aprovado por:** Gustavo Moreira Alves em 2026-07-25

## Resumo Executivo
Margem bruta da linha de defumados caiu de 34% para 27% em 60 dias. Reajuste de preço e revisão de
processo de produção aprovados para recuperar a margem.

## Decisão Aprovada
Reajuste de preço da linha em 7%, com comunicação prévia a assinantes, e revisão do processo de
defumação com validação técnica.

## Plano de Ação Aprovado
| Ação | Empresa | Área | Responsável | Prazo | Prioridade | Indicador |
|---|---|---|---|---|---|---|
| Reajustar preço da linha em 7% | 364 Food Services | Financeiro | CFO 364 + Gustavo | 2026-08-01 | P0 | Margem bruta ≥ 32% em 60 dias |
| Comunicar reajuste a assinantes | 364 Food Services | Marketing | Brand 364 | 2026-07-30 | P0 | 0 reclamações formais |

## Itens Não Aprovados ou Ajustados
Item "buscar cotação de fornecedor alternativo" (P2) adiado — Gustavo pediu para revisar após o
resultado do reajuste de preço.

## Subpasta de Arquivamento
output/financeiro/ (categoria principal: financeira)
```

## Veto Conditions

Reject and redo if ANY of these are true:
1. O documento final inclui um item que não foi explicitamente aprovado por Gustavo no Step 15.
2. A subpasta de arquivamento correspondente à classificação da demanda não foi indicada.

## Quality Criteria

- [ ] Somente itens aprovados por Gustavo aparecem no plano de ação final.
- [ ] A subpasta de output/ correspondente à categoria da demanda está indicada.
- [ ] O documento cita explicitamente a data e o aprovador (Gustavo Moreira Alves).
