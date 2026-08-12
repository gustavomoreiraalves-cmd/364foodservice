---
execution: inline
agent: atlas-364
outputFile: squads/364-command-center/output/executivo/01-classificacao.md
---

# Step 01: Recebimento e Classificação da Demanda

## Context Loading

Load these files before executing:
- `_opensquad/_memory/company.md` — contexto das empresas do Grupo 364 (nome, tom, produtos).
- `squads/364-command-center/_memory/memories.md` — seção "Contexto do Grupo 364" (empresas/unidades já
  confirmadas, decisões e processos registrados em execuções anteriores).
- `squads/364-command-center/pipeline/data/domain-framework.md` — framework operacional de classificação
  (Etapa 1: Recepção e Classificação).
- A solicitação original do usuário, fornecida em texto livre no início da execução do pipeline.

## Instructions

### Process

1. Ler a solicitação original e reformulá-la em uma frase-problema objetiva, sem jargão, de no máximo 2 frases.
2. Identificar a empresa/unidade do Grupo 364 envolvida (364 Steakhouse, 364 Food Services, 364
   Foodtruck/Afya, 364 Buffet e Eventos, ou novo projeto/unidade). Se a solicitação não deixar isso claro,
   listar as hipóteses mais prováveis com base no contexto da demanda e marcar como pendência de
   esclarecimento.
3. Classificar a demanda em uma ou mais das categorias formais: estratégica, financeira, operacional,
   comercial, marketing, pessoas, produção, qualidade, projeto, crise, expansão. Justificar brevemente
   cada categoria escolhida.
4. Registrar quaisquer dados já mencionados na solicitação original, para uso no próximo step (verificação
   de dados).

## Output Format

The output MUST follow this exact structure:
```
# Classificação da Demanda — Atlas 364

## Frase-Problema
[reformulação objetiva da solicitação]

## Empresa/Unidade Envolvida
[nome da empresa ou lista de hipóteses, se ambíguo]

## Classificação
- Categoria(s): [lista das categorias formais aplicáveis]
- Justificativa: [breve explicação de por que cada categoria se aplica]

## Dados Já Mencionados na Solicitação
[lista dos dados citados na solicitação original, se houver]

## Pendências de Esclarecimento
[qualquer ambiguidade sobre empresa/unidade ou escopo que precise de confirmação]
```

## Output Example

```markdown
# Classificação da Demanda — Atlas 364

## Frase-Problema
A margem da linha de defumados da 364 Food Services caiu nos últimos dois meses e Gustavo quer entender
a causa e o que fazer.

## Empresa/Unidade Envolvida
364 Food Services (central de produção)

## Classificação
- Categoria(s): financeira, produção, qualidade
- Justificativa: envolve análise de margem e custo (financeira) e possível causa relacionada a
  rendimento/processo de produção (produção, qualidade).

## Dados Já Mencionados na Solicitação
Margem bruta da linha caiu de 34% para 27% nos últimos 60 dias (dado real, mencionado por Gustavo).

## Pendências de Esclarecimento
Nenhuma pendência sobre a empresa envolvida — demanda explicitamente referenciou a 364 Food Services.
Pendente: confirmar se a análise deve cobrir apenas a linha de defumados ou toda a central de produção.
```

## Veto Conditions

Reject and redo if ANY of these are true:
1. A empresa/unidade do Grupo 364 envolvida não foi identificada nem listada como hipótese.
2. Nenhuma categoria formal de classificação foi atribuída à demanda.

## Quality Criteria

- [ ] A frase-problema é objetiva e livre de jargão desnecessário.
- [ ] A empresa/unidade envolvida está explicitamente identificada ou as hipóteses estão listadas.
- [ ] Ao menos uma categoria formal de classificação foi atribuída com justificativa.
- [ ] Dados já mencionados na solicitação original foram registrados para uso no próximo step.
