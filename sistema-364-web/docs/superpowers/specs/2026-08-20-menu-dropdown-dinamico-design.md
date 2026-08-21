# Menu de navegação por categorias com dropdown dinâmico

Data: 2026-08-20
Status: aprovado, pronto para planejamento

## Problema

A sidebar do sistema é uma lista plana de dez links, definida pelo array `MODULOS`
em `lib/auth.js` e renderizada diretamente em `components/AppShell.js`. Conforme o
sistema ganhou telas (Ponto com oito rotas, Produção com seis), a lista deixou de
refletir a organização real do negócio: o usuário vê "Produção" na sidebar mas
precisa entrar na tela para descobrir que existem Validades e Histórico ali dentro.

Além disso, `MODULOS` acumula duas responsabilidades hoje: é a estrutura da sidebar
e é o catálogo de permissões usado nos checkboxes da tela de Acesso
(`app/ponto/colaboradores/page.js:552`). Agrupar a navegação sem separar essas duas
coisas quebraria a tela de permissões.

## Objetivo

Reorganizar a navegação em seis categorias — Cadastros, Produção, Vendas,
Financeiro, RH e Relatórios — apresentadas como accordion na sidebar, sem alterar
nenhuma rota existente e sem alterar o modelo de permissões.

## Escopo

Dentro do escopo:

- Nova estrutura de menu com grupos expansíveis.
- Separação do cadastro de matéria-prima em rota própria.
- Renomeação de "Produção Completa" para "Defumação".
- Três telas de Vendas criadas como placeholders ("em construção").
- Testes das funções puras de menu.

Fora do escopo (viram specs próprios):

- Implementação funcional das telas de Vendas: importação de vendas da 364
  Steakhouse e da 364 Foodtruck/Afya, cadastro de vendas da 364 Buffet e cadastro
  de vendas da 364 Burguer (iFood). Cada uma exige schema, integração com estoque e,
  no caso da importação, parser de arquivo.
- Cadastro da empresa 364 Buffet, que ainda não existe em
  `supabase/atualizacao_03_grupos_empresas.sql`.

## Decisões

**Nenhuma rota existente muda.** Só entram rotas novas. Isso evita quebrar
bookmarks e os `href` espalhados pelo código. O repositório já tem o padrão de
redirect shim para rotas movidas (`app/despesas`, `app/funcionarios`,
`app/usuarios`), mas ele não é necessário aqui.

**"Defumação" é a Produção Completa renomeada.** Só o rótulo muda; a rota
`/producoes/completa` e o comportamento da tela ficam iguais.

**Matéria-prima ganha rota própria.** Hoje `app/produtos/page.js` tem 308 linhas e
faz duas coisas: cadastro de matéria-prima e catálogo de produtos com ficha
técnica. O menu pedido reflete a separação, e a tela fica melhor dividida.

**As permissões existentes são reaproveitadas.** Matérias-primas usa a permissão
`produtos`; as quatro telas de Vendas usam `pedidos`. Nenhuma migração de banco,
ninguém perde acesso. Uma categoria só aparece se o usuário enxerga pelo menos um
item dela; categoria vazia não renderiza cabeçalho órfão.

**Accordion, não flyout nem barra horizontal.** O accordion mantém a sidebar
existente, exige a menor mudança de CSS e funciona em telas estreitas sem precisar
de fallback de toque.

**As abas internas ficam.** `ProducaoTabs` e `PontoTabs` continuam existindo: a
sidebar navega entre módulos, as abas navegam dentro de um módulo. Há alguma
redundância, mas removê-las agora seria churn sem ganho.

**`/producoes/nova` fica fora da sidebar.** Continua acessível pela tela de
Produção Interna. Sete itens já é bastante para a categoria Produção.

**Financeiro fica como link direto, não como grupo.** Tem uma tela só
(`/financeiro/contas-a-pagar`); vira grupo quando ganhar uma segunda.

## Estrutura do menu

