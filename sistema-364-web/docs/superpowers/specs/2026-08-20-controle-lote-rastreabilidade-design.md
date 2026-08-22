# Controle de lote e rastreabilidade dos defumados — design

**Data:** 2026-08-20
**Status:** aprovado; DDL de produção verificado; aguardando plano de implementação
**Empresa piloto:** 364 Food Services

O design cobre a funcionalidade inteira, mas o plano de implementação é **um por fase** — ver
"Entrega em fases" no fim do documento.

## Problema

Hoje o lote nasce no recebimento (`recebimento_itens.lote`, padrão `LT-AAMMDD-###`) e morre ali.
As etapas seguintes não o carregam:

- `producao_consumo` guarda apenas `materia_prima_id`, sem ligação com o item de recebimento
  que foi consumido;
- `pedido_itens` não registra lote nenhum;
- as fichas de defumação, embalagem e expedição são preenchidas em papel e digitadas depois,
  quando são digitadas.

O resultado é que não existe resposta para as duas perguntas que justificam rastreabilidade:
dado um lote com problema, quais clientes o receberam; e dada uma caixa na mão do cliente,
de qual nota fiscal de fornecedor ela veio.

Uma impressora Postek EM210 foi adquirida, com etiquetas BOPP resistentes a umidade e câmara
fria. O objetivo é identificar a matéria-prima já no recebimento com um lote que acompanhe
todo o processo até a embalagem final e a entrega ao cliente, substituindo as fichas de papel
por formulários no sistema.

## Escopo

Dentro:

- lote único do recebimento até a expedição;
- fichas digitais de recebimento (já existe), defumação, embalagem e expedição;
- três modelos de etiqueta impressos pelo sistema;
- página pública de rastreio e tela interna de rastro do lote;
- relatórios de rendimento, perdas e recall.

Fora:

- emissão de NF-e (continua no emissor externo; o sistema só registra o número);
- arte do rótulo/cinta do produto (vem pronta da gráfica);
- assinaturas e preços por cliente (backlog separado).

## Decisão central: o lote é o item de recebimento

Uma nota fiscal recebida gera um lote por matéria-prima, e todo o quilo daquele lote vira um
único lote de produto acabado. Não há mistura de lotes numa mesma produção nem renumeração
em nenhuma etapa.

Logo, não existe entidade "lote" nova. O lote **é** a linha de `recebimento_itens`, e todas as
etapas apontam para ela:

```
recebimento_itens (LT-260820-001)        o lote nasce aqui, nunca é renumerado
  └── defumacao_itens.recebimento_item_id      peso bruto → peso defumado
        └── embalagem_itens.recebimento_item_id      vira N produtos acabados
              └── expedicao_itens.recebimento_item_id      sai em caixas, num romaneio
```

Um lote de costela vira Costela Defumada, Costela Desfiada e Costelinha BBQ — todos com o
mesmo `LT-`. O rastro para frente (lote → clientes) e para trás (caixa → NF do fornecedor)
sai de uma consulta só.

A alternativa avaliada e descartada foi uma tabela genérica de eventos
(`lote_eventos` com `tipo` + `payload jsonb`): ganha flexibilidade para etapas futuras, mas
perde as constraints do banco (rendimento, pesos e quantidades viram texto solto), torna o
saldo por lote uma agregação cara sobre jsonb e joga fora quatro tabelas que já existem e já
têm RLS multiempresa. O processo é estável; essa flexibilidade não se paga.

## Estado real do banco de produção

O schema de produção divergiu do repositório. O DDL foi lido em 2026-08-20 pelo spec OpenAPI
do PostgREST, e o resultado muda o tamanho da migração. Registrado aqui porque `schema.sql` e
as migrações versionadas **não** descrevem o que está no ar.

**As tabelas de produção avançada já têm quase tudo.** A ficha de defumação em papel foi
modelada no banco quase campo a campo:

```
defumacoes        id, lote, data, hora_inicio, hora_fim, temperatura_c,
                  responsavel_id, obs, empresa_id, created_at
defumacao_itens   id, defumacao_id, materia_prima_id, peso_bruto_kg,
                  perda_limpeza_kg, sobra_kg, peso_final_kg, empresa_id
embalagens        id, lote, data, responsavel_id, sobra_kg, obs,
                  empresa_id, created_at
embalagem_itens   id, embalagem_id, produto_id, quantidade,
                  peso_total_kg, empresa_id
```

Os quatro campos de rendimento e os três de processo (hora início, hora fim, temperatura) já
existem. A migração fica bem menor do que o previsto.

**Existe um livro-razão de estoque por lote que não está no repositório:**

```
stock_movements   empresa_id, unidade_id, deposito_id, materia_prima_id,
                  lote, tipo, quantidade, custo_unitario,
                  recebimento_item_id, motivo, responsavel_id
stock_balances    empresa_id, unidade_id, deposito_id, materia_prima_id,
                  lote, quantidade, custo_unitario
```

`stock_movements` **já tem `lote` e `recebimento_item_id`**, e `stock_balances` já é chaveado
por lote. Metade da rastreabilidade de matéria-prima já está construída — só não tem tela nem
continuidade nas etapas seguintes. Cobre apenas matéria-prima; produto acabado não tem
equivalente.

**`recebimento_itens` mudou.** Em produção tem `deposito_id` e `observacoes`, e **não** tem
`status_recebimento`, `condicao_embalagem`, `foto_produto_url` nem `aprovado_por_id` — esses
campos migraram para a tabela `inspecoes_qualidade` (`recebimento_item_id`, `status`,
`temperatura_c`, `motivo_rejeicao`, `documento_sanitario_url`, `foto_url`, …). A tela
`/recebimentos` já lê de lá; o repositório é que ficou para trás.

**A atualização 17 não foi aplicada.** `producoes_internas`, `produto_regras_validade`,
`etiqueta_impressoes` e `producao_descartes` estão ausentes, embora a 18 (biometria) e a 19
(escalas) tenham rodado — aplicaram fora de ordem. `audit_logs` existe, criada por fora.

**Volume de dados** (2026-08-20): 7 recebimento_itens, 1 defumação com 2 itens, 0 embalagens,
1 produção, 2 pedidos, 6 movimentos de estoque, 10 produtos. O backfill é trivial.

## Modelo de dados

### Alterações em tabelas existentes

| Tabela | Alteração |
| --- | --- |
| `recebimento_itens` | `+ volumes int` — quantas caixas chegaram; define quantas etiquetas imprimir |
| `defumacoes` | `+ status` — o resto dos campos da ficha já existe |
| `defumacao_itens` | `+ recebimento_item_id` — o lote de origem. Os quatro campos de rendimento já existem |
| `embalagens` | `+ status` — `sobra_kg` já existe |
| `embalagem_itens` | `+ recebimento_item_id` (lote de origem), `+ validade date` |
| `produtos` | `+ conservacao_texto` — o dizer de conservação impresso, cadastrado por produto |
| `empresas` | `+ sim_numero`, `+ sim_municipio` — registro no Serviço de Inspeção Municipal |
| `etiqueta_impressoes` | ampliar o `check` de `source_type` para aceitar `recebimento_item`, `embalagem_item` e `expedicao_caixa` |

`defumacoes.lote` e `embalagens.lote` já existem como `text not null`, no cabeçalho. Como uma
ficha pode conter vários lotes de rastreabilidade (um por item), esses campos passam a ser o
**número da ficha** — `DEF-AAMMDD-###` e `EMB-AAMMDD-###`, gerados pelo mesmo mecanismo de
`proximoLote`. O lote rastreável fica em `defumacao_itens.recebimento_item_id` e
`embalagem_itens.recebimento_item_id`. Como só existe 1 defumação lançada, o backfill é uma
linha.

`embalagem_itens.validade` é calculada na finalização, a partir de `embalagens.data` e da regra
de conservação do produto, e **gravada**. Congelar o valor evita que mudar a regra do produto
altere retroativamente validades já impressas — mesmo raciocínio do `validade_calculada` de
`producoes_internas`.

