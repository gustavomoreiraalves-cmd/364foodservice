# Mapa de Emissão de NF-e — Indústria/Distribuidora de Alimentos em RO com Produtos em ST

**Base normativa geral aplicável a todos os itens:**
- CFOP: Convênio s/nº de 15/12/1970 (Anexo Código Fiscal de Operações e Prestações), última tabela consolidada por **Ajuste SINIEF 3/2022** — que teria extinto os CFOPs "5.400/6.400/1.400/2.400" (série específica de ST) a partir de 03/04/2023 — **revogado/adiado sem nova data pelo Ajuste SINIEF 29/2023**. Guias de 2026 (ex. Blog Simplifique Contmatic, ago/2026) ainda descrevem 5401/5403/5405/5410/5411 como códigos em uso ativo. **Recomendação:** confirmar no site do CONFAZ (confaz.fazenda.gov.br/legislacao/ajustes) se algum Ajuste SINIEF de 2025/2026 finalmente aposentou essa série antes de codificar no sistema — não encontrei um ajuste posterior que tenha efetivado a extinção. NAO CONFIRMADO o status definitivo pós-29/2023.
- CST ICMS (regime normal): Tabela B do Convênio s/nº 15/12/1970, atualizada por Ajustes SINIEF (o mais recente com impacto geral é o Ajuste SINIEF 1/2023, que criou 02/15/53/61 para monofásico de combustíveis — não aplicável a alimentos).
- CSOSN (Simples Nacional): criado pelo Ajuste SINIEF 3/2010, tabela vigente reproduzida no Manual de Orientação do Contribuinte (MOC) da NF-e.
- RICMS-RO: **Decreto nº 22.721/2018** (SEFIN-RO, legislacao.sefin.ro.gov.br), com alterações posteriores (ex. Decreto 28.273/2023). Não consegui abrir o texto integral consolidado nesta pesquisa — os artigos/anexos específicos citados abaixo para RO estão sinalizados como NAO CONFIRMADO quando não veio o número exato do artigo.
- DIFAL (venda a não contribuinte): **Convênio ICMS 236/2021** (DOU 06/01/2022, efeitos desde 01/01/2022), que revogou o Convênio ICMS 93/2015 após a declaração de inconstitucionalidade formal deste pelo STF (ADI 5.469 e RE 1.287.019 — repercussão geral, Tema 1.093) por falta de lei complementar; a LC 190/2022 supriu a exigência.
- Transferência entre estabelecimentos: **ADC 49/STF** (mérito 2021, modulação de efeitos a partir do exercício de 2024) + **LC 204/2023** (alterou a Lei Kandir para excluir a transferência do fato gerador) + **Convênio ICMS 109/2024** (DOU 07/10/2024, efeitos desde 01/11/2024, revogou o Convênio ICMS 178/2023).

---

## 1. Venda de produção própria a contribuinte (revendedor) — com retenção de ST

- **Operação:** indústria/364 vende produto de sua própria fabricação a outro contribuinte (revendedor), sendo a 364 a substituta tributária que retém e recolhe o ICMS-ST da cadeia subsequente.
- **CFOP:**
  - Interno (RO→RO): **5.401** — "Venda de produção do estabelecimento em operação com produto sujeito ao regime de substituição tributária, na condição de contribuinte substituto".
  - Interestadual: **6.401** (mesma descrição, saída para outro estado).
  - Não há CFOP de entrada nesta operação (é saída na 364).
- **CST ICMS (Lucro Presumido/Real):** **10** — "Tributada e com cobrança do ICMS por substituição tributária" (a operação própria é tributada normalmente e, adicionalmente, retém-se o ICMS-ST da etapa seguinte).
- **CSOSN (Simples Nacional):** **201** — "Tributada pelo Simples Nacional com permissão de crédito e com cobrança do ICMS por substituição tributária" (se a mercadoria comporta crédito, ex. revenda por atacadista) ou **202** — sem permissão de crédito. **Atenção:** mesmo optante do Simples, ao atuar como substituto tributário, o ICMS-ST retido é calculado **fora** da sistemática do Simples (alíquota interna do destino aplicada sobre a base com MVA, não a alíquota do Simples) — LC 123/2006, art. 13, §1º, XIII, "a".
- **Tratamento da ST:** base de cálculo = (valor da operação própria + frete/seguro/outras despesas + IPI, quando destinado a uso/consumo ou ativo do destinatário — regra geral MVA) × (1+MVA-ST do item, conforme Anexo/Protocolo aplicável a carnes) menos o ICMS próprio da operação. Campos NF-e: grupo `ICMSST` (vBCST, pICMSST, vICMSST), grupo `ICMS10`. MVA e ato normativo específico (Protocolo/Convênio de carnes que RO subscreve, ex. família dos protocolos de carne bovina/suína — não confirmei o número exato aplicável a RO em 2026) — **NAO CONFIRMADO**, checar Anexo I do RICMS-RO (item 104 do Anexo I trata de carne suína, conforme achado na pesquisa) e tabela de MVA vigente com o contador/SEFIN-RO.
- **CST IPI:** normalmente **50** (saída tributada, se IPI incidir sobre o produto) — na prática, carnes in natura costumam ter **NT (não tributado, CST 53)** ou serem imunes/isentas conforme TIPI; produtos industrializados de churrascaria podem ter incidência. Confirmar NCM/TIPI item a item — NAO CONFIRMADO genericamente, depende do produto.
- **CST PIS/COFINS:** regra geral **01** (tributável à alíquota básica) no Lucro Presumido/Real (não cumulativo ou cumulativo conforme regime); no Simples Nacional o PIS/COFINS está embutido no DAS, mas a NF-e ainda exige CST (geralmente **49** — outras operações de saída, ou **99**), a depender do software/parametrização.
- **refNFe:** não se aplica (venda original, não é devolução/retorno).
- **infAdic (Dados Adicionais):** indicar dispositivo legal da ST aplicado ("ICMS retido por substituição tributária nos termos do art. XX do RICMS-RO / Protocolo/Convênio ICMS XX"), base de cálculo e valor do ICMS-ST retido, se a UF do destinatário exigir (muitas SEFAZ de destino cobram essa informação em texto livre além dos campos estruturados).
- **Estoque/financeiro:** baixa de estoque de produto acabado; no financeiro, ICMS-ST retido é **repasse** (não é receita/custo da 364) — deve ser lançado como obrigação a recolher (GNRE/DARE) distinta da receita de venda; ICMS próprio é dedução de receita bruta (ou, no Simples, compõe a base do DAS via PGDAS, com o ICMS-ST expressamente segregado).
- **Regime tributário — diferença:**
  - *Lucro Presumido/Real:* ICMS próprio destacado em CST 10; PIS/COFINS não cumulativo (Real) permite crédito nas aquisições, cumulativo (Presumido) não.
  - *Simples Nacional:* CSOSN 201/202; a receita da venda própria entra no PGDAS (Anexo I ou II conforme atividade), com o ICMS **próprio** sendo parte do DAS, mas o **ICMS-ST retido de terceiros** é sempre segregado e recolhido fora do DAS (GNRE em separado).

