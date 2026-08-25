# Financeiro — Contas a Receber

Data: 2026-08-25
Status: aprovado para plano de implementação

## Contexto

Último dos quatro specs derivados de
[2026-08-25-processo-pedido-romaneio-emissao-nfe-design.md](2026-08-25-processo-pedido-romaneio-emissao-nfe-design.md).
Fecha o ciclo: pedido → romaneio
([2026-08-25-expedicao-romaneio-integracao-nfe-design.md](2026-08-25-expedicao-romaneio-integracao-nfe-design.md))
→ NF-e autorizada
([2026-08-25-motor-emissao-nfe-design.md](2026-08-25-motor-emissao-nfe-design.md))
→ dinheiro a receber.

[2026-08-12-financeiro-contas-a-pagar-design.md](2026-08-12-financeiro-contas-a-pagar-design.md)
já tinha marcado Contas a Receber como fora de escopo explicitamente
("só contas a pagar") porque não existia emissão de nota de saída — o
gatilho natural (nota autorizada) não existia ainda. Agora existe. Este
documento espelha a estrutura de Contas a Pagar (categoria, parcelas,
baixa, vínculo com a origem), trocando o lado.

A migração de conciliação bancária já em produção nesta branch
(`atualizacao_35_conciliacao_bancaria.sql`) declara explicitamente:
*"Nesta fase só as saídas são conciliadas; entradas entram com status
'ignorado'"* — `extrato_lancamentos.parcela_sugerida_id` e
`conta_criada_id` apontam hoje só para `contas_a_pagar`/
`contas_a_pagar_parcelas`. Habilitar a sugestão automática de conciliação
para entradas de Contas a Receber é trabalho da próxima fase daquele
módulo, não deste spec — mexer no meio de uma migração já em produção
para encaixar isto aqui trocaria o escopo de uma feature em andamento
pela deste documento. Fica registrado como próximo passo natural, não
implementado agora.

## Escopo

Dentro:

- `contas_a_receber`/`contas_a_receber_parcelas`, geradas automaticamente
  na autorização de uma NF-e de saída.
- Tela `/financeiro/contas-a-receber`, espelhando
  `/financeiro/contas-a-pagar`: listagem, filtro, baixa manual de parcela.
- Vínculo com `nfe_saida_documentos` e `pedidos`, com link de volta para a
  nota de origem.
- Ajuste de `/relatorios` para somar Contas a Receber onde hoje só soma
  Contas a Pagar.

Fora (YAGNI desta fase):

- **Lançamento manual de conta a receber avulsa** — diferente de Contas a
  Pagar (que aceita despesa manual e nota avulsa), aqui toda conta nasce
  de uma NF-e autorizada. Não existe hoje nenhuma venda fora do pedido +
  NF-e, então não há caso de uso para lançamento solto.
- **Conciliação bancária de entradas** — ver Contexto acima; baixa nesta
  fase é manual, como Contas a Pagar já operava antes da conciliação
  existir para ele.
- **Prazo de pagamento negociado por cliente** — `clientes` não tem esse
  campo hoje; a condição de pagamento é decidida por conta, no momento
  em que a conta nasce (ver abaixo), não herdada de um cadastro.
- **Régua de cobrança/notificação de vencimento** — fica para quando o
  volume justificar.

## Decisão: gatilho e condição de pagamento

