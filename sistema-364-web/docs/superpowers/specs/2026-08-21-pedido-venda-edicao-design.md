# Edição de pedido de venda — design

**Data:** 2026-08-21
**Status:** aprovado; aguardando plano de implementação
**Empresa piloto:** 364 Food Services

Primeira entrega de uma sequência. Esta cobre a edição do pedido lançado. O romaneio de
expedição, pedido junto com ela, é a Fase 4 do design de
[controle de lote e rastreabilidade](2026-08-20-controle-lote-rastreabilidade-design.md) e
depende das três fases anteriores; nada aqui é refeito quando ela chegar.

## Problema

`/pedidos` cria pedido, troca status, imprime a ficha e exclui. Não edita. Um pedido lançado
com o cliente errado, a quantidade errada ou o preço errado só tem uma saída: excluir e
refazer.

Excluir é pior do que parece. `pedidos` não guarda motivo nem autor, e o `delete` leva os
itens junto por `on delete cascade`. O pedido some do banco sem deixar rastro de que existiu,
e o cliente que ligou reclamando de um pedido que "sumiu do sistema" não tem como ser
atendido. Quando a expedição existir, o mesmo `delete` vai apagar a origem de um romaneio já
impresso.

## Escopo

Dentro:

- editar cabeçalho e itens de pedido em `Pendente`;
- cancelar pedido com motivo, em qualquer status, substituindo a exclusão;
- rota própria por pedido, com o formulário compartilhado entre novo e edição;
- travas de imutabilidade no banco, não apenas na tela.

Fora:

- romaneio, caixas e lote por item — Fase 4 do design de rastreabilidade;
- preço por cliente e tabela de preços — backlog separado;
- emissão de NF-e, que segue no emissor externo.

## Decisão central: cancelar substitui excluir

`vw_estoque_produto` já desconta apenas pedidos com status diferente de `Cancelado`:

```sql
sum(pi.quantidade) ... where pi.produto_id = p.id and pe.status <> 'Cancelado'
```

Cancelar, portanto, já devolve o saldo sozinho — não é preciso mexer na view nem em estoque.
O que falta é o motivo, o autor e a data, e é isso que a migração acrescenta. O botão
**Excluir** sai da tela e o `delete` deixa de ser um caminho oferecido pela interface.

## Modelo de dados

### Alterações em tabelas existentes

| Tabela | Alteração |
| --- | --- |
| `pedidos` | `+ observacoes text` |
| `pedidos` | `+ cancelado_motivo text`, `+ cancelado_em timestamptz`, `+ cancelado_por_id uuid references funcionarios(id)` |
| `pedidos` | `+ reaberto_motivo text`, `+ reaberto_em timestamptz`, `+ reaberto_por_id uuid references funcionarios(id)` |
| `pedidos` | `+ updated_at timestamptz not null default now()` |

Migração `atualizacao_24_pedidos_edicao.sql`. O número 24 é o próximo livre: `main` já
tem 21 (`dashboard_grupo`), 22 (`nfe_documentos`) e 23 (`fornecedor_cnpj_normalizado`). Neste
branch só existe `atualizacao_20_rls_escopo_empresa.sql`; o
`atualizacao_20_apuracao_ajustes_fechamento.sql` vive em `feat/menu-categorias`, que ainda
não chegou aqui — a colisão de número é entre branches, não dentro deste.

Nenhuma tabela nova.

### Travas no banco

As regras valem por trigger, não só pela tela — o mesmo raciocínio de
`fn_producao_interna_bloquear_edicao`:

1. `insert`, `update` e `delete` em `pedido_itens` são rejeitados quando o pedido não está
   em `Pendente`.
2. `update` de `cliente_id` ou `data` em `pedidos` é rejeitado fora de `Pendente`.
3. Avançar o status continua livre — é isso que tira o pedido de `Pendente`.
4. **Voltar de `Faturado` ou `Enviado` para `Pendente` exige `reaberto_motivo`**, gravado com
   autor (`reaberto_por_id`) e data (`reaberto_em`), no mesmo padrão do cancelamento.
   Decisão tomada na revisão final, revendo o "status continua livre" do desenho original:
   reabrir devolve a edição de itens e preços, então um clique sem motivo e sem autor
   esvaziava as regras 1 e 2 inteiras — bastava reabrir, editar e faturar de novo. A
   reabertura vive só na página do pedido, onde há diálogo para o motivo; a lista deixa de
   oferecer `Pendente` para pedido que já saiu dele. O motivo precisa ser diferente do que já
   está gravado, senão um `update` pelado pela API herdaria o motivo da reabertura anterior.
5. `status = 'Cancelado'` exige `cancelado_motivo` preenchido, por check constraint.
6. `Cancelado` é terminal: não volta para `Pendente`.
7. Pedido sem nenhum item não pode ser faturado nem enviado. **Cancelar é exceção**: é a
   única saída de um pedido vazio, e a exclusão saiu da interface.
