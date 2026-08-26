# Levantamento técnico — campos do cadastro de produto

Data: 2026-08-25
Escopo: o que é **obrigatório**, o que é **condicional**, o que é **irrelevante** e o
que **falta** no cadastro de produto, considerando emissão de NF-e/NFC-e, gestão,
BI, marketing, contabilidade/fiscal, B2B e B2C.

---

## 1. Estado atual (medido na produção, não estimado)

| Fato | Valor |
|---|---|
| `produtos` | 11 linhas (10 reais + 1 de teste), 37 colunas |
| `materias_primas` | 7 linhas (insumos comprados, já com NCM/CEST/GTIN próprios) |
| `pdv_vendas_itens_dia` | 96.022 linhas, **404 itens distintos**, 32 categorias, histórico desde 2022 |
| `pdv_pedido_itens` | 477.396 linhas |
| `regras_tributarias` | 1 linha |
| `grupos_tributarios` | populado, mas 10 de 11 produtos sem grupo |
| `ficha_tecnica` | 9 linhas |
| `cliente_precos` | 0 linhas (tabela existe, não usada) |
| `nfe_documentos` | 1 linha |
| Empregadores | 364 Steakhouse (RO, CNAE 5611201, `regime_tributario = simples`, **`crt` nulo**) e 364 Buffet e Eventos |

Preenchimento fiscal de `produtos` (11 registros):

- sem NCM: 10
- sem origem da mercadoria: 10
- sem GTIN: 11
- sem grupo tributário: 10
- `ativo_fiscal = true`: 0

### 1.1. A constatação estrutural mais importante

Existem **dois catálogos que não se falam**:

1. `produtos` — os 10 itens embalados/industrializados (Costela Defumada 500g,
   Croquete 500g, Geleia…). São os itens de **NF-e (B2B, revenda, distribuidor)**.
2. O catálogo do PDV Consumer — **404 itens** (pratos, bebidas, complementos,
   adicionais), que existem apenas como `codigo_detalhe` + `nome` + `categoria`
   dentro de `pdv_vendas_itens_dia` / `pdv_pedido_itens`. São os itens de
   **NFC-e (B2C, salão, delivery, loja/trailler)**.

**Não existe tabela de mapeamento entre os dois.** Melhorar `produtos` sem
resolver isso melhora o cadastro de 11 itens e deixa 404 itens de fora da
emissão. Qualquer projeto de NFC-e depende de um catálogo de venda unificado —
seja importando os itens do PDV para `produtos` com um `codigo_pdv`, seja criando
`produto_pdv_mapa` análogo ao `fornecedor_produto_mapa` já existente.

Isso não é um campo a acrescentar; é a decisão de arquitetura que precede a
lista de campos.

---

## 2. Obrigatório para emitir — grupo `<prod>` da NF-e/NFC-e (layout 4.00)

Todos os itens abaixo são obrigatórios em **toda** nota, NF-e (modelo 55) e
NFC-e (modelo 65), independentemente do regime. "Rejeita" = a SEFAZ devolve
rejeição, a nota não autoriza.

| Tag | O que é | Coluna hoje | Status |
|---|---|---|---|
| `cProd` | código do produto no emitente | `produtos.codigo` | OK |
| `xProd` | descrição, até 120 caracteres | `produtos.nome` | OK — **falta validar limite de 120 e caracteres proibidos** |
| `NCM` | 8 dígitos | `produtos.ncm` | coluna existe, **10 de 11 vazios** |
| `CFOP` | 4 dígitos | `regras_tributarias.cfop` | OK (vem da regra, não do produto — correto) |
| `uCom` | unidade comercial | `produtos.unidade` | OK |
| `qCom`, `vUnCom`, `vProd` | quantidade e valores | transacional | OK |
| `uTrib`, `qTrib`, `vUnTrib` | unidade tributável | `unidade_tributavel` + `fator_conversao_tributavel` | OK |
| `cEAN`, `cEANTrib` | GTIN — literal `SEM GTIN` quando não houver | `gtin`, `gtin_tributavel` | OK (comentário do schema já documenta o literal) |
| `indTot` | 0 ou 1: se o valor do item soma no total da nota | **não existe** | **LACUNA** — ver 2.1 |
| `orig` (ICMS) | origem da mercadoria, 0–8 | `origem_mercadoria` | coluna existe, **10 de 11 vazios** |
| `CSOSN` (CRT 1/2) ou `CST` (CRT 3) | tributação do ICMS | `regras_tributarias.csosn` / `cst_icms` | OK |
| `CST` PIS e COFINS | | `regras_tributarias.cst_pis` / `cst_cofins` | OK |