---

## 2. Venda de mercadoria de terceiros (revenda) com ST já retida — CST 60 / CSOSN 500

- **Operação:** 364 revende mercadoria adquirida de fornecedor que já reteve o ICMS-ST (a 364 é a "substituída").
- **CFOP:**
  - Interno: **5.405** — "Venda de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária, na condição de contribuinte substituído".
  - Interestadual: **6.405**.
  - Entrada (compra da mercadoria já com ST retida pelo fornecedor): **1.403/2.403** — "Compra de mercadoria sujeita ao regime de substituição tributária" (uso: quando o fornecedor já reteve o ICMS-ST na nota de venda a 364).
- **CST ICMS:** **60** — "ICMS cobrado anteriormente por substituição tributária".
- **CSOSN:** **500** — "ICMS cobrado anteriormente por substituição tributária ou por antecipação".
- **Campos de ST retida na NF-e:** grupo `ICMS60`/`CSOSN500` — `vBCSTRet` (base de cálculo do ICMS-ST retido na operação anterior), `vICMSSTRet` (valor do ICMS-ST retido anteriormente), e desde a NT 2018.005/versão 4.00 também `vBCFCPSTRet`/`vFCPSTRet` (FCP retido, se houver) e `pST`, `vICMSSubstituto` (NT 2021.002 — valor do ICMS próprio do substituto, campo informativo para cálculo de crédito em operações interestaduais). Não há novo cálculo de ST — apenas repasse informativo do que já foi retido.
- **CST IPI/PIS/COFINS:** iguais à lógica do item 1 (depende do produto/regime); em regra, revenda de mercadoria de terceiros não gera novo destaque de IPI (a 364 não é industrializadora desse item nessa operação).
- **refNFe:** não se aplica (venda normal); mas é boa prática manter rastreabilidade da nota de compra (chave de acesso) no controle interno de estoque/ST para eventual pedido de ressarcimento.
- **infAdic:** "ICMS-ST retido anteriormente pelo remetente conforme NF-e nº ..., de .../.../...".
- **Estoque/financeiro:** baixa de estoque a custo de aquisição (que já embute o ICMS-ST pago ao fornecedor, contabilizado como custo, não como imposto a recuperar, salvo regimes especiais); nenhuma nova ST a recolher — venda "líquida" de ICMS-ST na saída.
- **Regime tributário:** idêntico raciocínio de CST 60/CSOSN 500 em qualquer regime — a diferença é apenas contábil: no Simples Nacional, a receita de revenda de mercadoria com ST **é segregada e excluída da base do DAS** referente ao ICMS (Resolução CGSN 140/2018, art. 25, §8º), pois o imposto já foi recolhido antes.

---

## 3. Venda a não contribuinte / consumidor final (dentro e fora do estado) — DIFAL

- **Dentro de RO (mesmo estado):** CFOP **5.101** (produção própria) ou **5.102** (mercadoria de terceiros) — mesmo CFOP usado para contribuintes, pois não há partilha interestadual a apurar. CST/CSOSN seguem a mesma lógica do item 1/2 conforme a mercadoria seja produção própria ou revenda, com ou sem ST.
- **Fora de RO, destinado a não contribuinte (pessoa física ou empresa não inscrita):**
  - CFOP: **6.107** (venda de produção do estabelecimento, destinada a não contribuinte) ou **6.108** (venda de mercadoria de terceiros, destinada a não contribuinte). Se a mercadoria estiver sob ST e o ICMS-ST já cobrir a carga total do destino (o que é comum, pois convênios/protocolos de ST fixam MVA usando a alíquota interna do destino), a prática de mercado é ainda usar 6.401/6.403/6.405 conforme o caso de substituto/substituído — **a escolha entre 6.107/6.108 x 6.401/6.403/6.405 depende de a mercadoria estar ou não em regime de ST** (CFOP de ST prevalece sobre o de não contribuinte). NAO CONFIRMADO qual regra específica RO adota quando as duas classificações colidem — validar no MOC/NT do produto.
- **CST/CSOSN:** os mesmos códigos de ICMS (00/10/60 ou 101/201/500 etc.) dependendo se a mercadoria é produção própria/ST ou revenda com ST retida — a condição de "não contribuinte" não altera o CST/CSOSN da operação própria, mas ativa os campos de DIFAL.
- **DIFAL (EC 87/2015 + Convênio ICMS 236/2021):**
  - Aplicável **somente quando a mercadoria NÃO estiver sob o regime de ICMS-ST interestadual** cobrindo a carga total do destino — quando já há ST interestadual retida com MVA calculada pela alíquota interna do destino, normalmente não há DIFAL residual a recolher (a lógica do "ICMS origem + ICMS destino" já foi endereçada dentro do cálculo do ST). Confirmar cláusula específica do Convênio 236/2021 e do RICMS-RO que trata da não cumulação DIFAL/ST — **NAO CONFIRMADO o número exato da cláusula**.
  - Quando aplicável, o remetente (364) é o responsável pelo recolhimento do DIFAL = (alíquota interna do estado de destino do consumidor final − alíquota interestadual aplicável) × base de cálculo, acrescido do FCP do estado de destino, se instituído.
  - Campos NF-e: grupo `ICMSUFDest` — `vBCUFDest`, `pFCPUFDest`, `pICMSUFDest`, `pICMSInter`, `pICMSInterPart` (partilha, hoje 100% para o destino desde 2019 — Convênio ICMS 153/2015), `vFCPUFDest`, `vICMSUFDest`, `vICMSUFRemet` (este último zerado desde 2019, pois toda a diferença vai para o destino).
  - Recolhimento: GNRE por operação (regra geral) ou por apuração mensal se a 364 tiver inscrição de substituto/contribuinte no estado de destino — verificar se RO exige inscrição estadual virtual nos destinos de maior volume.
- **infAdic:** identificar se é consumidor final não contribuinte e o cálculo do DIFAL/FCP quando não vier automaticamente estruturado e exigido pela UF de destino.
- **Estoque/financeiro:** baixa de estoque igual às demais vendas; financeiramente, o DIFAL é um tributo adicional a recolher via GNRE, contabilizado como obrigação fiscal distinta do ICMS próprio.
- **Regime tributário:** Simples Nacional **também está sujeito ao DIFAL** desde a EC 87/2015 (LC 123/2006, art. 13, §1º, XIII, "h", e ADI 5464/STF que suspendeu a exigência do Simples até a LC 190/2022 regularizar — hoje plenamente exigível). A diferença é que, no Simples, o ICMS "normal" da venda permanece dentro do DAS, e apenas o DIFAL é recolhido à parte (GNRE), tal como no regime normal.

