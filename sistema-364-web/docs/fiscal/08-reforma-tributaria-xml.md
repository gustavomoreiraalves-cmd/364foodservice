# Reforma Tributária e Emissão de NF-e — Pesquisa Rodada 2 (24/08/2026)

*Contexto: 364 Food Services, Simples Nacional, RO. NF-e modelo 55 B2B + NFS-e. Construção iniciando agora.*

---

## 1. Cronograma legal — LC 214/2025 (texto integral consultado em planalto.gov.br, versão consolidada com alterações da LC 227/2026)

| Período | IBS | CBS | ICMS/ISS | Base legal (LC 214/2025) |
|---|---|---|---|---|
| **2026** | 0,1% (só estadual) | 0,9% | Normal (cheio) | Art. 343 (IBS); Art. 346 (CBS) |
| **2027–2028** | 0,05% estadual + 0,05% municipal | Alíquota de referência − 0,1 p.p. | PIS/Cofins **extintos**; ICMS/ISS ainda cheios | Art. 344 (IBS); Art. 347 (CBS) |
| **2029** | Cresce à alíquota de referência | Alíquota de referência plena | ICMS/ISS reduzidos em **10%** | Art. 501 → LC 87/1996, novo art. 31-A, I |
| **2030** | idem | idem | ICMS/ISS reduzidos em **20%** | Art. 501, II |
| **2031** | idem | idem | ICMS/ISS reduzidos em **30%** | Art. 501, III |
| **2032** | idem | idem | ICMS/ISS reduzidos em **40%** | Art. 501, IV |
| **2033** | Alíquota de referência plena | Alíquota de referência plena | **ICMS e ISS extintos**; LC 87/1996 (Lei Kandir) e LC 116/2003 revogadas | Art. 543, III e IV |

**O que é literalmente exigido em 2026 (art. 348):** recolher IBS 0,1% + CBS 0,9% sobre o mesmo fato gerador do regime atual, mas o **valor é integralmente compensável** com PIS/Cofins (inciso I) — ou seja, é neutro para quem cumpre as obrigações acessórias. Se não houver débito suficiente para compensar, o saldo pode ser objeto de ressarcimento/compensação com outros tributos federais (inciso II). **Não há aumento de carga em 2026** — é ano de teste de sistemas, cadastros e leiautes, não de arrecadação líquida.

Confirmado que os artigos citados na mídia como "340/341" (uma busca inicial) estavam **errados** — nesse trecho do texto consolidado hoje esses números tratam do Regime Especial de Fiscalização (capítulo diferente, deslocado por emendas da LC 227/2026). Os artigos corretos e conferidos linha a linha no texto oficial são os da tabela acima.

---

## 2. NT 2025.002 (NF-e/NFC-e) — histórico de versões

| Versão | Data | O que mudou (confirmado por fontes secundárias, não pela NT em si — portal com sessão ASP.NET bloqueou scraping direto) |
|---|---|---|
| v1.00–v1.10 | 2025 | Criação inicial do grupo UB (IBSCBS) no schema |
| v1.20 | homolog 28/08/2025, produção 06/10/2025 | Substitui a antiga NT 2024.002 e versões anteriores da reforma |
| v1.33 | 05/12/2025 | **Desativa** a regra de rejeição por ausência do grupo IBS/CBS (rejeição 1115), que estava programada para 05/01/2026, sem nova data |
| v1.34 | dez/2025 | Mantém desativação, reforça obrigatoriedade **legal** (não técnica) desde 01/01/2026 |
| v1.36 | 2026 | Novas regras de validação (parte das "43 regras novas" citadas por estudos de mercado) |
| v1.40 | 20/05/2026 | Introduz grupo `gALCZFMCBS` (UB66a) para ZFM/ALC; 40+ novas regras; altera VC02-14 (referenciamento de devoluções, vigência 01/09/2026); remove evento 211120; **fixa cronograma de rejeição**: homologação obrigatória até 01/07/2026, produção obrigatória 03/08/2026 para CRT 3 |
| v1.50 | 03/06/2026 | Consolida v1.40; ativa efetivamente a rejeição 1115 em produção a partir de 03/08/2026 para CRT 3 (regime normal), reativando de uma vez ~213 validações (170 regras "dormentes" + 43 novas) |
| **v1.51** | **04/08/2026 — versão vigente hoje (24/08/2026)** | Última publicada; ajustes pós-entrada em vigor da rejeição de 03/08/2026 |

