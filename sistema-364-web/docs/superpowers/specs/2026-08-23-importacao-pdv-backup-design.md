# Importação de vendas do PDV Consumer via backup Firebird — design (v2)

Data: 2026-08-23
Status: aprovado para planejamento
Substitui a fonte de dados do spec `2026-08-23-importacao-vendas-consumer-design.md`; as tabelas `pdv_*`, as views e a tela `/vendas/importacao` continuam as mesmas.

## Problema

O importador v1 raspa o painel Consumer Connect. Na prática o painel limita
requisições (HTTP 429) e o detalhe pedido a pedido tornou a rodada inviável
(uma loja/dia levava dezenas de minutos). O usuário interrompeu as execuções.

## Descoberta

O PDV da Steakhouse sobe **backup Firebird (gbak)** diário para o Drive da
conta steakhouse364, pasta "Backup Consumer" (id `1dQDghshgGXFjMOCwtqLuosWZRT2nGSPc`),
um arquivo por dia da semana (`domingo.fbconsumer` … `sábado.fbconsumer`,
~365 MB), sobrescrito no mesmo file id — os ids são estáveis. Restaurado com
`gbak` (Firebird 5 em container via colima/docker, já instalados no Mac), o
banco tem 75 mil pedidos desde 2022 e tudo que a tela precisa:

| Dado | Fonte no CONSUMER.FDB |
|---|---|
| Pedidos (datas, valores, desconto, serviço, entrega, cliente, mesa) | `PEDIDOS` (+`PEDIDOMESAS`, `DELIVERY`, `PEDIDOORIGEM`) |
| Itens com pai/combo, observação e custo | `ITENSPEDIDO` (CODIGOPAI, DETALHES, PRECOCUSTO, DATADELETE) |
| Pagamentos (forma, operadora, caixa, data) | `VWPAGAMENTOS` + `FORMASPAGAMENTO`/`OPERADORACARTAO` |
| Caixas (saldos, abertura/fechamento) | `CAIXA` (conferido: caixa 1561 = R$ 7.902,13, igual ao painel) |
| Sangria/suprimento/estorno com observação | `CAIXAOPERACAO` (TIPO E/S, OBSERVACAO) |

A Afya tem o mesmo backup mas ainda não sobe para o Drive (limitação de rede
na loja); quando subir, entra com configuração, sem código novo.

## Decisões

| Assunto | Decisão |
|---|---|
| Fonte por loja | `pdv_lojas.origem`: `'backup'` (Steakhouse) ou `'painel'` (Afya, desativada por ora — scraping fica como plano B documentado, sem cron). |
| Config do Drive | `pdv_lojas.drive_arquivos jsonb`: mapa dia-da-semana → file id do Drive (ids estáveis; sem listagem de pasta, que exigiria credencial). Download anônimo via `https://drive.usercontent.google.com/download?id=…&export=download&confirm=t` (pasta compartilhada por link). |
| Qual arquivo baixar | O do dia da semana **de hoje** em America/Porto_Velho; se o cabeçalho gbak (que embute caminho e data/hora do backup nos primeiros bytes) não for de hoje, tenta o de ontem; se nenhum for recente (< 48 h), a rodada falha com aviso claro. |
| Restauração | Container efêmero `firebirdsql/firebird:5` (colima): `docker cp` do arquivo + `gbak -c` + consultas; container removido no fim. `colima start` automático se parado. |
| Leitura | `node-firebird` (dependência nova, JS puro) conectando no container (porta 3050), charset `ISO8859_1` convertido para UTF-8 na normalização. |
| Destino | As mesmas tabelas `pdv_*` e a mesma semântica idempotente do v1: upsert de pedidos/caixas por `(empresa_id, codigo)` com replace dos filhos; recebimentos e itens/dia por replace de janela `dia_pagamento`/`dia`. |
| Janela | Padrão D-3 até hoje (`PDV_JANELA_DIAS`); `--de 2022-03-14` para a carga histórica completa. |
| Fuso | Timestamps do Firebird são hora local sem fuso: instante real = valor + 4 h (mesma regra do v1, helpers de `lib/pdvConsumer/parse.js`). |
| Campos sem equivalente | `valor_liquido`/`percentual_taxa` (vinham do Connect): gravar `valor_liquido = valor` e taxa nula na v2; se as tabelas de credenciadora tiverem percentual confiável, fica para evolução. `curva_abc`/`margem` de `pdv_vendas_itens_dia`: recalculados a partir de `ITENSPEDIDO` (a tela já recalcula ABC no período; snapshot diário agregado por produto com custo de `PRECOCUSTO`). |
| Derivações | `tipo`: `mesa` se tem linha em `PEDIDOMESAS` (ou `NUMEROMESA > 0`), `delivery` se tem linha em `DELIVERY`, senão `outro`. `origem`: `PEDIDOORIGEM.DESCRICAO`. `finalizado`: `DATAFECHAMENTO` não nulo e `DATADELETE` nulo. `excluido_em`: `DATADELETE`. Movimentos do caixa: abertura (saldo inicial) + pagamentos do caixa (entradas, origem "Pedido N") + `CAIXAOPERACAO` (E=entrada, S=saída). |
| Cron | 14:00 (o upload do dia chega ~13h30); o de 05:00 do v1 não é agendado. |
| Storage | Download em diretório temporário, apagado após a rodada (365 MB/dia não ficam acumulando). |

## Arquitetura

```
supabase/atualizacao_33_pdv_backup.sql   (colunas origem/drive_arquivos em pdv_lojas + seed)
tests/migracao-33/                        (smoke, padrão migracao-32)
lib/pdvBackup/
  ├── drive.js        (url de download por file id; identificação da data no cabeçalho gbak)
  ├── consultas.js    (SQL Firebird das seis extrações, janela por parâmetro)
  └── normaliza.js    (linhas Firebird → mesmas formas do v1: {pedido, itens, pagamentos}, {caixa, movimentos}, recebimentos, itens_dia)
lib/pdvConsumer/banco.js                  (bancoSupabase extraído do script v1, compartilhado)
scripts/importar-pdv-backup.mjs           (orquestra: download → colima/docker → gbak → consultas → gravação → log pdv_importacoes)
scripts/IMPORTACAO-PDV.md                 (reescrito: backup como caminho principal, painel como plano B)
tests/pdv-backup-*.test.mjs               (fixtures JSON reais capturadas do banco restaurado)
```

## Riscos assumidos

- Upload do dia atrasado/ausente → rodada avisa e o replace de janela corrige no dia seguinte.
- Link da pasta deixar de ser público → plano B: montar a conta steakhouse364 no Drive do Mac e ler o arquivo local.
- Estrutura do CONSUMER.FDB pode mudar em atualização do PDV → consultas centralizadas em `consultas.js`, payload bruto guardado em `origem_raw` como no v1.