---

## 4. Devolução de venda

### 4.1 Cliente contribuinte emite a nota de devolução (regra geral)
- CFOPs do cliente (saída de devolução, espelhando a natureza da compra original):
  - Produção própria da 364, sem ST: **5.201/6.201** ("Devolução de venda de produção do estabelecimento" — nomenclatura usada pelo comprador para "devolução de compra").
  - Mercadoria de terceiros, sem ST: **5.202/6.202**.
  - Produção própria, com ST: **5.410/6.410**.
  - Mercadoria de terceiros, com ST: **5.411/6.411**.
- CFOPs de entrada na 364 (espelho, mesma classificação): **1.201/2.201** (produção própria s/ ST), **1.202/2.202** (terceiros s/ ST), **1.410/2.410** (produção própria c/ ST), **1.411/2.411** (terceiros c/ ST).
- **CST/CSOSN da nota de entrada:** deve espelhar exatamente o CST/CSOSN da nota de saída original (mesma alíquota, mesma base, mesmo tratamento de ST) — é o princípio de "espelhamento" da devolução.
- **refNFe:** **obrigatório** — grupo `NFref`/`refNFe` com a chave de acesso de 44 dígitos da NF-e de venda original. Sem isso a devolução não se vincula à venda para fins de estorno de débito/crédito e recuperação de ST.
- **ST retida — devolução total ou parcial:**
  - **Total:** estorna-se integralmente o ICMS-ST da operação (débito do fisco que havia sido antecipado pela 364 substituta é revertido); a 364 pode se creditar do ICMS-ST relativo à mercadoria devolvida, respeitado o procedimento do RICMS-RO (em regra: crédito do ICMS próprio da nota + estorno/recuperação do ICMS-ST proporcional, via escrituração no livro de apuração ou EFD, campo específico de "ressarcimento/complemento de ICMS-ST").
  - **Parcial:** o estorno de débito (ICMS próprio) e a recuperação de ST são proporcionais à quantidade/valor efetivamente devolvido — a nota de devolução parcial deve referenciar a NF-e original (refNFe) e detalhar item a item a proporção devolvida; **não se emite complementar de estorno "livre"**, o valor deve bater com a proporção matemática dos itens da nota original.
  - **Direito a ressarcimento da ST:** quando a devolução é feita por consumidor final ou cliente fora da cadeia (não haverá nova saída tributada daquela mercadoria pela 364), a 364 tem direito à restituição/ressarcimento do ICMS-ST pago a maior (art. 150, §7º da CF/88 c/c Convênio ICMS 142/2018, cláusulas vigésima quinta a vigésima nona, que disciplinam ressarcimento) — procedimento específico no RICMS-RO (pedido administrativo, nota de ressarcimento ao fornecedor substituto ou crédito em conta gráfica, conforme o modelo adotado pelo estado). **NAO CONFIRMADO o rito específico (prazo, formulário) do RICMS-RO** — validar com SEFIN-RO/contador antes de operacionalizar.

### 4.2 Cliente não contribuinte / não obrigado a emitir NF (a 364 emite a Nota Fiscal de Entrada)
- A própria 364 emite **NF-e de Entrada** (modelo 55, mod=1 "entrada", indicando na tag `ide/mod` e no CRT/finNFe o motivo "devolução"), com CFOP de entrada compatível (1.201/2.201, 1.202/2.202, 1.410/2.410 ou 1.411/2.411 conforme o caso), citando os dados do não contribuinte no campo destinatário (agora remetente de fato) e **refNFe** apontando a NF-e de venda original.
- Base legal: prática consolidada a partir do Convênio SINIEF s/nº de 15/12/1970 (cláusula segunda, item devolução) e reproduzida nos RICMS estaduais — **NAO CONFIRMADO o artigo exato do RICMS-RO/Decreto 22.721/2018** que disciplina a nota de entrada por devolução de não contribuinte; confirmar com a SEFIN-RO/contador (em SP, por exemplo, é art. 452 do RICMS/SP — regra análoga costuma existir no RICMS-RO).
- Mesmo raciocínio de espelhamento de CST/CSOSN, estorno de ST e direito a ressarcimento do item 4.1 se aplica.
- **infAdic:** identificar que a devolução é de mercadoria vendida a não contribuinte/consumidor final que não possui inscrição estadual, citando CPF/CNPJ do devolvente e a nota de venda original.
- **Estoque/financeiro:** reentrada de mercadoria no estoque pelo custo/valor da venda original (ajustado se houver avaria); financeiramente, estorno de receita e do imposto correspondente; se o cliente já havia pago, gera crédito/reembolso a processar no contas a receber.

---

## 5. Devolução de compra (364 devolve ao fornecedor)

- **Operação:** a 364, na condição de compradora, devolve mercadoria ao fornecedor.
- **CFOP:**
  - Sem ST: **5.201** (devolução de compra para industrialização/produção) ou **5.202** (devolução de compra para comercialização), conforme a destinação original da compra; interestadual **6.201/6.202**.
  - Com ST (mercadoria que havia entrado com ICMS-ST retido, ex. compra de insumo/revenda já com CST 60/CSOSN 500 recebida): **5.410/6.410** (industrialização) ou **5.411/6.411** (comercialização).
- **CST/CSOSN:** espelha o CST/CSOSN da nota de compra original (se entrou como 60/CSOSN 500, a devolução sai com 60/500; se entrou tributada normal, sai com CST/CSOSN correspondente).
- **refNFe:** obrigatório, apontando a NF-e de compra original recebida do fornecedor.
- **ST na devolução de compra:** quando a mercadoria devolvida tinha ICMS-ST retido pelo fornecedor, a 364 informa nos campos de devolução o valor de ICMS-ST que está sendo revertido, para que o fornecedor (substituto) possa se ressarcir/creditar do ST relativo à mercadoria não vendida. A 364, por sua vez, estorna o crédito de custo que havia lançado.
- **infAdic:** motivo da devolução (avaria, não conformidade, prazo de validade, erro de pedido), referência à NF-e de compra.
- **Estoque/financeiro:** baixa do estoque da mercadoria devolvida ao fornecedor; se a compra já estava paga, gera direito a crédito/reembolso do fornecedor (nota de débito ou compensação em duplicatas a pagar).
- **Regime tributário:** sem diferença estrutural relevante entre Simples e Presumido/Real nesta operação — o CST/CSOSN apenas espelha o que veio na nota de compra original.

---

## 6. Bonificação / doação / brinde

