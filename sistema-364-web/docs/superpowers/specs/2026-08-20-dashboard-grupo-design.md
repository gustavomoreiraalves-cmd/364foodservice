# Dashboard consolidada do Grupo 364 — design

Data: 2026-08-20
Status: aprovado para planejamento

## Problema

Hoje toda tela do sistema é escopada por uma empresa de cada vez. O seletor de
empresa no `AppShell` define `empresaAtual`, e cada página consulta o Supabase
com `.eq('empresa_id', empresaAtual.id)`. Para comparar 364 Steakhouse, Food
Service, Burguer e Foodtruck/Afya, a diretoria precisa trocar de empresa quatro
vezes, anotar os números à mão e somar fora do sistema.

Não existe nenhuma tela que responda "como está o grupo neste mês".

## Objetivo

Uma tela que mostre, sem trocar a seleção de empresa, os números do grupo
inteiro no mês corrente — receita, CMV, margem, despesas, lucro, número de
pedidos e ticket médio — mais a comparação lado a lado entre as empresas e a
tendência dos últimos doze meses.

Referência visual e de indicadores: o modelo de dashboard de Tiny ERP publicado
pela Kondado (resumo com receita, quantidade de pedidos, ticket médio, evolução
temporal e ranking).

## Decisões

| Assunto | Decisão |
|---|---|
| Rota | Nova rota `/grupo`. A home `/` continua sendo a visão da empresa selecionada. |
| Regime | Competência e caixa lado a lado. |
| Período | Abre no mês corrente, com variação contra o mês anterior e série de 12 meses. |
| Gráficos | SVG próprio, sem nova dependência. |
| Permissão | Novo módulo `grupo`, tratado como qualquer outra aba. |
| CMV | Custo cadastrado no produto, com fallback para o custo teórico da ficha técnica. |
| Escopo v1 | KPIs do grupo + ranking por empresa + série de 12 meses. Sem alertas de caixa e sem despesa por categoria. |

### Por que agregar no banco e não no client

As demais telas do sistema baixam as linhas cruas e agregam em JavaScript. Isso
funciona porque cada tela olha uma empresa e, em geral, um recorte curto. Esta
tela olha doze meses de quatro empresas ao mesmo tempo. Em operação de
restaurante isso são milhares de linhas de `pedido_itens` por mês, e o payload
passa a ser o gargalo.

A agregação vai para duas views no Postgres, e o client recebe uma linha por
empresa por mês.

## Arquitetura

```
supabase/atualizacao_21_dashboard_grupo.sql
  ├── produtos.custo_unitario            (coluna nova)
  ├── vw_produto_custo                   (custo efetivo + origem)
  ├── vw_consolidado_mensal              (1 linha por empresa × mês)
  └── permissao 'grupo'                  (concedida a quem já tem 'relatorios')

lib/consolidado.js                       (funções puras, sem React, sem Supabase)
components/charts/SerieMensal.js         (SVG)
components/charts/BarraParticipacao.js   (SVG)
app/grupo/page.js                        (fetch + composição)
app/produtos/page.js                     (campo de custo unitário)
lib/auth.js                              (MODULOS ganha 'grupo')
tests/consolidado.test.mjs
```

## Modelo de dados

### `produtos.custo_unitario`

```sql
alter table produtos add column if not exists custo_unitario numeric(12,2) not null default 0;
```

O valor é digitado no cadastro do produto. Zero significa "não informado", e o
cálculo cai no custo teórico da ficha técnica.

### `vw_produto_custo`

Resolve o custo de cada produto e diz de onde ele veio, para que a tela possa
sinalizar comparações frágeis.

```sql
create view vw_produto_custo with (security_invoker = true) as
select
  p.empresa_id,
  p.id as produto_id,
  case when coalesce(p.custo_unitario, 0) > 0 then p.custo_unitario
       else coalesce(ft.custo_ficha, 0) end as custo_efetivo,
  case when coalesce(p.custo_unitario, 0) > 0 then 'cadastro'
       when coalesce(ft.custo_ficha, 0) > 0 then 'ficha'
       else 'sem_custo' end as origem_custo
from produtos p
left join lateral (
  select sum(f.quantidade * mp.custo_unitario) as custo_ficha
  from ficha_tecnica f
  join materias_primas mp
    on mp.id = f.materia_prima_id and mp.empresa_id = f.empresa_id
  where f.produto_id = p.id and f.empresa_id = p.empresa_id
) ft on true;
```

