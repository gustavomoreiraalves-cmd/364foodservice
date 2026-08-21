# Edição e desativação nos cadastros

Data: 2026-08-21
Status: aprovado, aguardando plano de implementação

## Problema

As quatro telas de cadastro — clientes, fornecedores, produtos e matérias-primas —
só sabem criar, listar e excluir. Um cadastro com um erro de digitação, um telefone
que mudou ou uma categoria escolhida errada não tem conserto pela interface.

E excluir raramente funciona: assim que o registro tem movimento (um pedido, um
recebimento, uma produção), a chave estrangeira barra a exclusão e a tela mostra
"pode haver pedidos vinculados". Na prática o usuário fica com o cadastro errado
para sempre, ou cria um segundo cadastro certo e convive com os dois.

## Escopo

Dentro:

- Editar os campos de cadastro nas quatro telas, pelo formulário que já existe no topo.
- Ativar e desativar registro, em vez de depender só da exclusão.
- Tornar editáveis os campos-base do produto (nome, categoria, unidade, preço de
  venda, validade em dias), que hoje só podem ser definidos na criação.

Fora (o usuário decidiu explicitamente não incluir agora):

- Expor as regras de recebimento da matéria-prima (`controle_recebimento`,
  `exige_temperatura`, `exige_inspecao`, `exige_foto`, `exige_documento_sanitario`,
  `dias_minimos_validade`, `estoque_minimo`, `deposito_padrao_id`). Elas existem no
  banco, governam o que o Recebimento cobra na entrada, e hoje só mudam por SQL —
  fica registrado como a próxima melhoria natural destas telas.
- Máscara de CNPJ no cliente. O fornecedor já foi normalizado na fase 1 da NF-e; o
  cliente continua texto livre.
- Histórico de quem alterou o quê.

## Arquitetura

### 1. Banco

Migração 24: `clientes`, `fornecedores` e `produtos` ganham
`ativo boolean not null default true`. `materias_primas` já tem a coluna, e o
Recebimento já filtra por ela. Aditiva, idempotente, dentro de uma transação, sem
mexer em RLS.

O plano da NF-e reservava o número 24 para a tabela do certificado digital da fase 2.
Essa reserva sai: reservar número para trabalho não feito foi o que obrigou a
renumerar as migrações da fase 1 no merge. O certificado toma o próximo número livre
quando a fase 2 for implementada.

### 2. Peça compartilhada — `lib/cadastro.js`

As quatro telas têm a mesma estrutura e vão precisar do mesmo comportamento, então a
lógica fica em um lugar só:

- `camposDoFormulario(registro, formVazio)` — devolve apenas as chaves presentes em
  `formVazio`, com `null` convertido para `''`. É o que o React precisa para um input
  controlado, e é a parte pura que os testes cobrem.
- `useCadastro({ tabela, formVazio, empresaId, aoSalvar })` — hook que expõe `form`,
  `setForm`, `editando`, `iniciarEdicao`, `cancelarEdicao`, `salvar`, `alternarAtivo`
  e `excluir`. `salvar` escolhe entre `insert` e `update` conforme `editando`.

Produtos não usa o hook inteiro — a tela tem ficha técnica e regras de validade
próprias — mas usa `camposDoFormulario` e segue a mesma convenção de botões.

### 3. Interface

O painel do topo muda de título conforme o estado: "Novo cliente" ou
"Editando: Padaria do Zé". Em edição, o botão principal vira "Salvar alterações" e
aparece um "Cancelar" ao lado. Clicar em Editar rola a página até o formulário — sem
isso, em lista longa, o clique parece não ter surtido efeito.

Cada linha da tabela ganha "Editar", "Desativar" (ou "Reativar") e mantém "Excluir".
Acima da tabela, uma caixa "Mostrar inativos", desmarcada por padrão. Registro inativo
aparece esmaecido e com uma tag "inativo".

### 4. Onde o inativo desaparece

Some das listas de seleção:

| entidade | telas |
| --- | --- |
| cliente | Pedidos |
| fornecedor | Recebimento, criação de conta a pagar |
| produto | Pedidos, Produção nova, Produção completa |
| matéria-prima | ficha técnica em Produtos, Produção completa (Recebimento já filtra) |

Não desaparece de Relatórios, do histórico de contas a pagar nem do dashboard —
desativar não reescreve o passado.

Exceção deliberada: a rota `/api/nfe/documentos/[chave]/preparar` casa fornecedor por
CNPJ e continua encontrando fornecedor inativo. Se ignorasse o inativo, a tela pediria
para cadastrar de novo e produziria o fornecedor duplicado que a migração 23 acabou de
limpar.

### 5. Casos de borda

Excluir continua disponível para cadastro criado por engano e continua falhando quando
há movimento vinculado — a mensagem passa a sugerir desativar. Editar não altera nada
já lançado: recebimento, pedido e produção guardam os próprios valores no momento do
lançamento. O código do produto (`0364-XXX`) não é editável, por ser a chave impressa
em etiqueta.

### 6. Testes

`tests/cadastro.test.mjs` cobre `camposDoFormulario`: converte `null` para `''`,
ignora coluna que não existe no formulário, não inventa chave ausente, e preserva
`false` e `0` (que são valores legítimos, não vazios).

O restante é interface, e o repositório não tem harness de componente React. A
verificação é `npm run verify` mais o teste manual.

## Decisões registradas

| decisão | escolha |
| --- | --- |
| Forma de editar | Reaproveitar o formulário do topo, como na conferência de item do Recebimento |
| Remoção | Desativar como caminho normal; excluir só para engano |
| Produto | Campos-base passam a ser editáveis |
| Regras de recebimento da matéria-prima | Fora desta entrega |
| Máscara de CNPJ no cliente | Fora desta entrega |
