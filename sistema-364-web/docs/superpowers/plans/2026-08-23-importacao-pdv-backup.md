# Importação PDV via backup Firebird (v2) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alimentar as tabelas `pdv_*` a partir do backup Firebird diário do PDV da Steakhouse no Drive, aposentando o scraping do painel como caminho principal.

**Architecture:** Migração 33 adiciona `origem`/`drive_arquivos` em `pdv_lojas`. Um script baixa o `.fbconsumer` do dia por file id público, restaura num container Firebird 5 (colima/docker), extrai com SQL (`lib/pdvBackup/consultas.js`), normaliza para as mesmas formas do v1 (`lib/pdvBackup/normaliza.js`) e grava com o `bancoSupabase` extraído para módulo compartilhado. Tela, views e semântica idempotente não mudam.

**Tech Stack:** Node ESM sem TypeScript, `node-firebird` (dependência nova), docker via colima (já instalados), Supabase, `node --test`.

**Spec:** `docs/superpowers/specs/2026-08-23-importacao-pdv-backup-design.md` (ler primeiro; decisões e derivações estão lá)

## Global Constraints

- Português em código/comentários/commits/docs. Testes `tests/*.test.mjs` (`node:test` + `node:assert/strict`).
- Migração `supabase/atualizacao_33_pdv_backup.sql`: idempotente, transação única, rollback comentado entre `-- begin;` e `-- commit;`, smoke em `tests/migracao-33/` no padrão de `tests/migracao-32/`. NUNCA rodar em produção sem ok do usuário.
- Fuso: timestamps do Firebird são hora local de Porto Velho sem fuso → instante real = valor + 4 h. Reusar `FUSO_MS`/`diaLocal` de `lib/pdvConsumer/parse.js`.
- As formas produzidas por `lib/pdvBackup/normaliza.js` são EXATAMENTE as consumidas pelo contrato `banco` do v1 (`lib/pdvConsumer/importar.js` documenta): `{pedido, itens, pagamentos}`, `{caixa, movimentos}`, `recebimento`, `item_dia` — mesmos nomes de coluna da migração 32. `classificaTipo`/`classificaForma`/`separaMeio` de `lib/pdvConsumer/normaliza.js` são reusados, não duplicados.
- Container de exploração `fb364` está de pé com o banco restaurado em `/var/lib/firebird/data/consumer.fdb` (user `SYSDBA`, senha `spike364`) — usar para capturar fixtures e validar SQL. Não derrubar.
- IDs do Drive (estáveis, pasta pública `1dQDghshgGXFjMOCwtqLuosWZRT2nGSPc`): domingo `1OpuFkwZd8LHj4qwbR57YmihqMi7YmitW`, segunda-feira `1RDBeg9ELcO8c2Y3_OsbO9_XZ2sb2lSYL`, terça-feira `1XbM9SK2ygMUKvv5UpBMcKwchl3m7WGRM`, quarta-feira `1TlRgSmWgw7iBQ4LSAZYa5WtjMYqtJC_3`, quinta-feira `1eNDPG26a8-nf60SG3bGOvS2zNfj3bq9o`, sexta-feira `1D_tYZb-Us36udA1sryHIcZdU6jyvURmE`, sábado `1faajFRdCrqDgKFDJMLASeFRSIgc58sok`.
- Empresa Steakhouse: `0dda3c8e-228b-4d05-b50a-2e2f301d75a3` (loja Connect `-2147478159`); Afya: `b23fa634-61be-4620-bda7-c92dc01f3d24` (`-2147458165`).

---

### Task 1: Migração 33 — origem e arquivos do Drive em `pdv_lojas`

**Files:** Create `supabase/atualizacao_33_pdv_backup.sql`, `tests/migracao-33/{fixture.sql,cenarios.sql,verificar.sh}`

**Interfaces — Produces:** colunas novas em `pdv_lojas`: `origem text not null default 'painel' check (origem in ('painel','backup'))`, `drive_arquivos jsonb` (mapa `{"domingo": "<fileId>", ..., "sábado": "<fileId>"}`). Seed via update: Steakhouse vira `origem='backup'` com o mapa completo dos 7 ids acima; Afya vira `ativo=false` (sem fonte ativa até o backup dela existir), com comentário no SQL explicando.

