# Processo: Pedido → Romaneio → Emissão de NF-e → Contas a Receber

Data: 2026-08-25
Status: aprovado, norte para os specs de implementação (config emissor, motor de
emissão, romaneio, contas a receber)

## Contexto

A 364 Food Service vende insumos para outras marcas do grupo e para terceiros
(modelo B2B). Hoje o ciclo do pedido termina em `Faturado`/`Enviado` sem nenhum
documento fiscal de saída: o módulo fiscal existente (`lib/nfe/*`,
`app/api/nfe/*`) só trata **entrada** — importação de NF-e de fornecedor para
alimentar Recebimento e Contas a Pagar (ver
[2026-08-20-nfe-recebimento-design.md](2026-08-20-nfe-recebimento-design.md)).
A migração 36 criou o cadastro fiscal do produto e o motor de regras
tributárias, mas parou no cálculo — não emite nada.

Também não existe separação física documentada (romaneio) entre "pedido
confirmado" e "pedido enviado", nem Contas a Receber — o financeiro hoje só
tem o lado de pagar
([2026-08-12-financeiro-contas-a-pagar-design.md](2026-08-12-financeiro-contas-a-pagar-design.md)).

Este documento fecha o desenho do fluxo completo, do pedido até o dinheiro
entrar, para servir de base a quatro specs de implementação separados. Ele não
substitui nenhum deles — não há UI, não há schema fechado aqui, só a
arquitetura e as decisões de fluxo já validadas.

## Objetivo

Definir, em nível de arquitetura:

- os novos estados do pedido e onde o romaneio entra no meio deles;
- que o motor de emissão de NF-e/NFC-e é construído internamente (não via API
  terceirizada), usando o certificado digital já cadastrado
  (`certificados_digitais`, da migração 31);
- que a Conta a Receber nasce automaticamente na autorização da nota pela
  SEFAZ, espelhando o padrão já em produção em Contas a Pagar;
- os requisitos da tela de configuração do emissor (o "menu fiscal"),
  levantados a partir do assistente de homologação do Consumer, referência
  indicada pelo usuário.

## Fora de escopo (viram specs próprios depois)

- UI e schema fechado da tela de configuração do emissor.
- Implementação do motor de assinatura XML e do protocolo com a SEFAZ
  (webservices de autorização, eventos, contingência) — mesmo nível de
  detalhe que o spec de recebimento deu ao cliente `distribuicaoDFe`.
- UI e schema fechado de romaneio/expedição, incluindo o vínculo com lote por
  item (Fase 4 do desenho de rastreabilidade, citada em
  [2026-08-21-pedido-venda-edicao-design.md](2026-08-21-pedido-venda-edicao-design.md)).
- UI e schema fechado de Contas a Receber.
- NFS-e do outro CNPJ do grupo (Buffet e Eventos, marcas Foodtruck/Afya e
  Burguer) — este documento cobre só NF-e modelo 55 e NFC-e do CNPJ 364
  Steakhouse Comercio de Alimentos.
- Emissão em contingência (SEFAZ fora do ar) — decisão de arquitetura fica
  para o spec do motor de emissão, mas precisa existir antes de ir para
  produção, por exigência regulatória.

## Fluxo de estados do pedido

Estado atual (`lib/pedidos.js`): `Pendente → Faturado → Enviado → Cancelado`,
sem separação física documentada entre confirmar o pedido e ele sair.

Estado alvo:

```
Pendente → Separação → Conferido → Faturado → Enviado → Cancelado
```

- **Pendente**: pedido criado, aguardando confirmação/estoque.
- **Separação**: romaneio gerado — lista de itens a separar no estoque, por
  lote quando aplicável. É o ponto em que a quantidade *pedida* pode divergir
  da quantidade *disponível/separada*.
- **Conferido**: separação concluída e conferida contra o pedido. Se houver
  divergência (item faltante, lote trocado), o pedido é ajustado aqui — a
  nota fiscal emitida a seguir reflete o que foi *realmente separado*, nunca
  o que foi pedido originalmente.
- **Faturado**: NF-e/NFC-e emitida e autorizada pela SEFAZ. Dispara a geração
  da Conta a Receber. Nota e DANFE acompanham a entrega a partir daqui.
- **Enviado**: entrega despachada/confirmada. Não altera a Conta a Receber,
  que já nasceu no Faturado.
- **Cancelado**: mantém o comportamento atual; se já houver NF-e emitida, o
  cancelamento do pedido não cancela a nota sozinho — precisa do evento de
  cancelamento de NF-e (janela de 24h da SEFAZ) tratado no spec do motor de
  emissão.

Divergência entre pedido e separado trava a transição para Faturado até ser
resolvida (editar o pedido para refletir o separado, ou completar a
separação) — a emissão nunca parte de dados que o estoque não confirmou.

## Emissão fiscal (motor próprio)

Decisão registrada: **motor de emissão construído internamente**, não via
API terceirizada (Focus NFe, PlugNotas, eNotas etc.). Reaproveita a
infraestrutura já existente do lado de entrada:

- `certificados_digitais` (migração 31) — mesmo certificado A1, mesma cifra
  AES-256-GCM, mesmo isolamento por service role.
- `regras_tributarias` / `grupos_tributarios` (migração 36) — resolvem CFOP,
  CST/CSOSN, base de cálculo e alíquota por produto × natureza da operação ×
  UF × destinatário; a emissão consome esse resultado, não recalcula.
