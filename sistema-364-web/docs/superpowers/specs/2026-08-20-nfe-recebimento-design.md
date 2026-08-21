# Importação de NF-e no módulo de Recebimento

Data: 2026-08-20
Status: aprovado, aguardando plano de implementação

## Problema

Hoje todo recebimento de matéria-prima é digitado à mão: fornecedor, número da nota,
item por item, peso, custo unitário e condição de pagamento. O fornecedor já emitiu
uma NF-e com exatamente esses dados, e a empresa já possui certificado digital A1.
A digitação é lenta, gera divergência de custo e depende de alguém transcrever 44
dígitos sem errar.

## Premissa corrigida

A ideia original era "informar a chave de acesso e o sistema puxa da SEFAZ". Isso não
existe da forma imaginada: o portal público de consulta por chave tem captcha e devolve
apenas o resumo da nota, nunca o XML. O download do XML exige certificado digital no
webservice `NFeDistribuicaoDFe` e, para nota emitida por terceiro, exige a manifestação
do destinatário antes.

Como a empresa já tem o A1, o caminho correto é mais forte do que o pedido original:
em vez de alguém digitar a chave, o sistema varre a SEFAZ por CNPJ e monta uma caixa
de entrada com todas as notas emitidas contra a empresa.

## Escopo

Dentro:

- Caixa de entrada de NF-e alimentada por `NFeDistribuicaoDFe` (varredura por CNPJ).
- Manifestação automática de Ciência da Operação (evento 210210) para liberar o XML completo.
- Guarda cifrada do certificado A1 no Supabase, com upload pela própria aplicação.
- De-para que aprende, ligando o código do produto do fornecedor à matéria-prima cadastrada.
- Preenchimento automático de fornecedor (por CNPJ), parcelas do contas a pagar (por
  duplicata da nota) e peso da nota por item.
- Consulta por chave digitada e upload de XML avulso, como caminhos alternativos.

Fora (YAGNI):

- Lote e validade vindos do bloco de rastreabilidade do XML.
- Confirmação da Operação (evento 210200) e demais manifestações.
- NFC-e, CT-e, emissão de documentos fiscais, geração de DANFE em PDF.

## Arquitetura

### 1. Camada de certificado (somente servidor)

Tabela `certificados_digitais`:

| coluna | tipo | nota |
| --- | --- | --- |
| `id` | uuid pk | |
| `empresa_id` | uuid not null references empresas(id) | |
| `cnpj` | text not null | só dígitos, extraído do próprio certificado |
| `pfx_cifrado` | text not null | base64 do ciphertext AES-256-GCM |
| `pfx_iv`, `pfx_tag` | text not null | |
| `senha_cifrada`, `senha_iv`, `senha_tag` | text not null | senha cifrada separadamente |
| `titular` | text | CN do certificado |
| `valido_de`, `valido_ate` | timestamptz not null | |
| `ativo` | boolean not null default true | |
| `criado_por` | uuid references auth.users(id) | |
| `created_at` | timestamptz not null default now() | |

Regras:

- Cifra AES-256-GCM com `NFE_CERT_MASTER_KEY` (32 bytes em hex, env var da Vercel).
  O `.pfx` e a senha são cifrados como segredos independentes.
- RLS com `using (false)` e `with check (false)` para `authenticated`. Nenhum usuário
  logado lê a linha pelo client, nem administrador. Só o service role, usado nas rotas
  de API, alcança a tabela.
- O upload passa por `POST /api/nfe/certificado`, que abre o `.pfx` com `node-forge`,
  extrai CNPJ, titular e validade, confere o CNPJ contra `empresas.cnpj` da empresa
  atual e recusa se divergir. Só depois cifra e grava.
- `lib/nfeCertificado.js` (servidor) expõe `carregarCertificado(empresaId)` devolvendo
  `{ pfx: Buffer, senha, cnpj, validoAte }` em memória. O material nunca é logado,
  nunca é serializado em resposta e nunca chega ao client.
- Um só certificado ativo por empresa. Subir um novo desativa o anterior em vez de
  apagar, para manter rastro de quem trocou e quando.
- A tela mostra apenas titular, CNPJ mascarado e validade, com aviso quando faltarem
  menos de 30 dias para o vencimento.

Dependências novas: `node-forge` (leitura do pfx), `xml-crypto` (assinatura XMLDSig),
`fast-xml-parser` (leitura do XML da NF-e).

### 2. Cliente SEFAZ (`lib/sefaz/`)

`distribuicaoDFe.js`

- Monta envelope SOAP 1.2 com `distDFeInt` versão 1.01 no namespace
  `http://www.portalfiscal.inf.br/nfe`, contendo `tpAmb`, `cUFAutor`, `CNPJ` e um de
  `distNSU/ultNSU` ou `consChNFe/chNFe`.
