# Retomada: romaneio de separação, faturamento automático e transporte na NF-e

Data: 2026-09-10
Status: aprovado, pronto para plano de implementação

## Contexto

O pedido de venda (`pedidos`/`pedido_itens`) hoje tem só quatro status
(`Pendente`, `Faturado`, `Enviado`, `Cancelado` — `lib/pedidos.js:6`) e nenhum
romaneio: mudar o status para `Faturado` é um `<select>` livre
(`app/pedidos/[id]/page.js`) que não verifica separação nem lote, e libera
emitir NF-e na hora. Não existe `contas_a_receber` nem qualquer informação
financeira derivada do pedido além do total.

Isso já tinha sido desenhado e aprovado em 25/08/2026, em quatro documentos
encadeados:

1. [2026-08-25-processo-pedido-romaneio-emissao-nfe-design.md](2026-08-25-processo-pedido-romaneio-emissao-nfe-design.md) — spec-mãe, arquitetura geral.
2. [2026-08-25-configuracao-emissor-fiscal-design.md](2026-08-25-configuracao-emissor-fiscal-design.md) — menu fiscal por empresa.
3. [2026-08-25-motor-emissao-nfe-design.md](2026-08-25-motor-emissao-nfe-design.md) — motor de emissão próprio.
4. [2026-08-25-expedicao-romaneio-integracao-nfe-design.md](2026-08-25-expedicao-romaneio-integracao-nfe-design.md) — romaneio (reaproveita a Fase 4 de [2026-08-20-controle-lote-rastreabilidade-design.md](2026-08-20-controle-lote-rastreabilidade-design.md)), integrado à emissão.
5. [2026-08-25-financeiro-contas-a-receber-design.md](2026-08-25-financeiro-contas-a-receber-design.md) — conta a receber automática.

Só os itens 2 e 3 foram construídos (commits `e1df4f3`, `2a00c3e`, `5d62a51`,
`f4a8432`, `3f3339f` — configuração do emissor, motor de emissão, DANFE/XML,
crédito ICMS Simples). Romaneio (item 4) e Contas a Receber (item 5) nunca
saíram do papel: nenhuma migração criou `expedicoes`, `expedicao_caixas`,
`expedicao_itens`, `contas_a_receber` ou os status `Separação`/`Conferido`.
Consequência não prevista: hoje dá para faturar e emitir NF-e de um pedido
**sem nenhum romaneio nem lote** — exatamente o que o spec-mãe queria evitar
("a emissão nunca parte de dados que o estoque não confirmou").

Investigação desta sessão também achou um gap que nenhum dos cinco
documentos cobre: o grupo `<transp>` da NF-e é gravado com `modFrete` fixo em
`'9'` e nenhum dado de transportadora/volume
(`lib/nfe/montarXml.js:409` — `'<transp>' + tag('modFrete', '9') + '</transp>'`).
Não há cadastro de transportadora em lugar nenhum do sistema.

## Decisão

Retomar os specs de 25/08 (itens 1, 4 e 5 acima) como arquitetura vigente,
**sem redesenhá-los** — nenhuma regra de negócio, schema ou fluxo descrito
neles muda. Esta spec cobre só o delta necessário para fechar a lacuna de
transporte e para registrar o que reconciliar com o que já foi construído
depois deles.

Confirmado com o usuário: entrega é feita por **transportadora
terceirizada** (não frota própria, não é o cliente que retira) — isso define
o desenho da seção de transporte abaixo.

## O que já existe e não muda

- Motor de emissão (`lib/nfe/*`), config do emissor por empresa
  (`empregadores`, `certificados_digitais`), download de XML/DANFE, crédito
  ICMS Simples (CSOSN 101/202) — tudo mantido como está.
- **Mudança de comportamento**: depois desta implementação, marcar
  `Faturado` deixa de ser uma opção livre no `<select>` do pedido — só
  acontece automaticamente ao finalizar um romaneio (ver spec de expedição,
  seção "Máquina de estados do pedido"). Pedido sem romaneio não emite nota.

## Transporte na NF-e (delta novo sobre os specs de 25/08)

### Cadastro de transportadora

Nova tabela `transportadoras`, mesmo padrão simples de `fornecedores`
(`schema.sql:19-28`) — sem `empresa_id` (RLS `authenticated_full_access`,
igual clientes/fornecedores; transportadora é recurso compartilhado entre as
empresas do grupo, não foi dito o contrário):

| coluna | tipo | nota |
| --- | --- | --- |
| `id` | uuid pk | |
| `nome` | text not null | razão social |
| `nome_fantasia` | text | |
| `cnpj` | text | |
| `ie` | text | inscrição estadual — `transp/transporta/IE` da NF-e |
| `endereco` | text | `xEnder` |
| `municipio` | text | `xMun` |
| `uf` | text | |
| `telefone` | text | |
| `created_at` | timestamptz not null default now() | |

Tela `app/transportadoras/page.js`, CRUD simples, mesmo padrão de
`app/clientes/page.js` (lista + form, sem abas). Entra em `MODULOS`
(`lib/auth.js`) ao lado de clientes/fornecedores.

### `expedicoes` ganha (sobre o schema já definido no spec de 25/08)

| coluna | tipo | nota |
| --- | --- | --- |
| `transportadora_id` | uuid references `transportadoras(id)` | **nullable** — exceção pontual de cliente retirando não deve travar o romaneio |
| `modo_frete` | text check (`'0'`,`'1'`,`'9'`) default `'0'` | `0` = contratação por conta do remetente/CIF (default, caso comum de B2B); `1` = destinatário/FOB; `9` = sem frete, para a exceção de retirada |
| `veiculo_placa` | text | opcional |
| `veiculo_uf` | text | opcional |

