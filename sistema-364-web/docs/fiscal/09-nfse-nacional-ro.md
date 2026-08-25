# NFS-e — Padrão Nacional e Aplicação para a 364 (Rondônia)

## 1. Padrão Nacional da NFS-e: ADN, Emissor Nacional, Convênio, situação 2026

**Convênio NFS-e**: acordo original (2022) entre RFB, ABRASF, CNM e FNP que criou o Comitê Gestor da NFS-e (CGNFS-e) para padronizar leiaute e infraestrutura da nota de serviço em todo o país.

**ADN (Ambiente de Dados Nacional)**: repositório central que recebe, valida e distribui os documentos fiscais eletrônicos de serviço (NFS-e e eventos) entre os entes conveniados — é o "hub" nacional, análogo em espírito ao SVRS/SVC-AN da NF-e, mas para serviços.

**Emissor Nacional**: aplicativo público (web e mobile) oferecido pela RFB para o prestador emitir a NFS-e diretamente, usado pelos municípios que não têm sistema próprio (ou por eles disponibilizado como alternativa complementar).

**Situação em 2026** (confirmado):
- Municípios: por força da Reforma Tributária (LC 214 — regulamentação do IBS/CBS, sancionada em jan/2025; **não consegui abrir o texto no planalto.gov.br** — duas tentativas de `WebFetch` deram `ECONNRESET` — número/data do artigo específico ficam como NAO CONFIRMADO em fonte primária, apoiado apenas em fontes secundárias de tributaristas), a obrigação é: aderir ao ADN até 1º/1/2026, seja mantendo sistema próprio (desde que compartilhe os dados no leiaute nacional) seja usando o Emissor Nacional. Rondônia aparece como 100% aderente segundo fonte secundária (notagateway.com.br) — não voltei a confirmar município a município, exceto Porto Velho (ver §3).
- Simples Nacional (ME/EPP prestadoras de serviço): **Resolução CGSN nº 191, de 4/8/2026** torna obrigatório o uso do Emissor Nacional da NFS-e (via app web ou API) a partir de **1º/11/2026**, revogando a Resolução CGSN nº 189/2026 que fixava 1º/9/2026. Fonte primária: [gov.br/receitafederal — notícia de agosto/2026](https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2026/agosto/simples-nacional-nfs-e-nacional-sera-obrigatoria-para-me-e-epp-a-partir-de-1o-de-novembro-de-2026). As regras de CBS/IBS para o Simples só valem a partir de 1º/1/2027.
- **Não substitui integralmente os sistemas municipais**: um município pode manter emissor próprio, desde que compartilhe os DF-e com o ADN no leiaute nacional — é exatamente o caso de Porto Velho (§3).

## 2. API do padrão nacional

**Manual oficial baixado e lido**: "Manual dos Contribuintes — Sistema Nacional NFS-e — Guia para utilização das APIs do Emissor Público Nacional", disponível em `gov.br/nfse/.../documentacao-atual/manual-contribuintes-emissor-publico-api-sistema-nacional-nfs-e-v1-2-out2025.pdf`. **Achado**: o nome do arquivo indica "v1.2 out2025", mas o "Histórico de Versões" *dentro* do PDF só lista a versão **1.0, de 17/03/2025** — inconsistência entre nome do arquivo e conteúdo, reporto sem tentar reconciliar.

**Ambientes** (confirmado via `gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/apis-prod-restrita-e-producao`; os swaggers em si não abriram — `socket hang up` e `403` — então as *URLs base* estão confirmadas, o *conteúdo* dos swaggers não foi inspecionado):

| Serviço | Produção | Produção restrita (homologação) |
|---|---|---|
| ADN | `https://adn.nfse.gov.br/docs/index.html` | `https://adn.producaorestrita.nfse.gov.br/docs/index.html` |
| CNC (Cadastro Nacional de Contribuintes) | `https://adn.nfse.gov.br/cnc/docs/index.html` | `https://adn.producaorestrita.nfse.gov.br/cnc/docs/index.html` |
| Sefin Nacional | `https://sefin.nfse.gov.br/SefinNacional/docs/index` | `https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional/docs/index` |
| Painel Municipal | `https://www.nfse.gov.br/PainelMunicipal/Login` | `https://www.producaorestrita.nfse.gov.br/PainelMunicipal/Login` |