- Transporte com mTLS: `undici.Agent({ connect: { pfx, passphrase } })`. O `fetch` do
  Node não aceita `https.Agent`, por isso o `undici` explícito. Rotas com
  `export const runtime = 'nodejs'`.
- Endpoint de produção do Ambiente Nacional:
  `https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx`.
  É endpoint nacional único, então não há tratamento por UF. A URL de homologação e o
  SOAPAction devem ser conferidos contra o Manual de Orientação do Contribuinte vigente
  no momento da implementação, e ficam em constantes num único arquivo.
- A resposta traz `loteDistDFeInt/docZip`, cada um em base64 com gzip. Descompacta com
  `zlib.gunzipSync`. Os esquemas relevantes são `resNFe` (resumo), `procNFe` (XML
  completo), `resEvento` e `procEventoNFe`.
- Códigos de retorno tratados: 137 (nenhum documento localizado), 138 (documento
  localizado, ainda há lote a paginar) e 656 (consumo indevido).

`assinatura.js`

- XMLDSig enveloped, RSA-SHA1, canonicalização C14N, referência ao atributo `Id` do
  `infEvento`. Chave e certificado extraídos do `.pfx` via `node-forge`.

`manifestacao.js`

- Evento `210210` (Ciência da Operação), `cOrgao` 91, `nSeqEvento` 1, enviado ao
  `RecepcaoEvento` do Ambiente Nacional
  (`https://www1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx`).
- Ciência apenas declara que a empresa tomou conhecimento da nota. Não confirma a
  operação nem impede recusa posterior.

`parseNFe.js`

- Converte o XML em `{ chave, emitente: { cnpj, nome, fone, email }, numero, serie,
  dhEmi, modelo, tipo, itens: [{ cProd, xProd, uCom, qCom, vUnCom, vProd }],
  duplicatas: [{ nDup, dVenc, vDup }], vNF }`.
- Função pura, sem rede e sem banco, para ser testável com fixture.

Controle de consumo: a SEFAZ bloqueia quem consulta em excesso. O estado guarda
`ultimo_nsu` e `ultima_consulta_em` por empresa; uma nova varredura só começa se
passou pelo menos uma hora desde a última, exceto quando o retorno foi 138, caso em
que a paginação continua imediatamente até esgotar o lote.

### 3. Tabelas de dados

`nfe_documentos` — um registro por documento visto na SEFAZ ou enviado por upload.

- `id`, `empresa_id`, `chave` (unique por empresa), `nsu`, `modelo`, `tipo_operacao`
- `cnpj_emitente`, `nome_emitente`, `numero`, `serie`, `emitida_em`, `valor_total`
- `status`: `resumo` → `manifestada` → `xml_baixado` → `vinculada`, mais `ignorada`
- `xml_path` (bucket privado), `recebimento_id`, `manifestada_em`, `ultimo_erro`
- `origem`: `sefaz` ou `upload`

`nfe_sefaz_estado` — `empresa_id` como chave primária, `ultimo_nsu`, `max_nsu`,
`ultima_consulta_em`, `ultimo_erro`.

`fornecedor_produto_mapa` — o de-para que aprende.

- `id`, `empresa_id`, `cnpj_emitente`, `codigo_produto` (o `cProd` do XML),
  `materia_prima_id`, `unidade_nf`, `fator_conversao` numeric not null default 1
- unique (`empresa_id`, `cnpj_emitente`, `codigo_produto`)

`fator_conversao` não é opcional: o fornecedor fatura em caixa ou fardo e o estoque
trabalha em quilo. Sem ele, a quantidade importada entra errada.

Alterações em tabela existente: `recebimentos` ganha `nfe_chave text` (unique por
empresa, o que bloqueia lançar a mesma nota duas vezes) e `nfe_documento_id uuid
references nfe_documentos(id)`.

Todas as tabelas novas seguem o padrão de RLS já usado no projeto
(`empresa_id in (select public.empresas_permitidas())`), exceto `certificados_digitais`,
que é fechada para todos.

O XML fica no bucket privado `recebimentos` já existente, em
`{empresaId}/nfe/{chave}.xml`, lido por signed URL como os demais anexos.

### 4. Rotas de API (`app/api/nfe/*`)

Todas com `runtime = 'nodejs'` e `autorizarModulo(request, 'recebimentos')`, seguindo
o padrão de `app/api/ponto/*`.