### 2.1. `indTot` — a lacuna com impacto direto no restaurante

`indTot` diz se o valor do item entra no total da nota. Vale 1 no caso normal e
0 quando o item é acessório de outro item já valorado.

O catálogo do PDV tem **56 itens em "Complemento"** e **18 em "Adicionais"**.
Dependendo de como o PDV valora esses itens (preço próprio ou embutido no prato),
a NFC-e precisa de `indTot = 0` para eles, ou o total da nota fecha errado e a
nota rejeita por divergência de somatório. É um campo booleano por produto, e
sem ele não há como emitir NFC-e de mesa com adicionais.

### 2.2. Regime tributário — bloqueio antes do produto

`empregadores.crt` está **nulo** nas duas empresas, embora
`regime_tributario = 'simples'`. `crt` é a tag `<CRT>` do emitente e define se o
item leva CSOSN (CRT 1) ou CST (CRT 3). Enquanto estiver nulo, nenhuma regra
tributária pode ser validada corretamente. Corrigir isso vale mais que qualquer
campo novo em `produtos`.

---

## 3. Condicional — obrigatório conforme a natureza do item

| Tag / campo | Quando passa a ser obrigatório | Coluna hoje | Relevante para nós? |
|---|---|---|---|
| `CEST` | item listado no Convênio ICMS 142/2018 (mesmo fora de ST na operação) | `produtos.cest` | **Sim** — bebidas, cervejas, refrigerantes |
| `EXTIPI` | NCM com exceção da TIPI vigente | `ex_tipi` | Raro; coluna existe |
| `indEscala` + `CNPJFab` | produto industrializado, CRT 1 e 2, conforme NT 2016.002 | `ind_escala`, `cnpj_fabricante` | **Sim** — os 10 defumados são industrializados por nós |
| Grupo `<rastro>` (lote, fabricação, validade) | produtos sujeitos a controle sanitário/rastreabilidade | `rastro_obrigatorio` + `validade_dias` | **Sim, verificar com o contador** — carne defumada embalada |
| `vTotTrib` (Lei 12.741/2012 — transparência) | toda venda a consumidor final; NFC-e sempre | `aliquota_transparencia` | **Sim** |
| ICMS-ST retido anteriormente (CSOSN 500, `vBCSTRet`, `pST`) | revenda de mercadoria já tributada por ST | `sujeito_st` + `regras_tributarias` (`mva_percentual`, `aliquota_st_retido`) | **Sim** — 27 bebidas + 22 cervejas no PDV; em RO, bebida tem ST |
| `pesoL`, `pesoB` | grupo `<vol>` do transporte, NF-e com frete | `peso_liquido_kg`, `peso_bruto_kg` | Sim, para B2B/entrega |
| `cBenef` | benefício fiscal com código na UF | `regras_tributarias.cbenef` | Depende de RO |
| IBS/CBS (`cClassTrib`, `CST`) | a partir de 04/01/2027 | reservado desde a migração 36 | **Adiado por decisão** — manter reservado |

---

## 4. Irrelevante para o nosso ramo — decidir **não** cadastrar

