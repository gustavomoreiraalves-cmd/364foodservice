# NF-e 4.00 — Substituição Tributária: Pesquisa Técnica (base 24/08/2026)

## 1. Layout vigente e MOC

- **Layout XML**: versão **4.00** — vigente desde 2018, sem sucessor lançado até a data de corte desta pesquisa. Alterações de 2025/2026 (Reforma Tributária) são incorporadas como **extensão do próprio layout 4.00** (novo grupo de tributos, não uma versão 5.00), conforme NT 2025.002.
- **MOC (Manual de Orientação do Contribuinte)**: **versão 7.00**, publicada em **16/12/2020**, consolidando as NTs até outubro/2020. Composto por: manual principal + **Anexo I** (Leiaute NF-e/NFC-e), **Anexo II** (Manual do DANFE) e **Anexo III** (Manual de Contingência). Não foi localizada uma versão 8.00 publicada até 24/08/2026 — as mudanças da Reforma Tributária estão documentadas via NTs avulsas (2025.002 e correlatas), não em revisão geral do MOC.
  - PDF (visão geral): https://www.confaz.fazenda.gov.br/legislacao/arquivo-manuais/moc7-visao-geral.pdf
  - Anexo III (contingência): https://www.confaz.fazenda.gov.br/legislacao/arquivo-manuais/moc7-anexo-iii-manual-contingencia-nf-e.pdf
  - Índice de conteúdos oficial: https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=ndIjl+iEFdE%3D (não fetchável diretamente — ver nota em Lacunas)
- **Schemas XSD**: pacote de liberação (PL) mais recente confirmado é **PL_010c** (incorporando NT 2022.002 v.1.30), publicado **26/03/2026**. Versão anterior relevante: **PL_010b v.1.30** (novo leiaute NF-e/NFC-e com NT 2025.002 v.1.30, NT 2024.003 e NT 2025.001), publicada **07/10/2025**. Download pelo portal oficial em "Documentos > Esquemas XML":
  - https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=BMPFMBoln3w%3D
  - Espelho SVRS (RS é a Sefaz autorizadora de RO/ambiente SVRS — ver item 11): https://dfe-portal.svrs.rs.gov.br/Nfe/Documentos
  - Repositório de referência de terceiros com os XSDs do PL_009_V4 (não oficial, útil para conferência): https://github.com/nfephp-org/sped-nfe/tree/master/schemes/PL_009_V4
  - **NAO CONFIRMADO**: se em 24/08/2026 já havia PL_011 publicado incorporando definitivamente os grupos IBS/CBS/IS em produção obrigatória (a NT 2025.002 v1.5x entrou em produção 03/08/2026 — verificar qual PL a acompanha no momento da implementação).

## 2. Notas Técnicas vigentes / que entram em vigor 2025–2026

| NT | Assunto | Versão/data | Impacto no emissor |
|---|---|---|---|
| **2025.002** (RTC — IBS/CBS/IS) | Adequação do leiaute NF-e/NFC-e à Reforma Tributária do Consumo (EC 132/2023) | v1.00 (mar/2025) → v1.10 (jul/2025) → v1.20 (30/07/2025) → v1.30 → **v1.40 (27/01/2026, atualizada p/ Lei 227/2026)** → **v1.51-RTC (01/08/2026, SVRS)** | **CRÍTICO**. Cria grupo de tributos novo (referido por fornecedores como "grupo UB"), com CST próprio de IBS/CBS, `cClassTrib`, grupos `gIBSCBS`, cashback (`pDevTrib`), grupo SUFRAMA/ALC zerado (`gALCZFMCBS`), campo `refDFeAnt`, renomeação de `pISEspec`→`adRemIS`. Homologação 01/07/2025→01/07/2026 (fases); **produção padrão em 03/08/2026**; regra de devolução (VC02-14, exige `DFeReferenciado` — proíbe `refNFe` puro) em produção **01/09/2026**; obrigatoriedade de IBS/CBS para CRT 1, 2 e 4 (Simples/MEI) em **04/01/2027**. Em 2025 os campos eram opcionais/sem validação; **desde 05/01/2026 passaram a ter regras de validação efetivas**. |
| **2026.002** | Operações de venda presencial/não presencial com impressão do DANFE Simplificado | v1.10 (01/08/2026) | Regras de quando exigir DANFE Simplificado Tipo 2 em vez do DANFE completo. |
| **2026.003** | Especificações técnicas do **DANFE Simplificado Tipo 2** (Ajuste SINIEF 13/2026) | v1.00 (22/05/2026) | 9 divisões obrigatórias de conteúdo mínimo no novo formato simplificado de impressão. |
| **2026.004** | Adequação de schema para **CNPJ alfanumérico** | v1.01 (08/06/2026) | Ajuste de máscara/validação de campos de CNPJ no XSD para aceitar o novo formato alfanumérico da Receita Federal. |
| **2026.007** | Regras de validação/atualização de consulta ao Cadastro Centralizado de Contribuintes da RFB | 04/08/2026 | Reforça validação cadastral de emitente/destinatário contra base da RFB. |
| **2025.001** | Simplificação do QR-Code da NFC-e (versão 3) | v1.01 (26/06/2025) | Aplicável a NFC-e (modelo 65), não afeta diretamente NF-e 55 salvo se a empresa também emite NFC-e no restaurante. |
| Ajuste SINIEF 49/2025 (prorrogação) | Regras de transição ligadas à Reforma Tributária | Despacho 21/2026 prorrogou vigência até **08/03/2026** | Contexto normativo do cronograma acima — **NAO CONFIRMADO** o teor exato do Ajuste 49/2025 nesta pesquisa; confirmar no CONFAZ. |