| rota | função |
| --- | --- |
| `POST /api/nfe/certificado` | valida, cifra e grava o A1 |
| `GET /api/nfe/certificado` | metadados do certificado ativo |
| `POST /api/nfe/sincronizar` | varre por `distNSU`, grava resumos, manifesta ciência dos novos, baixa e guarda o `procNFe` |
| `POST /api/nfe/chave` | consulta uma chave específica; manifesta se necessário |
| `POST /api/nfe/upload` | recebe XML avulso e registra como documento vinculável |
| `GET /api/nfe/documentos` | lista com filtro por status |
| `GET /api/nfe/documentos/[chave]/preparar` | devolve o rascunho de recebimento pronto |

`/preparar` é a peça central: junta parse do XML, casamento de fornecedor por CNPJ,
aplicação do de-para com conversão de unidade e derivação das parcelas a partir das
duplicatas. Devolve dados, não grava nada.

Agendamento: cron da Vercel chamando `/api/nfe/sincronizar` com header `CRON_SECRET`,
mais um botão de sincronização manual na tela. No plano Hobby o cron é limitado a uma
execução diária; nesse caso o botão manual é o caminho principal e o cron vira rede de
segurança.

### 5. Interface

Tela nova **Notas fiscais**, dentro de Recebimento: lista de `nfe_documentos` com filtro
por status, botão "Sincronizar com SEFAZ", e por nota o emitente, número, valor, data,
status e a ação "Registrar recebimento".

No formulário de recebimento, um bloco novo no topo com três entradas:
"Escolher da caixa de entrada", "Colar chave" e "Enviar XML". Ao importar:

- fornecedor casado por `cnpj`; se não existir, botão para cadastrar já preenchido com
  nome, CNPJ, telefone e e-mail do XML;
- os itens entram na área de staging já mapeados; item sem de-para aparece destacado,
  com select de matéria-prima e campo de fator de conversão, e o mapa é gravado no
  momento em que o recebimento é registrado;
- `peso_nota_kg` recebe `qCom × fator_conversao` e o campo de peso conferido fica
  vazio, para ser preenchido pela balança. A divergência entre nota e conferido fica
  visível antes de gravar;
- havendo duplicatas no XML, as parcelas do contas a pagar passam a ser os vencimentos
  reais da nota, e o bloco de condição de pagamento indica isso. Sem duplicatas, o
  comportamento atual com `gerarParcelas` continua valendo.

O upload do certificado fica na área administrativa, junto das demais configurações da
empresa.

### 6. Tratamento de erro

- Certificado ausente, vencido ou com CNPJ divergente: mensagem dizendo exatamente
  qual é o caso; o upload de XML continua funcionando sem certificado.
- SEFAZ indisponível ou retorno 656: grava `ultimo_erro`, mostra quando será possível
  tentar de novo e não bloqueia o registro manual de recebimento.
- Manifestação falha: o documento permanece em `resumo` e ganha um botão de nova tentativa.
- Nota já vinculada: o unique em `recebimentos.nfe_chave` impede lançar duas vezes, e a
  interface avisa apontando o recebimento existente.
- Documento que não é NF-e modelo 55 de entrada (CT-e, devolução, serviço) entra como
  `ignorada` e some da lista padrão.

### 7. Testes

Seguindo o padrão `node --test tests/*.test.mjs` já usado no projeto, sobre funções puras:

- `parseNFe` sobre um XML fixture real, verificando emitente, itens e duplicatas.
- Aplicação do de-para: itens mapeados convertem unidade pelo fator; itens não mapeados
  são devolvidos marcados.
- Parcelas a partir de duplicatas: a soma bate exatamente com o total, e a ausência de
  duplicatas cai no `gerarParcelas` existente.
- Cifra AES-256-GCM: round-trip íntegro, e falha ao adulterar a tag.
- Envelope `distDFeInt`: estrutura esperada, e `gunzip` de um `docZip` fixture.

Sem chamada de rede em teste automatizado. A validação contra o webservice é manual, em
ambiente de homologação, com o certificado real.

## Fases de implementação

1. Parser, upload de XML, de-para e preenchimento do formulário. Funciona sem certificado
   e já elimina a digitação quando o fornecedor manda o XML por e-mail.
2. Certificado cifrado, `distribuicaoDFe`, assinatura e ciência automática.
3. Caixa de entrada, sincronização agendada e vinculação nota-recebimento.

## Decisões registradas

| decisão | escolha |
| --- | --- |
| Origem do XML | Caixa de entrada por CNPJ, com chave e upload como alternativa |
| Guarda do certificado | Supabase cifrado, acessível só pelo service role |
| Manifestação | Ciência automática (210210) em toda nota nova |
| Casamento de itens | De-para por fornecedor que aprende a cada nota |
| Preenchimento extra | Fornecedor por CNPJ, parcelas por duplicata, peso da nota |
