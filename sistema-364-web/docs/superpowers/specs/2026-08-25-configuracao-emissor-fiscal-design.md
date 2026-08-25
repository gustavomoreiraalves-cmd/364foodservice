# Configuração do Emissor Fiscal (NF-e / NFC-e)

Data: 2026-08-25
Status: aprovado para plano de implementação

## Contexto

O motor de emissão de NF-e/NFC-e (spec futura) precisa de dados que hoje não
têm tela nenhuma: ambiente (produção/homologação), série e numeração atual
por marca, e o CSC/token exigido pra assinar o QR Code da NFC-e. Isso é o
primeiro dos quatro specs derivados de
[2026-08-25-processo-pedido-romaneio-emissao-nfe-design.md](2026-08-25-processo-pedido-romaneio-emissao-nfe-design.md),
pré-requisito dos outros três (motor de emissão, romaneio, contas a
receber).

A referência de campos foi o assistente de homologação do Consumer (POS
usado hoje pela 364 Steakhouse), indicado pelo usuário. Boa parte do schema
de emissor já existe: `empregadores` (migração 31) tem regime tributário,
código do município IBGE, dados de contador; `certificados_digitais`
(migração 31) já guarda o A1 cifrado. Falta o que é específico de
NF-e/NFC-e: habilitar/ambiente/série/número por marca e o CSC da NFC-e.

`/empresas` (`app/empresas/page.js`) já faz o CRUD de `empregadores` e o
upload do certificado A1 via `CertificadoA1`
(`app/api/empresas/[id]/certificado/route.js`) — este spec segue os mesmos
padrões (`useCadastro`, `autorizarModulo`, cifra AES-256-GCM com
`CERTIFICADO_CHAVE`).

## Decisão: por marca, não por CNPJ

Um CNPJ (`empregadores`) pode emitir para mais de uma marca (`empresas`) —
em produção, o CNPJ 364 Steakhouse Comercio de Alimentos emite para as
marcas 364 Steakhouse e 364 Food Service. A série é por **marca**, não por
CNPJ: cada marca tem sua própria série dentro do mesmo CNPJ (ex: série 1 =
364 Steakhouse, série 2 = 364 Food Service). Isso evita colisão de
numeração e deixa a série identificar de qual marca a nota veio, sem
depender do conceito de "estação" que o Consumer usa (não existe estação/
terminal físico neste sistema — é uma aplicação web multiempresa).

## Fora de escopo

Específico do componente desktop RAL Tecnologia (TS) que o Consumer usa
para emitir — sem equivalente numa aplicação web, que fala HTTPS/mTLS
direto com a SEFAZ (mesmo padrão já usado no cliente `distribuicaoDFe` do
spec de recebimento):

- Impressora de emissão local, modelo de papel, margens, quantidade de
  cópias, timeout HTTP, recursos HTTP (wininet/sbb).
- Pasta de XML local e compartilhamento de pasta — os XMLs de saída ficam
  no bucket privado do Supabase, caminho fixo definido pelo motor de
  emissão, sem campo editável pelo usuário.
- Aba Gorjeta — não aplicável ao fluxo B2B de venda de insumos.
- Credenciadora de cartão — o fluxo B2B recebe por boleto/pix/prazo via
  Contas a Receber, não maquininha na hora da venda.
- Implementação do motor de emissão em si (assinatura XML, protocolo
  SEFAZ, eventos, contingência) — spec própria futura, este documento só
  guarda a configuração que o motor vai consumir.

## Schema

### `empresas_emissao_fiscal` (nova tabela)

| coluna | tipo | nota |
| --- | --- | --- |
| `id` | uuid pk | |
| `empresa_id` | uuid not null references `empresas(id)` on delete cascade | a marca |
| `modelo` | text not null check `('55', '65')` | `55` = NF-e, `65` = NFC-e; uma linha por modelo |
| `habilitado` | boolean not null default false | |
| `ambiente` | text not null default `'homologacao'` check `('producao', 'homologacao')` | |
| `serie` | int not null | |
| `numero_atual` | int not null default 0 | próximo número = `numero_atual + 1`; a tela só declara o ponto de partida, quem incrementa depois é o motor de emissão a cada nota autorizada |
| `csc_id` | text | só modelo `65` |
| `csc_token_cifrado` | text | só modelo `65`; formato `"iv:tag:cipher"` base64, AES-256-GCM com `CERTIFICADO_CHAVE` — mesma cifra e mesma env var já usadas para o certificado A1 |
| `created_at` | timestamptz not null default now() | |
| `updated_at` | timestamptz not null default now() | trigger `fn_set_updated_at()`, já existe desde a migração 17 |