**Formato**: DPS (Declaração de Prestação de Serviço) = **XML assinado digitalmente** ("o leiaute do DF-e utiliza o padrão XML contendo a assinatura digital do emissor" — texto literal do manual); os *envelopes/mensagens* das APIs auxiliares (parâmetros, eventos) usam JSON, mas o documento fiscal em si é XML. Schemas: `NFSe-ESQUEMAS_XSD v1.01`, datado `20260209`, listado em `gov.br/nfse/.../documentacao-atual`.

**Autenticação**: o manual confirma literalmente autenticação por **certificado digital na conexão do solicitante** ("a chave de acesso será informada somente se a identificação do usuário do certificado digital da conexão solicitante for um ator... que consta na NFS-e"), consistente com mTLS + certificado ICP-Brasil (mesma PKI da NF-e). O termo "mTLS" não aparece no manual oficial nesses termos — mas SDKs de terceiro no npm (§7) descrevem o fluxo explicitamente como mTLS.

**Fluxo confirmado** (extraído do manual):
- `POST /nfse` — emissão síncrona: recebe DPS em XML assinado, valida regras de negócio, **gera a NFS-e** (retorna XML) ou rejeita com motivo.
- **Substituição**: reenviar uma DPS referenciando a chave de acesso da nota anterior → o sistema gera automaticamente um "Evento de Cancelamento de NFS-e por Substituição" vinculado à nota original (cancelando-a) e emite a NFS-e substituta.
- `GET /nfse/{chaveAcesso}` — consulta por chave de acesso.
- `GET /dps/{id}` / `HEAD /dps/{id}` — recupera a chave de acesso a partir do identificador da DPS (Código IBGE do município + inscrição do prestador + série + número da DPS); por sigilo fiscal, só retorna a chave se o certificado do solicitante corresponder a um ator da nota (prestador, tomador ou intermediário).
- `POST /nfse/{chaveAcesso}/eventos` + `GET .../eventos[/{tipoEvento}[/{numSeqEvento}]]` — registro/consulta genérica de eventos (cancelamento, manifestação do tomador, etc.).
- `GET /parametros_municipais/{codigoMunicipio}/...` — alíquotas, regimes especiais, deduções por subitem e retenções devidas por CPF/CNPJ **antes** de montar a DPS (não tem equivalente na NF-e, onde as regras já estão na legislação estadual).

## 3. Municípios de Rondônia