`produto_regras_validade` (atualização 17) é reaproveitada sem alteração: cadastra-se
"congelado: 120 dias" no produto e o sistema calcula `data + 120` sozinho.

### Tabelas novas

```
expedicoes
  id, empresa_id, pedido_id, numero (RM-AAMMDD-###), data,
  responsavel_id, nfe_numero, nfe_emitida_em, status, observacoes

expedicao_caixas
  id, empresa_id, expedicao_id, numero (1..N dentro do romaneio), peso_bruto_kg

expedicao_itens
  id, empresa_id, expedicao_caixa_id, produto_id,
  recebimento_item_id, quantidade
```

Todas com `empresa_id not null` e a mesma policy `empresa_scoped_access` usada no resto do
sistema.

### Views novas

- `vw_estoque_produto_lote` — saldo de produto acabado por produto e lote
  (`embalado − expedido`). Alimenta a sugestão FEFO da expedição.
- `vw_lote_rastro` — linha do tempo do lote em uma consulta: recebimento, defumação,
  embalagem, expedições e clientes.
- `vw_rastreio_publico` — subconjunto seguro para a página pública: produto, lote,
  fabricação, validade, conservação e datas das etapas. Sem custo, sem fornecedor, sem
  cliente, sem preço.

Saldo de **matéria-prima** por lote não ganha view nova: já sai de `stock_balances`, que é
chaveado por lote e está em uso. A defumação lê o saldo de lá.

Avaliada e adiada a unificação dos dois mundos — tornar `stock_movements.materia_prima_id`
anulável e acrescentar `produto_id`, com check de que exatamente um está preenchido, faria
matéria-prima e produto acabado compartilharem o mesmo livro-razão. É o desenho mais limpo,
mas mexe numa tabela viva para ganho que este projeto não precisa. Fica como trabalho futuro;
por ora produto acabado sai de view.

### Contagem dupla de estoque

O banco já tem o trigger `trigger_embalagem_para_producao`, que ao inserir em `embalagem_itens`
cria automaticamente a linha correspondente em `producoes` com `origem = 'embalagem'`. Ele nunca
disparou porque a tela de embalagem não existe. Quando ela existir, quem lançar pelos dois
caminhos conta o mesmo produto duas vezes no estoque.

Decisão: para produtos com lote rastreado, a Embalagem passa a ser a única porta de entrada de
estoque de produto acabado. O trigger continua fazendo o trabalho, e `/producoes/completa`
bloqueia o lançamento manual desses produtos com mensagem explicando o caminho correto. Nada é
removido — a Produção Completa continua servindo para o que não passa por defumação.

### Imutabilidade

Cada ficha nasce em `rascunho` (editável à vontade, com salvamento incremental) e passa a
`finalizada` quando o responsável fecha. Depois disso, campo crítico não muda: correção exige
cancelar com motivo e refazer, e o cancelamento vai para `audit_logs`. É o mesmo padrão que
`fn_producao_interna_bloquear_edicao` já implementa em `producoes_internas`.

## Telas

Todas mobile-first: defumação e embalagem são preenchidas de celular, em pé, ao lado do
defumador, possivelmente de luva. Campos grandes, teclado numérico, poucos toques e rascunho
salvo a cada passo para não perder dado se a tela apagar.

### Recebimento — `/recebimentos` (tela existente)

Ganha o campo `volumes` por item e um botão "Imprimir etiquetas", que emite `volumes` cópias
numeradas `vol. 1/20` … `vol. 20/20`. Reimpressão fica disponível na lista com motivo
registrado, no mesmo padrão do `ModalEtiquetas` atual.

### Defumação — `/producoes/defumacao` (aba nova em `ProducaoTabs`)

