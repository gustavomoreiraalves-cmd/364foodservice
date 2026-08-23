# Importação de vendas do PDV Consumer (364 Steakhouse e 364 Afya) — design

Data: 2026-08-23
Status: aprovado para planejamento

## Problema

A 364 Steakhouse e a 364 Foodtruck/Afya vendem pelo PDV Consumer. Os números de
venda, itens e fechamento de caixa ficam só no painel Consumer Connect
(`connect.consumer.com.br`), que mostra uma loja e um período de cada vez e não
conversa com o 364 OS. Para decidir compras, escala e mix de cardápio a gestão
hoje abre o painel, anota e soma à mão.

A tela `/vendas/importacao` existe no menu como "Em construção".

## Objetivo

Ter, dentro do 364 OS, por unidade e por dia:

1. venda diária por tipo de atendimento (mesa/comanda × delivery) e por origem
   (comanda mobile, balcão, iFood, MenuDino, DeliveryHub);
2. fechamento de caixa por forma de pagamento (Pix, crédito/débito por bandeira,
   iFood Online, voucher, dinheiro, fiado), com valor bruto, taxa e líquido;
3. venda por item (quantidade, valor, custo informado no PDV, curva ABC).

Fora de escopo nesta versão: contas a pagar do Consumer (as despesas vivem no
módulo Financeiro do 364 OS), baixa de estoque a partir das vendas do PDV,
de-para com o catálogo de produtos do 364 OS, clientes do PDV.

## Fonte de dados

O Consumer Connect é um painel ASP.NET MVC sem API pública. As telas carregam
dados por endpoints internos (DataTables server-side) que devolvem JSON, e os
detalhes (itens de um pedido, movimentações de um caixa) vêm como fragmentos
HTML. Mapeamento completo em 23/08/2026, com sessão logada:

| Dado | Endpoint | Formato |
|---|---|---|
| Filtro de período | `POST /QueryFilters/SetDateFilter` `start=YYYY-MM-DD HH:mm&end=...` | estado de sessão |
| Filtro de loja | `POST /QueryFilters/SetDatabaseFilter` `ids=<id>` | estado de sessão |
| Pedidos | `POST /Pedidos/GetListaPedidos` | JSON paginado |
| Detalhe do pedido | `GET /Pedidos/GetDetalhesPedido?id=<ID>` | HTML (itens, totais, pagamentos) |
| Caixas | `POST /Financeiro/GetHistoricoCaixa` | JSON paginado |
| Detalhe do caixa | `GET /Financeiro/GetDetalhesCaixa?id=<ID>` | HTML (movimentações) |
| Recebimentos | `POST /Financeiro/GetRecebimentos` | JSON paginado |
| Vendas por item | `POST /Produtos/GetProdutosVendidos` | JSON completo do período |

Lojas: `-2147478159` = 364 Steakhouse (Dois de Abril), `-2147458165` = 364
Foodtruck/Afya (Jardim dos Migrantes). O campo `Estabelecimento` das respostas
diz "364 Steakhouse" para as duas — a unidade vem do filtro, nunca do payload.

Os endpoints paginados exigem o corpo no formato DataTables (`draw`, `start`,
`length`, `order[]`, `columns[]`) e o header `X-Requested-With: XMLHttpRequest`.
Sem `columns[]` o servidor responde `Object reference not set to an instance of
an object`.

### Riscos assumidos

- **Uso não oficial.** Mudança de layout ou de endpoint no Connect quebra o
  importador. Mitigação: payload bruto guardado em `jsonb`, testes de parser
  com fixtures reais, e log de execução visível na tela.
- **Sessão.** O importador usa o cookie de uma sessão aberta manualmente no
  navegador (Claude não digita senha). Se a sessão expirar, a execução falha
  com erro claro e a tela mostra "última importação em …" em vermelho.
  Duração da sessão ainda não medida — primeira semana de operação vai dizer
  se o cookie dura dias ou horas.
- **Dados em aberto.** Pedido aberto hoje fecha amanhã; caixa aberto só tem
  saldo final depois do fechamento. O importador reprocessa sempre uma janela
  (D-3 até hoje) e faz upsert, então o que mudou é corrigido na próxima rodada.

## Decisões

