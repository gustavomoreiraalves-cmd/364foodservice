# Configuração do Emissor Fiscal (NF-e / NFC-e)

Data: 2026-08-25
Status: aprovado para plano de implementação (revisado após segunda opinião externa)

## Contexto

O motor de emissão de NF-e/NFC-e (spec futura) precisa de dados que hoje não
têm tela nenhuma: ambiente (produção/homologação), série e numeração por
marca, e o CSC/token exigido pra assinar o QR Code da NFC-e. Isso é o
primeiro dos quatro specs derivados de
[2026-08-25-processo-pedido-romaneio-emissao-nfe-design.md](2026-08-25-processo-pedido-romaneio-emissao-nfe-design.md),
pré-requisito dos outros três (motor de emissão, romaneio, contas a
receber).

A referência de campos foi o assistente de homologação do Consumer (POS
usado hoje pela 364 Steakhouse). Boa parte do schema de emissor já existe:
`empregadores` (migração 31) tem regime tributário, código do município
IBGE, inscrição estadual, dados de contador; `certificados_digitais`
(migração 31) já guarda o A1 cifrado. Falta o que é específico de
NF-e/NFC-e: ativo/ambiente/série/numeração por marca e o CSC da NFC-e.

`/empresas` (`app/empresas/page.js`) já faz o CRUD de `empregadores` e o
upload do certificado A1 via `CertificadoA1`
(`app/api/empresas/[id]/certificado/route.js`) — este spec segue os mesmos
padrões (`useCadastro`, `autorizarModulo`).

Esta versão revisa a primeira (mesma data) depois de uma segunda opinião
técnica externa sobre o desenho original. As seções abaixo já incorporam
as correções aceitas; o que foi avaliado e descartado está registrado em
"Pontos avaliados e não incorporados", no fim.

## Princípio: quem emite é o CNPJ, não a marca

**O `empregador` (CNPJ/estabelecimento) é o emissor fiscal. A `empresa`
(marca) é a origem operacional da venda. A série segrega os documentos de
uma marca dentro do estabelecimento emissor. A marca nunca substitui o
estabelecimento fiscal no XML.**

Um CNPJ pode emitir para mais de uma marca — em produção, o CNPJ 364
Steakhouse Comercio de Alimentos emite para as marcas 364 Steakhouse e 364
Food Service. Para o usuário, a experiência continua simples (cada marca
vê sua própria série); no schema, a série é uma propriedade do par
CNPJ+modelo+ambiente, e cada marca ocupa uma série distinta dentro desse
CNPJ — não existe conceito de "estação" aqui (aplicação web multiempresa,
sem terminal físico).

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
  SEFAZ, eventos, contingência) — spec própria futura.
- **Reserva atômica de número** — a função que vai de fato conceder um
  número a uma nota em emissão (`reservar_numero_fiscal`, com
  `UPDATE ... SET ultimo_numero = ultimo_numero + 1 ... RETURNING`) é
  desenhada junto do motor de emissão, porque só faz sentido no contexto
  do fluxo de transmissão (o que acontece se a SEFAZ rejeitar um número já
  reservado, contingência, etc.). Este spec entrega a tabela no formato
  que essa função vai usar, sem implementá-la.

Notas para specs futuros (não implementadas aqui, só registradas para não
se perderem):

- **Versionamento de leiaute** — o Portal Nacional evolui o layout da
  NF-e/NFC-e por Notas Técnicas (ex: NT vigente em 2026 trata da Reforma
  Tributária/IBS-CBS, QR Code v3 do NFC-e). O motor de emissão não deve
  hardcodar um único algoritmo/versão; a resolução de versão de leiaute é
  decisão daquele spec, não desta tela de configuração.
- **Responsável técnico** — algumas UFs exigem dados do responsável
  técnico (CNPJ, contato, CSRT) no XML. Fica fora deste primeiro
  formulário; quando entrar, é campo em `empregadores`, não em
  `empresas_emissao_fiscal`.
- **Motor de tributação modular** (ICMS/PIS/COFINS/IBS/CBS/IS como tipos
  serializáveis por versão de leiaute, não `if` espalhado) — decisão do
  motor de emissão, conversa direto com o cadastro fiscal de produtos já
  existente (migração 36).
- **Botão "testar comunicação com a SEFAZ"** (valida certificado, cadeia,
  endpoint, TLS, sem emitir nota) — boa adição de UX, mas depende do
  cliente SEFAZ que só existe no motor de emissão. Fica no roadmap dessa
  spec futura.
- **Máquina de estados de contingência** do documento fiscal (rascunho →
  número reservado → assinado → enviado → autorizado/rejeitado →
  contingência → cancelado/inutilizado) — pertence ao motor de emissão.