**Não consegui abrir o PDF oficial da v1.51** diretamente (portal nfe.fazenda.gov.br usa postback ASP.NET/ViewState que não é acessível via GET simples, e o WebFetch teve erro de certificado/timeout repetido). O histórico acima é reconstruído por triangulação de 4+ fontes de mercado (Contadores.cnt.br, TOTVS, Tecnospeed, TaxUp, MRS Advogados, Inventti) que citam a NT oficial nominalmente — **recomendo baixar o PDF manualmente** no navegador em `nfe.fazenda.gov.br > Documentos > Notas Técnicas` para conferir o texto literal antes de codificar validações.

---

## 3. Estrutura do novo leiaute — grupo IBSCBS

Local: `det/imposto/IBSCBS` (grupo "UB" na nomenclatura da NT).

**Campos de classificação:**
- `CST` — Código de Situação Tributária do IBS/CBS (2 posições: 000, 010, 011, 200, 210, 220, 221, 222, 400, 410, 510, 515, 550, 620, 800, 810, 811, 820, 830 — total reportado de 18 CSTs)
- `cClassTrib` — Código de Classificação Tributária, 6 dígitos, vinculado a um CST-pai (ex.: 200003 = venda de alimentos com redução, sob CST 200). Total de códigos ativos **relatado entre 156 e 164** dependendo da versão/data da fonte consultada — **NÃO CONFIRMADO o número exato vigente hoje**, tabela muda a cada NT/Informe Técnico.

**Grupos de tributação (todos dentro de IBSCBS):**
- `gIBSCBS` — container principal com base de cálculo (`vBC`), alíquotas e valores
- `gIBSUF` — IBS parte estadual (alíquota/valor por UF)
- `gIBSMun` — IBS parte municipal
- `gCBS` — CBS (federal)
- `gTribRegular` — tributação regular aplicável a operações em ZFM/Áreas de Livre Comércio
- `gIBSCredPres` / `gCBSCredPres` — crédito presumido de IBS/CBS
- `gTribCompraGov` — regras especiais para compras governamentais
- `gALCZFMCBS` (novo na v1.40) — subcampos `tpALCZFMCBS`, `nProcSuframa`, `pAliqEfetRegCBS`, `vTribRegCBS`
- `gIBSCBSMono` — tributação monofásica (combustíveis, etc.)
- `gTransfCred` — transferência de crédito

**Totais (nível `total/`):** grupo `IBSCBSTot` (também citado como "W03") — consolida `vIBS`, `vCBS`, `vCredPres` e subtotais por UF/Município.

**Mudanças em `det/prod`:**
- `indBemMovelUsado` — indicador de bem móvel usado (valor 1)
- Nova unidade tributável — **não consegui confirmar o nome exato do campo nem a estrutura completa** (fontes mencionam de forma vaga "unidade tributável para IBS/CBS", possivelmente vinculada a `uTrib`/`qTrib` já existentes, adaptados). LACUNA.
- `gCred` — grupo de crédito (contexto de bens usados/revenda) — estrutura interna não confirmada em detalhe.

**Mudanças em `ide`:** não localizei confirmação específica e detalhada (as fontes de mercado focaram em `det` e totais). LACUNA.

**Grupo de referência:** `refDFeAnt` (documento fiscal eletrônico anterior referenciado) — reforçado na v1.40 com 20 novas regras de validação, relevante para notas de devolução/ajuste vinculadas a operações com IBS/CBS já apurado.

Não tive acesso ao XSD real (portal bloqueou scraping) — **essa seção foi montada por triangulação de blogs técnicos (Tecnospeed, TOTVS), não por leitura direta do schema**. Antes de codificar o parser/gerador XML, baixe o pacote de schemas oficial manualmente.

---

## 4. cClassTrib e tabelas de CST — onde e como