Todas as NTs estão listadas oficialmente em: https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=04BIflQt1aY%3D (não fetchável — ver Lacunas) e espelhadas em https://dfe-portal.svrs.rs.gov.br/NFe/Documentos.

**Ponto de atenção crítico para o projeto**: como a emissão própria de NF-e de saída está sendo construída agora (24/08/2026), **implementar diretamente com suporte ao grupo IBS/CBS/IS da NT 2025.002 já é obrigatório**, pois a produção já está ativa desde 03/08/2026. Não compensa implementar "layout antigo" e migrar depois.

## 3. Estrutura do XML NF-e 4.00 — grupos e campos

Estrutura padrão (Anexo I do MOC 7.00 + NT 2025.002 para o bloco novo):

- **`ide`** (identificação): `cUF`, `cNF`, `natOp`, `mod` (55), `serie`, `nNF`, `dhEmi`, `dhSaiEnt`, `tpNF` (0-entrada/1-saída), `idDest` (1-interna/2-interestadual/3-exterior — **crítico para disparar ICMSUFDest**), `cMunFG`, `tpImp`, `tpEmis`, `cDV`, `tpAmb`, `finNFe` (1-normal/2-complementar/3-ajuste/4-devolução), `indFinal` (0-normal/**1-consumidor final**, dispara DIFAL), `indPres`, `indIntermed`, `procEmi`, `verProc`. Condicional mais esquecido: **`dhCont`/`xJust`** obrigatórios só em contingência.
- **`emit`**: CNPJ, `xNome`, endereço, IE, **`CRT`** (1-Simples Nacional/2-Simples excesso sublimite/3-Regime Normal) — **determina se o item usa CST ou CSOSN**.
- **`dest`**: CNPJ/CPF, `indIEDest` (1-contribuinte ICMS/2-isento/**9-não contribuinte** — dispara partilha/DIFAL junto com `idDest`), endereço.
- **`det`** (por item): `prod` + `imposto` — ver itens 4 a 9.
- **`total`** → `ICMSTot` (somatórios de todos os campos de ICMS/ST/FCP do item) e opcionalmente `ISSQNtot`, `retTrib`.
- **`transp`**: `modFrete` obrigatório; `veicTransp`, `vol` condicionais conforme operação.
- **`cobr`**: `fat` + `dup` (duplicatas) — usado quando há faturamento a prazo; não obrigatório para venda à vista.
- **`pag`**: **obrigatório desde a NT que consolidou o grupo em 2018** — `detPag` com `indPag`, `tPag` (01-dinheiro, 02-cheque, 03-cartão crédito, 04-cartão débito, 05-crédito loja, 90-sem pagamento, 99-outros), `vPag`. Se `tPag` = 03/04, grupo `card` (CNPJ da credenciadora, bandeira, autorização) passa a ser exigido sob risco de **rejeição 391**. Campo `vTroco` quando houver.
- **`infAdic`**: `infCpl` (informações complementares de interesse do contribuinte) e `infAdFisco` (uso do fisco, obrigatório em alguns benefícios fiscais/regimes especiais).
- **`infRespTec`**: identifica a software house — CNPJ, contato, `idCSRT`/`hashCSRT`. Ocorrência formalmente **0-1 (opcional no schema nacional)**, mas exigido por algumas UFs conforme calendário próprio (**AL, AM, MS, PE, PR, SC, TO** confirmaram exigência desde 07/05/2019 — **NAO CONFIRMADO se RO exige**; verificar na SEFIN-RO). Fonte: https://atendimento.tecnospeed.com.br/hc/pt-br/articles/360021735614.

Campos condicionais mais esquecidos na prática: `indTot` (0/1 — indica se `vProd` do item entra no total da nota; item errado aqui gera **rejeição 564/610** de totais divergentes), `vFrete`/`vSeg`/`vDesc` no total quando distribuídos por item, e o grupo `pag` completo mesmo em notas de bonificação/doação (usar `tPag=90` "sem pagamento").

## 4. ICMS por CST (Regime Normal) e CSOSN (Simples Nacional)

**CST (2º e 3º dígitos, regime normal — Lucro Real/Presumido; 1º dígito = origem, Tabela A: 0-nacional, 1-estrangeira import. direta, 2-estrangeira adquirida no mercado interno, 3 a 8 variações com/sem conteúdo de importação, etc.):**

| CST | Uso | Tags mínimas exigidas |
|---|---|---|
| **00** | Tributação integral, sem benefício, sem ST | `modBC`, `vBC`, `pICMS`, `vICMS` |
| **10** | Tributada **com cobrança de ICMS-ST** (o emitente é substituto ou está no meio da cadeia repassando ST) | `modBC/vBC/pICMS/vICMS` + `modBCST/pMVAST ou pauta/pRedBCST/vBCST/pICMSST/vICMSST` (+ FCP-ST se aplicável) |
| **20** | Com redução de base de cálculo, sem ST | `modBC/pRedBC/vBC/pICMS/vICMS` |
| **30** | Isenta/não tributada, **mas com ST** | Sem BC própria; grupo de ST completo (`vBCST/pICMSST/vICMSST`) |
| **40** | Isenta | Sem base própria |
| **41** | **Não tributada** — usado tipicamente para a **operação própria** quando o produto virá tributado por ST em etapa **subsequente interestadual**; combina com grupo `ICMSST`/`ICMSPart` (ver item 6) | Nenhum campo de BC própria; grupo de partilha/ST conforme o caso |
| **50** | Suspensão | Sem BC própria (ex.: industrialização por conta de terceiros) |
| **51** | Diferimento | `pDif` (percentual diferido) e `vICMSOp`/`vICMSDif` quando parcial |
| **60** | Mercadoria **já tributada por ST anteriormente** (o emitente é o substituído, revendendo produto que já chegou com ST retida) | **Não** informa BC/alíquota própria; opcionalmente informa `vBCSTRet/pST/vICMSSubstituto/vICMSSTRet` (grupo de "ST retido" — ver item 5) — a ausência desse bloco quando exigido pela UF gera **rejeição 938** |
| **70** | Redução de BC **+ ST** | Combina os campos de 20 com os de 10 |
| **90** | Outras — não deve ser usado como "coringa"; exige enquadramento real e documentação de suporte | Depende do caso concreto |

**CSOSN (Simples Nacional — CRT=1, usado no lugar de CST):**

| CSOSN | Uso | Observação |
|---|---|---|
| **101** | Tributada pelo SN com permissão de crédito | Informa `pCredSN`/`vCredICMSSN` (crédito de ICMS que o destinatário pode aproveitar) |
| **102** | Tributada pelo SN sem permissão de crédito | Sem alíquota/BC destacada |
| **201** | Tributada pelo SN com permissão de crédito **+ cobrança de ICMS-ST** | Grupo de ST completo (`modBCST/vBCST/pICMSST/vICMSST` + FCP-ST) |
| **202** | Tributada pelo SN sem permissão de crédito **+ ST** | Idem, sem `pCredSN` |
| **203** | Isenção de ICMS no SN para faixa de receita bruta **+ ST** | Combina isenção da parcela própria com ST retida na operação |
| **500** | **ICMS já cobrado anteriormente por ST** (substituído) ou por antecipação — equivalente ao CST 60 no universo SN | Campos de "ST retido" opcionais, mesma lógica do CST 60 |
| **900** | Outros — não enquadrados em 101/102/103/201/202/203/300/400/500 | Usar com cautela, mesma ressalva do CST 90 |

Fontes consolidadas: https://focusnfe.com.br/blog/cst/, https://buscadorncm.com.br/cst/csosn (uso descritivo; base legal remete ao **Convênio S/N de 1970, Anexo XLI**, e à **LC 123/2006** para o SN — **NAO CONFIRMADO** o artigo exato do Convênio nesta pesquisa; confirmar com contador antes de codificar regras).

## 5. Campos de ST em detalhe (economia de cada um)

**Bloco de retenção na operação atual (CST 10/30/70, CSOSN 201/202/203):**

- **`modBCST`** (0-6): metodologia de cálculo da base do ICMS-ST.
  - 0 = Preço tabelado/máximo sugerido pelo fabricante
  - 1 = Lista negativa (valor)
  - 2 = Lista positiva (valor)
  - 3 = Lista neutra (valor)
  - 4 = **MVA (Margem de Valor Agregado)** — modalidade mais usada; presume o preço final ao consumidor aplicando um % sobre o valor da operação própria
  - 5 = Pauta (valor fixo por unidade/tabela fiscal)
  - 6 = Valor da operação (a própria operação é a base, sem MVA)
- **`pMVAST`**: percentual de MVA (só preenchido quando `modBCST=4`; preenchê-lo com outro `modBCST` causa **rejeição 933**; não preenchê-lo com `modBCST=4` causa **rejeição 932**). Representa o "lucro presumido" adicionado à cadeia até o consumidor final, para dimensionar o imposto que será devido nas próximas etapas.
- **`pRedBCST`**: percentual de redução da base de cálculo do ST (benefício fiscal aplicado antes de calcular `vBCST`).
- **`vBCST`**: base de cálculo do ICMS-ST — valor presumido de venda futura sobre o qual incide a alíquota interna do estado de destino.
- **`pICMSST`**: alíquota interna aplicada sobre `vBCST` (normalmente a alíquota interna do produto no estado de destino, não a interestadual).
- **`vICMSST`**: valor do ICMS-ST a recolher = `(vBCST × pICMSST) − vICMS_operação_própria`. É o imposto que o substituto tributário antecipa por toda a cadeia subsequente.
- **`vBCFCPST`** / **`pFCPST`** / **`vFCPST`**: idem ao ICMS-ST, mas para o **Fundo de Combate à Pobreza** retido por ST — um adicional estadual (em RO, **2,00%** conforme fontes consolidadas — **NAO CONFIRMADO em fonte primária SEFIN-RO**, apenas em agregadores; confirmar no RICMS/RO ou com a SEFIN antes de codificar a alíquota).

**Bloco de mercadoria que chega já com ST retida (CST 60, CSOSN 500) — é o revendedor informando o que já foi pago antes na cadeia, usado principalmente para fins de ressarcimento/complemento e rastreabilidade fiscal, e cuja ausência quando exigida gera rejeição 938:**

- **`vBCSTRet`**: base de cálculo do ICMS-ST que foi retido lá atrás (informativo, herdado do documento do fornecedor).
- **`pST`**: alíquota suportada de ST na retenção original.
- **`vICMSSubstituto`**: valor do ICMS próprio do substituto embutido no preço (usado para fins de crédito/cálculo de complemento em determinadas UFs).
- **`vICMSSTRet`**: valor do ICMS-ST retido anteriormente (o que já foi pago ao fisco por quem substituiu).
- **`vBCFCPSTRet`** / **`pFCPSTRet`** / **`vFCPSTRet`**: idem para o FCP retido anteriormente.
- **`pRedBCEfet`**, **`vBCEfet`**, **`pICMSEfet`**, **`vICMSEfet`**: usados quando a UF de destino aplica **"ICMS efetivo"** menor que o presumido no ST (ex.: benefício fiscal na saída ao consumidor final que reduz a carga realmente devida) — servem de base para o **ressarcimento** do ICMS-ST retido a maior quando a venda final ocorre com carga tributária menor que a presumida. `vICMSEfet` é o imposto realmente devido; a diferença entre o ST retido (`vICMSSTRet`) e o efetivo (`vICMSEfet`) é o valor passível de ressarcimento ao contribuinte substituído.

Fontes: rejeição 932/933/938 (Tecnospeed), Jornal Contábil sobre FCP, NT 2018.005 (https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=cMMn5vosZC4%3D).

## 6. Grupo ICMSST (CST 41 em ST interestadual subsequente) e ICMSPart

- Operacionalmente, quando a **operação própria** é CST 41 (não tributada) mas a mercadoria **sairá de outro estado e voltará a ser tributada por ST na etapa seguinte interestadual** (protocolos/convênios de ST entre UFs — ex. Protocolo ICMS 41/2008 em combustíveis, extensível a outros protocolos setoriais), o schema usa o subgrupo correspondente para registrar a BC e o valor do ST que caberá à UF de destino da mercadoria na revenda.
- **`ICMSPart`**: usado em operações interestaduais com ST **quando há partilha do imposto entre UF de origem e destino** simultaneamente à retenção do ST — tipicamente vendas para contribuinte de outra UF em que o produto está sob regime de ST via protocolo interestadual. Não deve ser confundido com `ICMSUFDest` (que é para consumidor final, não contribuinte — item 7).
- **NAO CONFIRMADO** o detalhamento exato de tag-a-tag do grupo `ICMSST`/`ICMSPart` nesta pesquisa (a busca não localizou a NT 2015.003 original com o detalhamento completo de forma acessível). Antes de codificar, ler diretamente: https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=2q67SVnECYk%3D (NT 2015.003 — ICMS Interestadual). Como a 364 Food Services opera primariamente vendas locais/regionais de churrascaria e distribuição, esse grupo tende a ser de uso raro — mas se houver venda interestadual para revendedor (não consumidor final) com produto sob protocolo de ST, será necessário.

## 7. Grupo ICMSUFDest (DIFAL)

- Obrigatório quando a operação é: **`idDest=2`** (interestadual) **+** `indFinal=1` (destinado a **consumidor final**) — aplica-se tanto a consumidor final contribuinte quanto não contribuinte de ICMS, por força da **EC 87/2015**.
- Regra de validação nacional **NA01-20** exige o preenchimento do grupo `ICMSUFDest` nessas condições; a ausência gera **rejeição 694** ("Não informado o grupo de ICMS para a UF de destino").
- Campos típicos: `vBCUFDest` (base do ICMS na UF destino), `vBCFCPUFDest`, `pFCPUFDest`, `pICMSUFDest` (alíquota interna do destino), `pICMSInter` (alíquota interestadual aplicada), `pICMSInterPart` (percentual de partilha do ano-calendário — desde 2019 a partilha é 100% para a UF de destino, então normalmente `pICMSInterPart=100`), `vICMSUFDest` (ICMS que cabe à UF de destino) e `vICMSUFRemet` (**NAO CONFIRMADO se ainda é preenchido, dado que a partilha é 100% destino desde 01/01/2019** — na prática esse campo tende a ficar zerado, mas confirmar no schema vigente).
- Relevante para o projeto: se a 364 Food Services vender diretamente a um consumidor final fora de RO (ex.: e-commerce ou entrega para pessoa física em outro estado), esse grupo entra em jogo, junto com o cálculo do FCP da UF de destino (que varia por estado, não é o FCP de RO).
- Fonte: https://clicknotas.com.br/rejeicao-694-nf-e/, https://atendimento.tecnospeed.com.br/hc/pt-br/articles/360012311734-NF-e-Como-resolver-a-Rejei%C3%A7%C3%A3o-694.

## 8. IPI, PIS, COFINS

- **IPI**: CST próprio (00-Entrada tributada, 49-Outras entradas, 50-Saída tributada, 51-Saída não tributada, 52-Saída isenta, 53-Saída imune, 54-Saída suspensa, 55-Saída outras — **tabela não confirmada em detalhe nesta pesquisa, base geral conhecida**). Destaca-se IPI apenas quando o emitente é **industrial ou equiparado a industrial** (produção interna de produtos da churrascaria/carnes processadas pode se enquadrar — depende do NCM e da atividade real, confirmar com contador se a produção interna configura industrialização para fins de IPI). O **Código de Enquadramento Legal do IPI** (`cEnq`) precisa ser compatível com o CST informado, sob pena de **rejeição 225**.
- **PIS/COFINS**: CST de 01 a 99, refletindo regime cumulativo/não cumulativo, alíquota zero, monofásico, substituição tributária de PIS/COFINS (bebidas frias, por exemplo) ou não incidência. Alimentos em geral não estão no rol clássico de monofásico (que é majoritariamente combustíveis, bebidas frias, cosméticos e medicamentos), mas a **Tabela 4.3.10 da RFB** especifica produtos sujeitos a alíquotas diferenciadas/monofásicas por incidência e por pauta, incluindo **bebidas frias (CST 02 e 04)** — relevante se a 364 revender bebidas industrializadas. Tabela atualizada em **30/03/2026**: http://sped.rfb.gov.br/arquivo/show/1638.
- **NAO CONFIRMADO**: enquadramento específico de PIS/COFINS para carnes/produtos de churrascaria da 364 (cumulativo vs. não cumulativo depende do regime do Lucro — Real ou Presumido — da empresa, informação que não estava no escopo desta pesquisa técnica de layout). Recomenda-se validar com o contador da empresa antes de fixar CSTs padrão no sistema.

## 9. Campos do produto

- **`cProd`**: código interno do produto — livre, sob controle do emitente.
- **`cEAN`/`cEANTrib`**: devem ser preenchidos com o **GTIN** real do produto (código de barras) quando ele existir; se o produto não tiver GTIN, preencher literalmente **"SEM GTIN"**. `cEAN` refere-se à unidade comercializada e `cEANTrib` à unidade tributável (podem divergir quando a unidade de venda difere da unidade tributada, ex. caixa vs. unidade). Desde a **NT 2021.003** (que substituiu a antiga **NT 2017.001**/2016.001; publicada 13/09/2021, atualizada para v1.40 em 2025), a Sefaz autorizadora **valida o GTIN informado contra o Cadastro Centralizado de GTIN (CCG)** administrado pela GS1 Brasil/RFB, rejeitando (**rejeição 883** para GTIN ausente, e rejeições específicas para GTIN não localizado/divergente no CCG) quando há inconsistência de descrição, NCM ou GTIN não localizado. Fundamento legal: **Ajustes SINIEF 07/2005 e 19/2016**. Fonte: https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=SrQT9ys8ODo%3D.
- **`NCM`**: 8 dígitos, deve existir na tabela oficial NCM do MDIC/RFB vigente — NCM inexistente gera **rejeição 778**; NCM incompleto (menos de 8 dígitos onde exigido) gera **rejeição 777**.
- **`CEST`**: código de 7 dígitos, instituído pelo **Convênio ICMS 92/2015** e regulamentado pelo **Convênio ICMS 142/2018** (Anexos II a XXVI listam NCM × CEST × descrição por segmento de ST). **Obrigatório apenas para mercadorias sujeitas a ST/antecipação listadas nesses anexos**; nem todo NCM tem CEST. Se informado, o prefixo do CEST precisa ser compatível com o capítulo do NCM (tabela de vinculação do Convênio 142/2018) — incompatibilidade gera rejeição de CEST×NCM incompatível.
- **`CFOP`**: 4 dígitos, precisa ser compatível com o grupo de tributação de ICMS do item (`CST`/`CSOSN`) e com a natureza da operação (`natOp` em `ide`) — incompatibilidade gera **rejeição 374**.
- **`uCom`/`qCom`/`vUnCom`**: unidade, quantidade e valor unitário comerciais. **`uTrib`/`qTrib`/`vUnTrib`**: unidade, quantidade e valor unitário tributável — usados quando a tributação (ex. ICMS-ST por pauta/unidade) precisa de uma unidade diferente da comercial (ex. venda em caixa, tributação por kg).
- **`indTot`**: já descrito no item 3 — indica se `vProd` do item entra no total da nota.
- **`rastro`** (Grupo I80 — lote/validade): **obrigatório para medicamentos e produtos farmacêuticos** por determinação regulatória; para **carnes (capítulo NCM 02) e demais alimentos, o preenchimento é opcional do ponto de vista estritamente fiscal/SEFAZ**. Isso **não dispensa** obrigações sanitárias paralelas (rastreabilidade SIF/MAPA para estabelecimentos com Serviço de Inspeção Federal, rotulagem de validade ANVISA) — essas exigências correm por fora do XML da NF-e, em sistemas próprios (ex. SIGSIF do MAPA). Recomenda-se, ainda assim, preencher `rastro` na NF-e da 364 por boa prática de rastreabilidade e para facilitar eventual recall, mesmo sem obrigatoriedade fiscal estrita. **NAO CONFIRMADO** exigência estadual específica de RO para preenchimento de `rastro` em carnes — verificar RICMS/RO.
- **Grupos `med`/`veicProd`**: confirmam-se como **não aplicáveis** ao negócio da 364 (medicamentos e veículos, respectivamente, são segmentos regulatórios distintos sem relação com carnes/alimentos/churrascaria).

