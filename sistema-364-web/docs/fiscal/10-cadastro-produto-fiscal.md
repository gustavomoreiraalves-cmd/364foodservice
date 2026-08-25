Confirmed the RLS helper pattern. Now producing the final deliverable.

---

# Cadastro Fiscal de Produto e Motor de Regras Tributárias — 364 Food Services

**Regime confirmado: Simples Nacional.** **Emitente: RO.** Documentos: NF-e modelo 55 (venda B2B) e NFS-e (não coberta neste documento). Este é o entregável de especificação — nível de colunas de banco, tags XML e DDL idempotente.

---

## 0. Diagnóstico do estado atual (grounding no repo)

Verificado em `supabase/schema.sql` e migrações `atualizacao_02` a `atualizacao_35`:

| Tabela | Colunas hoje | Fiscal? |
|---|---|---|
| `produtos` | id, empresa_id, codigo, nome, categoria, unidade, preco_venda, custo_unitario, validade_dias, conservacao_texto, producao_interna (bool), modelo_etiqueta | **Nenhuma** |
| `materias_primas` | id, nome, unidade, custo_unitario | **Nenhuma** |
| `clientes` | id, nome, cnpj, tipo, contato, telefone | **Nenhuma** |
| `empregadores` | cnpj, regime_tributario (`simples`\|`presumido`\|`real`\|`mei`), cnae_principal, inscricao_municipal, endereço completo, codigo_municipio_ibge | **Falta IE, CRT numérico, série/numeração NF-e, IEST, ambiente, CSC** |
| `nfe_documentos` | metadados da nota + `xml_path` (bucket) | XML de entrada não é persistido item a item |
| `fornecedor_produto_mapa` | codigo_produto → `materia_prima_id`, `unidade_nf`, `fator_conversao` | Sem campos fiscais |
| `lib/nfe/parseNFe.js` | por item extrai hoje **apenas** `ncm` e `unidade` (uCom) — **não** extrai `CEST`, `cEAN`, `cEANTrib`, `uTrib`/`qTrib`, `orig` | Parser incompleto para o que a Seção 5 precisa |

Esse diagnóstico direciona as seções 5 e 8: a extensão do parser é pré-requisito da migração de dados.

---

## 1. Campos fiscais do produto

### 1.1 Identificação fiscal da mercadoria

| Coluna sugerida | Tipo | Obrigatório | Domínio | Tag NF-e 4.00 |
|---|---|---|---|---|
| `ncm` | `text` | Sim (para emitir) | 8 dígitos, tabela vigente RFB/Camex | `<NCM>` (det/prod) |
| `ex_tipi` | `text` | Não | 2 dígitos, só quando o NCM tem exceção na TIPI | `<EXTIPI>` |
| `cest` | `text` | Condicional | 7 dígitos, só se a mercadoria estiver no Anexo do Convênio 142/2018 | `<CEST>` |
| `cest_tabela_versao` | `text` | Não (auditoria) | ex.: `"CV142/2018 red. XX"` | — |
| `ncm_tabela_versao` | `text` | Não (auditoria) | data/ato normativo vigente no cadastro | — |

### 1.2 Código de barras (GTIN)

| Coluna | Tipo | Obrigatório | Domínio | Tag |
|---|---|---|---|---|
| `gtin` | `text` | Sim (usar regra "SEM GTIN") | 8, 12, 13 ou 14 dígitos numéricos válidos, **ou** literal `SEM GTIN` | `<cEAN>` |
| `gtin_tributavel` | `text` | Sim | mesma regra; normalmente = `gtin`, difere quando a unidade tributável tem embalagem própria com GTIN distinto | `<cEANTrib>` |

Regra SEM GTIN: a tag é **obrigatória** no XML (não pode ficar ausente) — quando o produto não tem código de barras, grava-se literalmente a string `SEM GTIN` em `cEAN`/`cEANTrib`, nunca `null`/vazio. Isso deve virar uma constraint de aplicação, não só de UI: `gtin is not null` sempre, com CHECK regex permitindo o literal.

### 1.3 Origem, unidades, peso

| Coluna | Tipo | Obrigatório | Domínio | Tag |
|---|---|---|---|---|
| `origem_mercadoria` | `smallint` | Sim | 0 a 8 (tabela oficial abaixo) | `orig` (dentro do grupo ICMS/ICMSSN) |
| `unidade_tributavel` | `text` | Sim | tabela de unidades NF-e (KG, UN, CX...) | `<uTrib>` |
| `fator_conversao_tributavel` | `numeric(12,4)` | Sim | > 0; quantas `unidade_tributavel` cabem em 1 `unidade` (comercial, coluna já existente) | usado para calcular `<qTrib>` a partir de `<qCom>` |
| `peso_liquido_kg` | `numeric(12,4)` | Sim (para volumes) | > 0 | `pesoL` (grupo `<vol>` em `<transp>`, não é tag de item — o cadastro alimenta o cálculo do romaneio) |
| `peso_bruto_kg` | `numeric(12,4)` | Sim (para volumes) | ≥ peso_liquido_kg | `pesoB` (idem) |

**Nota de modelagem**: a coluna `unidade` já existente em `produtos` passa a ser a unidade comercial (`uCom`) — não crie uma coluna paralela para isso, apenas documente o papel dela. Não confundir peso líquido/bruto de item com tag de produto: no leiaute 4.00 esses pesos vivem no grupo de volumes do transporte (`transp/vol`), somados a partir do cadastro do produto multiplicado pela quantidade do item — mas o **cadastro** é a fonte, por isso a coluna existe em `produtos`.

Tabela `orig` (grupo ICMS, valores 0–8, doc. oficial no leiaute NF-e):

| Código | Descrição |
|---|---|
| 0 | Nacional, exceto as indicadas nos códigos 3, 4, 5 e 8 |
| 1 | Estrangeira — importação direta, exceto a indicada no código 6 |
| 2 | Estrangeira — adquirida no mercado interno, exceto a indicada no código 7 |
| 3 | Nacional, mercadoria/serviço com conteúdo de importação superior a 40% |
| 4 | Nacional, produção conforme processos produtivos básicos |
| 5 | Nacional, conteúdo de importação ≤ 40% |
| 6 | Estrangeira — importação direta, sem similar nacional, na lista CAMEX |
| 7 | Estrangeira — adquirida no mercado interno, sem similar nacional, lista CAMEX |
| 8 | Nacional, conteúdo de importação > 70% |

Para 364 (carne bovina/suína crua, defumada, embutidos): `origem_mercadoria = 0` em praticamente todos os itens.

### 1.4 Operação, tributação padrão (referência — o valor real vem do motor de regras, Seção 2)

| Coluna | Tipo | Obrigatório | Domínio | Uso |
|---|---|---|---|---|
| `cfop_saida_interna_referencia` | `text` | Sim (referência) | 4 dígitos, `5xxx` | default sugerido; a regra tributária (Seção 2) manda na emissão real |
| `cfop_saida_interestadual_referencia` | `text` | Sim (referência) | 4 dígitos, `6xxx` | idem |
| `csosn_padrao` | `text` | Sim (Simples Nacional) | `101,102,103,201,202,300,400,500,900` | referência; regra tributária decide caso a caso |
| `cst_icms_padrao` | `text` | Não (só para contraste com regime normal, CRT≠1) | `00,10,20,30,40,41,50,51,60,70,90` | usado apenas se um dia a empresa sair do Simples |
| `producao_interna` | `boolean` | já existe | — | **reaproveitar**: decide CFOP 5101/6101 (produção própria) vs 5102/6102 (revenda) — não duplicar |
| `sujeito_st` | `boolean` | Sim | derivado de `cest is not null`, mas com override manual | trava a UI a preencher MVA/CEST na regra |
| `papel_st` | `text` | Condicional | `substituto` \| `substituido` \| `nao_aplicavel` | **pendente confirmação do contador** — ver bloco RO abaixo |
| `cbenef_padrao` | `text` | Não | tabela de benefícios de RO (Seção 3) | ex.: isenção do Anexo I item 104 quando aplicável |

**Contraste explícito com regime normal**: em CST de regime normal a informação tributária do ICMS é código de 2 dígitos (`00` tributada integralmente, `10` tributada com ST, `20` com redução de base, `40` isenta, `41` não tributada, `50` suspensão, `51` diferimento, `60` ICMS cobrado por ST anteriormente, `70` redução + ST, `90` outras). No Simples Nacional (**este é o caso da 364**) o campo correspondente é sempre **CSOSN**, de 3 dígitos, e a tag do grupo muda de `<ICMS00>...` para `<ICMSSN101>...` etc. Nunca preencher CST e CSOSN ao mesmo tempo no XML — são grupos XML mutuamente exclusivos, escolhidos pelo CRT do emitente (Seção 7).

### 1.5 Rastreabilidade

| Coluna | Tipo | Obrigatório | Domínio |
|---|---|---|---|
| `lote_obrigatorio` | `boolean` | Sim, default `true` para carne | — |
| `validade_obrigatoria` | `boolean` | Sim, default `true` | reaproveita `validade_dias` já existente para calcular `dVal` do lote |