### `vw_consolidado_mensal`

Uma linha por `(empresa_id, mes)`. Montada como `union all` de agregados por
fonte, seguido de `group by` — juntar as fontes por `join` multiplicaria as
linhas de venda pelas de despesa.

Colunas: `empresa_id`, `mes` (texto `AAAA-MM`), `receita_competencia`,
`receita_caixa`, `cmv`, `pedidos_qtd`, `itens_qtd`, `despesa_competencia`,
`despesa_caixa`, `compras`.

Fontes de cada coluna:

| Coluna | Origem | Filtro |
|---|---|---|
| `receita_competencia` | `pedido_itens` × `pedidos.data` | `status <> 'Cancelado'` |
| `receita_caixa` | idem | `status in ('Faturado','Enviado')` |
| `cmv` | `pedido_itens.quantidade × vw_produto_custo.custo_efetivo` | `status <> 'Cancelado'` |
| `pedidos_qtd` | `count(distinct pedidos.id)` | `status <> 'Cancelado'` |
| `itens_qtd` | `sum(pedido_itens.quantidade)` | `status <> 'Cancelado'` |
| `despesa_competencia` | `contas_a_pagar.valor_total` por `created_at` | `recebimento_id is null` |
| `despesa_caixa` | `contas_a_pagar_parcelas.valor` por `data_pagamento` | `status = 'Pago'` |
| `compras` | `recebimento_itens.quantidade × custo_unitario` por `recebimentos.data` | `status_recebimento in ('Aceito','Aceito com ressalva')` |

Três detalhes que mudam o número se forem ignorados:

1. **`recebimento_id is null` na despesa.** Contas a pagar geradas a partir de um
   recebimento já são contabilizadas na coluna `compras`. Sem esse filtro a
   compra de matéria-prima entra duas vezes. `app/relatorios/page.js` já aplica
   o mesmo filtro.
2. **Fuso horário.** `created_at` e `data_pagamento` são `timestamptz` gravados
   em UTC. Uma conta lançada às 21h do dia 31 cai no mês seguinte se o mês for
   extraído direto. Todo agrupamento usa
   `to_char(coluna at time zone 'America/Sao_Paulo', 'YYYY-MM')`.
3. **`security_invoker = true` nas duas views.** Sem isso a view roda com o dono
   (`postgres`) e devolve linhas de empresas às quais o usuário não tem acesso,
   furando a RLS. É o padrão já adotado em `atualizacao_07_views_empresa.sql`.

A qualidade do recebimento é lida de `recebimento_itens.status_recebimento`, e
não de `inspecoes_qualidade` — esta última existe em produção mas não tem
migração versionada no repositório, e a view não pode depender de um objeto que
o repo não cria.

### Permissão

```sql
insert into public.permissoes (user_id, modulo)
select p.user_id, 'grupo' from public.permissoes p where p.modulo = 'relatorios'
on conflict do nothing;
```

Sem esse `insert`, a aba nasceria invisível para todos exceto administradores.
Quem hoje enxerga Relatórios já enxerga receita e margem da empresa, então
conceder o consolidado ao mesmo público não amplia o que estava exposto.

## Camada de cálculo — `lib/consolidado.js`

Funções puras sobre as linhas de `vw_consolidado_mensal`. Não importam React
nem Supabase, e por isso rodam no `node --test` sem browser nem banco.

- `consolidar(linhas)` — soma as empresas e devolve os totais do grupo, mais
  `margemBrutaPct`, `lucroLiquido`, `ticketMedio` e `saldoCaixa`.
- `porEmpresa(linhas, empresas)` — uma linha por empresa, com participação
  percentual na receita do grupo. Empresa sem movimento no mês aparece zerada,
  não desaparece.
- `variacao(atual, anterior)` — variação percentual. Base zero devolve `null`,
  que a tela renderiza como `—`; devolver `Infinity` ou `100%` mentiria.
- `serie12(linhas, mesFinal)` — doze posições sempre preenchidas. Mês sem
  movimento vira zero, para o gráfico não ter buraco.

Toda divisão é guardada: denominador zero devolve `0`.

