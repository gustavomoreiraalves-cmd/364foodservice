# Integração Fiscal NF-e — Emitente RO (364 Food Services)

Pesquisa em fontes primárias (portal nacional NF-e, SVRS, SEFIN-RO, MOC 7.0). Data de referência: **24/08/2026**.

## 1. Autorizador de Rondônia

Confirmado ao vivo na página oficial **"Relação de Serviços Web"** do portal nacional (`nfe.fazenda.gov.br/portal/webServices.aspx`), última verificação exibida na página em **24/08/2026 13:33:51**, versão do portal **v2.9.9.0**:

> "UF que utilizam a SVRS - Sefaz Virtual do RS: [...] Para demais serviços relacionados com o sistema da NF-e: AC, AL, AP, CE, DF, ES, PA, PB, PI, RJ, RN, **RO**, RR, SC, SE, TO"

**RO usa a SVRS (Sefaz Virtual do Rio Grande do Sul) como autorizador**, não tem autorizador próprio.

Exceção importante: para o serviço **NfeConsultaCadastro4**, a SVRS só atende **AC, ES, RN, PB, SC** — RO **não está** nessa lista restrita. Ver Lacunas (item 6).

Em **contingência**, a mesma página confirma:
> "UF que utilizam a SVC-AN [...]: AC, AL, AP, CE, DF, ES, MG, PA, PB, PI, RJ, RN, **RO**, RR, RS, SC, SE, SP, TO"

**RO usa SVC-AN em contingência** (não SVC-RS).

## 2. URLs exatas dos webservices (extraídas ao vivo em 24/08/2026 das páginas oficiais)

Fonte de todas as URLs abaixo: `https://www.nfe.fazenda.gov.br/portal/webServices.aspx` (produção) e `https://hom.nfe.fazenda.gov.br/portal/webServices.aspx` (homologação) → seção "Sefaz Virtual Rio Grande do Sul - (SVRS)".

**Produção (SVRS):**

| Serviço | URL |
|---|---|
| NFeAutorizacao4 | `https://nfe.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx` |
| NFeRetAutorizacao4 | `https://nfe.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx` |
| NfeConsultaProtocolo4 | `https://nfe.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx` |
| NfeStatusServico4 | `https://nfe.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx` |
| NfeInutilizacao4 | `https://nfe.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx` |
| RecepcaoEvento4 | `https://nfe.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx` |
| NfeConsultaCadastro4 | `https://cad.svrs.rs.gov.br/ws/cadconsultacadastro/cadconsultacadastro4.asmx` — **atenção**: RO não consta na lista de UFs cobertas pela SVRS para este serviço específico (ver §7/Lacunas) |

**Homologação (SVRS):**

| Serviço | URL |
|---|---|
| NFeAutorizacao4 | `https://nfe-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx` |
| NFeRetAutorizacao4 | `https://nfe-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx` |
| NfeConsultaProtocolo4 | `https://nfe-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx` |
| NfeStatusServico4 | `https://nfe-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx` |
| NfeInutilizacao4 | `https://nfe-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx` |
| RecepcaoEvento4 | `https://nfe-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx` |
| NfeConsultaCadastro4 | `https://cad-homologacao.svrs.rs.gov.br/ws/cadconsultacadastro/cadconsultacadastro4.asmx` |

**NFeDistribuicaoDFe** (serviço nacional, único para todas as UFs, hospedado no "Ambiente Nacional - AN", não na SVRS):

| Ambiente | URL |
|---|---|
| Produção | `https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx` |
| Homologação | `https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx` |

**RecepcaoEvento4 do Ambiente Nacional** (usado especificamente para **EPEC**, que é sempre enviado ao AN independentemente do autorizador normal da UF):

| Ambiente | URL |
|---|---|
| Produção | `https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx` |
| Homologação | `https://hom.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx` (subdomínio `hom1`, confirme no momento da implementação) |

## 3. Contingência