Estes grupos existem no layout da NF-e mas nunca serão usados por restaurante,
defumados e buffet. Registrar aqui evita que voltem à pauta:

- `<comb>` / `cProdANP` — combustíveis.
- `<med>` / `cProdANVISA` — medicamentos.
- `<arma>` — armamento.
- `<veicProd>` — veículos novos.
- `<DI>`, `<adi>` — importação direta. Só passa a valer se importarmos sem
  intermediário; hoje não é o caso.
- `<detExport>` — exportação.
- `nRECOPI`, `<nVE>` — papel imune, exportação indireta.
- IPI por produto — no Simples não há destaque de IPI. Não construir UI agora.
- `<nItemPed>` / `xPed` — pedido de compra do cliente: é **transacional**, entra
  na emissão, não no cadastro.

Também irrelevante como campo de cadastro: preço de venda **do PDV**. O preço já
vem do PDV por item e por dia (`pdv_vendas_itens_dia.preco_venda`);
`produtos.preco_venda` deve ser o preço de tabela B2B, não uma segunda verdade
sobre o preço de salão.

---

## 5. Gestão, venda, B2B e B2C

| Necessidade | Existe? | Observação |
|---|---|---|
| Preço por canal / por cliente | `cliente_precos` existe, **0 linhas** | B2B com distribuidor exige tabela de preço por cliente e vigência. Hoje há um preço único. |
| Vigência de preço | **não existe** | Sem `vigencia_inicio`/`fim`, não há histórico de reajuste nem margem correta retroativa. |
| Unidade de venda × unidade de compra | parcial | `unidade_tributavel` + `fator_conversao_tributavel` cobrem o fiscal; falta o caixa/fardo comercial (ex.: vender caixa com 10 × 500 g). |
| Pedido mínimo / múltiplo de venda B2B | **não existe** | Necessário quando o canal B2B entrar em operação. |
| Custo | `custo_unitario` + ficha técnica | OK; o plano já resolve o duplo ponto de edição. |
| Item vendável × insumo × sub-receita | **não existe** | O PDV tem categoria "Sub Receitas" (5 itens) e "Desativados" (39 itens) — classificação enfiada dentro da categoria. |
| Canal de venda | **não existe** | Idem: "LOJA / Trailler" (30) e "Entrega" (5) são canais fingindo ser categoria. |
| `updated_at` e autor da última alteração | **não existe** | Já previsto no plano em execução (item 4). |
| Data de ativação / desativação | só `ativo` booleano | Sem data, a série histórica não sabe quando um item saiu de linha. |

---

## 6. BI e marketing

O ativo de BI já existe e é grande: 96 mil linhas de venda diária por item, com
custo, lucro, margem e curva ABC pré-calculados desde 2022. O que falta é
**dimensão**, não fato.

| Falta | Por quê |
|---|---|
| Taxonomia de categoria com FK (grupo → subgrupo) | Hoje `categoria` é texto livre: 32 valores no PDV, 4 em `produtos`, com duplicatas evidentes ("Bebida" e "Bebidas", "Hambúrgueres" e "Hamburguer mesa"). Isso quebra qualquer agrupamento de BI. |
| Flag de canal (salão / delivery / loja / trailler / B2B) | Permite comparar margem por canal, hoje impossível. |
| Tipo do item (vendável, adicional, sub-receita, insumo) | Base de `indTot` no fiscal **e** de mix de vendas no BI — um campo, dois usos. |
| Vínculo produto ↔ item do PDV | Sem ele, os 404 itens do PDV não herdam NCM, custo de ficha técnica nem classificação. |
| Menu engineering (estrela / cavalo / quebra-cabeça / abacaxi) | **Derivável**, não cadastrável — sai de quantidade × margem. Não criar campo; criar a view. |
| Sazonalidade / item de campanha | "Promoção" (22 itens) e "Dia Dos Namorados" (7) hoje viram categoria permanente e sujam a série histórica. Um par de datas resolve. |
| Alergênicos e informação nutricional | Para produto **embalado** com etiqueta (é o nosso caso: 500 g, etiqueta, `modelo_etiqueta` e `conservacao_texto` já existem), a rotulagem de alergênicos é exigida pela RDC 26/2015. **Confirmar com o responsável técnico** antes de tratar como opcional. |
| Registro SIF / MAPA | Produto de origem animal embalado para revenda. **Confirmar com o contador/RT** se o registro precisa constar na etiqueta e no cadastro. |