## 10. Rejeições mais comuns ligadas a ST/NCM/CEST/CFOP

| Código | Causa |
|---|---|
| **778** | NCM informado não existe na tabela oficial (MDIC/RFB) |
| **777** | NCM incompleto (menos de 8 dígitos quando exigido) |
| **225** | Código de Enquadramento Legal do IPI incompatível com o CST de IPI informado |
| **374** | CFOP incompatível com o grupo de tributação de ICMS (CST/CSOSN) do item |
| **694** | Grupo `ICMSUFDest` não informado quando a operação exige (venda interestadual a consumidor final) |
| **883** | GTIN (`cEAN`) sem informação quando deveria ter sido preenchido |
| **932** | `modBCST=4` (MVA) informado sem o campo `pMVAST` |
| **933** | `pMVAST` informado com `modBCST` diferente de 4 |
| **938** | Item com CST/CSOSN de "ST retido anteriormente" sem os campos `vBCSTRet`, `pST`, `vICMSSubstituto`, `vICMSSTRet` exigidos pela UF |
| **391** | `tPag` de cartão sem o grupo `card` correspondente |
| **564/610** | Valor total do produto ou da nota diverge do somatório dos itens (frequentemente por erro no `indTot` ou arredondamento) |
| **656** | "Consumo indevido" — não é erro de conteúdo, é limite de requisições ao webservice da Sefaz excedido (rate limit, ~20 req/hora por certificado) |
| **615** | **NAO CONFIRMADO** — não foi possível localizar o significado exato deste código nesta pesquisa; verificar na tabela oficial de códigos de rejeição do MOC Anexo I ou no portal da Sefaz autorizadora antes de tratá-lo no código. |