**Autorizador de contingência para RO: SVC-AN** (confirmado no §1). URLs de contingência SVC-AN = mesmas do SVAN normal:
- Produção: `https://www.sefazvirtual.fazenda.gov.br/NFeAutorizacao4/NFeAutorizacao4.asmx` (idem para os demais serviços, trocando o nome do serviço)
- Homologação: `https://hom.sefazvirtual.fazenda.gov.br/NFeAutorizacao4/NFeAutorizacao4.asmx`

**Tabela `tpEmis` (confirmada por fonte oficial cruzada):**

| tpEmis | Significado |
|---|---|
| 1 | Emissão normal |
| 2 | Contingência FS-IA (formulário de segurança impresso) |
| 3 | SCAN (obsoleto) |
| 4 | **EPEC** — Evento Prévio de Emissão em Contingência (sucessor do antigo DPEC) |
| 5 | **FS-DA** — Formulário de Segurança para Documento Auxiliar |
| 6 | **SVC-AN** |
| 7 | SVC-RS |
| 9 | Offline (NFC-e) |

Fonte MOC 7.0 – Visão Geral, glossário e §3.3 (pág. 36-40, arquivo `moc7-visao-geral.pdf`, CONFAZ).

**EPEC — regras extraídas literalmente do MOC 7.0 (§3.3, pp. 36-40):**
- Enviado sempre para o **Ambiente Nacional (AN)**, via `RecepcaoEvento4` genérico de eventos — nunca para o autorizador normal da UF (SVRS, no caso de RO).
- Gerar a NF-e com `tpEmis=4`, `dhCont` (data/hora de início da contingência) e `xJust` (motivo).
- Layout mínimo do XML do EPEC: UF/CNPJ/IE do emitente, chave de acesso, UF/CNPJ ou CPF do destinatário, valor total da NF-e/ICMS/ICMS-ST.
- Após autorização do evento (protocolo `891xxxxxxxxxxxx`), a NF-e completa correspondente deve ser transmitida à SEFAZ de origem assim que cessar o problema técnico, respeitando o prazo legal.
- **Prazo de conciliação: 168 horas (7 dias).** Passado esse prazo sem a NF-e correspondente ter sido transmitida, o "Ambiente de Contingência EPEC" é **bloqueado** para o CNPJ/CPF emitente — novos EPEC ficam impossibilitados até regularização (§3.3.8).
- Chave de acesso da NF-e definitiva é **idêntica** à chave usada no EPEC.
- Consulta de situação da NF-e retorna "124 - EPEC Autorizado" enquanto só o evento existir; se a inutilização colidir com um EPEC ativo, retorna "241 - Rejeição: Um número da faixa já foi utilizado".

**FS-DA (`tpEmis=5`)**: impressão do DANFE em Formulário de Segurança adquirido de gráfica autorizada pelo Fisco — último recurso quando nem SEFAZ, nem SVC, nem internet estão disponíveis. EPEC reduz a necessidade de FS-DA (citado explicitamente como benefício no MOC).

**Regras gerais de entrada/saída de contingência SVC-AN/SVC-RS** (mudança de `tpEmis`, reassinatura obrigatória do XML) estão detalhadas em documento separado — **MOC Anexo IV – Manual de Contingência NF-e** — não incluído no PDF "Visão Geral" que li integralmente; ver Lacunas.

## 4. Protocolo de comunicação (SOAP)

Confirmado literalmente no MOC 7.0 – Visão Geral, Tabela 4-3 "Resumo dos Padrões Técnicos" (pág. 55-56):

- **Protocolo Internet**: TLS versão **1.2 ou superior**, com **autenticação mútua** (mTLS) via certificados digitais — elimina usuário/senha.
- **Padrão de troca de mensagens**: **SOAP versão 1.2**.
- **Estilo/encoding**: `Style/Encoding: Document/Literal`.
- **Wrapper**: mensagem enviada no parâmetro `nfeDadosMsg` (Body); a versão do layout vai em `versaoDados`, dentro de `nfeCabecMsg` (SOAP Header), junto com `cUF`.

