# Contas a Pagar → base analítica para DRE gerencial e BI

Data: 2026-08-26
Status: proposta (nenhuma migração escrita ainda)

## 1. O que existe hoje

Levantamento feito no repositório e na produção antes de propor qualquer coisa.

**Tabelas (migração 16):**

- `contas_a_pagar`: `descricao`, `categoria_conta` (check de 4 valores fixos: Custos Fixos, Custos Diretos, Custos Variáveis, Investimentos), `fornecedor_id`, `recebimento_id`, `nota_fiscal_numero`, `nota_fiscal_anexo_path`, `valor_total`, `responsavel_id`, `empresa_id`, `created_at`.
- `contas_a_pagar_parcelas`: `numero`, `valor`, `vencimento`, `status` (Pendente/Pago), `data_pagamento`, `forma_pagamento` (texto livre), `comprovante_path`.

**Estado da produção:** `contas_a_pagar` e `contas_a_pagar_parcelas` estão **vazias** (consulta em 26/08/2026). Não há dado histórico a preservar — esta é a janela para redesenhar o modelo sem migração de dados nem período de convivência.

**Consumidores atuais de `categoria_conta` / `CATEGORIAS_CONTA`:**

- `lib/financeiro.js` (lista fixa, `gerarParcelas`, `isVencida`)
- `app/financeiro/contas-a-pagar/page.js` (formulário e filtros)
- `app/recebimentos/page.js` (gera conta a pagar a partir do recebimento)
- `app/api/financeiro/conciliacao/route.js`, `lib/extratosServer.js`, `components/AcoesConciliacao.js` (o motor de conciliação já aprende `padrao → fornecedor + categoria_conta` em `conciliacao_padroes`)
- fixtures/cenários das migrações 21 e 35

**O que já está pronto e deve ser reaproveitado, não reinventado:**

- Conciliação bancária completa (migração 35): `contas_bancarias`, `extrato_importacoes`, `extrato_lancamentos`, `conciliacao_padroes` (de-para aprendido), `conciliacao_vinculos` (N:N, com `baixou_parcela`).
- Migração 45 (pendente, já escrita): contas bancárias no nível do grupo — mesmo padrão a aplicar no plano de contas.
- PDV Consumer importado (migração 32): `pdv_pedidos`, `pdv_pedido_itens`, `pdv_pagamentos` (com `forma_grupo` já normalizado em pix/credito/debito/dinheiro/ifood_online/voucher/fiado/outro e `operadora`), `pdv_caixas`, `vw_pdv_vendas_dia`, `vw_pdv_caixa_formas_dia`.
- `vw_consolidado_mensal` (migração 21) e `lib/consolidado.js`.

## 2. Diagnóstico da estrutura sugerida (a conversa com a outra IA)

O que está certo e deve ser mantido:

- Separar CMV por família de insumo (proteína / hortifruti / mercearia / bebidas / embalagem) — é a análise de margem que mais rende em restaurante.
- Separar folha por área (salão, cozinha, administrativo) — habilita custo de pessoal por ponto percentual de faturamento e por setor.
- Marcar comportamento do gasto (fixo/variável) e centro de custo.
- O alerta sobre deduções de receita (impostos, taxas de cartão, comissão de marketplace) não passarem pelo Contas a Pagar está correto e é o ponto mais importante do texto.

O que quebra na prática e precisa ser corrigido antes de virar schema:

