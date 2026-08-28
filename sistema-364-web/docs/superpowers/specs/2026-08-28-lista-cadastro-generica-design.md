# ListaCadastro genérico: colunas redimensionáveis, escondíveis, ordenáveis e paginação

Data: 2026-08-28

## Motivação

A tela de Produtos ganhou (nesta mesma sessão) redimensionar coluna, esconder
coluna, ordenar por clique no título e paginação — tudo escrito à mão dentro
de `app/produtos/page.js`, direto sobre `.registro-lista`/`.registro-cabecalho`.
O usuário pediu para levar esse mesmo controle para todas as telas do sistema
que mostram lista de dados.

Levantamento: ~20 telas sob `app/` renderizam lista/tabela de registros. Só
duas usam o componente compartilhado `components/ListaCadastro.js` (Produtos,
que na verdade não usa — tem markup próprio — e Clientes, que usa). As outras
~18 (financeiro, ponto, produção, recebimentos, etc.) são `<table>` cru, cada
uma com seu próprio JSX de linha. Nenhuma tela usa paginação real no banco
(`.range()` do Supabase não aparece em lugar nenhum); onde existe limite é
`.limit(N)` fixo (300, 500...), não controlado pelo usuário. A tela de maior
volume hoje (recebimentos) fica na casa de algumas centenas de linhas —
cabe em memória sem paginação no servidor.

Dado o tamanho do trabalho, este projeto cobre só a **primeira fase**:
generalizar `ListaCadastro.js` para ganhar as quatro capacidades, e migrar as
duas telas que já deveriam usá-lo (Produtos e Clientes) para prová-lo. As
outras ~18 telas ficam para fases seguintes, uma spec por leva.

## Não-objetivos desta fase

- Migrar as telas com `<table>` cru (financeiro, ponto, produção, etc.).
- Paginação do lado do servidor (`.range()`) — client-side continua
  suficiente nos volumes atuais.
- Preservar o reflow de "cartão em duas linhas" que a tela de Produtos tem
  hoje no celular (ver seção Mobile).

## Formato de coluna (estende o atual)

Hoje (`ListaCadastro.js`): `{ titulo, largura, principal, minimo, render,
mono, alinhamento, textoPuro }`. Continua igual, mais estes campos, todos
opcionais:

- `id` — chave estável da coluna. **Passa a ser obrigatório** (troca `titulo`
  como `key` do React e vira a chave de estado — largura/visibilidade
  guardadas por `id`, não por `titulo`, porque rótulo muda e a preferência
  salva não pode quebrar por isso).
- `ordenavel: boolean` — habilita clique no título para ordenar.
- `valor: (registro) => string | number` — valor comparável para a ordenação
  (não precisa ser o que `render` desenha; ex.: `render` mostra "R$ 45,50",
  `valor` retorna `45.5`). Obrigatório se `ordenavel` for true.
- `escondivel: boolean` (default `false`) — coluna pode ser tirada do menu de
  colunas visíveis. Colunas fixas (ex.: nome/identificador principal) ficam
  de fora do menu.
- `larguraMax` — teto do redimensionamento (default: `largura * 3`, limitado
  a 400).

`principal` continua sendo a única coluna flexível (a que preenche o espaço
sobrando) — não fica redimensionável nem escondível, mesma regra de hoje.

## Props do componente

```
<ListaCadastro
  chave="produtos"          // novo, obrigatório: prefixo das chaves de localStorage
  colunas={COLUNAS}
  registros={visiveis}      // a tela continua filtrando por busca/status antes
  selecionado={selecionado}
  onAbrir={abrir}
  vazio="Nenhum produto cadastrado ainda."
  rotulo="Produtos"
  tamanhosPagina={[25, 50, 100, 200]}  // opcional, valor default já é este
  larguraMaxima={1200}                  // opcional, valor default já é este
/>
```

`chave` namespacea o `localStorage`: `${chave}:colunas:largura`,
`${chave}:colunas:visiveis`, `${chave}:paginacao:tamanho` — mesmo padrão que
Produtos já usa hoje, só que parametrizado por tela em vez de fixo.

## Estado interno

Migra para dentro do componente o que hoje mora em `app/produtos/page.js`:
larguras por coluna, visibilidade por coluna, ordenação (`{campo, direcao}`),
página atual e tamanho de página — com o mesmo cuidado de hidratação que já
existe lá (lê do `localStorage` só depois do primeiro render, para não
quebrar SSR, e só grava depois de ter lido, para não sobrescrever a
preferência salva com o valor padrão).

Filtro de busca/status continua sendo responsabilidade de cada tela (ela já
filtra antes de passar `registros`) — o componente não sabe o que é "ativo"
ou "inativo" de cada domínio, só recebe a lista já filtrada e cuida da
mecânica de exibição (largura, visibilidade, ordem, página).

Se `registros.length` for menor ou igual ao menor valor de `tamanhosPagina`,
a barra de paginação não aparece — evita poluir listas pequenas com
"Página 1 de 1".

## Mobile

A tela de Produtos hoje tem um `@media(max-width:900px)` específico que
transforma cada linha num cartão de duas alturas (nome em cima, valores
embaixo), amarrado às classes `.codigo`/`.nome`/`.tag`/`.valores` dela. Isso
não generaliza para configuração de coluna arbitrária de outras telas.

Troca por scroll horizontal (`.table-wrap{overflow-x:auto}`, padrão já usado
em outras telas do sistema): funciona igual para qualquer conjunto de
colunas, ao custo de uma tela levemente menos elegante no celular do que o
cartão sob medida que Produtos tem hoje. O hack de grid específico de
Produtos é removido do `globals.css`.

## Migração nesta fase

**Clientes** (`app/clientes/page.js`): troca no array `COLUNAS` — adiciona
`id` em cada coluna (usa a versão em minúsculas do `titulo` atual, ex.:
`nome`, `papel`, `documento`, `municipio`, `contato`, `telefone`, `nota`),
marca `escondivel: true` nas colunas não-essenciais, adiciona `chave="clientes"`
na chamada do componente. Sem `ordenavel` nesta migração (nenhuma pediu),
pode entrar depois sem quebrar nada.

**Produtos** (`app/produtos/page.js`): troca o JSX escrito à mão nesta sessão
(`celulaCabecalho`, `iniciarRedimensionar`, `colunaVisivel`, os efeitos de
`localStorage`, o cálculo de `linhas`/`linhasOrdenadas`/paginação — tudo isso
sai da página e entra no componente) por um array `COLUNAS` no mesmo formato
de Clientes, mais `<ListaCadastro chave="produtos" .../>`. Resultado: a
página volta a ficar só com a lógica de domínio (busca, filtro de status,
cálculo de custo/margem por produto), sem duplicar mecânica de UI.

## Teste

Sem suíte automatizada de UI no projeto (confirma em `package.json` /
`tests/`) — verificação manual no browser depois da migração, nas duas
telas: redimensionar, esconder coluna, ordenar (crescente/decrescente),
paginar (incluindo "Todos"), e comparar visualmente que Produtos não mudou
de comportamento em relação ao que está em produção agora.
