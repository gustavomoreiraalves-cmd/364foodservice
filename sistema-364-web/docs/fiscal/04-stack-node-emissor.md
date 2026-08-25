# Emissor de NF-e em Next.js 14 (Vercel) + Supabase — Avaliação Arquitetural

**Contexto avaliado**: 364 Food Services, Next.js 14 App Router (JS/ESM), Supabase Postgres, deploy Vercel. Certificado A1 já cifrado em banco (AES‑256‑GCM, `lib/certificadoServer.js` com `node-forge`). Objetivo: emitir NF-e 55 (venda, devolução, bonificação, ST) a partir de 24/08/2026.

---

## 1. Bibliotecas npm para NF-e em Node.js — avaliação real (dados do registry npm, consultado hoje)

| Pacote | Última versão | Última publicação | Licença | Layout 4.00 | Assina XML | SOAP p/ SEFAZ | Veredito |
|---|---|---|---|---|---|---|---|
| **node-sped-nfe** ([npm](https://www.npmjs.com/package/node-sped-nfe), [github](https://github.com/kalmonv/node-sped-nfe)) | 1.2.52 | **2026-04-11** | MIT | Sim (NFe 55 + NFCe 65) | Sim (`xml-crypto` 6.x) | Sim, com consulta de status/recibo, inutilização, carta de correção, manifestação, DANFE | **Ativa e mantida.** Única lib "full-stack" de emissão realmente viva hoje. **Mas depende de `pem` (1.14.8, publicado 2023-06-02) para lidar com o `.pfx`, e `pem` faz `spawn` do binário `openssl` do sistema operacional** — ver §3, é o ponto crítico de risco na Vercel. |
| **nfewizard-io** ([npm](https://www.npmjs.com/package/nfewizard-io), [site](https://nfewizard-org.github.io/)) | 1.1.2 | **2026-08-01** | GPL-3.0 | Sim | Sim | Sim (Axios) | Ativa, publicação muito recente. **Licença GPL-3.0** exige atenção jurídica se o sistema for proprietário/fechado (copyleft forte) — checar com jurídico antes de embarcar em produto comercial fechado. |
| **node-mde** ([npm](https://www.npmjs.com/package/node-mde)) | 0.14.13 | 2026 (ativa) | — | Sim | usa `node-forge` 1.3.1 + `xml-crypto` 2.1.6 | Só manifestação do destinatário/consulta, **não emite** | Útil apenas para o módulo de entrada que vocês já têm, não para emissão. |
| **nfe-danfe-pdf** ([npm](https://www.npmjs.com/package/nfe-danfe-pdf), [github](https://github.com/flaviosoliver/nfe-danfe-pdf)) | 1.0.3 | ativa | — | Gera DANFE a partir do XML autorizado | N/A | N/A | Usa `pdfkit` puro (sem headless Chrome) — **melhor achado para o item 5**, ver §5. |
| **node-dfe** ([npm](https://www.npmjs.com/package/node-dfe)) | 0.0.25 | **2022-03-22** | MIT | Desatualizada | — | — | **ABANDONADA.** 4+ anos sem release. |
| **node-nfe** (Webschool-io) | 1.0.24 | **2021-03-16** | MIT | Desatualizada | — | — | **ABANDONADA.** 5+ anos sem release, layout provavelmente quebrado com NTs recentes (§ reforma tributária). |
| **ns-nfe-node** | 1.1.0 | dependente da API própria da NS Tecnologia | MIT | via API terceira | Não (feito no backend deles) | Não (é wrapper de SaaS) | Não é lib de emissão direta na SEFAZ, é SDK de outro SaaS. |
| **nfe-io / client-nodejs** ([npm](https://www.npmjs.com/package/nfe-io), [github](https://github.com/nfe/client-nodejs)) | 5.2.0 | **2026-07-14** | MIT | via API da NFE.io | Não (feito no backend deles) | Não | SDK do SaaS NFE.io (ver §4), não é emissor direto SEFAZ. |

**Bibliotecas de suporte (não são "libs de NFe", mas compõem a stack DIY do item 2/3/7):**

| Pacote | Versão/publicação | Uso |
|---|---|---|
| `xml-crypto` ([npm](https://www.npmjs.com/package/xml-crypto)) | 6.1.2, 2025-04-24 | Assinatura digital XML (XMLDSig) |
| `node-forge` ([npm](https://www.npmjs.com/package/node-forge)) | 1.4.0, **2026-03-24** | Extração de chave/cert do `.pfx` PKCS#12 — já é o que vocês usam em `certificadoServer.js` |
| `@xmldom/xmldom` | 0.9.12, **2026-08-21** (publicado há 3 dias) | DOM parser para o `xml-crypto` operar |
| `fast-xml-parser` | 5.11.0, **2026-08-16** | Já está no projeto |
| `xmllint-wasm` ([npm](https://www.npmjs.com/package/xmllint-wasm)) | 5.3.0, **2026-08-05**, **zero dependências nativas** | Validação XSD via WASM — ver §7 |
| `easy-soap-request` | 5.20.0, **2026-08-03** | Envelope SOAP simples para os webservices da SEFAZ |

**Honestamente abandonadas: `node-dfe` (2022) e `node-nfe` (2021).** Não usar — além de desatualizadas, não cobrem nenhuma das mudanças de leiaute da Reforma Tributária (NT 2025.002, ver §6/nota final).

---

## 2. Assinatura XML em Node sem lib de NFe (`xml-crypto` + `node-forge`)

### Extração da chave/certificado do `.pfx`
Padrão confirmado (uso documentado do `node-forge`, [issue #298](https://github.com/digitalbazaar/forge/issues/298) e [issue #121](https://github.com/digitalbazaar/forge/issues/121)):

```js
const forge = require('node-forge');

function extrairDoPfx(bufferPfx, senha) {
  const asn1 = forge.asn1.fromDer(forge.util.createBuffer(bufferPfx.toString('binary')));
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, senha);

  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const chavePrivada = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag][0].key;

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const certificado = certBags[forge.pki.oids.certBag][0].cert;

  return {
    chavePrivadaPem: forge.pki.privateKeyToPem(chavePrivada),
    certificadoPem: forge.pki.certificateToPem(certificado),
  };
}
```

Isso é exatamente o que `lib/certificadoServer.js` provavelmente já faz para extrair material do `.pfx` cifrado — a diferença é que para **assinar XML** vocês passam o `chavePrivadaPem`/`certificadoPem` resultantes para o `xml-crypto`, não para `https.Agent` (isso é outro uso, item 3).

### Canonicalização e armadilhas conhecidas
O leiaute NF-e exige `CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"` (C14N **sem** comentários, não é Exclusive C14N) — confirmado no fórum técnico [GUJ](https://www.guj.com.br/t/assinaturas-de-arquivos-xml-da-nfe/295887/) e é regra do MOC. `xml-crypto` tem [issue histórica aberta](https://github.com/yaronn/xml-crypto/issues/158) sobre canonicalização não-exclusiva — testar exaustivamente contra o validador do SVRS antes de ir a produção, não confiar cegamente na lib.

Armadilhas conhecidas na prática de emissores brasileiros (conhecimento consolidado do ecossistema, não uma única fonte citável — trate como "boas práticas de mercado", não como norma):
- **Acentuação/encoding**: o XML deve ser gerado e assinado em UTF-8 sem BOM; qualquer normalização Unicode (NFC vs NFD) feita entre a geração e a assinatura invalida o digest.
- **Quebra de linha**: o `infNFe` assinado não pode ter quebras de linha/indentação entre os elementos — a canonicalização exige a string exata sem espaços supérfluos; serializadores que "prettify" o XML antes de assinar quebram a assinatura.
- **Self-closing tags**: elementos vazios devem ser serializados de forma consistente (`<tag></tag>` vs `<tag/>`) — a SEFAZ é tolerante na maioria dos casos, mas alguns validadores de terceiros e o próprio C14N tratam isso; o ponto crítico real é gerar o XML uma única vez como string e assinar exatamente essa string, sem re-serializar depois.
- **Namespace**: o namespace `xmlns="http://www.portalfiscal.inf.br/nfe"` deve estar declarado no elemento raiz `<NFe>`, não repetido redundantemente dentro de `<infNFe>` — declarações de namespace duplicadas/deslocadas são causa clássica de rejeição de assinatura.
- A assinatura entra como filho de `<NFe>`, irmã de `<infNFe>` (confirmado na pesquisa acima).

**NAO CONFIRMADO**: não localizei um exemplo de referência completo e testado publicamente que combine `xml-crypto` 6.x + `@xmldom/xmldom` especificamente contra o schema NF-e 4.00 atualizado (pós NT 2025.002). Recomendo prova de conceito com XML real e validação cruzada no ambiente de homologação do SVRS antes de qualquer decisão de "construir do zero".

---

## 3. mTLS em Node/Vercel — funciona, mas com ressalvas sérias

### `https.Agent` com `pfx` + `passphrase`
Tecnicamente correto: `new https.Agent({ pfx: buffer, passphrase: senha })` funciona no runtime Node da Vercel — **mas não com `fetch()` nativo**, que não aceita `agent`/credenciais TLS customizadas (confirmado na pesquisa). É necessário usar o módulo `https` nativo diretamente ou `axios`/`undici` com `Agent` customizado.

### A Vercel tem um recurso nativo de mTLS de saída
Achado relevante: a Vercel expõe uma API REST — **"Upload client certificate for egress mTLS"** — para configurar certificado cliente por projeto e por origem de destino ([Vercel REST API docs](https://vercel.mintlify-docs-rest-api-reference.com/docs/rest-api/reference/endpoints/projects/upload-client-certificate-for-egress-mtls)). **NAO CONFIRMADO** em detalhe: não consegui validar via fonte primária da própria Vercel (`vercel.com/docs`) as condições de uso, se é Enterprise-only, o modelo de custo, e se aceita rotação de certificado por CNPJ (múltiplos certificados A1, já que "364" pode ter mais de uma empresa/CNPJ no sistema multiempresa). Antes de depender disso, seria necessário confirmar diretamente com o suporte Vercel ou achar a página oficial ainda não indexada pela busca — isso não invalida a abordagem "fazer mTLS na mão dentro da function", que é o caminho mais testado.

### Limites confirmados da Vercel (fonte: [vercel.com/docs/functions/limitations](https://vercel.com/docs/functions/limitations) via busca, e [changelog Vercel Functions 30 min](https://vercel.com/changelog/vercel-functions-can-now-run-up-to-30-minutes)):
- **Hobby**: teto de execução de 60s (default 30s, sem 10s fixo confirmável — o "10s" citado no seu prompt não bateu com a fonte encontrada, tratar como legado).
- **Pro**: default 300s, configurável até 800s sem flag especial e **até 30 minutos** (1800s) para runtimes Node.js/Python com configuração explícita de `maxDuration` — mudança relativamente recente do plano Pro/Enterprise.
- **Bundle**: limite prático de **~50 MB comprimido** por function (relevante para o item 5, DANFE via headless Chrome).
- Timeout excedido devolve `504 FUNCTION_INVOCATION_TIMEOUT`.

Isso muda o cálculo: **se o projeto está no plano Pro, 300s (ou até 30 min com configuração) é suficiente de sobra** para um ciclo completo de assinatura + envio SOAP + polling de recibo dentro de uma única invocação — a preocupação clássica de "timeout de 10s da Vercel inviabiliza SEFAZ" **é desatualizada** para planos pagos em 2026. Ainda assim, a arquitetura correta (§6) não deve depender de manter a function viva esperando a SEFAZ — deve poder retomar via nova invocação consultando o recibo.

### Bloqueio de conexões TLS mutual de saída
Não há evidência de bloqueio de saída mTLS na Vercel — o `https.Agent` com `pfx` roda dentro do runtime Node como qualquer processo Node normal; a única camada gerenciada pela Vercel é o **TLS de entrada** (documentado em [vercel.com/docs/cdn-security/encryption](https://vercel.com/docs/cdn-security/encryption), que não fala de restrição de saída). O ponto de atenção real não é "a Vercel bloqueia", é **cold start** — cada invocação fria recria o `Agent`/handshake TLS do zero (~200-500ms adicionais típicos de handshake mTLS, sem fonte específica quantificada para o caso SEFAZ — **NAO CONFIRMADO** o número exato).

### Vercel é adequada, ou precisa de serviço separado?
**Conclusão técnica**: dá para fazer mTLS direto numa function da Vercel plano Pro. **Não é necessário** um worker/container separado só por causa do mTLS em si. O que pode justificar um serviço separado é outra coisa: **controle de estado durante retentativas longas e filas** (§6), não o mTLS.

---

## 4. Alternativas SaaS — comparação

| Provedor | Cobertura (NFe 55/NFCe 65/eventos/DistribuicaoDFe) | ST completa | Preço público | SDK Node | Cert. A1 entregue a eles |
|---|---|---|---|---|---|
| **Focus NFe** ([precos](https://focusnfe.com.br/precos/)) | NFe, NFSe, NFCe, CTe, MDFe, NFCom, DCe — não especifica ST/DistribuicaoDFe na página de preços | NAO CONFIRMADO (não achado explicitamente) | **Publicado**: Solo R$89,90/mês (100 notas, +R$0,10/nota extra); Start R$113,90/mês (3 CNPJs); Growth R$548/mês (4.000 notas); Enterprise sob consulta (>50k notas/mês) | Sim, REST/JSON, qualquer stack | Sim, upload do `.pfx` |
| **NFE.io** ([precos](https://nfe.io/precos/emissao-nfe/)) | NFe (produto) dedicado | NAO CONFIRMADO | **Publicado**: Base R$190/mês (250 notas); Crescimento R$265/mês (500 notas); Escala R$375/mês (1.000 notas); descontos semestral/anual | Sim ([client-nodejs](https://github.com/nfe/client-nodejs), TS, zero deps) | Sim |
| **PlugNotas / Tecnospeed** ([docs](https://docs.plugnotas.com.br/)) | NFe, NFCe, NFSe, NFCom, MDFe — cobertura ampla, mais de 2.000 software houses clientes (dado do próprio marketing) | NAO CONFIRMADO | **Não publicado** — modelo é sob consulta/comercial | REST/JSON, SDKs comunitários | Sim |
| **WebmaniaBR** ([docs](https://webmania.com.br/docs/rest-api-nfe/)) | NFe e NFCe via REST | NAO CONFIRMADO | Preço não confirmado na busca atual (achado histórico de contrato antigo R$499,90/mês não é confiável para 2026) | Sim, SDKs oficiais Go/PHP + pacote `@webmaniabr/nfe` no npm | Sim |
| **Nuvem Fiscal** | — | — | — | — | **⚠️ SERVIÇO DESATIVADO.** Comunicado oficial de desativação publicado em 22/04/2026, com desligamento em **31/07/2026** — já ocorrido antes da data de hoje (24/08/2026). Confirmado pelo próprio site (domínio `www.nuvemfiscal.com.br` já não resolve DNS) e por fórum do [Projeto ACBr](https://www.projetoacbr.com.br/forum/topic/91922-comunicado-de-desativa%C3%A7%C3%A3o-do-servi%C3%A7o-nuvem-fiscal-22042026/). **Não considerar como opção.** |
| **eNotas** | NFSe, NFe, NFCe (segundo material de marketing) | NAO CONFIRMADO | NAO CONFIRMADO — página de preços não localizada nesta pesquisa | SDKs não-oficiais existem (ex.: gem Ruby); Node não confirmado como oficial | Sim, modelo padrão do setor |
| **Arquivei** | Não é emissor — é plataforma de **captura/armazenamento** de XML recebidos (NFe/CTe/NFSe), não emite NFe de saída | N/A | Baseado em volume de documentos capturados, não por nota emitida | N/A | N/A — **fora de escopo para emissão**, útil só para o módulo de entrada que vocês já têm |

**Nota importante sobre o caso da 364**: nenhuma fonte encontrada confirma explicitamente suporte a "ST retida" ou campos completos de substituição tributária em nenhum destes provedores — isso é normalmente coberto porque o XML final segue o mesmo schema oficial da SEFAZ (o provedor só valida/transmite), então qualquer um deles deveria aceitar os grupos `ICMSST`/`vBCSTRet`/`vICMSSTRet` se o payload enviado pelo cliente já os preencher corretamente. **A responsabilidade de calcular e preencher os campos de ST corretamente continua sendo do sistema de vocês**, não do SaaS — isso reduz a vantagem da terceirização para esse caso de uso específico (vocês já teriam que calcular tudo certo de qualquer forma).

---

## 5. Geração de DANFE em PDF

**Melhor achado**: [`nfe-danfe-pdf`](https://www.npmjs.com/package/nfe-danfe-pdf) (npm, versão ativa) — gera DANFE a partir do XML autorizado usando **`pdfkit`** puro + `bwip-js` (código de barras) + `qrcode` (que já está no seu projeto). **Não usa headless Chrome**, roda direto numa function Node normal, sem bundle pesado, sem cold start de browser. Esse é o caminho recomendado.

**Alternativa headless Chrome (HTML → PDF)**: `puppeteer-core` + `@sparticuz/chromium` funciona na Vercel, mas com atrito real:
- Limite de bundle **~50MB comprimido**; a combinação `puppeteer-core` + `@sparticuz/chromium` completo já fica **acima disso (~57MB reportado)** — é necessário usar `@sparticuz/chromium-min` (versão stripped) para caber ([fonte](https://www.stefanjudis.com/blog/how-to-use-headless-chrome-in-serverless-functions/), [Sparticuz/chromium no GitHub](https://github.com/Sparticuz/chromium)).
- Cold start adicional relevante (subir um Chromium inteiro por invocação fria).
- Custo: sem custo de licença, mas custo de tempo de execução (billing por duração de function) é maior que gerar PDF nativo com `pdfkit`.

**Recomendação**: usar `pdfkit` (via `nfe-danfe-pdf` como referência de implementação, ou fork/adaptação própria) e **evitar headless Chrome** para essa tarefa específica — é over-engineering caro num ambiente serverless faturado por tempo de execução.

---

## 6. Arquitetura recomendada

### Numeração sequencial sem buraco/colisão em serverless
Confirmado pela pesquisa ([Cybertec](https://www.cybertec-postgresql.com/en/postgresql-sequences-vs-invoice-numbers/), [howto-everything](https://github.com/kimmobrunfeldt/howto-everything/blob/master/postgres-gapless-counter-for-invoice-purposes.md)): **`SEQUENCE` nativa do Postgres não serve** para numeração fiscal porque `nextval()` nunca é revertido em rollback — gera buracos. Padrão correto:
1. Tabela `numeracao_nfe (empresa_id, serie, ultimo_numero)` com **lock de linha explícito** (`SELECT ... FOR UPDATE`) dentro da mesma transação que grava o documento, **ou**
2. `pg_advisory_xact_lock(hashtext(empresa_id || ':' || serie))` no início da transação de emissão — libera automaticamente no fim da transação (commit/rollback), evita lock manual esquecido, e é mais barato que lock de linha sob alta concorrência.

Em ambiente serverless (múltiplas invocações concorrentes de diferentes regiões/instâncias), **o lock tem que estar no Postgres**, nunca em memória do processo Node — cada invocação da Vercel é isolada. `pg_advisory_xact_lock` é a opção certa aqui porque não deixa lock pendurado se a function morrer por timeout no meio (a conexão fecha, o Postgres libera o advisory lock automaticamente).

### Idempotência e retentativa
A própria SEFAZ já entrega o mecanismo de idempotência: **rejeição 204 = "Duplicidade de NF-e"**, retornada quando se reenvia uma nota já processada com a mesma chave de acesso ([fonte](https://simplifique.contmatic.com.br/blogs/rejeicao-204-duplicidade-nfe)). Padrão de retentativa correto, confirmado pela prática de mercado:
1. Nunca reenviar cegamente após timeout de rede/function.
2. Ao suspeitar de timeout, **primeiro consultar o protocolo/recibo** (`NfeConsultaProtocolo` / `NFeRetAutorizacao`) usando a chave de acesso já gerada — se a SEFAZ já processou, recupera o resultado sem reemitir.
3. Só reenviar o lote se a consulta confirmar que **não foi recebido**.
4. Rejeição genérica **999** ("erro não catalogado") é tipicamente transitória do lado da SEFAZ — reenviar após alguns minutos é seguro *desde que* o passo 2 seja sempre feito antes.

### Estados da nota (máquina de estados recomendada)
`rascunho → validando → assinada → enviada_lote → aguardando_recibo → autorizada | rejeitada | denegada | erro_transmissao → (cancelada | carta_correcao)`. A chave de acesso (44 dígitos, calculada por vocês antes do envio, não pela SEFAZ) é o identificador natural para dedupe e para a checagem do passo 2 acima — grave-a assim que gerada, antes mesmo de tentar transmitir.

### Fila
Vercel Functions não têm worker persistente nativo; padrão confirmado para 2026: **Vercel Cron** (retry inexistente, jitter de até 59min no Hobby) para agendamento + **Upstash QStash** para fila HTTP com retry e DLQ nativos ([fonte](https://upstash.com/blog/serverless-background-jobs-and-message-queues-every-major-option-in-2026)) — sem precisar manter worker/container rodando. Dado que a Vercel Pro já suporta até 30 min de execução por invocação, uma fila só é estritamente necessária se o volume de emissão puder gerar concorrência real na mesma série/empresa (o advisory lock do Postgres já serializa isso) ou se quiserem desacoplar "gerar nota" de "processo assíncrono de reenvio pós-falha".

### Armazenamento
XML autorizado (com protocolo anexado) e o DANFE gerado vão para **Supabase Storage**, com o path referenciando a chave de acesso — já é o padrão que vocês usam para NF-e de entrada, replicar para saída.

---

## 7. Validação de XML contra XSD em Node na Vercel

- **`libxmljs2`**: usa bindings nativos (`node-gyp`, `prebuild-install`) — **risco real de falha de build/instalação na Vercel** quando não há prebuild disponível para a arquitetura/versão de Node do ambiente de build (confirmado pelo padrão de issues abertas no repositório, ex. [#660 "node 22 não suportado"](https://github.com/libxmljs/libxmljs/issues/660)). Evitar se possível.
- **`xsd-schema-validator`**: sem dependências nativas próprias, mas por trás **chama Java (`xmllint`/Apache Xerces) via `child_process`** dependendo do backend configurado — mesma classe de risco do `pem` no item 3 (depende de binário externo presente no ambiente de execução).
- **`xmllint-wasm`** ([npm](https://www.npmjs.com/package/xmllint-wasm), 5.3.0, publicado **2026-08-05**, **zero dependências, zero binário nativo, roda em WASM**) — é a opção mais segura para a Vercel, porque WASM compila e roda dentro do runtime Node sem depender de toolchain nativo no build nem de binário externo no runtime. **Recomendado para o item 7.**

---

## 8. Ambiente de teste/homologação confiável

- A SEFAZ (via SVRS, que autoriza RO) mantém **ambiente de homologação dedicado** com URLs próprias (`*hom*` / `homologacao`), confirmado em [dfe-portal.svrs.rs.gov.br/NFe/Servicos](https://dfe-portal.svrs.rs.gov.br/NFe/Servicos) — CNPJ de teste padrão (`99999999000191`, prática consolidada de mercado, não é preciso usar CNPJ real da empresa para testar o fluxo técnico) e ambiente que não gera obrigação fiscal real.
- Testes automatizados (CI) **não devem bater na SEFAZ real, nem na de homologação, a cada execução** — padrão recomendado:
  1. Testes unitários da geração/assinatura do XML: validam contra o XSD offline (via `xmllint-wasm`) e conferem a estrutura do `infNFe` assinado — sem rede.
  2. Testes de contrato/integração: mockar as respostas SOAP da SEFAZ (fixtures de XML de retorno real capturados uma vez em homologação) para testar os fluxos de rejeição/autorização/timeout sem dependência de rede em CI.
  3. Um conjunto pequeno e manual de testes "smoke" reais contra homologação, rodado sob demanda antes de releases importantes, não em todo PR.

---

## Recomendação final

**Recomendo (b): integrar direto na SEFAZ, mas isolando a lógica de assinatura/transmissão num módulo próprio dentro do mesmo monorepo Next.js, sem necessariamente um serviço/container separado — rodando como Vercel Functions no plano Pro, com fila HTTP (QStash) só para o loop de retentativa/consulta pós-timeout.**

Justificativa comparando as três opções:

| Critério | (a) Direto no Next.js/Vercel | (b) Direto, módulo isolado com fila | (c) SaaS terceiro |
|---|---|---|---|
| **Custo recorrente** | Baixo (sem mensalidade de SaaS) | Baixo-médio (Vercel Pro já contratado + QStash free tier cobre volume pequeno) | R$90–550+/mês dependendo do provedor/volume (Focus NFe, NFE.io) |
| **Risco técnico** | Médio-alto se tudo síncrono numa function só (timeout, cold start, dependência de binário como `pem`/`openssl` que **não está garantido no runtime Lambda-based da Vercel**, confirmado) | Menor — retentativa desacoplada, lock de numeração no Postgres, DANFE via `pdfkit` sem headless Chrome | Baixo tecnicamente (provedor cuida de NT/schema), mas **risco de continuidade do provedor é real e comprovado agora mesmo** (Nuvem Fiscal desativou em 31/07/2026 dando só 90 dias de aviso) |
| **Prazo de entrega** | Médio (assinatura XML do zero é a parte mais delicada, exige POC validada em homologação) | Médio, pouco maior que (a) por causa da fila | Curto — é a opção mais rápida de colocar no ar |
| **Manutenção contínua** | **Alta e permanente**: a Reforma Tributária está gerando **notas técnicas novas com frequência incomum** — NT 2025.002 já teve pelo menos [v1.00 (03/2025) → v1.10 (07/2025) → v1.34 (04/12/2025, revogando validações críticas) → v1.36 (30/04/2026) → v1.40 (20/05/2026) → v1.51 (04/08/2026, há 20 dias)](https://reformatributaria360.com.br/notas-tecnicas/nota-tecnica-2025-002-v1-34-nf-e-e-nfc-e/). Isso é o fator decisivo: manter isso atualizado manualmente é trabalho contínuo, não um projeto que "termina". | Mesma carga de manutenção do leiaute, mas arquitetura mais isolada facilita atualizar sem reescrever o core do ERP | **Baixa para o time interno** — é exatamente o trabalho que se paga para terceirizar |

**Por que não (c) puro**: a empresa já tem investimento feito em certificado A1 gerenciado internamente e parsing de XML de entrada — a competência técnica para lidar com o schema já existe parcialmente no time. Além disso, os campos de **substituição tributária continuam sendo responsabilidade do sistema de vocês** de qualquer forma (nenhum SaaS calcula ST por vocês, só transmite o que for enviado), o que reduz o ganho real de terceirizar justamente a parte mais específica do caso de uso da 364. E o precedente da Nuvem Fiscal — desativação com 90 dias de aviso, ocorrida há poucas semanas — é um lembrete concreto e recente do risco de dependência de um único fornecedor pequeno nesse mercado.

**Por que não (a) simples**: a `pem` (dependência do `node-sped-nfe`, a única lib DIY viva) shell-a para o binário `openssl` do sistema, e **confirmei que runtimes Lambda-based (Amazon Linux, que é a base do runtime Node da Vercel) não incluem o binário `openssl` por padrão** — isso quebra em produção de forma não-óbvia se não for testado cedo. Rodar tudo síncrono numa única function sem separar o loop de retentativa também cria acoplamento desnecessário com timeout de request.

**Ação concreta recomendada**: 
1. Fazer uma prova de conceito isolada (1-2 dias) assinando um XML de NF-e real com `xml-crypto` + `node-forge` (reaproveitando a extração de chave que já existe em `certificadoServer.js`) e validando contra `xmllint-wasm` + o ambiente de homologação SVRS, **sem depender do `pem`** — implementar a extração PKCS#12 direto com `node-forge` (já dominado no projeto) elimina esse risco específico.
2. Se a POC validar em homologação em prazo razoável, seguir com (b): módulo próprio, lock de numeração via `pg_advisory_xact_lock`, estado da nota em tabela dedicada, DANFE via `pdfkit`.
3. Manter Focus NFe ou NFE.io como **plano B documentado** (não contratado), caso o prazo ou a complexidade de manutenção da Reforma Tributária se prove maior que o esperado — ambos têm preço publicado e SDK Node, então a migração posterior é viável sem reescrever o modelo de dados se a chave de acesso e o XML final continuarem sendo a fonte de verdade.

---

## Fontes

- [npmjs.org registry API](https://registry.npmjs.org) — consultado diretamente para versão/data de publicação/licença de: `node-sped-nfe`, `nfewizard-io`, `node-mde`, `nfe-danfe-pdf`, `node-dfe`, `node-nfe`, `nfe-io`, `xml-crypto`, `node-forge`, `@xmldom/xmldom`, `fast-xml-parser`, `xmllint-wasm`, `libxmljs2`, `xsd-schema-validator`, `pem`, `puppeteer-core`, `@sparticuz/chromium`, `pdf-lib`, `easy-soap-request`, `node-signpdf`.
- [github.com/kalmonv/node-sped-nfe](https://github.com/kalmonv/node-sped-nfe) — confirmação de escopo e dependências (`xml-crypto`, `pem`, `fast-xml-parser`).
- [github.com/digitalbazaar/forge](https://github.com/digitalbazaar/forge/issues/298) — padrão de extração PKCS#12.
- [www.guj.com.br - assinaturas XML NFe](https://www.guj.com.br/t/assinaturas-de-arquivos-xml-da-nfe/295887/) — algoritmo de canonicalização exigido pela SEFAZ.
- [github.com/yaronn/xml-crypto issue #158](https://github.com/yaronn/xml-crypto/issues/158) — limitação conhecida de canonicalização não-exclusiva.
- [vercel.com/docs/cdn-security/encryption](https://vercel.com/docs/cdn-security/encryption) — TLS de entrada, atualizado 2026-07-02; não cobre mTLS de saída.
- [vercel.mintlify-docs-rest-api-reference.com — Upload client certificate for egress mTLS](https://vercel.mintlify-docs-rest-api-reference.com/docs/rest-api/reference/endpoints/projects/upload-client-certificate-for-egress-mtls) — existência do recurso; detalhes não confirmados em fonte primária.
- [vercel.com/docs/functions/limitations](https://vercel.com/docs/functions/limitations) e [changelog "Functions can now run up to 30 minutes"](https://vercel.com/changelog/vercel-functions-can-now-run-up-to-30-minutes) — limites de duração e bundle.
- [stefanjudis.com — headless Chrome serverless 50MB](https://www.stefanjudis.com/blog/how-to-use-headless-chrome-in-serverless-functions/) e [github.com/Sparticuz/chromium](https://github.com/Sparticuz/chromium) — limite de bundle real para Puppeteer na Vercel.
- [dfe-portal.svrs.rs.gov.br/NFe/Servicos](https://dfe-portal.svrs.rs.gov.br/Nfe/Servicos) — confirmação de que RO usa SVRS como autorizador de NF-e.
- [nfe.fazenda.gov.br — Nota Técnica 2025.002](https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=04BIflQt1aY%3D) e [focusnfe.com.br/notas-tecnicas/nfe/2025-002](https://focusnfe.com.br/notas-tecnicas/nfe/2025-002/) — cronograma IBS/CBS/IS (produção obrigatória desde 05/01/2026, Simples Nacional a partir de jan/2027).
- [reformatributaria360.com.br — NT 2025.002 v1.34](https://reformatributaria360.com.br/notas-tecnicas/nota-tecnica-2025-002-v1-34-nf-e-e-nfc-e/) e [inventti.com.br](https://inventti.com.br/reforma-tributaria-versao-1-34-da-nt-2025-002-da-nf-e-nfc-e-revoga-validacoes-criticas-de-ibs-e-cbs/) — histórico de versões da NT até v1.51 (04/08/2026) e revogação de validações críticas em 04/12/2025.
- [projetoacbr.com.br — comunicado de desativação Nuvem Fiscal](https://www.projetoacbr.com.br/forum/topic/91922-comunicado-de-desativa%C3%A7%C3%A3o-do-servi%C3%A7o-nuvem-fiscal-22042026/) — desativação em 31/07/2026, aviso publicado 22/04/2026.
- [focusnfe.com.br/precos](https://focusnfe.com.br/precos/) e [nfe.io/precos/emissao-nfe](https://nfe.io/precos/emissao-nfe/) — tabelas de preço publicadas.
- [cybertec-postgresql.com — sequences vs invoice numbers](https://www.cybertec-postgresql.com/en/postgresql-sequences-vs-invoice-numbers/) e [howto-everything — gapless counter](https://github.com/kimmobrunfeldt/howto-everything/blob/master/postgres-gapless-counter-for-invoice-purposes.md) — padrão de numeração sem buraco.
- [simplifique.contmatic.com.br — rejeição 204 duplicidade](https://simplifique.contmatic.com.br/blogs/rejeicao-204-duplicidade-nfe) e [oobj.com.br — rejeição 999](https://oobj.com.br/bc/rejeicao-999-como-resolver/) — mecanismo de idempotência nativo da SEFAZ.
- [upstash.com/blog — serverless background jobs 2026](https://upstash.com/blog/serverless-background-jobs-and-message-queues-every-major-option-in-2026) — padrão de fila HTTP para Vercel.
- AWS re:Post ([openssl binary Lambda](https://repost.aws/questions/QUj2nTZn5pS3yc-Xx-Bwfp4w)) — confirmação de que runtimes Lambda-based não incluem o binário `openssl` por padrão, base do risco identificado com a dependência `pem`.

## Lacunas

- **Preço publicado de PlugNotas/Tecnospeed e eNotas**: não encontrado publicamente — modelo comercial "sob consulta". Ação: solicitar proposta comercial direta.
- **Suporte explícito a ST retida/campos completos de ICMS-ST em cada SaaS**: nenhuma fonte confirma isso especificamente por provedor — como o XML segue o schema oficial, é razoável assumir que aceitam, mas isso precisa ser validado em ambiente de homologação de cada provedor antes de decidir, não apenas assumido.
- **Condições reais do recurso "egress mTLS" da Vercel** (plano mínimo exigido, custo, se suporta múltiplos certificados por projeto — relevante pro caso multiempresa/multi-CNPJ da 364): não confirmado em fonte primária `vercel.com/docs`. Ação: abrir ticket de suporte com a Vercel ou testar diretamente com conta de teste.
- **Cold start real de handshake mTLS numa function fria da Vercel, medido em produção**: nenhuma fonte quantificou isso para o caso específico SEFAZ. Ação: medir empiricamente na POC.
- **Confirmação se o binário `openssl` está de fato ausente especificamente no runtime Node atual da Vercel** (a fonte encontrada é sobre AWS Lambda genérico, não a imagem específica da Vercel, que pode diferir): recomendo testar diretamente (`child_process.execSync('which openssl')` numa function de teste) antes de descartar `node-sped-nfe`/`pem` definitivamente.
- **Detalhe jurídico da licença GPL-3.0 do `nfewizard-io`** aplicada a um produto proprietário fechado como o sistema da 364: não é pesquisa técnica, é uma questão para o jurídico/contador da empresa antes de decidir usar essa lib.
- **Regras específicas de ST e alíquotas para o estado de Rondônia** aplicadas aos produtos da 364 (carnes/churrascaria): fora do escopo desta pesquisa técnica — consultar o contador/SEFIN-RO diretamente, como já indicado no prompt original.