Fontes: Tecnospeed Central de Atendimento (artigos por código, ver URLs nos resultados de busca acima), buscadorncm.com.br, oobj.com.br/bc.

## 11. Eventos: cancelamento, CC-e, inutilização, manifestação do destinatário

- **Cancelamento**: prazo padrão nacional consolidado por ajuste SINIEF em **24 horas** após a autorização, desde que a mercadoria não tenha circulado nem o serviço tenha sido prestado. Após esse prazo, o cancelamento é **extemporâneo**, exigindo justificativa e, em alguns estados, processo administrativo. Para **Rondônia**, foi localizada apenas uma **Instrução Normativa (IN14-008)** tratando de cancelamento extemporâneo de **NFA-e (Nota Fiscal Avulsa Eletrônica) de produtores rurais** — não confirma o procedimento genérico de NF-e modelo 55 emitida por empresa (SEFIN-RO): https://www.sefin.ro.gov.br/portalsefin/anexos/IN14-008-Cancelamento-extemporaneo-NF-e.pdf. **NAO CONFIRMADO** se RO adota exatamente 24h como prazo padrão ou outro prazo específico via RICMS/RO — o "24h" é regra nacional consolidada em ajuste SINIEF de 2026, mas o **texto exato do ajuste e sua incorporação formal ao RICMS/RO não foi lido nesta pesquisa**; confirmar antes de travar essa regra no sistema.
- **Carta de Correção Eletrônica (CC-e)**:
  - **Pode corrigir**: dados cadastrais que não alterem completamente o remetente/destinatário, informações de transporte, dados adicionais, informações que não tenham impacto no cálculo do imposto nem na identificação do produto/operação.
  - **NÃO pode corrigir**: valores fiscais (base de cálculo, alíquota, quantidade, valor da operação/preço), dados que mudem completamente o destinatário, e a **data de emissão/saída**. Erros dessa natureza exigem cancelamento (dentro do prazo) e nova emissão, ou nota complementar/de ajuste conforme o caso.
  - **Prazo**: até **30 dias (720 horas)** após a autorização da NF-e; uma mesma nota pode receber até **20 CC-e** sequenciais, sempre valendo a última.