Cabeçalho: data, hora de início, hora de fim, temperatura, responsável. Itens: escolhe o lote
numa lista que só mostra lotes com saldo de matéria-prima
(`LT-260820-001 · Costela · receb. 20/08 · 180 kg`) e digita peso bruto, perda na limpeza,
sobra aproveitável e peso defumado. O rendimento aparece calculado ao vivo e fica vermelho
abaixo de 40%. Finalizar trava os campos.

### Embalagem — `/producoes/embalagem` (aba nova)

Cabeçalho: data, responsável, sobra de material. Itens: escolhe o lote (só lotes com saldo
defumado), o produto, a quantidade embalada em unidades, o peso final e a data de fabricação.
Ao finalizar, abre direto o modal de impressão das etiquetas de controle interno.

### Expedição — `/expedicao` (módulo novo)

Escolhe um pedido pendente. O sistema lista os itens e sugere o lote de cada um por FEFO
(vence primeiro, sai primeiro), mostrando o saldo disponível. É possível trocar o lote ou
dividir um item entre dois lotes. Depois monta as caixas — cada caixa aceita no máximo 2
produtos distintos e 12 unidades, e a tela mostra "caixa 3 · 12/12" para fechar rápido.
Finalizar imprime o romaneio com os lotes e as etiquetas 101×50, uma por caixa. O número da
NF-e é lançado depois, em campo separado, porque vem do emissor externo.

O romaneio cobre sempre o pedido inteiro: não fecha enquanto sobrar item sem caixa.

### Lotes — `/lotes` (módulo novo)

Busca por lote, produto, cliente ou período, com acesso às fichas de todas as etapas e aos
relatórios. A tela do lote mostra a linha do tempo completa (NF de entrada, fornecedor,
defumação com rendimento, embalagem com os produtos gerados, expedições com cliente e NF-e) e
dois botões: **Onde foi parar** (clientes que receberam o lote, para recall) e **De onde veio**
(da caixa no cliente até a NF do fornecedor).

Relatórios: rendimento por lote e por produto, perdas na limpeza, lotes vencendo e histórico
de recall.

### Rastreio público — `/rastreio/[lote]` (sem login)

Produto, lote, fabricação, validade, conservação e as etapas com datas. Lê de
`vw_rastreio_publico`, nunca das tabelas. Um botão "Ver ficha completa" leva ao `/lotes/…`
interno, que exige login. Lote inexistente devolve 404 genérico, sem revelar se o número
existe.

### Menu e permissões

Entram em `MODULOS` (`lib/auth.js`) dois itens novos: `expedicao` e `lotes`. Quem despacha não
precisa de acesso a custo.

## Etiquetas

Motor: estender `EtiquetaPrint` para ser dirigido por template, com as medidas em
`lib/etiquetas.js`. Impressão por `window.print()` com HTML em milímetro exato, mesmo padrão da
etiqueta de cozinha 60×40 que já funciona — zero instalação, imprime de qualquer máquina ou
celular. A EM210 tem emulação ZPL e um dia pode receber comando direto, mas isso exigiria um
agente local rodando na máquina da fábrica; a estrutura de dados é a mesma nos dois casos, então
trocar depois é reescrever só a camada de renderização.

Auditoria reaproveita `etiqueta_impressoes` e a RPC `registrar_impressao` da atualização 17.
Reimpressão continua exigindo motivo.

QR: dependência nova, pacote `qrcode` (MIT, gera SVG no cliente). SVG imprime nítido em
qualquer DPI e funciona offline, o que importa porque a impressão não pode depender de internet
no meio do galpão. O conteúdo é sempre a URL pública
`364foodservice.vercel.app/rastreio/LT-260820-001`.

### Estoque de etiquetas

| Etiqueta | Material | Medida | Colunas |
| --- | --- | --- | --- |
| Recebimento | BOPP fosca | 50×30 mm | 2 |
| Produção (controle interno) | BOPP fosca | 50×30 mm | 2 |
| Despacho | Couché | 101×50 mm | 1 |