1. **Categoria e subgrupo como lista fixa no código não escala.** Vira `check constraint` e cada conta nova exige migração. O certo é uma tabela `plano_contas` hierárquica, compartilhada no grupo, com código estruturado.
2. **Uma conta a pagar não tem uma única classificação.** Nota do distribuidor traz proteína + mercearia + descartável na mesma nota; a conta de energia serve cozinha e salão; o aluguel serve tudo. Sem rateio, o operador escolhe "a que pesa mais" e o BI nasce enviesado. Precisa de linhas de rateio (conta contábil + centro de custo + valor) por lançamento.
3. **Compra de mercadoria não é despesa do mês da compra.** Comprar 200 kg de picanha em 31/08 e vender em setembro não é custo de agosto. Sem uma natureza `estoque` separada de `despesa`, ou o CMV é contado duas vezes (compra + ficha técnica) ou o mês fica distorcido. A `vw_consolidado_mensal` hoje contorna isso excluindo contas com `recebimento_id` da despesa de competência e mostrando `compras` num campo à parte — o que funciona no dashboard atual, mas não sustenta um DRE.
4. **Competência hoje é `created_at`.** A `vw_consolidado_mensal` usa a data em que a linha foi digitada como mês de competência. Lançar em setembro a conta de energia de agosto joga o custo no mês errado. É preciso `data_competencia` explícita, separada de `data_emissao` e da data de pagamento.
5. **"Investimentos" não é linha de DRE.** Está no mesmo enum dos custos. CAPEX sai do resultado e entra no fluxo de caixa; misturar os dois derruba a margem de qualquer mês em que se compre um forno.
6. **Faltam naturezas que não são resultado:** transferência entre contas próprias, adiantamento a fornecedor, empréstimo/parcela de empréstimo (principal é caixa, juros é resultado), distribuição de lucro. Se tudo isso entra como "despesa", o DRE mente.
7. **Faltam contas do dia a dia na lista proposta:** DAS/Simples Nacional (que é *dedução de receita*, não despesa), taxas bancárias e antecipação de recebíveis, seguros, alvarás e licenças, uniformes e EPI, treinamento, música/direitos autorais (ECAD), dedetização e limpeza de caixa d'água/coifa (exigência sanitária), pró-labore separado da folha administrativa, e comissão percentual de marketplace (separada da taxa fixa de entrega).
8. **Status Pendente/Pago não cobre a realidade:** pagamento parcial, cancelamento, juros/multa por atraso e desconto por antecipação. Valor pago ≠ valor da parcela com frequência.
9. **Retenções em serviço de terceiros** (ISS, IRRF, INSS, CSRF) fazem o valor líquido pago diferir do valor da nota. Sem campos, a conciliação bancária nunca casa e o contador cobra na mão.
10. **Rateio entre empresas do grupo.** O grupo tem várias empresas e uma paga conta que serve outra. Sem isso, o resultado por empresa não fecha.

**Achado adicional, fora do escopo do texto original:** `vw_consolidado_mensal` calcula receita a partir de `pedidos`/`pedido_itens` (venda B2B). As vendas do restaurante, que vêm do PDV Consumer (`pdv_pedidos`), **não entram** na view. O dashboard do grupo hoje mostra a receita de atacado, não a do restaurante. Qualquer DRE precisa unificar as duas fontes de receita.

## 3. Modelo proposto

### 3.1 Plano de contas (nível grupo, hierárquico)

```sql
create table plano_contas (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references grupos(id),
  codigo text not null,                    -- '3.01.002'
  nome text not null,
  parent_id uuid references plano_contas(id),
  nivel int not null check (nivel between 1 and 3),
  natureza text not null check (natureza in
    ('receita','deducao','estoque','cmv','despesa','investimento','financeiro','nao_operacional','transferencia')),
  linha_dre text not null,                 -- chave da linha do DRE gerencial
  comportamento text not null default 'variavel'
    check (comportamento in ('fixo','variavel','semivariavel')),
  aceita_lancamento boolean not null default true,  -- só folha (nível 3) aceita
  ativo boolean not null default true,
  unique (grupo_id, codigo)
);
```

Regras: só nível 3 aceita lançamento; `natureza` e `linha_dre` herdam do pai no seed mas ficam materializadas na folha (a view não precisa de recursão); `comportamento` é o **padrão** da conta, sobrescrevível na linha de rateio (energia é semivariável, mas a parcela mínima é fixa).

Estrutura de níveis 1 e 2 sugerida (o seed traz o nível 3 completo):