- **CFOP:**
  - Bonificação/doação (mercadoria em si, sem contraprestação financeira, mas dentro do relacionamento comercial): **5.910** (interno) / **6.910** (interestadual) — "Remessa em bonificação, doação ou brinde".
  - Brinde (item comprado especificamente para distribuição promocional, sem venda): também classificado sob **5.910/6.910** conforme a nomenclatura atual da tabela (a codificação separada 5.912 antiga foi consolidada) — mas alguns sistemas ainda usam nomenclaturas específicas de "brinde" internamente; confirmar no ERP se há distinção operacional necessária. NAO CONFIRMADO se há CFOP hoje verdadeiramente distinto para "brinde" puro vs. bonificação — a tabela vigente unifica na descrição "bonificação, doação ou brinde".
- **Incidência de ICMS:** a bonificação em mercadoria (entrega de unidades adicionais sem cobrança, dentro da mesma nota ou nota apartada) é operação de saída de mercadoria e, portanto, **incide ICMS normalmente** sobre o valor atribuído à mercadoria bonificada (não há previsão geral de isenção para bonificação em mercadoria — diferente do desconto incondicional). É diferente de "desconto incondicional" (abatimento no preço da própria venda, sem entrega de mercadoria extra), que **não integra a base de cálculo do ICMS** por não haver saída de mercadoria distinta.
- **ST na bonificação:** se a mercadoria bonificada está sujeita a ST, o ICMS-ST **também incide** sobre a bonificação, pois a ST recai sobre a circulação física da mercadoria destinada a revenda, independentemente de haver contraprestação — o substituto deve calcular a ST sobre a bonificação da mesma forma que na venda.
- **IPI:** incide sobre a saída de produto industrializado bonificado (fato gerador é a saída do estabelecimento industrial, art. 35, II, do RIPI/2010, independentemente de haver ou não venda) — **NAO CONFIRMADO** eventual isenção específica de bonificação no RIPI (diferente da amostra grátis, que tem isenção expressa no art. 54, III); tratar como tributado, salvo confirmação em contrário.
- **PIS/COFINS e jurisprudência:**
  - **Bonificação em mercadoria** (produto extra, sem redução de preço unitário na nota): jurisprudência consolidada do STJ (REsp repetitivo — Tema **não é 1.049**; a matéria histórica de bonificação x desconto na base do PIS/COFINS foi tratada em precedentes como o REsp 1.111.156/SP e outros julgados de 2ª Turma) entende que bonificação em mercadoria, quando não representa redução de preço, **não integra a receita bruta** e, portanto, não compõe a base de PIS/COFINS. **Atenção:** essa matéria está **atualmente sub judice** no **Tema Repetitivo nº 1.412 do STJ** (RE sps 2.221.794/PR, 2.221.800/RS, 2.223.143/RS), com julgamento pautado para **20/08/2026** e **adiado sem nova data até o momento** (conforme ConJur, 19/08/2026) — ou seja, **não há tese vinculante fixada até a data de hoje (24/08/2026)**; a Primeira Turma do STJ historicamente entende que bonificações/descontos não compõem a base de PIS/COFINS, enquanto a Segunda Turma diverge. **Recomendação prática:** manter a posição de não tributação de bonificações em mercadoria genuínas (sem redução simulada de preço), mas monitorar o desfecho do Tema 1.412 antes de consolidar a prática fiscal, dado o risco de guinada jurisprudencial.
  - **Desconto incondicional** (redução de preço no próprio corpo da nota, sem entrega extra de mercadoria): não compõe a base de ICMS nem de PIS/COFINS — mas somente enquanto anotado incondicionalmente e discriminado no próprio documento fiscal.
- **infAdic:** indicar expressamente "bonificação comercial, sem efeitos financeiros" / "mercadoria em bonificação — não sujeita a pagamento" para blindar a caracterização perante fiscalização.
- **Estoque/financeiro:** baixa de estoque a custo (sem lançamento de receita de venda); no financeiro, tratado como despesa comercial (redução de margem)/benefício ao cliente, sem gerar título a receber.
- **Regime tributário:** Simples Nacional deve considerar a bonificação como saída sem receita (não gera DAS sobre o valor não cobrado), mas se a mercadoria estiver sob ST, o ICMS-ST retido segue as mesmas regras do item 1 (cálculo fora do Simples).

---

## 7. Amostra grátis e degustação

- **CFOP:** **5.911** (interno) / **6.911** (interestadual) — "Remessa de amostra grátis".
- **Requisitos de caracterização (Convênio ICMS 29/1990, cláusula primeira):** produto sem valor comercial, em quantidade não superior a 20% do conteúdo/peso da menor embalagem comercializada pelo fabricante (a legislação prevê parâmetros de quantidade reduzida), gravado com a expressão "distribuição gratuita, proibida a venda" na própria embalagem, e destinado exclusivamente a demonstração/degustação — **não se aplica a bonificação ou brinde**.
- **ICMS:** isento, desde que cumpridos os requisitos do Convênio 29/90 e observada a legislação interna do estado de origem (RO) e de destino, quando aplicável.
- **IPI:** isento — art. 54, III, do RIPI (Decreto 7.212/2010), condicionado a valor unitário não superior ao limite legal e identificação clara como amostra.
- **PIS/COFINS:** regra geral, receita zero (não há venda), portanto sem base de incidência; alguns entendimentos tratam a saída de amostra grátis como despesa/custo comercial, sem efeito de receita tributável.
- **ST:** amostra grátis, por não ter finalidade de revenda/comercialização, em regra **não sofre incidência de ICMS-ST** (não há próxima etapa de circulação onerosa a proteger) — mas confirmar tratamento específico no RICMS-RO, já que alguns estados exigem menção explícita de dispensa. NAO CONFIRMADO artigo exato do RICMS-RO.
- **Degustação interna (consumo no próprio estabelecimento/evento, sem saída para terceiro estabelecimento):** pode não configurar sequer fato gerador de saída de mercadoria (uso e consumo próprio) — tratar como baixa de estoque por consumo/brinde interno, sem emissão de NF-e de saída, salvo se a degustação ocorrer fora do estabelecimento (feira, evento externo), quando se recomenda nota de remessa (ver item 9).
- **infAdic:** "Amostra grátis, sem valor comercial – Convênio ICMS 29/90" / não destacar IPI na nota (nota sem destaque).
- **Estoque/financeiro:** baixa de estoque a custo, lançada como despesa de marketing/promoção (não como devolução nem venda).

---

## 8. Transferência entre estabelecimentos (matriz/filial)

