# Clientes e fornecedores vinculados (parceiro cliente e fornecedor ao mesmo tempo)

Data: 2026-08-25
Status: aprovado, aguardando plano de implementação

## Problema

`clientes` e `fornecedores` são cadastros separados, sem nenhuma ligação entre si.
Uma empresa que é as duas coisas ao mesmo tempo — o exemplo motivador é o
Supermercado Manar, que fornece costela para o Grupo 364 e compra defumados de
volta — precisa de dois cadastros digitados do zero, com o mesmo nome, CNPJ,
contato e telefone retorados à mão nos dois lugares. Divergência é questão de
tempo: o telefone muda, alguém atualiza só um dos dois cadastros.

## Escopo

Dentro:

- Ligar um registro de `clientes` a um de `fornecedores` (1 para 1), com os campos
  em comum sempre sincronizados entre os dois lados.
- Uma ficha (formulário de criar/editar) só, com checkbox de papel — Cliente,
  Fornecedor, ou os dois — usada tanto para criar um parceiro novo quanto para
  editar um existente.
- Unificar a tela: uma lista só mostrando clientes, fornecedores e vinculados,
  substituindo as duas telas atuais.
- Unificar o menu e a permissão: uma entrada "Clientes/Fornecedores", uma
  permissão só (a atual `clientes`) em vez de `clientes` + `fornecedores`.
- Consulta de CNPJ na Receita Federal (já existe em clientes) passa a valer
  também quando só o papel Fornecedor está marcado.

Fora (não entra nesta rodada):

- Migrar `clientes`/`fornecedores` para uma tabela única. As duas tabelas
  continuam existindo como são hoje; `pedidos.cliente_id`, `recebimentos.fornecedor_id`,
  `contas_a_pagar.fornecedor_id` e `conciliacao_padroes.fornecedor_id` não mudam.
- Constraint de unicidade em `clientes.cnpj` (hoje não existe nenhuma; `fornecedores`
  já tem). Fica como melhoria futura separada — não é pré-requisito deste trabalho.
- Sincronizar endereço ou bloco fiscal — esses campos só existem em `clientes`,
  `fornecedores` nunca teve endereço rastreado no schema.
- Vínculo N-para-N (um fornecedor ligado a mais de um cliente, por exemplo grupos
  econômicos). O caso real é sempre 1 para 1: a mesma empresa nos dois papéis.

## Arquitetura

### 1. Banco — migração 39

```sql
alter table public.fornecedores add column if not exists nome_fantasia text;

alter table public.clientes
  add column if not exists fornecedor_vinculado_id uuid references public.fornecedores(id) on delete set null;
alter table public.fornecedores
  add column if not exists cliente_vinculado_id uuid references public.clientes(id) on delete set null;

create unique index if not exists clientes_fornecedor_vinculado_idx
  on public.clientes (fornecedor_vinculado_id) where fornecedor_vinculado_id is not null;
create unique index if not exists fornecedores_cliente_vinculado_idx
  on public.fornecedores (cliente_vinculado_id) where cliente_vinculado_id is not null;
```

Aditiva, idempotente, dentro de `begin`/`commit` — mesmo padrão das migrações 26 e
38. Os índices únicos parciais garantem 1-para-1: um fornecedor não pode ficar
ligado a dois clientes, nem um cliente a dois fornecedores.

`nome_fantasia` em `fornecedores` só faltava para os dois lados terem os mesmos
campos compartilháveis (ver seção 2).

Levantamento feito hoje (leitura, sem gravar): só dois usuários existem no banco —
`admin@364.local` (permissão `admin`, já vê tudo) e `francismar@364.local` (sem
nenhuma permissão de módulo). Unificar `clientes` + `fornecedores` numa permissão
só não tira acesso de ninguém agora — não precisa de passo de "reconceder
permissão" no rollout.

### 2. Campos compartilhados e sincronismo

Campos que existem nas duas tabelas e ficam sempre iguais entre um par vinculado:
`nome`, `nome_fantasia`, `cnpj`, `contato`, `telefone`.

Sincronismo é feito na camada de aplicação, não por trigger de banco: o salvamento
do parceiro (seção 4) grava os campos compartilhados nas duas linhas dentro da
mesma operação, sempre que existe vínculo. Não existe hoje nenhum outro caminho de
escrita nessas tabelas fora desta tela (grep confirma: só `app/clientes/page.js`,
`app/fornecedores/page.js` e o cadastro rápido de `components/NovoFornecedorRapido.js`
gravam nelas), então a garantia por aplicação cobre 100% dos casos reais sem a
complexidade extra de um trigger.

`NovoFornecedorRapido.js` (abre quando o recebimento lê um XML de emitente
desconhecido) continua criando só um fornecedor solto, sem vínculo — criar o
vínculo ali sairia do fluxo de recebimento e não é o caso de uso. Quem quiser
vincular depois abre o cadastro normal e marca os dois papéis.

Campos que ficam só de um lado, sem sincronismo: bloco fiscal completo (endereço,
IE, `tipo_pessoa`, `cpf`, e-mail da NF-e, `consumidor_final` etc.) e `tipo`
(Revenda/Distribuidor/...) só em cliente; `categoria` e `email` só em fornecedor.

### 3. Regra de exclusão e desvínculo

Desmarcar um papel que já tem linha gravada reaproveita a trava de FK que já
existe hoje (`lib/cadastro.js`/exclusão direta) — sem regra nova. Detalhe de como
isso funciona dentro de `salvarParceiro`: seção 4.