| Código | Nível 1 | Natureza | Entra no DRE em |
|---|---|---|---|
| 1 | Receita bruta | receita | Receita bruta |
| 2 | Deduções da receita | deducao | (-) Impostos sobre venda, taxas de cartão, comissão de marketplace |
| 3 | Custo de mercadoria e insumos | estoque → cmv | (-) CMV |
| 4 | Pessoal | despesa | (-) Despesas com pessoal |
| 5 | Ocupação e utilidades | despesa | (-) Ocupação |
| 6 | Comercial e marketing | despesa | (-) Comercial |
| 7 | Administrativas e TI | despesa | (-) Administrativas |
| 8 | Financeiras | financeiro | (-) Resultado financeiro (abaixo do EBITDA) |
| 9 | Não operacional / CAPEX | investimento, nao_operacional, transferencia | fora do DRE |

Ajustes relevantes frente à lista original: DAS/Simples e taxa de cartão vão para o grupo 2 (dedução), não para despesa; compra de insumo entra como `estoque` e só vira `cmv` no consumo; pró-labore fica em 4 mas separado da folha administrativa; compra de equipamento e benfeitoria vão para 9.

### 3.2 Centros de custo

```sql
create table centros_custo (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  codigo text not null,
  nome text not null,
  tipo text not null check (tipo in ('producao','salao','delivery','administrativo','evento','outro')),
  ativo boolean not null default true,
  unique (empresa_id, codigo)
);
```

### 3.3 Contas a pagar — campos novos

Como a tabela está vazia, a migração pode redefini-la sem backfill.

```sql
alter table contas_a_pagar
  add column data_emissao date,
  add column data_competencia date not null,      -- mês do resultado
  add column tipo_documento text not null default 'outro'
    check (tipo_documento in ('nfe','nfse','cupom','boleto','recibo','fatura','folha','guia','contrato','outro')),
  add column numero_documento text,
  add column serie text,
  add column chave_nfe text,
  add column valor_bruto numeric(12,2),
  add column valor_desconto numeric(12,2) not null default 0,
  add column valor_acrescimo numeric(12,2) not null default 0,
  add column status text not null default 'aberta'
    check (status in ('aberta','parcial','quitada','cancelada')),
  add column recorrencia_id uuid references contas_recorrentes(id),
  add column observacao text;

alter table contas_a_pagar drop column categoria_conta;   -- substituída pelo rateio
```

`valor_total` continua sendo o valor da obrigação (o que se paga); `valor_bruto − valor_desconto + valor_acrescimo = valor_total`.

### 3.4 Rateio — a peça central

```sql
create table contas_a_pagar_rateios (
  id uuid primary key default gen_random_uuid(),
  conta_a_pagar_id uuid not null references contas_a_pagar(id) on delete cascade,
  plano_conta_id uuid not null references plano_contas(id),
  centro_custo_id uuid references centros_custo(id),
  empresa_id uuid not null references empresas(id),   -- empresa QUE ABSORVE o custo
  empresa_pagadora_id uuid not null references empresas(id),
  comportamento text check (comportamento in ('fixo','variavel','semivariavel')), -- null = herda da conta
  valor numeric(12,2) not null check (valor > 0),
  descricao text
);
```

Trigger `constraint trigger deferrable` validando `sum(valor) = contas_a_pagar.valor_total`. Lançamento simples cria **uma** linha de rateio automaticamente — a tela não fica mais pesada para o caso comum, e o BI sempre lê da mesma tabela (nunca dois caminhos).

Isso resolve de uma vez: nota multi-categoria, custo compartilhado entre setores e conta paga por uma empresa em nome de outra.

### 3.5 Parcelas — campos novos

