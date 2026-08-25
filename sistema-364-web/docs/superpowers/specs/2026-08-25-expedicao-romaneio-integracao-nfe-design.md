# Expedição/Romaneio — Fase 4 revisada, integrada ao motor de NF-e

Data: 2026-08-25
Status: aprovado para plano de implementação

## Contexto

Terceiro dos quatro specs derivados de
[2026-08-25-processo-pedido-romaneio-emissao-nfe-design.md](2026-08-25-processo-pedido-romaneio-emissao-nfe-design.md).
**Não é um desenho novo.** Expedição/romaneio já tinha spec completo e
aprovado como Fase 4 de
[2026-08-20-controle-lote-rastreabilidade-design.md](2026-08-20-controle-lote-rastreabilidade-design.md)
(`expedicoes`, `expedicao_caixas`, `expedicao_itens`, FEFO, regra de caixa,
etiqueta 101×50) — Fases 1-3 desse projeto (etiqueta de recebimento,
defumação, embalagem) já estão em produção (migrações 28-30); só a Fase 4
não foi construída.

Esse desenho é anterior ao motor de emissão existir, e por isso previa
`expedicoes.nfe_numero`/`nfe_emitida_em` como texto lançado manualmente
("o número da NF-e é lançado depois, em campo separado, porque vem do
emissor externo" — Fase 4, linha 242 do documento original). Isso mudou:
agora existe
[2026-08-25-motor-emissao-nfe-design.md](2026-08-25-motor-emissao-nfe-design.md).
Este documento é a revisão pontual da Fase 4 para integrar com o motor —
tudo que o design original já resolveu (mecânica de caixa, FEFO, regras
1-10, etiquetas, telas de `/lotes` e rastreio público) **continua valendo
sem alteração** e não é repetido aqui. Só o que muda está descrito abaixo.

## O que muda em relação ao design original da Fase 4

1. **Item sem lote passa a ser aceito no romaneio.** O desenho original
   exigia `expedicao_itens.recebimento_item_id not null` — funciona para
   o mundo dos defumados (piloto do projeto de rastreabilidade), mas nem
   todo item de um pedido B2B passa por defumação/embalagem rastreada.
   `recebimento_item_id` vira **anulável**: item com lote continua com
   FEFO, saldo por lote e etiqueta de despacho detalhada; item sem lote
   entra só com quantidade, sem sugestão de lote, na mesma caixa se
   couber. Nenhuma regra de negócio do design original muda para o item
   *com* lote — a novidade é só que o *sem* lote agora tem um caminho.
2. **`nfe_numero`/`nfe_emitida_em` saem; entra `nfe_saida_documento_id`**
   (FK para `nfe_saida_documentos`, nulo até a emissão). Como a tabela
   `expedicoes` nunca chegou a ser criada (Fase 4 não implementada), isso
   não é uma migração de alteração — é o schema final nascendo já correto,
   sem coluna morta a remover depois.
3. **Finalizar o romaneio dispara o motor de emissão automaticamente**,
   com os itens realmente alocados nas caixas (não os itens originais do
   pedido) — fecha o fluxo pedido→romaneio→nota como uma ação só, em vez
   de duas.
4. **Pedido ganha dois status novos**, `Separação` e `Conferido`, entre
   `Pendente` e `Faturado` — o design original não precisava disso porque
   assumia emissão externa e manual; agora que o romaneio dispara emissão
   de verdade, o pedido precisa refletir onde está no meio do caminho.

## Máquina de estados do pedido (revisão de `lib/pedidos.js`)

```
Pendente → Separação → Conferido → Faturado → Enviado
                                       ↑
                          (Conferido, se a emissão falhar,
                           fica aqui até nova tentativa)

Cancelado — a partir de qualquer estado anterior a Enviado
```

`STATUS_PEDIDO` passa de `['Pendente', 'Faturado', 'Enviado', 'Cancelado']`
para `['Pendente', 'Separação', 'Conferido', 'Faturado', 'Enviado',
'Cancelado']`. Transições:

- **Pendente → Separação**: ao criar o romaneio (`expedicoes` nasce em
  `rascunho`, vinculada ao pedido). Pedido para de ser editável pelo
  formulário comum a partir daqui — mesma trava que
  [2026-08-21-pedido-venda-edicao-design.md](2026-08-21-pedido-venda-edicao-design.md)
  já usa para `Pendente`, estendida: editar cabeçalho/itens exige primeiro
  cancelar o romaneio em rascunho.
- **Separação → Conferido**: ao finalizar o romaneio (`expedicoes.status`
  → `finalizado`) — mas só quando **não há divergência** entre o que foi
  pedido e o que foi alocado nas caixas. Havendo divergência (faltou
  estoque, trocou quantidade), a tela oferece "Ajustar pedido" antes de
  liberar o finalizar — reaproveita a edição de pedido já existente, com
  motivo, exatamente como o spec de edição já resolve. Isso é a aplicação
  concreta da regra que o spec-mãe já tinha fixado: "a emissão nunca parte
  de dados que o estoque não confirmou".
- **Conferido → Faturado**: automático, no mesmo clique de finalizar o
  romaneio — chama o motor de emissão com os itens da expedição. Sucesso
  (`nfe_saida_documentos.status = 'autorizado'`) avança o pedido; qualquer
  outro resultado deixa o pedido em `Conferido` (não regride a
  `Separação` — o romaneio já está fechado, só a nota que falhou).
- **Conferido, com nota pendente**: tela do pedido mostra o motivo da
  falha (vindo de `nfe_saida_documentos.motivo_rejeicao`) e o botão
  "Tentar emitir novamente" do próprio motor de emissão — o gatilho
  manual que aquele spec já desenhou não é descartado, vira o caminho de
  recuperação quando o automático falha.
- **Cancelado**: continua disponível a partir de qualquer estado antes de
  `Enviado`, com o mesmo motivo obrigatório já implementado. Cancelar com
  romaneio finalizado e nota já autorizada exige cancelar a NF-e primeiro
  (evento do motor de emissão, janela de 24h) — cancelar o pedido sozinho
  não cancela a nota.

## Schema (Fase 4, nascendo já no formato final)

Alterações nas três tabelas do design original de
[2026-08-20-controle-lote-rastreabilidade-design.md](2026-08-20-controle-lote-rastreabilidade-design.md#tabelas-novas):

### `expedicoes`

| coluna | mudança |
| --- | --- |
| `nfe_numero`, `nfe_emitida_em` | **removidas do desenho** — nunca chegaram a ser criadas, então não há migração de remoção, só não entram |
| `nfe_saida_documento_id` | nova, `uuid references nfe_saida_documentos(id)`, nulo até a emissão autorizar |
| `pedido_id` | mantido — mas passa a ser o mesmo `pedido_id` que governa a máquina de estados acima, não um vínculo solto |

### `expedicao_itens`

| coluna | mudança |
| --- | --- |
| `recebimento_item_id` | passa de `not null` para **anulável** — item sem lote rastreado entra sem essa referência |

Sem mudança em `expedicao_caixas` — regra de "no máximo 2 produtos
distintos e 12 unidades" vale igual para caixa com ou sem lote.

## Fluxo revisado da tela `/expedicao`

Mantém a tela descrita no design original (escolhe pedido, sugestão FEFO,
monta caixas, imprime etiquetas), com dois ajustes:

- Item sem lote rastreável aparece na lista de itens do pedido sem
  sugestão de lote — só pede a quantidade a alocar na caixa, sem os
  campos de FEFO/saldo por lote (que só existem para produto com
  `recebimento_item_id`).
- Botão final passa de "Finalizar" (que só fechava o romaneio) para
  **"Finalizar e emitir NF-e"** — mostra o resultado da emissão na mesma
  tela (autorizado com link do DANFE, ou motivo da falha com o pedido
  ficando em `Conferido` aguardando nova tentativa). Escolha de natureza
  de operação (que o motor de emissão pede) acontece aqui, no momento de
  finalizar — não depois, numa tela separada.

## Regras de negócio (delta sobre as 10 já registradas no design original)

11. Romaneio só finaliza com o pedido inteiro alocado em caixas **e** sem
    divergência entre pedido e alocado — regra 7 do design original
    ("não fecha enquanto sobrar item sem caixa") continua valendo, esta
    acrescenta a checagem de divergência.
12. Item sem `recebimento_item_id` não participa de FEFO nem de saldo por
    lote — sai do `vw_estoque_produto` comum (não de
    `vw_estoque_produto_lote`, que é só para o que tem lote).
13. Falha da emissão automática nunca desfaz o romaneio finalizado — o
    romaneio já reflete o que foi fisicamente separado; só a nota fica
    pendente, e "tentar novamente" não remonta caixas.
14. Cancelar pedido com NF-e já autorizada exige cancelar a nota primeiro
    (delta sobre a regra já existente do design de edição de pedido, que
    prevía cancelamento livre por não existir emissão real ainda).

## Testes (delta sobre a suíte já prevista no design original)

- transição `Separação → Conferido` bloqueada quando há item alocado
  divergente do pedido, liberada após ajuste do pedido;
- alocação em caixa aceita item sem `recebimento_item_id` misturado com
  item que tem lote, respeitando o limite de 2 produtos/12 unidades já
  testado no design original;
- finalizar romaneio chama o motor de emissão com os itens da expedição
  (não os itens originais do pedido) — teste de integração usando o
  fixture de pedido já usado no spec do motor;
- falha da emissão deixa `expedicoes.status = 'finalizado'` e
  `pedidos.status = 'Conferido'`, nunca desfaz caixas nem regride para
  `Separação`;
- cancelamento de pedido com nota autorizada é bloqueado até a nota ser
  cancelada.

## Decisões registradas

| decisão | escolha |
| --- | --- |
| Reaproveitar design existente | Sim — Fase 4 de 2026-08-20, só revisada na integração com NF-e; mecânica de caixa/FEFO/etiqueta não muda |
| Item sem lote no romaneio | Aceito, `recebimento_item_id` anulável, sem FEFO/saldo por lote para ele |
| Gatilho da emissão | Automático ao finalizar o romaneio, com fallback manual (botão do motor) se falhar |
| Novos status de pedido | `Separação` e `Conferido`, entre `Pendente` e `Faturado` |
| Divergência pedido × separado | Trava a finalização; resolve editando o pedido antes, não depois |
| Cancelamento com nota emitida | Exige cancelar a NF-e primeiro — pedido não cancela a nota sozinho |