**Duas colunas mudam a paginação.** Com rolo de duas colunas a impressora enxerga uma página
que atravessa o rolo inteiro, com duas etiquetas lado a lado. O template emite pares, não
unidades. Rolo de 108 mm, vão de 2,5 mm entre colunas: página de 108×30 mm, duas células de
50 mm, margem de 2,75 mm em cada borda. A sequência preenche esquerda, direita, esquerda,
direita; com contagem ímpar a última página sai com uma etiqueta e um espaço em branco.

A etiqueta de despacho é couché porque vai na caixa de papelão secundária, que não entra na
câmara fria. As duas de BOPP entram, e por isso exigem ribbon de resina (ou mista
resina/cera) — BOPP é sintético e não sensibiliza em térmico direto, e cera pura borra e sai
com a unha na umidade da câmara.

### 1. Recebimento — 50×30 mm, uma por volume

```
LOTE LT-260820-001        ▓▓▓
COSTELA BOVINA            ▓QR▓
Receb. 20/08/2026         ▓▓▓
Forn. Vale Grande
NF 61.379.327    vol. 3/20
```

### 2. Produção (controle interno) — 50×30 mm, uma por unidade embalada

Impressa ao finalizar a ficha de embalagem, na quantidade de produtos acabados informada.
Cinquenta costelas embaladas geram 50 etiquetas, ou seja, 25 páginas.

```
COSTELA DEFUMADA 500g     ▓▓▓
LOTE LT-260820-001        ▓QR▓
Fab. 20/08/2026           ▓▓▓
```

### 3. Despacho — 101×50 mm, uma por caixa

Gerada a partir do romaneio, comporta os dois produtos possíveis da caixa. O selo do Serviço
de Inspeção Municipal é desenhado em SVG, com número e município puxados do cadastro da
empresa (S.I.M. 030, Ji-Paraná). O dizer de conservação vem de `produtos.conservacao_texto`,
garantindo que a etiqueta nunca divirja da cinta do produto — a Costela Desfiada, por exemplo,
carrega "MANTER CONGELADO A -12 °C", igual ao rótulo da gráfica.

```
364 FOOD SERVICES                          ▓▓▓▓
──────────────────────────────────────     ▓ QR▓
0364-001  COSTELA DEFUMADA 500g            ▓▓▓▓
  LOTE LT-260820-001
  FAB 20/08/2026   VAL 18/12/2026    6 un
──────────────────────────────────────
0364-004  CUPIM DEFUMADO 500g
  LOTE LT-260820-003
  FAB 20/08/2026   VAL 18/12/2026    6 un
──────────────────────────────────────
MANTER CONGELADO A -12 °C
(selo S.I.M. 030)   Caixa 3/8   Romaneio RM-260820-002
```

Toda etiqueta tem pré-visualização na tela antes de imprimir, porque o alinhamento depende do
driver configurado em cada máquina: confere-se na primeira e depois é só rodar.

## Regras de negócio

Impostas pelo banco, não apenas pela tela:

1. Lote com `inspecoes_qualidade.status` de rejeição não aparece na lista de defumação. A
   condição sanitária mora em `inspecoes_qualidade`, não mais em `recebimento_itens`.
2. Peso defumado maior que peso bruto é erro.
3. Rendimento abaixo de 40% gera alerta amarelo mas permite salvar — pode ser real, e travar
   faria o operador ajustar o número para passar.
4. A embalagem não consome mais quilo defumado do que o lote rendeu.
5. A expedição não despacha mais unidades do que foram embaladas daquele lote.
6. Caixa: no máximo 2 produtos distintos e 12 unidades.
7. Romaneio só finaliza com o pedido inteiro alocado em caixas.
8. Ficha finalizada é imutável; correção exige cancelamento com motivo, registrado em
   `audit_logs`.
9. Reimpressão de etiqueta exige motivo.
10. A página pública lê de `vw_rastreio_publico` e devolve 404 genérico para lote inexistente.

## Erros e casos de borda

- Impressão cancelada ou falha da impressora nunca desfaz o lançamento: produção e impressão
  são independentes, como já ocorre em `imprimirEtiquetas`.