```sql
alter table contas_a_pagar_parcelas
  add column conta_bancaria_id uuid references contas_bancarias(id),
  add column valor_pago numeric(12,2) not null default 0,
  add column juros numeric(12,2) not null default 0,
  add column multa numeric(12,2) not null default 0,
  add column desconto numeric(12,2) not null default 0,
  add column retencao_iss numeric(12,2) not null default 0,
  add column retencao_irrf numeric(12,2) not null default 0,
  add column retencao_inss numeric(12,2) not null default 0,
  add column retencao_csrf numeric(12,2) not null default 0;

-- status passa a: 'Pendente','Parcial','Pago','Cancelada'
```

`forma_pagamento` vira enum fechado alinhado ao vocabulário do PDV (`pix`, `boleto`, `ted`, `dinheiro`, `cartao_credito`, `cartao_debito`, `debito_automatico`). Juros e multa **não** entram na conta original: vão para uma conta do grupo 8 (financeiras) na apuração, senão o custo do insumo fica inflado pelo atraso.

### 3.6 Recorrências

```sql
create table contas_recorrentes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  descricao text not null,
  fornecedor_id uuid references fornecedores(id),
  plano_conta_id uuid not null references plano_contas(id),
  centro_custo_id uuid references centros_custo(id),
  valor_referencia numeric(12,2),
  periodicidade text not null check (periodicidade in ('mensal','bimestral','trimestral','anual')),
  dia_vencimento int not null check (dia_vencimento between 1 and 31),
  ativo boolean not null default true,
  proxima_geracao date not null
);
```

Ganho de BI: com `valor_referencia`, toda geração compara o valor real com o esperado e sinaliza variação acima de X% — é assim que se descobre vazamento de água, contrato reajustado sem aviso e cobrança duplicada de software.

### 3.7 Orçamento (orçado × realizado)

```sql
create table orcamento_mensal (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  mes text not null,                       -- 'YYYY-MM'
  plano_conta_id uuid not null references plano_contas(id),
  centro_custo_id uuid references centros_custo(id),
  valor_previsto numeric(12,2),
  percentual_receita_meta numeric(5,2),    -- meta como % do faturamento
  unique (empresa_id, mes, plano_conta_id, centro_custo_id)
);
```

Sem isso o BI só descreve o passado. Com isso ele aponta desvio — que é o que gera decisão.

### 3.8 Deduções de receita e recebíveis (o alerta da outra IA, resolvido)

Não passam por Contas a Pagar. Modelagem própria, alimentada pelo PDV já importado:

```sql
create table taxas_recebimento (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  forma_grupo text not null,               -- mesmo vocabulário de pdv_pagamentos.forma_grupo
  operadora text,
  percentual numeric(6,3) not null default 0,
  valor_fixo numeric(12,2) not null default 0,
  prazo_dias int not null default 0,
  plano_conta_id uuid not null references plano_contas(id),   -- conta do grupo 2
  vigencia_inicio date not null,
  vigencia_fim date
);
```

Com `pdv_pagamentos` (valor, `forma_grupo`, `operadora`, `pago_em`) mais essa tabela, saem de graça: dedução por competência para o DRE, previsão de recebíveis por data (D+1 débito, D+30 crédito, ciclo do iFood) e conferência contra o que de fato caiu no extrato — a conciliação bancária (migração 35) já tem o outro lado.

### 3.9 Views para o BI

- `vw_dre_mensal` — `(empresa_id, mes, linha_dre, ordem, valor_competencia, valor_caixa)`. Une receita B2B (`pedidos`) + receita PDV (`pdv_pedidos`) + deduções + CMV + rateios de despesa.
- `vw_custo_centro_mensal` — `(empresa_id, mes, centro_custo_id, plano_conta_id, comportamento, valor)`.
- `vw_fluxo_caixa_previsto` — parcelas em aberto por dia × recebíveis previstos por dia, saldo acumulado por conta bancária.
- `vw_orcado_realizado` — junta `orcamento_mensal` com o realizado por conta e centro.
- `vw_ponto_equilibrio_mensal` — usa `comportamento` para separar fixo de variável: `PE = custo_fixo / margem_contribuição_percentual`. Esse é o número que o campo fixo/variável existe para produzir.