Steps (padrão da migração 32): fixture com `pdv_lojas` mínima (criar a tabela como na 32 + empresas), migração idempotente, cenários: (1) colunas existem e Steakhouse tem `origem='backup'` e 7 chaves no jsonb; (2) Afya `ativo=false`; (3) check de `origem` recusa valor fora da lista; (4) rodar a migração duas vezes não duplica nem sobrescreve um `drive_arquivos` editado manualmente (o seed usa `where drive_arquivos is null`). Rollback: `alter table drop column` das duas + reativar Afya não é necessário (rollback só das colunas). `verificar.sh` roda migração 32 antes da 33 (a 33 depende de `pdv_lojas`). Commit: `feat(pdv): migração 33 — origem backup/painel e arquivos do Drive por loja`.

---

### Task 2: Fixtures reais + `lib/pdvBackup/consultas.js` + `lib/pdvBackup/normaliza.js`

**Files:** Create `lib/pdvBackup/consultas.js`, `lib/pdvBackup/normaliza.js`, `tests/fixtures/pdv-backup/*.json`, `tests/pdv-backup-normaliza.test.mjs`

**Passo A — capturar fixtures do container `fb364`** (read-only): para cada consulta abaixo, rodar via `docker exec fb364 isql -user SYSDBA -password spike364 /var/lib/firebird/data/consumer.fdb -i <arquivo>` com `set list on`, janela 2026-08-21 a 2026-08-22, e transcrever 2–4 linhas representativas para JSON em `tests/fixtures/pdv-backup/` (`pedidos.json`, `itens.json`, `pagamentos.json`, `caixas.json`, `caixa-operacoes.json`, `itens-dia.json`). Anonimizar nome/telefone de cliente. Incluir no mínimo: 1 pedido mesa finalizado, 1 delivery, 1 com `DATADELETE` preenchido (se houver; senão sintetizar e marcar no README da pasta), 1 item filho (`CODIGOPAI` não nulo), 1 pagamento dinheiro e 1 cartão com operadora, 1 `CAIXAOPERACAO` tipo S.

**Passo B — `consultas.js`**: exporta strings SQL parametrizadas por `?` (de, ate como `timestamp`), uma por extração:
- `SQL_PEDIDOS`: `select p.codigo, p.dataabertura, p.datafechamento, p.datadelete, p.valortotal, p.valortotalitens, p.totaldesconto, p.totalservico, p.totalacrescimo, p.valorentrega, p.nome, p.numeromesa, p.quantidadepessoas, p.subtotalpago, po.descricao as origem_descricao, m.numero as mesa_numero, (select count(*) from delivery d where d.codigopedido = p.codigo) as tem_delivery from pedidos p left join pedidoorigem po on po.codigo = p.codigopedidoorigem left join pedidomesas m on m.codigopedido = p.codigo where p.dataabertura >= ? and p.dataabertura < ?`
- `SQL_ITENS` (por janela de pedidos, com `i.datadelete is null`): codigo, codigopedido, codigopai, nomeproduto, detalhes, quantidade, valorunitario, valortotal, precocusto.
- `SQL_PAGAMENTOS`: de `vwpagamentos` join período por `datapagamento`, com descricao (forma), nomeoperadoracartao (operadora), codigocaixa, codigopedido.
- `SQL_CAIXAS`: `caixa` por `dataabertura` na janela (+ colunas saldo).
- `SQL_CAIXA_OPERACOES`: `caixaoperacao` dos caixas da janela (tipo, valorentrada, valorsaida, observacao, dataoperacao, codigoformapagamento → join `formaspagamento.descricao`).
- `SQL_ITENS_DIA`: agregado por dia local × produto a partir de `itenspedido` join `pedidos` (soma quantidade, valortotal, custo = precocusto*quantidade) — pode agregar em JS na normalização se o SQL ficar ilegível; decidir e documentar.
Validar cada SQL no container antes de fixar (rodar e conferir contra o painel: total de 21/08 = R$ 7.902,13 de caixa etc.).

**Passo C — `normaliza.js`** (funções puras, TDD com as fixtures): `normalizaPedidoFb({linhaPedido, itens, pagamentos, empresaId})` → mesma forma do v1 (`origem_raw` = linha crua; `origem_html` null; tipo por `mesa_numero`/`tem_delivery`; finalizado por datafechamento sem datadelete; datas +4h). `normalizaCaixaFb`, `normalizaRecebimentoFb` (valor_liquido = valor, percentual_taxa null), `itensDiaFb(linhas)` (agrega por dia×produto se vier cru). Charset: strings já chegam decodificadas pelo driver; garantir teste com acentos (ex.: "Cartão de Crédito"). Commit: `feat(pdv): consultas e normalização do backup Firebird`.

---