Exemplo literal do envelope (MOC 7.0, §4.2.6):
```xml
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Header>
    <nfeCabecMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NfeRecepcao2">
      <cUF>string</cUF>
      <versaoDados>string</versaoDados>
    </nfeCabecMsg>
  </soap12:Header>
  <soap12:Body>
    <nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NfeRecepcao2">xml</nfeDadosMsg>
  </soap12:Body>
</soap12:Envelope>
```

- **Compactação GZip**: existe um método alternativo específico — `NfeAutorizacaoLoteZip` — cujo único parâmetro é `nfeDadosMsgZip`, contendo o lote `enviNFe` **compactado em GZip e depois codificado em Base64**. Falha na descompactação gera erro **416**. GZip **não** é o padrão do método normal `NfeAutorizacao4`; é um endpoint alternativo específico.
- **Certificado**: X.509 v3, ICP-Brasil, A1 ou A3, contendo o CNPJ do titular no certificado usado para transmissão.

**Ciphers/TLS específicos da SVRS**: a SVRS desativou TLS 1.0/1.1 em 13/01/2022 e exige TLS 1.2 com um conjunto específico de *ciphers*; a orientação oficial (comunicado SVRS/receita.fazenda.rs.gov.br) é checar a lista atual via **SSL Labs** apontando para `nfe-homologacao.svrs.rs.gov.br`, pois a lista pode mudar sem novo comunicado formal. Desde 11/04/2022 produção e homologação SVRS usam a mesma configuração TLS.

**O que costuma quebrar em Node.js:**
- Certificado A1 (.pfx) precisa ser carregado como `pfx` + `passphrase` no `https.Agent`/`tls.connect`, não como `cert`/`key` separados sem antes extrair via `pkcs12` — bibliotecas SOAP (`soap`, `strong-soap`) exigem `wsdl_options.pfx`.
- Erro "unable to verify the first certificate": a cadeia intermediária ICP-Brasil não está sendo enviada; corrigir com `agent.ca` contendo a cadeia completa ou `rejectUnauthorized` mal configurado (nunca desabilitar em produção).
- `secureProtocol`/`minVersion: 'TLSv1.2'` deve ser forçado explicitamente — versões antigas do runtime Node podem negociar TLS 1.1 e falhar contra a SVRS.
- Certificados PKCS#12 gerados com algoritmos legados (RC2-40, SHA-1 no keystore) podem falhar no OpenSSL 3.x (Node 18+); pode ser necessário `openssl pkcs12 -legacy` ao reempacotar, ou o parâmetro `providers`.

## 5. Assinatura digital do XML

Confirmado **literalmente**, extraindo o texto do PDF oficial MOC 7.0 – Visão Geral (CONFAZ, `moc7-visao-geral.pdf`, seção 4.2.4/Tabela 4-2/4-3, pp. 54-56):

> "Padrão de assinatura digital: XML Digital Signature, Enveloped, com certificado digital X.509 versão 3, com chave privada de tamanho variável, conforme o padrão da ICP-Brasil (1024, 2048, ou mais bits), com padrões de criptografia assimétrica RSA, **algoritmo message digest SHA-1** e utilização das transformações **Enveloped** e **C14N**."

**Isto é importante e contraintuitivo**: em 2026 o MOC 7.0 (versão vigente) **ainda especifica SHA-1**, não SHA-256, para o *digest* e para o `SignatureMethod` do XML-DSig — apesar de SHA-1 estar deprecado em TLS/HTTPS. Não encontrei nenhuma Nota Técnica (verifiquei 2023.004 e 2025.001/2025.002) que altere esse padrão para SHA-256; ambas tratam de outros campos (pagamentos, QR Code). Trate como fato confirmado na fonte primária lida integralmente — **não invente SHA-256** para a assinatura do XML.