- **Regra vigente em 2026 (pós-ADC 49):**
  - **Não incidência de ICMS** na transferência de mercadorias entre estabelecimentos do mesmo titular, interna ou interestadual — decisão de mérito do STF na **ADC 49** (mérito 2021), com **modulação de efeitos a partir do exercício financeiro de 2024**, e **LC 204/2023**, que alterou a Lei Kandir (LC 87/1996) para excluir formalmente a transferência do fato gerador do ICMS e **assegurar a manutenção do crédito** relativo às operações anteriores.
  - **Transferência de crédito:** disciplinada hoje pelo **Convênio ICMS 109/2024** (revogou o Convênio ICMS 178/2023), em vigor desde 01/11/2024. Diferentemente do Convênio 178/2023 (que tornava a transferência de crédito **obrigatória**), o Convênio 109/2024 tornou a transferência de crédito **um direito do contribuinte, não uma obrigação** — cláusula sexta permite, como alternativa, que o contribuinte **opte por equiparar a transferência a uma operação tributada normalmente** (destacando ICMS como se fosse venda), opção essa **anual, irretratável, formalizada até 31 de dezembro** para vigorar no ano seguinte. Há notícia de um **Convênio ICMS 7/2026** que teria limitado a transferência de créditos em hipóteses de não incidência — **NAO CONFIRMADO o teor exato**; validar diretamente no CONFAZ antes de aplicar, pois pode ter alterado a sistemática vigente em 2026.
  - **CFOP:** mesmo sem incidência de ICMS "normal", ainda se usa CFOP específico de transferência: **5.152/6.152** ("Transferência de mercadoria adquirida ou recebida de terceiros") ou **5.151/6.151** ("Transferência de produção do estabelecimento"), conforme a origem da mercadoria — **NAO CONFIRMADO se esses CFOPs de transferência (51xx) permanecem exatamente com essa numeração após os ajustes recentes**; a família 5.15x é a historicamente usada e não constou entre os códigos citados como extintos pelas fontes consultadas.
  - **CST ICMS na transferência:** como regra, **41** (não tributada) quando o contribuinte não optar pela equiparação a operação tributada; se optar pela equiparação (cláusula sexta do Convênio 109/2024), usa CST **00** ou **10**, conforme haja ou não ST envolvida.
- **ST na transferência:** é o ponto mais sensível — a lógica do STF na ADC 49 é que a transferência não é "próxima etapa de comercialização", logo **não deveria haver nova retenção de ICMS-ST na simples transferência entre estabelecimentos do mesmo titular** (jurisprudência e doutrina, ex. Prolik Advogados, abr/2025, sustentam a inconstitucionalidade da exigência de ST em transferências). Na prática operacional, contudo: **(i)** se a mercadoria já saiu do fabricante/CD de origem com ICMS-ST retido anteriormente (produto já "encerrado" para fins de ST), a transferência apenas desloca fisicamente o estoque, sem nova retenção — usa CST 60/CSOSN 500 espelhando a condição de substituído; **(ii)** se a 364 é a substituta e a mercadoria transferida ainda vai ser vendida a terceiros a partir do estabelecimento de destino, a retenção de ST ocorre **na saída de destino para o cliente final** (não na transferência) — mas alguns estados de destino exigem inscrição de substituto tributário e recolhimento de ST **já na entrada por transferência** (ST "por entrada", equivalente a antecipação). **Isso é estado a estado; verificar protocolo/convênio específico de carnes de cada UF de destino das filiais da 364 antes de definir se há ST devida na própria transferência.** NAO CONFIRMADO de forma genérica — depende de cada UF de destino.
- **infAdic:** "Transferência entre estabelecimentos do mesmo titular — não incidência de ICMS nos termos da LC 87/1996, art. 12, §4º (redação da LC 204/2023) e ADC 49/STF" e, se optante pela transferência de crédito, indicar o valor do crédito transferido conforme Convênio ICMS 109/2024.
- **Estoque/financeiro:** transferência de estoque entre centros de custo/filiais (sem receita de venda), com controle de custo médio mantido; se a empresa optar por equiparar a operação tributada, gera efeito de "venda interna" para fins de margem entre unidades de negócio (uso gerencial), mas sem impacto de receita consolidada na demonstração financeira da pessoa jurídica única.

---

## 9. Remessas e retornos (industrialização por encomenda, conserto, comodato, feira, venda ambulante)

| Operação | CFOP saída (interno/interestadual) | CFOP retorno (interno/interestadual) | Observações |
|---|---|---|---|
| Industrialização por encomenda (364 remete insumo a terceiro industrializador) | **5.901/6.901** | **5.902/6.902** (retorno de mercadoria industrializada) e **5.903/6.903** (retorno de mercadoria recebida para industrialização e não aplicada no processo, se sobrar insumo) | Sobre o valor agregado pelo industrializador (mão de obra + insumos próprios dele) incide ICMS normal na nota de retorno (CFOP 5.902 do industrializador para a 364); não há incidência sobre o valor da mercadoria de origem, que já é da 364 (regra de suspensão do imposto na saída/retorno da mercadoria-base, mantendo-se a tributação apenas sobre a industrialização). |
| Conserto/reparo | **5.915/6.915** (remessa para conserto) | **5.916/6.916** (retorno de conserto) | Em regra sem incidência de ICMS quando não há mudança de natureza/nova mercadoria; suspensão do imposto. |
| Comodato | **5.908/6.908** (remessa em comodato) | **5.909/6.909** (retorno de comodato) | Sem incidência de ICMS (não há transferência de propriedade); CST 41 (não tributada). Entrada correspondente em quem recebe: **1.908/2.908**. |
| Exposição/feira | **5.914/6.914** (remessa para exposição ou feira) | **5.914/6.914** correspondente de retorno costuma usar o mesmo código de "outras saídas"/"retorno de exposição" — confirmar nomenclatura exata vigente | Sem incidência de ICMS na remessa (não há venda); se houver venda no local do evento, emite-se nota de venda a partir de lá com o CFOP de venda cabível. |
| Venda ambulante / "pronta entrega" fora do estabelecimento | **5.904/6.904** (remessa para venda fora do estabelecimento) | **5.905/6.905** (retorno de mercadoria não vendida) | Ao final do giro, emite-se **NF-e de retorno** (5.905/6.905) pelo saldo não vendido e a baixa das unidades efetivamente vendidas é registrada via Nota Fiscal de venda emitida no ato ou por totalização diária, conforme a praxe adotada. |