| Assunto | Decisão |
|---|---|
| Onde roda | Script Node no Mac (mesmo modelo do backup), via cron diário. Não roda na Vercel: precisa do cookie local e o painel pode demorar minutos. |
| Identidade | `(empresa_id, codigo)` é a chave natural de pedidos e caixas. `codigo` é o número visível no PDV (ex.: pedido 75218, caixa 1561). O `ID` hash do Connect é guardado, mas não é chave — pode mudar entre sessões. |
| Empresa | Tabela `pdv_lojas` mapeia o id de loja do Connect para `empresas.id`. Sem essa linha, a loja é ignorada com aviso. |
| Idempotência | Upsert em tudo. Rodar duas vezes o mesmo dia não duplica nada. |
| Itens e pagamentos | Filhos são apagados e reinseridos a cada reprocessamento do pai (`delete where pedido_id = …` + insert). Evita diff de linhas de HTML sem chave estável. |
| Payload bruto | Toda tabela-pai guarda `origem_raw jsonb` com o JSON (ou o HTML, em `origem_html text`) que gerou a linha. |
| Agregação | Views SQL por dia × empresa, como no `/grupo`. A tela recebe poucas linhas. |
| Permissão | Módulo `pedidos` (já cobre o grupo Vendas do menu). Sem módulo novo. |
| Rota | Substitui o placeholder `/vendas/importacao`. Título: "Vendas PDV (Steakhouse/Afya)". |
| RLS | Mesmo padrão das demais tabelas: leitura para quem tem a empresa em `usuario_empresas`; escrita só pelo service role (o importador). |
| Datas | O PDV opera em Ji-Paraná (America/Porto_Velho, UTC-4). `/Date(ms)/` vira `timestamptz`; o "dia da venda" é a data de **abertura** do pedido no fuso local, porque o caixa do dia fecha depois da meia-noite e um pedido aberto 23:50 e fechado 00:20 pertence ao dia anterior. |

## Arquitetura

```
supabase/atualizacao_30_pdv_consumer.sql
  ├── pdv_lojas                  (id_connect → empresa_id)
  ├── pdv_pedidos                (1 por pedido)
  ├── pdv_pedido_itens           (itens, com pai p/ combo e complemento)
  ├── pdv_pagamentos             (pagamentos do pedido)
  ├── pdv_caixas                 (1 por caixa)
  ├── pdv_caixa_movimentos       (movimentações do caixa)
  ├── pdv_recebimentos           (1 por recebimento — traz taxa e líquido)
  ├── pdv_vendas_itens_dia       (snapshot diário do GetProdutosVendidos)
  ├── pdv_importacoes            (log de execução)
  ├── vw_pdv_vendas_dia          (dia × empresa × tipo × origem)
  ├── vw_pdv_caixa_formas_dia    (dia × empresa × forma × operadora)
  └── RLS + índices

lib/pdvConsumer/
  ├── connect.js      (cliente HTTP: filtros de sessão, paginação DataTables)
  ├── parse.js        (funções puras: /Date/ → Date, HTML do pedido e do caixa → objetos)
  └── normaliza.js    (funções puras: linha JSON → linha de tabela; classifica tipo/origem/forma)

scripts/importar-pdv-consumer.mjs   (orquestra: lojas × janela de datas → upserts)
scripts/IMPORTACAO-PDV.md           (como abrir sessão, pegar cookie, rodar, cron)

app/vendas/importacao/page.js       (tela)
components/charts/*                 (reusa SerieMensal / BarraParticipacao)
lib/pdvVendas.js                    (funções puras de agregação da tela)

tests/pdv-parse.test.mjs            (fixtures reais anonimizadas de HTML/JSON)
tests/pdv-normaliza.test.mjs
tests/migracao-30/                  (smoke da migração, como migracao-29)
```

## Modelo de dados

Valores monetários `numeric(12,2)`; quantidades `numeric(12,4)` (o PDV devolve
`1,0000`). Todas as tabelas têm `empresa_id uuid not null references empresas`,
`criado_em`, `atualizado_em` (trigger `fn_set_updated_at`, já existente).

### `pdv_lojas`

| coluna | tipo | obs |
|---|---|---|
| id_connect | bigint pk | `-2147478159`, `-2147458165` |
| empresa_id | uuid fk | |
| nome_connect | text | "RO/Ji-Paraná - Dois de Abril 364 Steakhouse" |
| ativo | boolean | |

Seed na migração com as duas lojas conhecidas.

### `pdv_pedidos`

| coluna | tipo | origem |
|---|---|---|
| id | uuid pk | |
| empresa_id | uuid | filtro de loja |
| codigo | integer | `Codigo` |
| id_connect | bigint | `ID` |
| tipo | text | `Tipo` → `mesa` \| `delivery` \| `outro` |
| tipo_original | text | `Tipo` cru |
| origem | text | `Origem` cru ("Comanda Mobile", "iFood", …) |
| status | text | `Status` cru |
| finalizado | boolean | `Status` começa com "Finalizado" |
| cliente | text | `NomeCliente` |
| numero | integer | `Numero` (mesa/comanda) |
| qtd_itens | numeric | `QtdItens` |
| valor_total | numeric | `ValorTotal` |
| valor_itens, valor_desconto, valor_entrega, valor_servico, valor_acrescimo | numeric | detalhe HTML |
| aberto_em, fechado_em | timestamptz | `DataHoraAbertura/Fechamento` |
| dia_venda | date | `aberto_em` em America/Porto_Velho (coluna gerada) |
| excluido_em | timestamptz | `DataHoraExclusao` |
| origem_raw | jsonb | linha JSON |
| origem_html | text | detalhe |