### Volumes — sempre derivados, nunca redigitados

`expedicao_caixas` já tem `numero` e `peso_bruto_kg` (spec de 20/08). O grupo
`vol` da NF-e é calculado na emissão, não digitado de novo:

- `qVol` = quantidade de caixas da expedição
- `esp` = `"Caixa"`
- `pesoB` = soma de `peso_bruto_kg` de todas as caixas
- `pesoL` = mesmo valor de `pesoB` (tara não é registrada separadamente —
  YAGNI: ninguém pediu peso líquido distinto do bruto até hoje)

### `resolverNota.js` / `montarXml.js`

`resolverNota.js` passa a receber a `expedicao` finalizada (não só o
`pedido`) e monta o `transp` real:

- `modFrete` = `expedicoes.modo_frete`
- grupo `transporta` (CNPJ, xNome, IE, xEnder, xMun, UF) — só entra se
  `transportadora_id` estiver setado
- grupo `veicTransp` (placa, UF) — só entra se `veiculo_placa` estiver
  setado
- grupo `vol` — sempre presente quando a expedição tem ao menos uma caixa

`montarXml.js` ganha os `tag()` correspondentes, no mesmo estilo defensivo
que o resto do arquivo já usa (`tag()` omite quando não há texto).

## Fluxo (reafirmando o já aprovado em 25/08, sem mudança de regra)

```
Pendente → Separação → Conferido → Faturado → Enviado
                                       ↑
                          (Conferido, se a emissão falhar)

Cancelado — a partir de qualquer estado anterior a Enviado
```

- **Pendente → Separação**: criar romaneio (`expedicoes` em `rascunho`).
- **Separação**: monta caixas, FEFO, sugestão de lote; agora também
  preenche transportadora/modo de frete/veículo no cabeçalho.
- **Separação → Conferido**: finalizar sem divergência entre pedido e
  separado.
- **Conferido → Faturado**: automático — motor de emissão monta a nota
  (itens da expedição + `transp` desta spec), assina, transmite. Sucesso
  avança para `Faturado` e grava `contas_a_receber` (spec de 25/08, passo 8
  do motor). Falha mantém em `Conferido` com motivo visível e botão
  "Tentar novamente".
- **Cancelado**: livre até `Enviado`; com nota autorizada, exige cancelar a
  NF-e primeiro.

Nenhuma regra nova aqui — só o registro de que o grupo `transp` (seção
acima) entra no mesmo passo em que a nota é montada.

## Interface

- `/expedicao` (novo, conforme desenho de 20/08 e revisão de 25/08): telas
  de escolha de pedido, sugestão FEFO, montagem de caixas — cabeçalho ganha
  transportadora (busca/seleciona), modo de frete (default CIF) e
  placa/UF opcionais. Botão final: **"Finalizar e emitir NF-e"**.
- `/pedidos/[id]`: o `<select>` de status livre sai de cena para os estados
  intermediários. No lugar:
  - `Pendente`: botão **"Ir para separação"** — cria `expedicoes` em
    rascunho e leva para `/expedicao/[id]`.
  - `Separação`/`Conferido`: link **"Continuar romaneio"** para
    `/expedicao/[id]`; se `Conferido` com nota pendente, mostra o motivo da
    rejeição e "Tentar emitir novamente" (já desenhado no spec de 25/08).
  - `Faturado`/`Enviado`/`Cancelado`: continuam como hoje (bloco de NF-e,
    banner de cancelamento com motivo).
- `/transportadoras`: CRUD simples, sem novidade de padrão.

## Migração

Próximo número livre: **50**. Um único `atualizacao_50_expedicao_romaneio.sql`
cobrindo o que os specs de 20/08 e 25/08 já fecharam (`expedicoes`,
`expedicao_caixas`, `expedicao_itens`, novos status de pedido, triggers
atualizados) mais o delta desta spec (`transportadoras`, colunas de frete em
`expedicoes`). `atualizacao_51_contas_a_receber.sql` separado, cobrindo só o
schema já fechado no spec de Contas a Receber (sem alteração aqui).

## Testes

Cobertura agregada dos specs de 20/08 e 25/08 (romaneio, FEFO, caixas,
divergência, emissão automática, contas a receber, cancelamento com nota
autorizada) mais o delta de transporte:

- `vol` calculado a partir das caixas bate quantidade e peso bruto somado;
- `transp` inclui `transporta` só quando `transportadora_id` setado;
- `transp` inclui `veicTransp` só quando `veiculo_placa` setado;
- `vol` sempre presente quando há ao menos uma caixa; ausente (nota rejeita
  antes) quando a expedição não tem nenhuma caixa — não deveria chegar aqui,
  já que romaneio só finaliza com o pedido inteiro alocado (regra 7 do
  spec de 20/08).

## Decisões registradas

| decisão | escolha |
| --- | --- |
| Arquitetura geral | Specs de 25/08 (romaneio + contas a receber) retomados sem alteração de regra |
| Transportadora | Terceirizada — cadastro novo mínimo (`transportadoras`), compartilhado entre empresas do grupo, sem `empresa_id` |
| Modo de frete default | CIF (`'0'`), ajustável por romaneio; `'9'` cobre a exceção de retirada |
| Volumes na NF-e | Sempre derivados de `expedicao_caixas`, nunca redigitados |
| Interação do pedido | `<select>` de status livre só sobrevive para `Enviado`/`Cancelado`; `Separação`/`Faturado` passam a ser guiados por botão |
| Faturar sem romaneio | Deixa de ser possível — é a lacuna que motivou retomar o spec de 25/08 |