- **CST ICMS:** em comodato/conserto/exposição/venda ambulante em remessa: **41** (não tributada) na saída de remessa (não há circulação econômica definitiva); no retorno, também **41**. Na venda efetivamente realizada a partir da remessa (ex. venda ambulante), aplica-se o CST normal da operação (00/10/20/60 conforme o caso).
- **ST:** na remessa/retorno (sem venda), não há incidência de ICMS-ST, pois não há saída para comercialização; a ST só nasce quando ocorre efetivamente a venda (seja na volta ao CD, seja na venda ambulante em campo).
- **refNFe:** o retorno referencia a nota de remessa original (chave de acesso) — essencial para não configurar a remessa como venda "perdida" no cruzamento de EFD/SPED.
- **infAdic:** natureza da operação detalhada ("remessa para industrialização por encomenda — retorno esperado em X dias" / "comodato de equipamento — bem não pertence ao destinatário" / "mercadoria para venda ambulante — controle de retorno obrigatório").
- **Estoque/financeiro:** remessas não geram baixa definitiva de estoque contábil — usa-se controle de "estoque em poder de terceiros" (subconta); a baixa definitiva só ocorre na venda efetiva ou perda/consumo comprovado. Financeiramente, nenhuma receita é reconhecida na remessa, apenas na venda subsequente.

---

## 10. Simples remessa, venda à ordem e venda para entrega futura

- **Venda para entrega futura / faturamento antecipado:**
  - **Nota de simples faturamento** (formaliza a venda e a obrigação de pagamento, sem saída física de mercadoria): CFOP **5.922/6.922** — "Lançamento efetuado a título de simples faturamento decorrente de venda para entrega futura". **Não há saída física; não há tributação de ICMS/IPI nesta nota** (é apenas formalização comercial/faturamento).
  - **Nota de remessa** (movimento físico da mercadoria, no momento da efetiva entrega): CFOP **5.116/6.116** (produção própria) ou **5.117/6.117** (mercadoria de terceiros) — "Venda de produção do estabelecimento/mercadoria adquirida ou recebida de terceiros originada de encomenda para entrega futura". É nesta nota que ocorrem os destaques de ICMS, ICMS-ST, IPI, PIS/COFINS, referenciando a nota de simples faturamento (**refNFe**).
  - Se a mercadoria estiver sujeita à ST, a retenção ocorre na **nota de remessa/entrega física** (5.116/5.117 ou correspondentes 5.401/5.403/5.405, conforme convenção interna do sistema — muitos ERPs usam diretamente 5.401/5.403/5.405 na remessa quando há ST, dispensando 5.116/5.117 puros), não na nota de simples faturamento.
- **Venda à ordem** (empresa A vende a B, mas entrega diretamente a C por ordem de B):
  - Nota de venda do vendedor original ao adquirente originário (A→B): CFOP **5.118/6.118** (produção própria) ou **5.119/6.119** (mercadoria de terceiros) — "venda ... entregue ao destinatário por conta e ordem do adquirente originário, em venda à ordem".
  - Nota de remessa do vendedor original diretamente ao destinatário final (A→C, por conta e ordem de B): CFOP **5.923/6.923** — "Remessa de mercadoria por conta e ordem de terceiros, em venda à ordem".
  - Nota de venda do adquirente originário ao destinatário final (B→C, sem movimentação física, pois a mercadoria já foi entregue por A): CFOP **5.120/6.120** — "Venda de mercadoria adquirida ou recebida de terceiros entregue ao destinatário pelo vendedor remetente, em venda à ordem".
  - Todas essas notas referenciam-se mutuamente via **refNFe** para permitir o cruzamento fiscal em três pontas.
- **Simples remessa** (movimentação de mercadoria sem transferência de propriedade e sem os motivos específicos já listados — ex. remessa para depósito fechado/armazém geral, cessão de uso não classificável em outro CFOP): CFOP **5.905/6.905** (retorno) ou, para casos residuais, **5.949/6.949** — "Outra saída de mercadoria ou prestação de serviço não especificado" (usar apenas quando nenhum CFOP específico se aplica; entrada correspondente **1.949/2.949**).
- **CST/ICMS:** na nota de simples faturamento, não há base de cálculo de ICMS (é apenas título financeiro). Na nota de remessa física, aplica-se o CST cabível ao produto (00/10/60/etc., conforme produção própria/ST/revenda).
- **infAdic:** vincular expressamente a nota de remessa/entrega à nota de simples faturamento original, citando número/chave e valores já faturados, para não haver dupla cobrança.
- **Estoque/financeiro:** na nota de simples faturamento, gera-se o título a receber (contas a receber) sem baixa de estoque; a baixa de estoque só ocorre na nota de remessa física, no momento real da entrega.

---

## 11. Complemento de nota (preço, ICMS, ST) e nota de ajuste

- **Quando cabe nota complementar (e não CC-e):** toda vez que a variação envolver **valor da operação, base de cálculo, alíquota ou quantidade** — itens que a CC-e (Carta de Correção Eletrônica, Ajuste SINIEF 7/2005) **expressamente não pode alterar**. Exemplos: reajuste contratual de preço posterior à emissão, diferença de peso apurada em balança de destino (comum em carnes vendidas por peso), ICMS ou ICMS-ST recolhido a menor por erro de alíquota/MVA.
- **CFOP:** mantém-se o **mesmo CFOP da nota original** (a nota complementar não cria nova natureza de operação, apenas ajusta valores) — não existe um CFOP "genérico de complemento" dedicado (a menção a "5.926/5.927" não corresponde à tabela oficial atual; 5.926 é hoje classificado como "reclassificação de mercadoria decorrente de formação de kit/desagregação", uso distinto). **Usar o CFOP original da operação, com natureza de operação textual "Complemento de preço/ICMS/ST".**
- **Conteúdo da nota complementar:** não repete integralmente os dados da nota original — traz: dados do remetente/destinatário, CFOP idêntico ao original, CST idêntico ao original, apenas os dados que faltaram ou que estão sendo complementados (valor, base de cálculo, ICMS/ICMS-ST a complementar), e no campo `infAdic` o número, série e data de emissão da nota original.
- **refNFe:** obrigatório, apontando a NF-e original que está sendo complementada.
- **Casuística de churrascaria/carnes (peso variável):** quando a pesagem definitiva ocorre no destino e diverge da pesagem de romaneio na origem, a prática de mercado é emitir a nota complementar de quantidade/valor referenciando a NF-e original — **confirmar se o RICMS-RO tem regra especial de "nota fiscal de ajuste de peso"** (comum em Protocolos de carnes) — NAO CONFIRMADO especificamente para RO.
- **Nota de ajuste de ST (complemento de ICMS-ST recolhido a menor):** emitida com os mesmos CFOP/CST da operação original, preenchendo apenas os campos de `ICMSST` com a diferença a maior, referenciando a nota original — o recolhimento complementar de ST segue o prazo/guia (GNRE) definido pelo protocolo/convênio do produto.
- **Estoque/financeiro:** a nota complementar de preço não gera novo movimento de estoque (a mercadoria já saiu na nota original) — apenas ajusta receita e tributos; a complementar de ST não afeta estoque nem receita de venda, apenas a obrigação fiscal de ICMS-ST.

---

## 12. Nota de entrada de produtor rural / pessoa física (compra de gado/carne de não emitente)