Unique `(empresa_id, codigo)`. Índice `(empresa_id, dia_venda)`.

### `pdv_pedido_itens`

`pedido_id` fk on delete cascade, `posicao` (ordem no HTML), `nome`,
`observacao` (ex.: "Gelo e limão"), `quantidade`, `preco_unitario`, `valor`,
`item_pai_posicao` (nulo para item principal; para componentes de combo aponta
a posição do combo), `eh_combo boolean`.

### `pdv_pagamentos`

`pedido_id` fk cascade, `valor`, `forma` (cru: "Pix Manual", "Cartão de Crédito"),
`operadora` (cru: "Mastercard", "(69)99280-1420", "Voucher"), `forma_grupo`
(normalizada: `pix` \| `credito` \| `debito` \| `dinheiro` \| `ifood_online` \|
`voucher` \| `fiado` \| `outro`), `pago_em timestamptz`.

### `pdv_caixas`

`codigo`, `id_connect`, `usuario`, `status` ("Aberto"/"Fechado"), `aberto_em`,
`fechado_em`, `dia_caixa date` (= `aberto_em` local), `saldo_inicial`,
`saldo_final`, `total_dinheiro`, `observacao`, `origem_raw`, `origem_html`.
Unique `(empresa_id, codigo)`.

### `pdv_caixa_movimentos`

`caixa_id` fk cascade, `posicao`, `operacao` ("Abertura", "Recebimento",
"Sangria", "Suprimento", …), `origem` ("Caixa", "Pedido 75089"),
`pedido_codigo integer` (extraído de `origem` quando houver), `momento
timestamptz`, `entrada`, `saida`, `forma`, `operadora`, `forma_grupo`.

### `pdv_recebimentos`

Fonte `GetRecebimentos`, que é a única que traz **taxa e valor líquido**.
`pedido_codigo`, `caixa_codigo`, `categoria` ("Recebimento - Vendas"), `forma`,
`operadora`, `forma_grupo`, `valor`, `valor_liquido`, `percentual_taxa`,
`parcela`, `pago_em`, `credito_em date`, `observacao`, `origem_raw`.
Sem chave natural no payload: unique em
`(empresa_id, pedido_codigo, caixa_codigo, forma, operadora, valor, pago_em)`.

### `pdv_vendas_itens_dia`

Snapshot do `GetProdutosVendidos` com filtro de um dia. `dia date`,
`codigo_produto integer`, `codigo_detalhe integer`, `nome`, `categoria`,
`quantidade`, `valor_vendido`, `preco_venda`, `preco_custo`, `custo_medio`,
`lucro`, `margem`, `participacao_lucro`, `curva_abc char(1)`, `origem_raw`.
Unique `(empresa_id, dia, codigo_detalhe)`.

Por que snapshot por dia e não recalcular dos itens: o Connect já consolida
combos/complementos e custo na regra dele; a tela de item usa o número que o
gestor também vê no painel, sem divergência a explicar.

### `pdv_importacoes`

`id`, `iniciado_em`, `terminado_em`, `empresa_id` (nulo = rodada inteira),
`janela_inicio date`, `janela_fim date`, `status` (`ok` \| `erro` \| `parcial`),
`pedidos`, `caixas`, `recebimentos`, `itens_dia` (contadores), `erro text`,
`detalhes jsonb`.

### Views

`vw_pdv_vendas_dia`: `empresa_id, dia, tipo, origem, qtd_pedidos, qtd_itens,
valor_total, valor_desconto, valor_entrega, valor_servico, ticket_medio` — só
pedidos `finalizado = true` e `excluido_em is null`.

`vw_pdv_caixa_formas_dia`: `empresa_id, dia, forma_grupo, forma, operadora,
qtd, valor_bruto, valor_liquido, taxa` — a partir de `pdv_recebimentos`
(tem taxa); `pdv_caixa_movimentos` fica para a conferência do caixa na tela.

Ambas `security_invoker = true` para respeitar a RLS (mesmo padrão do
`atualizacao_21`).

## Importador

`scripts/importar-pdv-consumer.mjs [--de YYYY-MM-DD] [--ate YYYY-MM-DD] [--loja id]`