(NF-e 4.00 tem grupo opcional `rastro` — `nLote`, `qLote`, `dFab`, `dVal`, `cAgreg` — usado quando a legislação sanitária exige; carne processada tipicamente exige.)

### 1.6 Campos novos da Reforma Tributária — IBS/CBS

| Coluna | Tipo | Obrigatório | Domínio | Tag |
|---|---|---|---|---|
| `cclasstrib` | `char(6)` | Obrigatório a partir de jan/2027 para Simples Nacional (ver cronograma Seção 8) | 6 dígitos numéricos, tabela oficial IBS/CBS | `cClassTrib` (grupo `UB` — Reforma) |
| `cst_ibs_cbs` | `char(3)` | Gerado (`left(cclasstrib,3)`) | um dos 18 códigos oficiais (tabela abaixo) | `CST` dentro do mesmo grupo |

Os 3 primeiros dígitos de `cClassTrib` **são** o CST — não são dois cadastros independentes, é uma coluna gerada (`generated always as`) para evitar inconsistência.

Tabela de CST IBS/CBS (18 códigos, comum a IBS e CBS — o que muda entre os dois tributos é a alíquota, não o código):

| CST | Significado |
|---|---|
| 000 | Tributação integral |
| 010 | Alíquota uniforme — setor financeiro |
| 011 | Alíquota uniforme reduzida (60% ou 30%) |
| 200 | Alíquota zero / reduções percentuais (80/70/60/50/40/30%) |
| 220 / 221 | Alíquota fixa / fixa proporcional |
| 222 | Redução de base de cálculo |
| 400 | Isenção |
| 410 | Imunidade / não incidência |
| 510 / 515 | Diferimento / diferimento com redução |
| 550 | Suspensão |
| 620 | Tributação monofásica |
| 800 | Transferência de crédito |
| 810 / 811 | Ajustes ZFM / ajustes gerais |
| 820 | Tributação em documento específico |
| 830 | Exclusão de base de cálculo |

`cClassTrib` é o detalhamento (dentro de cada CST) do enquadramento legal exato na LC 214/2025 — a tabela oficial tem entre 161 e 164 códigos publicados (divergência entre fontes secundárias; **NÃO CONFIRMADO** o número exato e a versão vigente em 24/08/2026 — publicação está no Portal Nacional da NF-e, aba Documentos → Diversos, e no Portal DFe da SVRS em `dfe-portal.svrs.rs.gov.br/Cff/ClassificacaoTributaria`; a atualização mais recente encontrada na pesquisa data de 22/06/2026). Para carne in natura e defumada, o código padrão-regra é `000001` ("situações tributadas integralmente", CST `000`) até que uma exceção setorial (ex.: cesta básica nacional, que a LC 214/2025 zera para itens alimentícios essenciais) seja confirmada pelo contador — **carne é candidata a alíquota zero/reduzida na cesta básica nacional do IBS/CBS, mas o código exato precisa ser validado na tabela oficial antes de codificar um default**, então trate `cclasstrib`/`cst_ibs_cbs` como `null` até essa confirmação, nunca com um valor chutado.

---

## 2. O erro clássico e o modelo correto

### 2.1 Por que campo fixo no produto quebra

A tributação de uma saída depende de **quatro eixos independentes**, não de um só:

1. **O que** é vendido → produto (NCM/CEST/GTIN — Seção 1, atributos intrínsecos da mercadoria).
2. **Por que** está saindo → **natureza da operação** (venda, devolução, remessa para industrialização, transferência entre filiais, amostra grátis...) → determina o CFOP e a finalidade da nota (`finNFe`).
3. **Para quem** → **destinatário**: é contribuinte de ICMS ou não (`indIEDest`), é consumidor final (`indFinal`), está em que UF.
4. **Sob qual regime o emitente opera aquele mês** → no Simples Nacional a alíquota efetiva de ICMS embutida no CSOSN 101/201 **muda mês a mês** conforme a receita bruta acumulada dos últimos 12 meses (RBT12) e o Anexo da LC 123/2006 aplicável — não é uma constante que se grava uma vez no produto.

Gravar `csosn`, `cfop` ou `aliquota` como coluna fixa em `produtos` funciona só até a primeira venda para outro estado, ou até a primeira devolução, ou até o mês em que a faixa de receita mudar — e quebra silenciosamente (a nota sai, mas com tributo errado, o que só aparece em uma fiscalização ou no complemento de ST).

### 2.2 Como ERPs sérios modelam isso

O padrão de mercado (SAP, TOTVS, Bling, Omie, Tiny) é uma **matriz de decisão** com um motor de resolução, nunca um campo estático:

- **SAP** (módulo FI/SD, localização Brasil): usa "grupo de determinação de imposto" no cadastro do material combinado a "código de acesso" (chave composta por regime tributário do parceiro, natureza da operação, região de origem/destino) resolvido por uma **tabela de condição** (`TAXBRJ`/customização de Tax Codes) — o valor final (alíquota, CST, base) é lido em tempo de faturamento, nunca fixo no mestre de material.
- **TOTVS Protheus**: separa "TES — Tipo de Entrada/Saída" (a natureza da operação, com CFOP associado) do "Grupo de Tributação" do produto; a alíquota/CST final vem do cruzamento TES × Grupo Tributário × UF origem/destino × situação do cliente, resolvido pela rotina de cálculo de impostos no momento do documento.
- **Bling, Omie, Tiny** (ERPs menores, mais próximos do porte da 364): todos têm o conceito de **"regra fiscal"** ou **"perfil de tributação"** — uma tela separada do cadastro de produto, onde se define: para esta combinação de (grupo de produto × natureza de operação × UF destino × tipo de cliente) → este CFOP, este CSOSN/CST, esta base/alíquota/MVA. O produto só carrega seu NCM/CEST/GTIN (atributos intrínsecos); a regra fiscal é reutilizável entre N produtos do mesmo grupo.

O nome que se repete em todos: **grupo tributário** (ou "perfil fiscal") no produto + **tabela de regras** por operação/destino, cruzadas em tempo de emissão.

### 2.3 Modelo relacional proposto para a 364

```
produtos ──┐
           ├──> regras_tributarias <──── naturezas_operacao
materias_primas (fiscal, Seção 5) ┘              │
                                                   │
clientes (UF, indIEDest, consumidor_final) ───────┘
```

**Chave de resolução** (o "cruzamento" pedido):

```
entrada: produto_id (ou ncm, se regra genérica), natureza_operacao_id,
         uf_destino, contribuinte_destino (bool|null), consumidor_final (bool|null)
   ↓
saída:   cfop, csosn, cst_ibs_cbs/cclasstrib, base_calculo_regra,
         aliquota_credito_simples, mva, reducao_base, fcp, cbenef,
         responsabilidade_st
```

A função de resolução (Seção 8, `fn_resolver_regra_tributaria`) busca a regra **mais específica** primeiro (produto exato > NCM genérico; UF exata > `'*'` coringa; contribuinte definido > indiferente) e cai em cascata até achar uma regra ativa e vigente. Se nenhuma regra casar, a emissão **deve ser bloqueada** — nunca emitir com CFOP/CSOSN adivinhado.

**A alíquota do Simples Nacional não mora na regra tributária** — ela mora em `parametros_simples_nacional` (Seção 8), por competência (mês), porque é uma função do RBT12 da empresa, não da operação. A regra tributária referencia essa tabela para montar `pCredSN`/`vCredICMSSN` (CSOSN 101/201).

---

## 3. Tabelas auxiliares oficiais