Algoritmos/URIs exatos (XML-DSig, extraídos do MOC):
- `CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"`
- `SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"`
- `Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"`
- `Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"` (segundo transform)
- `DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"`
- Codificação: Base64 (`http://www.w3.org/2000/09/xmldsig#base64`)

**Reference URI**: aponta para o atributo `Id` do elemento assinado, prefixado com `#`. Exemplo literal do MOC: `<Reference URI="#NFe31060243816719000108550000000010001234567897">`.

**O que deve ser assinado** (confirmado tag a tag):
- **NF-e**: elemento `infNFe`, cujo `Id` = literal `"NFe"` + chave de acesso de 44 dígitos.
- **Eventos** (Carta de Correção, Cancelamento, Manifestação, EPEC, etc.): elemento `infEvento`, cujo `Id` = `"ID"` + `tpEvento` + chave da NF-e + `nSeqEvento` (54 caracteres).
- **Inutilização**: elemento `infInut`, cujo `Id` = `"ID"` + código da UF + ano (2 dígitos) + CNPJ + modelo + série + número inicial + número final (43 caracteres).

**Validação de assinatura**: além de integridade/autoria, a SEFAZ valida a cadeia de confiança contra LCR (Lista de Certificados Revogados) — confirmado no MOC.

## 6. Chave de acesso (44 dígitos) e cálculo do DV

Confirmado literalmente, MOC 7.0 – Visão Geral, Tabela 2-1 (versão 4.00 do leiaute, pág. 19):

| Posição | Campo | Tamanho | Id |
|---|---|---|---|
| 1 | cUF (código da UF do emitente) | 2 | B02 |
| 2 | AAMM (ano/mês de emissão) | 4 | de B09 |
| 3 | CNPJ/CPF do emitente | 14 | C02/C02a |
| 4 | mod (modelo do documento fiscal) | 2 | B06 |
| 5 | serie | 3 | B07 |
| 6 | nNF (número do documento) | 9 | B08 |
| 7 | tpEmis (forma de emissão) | 1 | B22 |
| 8 | cNF (código numérico aleatório) | 8 | B03 |
| 9 | cDV (dígito verificador) | 1 | B23 |

Total: 44 caracteres.

**cNF (código numérico)**: "Com exceção do Código Numérico, todas as demais informações que compõem a Chave de Acesso podem ser deduzidas por qualquer pessoa [...]. Para minimizar este risco, **o Código Numérico deve ser uma sequência totalmente aleatória**." (MOC 7.0, §2.2.6.1). Deve ser gerado pelo software emissor a cada NF-e — usar CSPRNG (`crypto.randomInt` no Node), nunca sequencial nem previsível.

**Cálculo do DV (módulo 11)** — texto literal do MOC:
> "O módulo 11 de um número é calculado multiplicando-se cada algarismo pela sequência de números **2,3,4,5,6,7,8,9,2,3,...**, posicionados da direita para a esquerda. A somatória dos resultados das ponderações dos algarismos é dividida por 11 e o DV será a diferença entre o divisor (11) e o resto da divisão: **DV = 11 - (resto da divisão)**. Quando o resto da divisão for 0 (zero) ou 1 (um), o DV deverá ser igual a 0 (zero)."

Exemplo numérico completo dado no MOC (43 dígitos de teste, soma ponderada = 644, 644÷11 = 58 resto 6, DV = 11-6 = 5) — reproduza este vetor de teste ao validar sua implementação em `lib/`.

## 7. Credenciamento do contribuinte na SEFIN-RO

Fonte primária: `https://agenciavirtual.sefin.ro.gov.br/credenciamento-emissor-nf-e...`, página **"Credenciamento Emissor NF-e"**, atualizada em **29/07/2026** (extraída via navegação real, conteúdo em Shadow DOM — não indexável por scraping simples).