## Componentes de gráfico

`components/charts/SerieMensal.js` — SVG com `viewBox` e `width: 100%`. Barras
de receita e de custo, linha de lucro sobreposta, doze rótulos de mês. Cores das
variáveis CSS já existentes (`--amber`, `--amber-bright`, `--border`,
`--paper-dim`).

`components/charts/BarraParticipacao.js` — barra horizontal fina usada dentro da
tabela de ranking, mostrando a fatia da empresa na receita do grupo.

Ambos recebem dados já calculados por props. Nenhum busca nada.

## Tela — `app/grupo/page.js`

Usa `AppShell modulo="grupo"`, lê `empresas` do `EmpresaContext` e ignora
`empresaAtual`. A consulta é uma só:

```js
supabase.from('vw_consolidado_mensal')
  .select('*')
  .in('empresa_id', empresas.map(e => e.id))
  .gte('mes', mesInicial)   // 11 meses antes do selecionado
  .lte('mes', mesSelecionado)
```

Blocos, de cima para baixo:

1. **Filtro** — `input type="month"`, padrão mês corrente.
2. **KPIs do grupo** (`.kpi-grid`), cada um com a variação contra o mês
   anterior: Receita, CMV, Margem bruta %, Despesas, Lucro líquido, Nº de
   pedidos, Ticket médio, Caixa do mês.
3. **Competência × Caixa** (`.grid2`) — dois painéis. À esquerda o DRE do mês
   (receita − CMV = lucro bruto − despesas = lucro líquido). À direita o caixa
   (entradas de pedidos faturados/enviados, saídas de compras e de parcelas
   pagas, saldo).
4. **Série de 12 meses** — painel com o `SerieMensal`.
5. **Por empresa** — tabela: empresa, receita, participação %, CMV, margem %,
   despesa, lucro, pedidos, ticket médio e uma `tag` com a origem do custo
   (`cadastro`, `ficha`, `sem custo`). Ordenada por receita decrescente.

## Bordas e erros

- Usuário com acesso a uma única empresa: a tela funciona, o ranking tem uma linha.
- Empresa sem movimento no mês: linha zerada no ranking.
- Mês sem nenhum movimento no grupo: painéis mostram "Sem movimento em `<mês>`".
- Margem e ticket médio com denominador zero: exibem `0`, não `NaN`.
- Erro de consulta: `<p className="erro">` com a mensagem, nunca tela em branco.
- View inexistente (migração não rodada): mensagem explícita pedindo para rodar
  `supabase/atualizacao_21_dashboard_grupo.sql`.

## Cadastro de produto

`app/produtos/page.js` ganha o campo "Custo unitário (R$)" no formulário de
produto, ao lado de "Preço de venda". Abaixo do campo, o custo teórico calculado
pela ficha técnica aparece como referência, com um botão que o copia para o
campo. A listagem marca com `tag` os produtos que ainda estão sem custo próprio,
para deixar visível o que sustenta o CMV.

## Testes

`tests/consolidado.test.mjs`, no `node --test` já configurado em `npm test`:

- consolidação de três empresas soma receita, CMV e pedidos corretamente;
- margem bruta com receita zero devolve `0`;
- `variacao` com mês anterior zero devolve `null`;
- `serie12` preenche mês faltante com zero e mantém doze posições;
- `porEmpresa` mantém no ranking a empresa sem movimento;
- ticket médio com zero pedidos devolve `0`.

## Fora de escopo nesta versão

Alertas de parcelas vencidas, despesa por categoria de conta, curva ABC de
produtos, recorte por cliente ou região, e exportação. A estrutura de
`vw_consolidado_mensal` e de `lib/consolidado.js` comporta cada um deles depois
sem reescrita.

## Limitações conhecidas

- Receita de caixa usa `pedidos.data`, não a data de faturamento — a tabela
  `pedidos` não guarda quando o pedido foi faturado. Em mês de virada o valor
  pode ficar no mês do pedido, e não no do recebimento.
- Despesa por competência usa `contas_a_pagar.created_at`, que é a data de
  lançamento no sistema, não a data do fato gerador. Uma conta de julho lançada
  em agosto conta em agosto.

Ambas dependem de coluna nova nas tabelas de origem e ficam para depois.