Gerada automaticamente **na autorização da NF-e** (não na confirmação de
entrega) — decisão já registrada no spec-mãe. Nasce **à vista, vencendo
na data de emissão**, e fica livremente editável na tela de Contas a
Receber depois — mesma válvula de escape que Contas a Pagar já usa
("todos os campos... continuam editáveis ali mesmo, sem precisar voltar
[à origem]"). Não há pergunta de condição de pagamento no momento de
emitir a nota (o passo "Finalizar e emitir NF-e" do spec de expedição
continua do jeito que foi desenhado, sem campo novo) — simplifica o
fluxo de emissão, que já resolve natureza de operação; parcelamento é
resolvido depois, em Financeiro, por quem cuida de cobrança.

Geração acontece **na camada da aplicação**, dentro do mesmo pipeline que
já grava `nfe_saida_documentos.status = 'autorizado'` (passo 8 do motor
de emissão) — mesmo padrão que Contas a Pagar já usa para nascer junto do
recebimento, não trigger de banco. É um pequeno adendo ao spec do motor:
o passo 8 ganha "grava `contas_a_receber` + 1 parcela" logo após gravar a
autorização, na mesma transação.

## Schema

### `contas_a_receber` (nova tabela)

| coluna | tipo | nota |
| --- | --- | --- |
| `id` | uuid pk | |
| `descricao` | text not null | gerada como `"NF-e {numero} — {cliente}"` |
| `cliente_id` | uuid not null references `clientes(id)` | |
| `pedido_id` | uuid not null references `pedidos(id)` | |
| `nfe_saida_documento_id` | uuid not null references `nfe_saida_documentos(id)` | toda conta nasce de uma nota — sem lançamento avulso nesta fase |
| `valor_total` | numeric(12,2) not null | soma das parcelas; nasce igual a `nfe_saida_documentos.valor_total` |
| `empresa_id` | uuid not null references `empresas(id)` | |
| `created_at` | timestamptz not null default now() | |

`unique (nfe_saida_documento_id)` — uma conta por nota, nunca duas.

### `contas_a_receber_parcelas` (nova tabela)

| coluna | tipo | nota |
| --- | --- | --- |
| `id` | uuid pk | |
| `conta_a_receber_id` | uuid not null references `contas_a_receber(id)` on delete cascade | |
| `numero` | int not null | 1 na criação (à vista); reparcelamento na tela reorganiza as linhas |
| `valor` | numeric(12,2) not null | |
| `vencimento` | date not null | = data de emissão da nota, na criação |
| `status` | text not null default `'Pendente'` check `('Pendente', 'Recebido')` | "Vencido" derivado na UI (`status = 'Pendente' and vencimento < hoje`), mesmo padrão de Contas a Pagar — não é status gravado |
| `data_recebimento` | date | |
| `forma_recebimento` | text | Pix, Boleto, Transferência, Dinheiro — mesma lista curta de Contas a Pagar |
| `comprovante_path` | text | bucket privado `recebimentos`, mesmo padrão |
| `empresa_id` | uuid not null references `empresas(id)` | |
| `created_at` | timestamptz not null default now() | |

RLS de ambas: padrão `empresa_id in (select public.empresas_permitidas())`.

## Regra de integridade: cancelamento de NF-e

Espelha a regra que Contas a Pagar já tem para exclusão de Recebimento:

- NF-e cancelada (evento do motor de emissão) **sem nenhuma parcela
  recebida**: a conta a receber vinculada e suas parcelas são excluídas
  junto (cascade) — a nota nunca existiu do ponto de vista financeiro.
- NF-e com **alguma parcela já recebida**: cancelamento da nota é
  bloqueado com aviso, apontando a conta a receber — trata-se primeiro o
  dinheiro que já entrou, antes de mexer no documento fiscal.

## Interface

`app/financeiro/contas-a-receber/page.js`, ao lado de
`app/financeiro/contas-a-pagar/page.js` — mesmo padrão de tela:

- Listagem com filtro por status (Pendente/Recebido/Vencida), cliente e
  faixa de vencimento; vencidas com destaque visual.
- Cada linha mostra link para o pedido e para a NF-e de origem (XML e
  DANFE, do spec do motor de emissão).
- Baixa de parcela: marcar como Recebido, com data, forma de recebimento
  e comprovante opcional — mesmo fluxo de Contas a Pagar, sem RPC nova
  (é `update` direto, como a baixa manual de Contas a Pagar já é hoje;
  RPC só existe para o caminho de conciliação bancária, que este spec não
  cobre).
- Reparcelamento: editar a parcela única em várias, redistribuindo o
  valor — mesma liberdade de edição que Contas a Pagar já dá.

Entra em `MODULOS` (`lib/auth.js`) como rota adicional do módulo
`financeiro` já existente — sem item de menu novo, só a rota.

## Impacto em telas existentes

- **`/relatorios`**: DRE simplificado e fluxo de caixa passam a somar
  também `contas_a_receber.valor_total`/parcelas, ao lado do que já somam
  de Contas a Pagar — mesmo nível "simplificado" que já existe hoje, sem
  introduzir distinção competência/caixa nova.
- **Motor de emissão**: passo 8 (gravar resultado autorizado) ganha a
  gravação da conta a receber, conforme decidido acima.
- **Conciliação bancária**: nenhuma mudança nesta fase — nota registrada
  no Contexto para quando aquele módulo ganhar a fase de entradas.

## Testes

Seguindo `node --test tests/*.test.mjs`:

- geração da conta a receber a partir de um `nfe_saida_documento`
  fixture: `valor_total` bate com a nota, 1 parcela à vista vencendo na
  data de emissão.
- `unique (nfe_saida_documento_id)`: segunda tentativa de gerar conta
  para a mesma nota não duplica.
- cancelamento de NF-e sem parcela recebida remove a conta em cascade;
  com parcela recebida é bloqueado.
- reparcelamento redistribui o valor total sem perder nem sobrar centavo
  (mesmo cuidado de arredondamento que Contas a Pagar já resolve).
- "Vencido" é sempre derivado (`Pendente` + `vencimento < hoje`), nunca
  gravado como status.

## Migração

Próximo número sequencial livre no momento da implementação — cria
`contas_a_receber` e `contas_a_receber_parcelas` com RLS, sem backfill
(tabelas novas, sem dado anterior a migrar — não existe venda com nota
emitida ainda).

## Decisões registradas

| decisão | escolha |
| --- | --- |
| Gatilho | Autorização da NF-e, não confirmação de entrega — decisão herdada do spec-mãe |
| Lançamento avulso | Fora de escopo — toda conta nasce de uma nota, sem exceção nesta fase |
| Condição de pagamento | À vista por padrão na criação, editável depois em Financeiro — não perguntada na hora de emitir |
| Onde a conta é criada | Camada de aplicação, dentro do pipeline do motor de emissão — não trigger de banco |
| Conciliação bancária de entradas | Fora de escopo — schema atual só suporta contas_a_pagar; é próxima fase daquele módulo |
| Cancelamento de NF-e com dinheiro já recebido | Bloqueado — espelha a regra já existente de Contas a Pagar para recebimento com parcela paga |