- **Inutilização de numeração**: evento para "queimar" faixas de numeração que não serão usadas (pulos de sequência, testes, erro de série), evitando quebra de sequência perante o fisco. Prazo regulamentar padrão: **até o 10º dia do mês subsequente** (regra clássica nacional — **NAO CONFIRMADO nesta pesquisa em fonte primária**, é conhecimento de domínio; confirmar no MOC Anexo I ou RICMS/RO antes de codificar o prazo).
- **Manifestação do destinatário** (relevante para a 364 no papel de **destinatária** de NF-e de fornecedores, já parcialmente coberto pelo módulo de leitura de entrada existente): eventos **Ciência da Emissão**, **Confirmação da Operação**, **Desconhecimento da Operação** e **Operação Não Realizada** (as três últimas são conclusivas, mutuamente exclusivas, até 2 registros cada, valendo sempre a última). Prazo histórico: **180 dias** da autorização. Fonte secundária (blog, não primária) indica **redução para 90 dias a partir de 01/06/2026** — **NAO CONFIRMADO em fonte primária** (não foi possível ler a NT/Ajuste SINIEF correspondente diretamente); como o sistema já lê NF-e de entrada, vale confirmar esse prazo com a Sefaz/NT oficial antes de ajustar regras de alerta de prazo no sistema.