### Task 3: `lib/pdvConsumer/banco.js` compartilhado

**Files:** Create `lib/pdvConsumer/banco.js`; Modify `scripts/importar-pdv-consumer.mjs`

Extrair `bancoSupabase(sb)` e `bancoSeco()` do script v1 para o módulo (mesmos 6 métodos + `substituirRecebimentos`), o script v1 passa a importá-los. `node --check` no script, `npm test` verde (os testes do importador usam fakes, nada muda). Commit: `refactor(pdv): banco Supabase compartilhado entre importadores`.

---

### Task 4: `scripts/importar-pdv-backup.mjs` + `lib/pdvBackup/drive.js` + docs

**Files:** Create `scripts/importar-pdv-backup.mjs`, `lib/pdvBackup/drive.js`, `tests/pdv-backup-drive.test.mjs`; Modify `scripts/IMPORTACAO-PDV.md`, `package.json` (script `importar-pdv-backup`)

`drive.js` (puro/testável): `urlDownload(fileId)`; `dataDoCabecalhoGbak(buffer)` — extrai a data tipo `Sun Aug 23 09:20:09 2026` dos primeiros 4 KB (regex sobre latin1) e devolve `Date` (hora local +4h) — testar com os primeiros bytes reais (capturar 4 KB do arquivo já baixado no scratchpad como fixture binária base64 em `tests/fixtures/pdv-backup/gbak-header.json`); `arquivoDoDia(driveArquivos, agora)` — dia da semana local (`domingo`…`sábado`, minúsculo, com acento igual ao seed) e o de ontem como fallback.

Script (fluxo, com `--dry-run`, `--de`, `--ate`, `--loja`, validação de datas como no v1):
1. Env: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (carregador do v1); sem cookie.
2. Lojas `origem='backup'` ativas; para cada uma: baixa o arquivo do dia (curl → diretório temporário via `fs.mkdtemp`), confere `dataDoCabecalhoGbak` (< 48 h, senão tenta ontem; senão erro claro).
3. Garante colima (`colima status` → `colima start`) e docker; sobe container efêmero `firebirdsql/firebird:5` com nome único, `docker cp`, `gbak -c`, espera ficar pronto.
4. Conecta com `node-firebird` (localhost:3050, charset `ISO8859_1`... o driver usa `encoding`; conferir opção correta na prática), roda as consultas da janela, normaliza, grava com `bancoSupabase` (mesma ordem do v1: pedidos → caixas → recebimentos → itens/dia), loga em `pdv_importacoes` (mesmas colunas; `detalhes.fonte = 'backup'`).
5. Teardown sempre (`docker rm -f`, `rm -rf` do temp) via `finally`.
`npm install node-firebird`; testes do drive.js puros; o fluxo docker/firebird não tem teste automatizado — validado na Task 5 ao vivo. Docs: `IMPORTACAO-PDV.md` reescrito (backup principal com cron 14:00, painel plano B com cookie). Commit: `feat(pdv): importador v2 lê o backup Firebird do Drive`.

---

### Task 5: Validação ao vivo, carga histórica, cron (gates do usuário)

1. `npm run importar-pdv-backup -- --dry-run --de 2026-08-21 --ate 2026-08-22` — contadores devem bater com o painel (284 pedidos na semana 17–23/08; caixa 1561 saldo 7.902,13).
2. Com ok do usuário: aplicar migração 33 em produção; rodada real D-3; conferir `vw_pdv_vendas_dia` e `vw_pdv_caixa_formas_dia` contra o painel; abrir a tela.
3. Carga histórica `--de 2022-03-14` (rodada única, pode levar minutos — em background).
4. Cron: `0 14 * * *` com `npm run importar-pdv-backup`, log em `~/Library/Logs/364-importar-pdv.log`. Remover qualquer cron do v1 se existir.
5. ROADMAP + memória (`importacao-pdv-consumer-status`) atualizados; `tests/migracao-33` no verify.

## Self-review

Cobertura do spec: origem/config por loja (T1); extração+normalização com fixtures reais e reuso dos classificadores (T2); gravação compartilhada (T3); download por id com validação de data do cabeçalho, container efêmero, teardown (T4); validação, histórico e cron com gates (T5). Tipos: formas do v1 verificadas coluna a coluna no spec; `arquivoDoDia` usa as mesmas chaves do seed. Sem placeholders — as consultas de T2 têm as colunas exatas; onde há escolha (agregação SQL vs JS; opção de charset do driver) a task manda decidir e documentar contra o banco real, que está disponível no container.
