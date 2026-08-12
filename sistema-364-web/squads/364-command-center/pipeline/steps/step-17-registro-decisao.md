---
execution: inline
agent: atlas-364
inputFile: squads/364-command-center/output/executivo/16-documento-final.md
outputFile: squads/364-command-center/output/historico/17-registro-decisao.md
---

# Step 17: Registro da Decisão e dos Aprendizados

## Context Loading

Load these files before executing:
- `squads/364-command-center/output/executivo/16-documento-final.md` — documento final aprovado.
- `squads/364-command-center/output/executivo/14-revisao-conselho.md` — revisão do Conselho 364.
- `squads/364-command-center/_memory/memories.md` — memória persistente do squad (seções por tema).
- `squads/364-command-center/_memory/runs.md` — histórico de execuções.

## Instructions

### Process

1. Produzir um registro de execução resumido (esta demanda: empresa, categoria, decisão, resultado).
2. Adicionar uma linha à tabela em `_memory/runs.md` com data, run ID, tema, output e resultado.
3. Atualizar as seções relevantes de `_memory/memories.md` (ex: Decisões, Processos, Indicadores,
   Histórico de Problemas, Aprendizados) com o que foi decidido e qualquer aprendizado novo desta
   execução — nunca sobrescrever dados existentes, apenas adicionar.
4. Registrar explicitamente qualquer aprendizado sobre dado ausente recorrente, para reduzir a
   necessidade de "dados não fornecidos" em execuções futuras semelhantes.

## Output Format

The output MUST follow this exact structure:
```
# Registro de Decisão — [empresa/unidade]
**Data:** [data] | **Categoria:** [categorias]

## Decisão Registrada
[síntese da decisão aprovada]

## Resultado Esperado
[indicadores de sucesso definidos]

## Atualização de Memória
[quais seções de _memory/memories.md foram atualizadas e o que foi adicionado]

## Atualização de Histórico de Execuções
[linha adicionada a _memory/runs.md]

## Aprendizados desta Execução
[lições sobre dado ausente recorrente, processo do squad, ou qualquer melhoria identificada]
```

## Output Example

```markdown
# Registro de Decisão — 364 Food Services
**Data:** 2026-07-25 | **Categoria:** financeira, produção

## Decisão Registrada
Reajuste de preço de 7% na linha de defumados aprovado, com comunicação a assinantes e revisão do
processo de defumação.

## Resultado Esperado
Margem bruta ≥ 32% em 60 dias; rendimento de produção ≥ 80%.

## Atualização de Memória
Seção "Decisões": adicionado o reajuste de preço aprovado em 2026-07-25. Seção "Processos": adicionado
que o tempo de defumação da linha está sendo revisado. Seção "Aprendizados": adicionado que a ficha
técnica da linha de defumados deveria ser anexada por padrão em demandas futuras sobre essa linha, para
evitar a lacuna de dado "log de temperatura da defumadeira" recorrente nesta análise.

## Atualização de Histórico de Execuções
| 2026-07-25 | RUN-2026-0725-01 | Queda de margem — linha de defumados | output/financeiro/16-documento-final.md | Aprovado |

## Aprendizados desta Execução
Dados de log de temperatura da defumadeira não estavam disponíveis e atrasaram a conclusão definitiva do
Guardião 364 — recomenda-se implantar registro obrigatório desse log para análises futuras mais rápidas.
```

## Veto Conditions

Reject and redo if ANY of these are true:
1. A tabela de `_memory/runs.md` não foi atualizada com uma nova linha para esta execução.
2. Dados existentes em `_memory/memories.md` foram sobrescritos em vez de complementados.

## Quality Criteria

- [ ] `_memory/runs.md` recebeu uma nova linha com data, run ID, tema, output e resultado.
- [ ] `_memory/memories.md` foi atualizado por adição, não substituição, nas seções relevantes.
- [ ] Ao menos um aprendizado específico desta execução foi registrado.