## 12. DANFE

- Regras no **Anexo II do MOC 7.00**. Impressão obrigatória em **2 vias** (uma acompanha o trânsito da mercadoria e vai ao destinatário, outra fica com o emitente) para NF-e em papel; formato pode ser A4 ou reduzido ("DANFE Simplificado").
- **DANFE Simplificado Tipo 2** (novidade **2026**, Ajuste SINIEF 13/2026, especificado pela **NT 2026.003 v1.00** de 22/05/2026 e regras de uso pela **NT 2026.002 v1.10** de 01/08/2026): define **9 divisões obrigatórias** de conteúdo mínimo no layout reduzido — útil se a 364 quiser adotar impressão simplificada para vendas de balcão/entrega, mas o detalhamento tag-a-tag dessas 9 divisões **não foi lido nesta pesquisa (NAO CONFIRMADO)**; ler a NT 2026.003 diretamente antes de implementar.
- **DANFE de contingência**: quando emitida em contingência offline (SVC ou EPEC), deve constar a inscrição **"EMITIDA EM CONTINGÊNCIA – Pendente de autorização"** impressa em pelo menos dois locais visíveis do documento, e o QR-Code/chave de acesso segue regra específica de assinatura (RSA SHA-1 em Base64 com o certificado do emitente) para permitir validação posterior. Duas alternativas técnicas de contingência: **EPEC** (Evento Prévio de Emissão em Contingência — permite imprimir DANFE em papel comum enquanto aguarda autorização) e **SVC** (Sefaz Virtual de Contingência — reenvio do XML a uma Sefaz alternativa).

