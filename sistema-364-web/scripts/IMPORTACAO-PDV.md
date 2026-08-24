# Importação das vendas do PDV

O 364 OS lê as vendas do PDV Consumer e grava pedidos, itens, pagamentos,
caixas, recebimentos e o retrato diário de itens vendidos nas tabelas `pdv_*`.
A tela é **Vendas → Vendas PDV (Steakhouse/Afya)**.

Há dois caminhos, escolhidos por loja em `pdv_lojas.origem`:

| origem | Como lê | Situação |
|---|---|---|
| `backup` | Backup Firebird diário que o PDV sobe para o Drive | **Caminho principal** (Steakhouse) |
| `painel` | Scraping do painel Consumer Connect com cookie | Plano B, sem cron (ver o fim deste arquivo) |

---

# Caminho principal — backup Firebird do Drive

## Como funciona

O PDV da Steakhouse gera todo dia um backup `gbak` do `CONSUMER.FDB` e sobe
para a pasta pública "Backup Consumer" do Drive da conta steakhouse364. É um
arquivo por dia da semana (`domingo.fbconsumer` … `sábado.fbconsumer`, ~365 MB),
sempre sobrescrito no MESMO file id — por isso a configuração é um mapa
dia → file id em `pdv_lojas.drive_arquivos` (semeado pela migração 33), e não
uma listagem de pasta (que exigiria credencial do Google).

Cada rodada de `scripts/importar-pdv-backup.mjs`, por loja:

1. Descobre o dia da semana em Porto Velho e baixa o arquivo daquele dia
   (`curl`, direto para um diretório temporário do `mkdtemp`).
2. Lê os primeiros 4 KB e confere a data que o `gbak` grava no cabeçalho
   ("Sun Aug 23 09:20:09 2026", hora local). A data tem que estar a menos de
   48 h de agora **nos dois sentidos** — um arquivo velho é backup que não
   subiu, e um arquivo "do futuro" é relógio errado no PDV; nos dois casos não
   dá para confiar que é o dia certo. Fora da faixa (ou se o download falhar),
   tenta o arquivo de ontem; se nenhum servir, a loja falha com aviso claro.
3. Garante o docker (`colima status` → `colima start` quando parado) e sobe um
   container `firebirdsql/firebird:5` **efêmero**, com nome único, senha
   sorteada e a porta publicada só em `127.0.0.1`.
4. `docker cp` do arquivo + `gbak -c` + consultas com `node-firebird`
   (`lib/pdvBackup/consultas.js`), normalização (`lib/pdvBackup/normaliza.js`)
   e gravação no Supabase na ordem pedidos → caixas → recebimentos → itens/dia.
5. **Sempre** derruba o container (`docker rm -f`) e apaga o diretório
   temporário, mesmo quando a rodada falha.