| Tabela | Onde baixar | Formato | Frequência de mudança | Fonte confirmada |
|---|---|---|---|---|
| **NCM/TIPI** | Portal da Receita Federal, seção Legislação → TIPI; Portal Único Siscomex (`portalunico.siscomex.gov.br`) para a tabela em uso no comércio exterior | PDF oficial + planilha de consulta | Atualizações pontuais (extinção/criação de código) várias vezes ao ano; última localizada em fevereiro/2026 | Confirmado que existe versão RFB de 13/02/2026 incorporando ADE RFB nº 1/2026 — **URL exata do arquivo baixável NÃO CONFIRMADA** nesta rodada (a busca só trouxe páginas de terceiros que compilam a tabela, não o link direto do arquivo RFB) |
| **CEST** | CONFAZ — Convênio ICMS 142/2018 e alterações | Texto legal com anexos (tabelas por segmento II a XXVI) | Alterado por convênios modificadores, não é uma "planilha" oficial única — precisa consolidar manualmente ou usar compilador confiável | `https://www.confaz.fazenda.gov.br/legislacao/convenios/2018/CV142_18` — **confirmado** |
| **Correlação NCM × CEST** | **Não existe uma publicação oficial em formato tabular separado.** A correlação está embutida nos próprios anexos do Convênio 142/2018 (cada item lista NCM(s) + CEST juntos) | — | acompanha as alterações do convênio | Confirmado pela estrutura do próprio Convênio 142/2018; não há CSV oficial do CONFAZ — bases como `buscadorncm.com.br/cest` são compilações de terceiros, não fonte primária |
| **CFOP** | CONFAZ — Ajuste SINIEF 7/2001 (última consolidação oficial do código) | Texto legal (tabelas I a VII: entrada/saída, dentro/fora estado/exterior) | Raramente alterado (última grande revisão foi Ajuste SINIEF 07/2001; leituras posteriores são ajustes pontuais) | `https://www.confaz.fazenda.gov.br/legislacao/ajustes/2001/AJ_007_01` — **confirmado** |
| **Unidades de medida (uCom/uTrib)** | Portal Nacional da NF-e, `nfe.fazenda.gov.br` → Documentos → Diversos → "Tabela de Unidades de Medida" | Documento/planilha oficial do Projeto NF-e | Estável, muda raramente | Página confirmada existir no portal (`exibirArquivo.aspx`), URL de conteúdo específico não fixada nesta pesquisa — recomenda-se navegar pelo índice "Documentos" do portal a cada revisão de leiaute |
| **Municípios IBGE (cMun)** | IBGE — `ibge.gov.br/explica/codigos-dos-municipios.php`; espelho pronto para uso em `gov.br/receitafederal/dados/municipios.csv` | CSV | Muda só em caso de emancipação/fusão de município (raro) | Ambas as URLs **confirmadas** na pesquisa |
| **Países (cPais)** | Padrão BACEN (4 dígitos), tabela publicada junto ao Siscomex e replicada no Portal NF-e | — | Praticamente estática | **NÃO CONFIRMADA** URL oficial exata nesta rodada — só fontes secundárias (`espiaonfe.com.br`); baixa prioridade para a 364 (só usada se exportar) |
| **cBenef (RO)** | **NÃO CONFIRMADO.** A pesquisa não localizou uma tabela de códigos de benefício fiscal publicada pela SEFIN-RO no mesmo padrão de SP/RJ/RS/SC/PR/GO/DF. Ação recomendada: perguntar diretamente à SEFIN-RO (ou ao contador) se RO exige cBenef e onde está publicada a tabela — pode ser que RO **não exija** o preenchimento (lista de estados que exigem, encontrada na pesquisa, não incluiu RO) | — | — | — |

**Como manter atualizado, operacionalmente**: como não há um endpoint machine-readable oficial confiável para NCM/CEST/CFOP, a recomendação é (a) importar a tabela consolidada uma vez por trimestre a partir de uma fonte compiladora confiável (ex.: `tabelasfiscais.com.br/downloads`, cruzada manualmente contra o texto legal do Convênio 142/2018 nos itens usados pela 364 — carnes), guardando `vigente_desde`/`ato_normativo` por linha; (b) tratar município/país como praticamente estáticos (carga única + revisão anual); (c) nunca deixar o cadastro de produto aceitar um NCM/CEST que não exista na tabela local vigente (Seção 4).

---

## 4. Validações no cadastro

| Validação | Regra | Evita |
|---|---|---|
| NCM existe | `ncm` deve existir em `tabela_ncm` com `vigente_desde <= hoje` | rejeição SEFAZ "NCM inválido" |
| CEST compatível com NCM | Se `cest is not null`, o par `(cest, ncm)` deve existir em `tabela_cest_nacional` | rejeição "CEST não corresponde ao NCM" |
| GTIN com dígito verificador válido | ver algoritmo abaixo; aceitar também o literal `SEM GTIN` | rejeição "GTIN inválido" |
| Unidade tributável coerente | `fator_conversao_tributavel > 0`; se `unidade = unidade_tributavel`, fator deve ser `1` | erro de cálculo de `qTrib`/`vUnTrib` |
| CFOP compatível com a natureza | O CFOP resolvido pela regra tributária deve pertencer ao conjunto de CFOPs permitido pela `natureza_operacao` (ex.: natureza "venda" não pode resolver para CFOP de família `5.9xx`/devolução) | nota emitida com CFOP that não bate com a operação real, gerando inconsistência de escrituração |
| CRT × CSOSN/CST | Se `empregadores.crt = 1` (Simples), toda regra tributária resolvida **deve** usar `csosn`, nunca `cst_icms`; se `crt = 3`, o inverso | erro de leiaute (mistura de grupo ICMS normal com ICMSSN) |
| cClassTrib × CST IBS/CBS | `left(cclasstrib, 3) = cst_ibs_cbs` sempre (gerar a coluna, não deixar editar as duas separadamente) | inconsistência entre os dois campos |
| Regra tributária sem ambiguidade | Ao salvar uma nova linha em `regras_tributarias`, checar que não existe outra regra ativa, vigente, com a mesma especificidade (mesmo produto/ncm, natureza, uf_destino, contribuinte) — senão a função de resolução fica ambígua | comportamento não determinístico na emissão |

### Algoritmo do dígito verificador do GTIN/EAN

Módulo 10, pesos alternados 3 e 1 a partir do dígito mais à direita (excluindo o próprio verificador):

1. Percorra os dígitos do GTIN da direita para a esquerda, sem contar o último dígito (o verificador).
2. Multiplique por 3 os dígitos em posição ímpar (1ª, 3ª, 5ª... a partir da direita) e por 1 os de posição par.
3. Some tudo.
4. O dígito verificador é o valor que falta para chegar ao próximo múltiplo de 10 (`(10 - soma % 10) % 10`).

```sql
create or replace function public.fn_gtin_digito_verificador(p_gtin_sem_dv text)
returns int
language sql
immutable
as $$
  select (10 - (
    select sum(
      (case when (ordinality % 2) = 1 then 3 else 1 end) * digito
    )
    from (
      select (dig)::int as digito, ordinality
      from unnest(string_to_array(reverse(p_gtin_sem_dv), null)) with ordinality as t(dig)
    ) s
  ) % 10) % 10;
$$;

create or replace function public.fn_gtin_valido(p_gtin text)
returns boolean
language sql
immutable
as $$
  select case
    when p_gtin = 'SEM GTIN' then true
    when p_gtin !~ '^\d{8}$|^\d{12,14}$' then false
    else (
      right(p_gtin, 1)::int =
      public.fn_gtin_digito_verificador(left(p_gtin, length(p_gtin) - 1))
    )
  end;
$$;
```

---

## 5. Migração do cadastro existente a partir dos XML de entrada

### 5.1 Pré-requisito: o parser hoje é insuficiente

`lib/nfe/parseNFe.js` (linhas 48-57) hoje extrai por item **apenas** `codigo`, `descricao`, `ncm`, `unidade` (=`uCom`), `quantidade`, `valorUnitario`, `valorTotal`. **Não extrai** `CEST`, `cEAN`, `cEANTrib`, `uTrib`/`qTrib`, `orig`, `EXTIPI` — que estão todos disponíveis no XML já armazenado no bucket (`nfe_documentos.xml_path`), mas não são lidos. **Passo 0 da migração**: estender o mapeamento de `det.prod` para capturar esses campos:

```js
const itens = lista(inf.det).map((d, i) => ({
  // ...campos já existentes...
  cest: d.prod?.CEST ? String(d.prod.CEST) : null,
  exTipi: d.prod?.EXTIPI ? String(d.prod.EXTIPI) : null,
  gtin: d.prod?.cEAN ? String(d.prod.cEAN) : null,
  gtinTributavel: d.prod?.cEANTrib ? String(d.prod.cEANTrib) : null,
  unidadeTributavel: d.prod?.uTrib ? String(d.prod.uTrib) : null,
  quantidadeTributavel: num(d.prod?.qTrib),
  origem: d.det_ICMS_orig, // extrair de dentro do grupo ICMS específico (ICMS00/ICMS102/etc — variável por CST/CSOSN do fornecedor)
}));
```

(Como o grupo ICMS do fornecedor pode vir em qualquer uma das ~20 variantes `ICMS00`...`ICMS90`/`ICMSSN101`...`ICMSSN900`, extrair `orig` exige percorrer as chaves do objeto `d.imposto?.ICMS` e pegar a primeira variante presente — não dá para acessar por caminho fixo.)

### 5.2 Distinção crítica: matéria-prima vs. produto acabado

**Isso não pode ser tratado uniformemente — é o ponto onde uma migração ingênua erra:**

- `fornecedor_produto_mapa` hoje só mapeia `codigo_produto` (do fornecedor) → `materia_prima_id`. Ou seja, todo item de XML de entrada hoje vira **insumo**, nunca vira produto de revenda direto.
- Para os itens que são **insumo de produção interna** (ex.: carne bovina in natura que a 364 compra para depois defumar): o NCM/CEST/GTIN que vem no XML do fornecedor descreve a **matéria-prima**, não o produto final. **Não copiar** esse NCM para `produtos.ncm` — a transformação (defumação) muda a classificação fiscal (ex.: carne fresca NCM 0201/0202 vira carne salgada/seca/defumada NCM 0210.99.00, que é um CEST diferente — item 83.x da Tabela XVII do Anexo VI/RICMS-RO, não o item 84.0/87.1 da carne fresca). Essa migração automática só serve para popular os campos fiscais de `materias_primas` (Seção 5.3), úteis para crédito de ICMS na entrada e para o motor de ST no recebimento.
- Para os itens que são **revenda pura** (ex.: insumos do steakhouse comprados prontos e revendidos sem transformação, se houver): o `producao_interna = false` do produto correspondente **pode** herdar NCM/CEST/GTIN do XML de entrada, **desde que** exista um vínculo direto fornecedor-item → produto (hoje não existe: recomenda-se estender `fornecedor_produto_mapa` com uma coluna opcional `produto_id` alternativa a `materia_prima_id`, ver DDL).
- Para o **produto final defumado**, o NCM/CEST **não é derivável automaticamente de nenhum XML de entrada** — precisa de classificação fiscal manual (contador ou consultoria de classificação fiscal), porque depende do processo de transformação, não do insumo.