- Publicação **conjunta** do Comitê Gestor do IBS (CG-IBS) e da Receita Federal, via **Informe Técnico RT 2025.002** (documento distinto da Nota Técnica 2025.002 da NF-e — cuidado para não confundir os dois: a NT é do leiaute XML, o Informe Técnico é da tabela de códigos em si).
- Local declarado: Portal Nacional da NF-e, aba "Documentos" > "Diversos".
- **Não encontrei API de consulta** — as fontes consultadas (Fiscalize AI, Taxcel, Tecnospeed) descrevem apenas tabelas para download (planilha/PDF), sem endpoint HTTP oficial. Se a 364 quiser automatizar a seleção de `cClassTrib` por produto, o caminho é importar a tabela oficial (CSV/XLS) para uma tabela interna e mapear por NCM/CEST/regra de negócio — não há serviço de lookup em tempo real conhecido.
- Como o emissor descobre o código certo: por eliminação — primeiro define o CST (tratamento geral: tributação integral, alíquota reduzida, isenção, suspensão, monofásico etc.), depois escolhe o `cClassTrib` específico dentro daquele CST que corresponde ao enquadramento do produto/operação (ex.: alimento com redução de 60% cai em um `cClassTrib` específico sob CST 200). Isso é análogo ao mapeamento NCM→CEST que a 364 já faz para ICMS-ST — mesma lógica de tabela de-para, tabela nova.

---

## 5. Versão do schema/leiaute

Não encontrei nenhuma fonte (das ~15 consultadas) mencionando uma "NF-e 5.00" ou renumeração de leiaute. Todas as mudanças da reforma estão sendo entregues como **evolução do leiaute 4.00 existente**, via Notas Técnicas sucessivas (2025.002 v1.00 a v1.51) e "Pacotes de Liberação" incrementais do schema XML (ex.: citação de "Pacote de Liberação nº 010b v.1.21" pela TOTVS) — é o mesmo padrão usado historicamente pelo SPED para evoluir a NF-e sem quebrar o número principal da versão. Isso é **consistente e recorrente o suficiente para eu ter confiança alta**, mas não tive acesso à página oficial do schema para citar o número "4.00" literalmente hoje — **NÃO 100% CONFIRMADO por fonte primária direta** nesta rodada.

**Recomendação prática:** baixe o pacote de schemas mais recente direto do portal nacional (`nfe.fazenda.gov.br > Documentos > Schemas`) manualmente, comece o parser sobre o leiaute 4.00 vigente, e trate o `DFeTiposBasicos_v1.00.xsd` (arquivo novo mencionado por uma fonte, contendo os tipos do grupo IBSCBS) como módulo à parte — assim, quando a NT evoluir de novo (o que tem acontecido a cada ~1 mês), o impacto fica isolado nesse módulo.

---

## 6. Regra de rejeição em 2026 — CRÍTICO para o cronograma de desenvolvimento

Este é o achado mais operacionalmente relevante da rodada, e ele **diverge por regime tributário** — o que interessa diretamente à 364 (Simples Nacional):

| Regime (CRT) | Homologação obrigatória | Produção obrigatória (rejeição real, bloqueia autorização) |
|---|---|---|
| CRT 3 — Regime Normal | até 01/07/2026 | **03/08/2026** (já em vigor há 3 semanas, hoje é 24/08/2026) |
| CRT 1 (Simples Nacional), CRT 2 (excesso de sublimite), CRT 4 (MEI) | — | **04/01/2027** |

Base citada pelas fontes de mercado: art. 348 da LC 214/2025 (disposições comuns 2026) combinado com a NT 2025.002 v1.40/v1.50, que fixaram esse cronograma diferenciado após a rejeição 1115 ter sido suspensa sem data em dezembro/2025 (v1.33) e depois reativada com data certa nas versões seguintes.

**Conclusão prática para a 364:** como emissor Simples Nacional, a nota **não será rejeitada** por falta do grupo IBSCBS até **04/01/2027**. Isso dá margem para lançar a NF-e primeiro sem o grupo completo e evoluir o gerador XML depois — mas não é desculpa para adiar o design do modelo de dados (ver seção 9), porque a obrigatoriedade **legal** de informar os tributos já vale desde 01/01/2026 mesmo sem rejeição técnica, e o prazo de 04/01/2027 chega rápido.

**Não consegui verificar isso na NT oficial diretamente** (bloqueio de acesso ao portal) — é conclusão triangulada de 3 fontes de mercado independentes (Contadores.cnt.br, TaxUp, MRS Advogados) que convergem no mesmo cronograma e citam a mesma NT.

---

## 7. Simples Nacional na reforma (LC 214/2025 — texto conferido diretamente)