**Processo (texto literal da página oficial):**
1. Acessar o **Portal do Contribuinte** da SEFIN-RO (`portalcontribuinte.sefin.ro.gov.br`).
2. Localizar o módulo **"Credenciamento Emissor NF-e"**.
3. Selecionar o **ambiente**: homologação (testes, sem validade jurídica) ou produção (documentos juridicamente válidos).
4. Selecionar a empresa a credenciar.
5. Confirmar.

**Requisitos e observações confirmados na página**:
- **Sem taxa** ("Não há cobrança de taxa para utilização desse serviço").
- **Documentação exigida**: "Necessário possuir uma Nota Fiscal de entrada (NF-e de Entrada)" — isto é, **o contribuinte precisa já ter sido destinatário de uma NF-e emitida por terceiros antes de poder se credenciar** ("O contribuinte deverá ser destinatário de NF-e previamente emitida ao credenciamento").
- **Prazo**: credenciamento é **imediato**.
- **Base legal**: **artigo 85º, Anexo XIII, do Regulamento do ICMS de Rondônia, instituído pelo Decreto Nº 22.721/2018**.

**Pré-requisito de acesso**: cadastro e senha validados em `det.sefin.ro.gov.br` (Portal do Contribuinte / declaração eletrônica tributária), citado em fontes secundárias consistentes — recomendo confirmar diretamente no portal, pois não consegui abrir o conteúdo completo do "Portal do Contribuinte" (é outro sistema, `portalcontribuinte.sefin.ro.gov.br`).

**Situação cadastral (CAD-ICMS RO)**: a consulta pública está disponível via SINTEGRA-RO (link a partir de `www.sefin.ro.gov.br`); não localizei um endpoint SOAP dedicado (`CadConsultaCadastro4`) hospedado pela própria SEFIN-RO — ver Lacunas.

**Contato SEFIN-RO**: telefone (69) 3211-6100, e-mail `autoatende@sefin.ro.gov.br`.

## 8. Consumo indevido (erro 656) e boas práticas de retry

Confirmado literalmente no MOC 7.0 – Visão Geral (Tabela 4-9, seção "Consumo Indevido dos Web Services", pág. ~63):

> "Havendo indícios de uso indevido de sucessivas tentativas de busca de registros já disponibilizados anteriormente [...] as novas tentativas serão rejeitadas com o erro **'656 – Rejeição: Consumo Indevido'**. O erro e problema mais comum encontrado pelas Sefaz é o envio repetido (em loop) de requisições para os Web Services [...] devido a algum erro na aplicação do emissor."

O MOC **não especifica um número fixo de requisições/minuto nem um tempo de bloqueio exato** — isso é decidido a critério de cada SEFAZ/autorizador (aqui, SVRS). Fontes secundárias (blogs de fornecedores de software fiscal) mencionam empiricamente limites como "~600 consultas/5 min" e bloqueio de ~60 minutos, mas **isso não está documentado na fonte primária** — trate como **NAO CONFIRMADO** o número exato para SVRS; implemente defensivamente.

**Boas práticas recomendadas** (combinando o texto do MOC + práticas de mercado):
- Nunca reenviar em loop fixo um lote rejeitado por erro de schema ou mesma NF-e rejeitada.
- Implementar **backoff exponencial** com jitter nas consultas de protocolo (`NfeConsultaProtocolo4`), nunca polling em intervalo curto fixo.
- Cachear o resultado de `NfeStatusServico4` (não checar disponibilidade antes de cada envio).
- Para `NFeDistribuicaoDFe`, respeitar o NSU retornado e não repetir requisições para o mesmo NSU já obtido (o MOC cita esse padrão exato como causa do erro 656 na seção 5.7.7.1 "Recomendações Para Evitar o Uso Indevido").
- Um único processo/worker deve concentrar as chamadas SOAP por certificado, evitando múltiplas instâncias concorrentes.

## 9. NFC-e (modelo 65) em Rondônia

Confirmado via `nfce.sefin.ro.gov.br` (Portal NFC-e de Rondônia, FAQ oficial, navegação real):