### 5.3 Algoritmo de sugestão (aplicável à Seção 5.2, itens de insumo/matéria-prima e revenda direta)

Para cada `(cnpj_emitente, codigo_produto)` já mapeado em `fornecedor_produto_mapa`:

1. Buscar todos os itens de `nfe_documentos` (via XML no bucket) daquele fornecedor+código já recebidos.
2. Para cada campo fiscal (`ncm`, `cest`, `unidade_tributavel`, `gtin`, `gtin_tributavel`, `origem_mercadoria`), calcular a **moda** (valor mais frequente) entre as ocorrências.
3. Calcular a **confiança**: `ocorrências_do_valor_modal / total_de_ocorrências`.
4. Se confiança = 100% e houver ≥ 2 notas distintas → sugestão **alta confiança**, pode pré-preencher o cadastro com `sugerido_automaticamente = true` e `ativo_fiscal = false` (ainda precisa de revisão humana antes de emitir).
5. Se houver divergência entre notas do mesmo fornecedor/código (ex.: NCM mudou de uma nota para outra) → sinalizar `conflito = true`, não pré-preencher, forçar revisão manual com as opções encontradas visíveis na UI.
6. Nunca marcar `ativo_fiscal = true` automaticamente — toda sugestão passa por um humano que confirma (grava `revisado_por_id`, `revisado_em`), antes que o produto/matéria-prima entre na regra tributária.

### 5.4 Fluxo de conferência humana

```
XML de entrada (já recebido, N notas) 
   → job de agregação (passo 5.3) 
   → tabela de sugestão (staging, ou colunas *_sugerido em materias_primas)
   → tela de revisão fiscal (lista produtos/matérias-primas com ativo_fiscal = false)
      mostrando: valor sugerido, confiança, notas-fonte, conflitos
   → humano aceita/corrige/aprova
   → ativo_fiscal = true, revisado_por_id, revisado_em
   → só então o produto pode ser referenciado em uma regra_tributaria ativa
```

Bloqueio recomendado: a UI/API de emissão de NF-e de saída deve **recusar** vender um item cujo `produtos.ativo_fiscal = false` ou cujos campos obrigatórios (Seção 1) estejam nulos — erro explícito, nunca fallback silencioso.

---

## 6. Cadastro do destinatário (`clientes`)

### 6.1 Campos que faltam

| Coluna | Tipo | Obrigatório | Tag |
|---|---|---|---|
| `tipo_pessoa` | `char(1)` check `('F','J')` | Sim | deriva se usa `<CNPJ>` ou `<CPF>` no dest |
| `cpf` | `text` | Condicional (se `tipo_pessoa='F'`) | `<CPF>` |
| `ie` | `text` | Condicional | `<IE>` |
| `ind_ie_dest` | `smallint` check `(1,2,9)` | Sim | `<indIEDest>` — 1 contribuinte ICMS, 2 contribuinte isento de inscrição, 9 não contribuinte |
| `isuf` | `text` | Não | `<ISUF>` — Inscrição SUFRAMA (só clientes em ZFM/áreas de livre comércio) |
| `logradouro`, `numero`, `complemento`, `bairro` | `text` | Sim | `<enderDest>` |
| `codigo_municipio_ibge` | `char(7)` | Sim | `<cMun>` |
| `municipio` | `text` | Sim | `<xMun>` |
| `uf` | `char(2)` | Sim | `<UF>` |
| `cep` | `char(8)` | Sim | `<CEP>` |
| `codigo_pais` | `char(4)` default `'1058'` | Sim | `<cPais>` |
| `email` | `text` | Recomendado (não é tag do XML, mas necessário para o envio automático do DANFE/XML) | — |
| `regime_tributario` | `text` | Não (informativo) | — |
| `consumidor_final` | `boolean` | Sim (default por cadastro, override por operação) | `<indFinal>` |
| `presenca_padrao` | `smallint` (0–9) | Sim (default) | `<indPres>` |
| `situacao_cadastral_sefaz` | `text` | Não | resultado de consulta externa |
| `situacao_cadastral_verificada_em` | `timestamptz` | Não | auditoria |

### 6.2 Validação

- Formato de IE varia por UF (27 algoritmos de dígito verificador diferentes) — **não reimplementar aqui sem confirmar cada UF**; recomenda-se usar uma biblioteca já testada da comunidade SPED (ex.: rotina de validação de IE do `sped-nfe`) em vez de escrever 27 regras do zero. Marcar como **NÃO CONFIRMADO** o algoritmo específico de RO nesta rodada.
- `ind_ie_dest = 1` exige `ie` preenchida; `ind_ie_dest in (2,9)` exige `ie` nula ou `ISENTO`.

### 6.3 RO não é atendida pelo `NfeConsultaCadastro4` da SVRS — alternativa

Confirmado na pesquisa: a SVRS atende consulta cadastral (`NfeConsultaCadastro`) apenas para **AC, ES, RN, PB, SC** — Rondônia está fora dessa lista específica (embora esteja na lista mais ampla de outros serviços NF-e operados pela SVRS). URL do serviço: `https://cad.svrs.rs.gov.br/ws/cadconsultacadastro/cadconsultacadastro4.asmx`.

Alternativas levantadas:
1. **Portal CCC da SVRS** (`https://dfe-portal.svrs.rs.gov.br/nfe/ccc`) — existe, mas exige login via gov.br (SSO), portanto é uma consulta **manual/humana**, não um web service programático que a aplicação possa chamar em tempo real.
2. **Consulta pública Redesim de Rondônia** (`https://www.sefin.ro.gov.br/sint_consul.asp`) — localizada na pesquisa, parece ser consulta de situação de registro empresarial (Redesim), não necessariamente cadastro específico de habilitação NF-e/IE — **NÃO CONFIRMADO** se retorna IE e situação de habilitação para NF-e.
3. **Prática recomendada dado o vazio de web service confiável**: (a) validar formato/dígito da IE localmente (com a ressalva da Seção 6.2); (b) na primeira emissão para um novo destinatário, tratar a rejeição da própria SEFAZ (código de rejeição de destinatário não habilitado) como sinal definitivo — mas isso só acontece **depois** de tentar emitir, o que é tarde; (c) para clientes recorrentes de RO, cadastro manual conferido uma vez, com re-verificação periódica manual via portal.

**Lacuna**: não foi possível confirmar nesta rodada um web service programático e gratuito que cubra consulta cadastral de contribuinte de RO. Precisa de investigação dedicada (contato com SEFIN-RO ou teste direto do endpoint Redesim).

---

## 7. Cadastro do emitente (`empregadores`)

### 7.1 O que falta

| Coluna | Tipo | Obrigatório | Domínio | Tag |
|---|---|---|---|---|
| `inscricao_estadual` | `text` | Sim (para emitir) | dígitos, formato RO | `<IE>` (emit) — **hoje não existe na tabela**, só existe `inscricao_municipal` |
| `crt` | `smallint` check `(1,2,3,4)` | Sim | ver tabela abaixo | `<CRT>` |
| `iest` | `text` | Condicional | IE do substituto tributário nas UF onde a 364 se inscreveu por força do Protocolo 28/93 (não é a IE de RO) | `<IEST>` |
| `serie_nfe` | `smallint` | Sim | inteiro > 0, padrão `1` | `<serie>` |
| `proximo_numero_nfe` | `integer` | Sim | contador, nunca pode retroceder | `<nNF>` |
| `ambiente_nfe` | `smallint` check `(1,2)` | Sim | 1 = produção, 2 = homologação | `<tpAmb>` |
| `csc_id` | `text` | Só se emitir NFC-e (fora do escopo atual, mas reservar coluna) | idToken do CSC | — |
| `csc_token_cifrado` | `text` | idem | cifrado no mesmo padrão do certificado (`AES-256-GCM`) | — |

`regime_tributario` (texto `simples/presumido/real/mei`) já existe, mas **não substitui** `crt` — o XML exige o código numérico exato, e a distinção `1` vs `2` (excesso de sublimite) não é capturada pelo texto `'simples'` sozinho. Manter os dois: `regime_tributario` para regras de negócio internas, `crt` como o valor literal que vai para o XML, com uma constraint que os mantenha coerentes.

### 7.2 Valores válidos de CRT (confirmado)