Confirmado por leitura direta dos artigos 41 (regime regular) e 23 da LC 123/2006 conforme alterado pela LC 214/2025 (redação pela LC 227/2026):

**Regra padrão (art. 41, §2º):** o optante do Simples Nacional permanece sujeito às regras do próprio regime — IBS e CBS ficam **dentro do DAS**, calculados pelos percentuais das faixas de receita bruta dos Anexos I a V da LC 123/2006, sem split payment nem apuração separada.

**Opção pelo regime regular (art. 41, §3º a §6º):** o optante pode escolher apurar e recolher IBS/CBS **por fora do DAS**, pelo regime regular (não-cumulativo pleno, crédito integral ao cliente). Regras:
- Opção nos termos da LC 123/2006 (§4º)
- **Vedado desistir** do regime regular se já recebeu ressarcimento de créditos no ano corrente ou anterior (§5º)
- Janela de opção (fonte secundária, e-auditoria — não conferida no texto literal da lei): 1º–30/09/2026, vigência jan–jun/2027; cancelamento possível até 30/11/2026; segunda janela 1º–31/03/2027 para o semestre seguinte
- É facultativa — quem não optar, permanece no modelo padrão dentro do DAS

**O que precisa ir na nota fiscal para o cliente se creditar (art. 23, §1º-A e §2º da LC 123/2006, alterado pela LC 214/2025 — CONFIRMADO no texto oficial):**
> "A alíquota aplicável ao cálculo do crédito de que trata o §1º **deverá ser informada no documento fiscal** e corresponderá aos percentuais de ICMS, IBS e CBS previstos nos Anexos I a V desta Lei Complementar para a faixa de receita bruta a que a microempresa ou a empresa de pequeno porte estiver sujeita no mês de operação."

Isso é **obrigação de campo na NF-e**, não apenas nota fiscal em papel — a alíquota de crédito (derivada da faixa do Simples no mês) precisa estar no XML para que o cliente PJ não-optante consiga se creditar do IBS/CBS embutido no preço. **Isso vai direto para o modelo de dados do emissor da 364** (ver seção 9).

**O que a 364 precisa emitir:** como venda B2B para clientes PJ (provavelmente não optantes do Simples, dado o porte industrial), a NF-e de saída precisa carregar a alíquota de crédito do IBS/CBS calculada pela faixa de receita bruta da 364 no Anexo aplicável (Anexo I para indústria de alimentos ou Anexo II — precisa confirmar qual anexo cabe à atividade de defumação/industrialização de carne, isso é uma decisão de enquadramento tributário a validar com o contador, não uma questão de NF-e).

---

## 8. Substituição tributária na reforma

**A ST do ICMS não acaba em 2026, nem em 2027 — acaba junto com o próprio ICMS.**

- Confirmado por leitura direta do art. 543, III da LC 214/2025: a **Lei Complementar nº 87/1996 (Lei Kandir, que disciplina a ST) é revogada a partir de 1º de janeiro de 2033**.
- Fonte secundária (IOB) indica que a extinção efetiva do regime de ST tende a ocorrer já ao final da transição em **2032** (quando o ICMS já estará com apenas 40% do valor original) — mas a base legal dura, confirmada na lei, é a revogação formal em 2033.
- **Levantamento de estoque:** a LC 214/2025 (art. 381, texto conferido diretamente) prevê **crédito presumido sobre estoque para fins de CBS/PIS-Cofins em 1º/01/2027** — 9,25% sobre bens em estoque sujeitos a ST/monofasia no regime federal antigo. **Não encontrei, no texto da LC 214/2025 propriamente, um dispositivo equivalente para o estoque com ICMS-ST na virada de 2032/2033** — isso é matéria que tende a ficar em lei estadual/Convênio ICMS, ainda não publicada. **LACUNA relevante e explícita**: o inventário/crédito de ICMS-ST retido no estoque na virada de 2032→2033 ainda não tem regra federal encontrada; acompanhar Confaz.

**Isso muda a decisão de investimento no motor de ST agora?** Não. A ST de ICMS continua plenamente vigente e operacional até pelo menos 2029 (quando começa a redução gradual de alíquotas, não de mecânica), e para a 364 especificamente, o achado da rodada 1 (tributação deslocada para a entrada do animal vivo, isenção da saída interna, ROT-ST) permanece o regime real hoje e nos próximos ~6 anos. O motor de ST merece investimento pleno agora — é o grosso do imposto sobre venda de carne em RO até o fim da década.