---

## Fontes

- https://www.confaz.fazenda.gov.br/legislacao/arquivo-manuais/moc7-visao-geral.pdf — confirma MOC versão 7.00, publicado 16/12/2020.
- https://www.confaz.fazenda.gov.br/legislacao/arquivo-manuais/moc7-anexo-iii-manual-contingencia-nf-e.pdf — Anexo III do MOC (contingência).
- https://dfe-portal.svrs.rs.gov.br/NFe/Documentos — fetchado diretamente; confirmou MOC 7.00 (16/12/2020), lista de NTs 2025/2026 (2025.001 v1.01, 2025.002 v1.51-RTC de 01/08/2026, 2026.002/2026.003/2026.004/2026.007 com datas).
- https://focusnfe.com.br/notas-tecnicas/nfe/2025-002/ — fetchado; cronograma detalhado da NT 2025.002 v1.00/v1.01/v1.10 (homologação/produção 2025-2026).
- https://inventti.com.br/nt-2025-002-v1-40-da-nf-e-nfc-e-amplia-controles-da-reforma-tributaria-com-novos-campos-grupos-e-validacoes-de-ibs-e-cbs/ — fetchado; detalhamento de grupos/tags da NT 2025.002 v1.40 (gALCZFMCBS, refDFeAnt, ISUFEmit, pDevTrib, cronograma até jan/2027).
- https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=YmYqYBW8gGQ%3D — documento oficial "Reforma Tributária do Consumo – Adequações NF-e/NFC-e" (URL confirmada em resultados de busca, não fetchada diretamente por bloqueio de redirecionamento).
- https://www.sefin.ro.gov.br/portalsefin/anexos/IN14-008-Cancelamento-extemporaneo-NF-e.pdf — IN sobre cancelamento extemporâneo (NFA-e produtor rural, RO).
- https://focusnfe.com.br/blog/cst/, https://buscadorncm.com.br/cst/csosn — tabelas de CST e CSOSN de ICMS.
- https://www.confaz.fazenda.gov.br/legislacao/convenios/2018/CV142_18 — Convênio ICMS 142/2018 (CEST, Anexos II-XXVI).
- https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=SrQT9ys8ODo%3D — NT sobre validação de GTIN (referência à NT 2021.003).
- https://atendimento.tecnospeed.com.br/hc/pt-br/articles/360014971074, .../360012311734, .../360022725593, .../360034049894, .../360034050174, .../360011010814 — artigos técnicos detalhando modBCST, rejeição 694 (ICMSUFDest), rejeição 938 (ST retido), rejeições 932/933 (pMVAST), rejeição 883 (GTIN).
- http://sped.rfb.gov.br/arquivo/show/1638 — Tabela 4.3.10 RFB de produtos monofásicos/pauta PIS-COFINS, atualizada 30/03/2026.
- https://blog.tecnospeed.com.br/nota-tecnica-2026-003-danfe-simplificado-tipo-2/ e https://portalspedbrasil.com.br/forum/nf-e-nfc-e-nota-tecnica-2026-002-versao-1-00... — NT 2026.002 e 2026.003 (DANFE Simplificado Tipo 2, Ajuste SINIEF 13/2026).
- https://simplifique.contmatic.com.br/blogs/prazo-de-cancelamento-de-nota-fiscal-regras-2026, https://simplifique.contmatic.com.br/blogs/cancelar-nfe-carta-correcao — prazos de cancelamento (24h) e regras de CC-e (o que pode/não pode corrigir, prazo de 30 dias/720h, limite de 20 CC-e).