| CRT | Descrição |
|---|---|
| 1 | Simples Nacional |
| 2 | Simples Nacional — excesso de sublimite de receita bruta |
| 3 | Regime Normal |
| 4 | Simples Nacional — Microempreendedor Individual (MEI/SIMEI) |

O código 4 foi incorporado por Nota Técnica específica (NT 2024.001 — "CRT MEI"), confirmando que a tabela de 3 valores é mais antiga que a atual de 4. Para a 364 (Simples Nacional, não MEI, presumidamente dentro do sublimite): **`crt = 1`** — mas confirmar com o contador se algum ano a receita bruta ultrapassou o sublimite estadual de RO, o que mudaria para `crt = 2` só para efeitos de ICMS/ISS (a empresa continua no Simples para os demais tributos).

---

## 8. DDL PostgreSQL proposto

Estilo do projeto: idempotente, `add column if not exists`, comentários por coluna, sem extensões exóticas, RLS seguindo o padrão `empresa_scoped_access` já usado em `atualizacao_22`. Seguiria como `supabase/atualizacao_36_cadastro_fiscal_nfe.sql`.

```sql
-- ============================================================================
-- atualizacao_36_cadastro_fiscal_nfe.sql
-- Cadastro fiscal de produto + motor de regras tributárias (NF-e 55, Simples
-- Nacional, RO). Idempotente. Comentário por coluna. Sem extensões exóticas.
-- ============================================================================
begin;

-- ============================================================================
-- 1) PRODUTOS — campos fiscais intrínsecos da mercadoria
-- ============================================================================
alter table public.produtos add column if not exists ncm text;
comment on column public.produtos.ncm is
  'Nomenclatura Comum do Mercosul, 8 dígitos. Tag <NCM> (det/prod). Obrigatório para emitir.';

alter table public.produtos add column if not exists ex_tipi text;
comment on column public.produtos.ex_tipi is
  'Exceção da TIPI, 2 dígitos. Tag <EXTIPI>. Só quando o NCM tem exceção vigente.';

alter table public.produtos add column if not exists cest text;
comment on column public.produtos.cest is
  'Código Especificador da Substituição Tributária, 7 dígitos. Tag <CEST>. Obrigatório quando sujeito_st = true.';

alter table public.produtos add column if not exists ncm_tabela_versao text;
alter table public.produtos add column if not exists cest_tabela_versao text;
comment on column public.produtos.ncm_tabela_versao is 'Auditoria: versão/data da tabela NCM usada ao classificar este produto.';
comment on column public.produtos.cest_tabela_versao is 'Auditoria: versão/convênio CEST usado ao classificar este produto.';

alter table public.produtos add column if not exists gtin text;
alter table public.produtos add column if not exists gtin_tributavel text;
comment on column public.produtos.gtin is
  'Código de barras comercial. Tag <cEAN>. Literal "SEM GTIN" quando não houver — nunca nulo.';
comment on column public.produtos.gtin_tributavel is
  'Código de barras da unidade tributável. Tag <cEANTrib>. Literal "SEM GTIN" quando não houver.';

alter table public.produtos add column if not exists origem_mercadoria smallint;
comment on column public.produtos.origem_mercadoria is
  'Tabela oficial 0-8 (nacional/estrangeira/conteúdo de importação). Tag <orig>, dentro do grupo ICMS/ICMSSN.';

alter table public.produtos add column if not exists unidade_tributavel text;
alter table public.produtos add column if not exists fator_conversao_tributavel numeric(12,4);
comment on column public.produtos.unidade_tributavel is
  'Unidade tributável (uTrib). A coluna "unidade" já existente é a unidade comercial (uCom).';
comment on column public.produtos.fator_conversao_tributavel is
  'Quantas unidade_tributavel cabem em 1 "unidade" (comercial). Usado para derivar qTrib = qCom * fator.';

alter table public.produtos add column if not exists peso_liquido_kg numeric(12,4);
alter table public.produtos add column if not exists peso_bruto_kg numeric(12,4);
comment on column public.produtos.peso_liquido_kg is
  'Peso líquido por unidade comercial, kg. Alimenta o grupo <vol> (transp) na emissão, não é tag de item.';
comment on column public.produtos.peso_bruto_kg is
  'Peso bruto por unidade comercial, kg. Deve ser >= peso_liquido_kg.';

alter table public.produtos add column if not exists cfop_saida_interna_referencia text;
alter table public.produtos add column if not exists cfop_saida_interestadual_referencia text;
comment on column public.produtos.cfop_saida_interna_referencia is
  'Default sugerido de CFOP para venda dentro de RO. A regra tributária (regras_tributarias) manda na emissão real.';
comment on column public.produtos.cfop_saida_interestadual_referencia is
  'Default sugerido de CFOP para venda interestadual. A regra tributária manda na emissão real.';

alter table public.produtos add column if not exists csosn_padrao text;
alter table public.produtos add column if not exists cst_icms_padrao text;
comment on column public.produtos.csosn_padrao is
  'Referência de CSOSN (Simples Nacional). A regra tributária decide o valor real usado na nota.';
comment on column public.produtos.cst_icms_padrao is
  'Referência de CST de regime normal — só relevante se a empresa deixar o Simples (CRT != 1). Mantido para contraste.';

alter table public.produtos add column if not exists sujeito_st boolean not null default false;
alter table public.produtos add column if not exists papel_st text;
comment on column public.produtos.sujeito_st is 'true quando o produto está em CEST/Convênio de ST vigente.';
comment on column public.produtos.papel_st is
  'substituto | substituido | nao_aplicavel. Pendente confirmação do contador para os itens de carne defumada da 364.';

alter table public.produtos add column if not exists cbenef_padrao text;
comment on column public.produtos.cbenef_padrao is
  'Código de benefício fiscal (tag cBenef) default deste produto, quando aplicável em RO. Ver Seção 3 do documento.';

alter table public.produtos add column if not exists lote_obrigatorio boolean not null default true;
alter table public.produtos add column if not exists validade_obrigatoria boolean not null default true;
comment on column public.produtos.lote_obrigatorio is 'Exige grupo <rastro> (nLote/qLote/dFab/dVal) na emissão.';

alter table public.produtos add column if not exists cclasstrib char(6);
alter table public.produtos add column if not exists cst_ibs_cbs char(3)
  generated always as (left(cclasstrib, 3)) stored;
comment on column public.produtos.cclasstrib is
  'Código de Classificação Tributária do IBS/CBS (LC 214/2025), 6 dígitos. Tag cClassTrib. Obrigatório p/ Simples a partir de jan/2027 (ver cronograma).';
comment on column public.produtos.cst_ibs_cbs is
  'Gerado a partir dos 3 primeiros dígitos de cclasstrib — nunca editar direto.';

alter table public.produtos add column if not exists ativo_fiscal boolean not null default false;
alter table public.produtos add column if not exists sugerido_automaticamente boolean not null default false;
alter table public.produtos add column if not exists revisado_por_id uuid references auth.users(id);
alter table public.produtos add column if not exists revisado_em timestamptz;
comment on column public.produtos.ativo_fiscal is
  'Só true depois de revisão humana dos campos fiscais. Bloqueia emissão de NF-e enquanto false.';
comment on column public.produtos.sugerido_automaticamente is
  'true quando os campos fiscais vieram do algoritmo de sugestão (Seção 5) e ainda não foram confirmados.';

-- Constraints
alter table public.produtos drop constraint if exists produtos_ncm_formato;
alter table public.produtos add constraint produtos_ncm_formato
  check (ncm is null or ncm ~ '^\d{8}$') not valid;
alter table public.produtos validate constraint produtos_ncm_formato;

alter table public.produtos drop constraint if exists produtos_cest_formato;
alter table public.produtos add constraint produtos_cest_formato
  check (cest is null or cest ~ '^\d{7}$') not valid;
alter table public.produtos validate constraint produtos_cest_formato;

alter table public.produtos drop constraint if exists produtos_origem_valida;
alter table public.produtos add constraint produtos_origem_valida
  check (origem_mercadoria is null or origem_mercadoria between 0 and 8) not valid;
alter table public.produtos validate constraint produtos_origem_valida;

alter table public.produtos drop constraint if exists produtos_gtin_valido;
alter table public.produtos add constraint produtos_gtin_valido
  check (gtin is null or public.fn_gtin_valido(gtin)) not valid;
alter table public.produtos validate constraint produtos_gtin_valido;

alter table public.produtos drop constraint if exists produtos_gtin_tributavel_valido;
alter table public.produtos add constraint produtos_gtin_tributavel_valido
  check (gtin_tributavel is null or public.fn_gtin_valido(gtin_tributavel)) not valid;
alter table public.produtos validate constraint produtos_gtin_tributavel_valido;

alter table public.produtos drop constraint if exists produtos_papel_st_valido;
alter table public.produtos add constraint produtos_papel_st_valido
  check (papel_st is null or papel_st in ('substituto', 'substituido', 'nao_aplicavel')) not valid;
alter table public.produtos validate constraint produtos_papel_st_valido;

-- ============================================================================
-- 2) MATÉRIAS-PRIMAS — mesmo bloco fiscal, para o insumo comprado
--    (necessário porque fornecedor_produto_mapa hoje só aponta pra cá — Seção 5.2)
-- ============================================================================
alter table public.materias_primas add column if not exists ncm text;
alter table public.materias_primas add column if not exists cest text;
alter table public.materias_primas add column if not exists gtin text;
alter table public.materias_primas add column if not exists gtin_tributavel text;
alter table public.materias_primas add column if not exists unidade_tributavel text;
alter table public.materias_primas add column if not exists fator_conversao_tributavel numeric(12,4);
alter table public.materias_primas add column if not exists origem_mercadoria smallint;
alter table public.materias_primas add column if not exists sugerido_automaticamente boolean not null default false;
alter table public.materias_primas add column if not exists confianca_sugestao numeric(5,2);
alter table public.materias_primas add column if not exists revisado_por_id uuid references auth.users(id);
alter table public.materias_primas add column if not exists revisado_em timestamptz;
comment on column public.materias_primas.ncm is
  'NCM do insumo tal como recebido do fornecedor (não é o NCM do produto final defumado — Seção 5.2).';
comment on column public.materias_primas.confianca_sugestao is
  'Percentual de concordância entre as notas de entrada usadas para sugerir os campos fiscais (Seção 5.3).';

-- ============================================================================
-- 3) NATUREZAS DE OPERAÇÃO
-- ============================================================================
create table if not exists public.naturezas_operacao (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  codigo text not null,                 -- identificador interno curto, ex: 'VENDA_B2B'
  descricao text not null,              -- ex: 'Venda de produção própria'
  tipo_operacao text not null check (tipo_operacao in ('entrada', 'saida')),
  fin_nfe smallint not null default 1 check (fin_nfe in (1,2,3,4)), -- 1 normal,2 complementar,3 ajuste,4 devolução
  indica_transferencia boolean not null default false,
  movimenta_estoque boolean not null default true,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (empresa_id, codigo)
);
comment on table public.naturezas_operacao is
  'O "por quê" da operação: venda, devolução, transferência, remessa p/ industrialização. Determina finNFe e restringe CFOPs válidos.';
comment on column public.naturezas_operacao.fin_nfe is 'Tag <finNFe>: 1 normal, 2 complementar, 3 ajuste, 4 devolução/retorno.';

alter table public.naturezas_operacao enable row level security;
drop policy if exists "empresa_scoped_access" on public.naturezas_operacao;
create policy "empresa_scoped_access" on public.naturezas_operacao for all
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()))
  with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

-- ============================================================================
-- 4) REGRAS TRIBUTÁRIAS — a matriz produto × natureza × destinatário × UF
-- ============================================================================
create table if not exists public.regras_tributarias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),

  -- Alvo da regra: por produto específico OU por NCM genérico (um dos dois, não os dois)
  produto_id uuid references public.produtos(id) on delete cascade,
  ncm_generico text,

  natureza_operacao_id uuid not null references public.naturezas_operacao(id),

  -- Destino: '*' = qualquer UF (regra genérica, menor precedência)
  uf_destino char(2) not null default '*',
  destinatario_contribuinte boolean,     -- null = indiferente
  destinatario_consumidor_final boolean, -- null = indiferente

  -- Saída da resolução
  cfop text not null,
  csosn text,
  cst_icms text,
  cst_ibs_cbs char(3),
  cclasstrib char(6),

  aliquota_icms_credito numeric(5,2),    -- pCredSN, só quando csosn in ('101','201')
  reducao_base_calculo_percentual numeric(5,2),
  mva_percentual numeric(6,2),
  mva_ajustada boolean not null default false,
  aliquota_interna_uf_destino numeric(5,2), -- alíquota interna da UF de destino, usada na base de ST
  fcp_percentual numeric(5,2),
  cbenef text,
  motivo_desoneracao text,

  st_responsavel text not null default 'nao_aplicavel'
    check (st_responsavel in ('substituto', 'substituido', 'nao_aplicavel')),
  isento boolean not null default false,

  base_legal text,                       -- ex: 'RICMS-RO Anexo VI, Parte 1, art. 16 §3, item 84.0'
  prioridade int not null default 100,   -- menor = mais específico = resolvido primeiro
  vigencia_inicio date not null default current_date,
  vigencia_fim date,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (produto_id is not null or ncm_generico is not null),
  check (not (produto_id is not null and ncm_generico is not null))
);
comment on table public.regras_tributarias is
  'Motor de regras: cruza produto/NCM x natureza da operação x destinatário x UF e resolve CFOP/CSOSN/base/alíquota/MVA. Nunca fixar esses valores no cadastro do produto (Seção 2).';
comment on column public.regras_tributarias.prioridade is
  'Desempate na resolução: regra por produto_id exato vence regra por ncm_generico; uf_destino exata vence "*"; contribuinte/consumidor_final definidos vencem null.';
comment on column public.regras_tributarias.aliquota_icms_credito is
  'pCredSN do CSOSN 101/201. NÃO fixar aqui um valor constante — recalcular a partir de parametros_simples_nacional na competência da emissão.';

create index if not exists regras_tributarias_produto_idx on public.regras_tributarias (empresa_id, produto_id) where ativo;
create index if not exists regras_tributarias_ncm_idx on public.regras_tributarias (empresa_id, ncm_generico) where ativo;
create index if not exists regras_tributarias_natureza_uf_idx on public.regras_tributarias (empresa_id, natureza_operacao_id, uf_destino) where ativo;

alter table public.regras_tributarias enable row level security;
drop policy if exists "empresa_scoped_access" on public.regras_tributarias;
create policy "empresa_scoped_access" on public.regras_tributarias for all
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()))
  with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

drop trigger if exists trg_regras_tributarias_updated_at on public.regras_tributarias;
create trigger trg_regras_tributarias_updated_at before update on public.regras_tributarias
  for each row execute function public.fn_set_updated_at();

-- ---------- função de resolução ----------
create or replace function public.fn_resolver_regra_tributaria(
  p_empresa_id uuid,
  p_produto_id uuid,
  p_natureza_operacao_id uuid,
  p_uf_destino char(2),
  p_contribuinte boolean default null,
  p_consumidor_final boolean default null
)
returns public.regras_tributarias
language sql
stable
as $$
  select rt.*
    from public.regras_tributarias rt
    join public.produtos p on p.id = p_produto_id
   where rt.empresa_id = p_empresa_id
     and rt.natureza_operacao_id = p_natureza_operacao_id
     and rt.ativo
     and current_date between rt.vigencia_inicio and coalesce(rt.vigencia_fim, 'infinity'::date)
     and (rt.produto_id = p_produto_id or (rt.ncm_generico is not null and rt.ncm_generico = p.ncm))
     and (rt.uf_destino = p_uf_destino or rt.uf_destino = '*')
     and (rt.destinatario_contribuinte is null or rt.destinatario_contribuinte = p_contribuinte)
     and (rt.destinatario_consumidor_final is null or rt.destinatario_consumidor_final = p_consumidor_final)
   order by
     (rt.produto_id is not null) desc,          -- regra por produto exato antes de NCM genérico
     (rt.uf_destino <> '*') desc,                 -- UF exata antes de coringa
     (rt.destinatario_contribuinte is not null) desc,
     (rt.destinatario_consumidor_final is not null) desc,
     rt.prioridade asc
   limit 1;
$$;
comment on function public.fn_resolver_regra_tributaria is
  'Resolve a regra tributária mais específica para produto+natureza+destino. Retorna null se nenhuma regra ativa casar — a aplicação deve bloquear a emissão nesse caso, nunca chutar um default.';

-- ============================================================================
-- 5) PARÂMETROS DO SIMPLES NACIONAL — a alíquota que varia por competência
-- ============================================================================
create table if not exists public.parametros_simples_nacional (
  id uuid primary key default gen_random_uuid(),
  empregador_id uuid not null references public.empregadores(id),
  competencia date not null,             -- primeiro dia do mês de referência
  anexo text not null check (anexo in ('I','II','III','IV','V')),
  rbt12 numeric(14,2) not null,          -- receita bruta acumulada 12 meses
  aliquota_nominal numeric(6,4) not null,
  parcela_deduzir numeric(14,2) not null default 0,
  aliquota_efetiva_icms numeric(6,4),    -- componente de ICMS já isolado, usado no pCredSN
  created_at timestamptz not null default now(),
  unique (empregador_id, competencia, anexo)
);
comment on table public.parametros_simples_nacional is
  'Alíquota efetiva do Simples Nacional por competência (muda mês a mês com o RBT12 — LC 123/2006). Fonte do pCredSN em CSOSN 101/201. Nunca gravar uma alíquota fixa no produto ou na regra tributária.';

alter table public.parametros_simples_nacional enable row level security;
drop policy if exists "empresa_scoped_access" on public.parametros_simples_nacional;
create policy "empresa_scoped_access" on public.parametros_simples_nacional for all
  using (
    auth.role() = 'authenticated'
    and empregador_id in (
      select e.empregador_id from public.empresas e where e.id in (select public.empresas_permitidas())
    )
  );

-- ============================================================================
-- 6) TABELAS AUXILIARES OFICIAIS (Seção 3)
-- ============================================================================
create table if not exists public.tabela_ncm (
  ncm text primary key check (ncm ~ '^\d{8}$'),
  descricao text not null,
  aliquota_ipi numeric(6,2),
  unidade_estatistica text,
  vigente_desde date not null,
  vigente_ate date,
  ato_normativo text
);
comment on table public.tabela_ncm is 'Carga periódica da TIPI/RFB. Ver Seção 3 sobre onde baixar e frequência.';

create table if not exists public.tabela_cest_nacional (
  cest text not null check (cest ~ '^\d{7}$'),
  ncm text not null,
  descricao text not null,
  anexo_convenio text,     -- ex: 'Anexo XVII' (referência ao Convênio 142/2018)
  item_convenio text,      -- ex: '84.0'
  primary key (cest, ncm)
);
comment on table public.tabela_cest_nacional is
  'Correlação CEST x NCM conforme anexos do Convênio ICMS 142/2018. Não há CSV oficial único — carga manual a partir do texto legal (Seção 3).';

create table if not exists public.cest_uf_regra (
  uf char(2) not null,
  cest text not null,
  protocolo_convenio text,          -- ex: 'Protocolo ICMS 28/93'
  mva_original numeric(6,2),
  mva_ajustada numeric(6,2),
  reducao_base_percentual numeric(6,2),
  base_legal text,                  -- ex: 'RICMS-RO Anexo VI, Tabela XVII, item 83.1'
  vigencia_inicio date not null default current_date,
  vigencia_fim date,
  primary key (uf, cest, vigencia_inicio)
);
comment on table public.cest_uf_regra is
  'Aplicação estadual do CEST: MVA e protocolo variam por UF de destino. Para RO ver RICMS-RO Anexo VI, Parte 1 (regras) e Parte 2 (MVA), achados da rodada 1.';

create table if not exists public.tabela_cfop (
  cfop text primary key check (cfop ~ '^\d{4}$'),
  descricao text not null,
  tipo char(1) not null check (tipo in ('E','S'))  -- Entrada/Saída
);
comment on table public.tabela_cfop is 'Carga a partir do Ajuste SINIEF 7/2001 e alterações posteriores (Seção 3).';

create table if not exists public.tabela_unidade_medida (
  codigo text primary key,
  descricao text not null
);
comment on table public.tabela_unidade_medida is 'Tabela de unidades de medida do Portal Nacional da NF-e (uCom/uTrib).';

create table if not exists public.municipios_ibge (
  codigo_ibge char(7) primary key,
  nome text not null,
  uf char(2) not null
);
comment on table public.municipios_ibge is
  'Carga única + revisão anual a partir de gov.br/receitafederal/dados/municipios.csv (Seção 3).';

create table if not exists public.paises (
  codigo_bacen char(4) primary key,
  nome text not null,
  codigo_iso2 char(2)
);
comment on table public.paises is 'Tabela BACEN de países (cPais). Só relevante se a 364 exportar.';

create table if not exists public.cbenef_uf (
  uf char(2) not null,
  codigo text not null,
  descricao text not null,
  base_legal text,
  vigencia_inicio date not null default current_date,
  vigencia_fim date,
  primary key (uf, codigo, vigencia_inicio)
);
comment on table public.cbenef_uf is
  'Códigos de benefício fiscal por UF (tag cBenef). RO NÃO CONFIRMADO nesta rodada se exige/publica tabela própria — ver Seção 3.';

create table if not exists public.tabela_cclasstrib_ibscbs (
  cclasstrib char(6) primary key,
  cst char(3) not null generated always as (left(cclasstrib, 3)) stored,
  descricao text not null,
  base_legal text
);
comment on table public.tabela_cclasstrib_ibscbs is
  'Tabela oficial de Classificação Tributária do IBS/CBS (LC 214/2025), publicada no Portal Nacional da NF-e / SVRS. Ver Seção 1.6 sobre a divergência de contagem de códigos encontrada na pesquisa.';

-- ============================================================================
-- 7) CLIENTES — campos fiscais do destinatário
-- ============================================================================
alter table public.clientes add column if not exists tipo_pessoa char(1) check (tipo_pessoa in ('F','J'));
alter table public.clientes add column if not exists cpf text;
alter table public.clientes add column if not exists ie text;
alter table public.clientes add column if not exists ind_ie_dest smallint check (ind_ie_dest in (1,2,9));
alter table public.clientes add column if not exists isuf text;
alter table public.clientes add column if not exists logradouro text;
alter table public.clientes add column if not exists numero text;
alter table public.clientes add column if not exists complemento text;
alter table public.clientes add column if not exists bairro text;
alter table public.clientes add column if not exists codigo_municipio_ibge char(7);
alter table public.clientes add column if not exists municipio text;
alter table public.clientes add column if not exists uf char(2);
alter table public.clientes add column if not exists cep char(8);
alter table public.clientes add column if not exists codigo_pais char(4) not null default '1058';
alter table public.clientes add column if not exists email text;
alter table public.clientes add column if not exists regime_tributario text;
alter table public.clientes add column if not exists consumidor_final boolean not null default true;
alter table public.clientes add column if not exists presenca_padrao smallint not null default 9
  check (presenca_padrao between 0 and 9);
alter table public.clientes add column if not exists situacao_cadastral_sefaz text;
alter table public.clientes add column if not exists situacao_cadastral_verificada_em timestamptz;

comment on column public.clientes.ind_ie_dest is
  'Tag <indIEDest>: 1 contribuinte ICMS, 2 contribuinte isento de inscrição, 9 não contribuinte.';
comment on column public.clientes.isuf is 'Inscrição SUFRAMA (ISUF). Só clientes em Zona Franca de Manaus/áreas de livre comércio.';
comment on column public.clientes.presenca_padrao is
  'Default de <indPres> para este cliente. 9 = operação não presencial, típico de venda B2B por pedido.';
comment on column public.clientes.situacao_cadastral_sefaz is
  'Resultado de consulta cadastral externa. Para RO, ver Seção 6.3 sobre a lacuna de web service confiável.';

alter table public.clientes drop constraint if exists clientes_ie_exige_indicador;
alter table public.clientes add constraint clientes_ie_exige_indicador
  check (ind_ie_dest is null or (ind_ie_dest = 1) = (ie is not null and ie <> ''))
  not valid;
-- not valid propositalmente: cadastro legado sem IE ainda não bate; validar
-- depois de rodar a migração de dados da Seção 5/6.

-- ============================================================================
-- 8) EMPREGADORES (emitente) — campos que faltam para emitir
-- ============================================================================
alter table public.empregadores add column if not exists inscricao_estadual text;
comment on column public.empregadores.inscricao_estadual is
  'IE do emitente em RO. Hoje só existia inscricao_municipal — falta esta para NF-e.';

alter table public.empregadores add column if not exists crt smallint check (crt in (1,2,3,4));
comment on column public.empregadores.crt is
  'Código de Regime Tributário (tag <CRT>): 1 Simples Nacional, 2 Simples excesso de sublimite, 3 Regime Normal, 4 MEI/SIMEI. Para a 364: 1, salvo confirmação de excesso de sublimite pelo contador.';

alter table public.empregadores add column if not exists iest text;
comment on column public.empregadores.iest is
  'Inscrição Estadual do Substituto Tributário nas UF onde a 364 está inscrita por força do Protocolo ICMS 28/93. NÃO é a IE de RO.';

alter table public.empregadores add column if not exists serie_nfe smallint not null default 1;
alter table public.empregadores add column if not exists proximo_numero_nfe integer not null default 1;
comment on column public.empregadores.proximo_numero_nfe is
  'Contador de numeração da NF-e (tag <nNF>). Nunca pode retroceder — controlar concorrência na aplicação (select for update).';

alter table public.empregadores add column if not exists ambiente_nfe smallint not null default 2
  check (ambiente_nfe in (1,2));
comment on column public.empregadores.ambiente_nfe is
  'Tag <tpAmb>: 1 produção, 2 homologação. Default 2 (homologação) por segurança — trocar para 1 explicitamente.';

alter table public.empregadores add column if not exists csc_id text;
alter table public.empregadores add column if not exists csc_token_cifrado text;
comment on column public.empregadores.csc_token_cifrado is
  'Código de Segurança do Contribuinte, cifrado no mesmo padrão do certificado (AES-256-GCM, ver lib/certificadoServer.js). Só necessário se emitir NFC-e — fora do escopo atual, reservado.';

alter table public.empregadores drop constraint if exists empregadores_crt_coerente_regime;
alter table public.empregadores add constraint empregadores_crt_coerente_regime
  check (
    crt is null or regime_tributario is null or
    (regime_tributario = 'simples' and crt in (1,2)) or
    (regime_tributario = 'mei' and crt = 4) or
    (regime_tributario in ('presumido','real') and crt = 3)
  ) not valid;

commit;

-- ============================================================================
-- ROLLBACK (comentado, mesma convenção das migrações anteriores)
-- ============================================================================
-- begin;
-- alter table public.empregadores drop constraint if exists empregadores_crt_coerente_regime;
-- alter table public.empregadores drop column if exists csc_token_cifrado, drop column if exists csc_id,
--   drop column if exists ambiente_nfe, drop column if exists proximo_numero_nfe, drop column if exists serie_nfe,
--   drop column if exists iest, drop column if exists crt, drop column if exists inscricao_estadual;
-- alter table public.clientes drop constraint if exists clientes_ie_exige_indicador;
-- alter table public.clientes drop column if exists situacao_cadastral_verificada_em, drop column if exists situacao_cadastral_sefaz,
--   drop column if exists presenca_padrao, drop column if exists consumidor_final, drop column if exists regime_tributario,
--   drop column if exists email, drop column if exists codigo_pais, drop column if exists cep, drop column if exists uf,
--   drop column if exists municipio, drop column if exists codigo_municipio_ibge, drop column if exists bairro,
--   drop column if exists complemento, drop column if exists numero, drop column if exists logradouro,
--   drop column if exists isuf, drop column if exists ind_ie_dest, drop column if exists ie, drop column if exists cpf,
--   drop column if exists tipo_pessoa;
-- drop table if exists public.tabela_cclasstrib_ibscbs;
-- drop table if exists public.cbenef_uf;
-- drop table if exists public.paises;
-- drop table if exists public.municipios_ibge;
-- drop table if exists public.tabela_unidade_medida;
-- drop table if exists public.tabela_cfop;
-- drop table if exists public.cest_uf_regra;
-- drop table if exists public.tabela_cest_nacional;
-- drop table if exists public.tabela_ncm;
-- drop table if exists public.parametros_simples_nacional;
-- drop function if exists public.fn_resolver_regra_tributaria;
-- drop trigger if exists trg_regras_tributarias_updated_at on public.regras_tributarias;
-- drop table if exists public.regras_tributarias;
-- drop table if exists public.naturezas_operacao;
-- alter table public.materias_primas drop column if exists revisado_em, drop column if exists revisado_por_id,
--   drop column if exists confianca_sugestao, drop column if exists sugerido_automaticamente,
--   drop column if exists origem_mercadoria, drop column if exists fator_conversao_tributavel,
--   drop column if exists unidade_tributavel, drop column if exists gtin_tributavel, drop column if exists gtin,
--   drop column if exists cest, drop column if exists ncm;
-- alter table public.produtos drop constraint if exists produtos_papel_st_valido;
-- alter table public.produtos drop constraint if exists produtos_gtin_tributavel_valido;
-- alter table public.produtos drop constraint if exists produtos_gtin_valido;
-- alter table public.produtos drop constraint if exists produtos_origem_valida;
-- alter table public.produtos drop constraint if exists produtos_cest_formato;
-- alter table public.produtos drop constraint if exists produtos_ncm_formato;
-- alter table public.produtos drop column if exists revisado_em, drop column if exists revisado_por_id,
--   drop column if exists sugerido_automaticamente, drop column if exists ativo_fiscal,
--   drop column if exists cst_ibs_cbs, drop column if exists cclasstrib,
--   drop column if exists validade_obrigatoria, drop column if exists lote_obrigatorio,
--   drop column if exists cbenef_padrao, drop column if exists papel_st, drop column if exists sujeito_st,
--   drop column if exists cst_icms_padrao, drop column if exists csosn_padrao,
--   drop column if exists cfop_saida_interestadual_referencia, drop column if exists cfop_saida_interna_referencia,
--   drop column if exists peso_bruto_kg, drop column if exists peso_liquido_kg,
--   drop column if exists fator_conversao_tributavel, drop column if exists unidade_tributavel,
--   drop column if exists origem_mercadoria, drop column if exists gtin_tributavel, drop column if exists gtin,
--   drop column if exists cest_tabela_versao, drop column if exists ncm_tabela_versao,
--   drop column if exists cest, drop column if exists ex_tipi, drop column if exists ncm;
-- drop function if exists public.fn_gtin_valido;
-- drop function if exists public.fn_gtin_digito_verificador;
-- commit;
```