Vincular dois registros que já existem separados (ex.: cliente "Manar" e
fornecedor "Manar" cadastrados independentemente antes desta feature) fica fora
do escopo desta rodada — a tela só cria o vínculo junto com a criação do parceiro.
Casos existentes que a pessoa queira juntar continuam sendo dois cadastros
soltos até alguém recriar um deles marcando os dois papéis.

### 4. Componente de ficha compartilhado

Novo `components/FichaParceiro.js`, extraído do que hoje é o `<form>` dentro do
modal em `app/clientes/page.js` e `app/fornecedores/page.js`. Recebe o registro
(ou par de registros, se vinculado) e devolve o formulário completo:

- Bloco "Papel" no topo: dois checkboxes, Cliente e Fornecedor. Pelo menos um
  precisa ficar marcado (não dá para salvar um parceiro sem papel nenhum).
- Campos compartilhados (seção 2) sempre visíveis.
- Seção "Dados de cliente" (bloco fiscal, tipo) visível só com Cliente marcado.
- Seção "Dados de fornecedor" (categoria, email) visível só com Fornecedor marcado.
- Botão "Consultar" (CNPJ na Receita Federal) some do bloco de identificação,
  visível sempre que houver CNPJ preenchido e pessoa jurídica — hoje ele já não
  depende de nenhum dado exclusivo de cliente.
- Botão "Consultar IE" continua condicionado à seção de cliente (é campo fiscal,
  só existe lá).

O `useCadastro` hook não dá conta de gravar duas tabelas numa chamada só (hoje
grava uma tabela por vez). Em vez de forçar o hook, o salvamento do parceiro vira
uma função própria em `lib/parceiro.js` (`salvarParceiro(supabase, dados)`): monta
o registro de cliente e/ou fornecedor a partir do form único, grava o que precisa
(insert/update em cada tabela conforme o papel) e, quando os dois papéis estão
marcados, grava o vínculo nos dois lados.

Desmarcar um papel que já tinha linha gravada não é um caso novo: `salvarParceiro`
tenta excluir a linha daquele lado (a mesma trava de FK de sempre — pedido,
recebimento ou conta a pagar vinculados bloqueiam, com o mesmo erro que a tela já
mostra hoje). Se a exclusão for bloqueada, o salvamento inteiro falha e o
checkbox volta a ficar marcado — não dá para desmarcar um papel com movimento
atrelado. Se a exclusão for aceita, o `on delete set null` da migração 39 já
limpa o vínculo do lado que ficou; não precisa de nenhum passo manual de
"desfazer vínculo" além da própria exclusão. Essa função é pura o bastante para
testar sem Supabase de verdade, no mesmo estilo de `lib/extratosServer.js`
(dublê de `sb`, sem rede).

### 5. Tela e lista unificada

`app/clientes/page.js` passa a ser a tela única — carrega `clientes` e
`fornecedores` da empresa atual, monta uma lista de "parceiros": cada cliente sem
`fornecedor_vinculado_id` vira uma linha (papel Cliente); cada fornecedor sem
`cliente_vinculado_id` vira uma linha (papel Fornecedor); cada par vinculado vira
uma linha só (papel Cliente e Fornecedor, dados compartilhados batendo dos dois
lados por causa do sincronismo).

Coluna "Papel" substitui a atual "Tipo": mostra tag(s) Cliente/Fornecedor (e,
quando só Cliente, mantém a subclassificação Revenda/Distribuidor/etc. como hoje).
Busca (`filtrarRegistros`) passa a varrer os campos compartilhados dos dois lados
da lista unificada.

`app/fornecedores/page.js` é removido. Nada mais no código navega para lá por URL
(confirmado: só `lib/menu.js` e `lib/auth.js` referenciam o href) — `.from('fornecedores')`
nas outras telas (recebimentos, financeiro, conciliação) não muda, continuam
lendo a tabela diretamente pelo nome, sem passar pela página.

`lib/menu.js` e `lib/auth.js`: as duas entradas (`clientes` e `fornecedores`)
viram uma, `{ id: 'clientes', label: 'Clientes/Fornecedores', href: '/clientes' }`.
A rota de permissão (`autorizarModulo`/`AppShell modulo="clientes"`) já é a que a
rota de consulta de CNPJ usa hoje — nada muda ali.

## Testes

- `lib/parceiro.js`: `salvarParceiro` com dublê de `sb` (sem rede) — casos: só
  cliente, só fornecedor, os dois criados juntos, adicionar um papel a um
  registro que já tinha só o outro, remover um papel (desvincula sem apagar o
  outro lado), campos compartilhados idênticos nos dois lados após salvar.
- Migração 39: sem harness de Postgres local dedicado (é uma migração simples,
  aditiva, no mesmo nível de complexidade da 26 e da 38, que também não têm) —
  verificação por inspeção mais teste manual pós-`psql` (mesmo processo já usado
  nas migrações 36/38 desta sessão).
- `filtrarRegistros`/montagem da lista unificada: teste da função que junta
  clientes soltos + fornecedores soltos + pares vinculados numa lista só.

## Fora de escopo, mas registrado para depois

- Constraint de unicidade em `clientes.cnpj`.
- Vincular dois cadastros pré-existentes sem recriar um deles.
- Trigger de banco para sincronismo (cobre escrita fora da aplicação, que hoje
  não existe).