- **Regra geral (produtor rural inscrito, obrigado a NFA-e em RO):** desde 17/08/2020, a SEFIN-RO exige que **produtores rurais inscritos no CAD/ICMS-RO emitam NFA-e (Nota Fiscal Avulsa Eletrônica)** para saídas internas de gado bovino, bufalino, suíno, caprino ou ovino destinadas a estabelecimentos comerciais/industriais (o modelo 4 — nota fiscal de produtor em papel — não pode mais ser usado para essas mercadorias). Sistema: **nfea.sefin.ro.gov.br**.
  - Nesse caso, a 364 **recebe** a NFA-e do produtor (não emite nota de entrada própria) e escritura normalmente com CFOP **1.101** ("Compra para industrialização ou produção rural") — usado especificamente para gado destinado a abate/industrialização — ou **1.102** dependendo da destinação (comercialização direta sem processamento).
- **Ajuste de valor pós-abate (romaneio/rendimento de carcaça):** como o preço final do boi muitas vezes só é conhecido após o abate (peso de carcaça, rendimento), é prática comum emitir uma **segunda nota de entrada com CFOP 1.101**, complementar (positiva ou negativa), para reconciliar a diferença entre o valor da NFA-e do produtor e o valor real da operação apurado no abate. **Confirmar se a SEFIN-RO tem norma própria disciplinando esse ajuste (equivalente às "notas de acerto" usadas em outros estados)** — NAO CONFIRMADO o dispositivo específico do RICMS-RO.
- **Produtor rural pessoa física não inscrito / não obrigado a emitir documento fiscal:** a 364, na condição de destinatária, emite **Nota Fiscal de Entrada** própria (modelo eletrônico, `mod=1` entrada), com CFOP **1.101/1.102** (interno) — hipótese menos comum em RO dado o regime de NFA-e obrigatório para gado, mas ainda aplicável a outros insumos agropecuários adquiridos de pessoa física não inscrita.
- **CST ICMS:** depende do regime do produto — muitas operações internas com gado têm redução de base de cálculo ou diferimento (o material de pesquisa aponta reduções específicas via Decreto 31.305/2026, com base no Convênio ICMS 177/2025, para saídas interestaduais de gado — **não confirmei se há diferimento nas operações internas de entrada na indústria**, que é a hipótese típica de abatedouro). CST provável: **51** (diferimento) se o RICMS-RO diferir o ICMS da saída do produtor para o momento da saída industrializada da carne pela 364 — **NAO CONFIRMADO**, checar Anexo/artigo específico do RICMS-RO sobre diferimento na pecuária.
- **infAdic:** dados do produtor (CPF/CNPJ, GTA — Guia de Trânsito Animal, obrigatória para movimentação de gado, emitida pela IDARON em RO), número da GTA vinculada ao lote.
- **Estoque/financeiro:** entrada de matéria-prima (gado vivo) em estoque a custo de aquisição; se houver nota de ajuste pós-abate, o custo é reclassificado retroativamente ao lote.

---

## 13. Anulação/estorno — o que NÃO se resolve com CC-e

- A **Carta de Correção Eletrônica (CC-e)**, prevista no Ajuste SINIEF 7/2005 e MOC da NF-e, **NÃO PODE alterar**:
  - Valores que determinam o valor do imposto: **base de cálculo, alíquota, diferença de preço, quantidade, valor da operação/prestação**.
  - Dados cadastrais que impliquem mudança de **remetente ou destinatário**.
  - **Data de emissão** ou de saída da mercadoria.
  - **Número e série** da própria NF-e.
  - **CFOP** quando a correção mudar a natureza do imposto envolvido (ex. de operação tributada para isenta).
  - Uma NF-e autorizada há mais de 30 dias (720 horas) **não permite mais o registro de CC-e** no ambiente nacional (regra de validação da SEFAZ).
- **O que resolve essas hipóteses:**
  - **Erro de valor/base de cálculo/ICMS a menor:** nota complementar (item 11).
  - **Erro de destinatário, mercadoria que não deveria ter saído, operação cancelada após a saída física:** **cancelamento** (somente dentro do prazo legal, hoje geralmente até 24h após autorização, salvo prazos diferenciados por UF — **NAO CONFIRMADO o prazo específico vigente em RO em 2026**, confirmar no MOC/SEFIN-RO) ou, fora do prazo de cancelamento, **devolução simbólica/nota de entrada de devolução** (itens 4/5) para reverter o efeito fiscal e de estoque.
  - **Erro que só pode ser percebido depois de decorridos os prazos de cancelamento e a mercadoria não circulou de fato:** emissão de **NF-e de entrada** para anular o efeito, com natureza de operação "anulação de valor relativo a operação" e CFOP compatível (ex. 1.949/2.949, se não houver CFOP específico melhor), acompanhada de justificativa robusta em `infAdic` — sujeita a risco de questionamento fiscal, pois não é o instrumento "padrão" e depende de aceitação da SEFAZ de destino/origem; em caso de dúvida, buscar orientação/autorização prévia via processo de consulta na SEFIN-RO.
  - **Denúncia espontânea de recolhimento a menor de ICMS/ICMS-ST:** GNRE complementar com os acréscimos legais (juros/multa de mora, se for o caso), amparada pela nota complementar (item 11), não pela CC-e.

---

## Diferenças Simples Nacional × Lucro Presumido/Real — síntese transversal

| Aspecto | Simples Nacional | Lucro Presumido/Real |
|---|---|---|
| CST vs CSOSN | Usa **CSOSN** (101/102/103/201/202/203/300/400/500/900) | Usa **CST** de 2 dígitos (00/10/20/30/40/41/50/51/60/70/90) |
| ICMS da venda própria | Embutido no DAS (PGDAS-D), calculado por faixa de receita bruta acumulada (Anexo I ou II) | Destacado normalmente na nota, apurado em conta gráfica (débito/crédito) mensal |
| ICMS-ST retido como substituto | **Sempre calculado fora do DAS**, pela sistemática normal (alíquota interna do destino + MVA), recolhido via GNRE — LC 123/2006, art. 13, §1º, XIII, "a" | Calculado e recolhido pela sistemática normal, integrado à apuração de ICMS a recolher (mas o ICMS-ST é sempre segregado do ICMS próprio) |
| Mercadoria recebida com ST retida (substituído) | Receita correspondente é **excluída da base de cálculo do ICMS no PGDAS** (Resolução CGSN 140/2018, art. 25, §8º) | Sem novo destaque de ICMS na saída (CST 60), sem efeito na apuração de ICMS a pagar |
| DIFAL (venda a não contribuinte de outra UF) | Devido normalmente, recolhido à parte do DAS (GNRE), desde a LC 190/2022 | Devido normalmente, recolhido via GNRE ou apuração conforme convênio de inscrição no destino |
| PIS/COFINS | Embutido no DAS; sem crédito nas aquisições | Cumulativo (Presumido, sem crédito) ou não cumulativo (Real, com direito a crédito) |
| Bonificação/amostra/comodato/transferência | Mesmo tratamento de não incidência de receita tributável no DAS que no regime normal, mas sem geração de crédito de PIS/COFINS/IPI (que não existem no Simples) | Tratamento pleno com possibilidade de créditos de PIS/COFINS não cumulativos (Real) sobre insumos correlatos |