Cada rodada deixa uma linha em `pdv_importacoes` (a tela mostra como "Última
importação") com `detalhes.fonte = 'backup'`, o dia do arquivo usado e a hora
do backup.

Idempotência: pedidos e caixas por upsert em `(empresa_id, codigo)` — pedido
que não mudou desde a última rodada nem é reescrito; recebimentos e itens/dia
por substituição da janela. Rodar de novo nunca duplica.

## Pré-requisitos

- `colima` + `docker` instalados (`brew install colima docker`). A imagem
  `firebirdsql/firebird:5` é baixada na primeira rodada.
- `.env.local` com `NEXT_PUBLIC_SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`.
  Este caminho **não** usa cookie do painel.
- Migração `supabase/atualizacao_33_pdv_backup.sql` aplicada (colunas `origem`
  e `drive_arquivos` em `pdv_lojas`).

## Rodar

```bash
npm run importar-pdv-backup                                  # janela padrão
npm run importar-pdv-backup -- --de 2026-08-01               # desde 1º de agosto
npm run importar-pdv-backup -- --de 2026-08-01 --ate 2026-08-10
npm run importar-pdv-backup -- --dry-run                     # só conta, não grava
npm run importar-pdv-backup -- --loja -2147478159            # só a Steakhouse
npm run importar-pdv-backup -- --de 2022-03-14               # carga histórica
```

Saída: contadores por loja e `Fim: ok | parcial | erro` (código de saída 2 no
erro). A janela padrão vai de D-3 até hoje, **inclusive as duas pontas** — são
quatro dias corridos (`PDV_JANELA_DIAS` muda o D-3). `--de` e `--ate` são
`YYYY-MM-DD` e também entram inteiros na janela.

Variáveis opcionais: `PDV_FB_PORTA` (padrão 3050, porta local do container),
`PDV_FB_IMAGEM`, `PDV_GBAK_TIMEOUT_S` (padrão 1800),
`PDV_DOWNLOAD_TIMEOUT_S` (padrão 1800).

### Carga histórica

Um comando só, `--de 2022-03-14` (o primeiro pedido da base), sem `--ate`.
Janela de mais de 31 dias é **fatiada em pedaços de um mês automaticamente**: o
backup é restaurado uma vez por loja e cada mês é processado contra o mesmo
container, com log `janela 2022-03-14..2022-03-31 (1/54)`. Isso segura o uso de
memória e, principalmente, limita o estrago de uma falha no meio: os
recebimentos são apagados e regravados por janela, então o pior caso é um mês
para refazer, não quatro anos. Um mês que falha interrompe a loja — recomece
pelo mês do erro com `--de`/`--ate`. A rodada leva bastante tempo; melhor rodar
em uma sessão que possa ficar aberta.

## Agendar (cron, 14:00)

O upload do backup do dia chega por volta das 13h30.

```bash
crontab -e
```

```
0 14 * * * cd "/caminho/do/sistema-364-web" && /usr/local/bin/npm run importar-pdv-backup >> "$HOME/Library/Logs/364-importar-pdv.log" 2>&1
```

Use o caminho que `which npm` devolver. O Mac precisa estar ligado e com rede
às 14:00 (mesma condição do backup das 12:30). Não deve existir cron do
importador do painel (`npm run importar-pdv`).

## Conferir sem baixar nada

`scripts/importar-pdv-backup.mjs` exporta as partes do fluxo para dar para
exercitar cada pedaço isolado, com um Firebird já restaurado:

- `extrairLoja({ db, banco, loja, de, ate, log })` — consultas + normalização +
  gravação. Com `bancoSeco()` (de `lib/pdvConsumer/banco.js`) roda sem tocar no
  Supabase; com um "banco" espião dá para conferir linha a linha.
- `restaurarNoContainer({ nome, porta, senha, arquivo, log })` e
  `derrubarContainer(nome)` — o par sobe/derruba do container efêmero, com um
  arquivo de backup que você já tenha em disco.

Importar o módulo não dispara a rodada: o `main()` só roda quando o script é
chamado direto.

## Conferência dos números

Compare um dia no painel (Dashboard → Valor Total Recebido, com o período
ajustado para o dia) com a soma de `vw_pdv_vendas_dia` daquele dia, e
`vw_pdv_caixa_formas_dia` com Financeiro → Recebimentos.

Um caixa fechado é a melhor conferência isolada: a soma dos movimentos
(`pdv_caixa_movimentos`) tem que dar exatamente o `saldo_final` do caixa —
conferido no 1561 (R$ 7.902,13) e no 1562 (R$ 10.273,94).

## Quando dá errado

| Sintoma | O que é |
|---|---|
| `nenhum backup recente (< 48 h) no Drive` (a mensagem lista o que cada tentativa achou: download falhou, arquivo não é gbak, ou a distância em horas) | O PDV não subiu o arquivo (loja fechada, rede caiu) ou o link da pasta deixou de ser público. A janela é reprocessada na rodada seguinte, então um dia perdido se corrige sozinho. |
| `o arquivo baixado ... não é um backup gbak` | O Drive devolveu HTML: quota de download estourada ou arquivo sem permissão pública. |
| `docker não respondeu (colima start?)` | VM do colima não subiu. Rode `colima start` na mão e veja o erro. |
| `Firebird não abriu a porta 3050 a tempo` | Porta ocupada por outro container Firebird (`docker ps`), ou imagem baixando ainda. `PDV_FB_PORTA` troca a porta. |

Diferenças conhecidas em relação ao painel: `valor_liquido` dos recebimentos
vem igual ao bruto e `percentual_taxa` fica nulo (o backup não traz a taxa da
credenciadora). Atenção: rodar o v2 sobre um período que o v1 já tinha
preenchido **zera a taxa** daquele período — os recebimentos da janela são
apagados e regravados, e o que vier do backup não tem `percentual_taxa`.

---

# Plano B — painel Consumer Connect (scraping)

Continua funcionando para lojas com `pdv_lojas.origem = 'painel'` (hoje só a
Afya, desativada até o backup dela subir para o Drive). É lento e o painel
devolve 429 com facilidade — use só se o backup estiver indisponível.

## Pegar o cookie da sessão

O painel não tem API nem token. O script usa o cookie do seu login:

1. Abra https://connect.consumer.com.br no Chrome e faça login.
2. `⌥⌘I` (DevTools) → aba **Network** → recarregue a página.
3. Clique na primeira requisição (`connect.consumer.com.br`) → **Headers** →
   em *Request Headers* copie o valor inteiro de `Cookie:` (começa com algo
   como `ASP.NET_SessionId=...`).
4. No `.env.local` do projeto: `CONSUMER_CONNECT_COOKIE='cole aqui'` (aspas
   simples).

Quando a sessão do painel expirar o script para com `SESSAO_EXPIRADA`: repita
os passos. Não feche a sessão no navegador ("Sair"), isso invalida o cookie.

## Rodar

```bash
npm run importar-pdv                        # últimos 3 dias
npm run importar-pdv -- --de 2026-08-01
npm run importar-pdv -- --dry-run
npm run importar-pdv -- --loja -2147458165  # só a Afya
```

`PDV_PAUSA_MS` (padrão 600) é o intervalo entre requisições ao painel; abaixo
disso o Connect começa a responder 429.