- **Existe e é obrigatória** desde a **Instrução Normativa 003/2014** (varejo em geral, conforme critérios do IN).
- **Credenciamento**: solicitado pelo **Portal do Contribuinte**; liberado em **até 24 horas** (texto literal: "Em até 24 horas o credenciamento estará liberado").
- **Sem emissor gratuito**: "A SEFIN irá disponibilizar emissor gratuito da NFC-e? Não. O contribuinte deverá providenciar o desenvolvimento de sua solução para NFC-e ou adquirir software que atenda suas peculiaridades."
- **CSC (Código de Segurança do Contribuinte)**: definido na FAQ como o código que garante a autenticidade do DANFE-NFC-e, sigiloso entre contribuinte e SEFIN. Gerado em **`det.sefin.ro.gov.br`**, após login e credenciamento como emissor de NFC-e com certificado digital A1/A3 — este dado veio de fonte secundária consistente (não abri diretamente essa tela por exigir login), recomendo confirmar o fluxo exato no primeiro acesso.
- **QR Code**: a versão vigente nacionalmente é a **v3.00**, definida pela **NT 2025.001** (publicada, vigência de produção a partir de **01/09/2025** conforme cronograma SEFAZ) — reduz a dependência do CSC ao adicionar assinatura digital de campos específicos do QR Code, especialmente relevante em contingência offline.
- **Consulta pública do QR Code/DANFE-NFC-e**: `nfce.sefin.ro.gov.br` (formulário "Consulta por Chave de Acesso" confirmado ao vivo na página).
- **Impressão do DANFE-NFC-e**: qualquer impressora comum, exceto ECF e matricial (texto literal da FAQ).

## 10. Ambiente de homologação

- **Razão social do destinatário obrigatória**: desde **01/05/2011**, toda NF-e emitida em homologação deve trazer no campo `dest/xNome` exatamente o literal **"NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL"** (sem acentos) — violação gera **rejeição 598**. Isso é regra nacional, válida para RO/SVRS igualmente.
- **Validação contra XSD**: baixar o "Pacote de Liberação" (PL) vigente em `nfe.fazenda.gov.br` → Documentos → Esquemas XML, e validar localmente (ex.: `libxmljs`/`xmllint` em Node) antes de enviar. Alternativa online oficial de terceiro público: validador da SVRS em `https://dfe-portal.svrs.rs.gov.br/Nfe/ValidadorXML` (aceita XML de qualquer UF, útil por a SVRS ser exatamente o autorizador de RO).
- Ambos os ambientes de RO/SVRS já compartilham a mesma exigência de TLS 1.2 desde 11/04/2022.

---

## Fontes