**CMV: teórico × real.** O sistema já calcula CMV teórico (`vw_produto_custo`, ficha técnica × vendas). Com compra entrando como `estoque` e inventário periódico, dá para calcular o CMV real (`estoque inicial + compras − estoque final`). A **diferença entre os dois é quebra, desperdício e desvio** — em restaurante, é a análise de maior retorno que este modelo destrava, e nenhuma estrutura de subgrupo entrega isso sozinha.

## 4. Estoque centralizado no CD e ficha de baixa por unidade

Decisão do dono (26/08/2026): não há contagem de inventário hoje, mas será implementada. As compras dos dois CNPJs alimentam um **estoque unificado na matriz/CD**, e uma **ficha de baixa** indica qual unidade consumiu o insumo.

### 4.1 O que já existe na produção (e não está versionado no repositório)

Levantamento direto no banco de produção. Nenhuma dessas tabelas tem migração no repositório — é o caso de divergência de schema já conhecido.

| Tabela | Situação | Colunas relevantes |
|---|---|---|
| `unidades` | 8 linhas | `empresa_id`, `nome`, `tipo` (matriz/filial/operacao), `empregador_id`, endereço, `fuso` |
| `depositos` | 3 linhas, todos na unidade **CD** | `unidade_id`, `empresa_id`, `nome`, `tipo` (seco/refrigerado/congelado) |
| `stock_movements` | 6 linhas, só `entrada`, de julho/2026 | `empresa_id`, `unidade_id`, `deposito_id`, `materia_prima_id`, `lote`, `tipo`, `quantidade`, `custo_unitario`, `recebimento_item_id`, `motivo`, `responsavel_id` |
| `stock_balances` | 6 linhas | saldo por `(empresa_id, deposito_id, materia_prima_id, lote)`, com `custo_unitario` |
| `centros_custo` | **0 linhas**, tabela já existe | `empresa_id`, `unidade_id`, `nome`, `ativo` — já referenciada por `colaboradores.centro_custo_id` |
| `recebimento_itens` | em uso | já tem `lote`, `deposito_id`, `custo_unitario`, `validade`, `numero_lote_fornecedor` |

O `check` de `stock_movements.tipo` já prevê exatamente o que o modelo precisa:
`entrada`, `saida`, `transferencia_saida`, `transferencia_entrada`, `consumo`, `ajuste`, `estorno`.

**Nenhum código da aplicação escreve em `stock_movements` nem em `stock_balances`** — confirmado por busca no repositório e documentado em [lib/defumacao.js:36](lib/defumacao.js:36) ("a tabela existe em produção mas nenhum código escreve nela"). O ledger está construído e parado.

Consequência para o plano: **não se cria tabela de estoque nova.** O trabalho é (a) versionar o DDL existente numa migração, (b) ligar o recebimento ao ledger, (c) construir a ficha de baixa por cima dele. Isso reduz muito o tamanho da fase.

Correção ao item 3.2 da proposta anterior: `centros_custo` **já existe** e é por empresa, com `unidade_id` opcional — não precisa ser criada, só receber o campo `tipo` (producao/salao/delivery/administrativo) e o seed.

### 4.2 Estrutura societária real (levantada no banco)

```
CNPJ 60.361.009/0001-50 → 364 Food Service   (unidades: Matriz, 364 Food Services, Afya, 364 Steakhouse, CD)
                        → 364 Burguer         (unidade: Matriz)
                        → 364 Foodtruck/Afya  (unidade: Matriz)
CNPJ 37.541.736/0001-87 → 364 Steakhouse      (unidade: Matriz)
```

Ou seja: `empresa` no sistema é **unidade de negócio gerencial**, não pessoa jurídica — três "empresas" compartilham o mesmo CNPJ. Isso é uma boa notícia para o estoque centralizado: a maior parte das transferências ocorre dentro do mesmo CNPJ e é movimento interno, sem exigência de nota.