Variáveis (`.env.local`): `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`CONSUMER_CONNECT_COOKIE` (string `Cookie:` inteira copiada do navegador —
instruções em `scripts/IMPORTACAO-PDV.md`). Opcional `PDV_JANELA_DIAS` (padrão 3).

Fluxo por loja ativa em `pdv_lojas`:

1. `SetDatabaseFilter` → `SetDateFilter` (janela inteira).
2. Pedidos: pagina `GetListaPedidos` (length 200). Para cada pedido **novo ou
   cujo `Status`/`ValorTotal` mudou** em relação ao banco, busca o detalhe,
   parseia, upsert pai + replace filhos. Pedido sem mudança não gasta request.
3. Caixas: pagina `GetHistoricoCaixa`; detalhe para caixas novos ou com status
   mudado; upsert + replace movimentos.
4. Recebimentos: pagina `GetRecebimentos`; upsert em lote.
5. Itens por dia: para cada dia da janela, `SetDateFilter` do dia e
   `GetProdutosVendidos`; replace das linhas do dia.
6. Grava `pdv_importacoes`. Erro em uma loja não aborta a outra (`parcial`).

Resposta HTTP 302 para `/autenticacao/login` ou HTML com formulário de login =
sessão expirada → erro `SESSAO_EXPIRADA`, sem retry. Demais erros: 3 tentativas
com espera crescente. Pausa de 300 ms entre requests para não pesar no painel.

Cron (mesmo mecanismo do backup, `crontab`): 05:00 todo dia, depois do
fechamento dos caixas (~00:00) e antes do expediente. Script `npm run importar-pdv`.

## Tela `/vendas/importacao`

Cabeçalho: seletor de empresa já vem do `AppShell` (`empresaAtual`), mas só
Steakhouse e Afya têm dados — para outra empresa a tela explica isso. Seletor
de período (padrão: mês corrente). Badge "Última importação: 23/08 05:02 · ok"
vindo de `pdv_importacoes`; vermelho se > 36 h ou último status `erro`.

Blocos, de cima para baixo:

1. **KPIs do período** — faturamento, pedidos, ticket médio, itens/pedido,
   % delivery. Comparação com o período anterior de mesmo tamanho.
2. **Venda por dia** — série (SVG, reusa `SerieMensal`) empilhada mesa ×
   delivery. Tabela abaixo: dia, mesa, delivery, total, pedidos, ticket.
3. **Por origem** — barras (`BarraParticipacao`): Comanda Mobile, Balcão,
   iFood, MenuDino, DeliveryHub…
4. **Caixa por forma de pagamento** — tabela forma × (qtd, bruto, taxa,
   líquido) no período; linha de total. Abaixo, lista dos caixas do período
   (código, abertura, fechamento, saldo inicial, saldo final, status) com
   expansão para ver movimentações.
5. **Itens vendidos** — tabela ordenável (qtd, valor, lucro, margem, ABC),
   filtro por categoria, busca por nome. Curva ABC recalculada no período
   somando os snapshots diários (participação no valor).

Sem edição nesta tela: é leitura. Botão "Importar agora" fica de fora — o
script depende do cookie da máquina, não do servidor.

## Testes

- `tests/pdv-parse.test.mjs`: fixtures em `tests/fixtures/pdv/` (HTML de
  pedido mesa com combo, pedido delivery com entrega e 2 pagamentos, caixa
  fechado com fiado e voucher; JSON de cada lista). Cobre `/Date/`, fuso,
  combos aninhados, pagamento múltiplo, operadora com telefone.
- `tests/pdv-normaliza.test.mjs`: classificação `tipo`, `forma_grupo`, dia de
  venda virando a meia-noite, detecção de "pedido mudou".
- `tests/pdv-vendas.test.mjs`: agregações da tela (KPIs, comparação de
  períodos, ABC no período).
- `tests/migracao-30/`: smoke contra `psql` (tabelas, views, RLS, seed das
  lojas), no padrão de `tests/migracao-29`.
- Importador não tem teste automatizado contra o Connect (depende de sessão);
  tem modo `--dry-run` que imprime contadores sem gravar.

## Ordem de entrega

1. Migração 30 + smoke.
2. `lib/pdvConsumer/parse.js` e `normaliza.js` com testes (fixtures capturadas
   da sessão atual).
3. `connect.js` + script + `IMPORTACAO-PDV.md`; primeira carga manual de
   01/08 a hoje nas duas lojas, conferida contra o painel (totais do dia).
4. Views + `lib/pdvVendas.js` + testes.
5. Tela.
6. Cron e entrada no `ROADMAP.md`.

## Evoluções previstas (fora desta versão)

- Alimentar `vw_consolidado_mensal` (`/grupo`) com receita do PDV para
  Steakhouse e Afya.
- De-para item do PDV × produto do 364 OS para baixa de estoque.
- Clientes do delivery para CRM.
