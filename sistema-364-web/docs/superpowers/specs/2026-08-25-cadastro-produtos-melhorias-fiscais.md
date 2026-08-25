# Cadastro de Produtos — Melhorias pontuais (spec Consumer, escopo cortado)

## Origem

O usuário pediu ao ChatGPT uma especificação UX completa do cadastro de produtos,
usando o sistema Consumer (PDV) como referência de organização (não de visual).
A spec original tinha 6 abas (Principal, Estoque, Fiscal, Ficha Técnica,
Perguntas, Complementos) e ~15 melhorias. Depois de mapear o código atual
(`app/produtos/page.js`, `components/ProdutoFiscal.js`,
`components/ConfiguracaoFiscalModal.js`, `components/RegraTributariaForm.js`,
`supabase/atualizacao_36_cadastro_fiscal.sql`) e comparar com a spec, o usuário
cortou o que não se aplica ao nosso sistema hoje.

## Fora de escopo (cortado pelo usuário em 2026-08-25)

- Aba Estoque inteira (controle, unidade, mín/máx, local, histórico de
  movimentações) — sistema não tem controle de estoque hoje, fora do momento.
- Aba Perguntas — não existe, não é prioridade agora.
- Aba Complementos — não existe, não é prioridade agora.
- Campo Descrição do produto (cardápio/QR/pedido online) — não necessário hoje.
- Imagem do produto — não necessário hoje.
- Taxa de serviço (checkbox de isenção por item) — não necessário hoje.
- Código personalizado (PDV) — `produtos.codigo` já cobre o caso de uso, sem
  necessidade de campo novo.

## Decisões já tomadas nesta análise

**Custo concorrente (spec Bloco C):** não precisa de mudança de schema.
`produtos.custo_unitario` já é coluna única — o problema é só de UX: hoje
existem *dois pontos de edição* do mesmo campo (input na aba Geral +
`prompt()` nativo no banner "Custo em uso" da Ficha Técnica, ambos em
`app/produtos/page.js`). Decisão: edição só na aba Geral; a Ficha Técnica
passa a ser somente leitura ali.

**IBS/CBS (spec seção 13):** adiado. `produtos.cclasstrib`/`cst_ibs_cbs` e
`regras_tributarias.cclasstrib`/`cst_ibs_cbs` já existem, reservados desde a
migração 36 (`supabase/atualizacao_36_cadastro_fiscal.sql:519-520`). A tabela
`tabela_cclasstrib` nasce vazia de propósito — comentário no próprio SQL
(linha 159) documenta que só passa a valer a partir de 04/01/2027, quando a
Receita publica os códigos oficiais e a rejeição por falta do grupo IBSCBS
alcança o CRT 1. Não construir UI/estrutura nova agora; revisitar mais perto
da data.

**`sujeito_st` vs `regras_tributarias.st_responsavel`:** mantém os dois
campos (não remove — pode estar em uso na checagem de pendências fiscais e
na emissão; regra do usuário é não remover campo fiscal sem checar uso em
NFC-e/NF-e primeiro). `ProdutoFiscal.js` já tem texto de ajuda explicando a
diferença (linha 105-107); só reforça a redação.

## Escopo confirmado (8 → efetivamente 6 mudanças de produto, ver plano)

1. Custo — um único ponto de edição (aba Geral).
2. Texto do `sujeito_st` mais claro sobre ser indicativo de cadastro.
3. Barra gráfica de % de custo por insumo na Ficha Técnica.
4. Cabeçalho persistente do produto (código, nome, status, última
   alteração, usuário) — **precisa de migration**: `produtos` não tem
   `updated_at` nem rastro de quem alterou por último (só tem
   `revisado_por_id`/`revisado_em`, específicos da liberação fiscal).
5. Botão Salvar único, fixo, nas três abas (hoje cada aba tem o próprio
   formulário e o próprio submit).
6. Duplicar produto, com diálogo seletivo (Principal sempre / Fiscal
   opcional / Ficha técnica opcional — sem Estoque, que saiu do escopo).
7. Copiar configuração fiscal de outro produto (busca + confirmação antes
   de aplicar).

Ver plano de execução: `docs/superpowers/plans/2026-08-25-cadastro-produtos-melhorias-fiscais.md`.