8. `quantidade` e `preco_unitario` não aceitam valor negativo; `quantidade` não aceita zero.
9. `cancelado_em` e `reaberto_em` são carimbados pelo trigger, com o relógio do banco, e não
   aceitam valor vindo do cliente.

As duas funções de trigger são `security definer` com `search_path` fixo: como `invoker`, a
leitura do pedido pai ficava sujeita à policy de empresa, e quem não enxergasse o pedido caía
no ramo da cascata de `delete` e escapava da trava.

## Telas

### `/pedidos` (existente)

Mantém o formulário de novo pedido no topo e a lista embaixo. Na lista, **Abrir** substitui
o par de botões atual; a impressão da ficha passa a viver na página do pedido. O botão
**Excluir** é removido.

### `/pedidos/[id]` (rota nova)

Página do pedido: cabeçalho, itens, total, status e histórico de cancelamento quando houver.

Em `Pendente`, os campos são editáveis e **Salvar alterações** aplica o diff dos itens —
remove os que saíram, atualiza os que mudaram, insere os novos. Item intocado não gera
`update`.

Em `Faturado`, `Enviado` e `Cancelado`, a página é leitura, com o motivo do cancelamento
visível quando existir. Corrigir exige reabrir com motivo, ou cancelar e refazer.

**Cancelar pedido** abre confirmação com campo de motivo obrigatório e grava autor e data.

**Reabrir** — escolher `Pendente` no seletor de status de um pedido `Faturado` ou `Enviado` —
abre o mesmo tipo de diálogo, com motivo obrigatório, e grava autor e data. Motivo, autor e
data da última reabertura aparecem na página, como a tarja de cancelamento.

O saldo do produto aparece na escolha do item, como já aparece hoje, e quantidade acima do
saldo gera **aviso amarelo, não bloqueio**: pedido lançado para produzir depois é uso real, e
travar aqui impediria a venda antecipada.

A rota confere que o pedido pertence à empresa atual (`useEmpresaAtual`) antes de renderizar.
Pedido de outra empresa devolve "não encontrado", sem revelar que o id existe.

## Componentes

- `components/PedidoForm.js` — cabeçalho e itens, extraídos de `app/pedidos/page.js`,
  usados por novo pedido e por edição. Recebe o pedido (ou `null`) e devolve o estado ao
  chamador; não fala com o Supabase.
- `lib/pedidos.js` — lógica pura: `podeEditar(status)`, `totalPedido(itens)`,
  `diffItens(original, atual)`.
- `app/pedidos/[id]/page.js` — carrega, salva e cancela.

A extração encolhe `app/pedidos/page.js`, hoje com 240 linhas e duas responsabilidades.

## Erros e casos de borda

- Pedido muda de status enquanto está aberto na tela: o trigger recusa o `update`, a tela
  recarrega e mostra o estado atual em vez de sobrescrever.
- Dois usuários editando o mesmo pedido: o cabeçalho fica com quem salvou por último; nos
  itens o diff é por `id`, então remover um item já removido devolve erro e recarrega. Sem
  lock — o volume não justifica.
- Cancelar sem motivo é bloqueado na tela e no banco.
- Cancelamento de pedido já expedido fica bloqueado quando a Fase 4 existir; hoje não há
  expedição, então não há o que travar.

## Testes

`tests/pedidos.test.mjs`, rodado por `node --test tests/`, seguindo `tests/producao.test.mjs`:

- `podeEditar` para cada status, incluindo status desconhecido vindo do banco;
- `diffItens`: item novo, removido, com quantidade alterada, com preço alterado e intocado —
  o intocado não pode aparecer na lista de `update`;
- `totalPedido` com preço unitário vazio caindo no `preco_venda` do produto.

As telas ficam em verificação manual, como o restante do projeto.

## Encaixe com a expedição

`/pedidos/[id]` é o ponto de entrada da Fase 4: ganha um painel **Expedição** com o botão
**Gerar romaneio**, que leva a `/expedicao?pedido=…`. A rota própria — em vez de modal — foi
escolhida por isso.

A cadeia completa até o romaneio, na ordem acordada:

0. Aplicar a **atualização 17** no Supabase de produção. Pré-requisito verificado como não
   aplicado em 2026-08-20; sem ele a Fase 1 não compila contra o banco real.
1. Migração de rastreabilidade e etiqueta de recebimento.
2. Ficha de defumação.
3. Ficha de embalagem e etiqueta de produção.
4. Expedição: romaneio com os lotes, caixas, FEFO, etiqueta 101×50 por caixa e campo da NF-e.

Esta entrega é independente das cinco e não espera a 17.