---

## 9. Impacto prático no modelo de dados — prioridade para não reescrever em 2027

Em ordem de prioridade, para um Simples Nacional que evita rejeição técnica até 04/01/2027 mas tem obrigação legal desde já:

1. **Guardar `cClassTrib` por produto/operação, versionado por data de vigência** — a tabela muda a cada Informe Técnico (já mudou de ~156 para ~164 códigos entre fontes consultadas em poucos meses). Não fixar o código no cadastro do produto sem campo de "vigência desde/até".
2. **Guardar CST de IBS e CBS separadamente do CST/CSOSN de ICMS** — são tabelas paralelas, um produto pode ter CSOSN (Simples, ICMS) diferente do CST-IBS/CBS. Modelar como campos irmãos, não substituir um pelo outro.
3. **Campo de alíquota de crédito IBS/CBS por faixa de receita bruta do emitente no mês da operação** (art. 23 §2º LC 123) — isso é dado **do emitente** (364), não do produto, e muda mês a mês conforme a faixa de faturamento acumulado. Precisa de lógica de cálculo baseada no Anexo aplicável, recalculada a cada emissão, não hardcoded.
4. **Permitir mais de um regime tributário por item** (crédito presumido, monofásico, alíquota reduzida, tributação regular em ZFM) — o grupo XML já antecipa isso (`gIBSCredPres`, `gCBSCredPres`, `gIBSCBSMono`, `gTribRegular` coexistindo). Não modelar "um regime por nota", modelar "um regime por item, com múltiplos sub-blocos possíveis por item".
5. **Guardar histórico de qual versão da NT gerou cada XML** — dado o ritmo de ~1 versão por mês, é útil para auditoria/depuração saber que uma nota de julho/2026 foi gerada sob v1.40 e uma de agosto sob v1.51.
6. **Preparar o campo de opção Simples "dentro do DAS" vs "regime regular"** como flag de configuração da empresa (não do produto) — se a 364 ou algum cliente dela optar pelo regime regular na janela de set/2026, o cálculo de crédito muda de fórmula (integral vs. proporcional à faixa).
7. **Isolar o parser/gerador do grupo IBSCBS em módulo separado** do restante do XML da NF-e (como já sugerido na seção 5) — dado o ritmo de mudança de NT, isso é proteção de manutenção, não só de dados.
8. Manter o motor de ST/ICMS como está, sem tentar unificá-lo prematuramente com IBS/CBS — são mecânicas distintas até 2033.

---

## 10. Onde acompanhar

- **Portal Nacional da NF-e** — `www.nfe.fazenda.gov.br` > aba "Documentos" > "Notas Técnicas" (fonte primária das NTs; teve bloqueio de scraping automatizado nesta pesquisa, mas é acessível via navegador normal).
- **Portal Nacional da NFS-e** — `www.gov.br/nfse` > Biblioteca > Documentação Técnica > RTC (para a parte de NFS-e/serviço, relevante pro outro documento que a 364 emite).
- **Comitê Gestor do IBS** — publica o Informe Técnico conjunto com a RFB para as tabelas de cClassTrib/CST/crédito presumido (site institucional do CG-IBS, não confirmado o domínio exato nesta rodada — LACUNA, buscar "cgibs.gov.br" ou correlato na próxima rodada).
- **Receita Federal / Simples Nacional** — `www8.receita.fazenda.gov.br/simplesnacional` para Resoluções CGSN (a Resolução CGSN nº 190/2026 citada por fonte secundária não foi verificada diretamente — LACUNA).
- **Planalto** — `planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm` mantém o texto consolidado da lei sempre atualizado com as alterações supervenientes (já reflete a LC 227/2026); é a fonte mais confiável para conferir artigo por artigo, como fiz nesta rodada.

---

## Fontes

**Consultadas por leitura direta (primárias):**
- [LC 214/2025 — texto integral consolidado](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm) — arts. 41–45 (Simples/regime regular), 342–348 (cronograma 2026-2028), 361, 368, 381 (estoque CBS), 501 (redução ICMS 2029-2032), 508, 543 (revogações 2033), art. 23 LC 123/2006 alterado (crédito ao adquirente). Baixado e processado via curl+Python nesta sessão.