| Grupo | Item | Rota | Permissão |
|---|---|---|---|
| — | Dashboard | `/` | nenhuma |
| Cadastros | Clientes | `/clientes` | `clientes` |
| Cadastros | Fornecedores | `/fornecedores` | `fornecedores` |
| Cadastros | Produtos | `/produtos` | `produtos` |
| Cadastros | Matéria-prima / Insumos | `/materias-primas` (nova) | `produtos` |
| Produção | Visão Geral | `/producoes` | `producoes` |
| Produção | Recebimento | `/recebimentos` | `recebimentos` |
| Produção | Defumação | `/producoes/completa` | `producoes` |
| Produção | Produção Interna | `/producoes/internas` | `producoes` |
| Produção | Estoque | `/estoque` | `estoque` |
| Produção | Relatório de Validades | `/producoes/validades` | `producoes` |
| Produção | Histórico de Produção | `/producoes/historico` | `producoes` |
| Vendas | Pedidos (Food Services) | `/pedidos` | `pedidos` |
| Vendas | Importação Steakhouse/Afya | `/vendas/importacao` (nova, stub) | `pedidos` |
| Vendas | Vendas Buffet | `/vendas/buffet` (nova, stub) | `pedidos` |
| Vendas | Vendas Burguer (iFood) | `/vendas/burguer` (nova, stub) | `pedidos` |
| — | Financeiro | `/financeiro/contas-a-pagar` | `financeiro` |
| RH | Painel do gestor | `/ponto/painel` | `ponto` |
| RH | Colaboradores | `/ponto/colaboradores` | `ponto` |
| RH | Marcações | `/ponto/marcacoes` | `ponto` |
| RH | Escalas | `/ponto/escalas` | `ponto` |
| RH | Apuração | `/ponto/apuracao` | `ponto` |
| RH | Fechamento | `/ponto/fechamento` | `ponto` |
| RH | Unidades e empregadores | `/ponto/unidades` | `ponto` |
| RH | Dispositivos | `/ponto/dispositivos` | `ponto` |
| — | Relatórios | `/relatorios` | `relatorios` |

Ícones: Cadastros `▤`, Produção `▨`, Vendas `▩`, Financeiro `◈`, RH `◔`,
Relatórios `▢`, Dashboard `◆`. São os mesmos já usados em `MODULOS`.

## Arquitetura

### `lib/menu.js` (novo)

Fonte única da estrutura de navegação, separada do catálogo de permissões.

```js
export const MENU = [
  { tipo: 'link',  id: 'dashboard', label: 'Dashboard', href: '/', ic: '◆', exato: true },
  { tipo: 'grupo', id: 'cadastros', label: 'Cadastros', ic: '▤', itens: [
      { label: 'Clientes', href: '/clientes', modulo: 'clientes' },
      // ...
  ]},
  // ...
];
```

Ids das entradas de topo, na ordem: `dashboard`, `cadastros`, `producao`, `vendas`,
`financeiro`, `rh`, `relatorios`. `dashboard`, `financeiro` e `relatorios` são do
tipo `link`; os demais são do tipo `grupo`.

Campos: `tipo` é `'link'` ou `'grupo'`. Itens de menu têm `label`, `href`, `modulo`
e opcionalmente `exato` (quando o item ativo deve casar por igualdade e não por
prefixo — o caso de `/producoes`, que é prefixo de `/producoes/completa`). Links de
topo com `modulo` ausente ou nulo são visíveis para qualquer usuário logado.

Funções exportadas, todas puras:

- `menuVisivel(permissoes, isAdmin)` — devolve o MENU filtrado. Um item aparece se
  `isAdmin` for verdadeiro, se seu `modulo` for nulo, ou se `permissoes` contiver
  seu `modulo`. Um grupo aparece apenas se sobrar pelo menos um item.
- `grupoDaRota(pathname)` — devolve o `id` do grupo que contém a rota atual, ou
  `null`. Usada para abrir o grupo certo por padrão.
- `itemAtivo(item, pathname)` — devolve se o item é o ativo, respeitando `exato`.

### `lib/auth.js` (inalterado)

`MODULOS` continua existindo com a mesma forma e os mesmos ids. Passa a ser apenas
o catálogo de permissões, consumido pelos checkboxes da tela de Acesso. O import de
`MODULOS` em `AppShell.js` sai.

### `components/SidebarNav.js` (novo)

Client component com o accordion. Recebe `permissoes` e `isAdmin` como props.

- Renderiza `menuVisivel(permissoes, isAdmin)`.
- Estado dos grupos abertos em `localStorage`, chave `menuGruposAbertos`, guardando
  um array de ids. Vários grupos podem ficar abertos ao mesmo tempo.
- Na primeira renderização, o grupo devolvido por `grupoDaRota(pathname)` é
  incluído nos abertos, mesmo que o localStorage não o tenha.