- **`https://www.nfe.fazenda.gov.br/portal/webServices.aspx`** (navegado ao vivo, 24/08/2026) — confirma autorizador SVRS para RO, lista de UFs SVRS/SVC-AN/SVC-RS, e URLs de produção de todos os webservices SVRS + NFeDistribuicaoDFe (AN).
- **`https://hom.nfe.fazenda.gov.br/portal/webServices.aspx`** (navegado ao vivo, 24/08/2026) — mesmas informações para o ambiente de homologação.
- **`https://www.nfe.fazenda.gov.br/portal/disponibilidade.aspx`** (navegado ao vivo, verificação 24/08/2026 13:33:51) — confirma texto oficial de cobertura SVRS/SVC-AN/SVC-RS por UF.
- **MOC 7.0 – Visão Geral** (`https://www.confaz.fazenda.gov.br/legislacao/arquivo-manuais/moc7-visao-geral.pdf`, 150 páginas, lido integralmente via extração de texto) — fonte de: padrão de assinatura digital (SHA-1/RSA-SHA1/C14N/Enveloped, Tabela 4-2/4-3), composição e cálculo do DV da chave de acesso (Tabela 2-1, §2.2.6), regras completas de EPEC (§3.3), erro 656/consumo indevido (Tabela 4-9), protocolo SOAP 1.2/TLS 1.2/mTLS (Tabela 4-3), estrutura `nfeCabecMsg`/`nfeDadosMsg`, compactação GZip do método `NfeAutorizacaoLoteZip`, o que deve ser assinado (`infNFe`/`infEvento`/`infInut`).
- **`https://agenciavirtual.sefin.ro.gov.br/credenciamento-emissor-nf-e...`** (navegado ao vivo, conteúdo shadow-DOM extraído via JS) — processo de credenciamento, base legal (Decreto 22.721/2018, art. 85º, Anexo XIII), exigência de NF-e de entrada prévia, gratuidade, prazo imediato. Atualizado em 29/07/2026 conforme selo da própria página.
- **`https://nfce.sefin.ro.gov.br/`** (navegado ao vivo) — FAQ oficial de NFC-e em RO: obrigatoriedade (IN 003/2014), prazo de credenciamento (24h), ausência de emissor gratuito, definição de CSC, uso do QR Code, restrição de impressora.
- **SVRS — comunicado oficial "Desativação dos protocolos TLS 1.0 e TLS 1.1"** (`receita.fazenda.rs.gov.br/conteudo/16647`) — confirma exigência de TLS 1.2+ e orientação de checagem via SSL Labs.
- Notícias/blogs técnicos (Tecnospeed, Focus NF-e, NDD, Avalara) — usados apenas para **corroborar** tpEmis, rejeição 598 (homologação) e NT 2025.001 (QR Code v3); não usados como fonte única de nenhum número crítico.

## Lacunas (NÃO CONFIRMADO — buscar confirmação adicional)

1. **URL exata do `NfeConsultaCadastro4` para contribuintes de RO.** RO não está na lista reduzida de UFs atendidas pela SVRS para esse serviço específico (só AC/ES/RN/PB/SC), e não existe linha própria "Sefaz Rondônia" na tabela nacional de webservices. **Ação recomendada**: contatar SEFIN-RO (autoatende@sefin.ro.gov.br / 69 3211-6100) ou testar diretamente contra `https://cad.svrs.rs.gov.br/ws/cadconsultacadastro/cadconsultacadastro4.asmx` em homologação para verificar se aceita CNPJ de RO apesar de não estar listado.
2. **Tempo exato de bloqueio e limiar de requisições do erro 656 para a SVRS especificamente.** O MOC não define um número; os "~600 req/5min" e "~60 min de bloqueio" citados por blogs de mercado não são confirmáveis em fonte primária — trate como estimativa, não como SLA garantido.
3. **Fluxo detalhado de geração/renovação do CSC em RO** (tela específica dentro de `det.sefin.ro.gov.br`, se há CSC de produção e homologação separados, se há rotina de troca periódica). A página pública da FAQ não descreve o passo a passo; exige login para verificar.
4. **Regras gerais (não-EPEC) de entrada/saída de contingência SVC-AN/SVC-RS** (quando obrigatoriamente mudar de SVRS normal para SVC-AN, prazo de retorno ao autorizador normal) estão no **MOC – Anexo IV – Manual de Contingência NF-e**, documento separado do "Visão Geral" que li integralmente — não obtive esse anexo especificamente; buscar em `nfe.fazenda.gov.br` → Documentos → Manuais.
5. **Número/PL do pacote de schemas XSD vigente em 24/08/2026** — a página de documentos da SVRS mencionou "Event 211110 - NT 2025.002 v1.40" em resumo automatizado, mas não consegui extrair o texto literal da página para confirmar esse número com certeza; confirme diretamente em `nfe.fazenda.gov.br` → Documentos → Esquemas XML antes de fixar a versão do schema no seu validador.
6. **Confirmação com contador/SEFIN** de que a atividade da 364 Food Services (indústria/distribuição de carnes com substituição tributária) não exige credenciamento ou regime especial adicional além do credenciamento padrão de emissor NF-e — o Decreto 22.721/2018 (RICMS-RO) tem anexos específicos de ST por produto que não foram objeto desta pesquisa técnica de integração.