(As funções `fn_gtin_digito_verificador`/`fn_gtin_valido` da Seção 4 devem ser criadas **antes** deste bloco no mesmo arquivo de migração, já que as constraints de `produtos` as referenciam.)

---

## Fontes

- Convênio ICMS 142/2018 (CEST) — `https://www.confaz.fazenda.gov.br/legislacao/convenios/2018/CV142_18` — confirmado: anexos II a XXVI trazem NCM+CEST+descrição juntos; não há tabela separada de correlação.
- Ajuste SINIEF 7/2001 (CFOP) — `https://www.confaz.fazenda.gov.br/legislacao/ajustes/2001/AJ_007_01` — confirmado como a consolidação oficial do CFOP.
- TIPI/NCM — Receita Federal, portal legislação; versão de 13/02/2026 incorporando ADE RFB nº 1/2026 localizada via busca — URL exata do arquivo não fixada.
- NT/IT Reforma Tributária IBS/CBS — `https://www.reformatributaria.com/wp-content/uploads/2026/06/NT_2025.002_v1.50_RTC_NF-e_IBS_CBS_IS.pdf` e `https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=YmYqYBW8gGQ%3D` — usados para grupos XML, cronograma e conceito de cClassTrib/CST.
- CST IBS/CBS (18 códigos) e cClassTrib (~161–164 códigos) — agregado de fontes secundárias (fiscalizeai, taxup, gsoft, taxcel) cruzadas entre si; divergência de contagem entre 161 e 164 não resolvida nesta rodada.
- CRT (1,2,3,4) — agregado de fontes secundárias sobre o MOC NF-e + NT 2024.001 (CRT MEI, `nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=6luq3tpmg08%3D`).
- Algoritmo GTIN/EAN — GS1 Brasil, `https://gs1bra.org/como-funciona-o-codigo-de-barras-gs1-gtin-13/` — confirmado.
- CSOSN (101,102,103,201,202,500,900 etc.) — agregado de fontes secundárias (actana, buscadorncm, focusnfe); não fetchado o texto legal primário (Ajuste SINIEF/Anexo específico) nesta rodada.
- `NfeConsultaCadastro4` SVRS — atendimento.receita.rs.gov.br e `https://cad.svrs.rs.gov.br/ws/cadconsultacadastro/cadconsultacadastro4.asmx` — confirmado que RO não está entre AC/ES/RN/PB/SC atendidos por esse serviço específico.
- CCC SVRS — `https://dfe-portal.svrs.rs.gov.br/nfe/ccc` — confirmado exigir login gov.br (SSO), portanto não é web service programático.
- Municípios IBGE — `https://www.ibge.gov.br/explica/codigos-dos-municipios.php` e `https://www.gov.br/receitafederal/dados/municipios.csv` — confirmados.
- Diagnóstico de código: `lib/nfe/parseNFe.js` (linhas 48-57), `supabase/schema.sql`, `supabase/atualizacao_11/22/31_*.sql` — lidos diretamente no repositório desta rodada.