---

## Fontes

- **CFOP — Convênio s/nº de 15/12/1970 e Ajustes SINIEF:** confaz.fazenda.gov.br — confirmado que o Ajuste SINIEF 3/2022 previa extinguir a série 5.400/6.400/1.400/2.400 (CFOPs de ST) a partir de 03/04/2023, e que o **Ajuste SINIEF 29/2023** revogou/retirou a data de início dessa mudança, mantendo os códigos vigentes; buscadores especializados (blog.softensistemas.com.br, blog.nfemais.com.br) datados de 2026 confirmam uso corrente de 5401/5403/5405/5410/5411.
- **Convênio ICMS 236/2021 (DIFAL):** confaz.fazenda.gov.br/legislacao/convenios/2021/CV236_21 — publicado 06/01/2022, efeitos desde 01/01/2022, revoga o Convênio ICMS 93/2015.
- **ADC 49/STF, LC 204/2023, Convênio ICMS 178/2023 e 109/2024 (transferências):** confaz.fazenda.gov.br/legislacao/convenios/2024/CV109_24 (fetch direto confirmou: transferência de crédito é direito, não obrigação; cláusula sexta permite equiparação opcional a operação tributada, escolha anual e irretratável até 31/12; convênio revoga o 178/2023 e vigora desde 07/10/2024, efeitos a partir de 01/11/2024); netcpa.com.br, mattosfilho.com.br, pradvogados.com.br confirmam a mudança de obrigatoriedade para faculdade.
- **Possível Convênio ICMS 7/2026 (limitação de créditos):** mattosfilho.com.br menciona a existência, mas o conteúdo não foi verificado nesta pesquisa — **NAO CONFIRMADO**.
- **STJ Tema 1.412 (bonificação/desconto x PIS/COFINS):** conjur.com.br/2026-ago-19 confirma julgamento pautado para 20/08/2026 na 1ª Seção do STJ, **adiado sem novo voto/tese fixada** até a data de hoje; tjro.jus.br/nugepnac/recurso-repetitivo/tema-1412-stj-afetado identifica os REsps paradigma (2.221.794/PR, 2.221.800/RS, 2.223.143/RS).
- **STJ Tema 1.223 (PIS/COFINS na base do ICMS — tema correlato, não confundir com bonificação):** stj.jus.br, notícia de 22/01/2025, confirma tese fixada em repetitivo de que PIS/COFINS integram a base do ICMS.
- **RICMS-RO:** legislacao.sefin.ro.gov.br e legisweb.com.br apontam **Decreto nº 22.721, de 05/04/2018**, como o regulamento vigente (não foi possível abrir e citar artigos específicos nesta pesquisa).
- **NFA-e/produtor rural RO:** rondonia.ro.gov.br (notícias oficiais) confirma obrigatoriedade de NFA-e para produtores rurais inscritos, desde 17/08/2020, para gado bovino/bufalino/suíno/caprino/ovino em operações internas; sistema em nfea.sefin.ro.gov.br.
- **Redução de base de cálculo para gado (2026):** rondonia.ro.gov.br e sefin.ro.gov.br/conteudo.jsp?idConteudo=4899 citam **Decreto nº 31.305, de 02/03/2026**, com redução de 66,67% na base de cálculo do ICMS em saídas interestaduais de gado para abate por produtor pessoa física, com base no **Convênio ICMS 177/2025**.
- **Amostra grátis:** mentorfiscal.com.br e policont.com.br confirmam o enquadramento em Convênio ICMS 29/90 (ICMS) e art. 54, III, do RIPI (IPI).
- **CC-e (o que não pode ser corrigido):** contabeis.com.br, netcpa.com.br, rrtcontabilidade.com.br, todos referenciando o Ajuste SINIEF 7/2005 e a cláusula que veda alteração de valor/base de cálculo/quantidade/data de emissão/número-série.
- **CEST — Convênio ICMS 142/2018:** confaz.fazenda.gov.br/legislacao/convenios/2018/CV142_18 — estrutura de 7 dígitos confirmada; segmentos específicos de carnes (07/08) não tiveram o detalhe dos NCMs/CESTs exatos confirmado nesta pesquisa.

## Lacunas (NAO CONFIRMADO — validar antes de codificar no sistema)

1. **MVA/pauta fiscal específica de carnes para RO em 2026** (percentuais de margem de valor agregado por NCM/CEST) — consultar diretamente o Anexo I do RICMS-RO (Decreto 22.721/2018) atualizado, ou a SEFIN-RO/contador.
2. **Números exatos de artigos do RICMS-RO** para: devolução por não contribuinte (nota de entrada), diferimento na pecuária, ressarcimento de ICMS-ST, prazo de cancelamento de NF-e vigente em RO.
3. **Status final da série de CFOPs de ST (5.400/1.400 etc.)** após o Ajuste SINIEF 29/2023 — se algum Ajuste SINIEF posterior (2024–2026) finalmente efetivou a extinção ou renumeração; verificar confaz.fazenda.gov.br/legislacao/ajustes antes de fixar CFOP no ERP.
4. **Teor e vigência do possível Convênio ICMS 7/2026** sobre limitação de transferência de créditos em hipóteses de não incidência, citado de passagem por Mattos Filho — não localizado/confirmado o texto integral.
5. **Protocolo/Convênio específico de ST para carnes que Rondônia efetivamente subscreve em 2026** (ex. protocolos de carne bovina/suína entre estados) e respectivo MVA/CEST aplicável aos produtos da 364 — este é o dado mais crítico para o motor de cálculo de ST e não foi possível confirmar com precisão de número/cláusula nesta pesquisa; recomenda-se contato direto com a SEFIN-RO (Substituição Tributária) ou o contador da empresa.
6. **Se há CFOP de "transferência" (51xx) ainda vigente sem alteração**, e se há exigência de ST "na entrada" por transferência em alguma UF de destino das filiais da 364.
7. **Tese final do Tema 1.412/STJ** sobre bonificação na base de PIS/COFINS — ainda pendente de julgamento; reavaliar a posição fiscal da empresa quando houver decisão.
8. **Rito e prazo do pedido de ressarcimento de ICMS-ST em RO** (formulário, prazo, órgão competente) em caso de devolução/perda da mercadoria após a retenção.