## Lacunas (não confirmado / requer verificação adicional)

1. **Acesso direto às páginas oficiais nfe.fazenda.gov.br** (listaConteudo.aspx de MOC e de NTs) falhou por loop de redirecionamento no WebFetch desta sessão. Os dados foram obtidos via espelho SVRS (fonte quase-primária, mesma infraestrutura Sefaz Virtual) e via citações de terceiros. **Recomenda-se acessar manualmente https://www.nfe.fazenda.gov.br/portal/ pelo navegador** para conferir a lista completa e oficial de NTs e a data exata de cada uma antes de fixar o cronograma de implementação no sistema.
2. **Alíquota de FCP de Rondônia (2,00%)** veio de agregador secundário, não do RICMS/RO ou de tabela oficial da SEFIN-RO — **confirmar no RICMS/RO (Decreto 22.721/2018) ou diretamente com a SEFIN-RO/contador** antes de codificar.
3. **Detalhamento tag-a-tag dos grupos `ICMSST` e `ICMSPart`** (item 6) não foi lido na NT 2015.003 original — necessário para implementar corretamente vendas interestaduais com ST sob protocolo, caso a 364 venda para revendedores fora de RO.
4. **Prazo de manifestação do destinatário** (180 → 90 dias a partir de 01/06/2026) veio de fonte secundária (blog) — confirmar na NT/Ajuste SINIEF oficial.
5. **Prazo de inutilização de numeração** (10º dia do mês subsequente) é conhecimento de domínio geral, não confirmado em fonte primária nesta pesquisa.
6. **Significado exato da rejeição 615** não foi localizado.
7. **Obrigatoriedade de `infRespTec` especificamente para Rondônia** não confirmada — a lista de UFs localizada (AL, AM, MS, PE, PR, SC, TO) não inclui RO, mas isso não confirma que RO dispense o campo; **checar diretamente com a SEFIN-RO**.
8. **Se o pacote de schemas em produção em 24/08/2026 já é um PL_011** (pós-produção obrigatória da NT 2025.002 desde 03/08/2026) ou ainda PL_010c — verificar a versão exata do XSD a ser usado no momento da implementação, baixando diretamente do portal oficial.
9. **Enquadramento de PIS/COFINS (cumulativo/não-cumulativo) e de IPI (industrial ou não) específico da 364 Food Services** depende do regime tributário real da empresa (Lucro Real/Presumido) e da classificação da atividade de produção interna como industrialização — **fora do escopo de uma pesquisa de layout**; consultar o contador da empresa.
10. Para todos os pontos acima marcados **NAO CONFIRMADO**, a recomendação operacional é: antes de codificar a regra no emissor, abrir a NT/RICMS oficial correspondente pelo link listado, ou ligar para a SEFIN-RO (atendimento ao contribuinte) para confirmação por escrito.