⚠️ **A exceção é fiscal e precisa de decisão antes de a ficha de baixa entrar no ar.** O CD pertence ao CNPJ 60.361.009/0001-50. Toda baixa do CD para a unidade do CNPJ 37.541.736/0001-87 é **circulação de mercadoria entre pessoas jurídicas distintas** e exige documento fiscal (NF-e de transferência/venda, CFOP conforme a operação e o regime). Não é um detalhe contábil que se resolve depois: sem nota, a mercadoria trafega irregularmente e o crédito/custo fica no CNPJ errado.

Duas saídas possíveis, ambas viáveis:

1. **Compra segregada por CNPJ.** Cada CNPJ compra o que vai consumir; o CD é físico e compartilhado, mas o estoque é lógico por empresa (o `empresa_id` já está em `stock_movements` e no unique de `stock_balances`). Nenhuma nota nova, nenhum risco. Custo: perde poder de negociação em volume.
2. **Compra centralizada + NF-e de transferência.** O CNPJ que compra emite nota ao transferir para o outro. O sistema **já tem motor de emissão de NF-e** (migração 43 + pipeline das tarefas 1–7), então a própria confirmação da ficha de baixa que cruza CNPJ pode disparar a emissão. É o caminho tecnicamente mais rico, mas depende de a emissão estar homologada e de definição do CFOP/tributação com o contador.

Recomendação: fase 1 com a saída (1) — estoque lógico por empresa dentro do CD, baixa cruzando CNPJ **bloqueada** por regra do banco. A saída (2) vira fase própria depois da homologação da NF-e, e aí a ficha de baixa ganha o gatilho de emissão.

### 4.3 Ficha de baixa de estoque

Segue o padrão que a casa já usa em fichas de defumação (migração 29) e embalagem (migração 30): cabeçalho + itens, rascunho → confirmada, imutável depois de confirmada, correção por estorno.

```sql
create table baixas_estoque (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),          -- dona do estoque de origem
  unidade_origem_id uuid not null references unidades(id),
  deposito_origem_id uuid not null references depositos(id),
  empresa_destino_id uuid references empresas(id),
  unidade_destino_id uuid references unidades(id),
  centro_custo_id uuid references centros_custo(id),
  data date not null default current_date,
  tipo text not null check (tipo in
    ('transferencia','consumo','descarte','perda','uso_interno','cortesia','devolucao_fornecedor')),
  motivo text,
  responsavel_id uuid references funcionarios(id),
  status text not null default 'rascunho'
    check (status in ('rascunho','confirmada','cancelada')),
  confirmada_em timestamptz,
  numero serial,
  created_at timestamptz not null default now()
);

create table baixa_estoque_itens (
  id uuid primary key default gen_random_uuid(),
  baixa_id uuid not null references baixas_estoque(id) on delete cascade,
  empresa_id uuid not null references empresas(id),
  materia_prima_id uuid not null references materias_primas(id),
  lote text not null,
  quantidade numeric(12,4) not null check (quantidade > 0),
  custo_unitario numeric(12,2) not null,     -- congelado na confirmação (PEPS do lote)
  observacao text
);
```

Regras:

- **Confirmar é o que escreve no ledger.** Rascunho não movimenta nada. Na confirmação, cada item gera os `stock_movements` correspondentes ao `tipo` da ficha, e `stock_balances` é atualizado na mesma transação (função `security definer`, nunca na tela).
- `tipo = 'transferencia'` gera **par**: `transferencia_saida` na origem + `transferencia_entrada` no destino. Os outros tipos geram um único movimento (`consumo`, `saida` ou `ajuste`), e é o `tipo` da ficha que decide em qual conta do DRE o valor cai.
- **Bloqueio de CNPJ:** trigger recusa ficha cuja empresa de destino tenha CNPJ diferente da empresa de origem, enquanto a NF-e de transferência não estiver ligada (ver 4.2).
- **Saldo negativo é recusado** pelo próprio `check (quantidade >= 0)` de `stock_balances` — a ficha falha na confirmação em vez de gravar saldo impossível.
- Cancelar ficha confirmada **não apaga** movimento: gera `estorno` (o tipo já existe no check). Mesma disciplina de imutabilidade da migração 29.

