# Classificação da Demanda — Atlas 364

## Frase-Problema
Gustavo quer transformar a ficha técnica de produtos da 364 Food Services em um sistema de precificação e
vendas estruturado: revisar a margem de lucro por produto, organizar o processo comercial e criar uma
projeção de vendas com três canais — varejo, atacado e um novo plano de assinaturas.

## Empresa/Unidade Envolvida
364 Food Services (central de produção de defumados/processados) — identificada explicitamente pelo caminho
do arquivo compartilhado ("364 food services/Planilhas/FICHA TECNICA FOOD SERVICE.xlsx") e pelo conteúdo
(custos de produção, fichas técnicas, códigos de produto e projeção de vendas de itens defumados/processados).

## Classificação
- Categoria(s): **financeira, comercial, produção**
- Justificativa:
  - **Financeira**: a planilha já calcula CMV, lucro e % de lucro por produto e por canal; a demanda pede
    análise e reorganização da margem de lucro.
  - **Comercial**: a demanda pede explicitamente projeção de vendas por canal (varejo, atacado) e a criação
    de um novo canal — plano de assinaturas — que hoje não existe na planilha.
  - **Produção**: os custos de produção (matéria-prima, perda, rendimento, custo de embalagem, custo
    operacional fixo) são a base de todo o cálculo de margem e precisam ser validados antes de qualquer
    reprecificação.

## Dados Já Mencionados na Solicitação
Planilha `FICHA TECNICA FOOD SERVICE.xlsx` (dado real, fornecida por Gustavo), com 5 abas:

- **INF NUTRICIONAL** — ficha técnica de ingredientes/rendimento/custo de 1 produto (Costela Suína Defumada)
  e template de rotulagem nutricional (valores nutricionais ainda não preenchidos).
- **CUSTOS PRODUÇÃO** — custo de compra, peso, perda, sobra, rendimento cru/defumado, custo final por KG,
  custo de temperos e embalagem, valor de revenda, CMV e lucro para 13 produtos (Costela Bovina 1 e 2,
  Costela Desfiada, Cupim, Panceta 1 e 2, Costelinha BBQ 1-4, Croquete, Escondidinho, Hambúrguer 140g), mais
  Farofa Crocante e Chutney de Abacaxi (sem custo de venda definido). Também lista custos fixos mensais:
  Aluguel R$1.000, Energia R$1.500, Mão de Obra R$3.600, Impostos R$10.395, Temperos R$200, Carvão R$900,
  Butcher Paper R$1.600 — total de Custo Operacional R$19.195/mês. Há um comparativo varejo vs. atacado para
  panceta e costelinha, com lucro de 52,0% (varejo) e 37,6% (atacado) somado, **excluindo despesas fixas e
  operacionais** (nota explícita na planilha).
- **PROJEÇÃO DE VENDAS** — projeção mensal para 8 produtos com código SKU (0364-001 a 0364-008), com preço
  de atacado e varejo, CMV por canal, e projeção mensal de faturamento (R$103.950) e lucro (R$41.265 bruto /
  R$22.070 "lucro real", provavelmente após custos fixos — não há fórmula explícita ligando os dois números
  na planilha). Dois SKUs (Farofa Crocante 0364-009, Chutney/Geleia de Abacaxi 0364-010) aparecem com erro
  de fórmula (`#VALUE!`, `#DIV/0!`) por falta de preço de venda cadastrado.
- **CUSTO EMBALAGEM** — cotações de embalagens (potes, etiquetas, cintas, caixa) em 4 fornecedores
  (Nasapan, Mercado Livre, Ouropa, Líder, JCD Embalagens, Tuicial), com custo unitário consolidado por tipo
  de embalagem usado no cálculo de custo final dos produtos.
- **CODIGOS** — tabela mestre de 10 SKUs (0364-001 a 0364-010) com nome de produto, código interno e
  código de barras EAN. Colunas de custo/distribuição/venda/CMV desta aba estão vazias (dados não fornecidos).

## Pendências de Esclarecimento
Nenhuma pendência sobre a empresa envolvida — 364 Food Services está clara pelo contexto do arquivo e
pelo conteúdo da planilha.

Pendências sobre escopo, a confirmar com Gustavo antes da consolidação final:
1. **Plano de assinaturas**: não existe estrutura, preço nem regra de recorrência hoje — precisa ser
   desenhado do zero (periodicidade, mix de produtos, desconto vs. varejo/atacado, política de cancelamento).
2. **2 SKUs sem precificação** (Farofa Crocante 0364-009, Geléia/Chutney de Abacaxi 0364-010) — custo de
   produção parcial existe (R$17,50 e R$11,40 respectivamente), mas não há preço de venda definido.
3. **Divergência entre "Lucro" (R$41.265) e "Lucro Real" (R$22.070)** na aba Projeção de Vendas — a
   planilha não explicita a fórmula; presume-se que a diferença (R$19.195) seja o desconto do Custo
   Operacional fixo mensal, mas isso precisa ser confirmado antes de ser usado como dado real na análise.
4. **"Organizar os processos para venda"** é uma frase ampla — pode envolver política comercial (regras de
   desconto atacado, mínimo de pedido), operação de vendas (quem vende, canais de contato) ou ambos;
   o escopo exato será refinado no plano de ação, sinalizado como P1/P2 conforme impacto.