## Schema

### `empresas_emissao_fiscal` (nova tabela — configuração por marca)

| coluna | tipo | nota |
| --- | --- | --- |
| `id` | uuid pk | |
| `empresa_id` | uuid not null references `empresas(id)` on delete cascade | a marca |
| `empregador_id` | uuid not null references `empregadores(id)` | **não vem da API** — populado por trigger a partir de `empresas.empregador_id` (ver abaixo). Existe só para sustentar a constraint de série única por CNPJ. |
| `modelo` | text not null check `('55', '65')` | `55` = NF-e, `65` = NFC-e; uma linha por modelo por ambiente |
| `ambiente` | text not null default `'homologacao'` check `('producao', 'homologacao')` | homologação e produção são linhas separadas — trocar de ambiente não apaga a configuração do outro |
| `ativo` | boolean not null default false | |
| `serie` | int not null check `(serie > 0)` | |
| `csc_id` | text | só modelo `65` |
| `csc_token_cifrado` | text | só modelo `65`; formato `"iv:tag:cipher"` base64, AES-256-GCM — chave própria, ver seção Segurança |
| `csc_key_version` | int not null default 1 | permite rotacionar `CSC_ENCRYPTION_KEY` no futuro sem ambiguidade sobre qual chave decifra qual linha |
| `created_at` | timestamptz not null default now() | |
| `updated_at` | timestamptz not null default now() | trigger `fn_set_updated_at()` |

Constraints:

- `unique (empresa_id, modelo, ambiente)` — uma configuração por marca,
  modelo e ambiente.
- `unique (empregador_id, modelo, ambiente, serie)` — a garantia fiscal de
  verdade: nenhum CNPJ reutiliza série+modelo+ambiente entre marcas. Fica
  no banco, não só na API — duas requisições simultâneas escolhendo a
  mesma série para marcas diferentes do mesmo CNPJ colidem no índice, uma
  delas recebe erro em vez de duplicata silenciosa.

Trigger `before insert or update` preenche `empregador_id` a partir de
`select empregador_id from empresas where id = new.empresa_id` — o valor
nunca é aceito da API. Isso fecha o caso em que a API mandaria um
`empregador_id` desatualizado (marca trocou de CNPJ depois que o form
carregou) e a constraint acima acabaria validando contra um valor errado.

RLS: sem policy de select para `authenticated`, mesmo padrão de
`certificados_digitais` — o CSC token é credencial (assina o QR Code da
NFC-e), não é exposto ao client. Toda leitura/escrita passa pela API com
service role.

### `fiscal_numeracao` (nova tabela — contador, não configuração)

| coluna | tipo | nota |
| --- | --- | --- |
| `id` | uuid pk | |
| `empregador_id` | uuid not null references `empregadores(id)` | chave fiscal real da numeração — não é `empresa_id` |
| `modelo` | text not null check `('55', '65')` | |
| `ambiente` | text not null check `('producao', 'homologacao')` | |
| `serie` | int not null check `(serie > 0)` | |
| `ultimo_numero` | int not null default 0 check `(ultimo_numero >= 0)` | último número fiscal **consumido** nessa série/modelo/ambiente — não "autorizado": cobre também rejeição, inutilização e contingência, que o motor de emissão trata. Próximo a conceder = `ultimo_numero + 1`, decidido pela reserva atômica do motor, não por esta tela. |
| `updated_at` | timestamptz not null default now() | |

`unique (empregador_id, modelo, ambiente, serie)`.

Separado de `empresas_emissao_fiscal` porque é estado transacional do
motor de emissão (vai crescer para reserva/auditoria de salto/reconciliação
com a SEFAZ), não uma preferência de configuração — misturar as duas
coisas numa tabela só forçaria o motor a fazer `UPDATE` concorrente numa
linha que também guarda CSC e toggles de UI, ampliando a superfície de
lock à toa.