`unique (empresa_id, modelo)`.

RLS: sem policy de select para `authenticated`, mesmo padrão de
`certificados_digitais` — o CSC token é credencial (assina o QR Code da
NFC-e), não é exposto ao client. Toda leitura/escrita passa pela API com
service role.

Validação de série duplicada entre marcas do mesmo CNPJ (duas marcas do
mesmo `empregador_id` usando a mesma série+modelo) é feita na API, via
join até `empregador_id` — não dá para expressar como constraint de banco
sem uma coluna redundante, e a regra só importa no momento de salvar.

### `empresas` (alteração)

Nova coluna `informacoes_complementares_fiscais text` — texto padrão
impresso na NF-e/NFC-e (ex: regime Simples Nacional, mensagem de
agradecimento), compartilhado entre os dois modelos, como no Consumer.

## API

`app/api/empresas/[id]/emissao-fiscal/route.js` — `[id]` é o `empresa_id`
(marca), não o `empregador_id`. Segue o padrão de
`app/api/empresas/[id]/certificado/route.js`, mas gate por
`autorizarModulo(request, 'fiscal')` em vez de `'admin'`.

- `GET`: devolve as duas linhas (modelo 55 e 65, se existirem) mais
  `informacoes_complementares_fiscais` da empresa. CSC token nunca volta
  cru — só um booleano `csc_configurado` (mesmo espírito do certificado,
  que devolve metadados e nunca o `.pfx`).
- `PUT`: recebe as duas configurações (habilitado/ambiente/série/número
  por modelo, csc_id/csc_token quando modelo 65) e o texto de informações
  complementares. Antes de gravar, valida:
  - série não duplicada entre marcas do mesmo `empregador_id` (join
    `empresas.empregador_id`);
  - `numero_atual` não pode ser reduzido por edição (só o motor de
    emissão diminui... na verdade nunca diminui — bloqueia edição que
    tente baixar o número, para não emitir número já usado);
  - CSC token só é recifrado se um valor novo foi enviado — campo vazio
    no PUT mantém o token cifrado atual (mesmo comportamento do
    certificado, que não é reenviado a cada save de outro campo).

## Interface

Página nova `app/fiscal/emissor/page.js` (`AppShell modulo="fiscal"`), ao
lado de `/fiscal/tributacao`. Lista as marcas (`empresas`) com edição
inline reaproveitando `useCadastro` e o padrão `campo()` já usado em
`/empresas`:

- Por marca, duas seções — **NF-e** e **NFC-e** — cada uma com: habilitar
  (toggle), ambiente (produção/homologação), série, número atual.
- Bloco CSC (CSC ID + CSC Token) só aparece na seção NFC-e, com o mesmo
  padrão de mascaramento do certificado A1 (mostra que está configurado,
  nunca o valor).
- Campo único de informações complementares por marca, abaixo das duas
  seções.
- Aviso visível se a marca não tem `empregador_id` vinculado (sem CNPJ,
  sem como emitir) — reaproveita o aviso que `/empresas` já mostra para
  marca sem pessoa jurídica.

## Testes

Seguindo `node --test tests/*.test.mjs`, sobre função pura de validação:

- série duplicada entre duas marcas do mesmo `empregador_id` é rejeitada;
  série igual em marcas de `empregador_id` diferentes é aceita.
- tentativa de reduzir `numero_atual` é rejeitada; aumentar é aceito.
- CSC token vazio no PUT preserva o cifrado existente; token novo
  recifra.

Chamada real à API de cifra/decifra segue o padrão já testado no spec de
recebimento — sem mock de rede, sem SEFAZ envolvida (esta tela não fala
com a SEFAZ, só guarda configuração).

## Migração

Próximo número sequencial livre no momento da implementação (a mais
recente aplicada até este documento é `atualizacao_38_cliente_nome_fantasia.sql`) —
cria `empresas_emissao_fiscal` com RLS, adiciona
`informacoes_complementares_fiscais` a `empresas`, sem backfill (tabela
nova, sem dado anterior a migrar).

## Decisões registradas

| decisão | escolha |
| --- | --- |
| Local da tela | Página nova em `/fiscal/emissor` |
| Granularidade da série | Por marca (`empresa_id`), não por CNPJ nem por "estação" |
| Credenciadora de cartão | Fora de escopo — B2B recebe por Contas a Receber |
| Aba Gorjeta / impressora / pasta local | Fora de escopo — específico do componente desktop do Consumer |
| Guarda do CSC token | Cifrado como o certificado, mesma env var, nunca exposto ao client |
| Quem incrementa `numero_atual` | O motor de emissão, a cada nota autorizada — a tela só declara o ponto de partida e bloqueia redução |