**Consultadas via WebSearch/WebFetch (secundárias, triangulação de mercado):**
- [Contadores.cnt.br — NT 2025.002 v1.40](https://www.contadores.cnt.br/noticias/tecnicas/2026/05/25/nt-2025-002-v-1-40-publicada-em-20-05-2026-o-checklist-tecnico-que-o-escritorio-precisa-cobrar-do-erp-do-cliente-ate-03-08-2026.html)
- [TaxUp — Estudo rejeição NF-e IBS/CBS](https://taxup.com.br/estudo-rejeicao-nfe-ibs-cbs/)
- [MRS Advogados — NT v1.40 rejeição 03/08/2026](https://mrsadvogados.com/nota-tecnica-2025-002-v-1-40-df-e-sem-cbs-e-ibs-serao-rejeitados-a-partir-de-03-08-2026/)
- [Inventti — Fisco desativa rejeição IBS/CBS](https://inventti.com.br/fisco-desativa-rejeicao-ibs-cbs-obrigatoriedade-permanece/)
- [Tecnospeed — Nota Técnica reforma NF-e/NFC-e](https://blog.tecnospeed.com.br/nota-tecnica-reforma-tributaria-nfe-nfce/)
- [TOTVS — NT 2025.002 v1.34](https://www.totvs.com/blog/fiscal-clientes/reforma-tributaria-publicada-a-nt-2025-002-rtc-v1-34-com-novas-flexibilizacoes-para-emissao-da-nf-e-nfc-e-em-2026/)
- [Fiscalize AI — Tabela CST/cClassTrib](https://fiscalizeai.com.br/blog/tabela-cst-ibs-cbs-cclasstrib-completa)
- [Machado Meyer — CG-IBS/RFB tabela cClassTrib](https://www.machadomeyer.com.br/pt/inteligencia-juridica/publicacoes-ij/tributario-ij/cg-ibs-e-rfb-atualizam-tabela-de-codigos-de-classificacao-tributaria-do-ibs-e-da-cbs)
- [e-Auditoria — Regime híbrido Simples Nacional](https://www.e-auditoria.com.br/blog/regime-hibrido-simples-nacional-ibs-e-cbs-das/)
- [IOB — Futuro da ST na reforma tributária](https://noticias.iob.com.br/substituicao-tributaria-reforma-tributaria/)
- [Pasqualino Contabilidade — Alíquotas transição 2026-2028](https://pasqualino.com.br/aliquotas-de-transicao-do-ibs-e-da-cbs-2026-2028-como-aplicar-na-pratica-segundo-a-lc-214-2025/)

## Lacunas (não confirmado — buscar na próxima rodada)

1. **Texto literal da NT 2025.002 v1.51** (04/08/2026) — portal nfe.fazenda.gov.br bloqueou acesso automatizado (ASP.NET postback/ViewState); precisa download manual via navegador.
2. **Estrutura completa e literal do XSD** (todos os campos filho de cada grupo, tipos, tamanhos) — só triangulado por blogs, não pelo schema real. Essencial antes de codificar o gerador XML.
3. **Número exato de códigos `cClassTrib` vigentes hoje** — divergência entre fontes (156 vs. 164), tabela muda com frequência.
4. **Mudanças em `ide`** e a "nova unidade tributável" em `det/prod` — não encontrei detalhamento confiável.
5. **Confirmação oficial de que o leiaute permanece "4.00"** — inferido por ausência de menção a novo número, não visto literalmente em fonte primária.
6. **Regra de estoque com ICMS-ST na virada 2032/2033** — não localizada em lei/convênio publicado; aparentemente ainda não regulamentada.
7. **Resolução CGSN nº 190/2026** e janela de opção set/2026 para regime regular — citadas só por fonte secundária (e-auditoria), não verificadas no Diário Oficial ou no site do CGSN.
8. **Enquadramento da 364 nos Anexos I-V da LC 123/2006** (para cálculo da alíquota de crédito do art. 23) — depende de atividade (indústria de defumados vs. serviço de restaurante), decisão a confirmar com o contador, não é achado de pesquisa fiscal.
9. **Domínio oficial do Comitê Gestor do IBS** para acompanhamento contínuo — não confirmado nesta rodada.
10. **NFS-e — cronograma e estrutura completos** (NT-004/005 SE/CGNFS-e) — só tocado de raspão; se a 364 for priorizar NFS-e em paralelo, merece rodada dedicada.