Uma linha aqui nasce quando a configuração correspondente em
`empresas_emissao_fiscal` é ativada pela primeira vez, com
`ultimo_numero` igual ao ponto de partida declarado (ver "Ajuste de
numeração" abaixo) — normalmente `0` para série nova, ou o valor que o
contador informar para uma série que já vinha sendo usada em outro
sistema.

### `empresas` (alteração)

Nova coluna `informacoes_complementares_padrao text` — texto **livre do
usuário** impresso na NF-e/NFC-e (ex: "Mercadoria entregue conforme
pedido nº..."), compartilhado entre os dois modelos. Não é onde entram
avisos legais automáticos (ex: menção a regime Simples Nacional) — esses
o motor de emissão gera sozinho a partir do `regime_tributario` já
cadastrado em `empregadores`, sem depender de o usuário digitar certo.

## Segurança

Chave de cifra do CSC é **nova e separada** da `CERTIFICADO_CHAVE` que já
protege o `.pfx`/senha do certificado A1 — variável de ambiente
`CSC_ENCRYPTION_KEY` (mesmo formato: 32 bytes em base64, gerada com
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`).
Isso segue a convenção que o projeto já tem (`CERTIFICADO_CHAVE` já é
separada da chave de biometria do ponto, exatamente pelo mesmo motivo:
vazamento de uma não expõe a outra). **`CERTIFICADO_CHAVE` não é tocada
neste spec** — já está em produção.

Implementação: extrair de `lib/certificadoServer.js` as funções puras de
cifra/decifra (`cifrarCom(chaveBuf, plano)` / `decifrarCom(chaveBuf,
texto)`, mesmo algoritmo AES-256-GCM com IV novo por chamada) e expor
`cifrar`/`decifrar` de `certificadoServer.js` como hoje (chamando
`cifrarCom` com `CERTIFICADO_CHAVE`, sem mudança de comportamento pros
chamadores existentes), mais um `lib/fiscalSecretServer.js` novo com
`cifrarCsc`/`decifrarCsc` chamando `cifrarCom`/`decifrarCom` com
`CSC_ENCRYPTION_KEY`.

## API

`app/api/empresas/[id]/emissao-fiscal/route.js` — `[id]` é o `empresa_id`
(marca). Gate por `autorizarModulo(request, 'fiscal')`.

- `GET`: devolve as linhas de `empresas_emissao_fiscal` da marca (até duas:
  55 e 65) já cruzadas com `fiscal_numeracao` pelo `empregador_id`
  resolvido, mais `informacoes_complementares_padrao`. CSC token nunca
  volta cru — só `csc_configurado: boolean`. Inclui também o checklist de
  "pronto para emitir" (ver Interface).
- `PUT`: recebe ativo/ambiente/série por modelo e csc_id/csc_token quando
  modelo 65, e o texto de informações complementares. Regras:
  - série duplicada no mesmo CNPJ+modelo+ambiente é rejeitada — a
    constraint do banco é quem decide por último, a API só devolve a
    mensagem legível antes de tentar;
  - ativar `ambiente = 'producao'` exige certificado ativo e não vencido
    para o `empregador_id` (join `certificados_digitais`); sem isso, erro
    explicando o quê falta;
  - modelo `55` rejeita `csc_id`/`csc_token` preenchidos (não existe CSC
    em NF-e); modelo `65` ativo exige os dois;
  - CSC token só é recifrado se um valor novo foi enviado — campo vazio
    mantém o token atual;
  - **não mexe em `fiscal_numeracao`** — numeração não se edita por este
    endpoint.
- `POST .../emissao-fiscal/ajustar-numeracao`: ação administrativa
  separada. Corpo: `{ modelo, ambiente, novo_numero, motivo }`, `motivo`
  obrigatório. Regras:
  - só reduz uma vez (cria a linha em `fiscal_numeracao` se não existir,
    com o `novo_numero` como ponto de partida);
  - depois de criada, só aceita `novo_numero > ultimo_numero` atual —
    nunca reduz. Se a numeração real precisar recuar (raríssimo, erro de
    digitação antes de qualquer nota emitida), é correção manual direto
    no banco por quem administra, fora da UI;
  - grava em `audit_logs` via `fn_registrar_auditoria('fiscal_numeracao',
    <id>, 'ajuste', empresa_id, {ultimo_numero: antes}, {ultimo_numero:
    depois}, motivo)` — RPC que já existe (`atualizacao_17`), reaproveitada
    aqui, sem tabela de auditoria nova.

## Interface

Página nova `app/fiscal/emissor/page.js` (`AppShell modulo="fiscal"`), ao
lado de `/fiscal/tributacao`. Lista as marcas (`empresas`) com edição
inline reaproveitando `useCadastro` e o padrão `campo()` já usado em
`/empresas`:

- Por marca, duas seções — **NF-e** e **NFC-e** — cada uma com selo de
  status (🟢 *Pronto para emitir* / 🔴 *Configuração incompleta*, com a
  lista do que falta: CNPJ, IE, regime tributário, município IBGE,
  certificado A1 válido, série, ambiente, e CSC no caso da NFC-e) e os
  campos: ativo, ambiente, série. Número atual aparece **somente
  leitura**, com o link "Ajustar numeração" abrindo modal com
  novo número + motivo, chamando o endpoint administrativo.
- Bloco CSC (rotulado explicitamente "Identificador do CSC (ID Token)" e
  "CSC / Código de Segurança", pra não confundir os dois) só aparece na
  seção NFC-e, mascarado como o certificado A1 (mostra que está
  configurado, nunca o valor).
- Status do certificado A1 do CNPJ da marca, resumido (válido até,
  vencido, ausente) com link "Gerenciar certificado" → `/empresas`. Ativar
  produção fica desabilitado na UI se o certificado não estiver válido
  (mesma checagem que a API já faz).
- Campo único de informações complementares por marca, abaixo das duas
  seções, com a legenda "texto adicional seu — não substitui avisos
  fiscais gerados automaticamente".
- Aviso visível se a marca não tem `empregador_id` vinculado — reaproveita
  o aviso que `/empresas` já mostra para marca sem pessoa jurídica.

## Testes

Seguindo `node --test tests/*.test.mjs`, sobre funções puras de validação
(a validação em si, não a chamada de rede/banco):

- série duplicada no mesmo `empregador_id`+modelo+ambiente é rejeitada;
  mesma série em `empregador_id` diferente é aceita; mesma série em
  ambientes diferentes da mesma marca é aceita (linhas distintas).
- modelo `55` com `csc_id`/`csc_token` preenchido é rejeitado; modelo `65`
  ativo sem CSC é rejeitado.
- ativar ambiente produção sem certificado válido (ausente ou vencido) é
  rejeitado.
- `serie <= 0` rejeitada.
- ajuste de numeração sem `motivo` é rejeitado; `novo_numero` menor ou
  igual ao atual é rejeitado; criação da primeira linha aceita qualquer
  valor `>= 0`.
- CSC token vazio no PUT preserva o cifrado existente; token novo recifra
  com `CSC_ENCRYPTION_KEY` (não com `CERTIFICADO_CHAVE`).
- resposta do `GET` nunca contém `csc_token_cifrado` nem o CSC em claro —
  só `csc_configurado`.

Deliberadamente fora desta suíte: reserva atômica concorrente de número
(`fiscal_numeracao.ultimo_numero` sob `UPDATE` concorrente) — não existe
função de reserva nesta camada; esse teste nasce junto do motor de
emissão, que é quem vai efetivamente reservar número para transmitir.

## Migração

Próximo número sequencial livre no momento da implementação (a mais
recente aplicada até este documento é `atualizacao_38_cliente_nome_fantasia.sql`)
— cria `empresas_emissao_fiscal`, `fiscal_numeracao` (RLS conforme
descrito acima), o trigger que popula `empregador_id`, adiciona
`informacoes_complementares_padrao` a `empresas`. Sem backfill — tabelas
novas, sem dado anterior a migrar.

## Decisões registradas

| decisão | escolha |
| --- | --- |
| Emissor fiscal vs. origem operacional | CNPJ (`empregador`) emite; marca (`empresa`) é a origem da venda; série segrega marca dentro do CNPJ |
| Identidade da configuração | `empresa_id + modelo + ambiente` — homologação e produção nunca se sobrescrevem |
| Unicidade de série | Constraint de banco em `empregador_id + modelo + ambiente + serie`, não só validação de API |
| Origem de `empregador_id` na config | Trigger a partir de `empresas.empregador_id`, nunca aceito da API |
| Numeração | Tabela própria (`fiscal_numeracao`), separada da configuração — é estado transacional, não preferência de tela |
| Reserva atômica de número | Fora deste spec — desenhada junto do motor de emissão |
| Edição de numeração | Somente leitura na tela normal; ajuste via ação administrativa auditada (`fn_registrar_auditoria`/`audit_logs` já existentes), nunca reduz |
| Guarda do CSC | Cifrado com chave própria (`CSC_ENCRYPTION_KEY`), separada de `CERTIFICADO_CHAVE`, versionada (`csc_key_version`) para rotação futura |
| Credenciadora de cartão / Gorjeta / impressora / pasta local | Fora de escopo — específico do componente desktop do Consumer ou do fluxo de PDV, não do B2B |

## Pontos avaliados e não incorporados

Da segunda opinião externa, o que foi considerado e conscientemente
deixado de fora deste spec (não por discordância técnica, mas por escopo:
pertencem ao motor de emissão, que ainda não foi desenhado):

- Implementar a RPC de reserva atômica agora — sem o fluxo de transmissão
  desenhado, a função ficaria adivinhando requisitos (o que fazer em
  rejeição, contingência) que só o spec do motor pode responder.
- Resolver versionamento de QR Code/leiaute nesta tela — é responsabilidade
  do motor de emissão, registrado como nota para aquele spec.
- Validação de formato do `csc_id` contra o manual vigente — fica para a
  implementação conferir contra o Manual de Orientação do Contribuinte
  vigente na data em que o motor for construído, não travado neste
  documento (o formato pode mudar entre a spec e a implementação).