- Contagem ímpar de etiquetas 50×30 deixa meia página em branco, comportamento esperado.
- Lote sem saldo aparece desabilitado na lista, com o motivo visível, em vez de sumir — some
  sem explicação gera chamado.
- Pedido cancelado depois do romaneio finalizado: o romaneio é cancelado com motivo e o saldo
  dos lotes volta.
- Dois usuários montando o mesmo romaneio: a validação de saldo roda no `insert`, então o
  segundo recebe erro em vez de estourar o estoque.

## Testes

Lógica pura em `lib/`, coberta por `node --test tests/`, seguindo o padrão de
`tests/producao.test.mjs`:

- cálculo de rendimento e classificação do alerta de 40%;
- cálculo de validade a partir da data de fabricação e da regra de conservação;
- ordenação FEFO e divisão de um item entre lotes;
- alocação em caixas respeitando os limites de 2 produtos e 12 unidades;
- paginação de etiquetas em duas colunas, incluindo o caso de contagem ímpar.

Telas ficam com verificação manual, como o restante do projeto.

## Entrega em fases

Cada fase é utilizável sozinha e vai a produção antes da próxima começar.

0. **Aplicar a atualização 17 em produção.** Pré-requisito, não fase — sem ela a Fase 1 não
   compila contra o banco real.
1. **Migração 20 + etiqueta de recebimento** — campo `volumes`, motor de etiqueta de duas
   colunas, QR. Curta de propósito: é o teste real da impressora com o rolo BOPP. Um erro de
   alinhamento aparece aqui, e não depois de quatro semanas de código.
2. **Ficha de defumação** — tela mobile com rendimento ao vivo.
3. **Ficha de embalagem + etiqueta de produção** — inclui o bloqueio da Produção Completa para
   produtos rastreados.
4. **Expedição** — romaneio, caixas, FEFO, etiqueta 101×50 e campo da NF-e.
5. **Módulo Lotes + rastreio público + relatórios** — o "onde foi parar" e o "de onde veio".

## Pré-requisitos

- **Aplicar a atualização 17 em produção — bloqueio duro da Fase 1.** Verificado em 2026-08-20:
  não rodou. O design depende de `produto_regras_validade` (cálculo de validade),
  `etiqueta_impressoes` e da RPC `registrar_impressao` (auditoria de impressão), todas criadas
  por ela. A 18 e a 19 já rodaram, então a aplicação está fora de ordem; a 17 usa
  `create table if not exists` em `audit_logs`, que já existe, então rodar agora é seguro.
- Confirmar com o fornecedor de consumível que o ribbon é de resina.

### Dívida técnica exposta pela investigação

Não é escopo deste projeto, mas apareceu no caminho e vai atrapalhar quem mexer no banco
depois:

- **O repositório não descreve o schema de produção.** `stock_movements`, `stock_balances`,
  `depositos`, `inspecoes_qualidade`, `centros_custo`, `colaboradores` e `audit_logs` existem
  em produção sem migração versionada. Vale uma `atualizacao_00_baseline.sql` que registre o
  estado real, senão a próxima pessoa escreve migração em cima de uma planta errada — foi
  exatamente o que quase aconteceu aqui.
- ~~**`lib/format.js:custoMedioMP` filtra por `r.status_recebimento`**, coluna que não existe
  mais em `recebimento_itens`. O filtro cai no ramo `== null` e deixa tudo passar, incluindo
  lote rejeitado, que assim contamina o custo médio. Deveria ler
  `inspecoes_qualidade.status`.~~ **Corrigido em 2026-08-20:** o status passou a sair de
  `lib/qualidade.js` (`statusInspecao`/`inspecaoAprovada`), e as queries de
  `/producoes/completa` e `/estoque` — que pediam a coluna inexistente e por isso falhavam
  inteiras — agora trazem `inspecoes_qualidade(status)` junto. Coberto por
  `tests/custo-medio.test.mjs`.
- A migração 17 fora de ordem sugere que não há controle de quais migrações foram aplicadas.
  Uma tabela `schema_migrations` simples resolveria.