- Parser e utilitários de XML já trazidos pela migração de recebimento
  (`fast-xml-parser`) — a assinatura (`xml-crypto`) e o transporte mTLS via
  `undici` seguem o mesmo padrão do cliente SEFAZ de entrada, agora para os
  webservices de autorização (`NFeAutorizacao4`) em vez de
  `NFeDistribuicaoDFe`.

Modelos suportados: **NF-e modelo 55** (caso principal — venda B2B para as
outras marcas do grupo e terceiros) e **NFC-e** (venda direta/balcão, quando
houver).

Eventos obrigatórios desde o primeiro ciclo (não é opcional adiar — é
exigência regulatória, não feature): cancelamento (evento 110111, janela de
24h) e carta de correção eletrônica (evento 110110). Emissão em contingência
fica registrada como pré-requisito de produção, detalhada no spec do motor.

Disparo: na transição **Conferido → Faturado**, o sistema monta a NF-e a
partir dos itens da separação conferida (não do pedido original), assina,
transmite e aguarda autorização síncrona da SEFAZ. Falha de autorização
mantém o pedido em Conferido com o motivo de rejeição visível — não avança
sozinho para Faturado.

## Configuração do emissor ("menu fiscal")

Requisitos levantados a partir do assistente de homologação do Consumer
(referência indicada pelo usuário), por empresa/emissor — hoje sem tela
dedicada, apesar de parte do schema já existir em `empregadores` (migração
31: regime tributário/CRT, CNAE, inscrição municipal, endereço, dados do
contador) e `certificados_digitais`:

| grupo | campos | onde já existe schema |
| --- | --- | --- |
| Estabelecimento | regime tributário, código do município (IBGE), código UF, inscrição municipal, data inicial de uso | `empregadores` (parcial) |
| Certificado digital | upload, titular, validade, alerta de vencimento | `certificados_digitais` (completo) |
| Credenciadora de pagamento | nome da credenciadora vinculada ao emissor | não existe |
| NFC-e | habilitar/desabilitar, ambiente (produção/homologação), CSC ID, CSC Token, série e número atual por estação | não existe |
| NF-e | habilitar/desabilitar, ambiente, série e número atual por estação, impressora de emissão, modelo do papel, pasta de logo | não existe |
| Configurações avançadas por estação | timeout padrão, recursos HTTP, margens de impressão, qtd. de cópias, impressão automática, exibir QRCode/desconto no item, forçar contingência | não existe |
| Informações complementares | texto padrão impresso na NF-e/NFC-e (ex: regime Simples Nacional, mensagem de agradecimento) | não existe |
| Escritório contábil | CNPJ do escritório, pasta/compartilhamento de XML | `empregadores` tem dados do contador; pasta/compartilhamento não existe |

Ponto de atenção herdado do Consumer: série e numeração são **por estação**,
não só por empresa — cada terminal/estação de emissão mantém seu próprio
contador. Isso precisa entrar no schema do spec de configuração.

## Contas a Receber (novo módulo)

Decisão registrada: gerada **automaticamente na autorização da NF-e pela
SEFAZ** (não na confirmação de entrega), espelhando a estrutura já validada
de Contas a Pagar:

- `contas_a_receber` / `contas_a_receber_parcelas`, mesmo padrão de
  `contas_a_pagar` / `contas_a_pagar_parcelas` (migração 16) — categoria,
  vencimento, status derivado (`Pendente`/`Pago`, "Vencido" calculado na UI),
  forma de recebimento, comprovante.
- Vínculo com `nfe_documento_id` (o documento de saída, análogo ao
  `nfe_documentos` de entrada) e `pedido_id`.
- Fica em `app/financeiro/`, ao lado de `contas-a-pagar/`.
- Deve poder ser conciliada pelo módulo de conciliação bancária já em
  desenvolvimento na branch atual (`atualizacao_35_conciliacao_bancaria.sql`)
  — o desenho exato dessa integração é decisão do spec de Contas a Receber,
  não deste documento.

## Numeração de migração

A documentação anterior (`docs/fiscal/12-desenho-cadastro-fiscal.md`) previa
a migração 37 para emissão; esse número já foi consumido por
`atualizacao_37_pdv_afya_backup.sql`. A migração mais recente aplicada é a
38 (`atualizacao_38_cliente_nome_fantasia.sql`) — cada spec de implementação
que resultar deste documento reserva seu próprio número sequencial no
momento em que for escrito, não neste documento.

## Ordem sugerida dos próximos specs

1. Configuração do emissor (menu fiscal) — pré-requisito de tudo, schema e UI
   pequenos, sem risco regulatório.
2. Motor de emissão de NF-e/NFC-e — núcleo técnico de maior risco.
3. Romaneio/separação — depende do motor de emissão existir para o botão
   "Emitir NF-e" ter o que emitir.
4. Contas a Receber — depende do motor de emissão existir para ter o
   documento fiscal a vincular.

## Decisões registradas

| decisão | escolha |
| --- | --- |
| Motor de emissão | Construído internamente, reaproveitando certificado e regras tributárias já cadastrados |
| Ordem romaneio × emissão | Separação primeiro, emissão depois — NF-e reflete o que foi realmente separado |
| Modelos suportados | NF-e modelo 55 (principal) e NFC-e |
| Gatilho da Conta a Receber | Autorização da NF-e pela SEFAZ, não a confirmação de entrega |
| Eventos obrigatórios | Cancelamento e carta de correção desde o primeiro ciclo |
| NFS-e (outro CNPJ do grupo) | Fora de escopo deste documento |
| Numeração/série NF-e e NFC-e | Por estação, não só por empresa |
