# Controle de lote e rastreabilidade dos defumados — design

**Data:** 2026-08-20
**Status:** aprovado, aguardando plano de implementação
**Empresa piloto:** 364 Food Services

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

## Modelo de dados

### Alterações em tabelas existentes

| Tabela | Alteração |
| --- | --- |
| `recebimento_itens` | `+ volumes int` — quantas caixas chegaram; define quantas etiquetas imprimir |
| `defumacoes` | `+ hora_inicio`, `+ hora_fim`, `+ temperatura_c`, `+ status` |
| `defumacao_itens` | `+ recebimento_item_id` (lote de origem) e os quatro campos de rendimento da ficha: peso bruto, perda na limpeza, sobra aproveitável, peso defumado |
| `embalagens` | `+ sobra_material_kg`, `+ status` |
| `embalagem_itens` | `+ recebimento_item_id` (lote de origem), `+ data_fabricacao` |
| `produtos` | `+ conservacao_texto` — o dizer de conservação impresso, cadastrado por produto |
| `empresas` | `+ sim_numero`, `+ sim_municipio` — registro no Serviço de Inspeção Municipal |
| `etiqueta_impressoes` | ampliar o `check` de `source_type` para aceitar `recebimento_item`, `embalagem_item` e `expedicao_caixa` |

`produto_regras_validade` (criada na atualização 17) é reaproveitada sem alteração: cadastra-se
"congelado: 120 dias" no produto e o sistema calcula `data_fabricacao + 120` sozinho.

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

- `vw_estoque_produto_lote` — saldo por produto e lote (`embalado − expedido`). Alimenta a
  sugestão FEFO da expedição.
- `vw_lote_rastro` — linha do tempo do lote em uma consulta: recebimento, defumação,
  embalagem, expedições e clientes.
- `vw_rastreio_publico` — subconjunto seguro para a página pública: produto, lote,
  fabricação, validade, conservação e datas das etapas. Sem custo, sem fornecedor, sem
  cliente, sem preço.

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
`sistema-364.vercel.app/rastreio/LT-260820-001`.

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

1. Lote com `status_recebimento = 'Rejeitado'` não aparece na lista de defumação.
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

1. **Migração 20 + etiqueta de recebimento** — campo `volumes`, motor de etiqueta de duas
   colunas, QR. Curta de propósito: é o teste real da impressora com o rolo BOPP. Um erro de
   alinhamento aparece aqui, e não depois de quatro semanas de código.
2. **Ficha de defumação** — tela mobile com rendimento ao vivo.
3. **Ficha de embalagem + etiqueta de produção** — inclui o bloqueio da Produção Completa para
   produtos rastreados.
4. **Expedição** — romaneio, caixas, FEFO, etiqueta 101×50 e campo da NF-e.
5. **Módulo Lotes + rastreio público + relatórios** — o "onde foi parar" e o "de onde veio".

## Pré-requisitos

- **Ler o DDL real de `defumacoes`, `defumacao_itens`, `embalagens` e `embalagem_itens`.**
  Essas quatro tabelas foram criadas direto no banco e não estão em nenhum arquivo do
  repositório. Sabe-se que `defumacao_itens` tem `materia_prima_id` e `peso_final_kg`, e que
  `embalagem_itens` tem `produto_id` e `quantidade`; o resto é inferência. Antes de escrever a
  migração é preciso consultar o `information_schema` no Supabase. Enquanto isso, a migração
  usa `add column if not exists` de forma defensiva.
- **Confirmar que a atualização 17 já rodou em produção.** Esta migração é a `atualizacao_20` e
  assume 17, 18 e 19 aplicadas.
- Confirmar com o fornecedor de consumível que o ribbon é de resina.