| Município | Sistema | API/Webservice | Fonte / caminho |
|---|---|---|---|
| **Porto Velho** | Sistema próprio da prefeitura (portal "Semfazonline"), **integrado** ao Sistema Nacional NFS-e mantendo emissor próprio | Portal + "integração via Web Service" mencionada, mas **WSDL público não localizado** — CONFIRMADO só que existe, não a URL | Oficial: [semec.portovelho.ro.gov.br](https://semec.portovelho.ro.gov.br/noticias/modernizacao-porto-velho-passa-a-integrar-o-sistema-nacional-de-notas-fiscais-de-servicos-eletronicas), [semfaz.portovelho.ro.gov.br](https://semfaz.portovelho.ro.gov.br/artigo/53104/servicos-novo-layout-da-nota-fiscal-de-servico-eletronica-passa-a-ser-obrigatorio-em-porto-velho). Portal: semfazonline.com. Novo layout (CST/cClassTrib) obrigatório desde atualização com prazo até 15/12/2025 |
| **Ji-Paraná** | NAO CONFIRMADO com certeza — fontes de terceiro divergem entre "ISSWEB"/Fiorilli e portal próprio "ISS Online"; segundo nfe.io, **não habilitado** para emissão e **não** é Emissor Nacional | Formato citado: ABRASF, base LC 116/2003 | Caminho: contatar Secretaria de Fazenda de Ji-Paraná ou acessar ji-parana.ro.gov.br, menu "ISS Online Recadastramento" |
| **Ariquemes** | **ISSWEB** (confirmado — domínio próprio) | Emissão via provedor **ABRASF 2.01**, autenticação **Certificado A1** | `http://nfse.ariquemes.ro.gov.br:5660/issweb/home.jsf`. Segundo nfe.io: "Ambiente Nacional" = Sim, "Emissor Nacional" = Não |
| **Vilhena** | **WebISS®** (fornecedor terceiro) | Webservice confirmado: homologação `https://homologacao.webiss.com.br/ws/nfse.asmx`; produção `https://vilhenaro.webiss.com.br/ws/nfse.asmx?WSDL`. Provedor **ABRASF 2.02**, Certificado A1 | `https://vilhenaro.webiss.com.br/` (fonte: blog Webmania) |
| **Cacoal** | **WebISS®** (mesmo fornecedor de Vilhena) | WSDL específico não localizado — por analogia ao padrão de Vilhena, provavelmente `https://cacoalro.webiss.com.br/ws/nfse.asmx?WSDL`, **NAO CONFIRMADO** | `https://cacoalro.webiss.com.br/`. Atualização para ADN a partir de jan/2026 citada por fonte secundária (espiaonfe.com.br) |

## 4. Código de serviço, ISS e alíquota de Porto Velho

**Base legal atual de Porto Velho**: a **LC 369/2009** (usada como referência inicial da pesquisa) **foi revogada** e substituída pela **LC 878/2021** ("Código Tributário e de Rendas do Município de Porto Velho"), com alterações até a Lei Complementar nº 971/2023 e nº 925/2022. Texto completo obtido em `https://sapl.portovelho.ro.leg.br/media/sapl/public/normajuridica/2021/14805/codigo_tributario_compilado_-_ate_2023_compressed_2.pdf` (baixado, 12,2 MB, 20 páginas, extraído com `pdftotext`).

**Alíquotas do ISS (arts. 271-273 da LC 878/2021, texto literal confirmado)**:
- **Regra geral: 5%** (art. 272, II).
- **2% reduzido** (art. 272, I) só para: atividades desportivas de federações sem fins lucrativos; bailes/shows estudantis de formatura; eventos religiosos/filantrópicos sem fins lucrativos; eventos culturais no calendário da Fundação Cultural Municipal; subitem 1.04 (quando atividade principal); transporte coletivo municipal sob concessão.
- **Buffet/eventos (17.11) e industrialização por encomenda (14.05) NÃO estão na lista de exceção → 5%** quando o fato gerador ocorrer.
- Simples Nacional (art. 273): remete às tabelas dos Anexos III/IV/V da LC 123/2006 — a alíquota efetiva do ISS embutida no DAS não é a alíquota municipal fixa, é a da faixa de receita bruta do Simples.

**Local de incidência (art. 248)**: regra geral = estabelecimento do **prestador**. Exceções relevantes: fornecimento de mão de obra (17.05) → local do estabelecimento do **tomador**; feiras/exposições (17.10) → local do evento. **Buffet (17.11) não está nas exceções → segue a regra geral** (local do prestador, i.e. Porto Velho).

**Retenção na fonte (mesma seção)**: pessoa jurídica tomadora é substituta tributária **obrigatória** para os subitens 3.05, 7.02, 7.04, 7.05, 7.09, 7.10, 7.12, 7.16, 7.17, 7.19, 11.02, **17.05** e 17.10 — **inclui mão de obra (17.05), mas NÃO inclui buffet (17.11) nem industrialização (14.05)**. Dispensa de retenção só para instituição financeira, sociedade de profissionais, autônomo, isento/imune ou **MEI** (§2º) — uma ME/EPP comum do Simples (caso da 364) **não** está dispensada.

**Tabela nacional de códigos (cTribNac)**: não substitui a lista da LC 116/2003 — apenas correlaciona. O documento oficial é o "Anexo VIII — Correlação Item LC116 × NBS × IndOp × cClassTrib (IBS/CBS)", versão 1.00.00, publicado set/2025 pela RFB no Portal Nacional NFS-e. Há também um "cTribNac" com 338 códigos detalhando os ~200 subitens da LC 116 (fonte secundária, tecnospeed/petlove — não abri o arquivo oficial).

## 5. Simples Nacional e ISS

O ISS do optante é recolhido dentro do DAS mensal, por **alíquota efetiva** conforme a faixa de receita bruta acumulada (RBT12) nos Anexos III/IV/V da LC 123/2006 — não há "ISS a pagar" destacado como imposto adicional na nota, **exceto** quando há retenção obrigatória pelo tomador.

Quando há retenção (LC 123/2006, art. 21, §4º):
- **I** — a alíquota retida deve constar na nota fiscal e corresponder à alíquota efetiva do ISS do mês anterior da ME/EPP;
- **II** — o valor retido é definitivo (sem partilha adicional; a parcela de ISS é excluída do cálculo do Simples daquele mês — art. 18, §§4º-A e seguintes);
- **III** — se a ME/EPP não informar a alíquota, aplica-se **5%**.

Campo na nota: no leiaute ABRASF histórico o campo é `OptanteSimplesNacional` (booleano) — **NAO CONFIRMADO** o nome exato do campo equivalente no XSD do padrão nacional (não consegui abrir o schema diretamente).

## 6. Serviço prestado pela 364 e fronteira ICMS × ISS

| Hipótese | Enquadramento |
|---|---|
| Taxa de serviço do restaurante (10%) | Regra dominante: **não é fato gerador de ISS nem ICMS** — é gorjeta repassada aos empregados. Não achei item específico para "restaurante" na lista de Porto Velho (só para hospedagem). **NAO CONFIRMADO** posicionamento específico da prefeitura — confirmar com o contador. |
| Fornecimento de alimentação/bebidas no restaurante | **ICMS** — confirmado literalmente no CTM de Porto Velho, item 17.11: "bufê (exceto o fornecimento de alimentação e bebidas, que fica sujeito ao ICMS)". |
| Eventos/buffet (organização, cobrada à parte) | **ISS 5%** (item 17.11), local = estabelecimento do prestador; alimento/bebida dentro do mesmo evento continua ICMS. |
| Cessão/fornecimento de mão de obra (ex.: emprestar staff para evento de terceiro) | **ISS** (item 17.05), com **retenção obrigatória** pelo tomador PJ, local = estabelecimento do tomador. |
| **Industrialização (carne crua → carne defumada, venda B2B)** | Ver abaixo — é o ponto central. |

**Industrialização por encomenda — LC 116/2003 item 14.05 e STF**: item 14.05 tradicionalmente enquadrava como ISS o beneficiamento feito por encomenda (encomendante fornece a matéria-prima, o prestador só processa e devolve). Em fevereiro/2025 o STF julgou (RE 882.461, repercussão geral) que é **inconstitucional a incidência de ISS sobre o item 14.05 quando o objeto é destinado à industrialização ou comercialização** — nesse caso incide ICMS/IPI, não ISS. O critério é a destinação econômica do bem: volta como insumo/para revenda → ICMS/IPI; vai para consumo final do próprio encomendante → ISS.

**Aplicação ao caso confirmado da 364**: pela descrição do cliente ("industrializa carne crua em carne defumada e vende B2B"), a 364 **compra** a matéria-prima e **vende** o produto acabado como mercadoria própria — não há um encomendante terceiro fornecendo carne para a 364 apenas processar. Isso **não é** "industrialização por encomenda" no sentido do item 14.05 — é industrialização por conta própria para venda, que sempre foi ICMS/IPI (não há prestação de serviço a um tomador, há compra-transformação-venda). O item 14.05/ISS só entraria em jogo numa hipótese lateral não relatada: um terceiro enviando carne de sua propriedade só para a 364 defumar e devolver — e, mesmo aí, se o destino for revenda pelo encomendante, a tese do STF afasta o ISS. **Conclusão**: a atividade principal e confirmada da 364 (carne defumada B2B) é 100% ICMS/IPI, fora do escopo de ISS/NFS-e.

## 7. Implementação em Node.js

**SDKs de terceiro (não oficiais) no npm, checados via `registry.npmjs.org`, ago/2026** — mercado ainda imaturo, maioria publicada há poucos meses:

| Pacote | Descrição (do próprio publicador) |
|---|---|
| `open-nfse` | "Padrão Nacional de NFS-e (nfse.gov.br): consulta, distribuição, emissão síncrona, cancelamento e substituição — direto na API oficial" |
| `nfse-nacional` | "SDK TypeScript para NFS-e Nacional (SEFIN) — DPS, assinatura XMLDSig, DANF-Se em PDF e preview" |
| `nfse-node` | "SDK não oficial... NFS-e Nacional (ADN/SEFIN Nacional)" |
| `@useinvio/nfse-sdk` | "JSON to DPS/XML, **XMLDSIG, GZip/Base64, mTLS** and SEFAZ errors" — confirma explicitamente o mecanismo |
| `@brasil-fiscal/nfse` | "Lib open-source... Padrao Nacional (ADN/ABRASF)" |

**Assinatura**: é o mesmo mecanismo **XML-DSig** (ICP-Brasil, certificado A1/A3) usado na NF-e — confirmado indiretamente pelo manual oficial ("assinatura digital do emissor") e explicitamente pelos SDKs de terceiro. A 364 já tem parte da infraestrutura: `lib/certificadoServer.js` descriptografa o `.pfx` cifrado (AES-256-GCM) com `node-forge`; falta a rotina de assinatura em si — hoje o repo só **lê** NF-e (`fast-xml-parser`, sem assinatura). Esse esforço de assinatura é **compartilhado** entre NF-e e NFS-e, não duplicado (mesma tecnologia W3C XML Signature; lib Node de fato-padrão é `xml-crypto`).

**Diferenças práticas vs NF-e**:
- NF-e: 1 ambiente por UF (RO já mapeado: SVRS/SVC-AN), leiaute único v4.00.
- NFS-e: potencialmente **dois caminhos técnicos simultâneos** durante a transição — ADN/Emissor Nacional (se o município aderiu totalmente) **e** webservice ABRASF legado do município (SOAP/XML, versão 2.01/2.02 conforme o município) — Porto Velho hoje está nesse meio-termo (mantém sistema próprio, mas compartilha com o ADN).
- NFS-e exige uma chamada extra de parametrização municipal (`/parametros_municipais/...`) antes de montar a DPS — sem equivalente na NF-e.

**Terceirização — comparação honesta**:

| Provedor | Achados |
|---|---|
| **Focus NFe** | Planos R$89,90/mês (Solo, 1 CNPJ, 100 notas) a R$548/mês (Growth, ilimitado, 4.000 notas); alega +3.000 municípios integrados; município novo por R$199 fixos em até 15 dias úteis. Página consultada **não menciona** o padrão nacional NFS-e explicitamente. |
| **PlugNotas (Tecnospeed)** | API REST — cliente manda JSON, PlugNotas monta XML/assina/transmite/webhook; +2.200 municípios, ABRASF/DSF/+150 sistemas próprios; **confirma** suporte a "NFS-e Nacional com campos de IBS e CBS" já ativo, habilitável "sem alterar o layout JSON que sua aplicação já envia". Preço sob consulta. |
| **eNotas** | Rebatizado **Nota Gateway** (notagateway.com.br); página de preços específica não abriu (404). |

**Avaliação da fragmentação municipal como argumento pró-terceirização**: é real e concreta hoje — só nos 5 municípios de RO pesquisados já há 3 sistemas técnicos distintos (Semfazonline próprio de Porto Velho, ISSWEB de Ariquemes, WebISS de Vilhena/Cacoal, Ji-Paraná indefinido), cada um com webservice, autenticação e cadastro próprios, além da camada adicional do padrão nacional em transição. Se a 364 emitir só em Porto Velho, a fragmentação é pequena (1 integração); se expandir para outros municípios de RO, cresce rápido.

## 8. Recomendação para a 364

**NF-e**: manter própria — já há investimento feito, credenciamento SEFIN-RO gratuito/imediato, 1 único ambiente estadual estável (SVRS/SVC-AN).

**NFS-e**: **terceirizar** (ex.: PlugNotas, que já confirma suporte ao padrão nacional sem mudar o layout JSON), pelo menos nesta fase de 2026, porque:
1. O volume de receita sujeita a ISS na 364 é marginal frente ao core (venda B2B de carne defumada = ICMS/IPI; restaurante = majoritariamente ICMS na venda de alimentos) — construir e manter um pipeline de assinatura XML-DSig + integração ABRASF/ADN só para notas pontuais (eventuais buffets/cessão de mão de obra) não se paga.
2. A fragmentação municipal é ativa e Porto Velho está no meio de uma transição de layout (prazo até dez/2025, campos novos desde jan/2026) — um provedor terceiro absorve esse custo de manutenção contínua por assinatura mensal previsível (R$90-550/mês), muito mais barato que dedicar desenvolvimento interno para acompanhar cada mudança municipal/nacional.
3. Não fecha porta: o trabalho de assinatura XML-DSig, se feito depois, é reaproveitável entre NF-e e NFS-e — internalizar mais tarde, quando o volume de serviço justificar, continua sendo opção.
4. Distinção do porquê terceirizar SÓ a NFS-e mesmo com NF-e própria: são problemas de natureza diferente — 1 ambiente estadual estável (baixo custo marginal) vs. N ambientes municipais potencialmente instáveis (alto custo marginal, exatamente o "long tail" que justifica comercialmente Focus NFe/PlugNotas/eNotas existirem).

Reconsiderar internalizar se: o volume de serviços ISS crescer de forma relevante (catering/eventos virar linha de negócio, não só ocasional) ou se a 364 expandir para outros municípios de RO, multiplicando integrações.

---

## Fontes

- [gov.br/nfse (portal)](https://www.gov.br/nfse/pt-br) — ADN, Emissor Nacional, Convênio, links de documentação (WebFetch, confirmado)
- [Manual dos Contribuintes — API Emissor Público Nacional v1.0/17-03-2025 (arquivo nomeado v1.2 out2025)](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-contribuintes-emissor-publico-api-sistema-nacional-nfs-e-v1-2-out2025.pdf) — baixado e extraído com `pdftotext`; fluxo de API, autenticação por certificado, formato DPS (confirmado, texto literal)
- [Documentação técnica atual](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual) — lista de manuais e XSD v1.01 (20260209) (WebFetch, confirmado)
- [APIs — Prod. Restrita e Produção](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/apis-prod-restrita-e-producao) — URLs base de produção/homologação (WebFetch, confirmado; conteúdo dos swaggers não verificado)
- [FAQ NFS-e](https://www.gov.br/nfse/pt-br/biblioteca/copy_of_perguntas-frequentes/copy_of_faq-nfs-e) — Convênio (RFB/ABRASF/CNM/FNP), DPS (parcialmente desatualizada, cita 2023)
- [gov.br/receitafederal — Resolução CGSN 191/2026](https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2026/agosto/simples-nacional-nfs-e-nacional-sera-obrigatoria-para-me-e-epp-a-partir-de-1o-de-novembro-de-2026) — obrigatoriedade Simples Nacional 1º/11/2026 (fonte primária, confirmado)
- [Prefeitura de Porto Velho — integração ao Sistema Nacional NFS-e](https://semec.portovelho.ro.gov.br/noticias/modernizacao-porto-velho-passa-a-integrar-o-sistema-nacional-de-notas-fiscais-de-servicos-eletronicas) e [semfaz.portovelho.ro.gov.br](https://semfaz.portovelho.ro.gov.br/artigo/53104/servicos-novo-layout-da-nota-fiscal-de-servico-eletronica-passa-a-ser-obrigatorio-em-porto-velho) — fonte oficial municipal (confirmado)
- [LC 878/2021 — Código Tributário e de Rendas de Porto Velho, compilado até 2023](https://sapl.portovelho.ro.leg.br/media/sapl/public/normajuridica/2021/14805/codigo_tributario_compilado_-_ate_2023_compressed_2.pdf) — baixado (12,2 MB) e extraído com `pdftotext`; arts. 248, 271-273, 274-281 lidos na íntegra (fonte primária, confirmado)
- [ISSWEB Ariquemes](http://nfse.ariquemes.ro.gov.br:5660/issweb/home.jsf) — domínio próprio do sistema (confirmado)
- [WebISS Vilhena](https://vilhenaro.webiss.com.br/) e [WebISS Cacoal](https://cacoalro.webiss.com.br/) — domínios confirmados; WSDL de Vilhena citado por blog Webmania (secundário)
- `registry.npmjs.org` (busca "nfse") — pacotes npm de SDKs NFS-e Nacional em Node/TS, checado ago/2026 (fonte primária de registry, conteúdo descritivo é auto-declarado pelos publicadores — tratar como indicativo de mercado, não como confirmação técnica)
- [PlugNotas via tecnospeed.com.br/plugdfe/plugnotas](http://tecnospeed.com.br/plugdfe/plugnotas/) e [Focus NFe preços](https://focusnfe.com.br/precos/) — planos e cobertura (WebFetch, confirmado)
- [conjur.com.br — STF e ISS sobre industrialização por encomenda](https://www.conjur.com.br/2025-fev-26/supremo-afasta-incidencia-do-iss-sobre-industrializacao-por-encomenda/) — RE 882.461, tese do STF (WebFetch, confirmado)

## Lacunas

- **LC 214** (número/data exatos dos artigos que obrigam os municípios a aderir ao ADN até 1º/1/2026): não consegui abrir `planalto.gov.br` (falha de conexão repetida). Confirmar diretamente em planalto.gov.br/ccivil_03/leis/lcp/.
- **Webservice/WSDL oficial de Porto Velho**: não localizei a URL pública — caminho: portal semfazonline.com ou contato direto com a SEMFAZ.
- **Sistema de Ji-Paraná**: fornecedor não confirmado com certeza (fontes de terceiro divergem) — caminho: contato com a Secretaria de Fazenda municipal ou acesso a ji-parana.ro.gov.br.
- **WSDL de Cacoal**: não confirmado (assumido por analogia ao padrão WebISS de Vilhena) — testar diretamente ou contatar a prefeitura.
- **Swaggers de produção/homologação do ADN e Sefin Nacional**: URLs base confirmadas, mas conteúdo (schemas de segurança, exemplos de payload) não inspecionado — tentativas de `WebFetch` deram erro de conexão/403.
- **Nome exato do campo "optante Simples Nacional" no XSD do padrão nacional da NFS-e** (v1.01, 20260209): não confirmado — precisa abrir o schema XSD diretamente.
- **Posicionamento específico de Porto Velho sobre taxa de serviço de restaurante** (10%): não encontrei manifestação municipal explícita — confirmar com o contador da 364.
- **cTribNac (338 códigos)** e Anexo VIII de correlação NBS×cClassTrib: descritos só por fontes secundárias (tecnospeed, petlove) — não abri o arquivo oficial da RFB.
- **Preços do PlugNotas e Nota Gateway/eNotas**: não disponíveis publicamente nas páginas tentadas (403/404) — só Focus NFe teve tabela de preços acessível.