### 4.4 Um estágio ou dois?

A pergunta que define o custo operacional da ficha:

- **Dois estágios** (CD → unidade como `transferencia`, depois `consumo` na unidade): a unidade tem estoque próprio, dá para contar e medir quebra por unidade. Custo: alguém na unidade precisa lançar consumo todo dia.
- **Um estágio** (CD → `consumo` direto, com `unidade_destino_id` e `centro_custo_id`): mais barato, funciona quando a unidade não estoca. Custo: quebra na unidade fica invisível — o que sair do CD já vira custo, mesmo que estrague na geladeira do salão.

Recomendação: **dois estágios nas unidades com cozinha e estoque próprio, um estágio no foodtruck e em eventos.** O campo que controla isso é por unidade (`unidades.controla_estoque_proprio boolean`), não uma regra global.

### 4.5 Custeio

O ledger já carrega `lote` e `custo_unitario` por movimento, e `recebimento_itens` tem lote único por empresa (`recebimento_itens_empresa_lote_unico`). Isso entrega **PEPS por lote** praticamente de graça, que é o método correto para alimentos — a rastreabilidade sanitária já obriga a trabalhar por lote e validade.

Recomendação: PEPS por lote, com custo médio ponderado como fallback para insumo não rastreado por lote. O método precisa ficar explícito numa coluna de configuração da empresa, nunca implícito no código, porque muda o CMV e o contador vai perguntar.

### 4.6 Inventário

```sql
create table inventarios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  deposito_id uuid not null references depositos(id),
  data_referencia date not null,
  status text not null default 'aberto' check (status in ('aberto','contando','fechado','cancelado')),
  responsavel_id uuid references funcionarios(id),
  fechado_em timestamptz,
  unique (empresa_id, deposito_id, data_referencia)
);

create table inventario_itens (
  id uuid primary key default gen_random_uuid(),
  inventario_id uuid not null references inventarios(id) on delete cascade,
  empresa_id uuid not null references empresas(id),
  materia_prima_id uuid not null references materias_primas(id),
  lote text,
  quantidade_sistema numeric(12,4) not null,    -- congelada na abertura
  quantidade_contada numeric(12,4),
  custo_unitario numeric(12,2) not null,
  observacao text
);
```

Pontos que decidem a qualidade do dado:

- **Contagem cega:** a tela de contagem não mostra `quantidade_sistema`. Se mostra, a pessoa confirma o número do sistema e o inventário deixa de medir qualquer coisa.
- `quantidade_sistema` é congelada na abertura, e o depósito fica travado para novas fichas enquanto o inventário está em `contando` — senão a diferença apurada é ruído de horário.
- Fechar o inventário gera `stock_movements` de `ajuste` (positivo ou negativo) e lança a diferença valorizada numa conta própria de **quebra/perda de estoque** do grupo 3, **fora do CMV**. Diluir quebra dentro do CMV é o erro clássico: some justamente o número que se queria enxergar.
- Periodicidade: mensal no fechamento, para o DRE fechar; contagem semanal só das 10–15 matérias-primas de maior valor (curva ABC).

### 4.7 O que isso destrava no DRE

Com o ledger alimentado, cada valor cai onde deve:

| Evento | Conta / linha |
|---|---|
| Compra recebida e aprovada | `estoque` (ativo) — **não** entra no resultado |
| `consumo` valorizado | CMV real do centro de custo e da unidade, no mês do consumo |
| `ajuste` de inventário | Quebra/perda — grupo 3, linha separada do CMV |
| `transferencia` entre unidades | Neutro no consolidado do grupo; só realoca custo entre unidades |
| `descarte` / `perda` com motivo | Conta própria — separa perda por validade de perda por manuseio |
| `cortesia` / `uso_interno` | Despesa comercial ou benefício de pessoal, não CMV |