- O toggle de grupo é um `<button>` com `aria-expanded` e `aria-controls`; os itens
  são `<a>` dentro do container controlado. Navegação por teclado funciona sem
  handler extra.
- Um grupo fechado que contém a rota ativa recebe destaque visual no toggle.

Como o estado inicial depende de `localStorage`, o componente lê a chave em
`useEffect` e não durante a renderização, evitando divergência de hidratação com o
SSR do Next.

### `components/AppShell.js`

Perde o `MODULOS.filter` e o `<nav>` inline (cerca de quinze linhas) e passa a
renderizar `<SidebarNav permissoes={permissoes} isAdmin={isAdmin} />`. Todo o resto
— seletor de empresa, badge de usuário, botão Sair, topbar — fica igual.

### `app/globals.css`

Acrescenta, na vizinhança de `.sidebar nav` (linha 41):

- `.nav-grupo-toggle` — mesma aparência de `.sidebar nav a`, com o chevron alinhado
  à direita e rotação por transform quando aberto.
- `.nav-sub` — container dos itens do grupo, com indentação e fonte um ponto menor.
- `.nav-grupo-toggle.tem-ativo` — destaque leve para grupo fechado com rota ativa.

Usa as variáveis de cor já existentes (`--char3`, `--smoke`, `--amber-bright`).
Nenhuma cor nova.

### Separação de matéria-prima

`app/materias-primas/page.js` (novo, cerca de 110 linhas) recebe o painel
"Matérias-primas cadastradas" de `app/produtos/page.js` (o bloco de JSX que hoje
começa em torno da linha 161) junto com os handlers `addMP` e `delMP`, o estado
`formMP`, a constante `MP_VAZIA` e a query de `materias_primas`. Usa
`AppShell modulo="produtos"` com título "Matéria-prima e insumos".

`app/produtos/page.js` perde esse painel, o `formMP`, os handlers e a constante,
caindo para cerca de 200 linhas. **Mantém a query de `materias_primas` e o estado
`mps`**: a ficha técnica precisa da lista para o select de matéria-prima e para
`custoTeorico`.

### Stubs de Vendas

`app/vendas/importacao/page.js`, `app/vendas/buffet/page.js` e
`app/vendas/burguer/page.js`. Cada um usa `AppShell modulo="pedidos"` e renderiza um
`.panel` com o texto do que a tela vai fazer e a indicação de que está em
construção. Cerca de vinte linhas cada.

### Renomeação para Defumação

Três pontos: o `label` em `lib/menu.js`, a aba em `components/ProducaoTabs.js:9` e o
`titulo` de `app/producoes/completa/page.js`. A rota e o comportamento não mudam.

## Testes

`tests/menu.test.mjs`, rodando com `npm test` (`node --test tests/*.test.mjs`).
Todas as funções sob teste são puras e não importam React nem Supabase, seguindo o
padrão de `tests/producao.test.mjs`.

- `menuVisivel` com permissões `['producoes']` devolve apenas o grupo Produção com
  os itens de permissão `producoes`, sem Recebimento nem Estoque.
- `menuVisivel` sem a permissão `pedidos` não devolve o grupo Vendas.
- `menuVisivel` com `isAdmin` verdadeiro devolve todos os grupos e todos os itens.
- `menuVisivel` sem permissão nenhuma ainda devolve o link Dashboard.
- Todo `href` do MENU corresponde a um `page.js` existente sob `app/` (o teste
  monta o caminho e usa `fs.existsSync`).
- Todo `modulo` citado no MENU existe como `id` em `MODULOS`.
- `grupoDaRota('/producoes/completa')` devolve `'producao'`;
  `grupoDaRota('/login')` devolve `null`.
- `itemAtivo` com `exato` distingue `/producoes` de `/producoes/completa`.

Verificação manual complementar, no navegador: expandir e recolher grupos, recarregar
a página e confirmar que os grupos abertos foram preservados, e navegar direto para
`/ponto/escalas` confirmando que o grupo RH abre sozinho.

## Riscos

O risco real está na separação de `app/produtos/page.js`: mover o painel de
matéria-prima sem levar junto o estado e os handlers, ou remover a query de
`materias_primas` que a ficha técnica ainda usa. A mitigação é conferir a tela de
Produtos depois da separação, criando um produto com ficha técnica.

O risco secundário é divergência de hidratação no `SidebarNav`, se o localStorage
for lido durante a renderização em vez de em `useEffect`.
