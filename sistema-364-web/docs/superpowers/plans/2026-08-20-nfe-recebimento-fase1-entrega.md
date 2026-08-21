# Fase 1 da importação de NF-e — o que falta fazer à mão

A fase 1 está implementada, revisada e commitada no branch `worktree-nfe-recebimento-fase1`.
O que segue só pode ser feito por quem tem acesso ao Supabase de produção.

Plano completo: `2026-08-20-nfe-recebimento.md`. Spec: `../specs/2026-08-20-nfe-recebimento-design.md`.

Estado do código: 57 testes passando, `next build` limpo. Nada foi executado contra banco.

## 1. Rodar a migração 21

`supabase/atualizacao_21_nfe_documentos.sql`, no SQL Editor. Cria `nfe_documentos`,
`nfe_sefaz_estado` e `fornecedor_produto_mapa`, e acrescenta `nfe_chave` e
`nfe_documento_id` em `recebimentos`. É aditiva, idempotente e roda dentro de uma
transação — não mexe em nenhum dado existente.

Conferir depois:

```sql
select table_name from information_schema.tables
where table_schema = 'public'
  and table_name in ('nfe_documentos', 'nfe_sefaz_estado', 'fornecedor_produto_mapa');
```

## 2. Antes da migração 22: fazer backup e olhar os duplicados

**A migração 22 apaga linhas.** Ela normaliza `fornecedores.cnpj` para só dígitos e,
quando isso faz dois cadastros do mesmo fornecedor virarem o mesmo CNPJ, funde os dois:
mantém o mais antigo, repõe os vínculos (recebimentos, contas a pagar) para ele e apaga
o mais novo. O `nome`, `categoria`, `contato`, `telefone` e `email` do cadastro mais novo
são perdidos. Isso é irreversível.

Faça backup e, antes, veja exatamente o que será fundido:

```sql
select empresa_id,
       nullif(regexp_replace(cnpj, '\D', '', 'g'), '') as cnpj_normalizado,
       count(*),
       array_agg(nome order by created_at) as nomes
from fornecedores
where cnpj is not null
group by 1, 2
having count(*) > 1;
```

O primeiro nome de cada linha é o que sobrevive; os demais serão apagados. Se algum
cadastro mais novo tiver dados melhores (telefone, e-mail), copie para o mais antigo
antes de rodar.

Se a lista vier vazia, não há fusão a fazer e a migração só normaliza a pontuação.

## 3. Rodar a migração 22

`supabase/atualizacao_22_fornecedor_cnpj_normalizado.sql`. Roda dentro de uma transação:
se qualquer coisa falhar, nada é aplicado. Ela aborta de propósito, com mensagem em
português, se encontrar uma chave estrangeira composta apontando para `fornecedores` —
nesse caso a fusão precisa ser feita à mão antes.

Rode com ninguém salvando recebimento no momento: ela pega lock pesado em `fornecedores`.

## 4. Preencher `empresas.cnpj`

Hoje a coluna está nula. Enquanto estiver, a trava que recusa nota emitida para outra
empresa **não funciona** — ela não bloqueia quando não tem com o que comparar.

```sql
update empresas set cnpj = '<só os 14 dígitos>' where slug = '<slug da empresa>';
```

## 5. Teste manual no navegador

Nada da fase 1 foi exercitado contra banco nem contra tela. Vale percorrer:

- importar o XML de uma nota real de fornecedor conhecido;
- conferir um item: escolher matéria-prima, ajustar o fator, pesar, adicionar;
- trocar a matéria-prima no meio de uma conferência, e cancelar uma conferência;
- remover um item já montado e ver se ele volta para a fila;
- descartar a nota importada;
- registrar e conferir o lote, o custo e as parcelas geradas;
- importar uma segunda nota do mesmo fornecedor e ver se os itens já vêm casados;
- tentar lançar a mesma nota duas vezes.

## Limitação aceita conscientemente

Em nota com frete, IPI ou ST, as parcelas vêm dos vencimentos reais da nota (somando o
total da NF-e), enquanto `contas_a_pagar.valor_total` guarda só o valor das mercadorias.
O pagamento sai certo — a tela de contas a pagar é orientada a parcela — mas o total do
cabeçalho fica menor que o da nota.