E o par que interessa: **CMV teórico** (ficha técnica × vendas, que o sistema já calcula em `vw_produto_custo`) contra **CMV real** (consumo do ledger). A diferença é a quebra que ninguém lança em lugar nenhum.

## 5. Ordem de implementação revisada

⚠️ **A sequência importa mais do que o conteúdo de cada fase.** Se a compra passar a ser lançada como `estoque` antes de o consumo estar sendo registrado, o custo simplesmente **some do DRE** e o resultado mostra lucro que não existe. A troca de método precisa ser controlada por unidade, não ligada de uma vez.

Mitigação: coluna `empresas.custeio_por_estoque boolean default false`. Enquanto `false`, a compra continua caindo direto em CMV por caixa (comportamento de hoje). Vira `true` só na unidade em que a ficha de baixa já está sendo lançada com disciplina.

| Fase | Conteúdo | Depende de |
|---|---|---|
| **46** | Versionar o DDL existente de `unidades`, `depositos`, `stock_movements`, `stock_balances`, `centros_custo`; adicionar `centros_custo.tipo`, `unidades.controla_estoque_proprio`, `empresas.custeio_por_estoque`; seed dos centros de custo | — |
| **47** | Recebimento aprovado passa a gerar `stock_movements` de `entrada` (fecha a lacuna que existe desde julho); função transacional de movimentação | 46 |
| **48** | `baixas_estoque` + `baixa_estoque_itens` + confirmação transacional + bloqueio de cruzamento de CNPJ; tela da ficha | 47 |
| **49** | `inventarios` + `inventario_itens`, contagem cega, fechamento gerando `ajuste` | 48 |
| **50** | `plano_contas` + `contas_a_pagar_rateios` + campos novos de `contas_a_pagar` (seção 3); remove `categoria_conta`; atualiza os 6 arquivos que consomem `CATEGORIAS_CONTA` | 46 (centros de custo) |
| **51** | Campos de parcela (banco, pagamento parcial, juros/multa/desconto, retenções), `contas_recorrentes` | 50 |
| **52** | `taxas_recebimento`, unificação da receita PDV + B2B, `vw_dre_mensal` com CMV real | 49, 50 |
| **53** | `orcamento_mensal`, `vw_orcado_realizado`, `vw_ponto_equilibrio_mensal` | 52 |
| **futura** | NF-e de transferência automática na ficha de baixa que cruza CNPJ | 48 + homologação da NF-e |

As fases 46–49 (estoque) e 50–51 (contas a pagar) são independentes entre si e podem correr em paralelo. A 52 é o ponto de encontro: só ali o DRE fecha.

## 6. Decisões em aberto

1. **Escopo do plano de contas:** grupo (compartilhado entre as empresas, como a migração 45 faz com contas bancárias) ou por empresa? Recomendação: grupo, com centros de custo por empresa/unidade — que é como `centros_custo` já está modelada em produção.
2. **Compra centralizada cruzando CNPJ (4.2):** segregar a compra por CNPJ agora, ou centralizar e emitir NF-e de transferência? Recomendação: segregar na fase 1, centralizar depois da homologação da NF-e. **Vale confirmar com o contador antes de fechar a fase 48.**
3. **Estoque próprio por unidade (4.4):** quais unidades estocam de verdade e vão lançar consumo, e quais recebem baixa direta do CD? Isso define quanto trabalho diário a ficha cria.
4. **Método de custeio (4.5):** PEPS por lote (recomendado, e praticamente pronto) ou custo médio ponderado?
5. **Rateio de despesa entre empresas do grupo:** acontece de fato (uma empresa paga conta de outra)? Se não, `empresa_pagadora_id` pode ficar de fora da fase 50.
6. **Detalhe do lançamento de compra:** rateio por valor no cabeçalho ou classificação item a item da nota? Recomendação: cabeçalho na fase 50; item a item derivado automaticamente quando a conta vier de recebimento, já que `recebimento_itens` tem tudo que é preciso.