---

## 7. Contábil e fiscal (além da emissão)

| Campo | Situação |
|---|---|
| Tipo do item (SPED, Bloco 0200: 00 revenda, 03 em processo, 04 acabado, 09 serviço) | **não existe** — o contador precisa disso para o Bloco 0200 do SPED e para separar revenda de produção própria. É o mesmo campo do item 6 ("tipo do item"), servindo a três finalidades. |
| Código do serviço (LC 116) | **não existe** — a 364 Buffet e Eventos vende serviço; se emitir NFS-e, precisa do código de serviço municipal por item. Hoje o cadastro só modela mercadoria. |
| Conta contábil / centro de custo do item | `centros_custo` existe como tabela; não há vínculo com produto. |
| Grupo tributário | existe e é a abordagem certa (regra por grupo, não por SKU); **10 de 11 produtos sem grupo** — problema de dado, não de schema. |

---

## 8. Lacunas priorizadas

**Onda 0 — bloqueios que não são campo de produto**
1. Preencher `empregadores.crt` (Simples = 1).
2. Decidir a arquitetura do catálogo de venda: importar os 404 itens do PDV para
   `produtos` com `codigo_pdv`, ou criar `produto_pdv_mapa`.
3. Preencher NCM, origem e grupo tributário dos 10 produtos existentes.

**Onda 1 — campos que destravam emissão**
4. `indTot` (booleano por produto) — sem ele não há NFC-e com adicionais.
5. `tipo_item` (vendável / adicional / sub-receita / insumo / serviço) — serve a
   `indTot`, ao Bloco 0200 do SPED e ao BI de uma vez só.
6. Validação de `xProd`: 120 caracteres e caracteres aceitos.
7. CEST + dados de ST nas bebidas (é onde a NFC-e vai rejeitar primeiro).

**Onda 2 — gestão e BI**
8. Taxonomia de categoria com FK (grupo/subgrupo), migrando os 32 textos livres.
9. `canal_venda`.
10. `updated_at` + autor (já no plano corrente).
11. Datas de ativação/desativação e vigência de campanha.

**Onda 3 — B2B**
12. `cliente_precos` em uso, com vigência.
13. Unidade de venda comercial (caixa/fardo), pedido mínimo, múltiplo.

**Não fazer agora**
- IBS/CBS (decisão já tomada: revisitar perto de 04/01/2027).
- Aba de estoque, perguntas, complementos, imagem, descrição de cardápio
  (cortadas pelo usuário em 2026-08-25).
- Todos os grupos do item 4 (combustível, medicamento, arma, veículo,
  importação, exportação, IPI por produto).

---

## 9. Perguntas em aberto para o contador / responsável técnico

1. CRT das duas empresas: ambas Simples Nacional (1) ou alguma é Simples com
   excesso de sublimite (2)?
2. Os defumados 500 g: NCM confirmado por item, e há benefício ou redução em RO?
3. `indEscala`: nossa produção se enquadra como "escala não relevante"?
4. Bebidas revendidas: ST já retida na compra (CSOSN 500) ou tributação normal?
5. Rastro (lote/validade) na NF-e é exigido para carne defumada embalada?
6. Alergênicos e SIF na etiqueta: obrigatórios no nosso formato de embalagem?
7. A 364 Buffet e Eventos vai emitir NFS-e? Se sim, qual código de serviço LC 116?