## Lacunas

1. **URL exata e formato machine-readable do NCM/TIPI oficial** (RFB) não confirmada — só a existência da versão de fev/2026. Buscar diretamente em `gov.br/receitafederal` → Legislação → TIPI.
2. **Tabela cCest×NCM em formato tabular oficial** não existe — precisa consolidação manual do texto do Convênio 142/2018 (baixa prioridade dado que só ~5 CESTs interessam à 364: itens 76-78, 83-84, 87 da Tabela XVII/RICMS-RO).
3. **Contagem exata e conteúdo integral da tabela `cClassTrib`** (161 vs. 164 códigos) e se há código específico de cesta básica/alíquota reduzida aplicável a carne — checar diretamente `dfe-portal.svrs.rs.gov.br/Cff/ClassificacaoTributaria` com uma ferramenta que renderize a página (a busca por PDF falhou por ser binário).
4. **cBenef de RO**: não confirmado se RO exige o campo e onde está publicada a tabela — perguntar à SEFIN-RO ou ao contador diretamente; a Seção 3 já assinala que RO não apareceu entre os estados exigentes encontrados na pesquisa, o que é um indício, não uma confirmação.
5. **Alternativa programática de consulta cadastral de contribuinte de RO** (para validar IE de destinatário antes de emitir) não encontrada — a Redesim (`sefin.ro.gov.br/sint_consul.asp`) é candidata, mas não testada nem confirmada quanto ao retorno de IE/habilitação NF-e.
6. **Algoritmo de dígito verificador da IE de RO** não pesquisado nesta rodada — recomenda-se usar biblioteca testada (comunidade `sped-nfe`/`nfephp`) em vez de reimplementar.
7. **`papel_st` da 364** (substituto vs. substituído) segue pendente confirmação do contador, conforme já registrado no contexto da Rodada 1 — este documento modela os dois cenários via `regras_tributarias.st_responsavel`, mas não decide por um.
8. **Texto legal primário do CSOSN** (a fonte oficial — Ajuste SINIEF que instituiu a tabela) não foi fetchado; os valores usados vieram de agregadores. Baixo risco (a tabela é estável e amplamente replicada), mas vale uma checagem pontual antes de codificar em produção.