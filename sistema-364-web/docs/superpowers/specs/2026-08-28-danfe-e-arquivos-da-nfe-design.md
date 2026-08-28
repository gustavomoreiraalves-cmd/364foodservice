# DANFE e acesso aos arquivos da NF-e emitida

Data: 2026-08-28
Status: aprovado para plano de implementação

## Contexto

A primeira NF-e da 364 foi autorizada em 28/08/2026 — nº 2, série 3, chave
`11260837541736000187550030000000021541041714`, protocolo `311260000018151`,
em homologação. O motor guarda os dois XMLs no Storage (`xml_path` e
`nfeproc_path` em `nfe_saida_documentos`), e a tela do pedido mostra chave,
número e protocolo.

Só que **não existe caminho nenhum da interface até os arquivos**, e não existe
DANFE. Na prática: a nota está autorizada e ninguém consegue imprimir nem
mandar o XML para o contador sem alguém abrir o banco e o Storage à mão. Foi o
que aconteceu para conferir esta primeira nota.

O DANFE não é conveniência: é o documento que acompanha a mercadoria em
trânsito. Sem ele o ciclo de venda não fecha, mesmo com a nota autorizada.

### O que já está sendo construído em paralelo

No branch em andamento existe `app/fiscal/notas/page.js` — a **listagem** de
notas, com abas Emitidas / Pendentes / Com erro, colunas e busca, apoiada em
`bucketNota` e `montarRelatorioNotas` (`lib/emissaoFiscal.js`). Ela não tem
nenhuma ação: nem baixar, nem exportar, nem imprimir.

**Este spec não redesenha essa tela.** Ele entrega o que falta — o DANFE e o
acesso aos arquivos — de forma que a listagem possa acionar depois, sem que as
duas frentes disputem os mesmos arquivos.

## O que já existe

| Peça | Estado |
|---|---|
| `xml_path` / `nfeproc_path` gravados | sim, desde a atualização 43 |
| Policy do Storage para o cliente ler | sim — `recebimentos_storage_select` libera pelo primeiro segmento do caminho, que é o `empresa_id` |
| `signedUrlRecebimento()` | sim, em `lib/storage.js` |
| `lib/nfe/arquivos.js` | **sim**, commitado em `5d62a51`: diz quais arquivos existem e como rotulá-los |
| Fiação do download na tela do pedido | escrita, não commitada — ver "Pendências" |
| `fast-xml-parser` | já é dependência, usado em `lib/nfe/parseNFe.js` |
| Convenção de impressão | `components/FichaPrint.js` — `.print-area` oculta na tela, `window.print()`, limpeza no `afterprint` |
| Qualquer coisa de DANFE | **não existe** |
| Biblioteca de PDF ou de código de barras | **não existe, e este spec não adiciona** |

## Decisões tomadas

### O DANFE é HTML com CSS de impressão, não PDF gerado no servidor

Três caminhos foram considerados: HTML impresso pelo navegador, biblioteca de
PDF no servidor (`pdfkit`, `puppeteer`), e serviço externo de DANFE.

Fica o primeiro. O DANFE acompanha a mercadoria **impresso** — quem precisa
dele imprime, e a caixa de impressão do navegador já oferece "Salvar como PDF"
para o caso de mandar por e-mail. Um `puppeteer` baixaria um Chromium inteiro
para produzir o mesmo papel. E o serviço externo reintroduziria dependência de
terceiro exatamente no ponto que o projeto escolheu internalizar.

Se um dia aparecer necessidade de PDF sem navegador — anexar automaticamente
num e-mail ao cliente —, a biblioteca entra em cima do mesmo HTML, sem
refazê-lo.

### A fonte do DANFE é o nfeProc, não o banco

O DANFE representa **o que a SEFAZ autorizou**, não o que este sistema acha que
enviou. Os dois divergem sempre que a gravação local falha parcialmente, e
divergem em silêncio.

Além disso, o banco não guarda tudo o que o DANFE precisa: `dhRecbto` (data e
hora da autorização) e `digVal` só existem dentro do `protNFe`. `nfe_saida_itens`
tampouco tem o texto de `infAdProd` nem o `infCpl`.

Então o componente parte do XML: baixa o `nfeproc_path`, parseia com
`fast-xml-parser` (já é dependência) e monta o DANFE a partir dele. Uma nota
sem `nfeproc_path` não imprime DANFE — imprime uma mensagem dizendo que o
arquivo autorizado não está guardado aqui e que a chave deve ser consultada no
portal da SEFAZ.

### O código de barras é escrito à mão, em SVG

O DANFE exige a chave de acesso em **Code128-C**. A chave é 44 dígitos, sempre
numérica e sempre de comprimento par — que é exatamente o caso fácil do
Code128-C: cada par de dígitos vira um símbolo, mais `Start C`, o dígito
verificador do próprio código de barras e o `Stop`.

São cerca de oitenta linhas e uma tabela de 107 padrões. Uma biblioteca de
código de barras genérica traz dezenas de simbologias que este projeto nunca
vai usar, e vira dependência a manter. Sai em SVG porque escala na impressão
sem borrar, ao contrário de canvas rasterizado.

### Homologação imprime com marca d'água

Em homologação o DANFE precisa dizer que não tem valor fiscal — o XML já traz
`tpAmb 2` e a razão social do destinatário fixada pela SEFAZ, mas o papel
impresso, fora de contexto, não deixa isso óbvio. Uma faixa diagonal
`SEM VALOR FISCAL` atravessa a página quando `tpAmb` é 2.

Ler o ambiente do XML, e não da configuração da empresa, é deliberado: a
configuração muda, o documento impresso é sobre a nota que foi emitida.

## Arquitetura

### Componente 1 — `lib/nfe/code128.js`

Puro. `code128c(digitos)` recebe uma string numérica de comprimento par e
devolve a sequência de barras e espaços como larguras — a representação
mínima, sem SVG, sem DOM.

Testável sem navegador, e é onde erro dá silêncio: um código de barras errado
imprime bonito e não lê no leitor da fiscalização.

### Componente 2 — `lib/nfe/danfe.js`

Puro. Recebe o `nfeProc` já parseado e devolve o modelo do documento: os blocos
do DANFE com os valores formatados como o papel exige — datas em `DD/MM/AAAA`,
valores com separador de milhar, chave em grupos de quatro.

Não conhece React nem Storage. É onde ficam as regras chatas do leiaute:
`tpNF` 0/1 vira "ENTRADA"/"SAÍDA", `indPres` e `modFrete` viram texto, o
`infCpl` e os `infAdProd` vão para os blocos de dados adicionais.

### Componente 3 — `components/DanfePrint.js`

O layout, seguindo a convenção de `FichaPrint`: fica oculto na tela e aparece
só na impressão, com `window.print()` e limpeza no `afterprint`.

Blocos, na ordem que o Manual do DANFE define:

1. Canhoto — recebemos de, data, identificação e assinatura do recebedor
2. Cabeçalho — emitente, o quadro DANFE com entrada/saída, número, série,
   folha, o código de barras, a chave e a frase de consulta de autenticidade
3. Natureza da operação e protocolo de autorização
4. Inscrição estadual, IE do substituto tributário e CNPJ
5. Destinatário
6. Cálculo do imposto — incluindo base e valor do ICMS-ST, que a 364 destaca
7. Transportador
8. Dados dos produtos
9. Dados adicionais — `infCpl` e, por item, `infAdProd`

O bloco de duplicatas não é impresso: esta fase emite `tPag 01` à vista, sem
`cobr`. Quando o contas a receber entrar com parcelas, o bloco entra junto.

### Componente 4 — abrir o DANFE

Um botão "Imprimir DANFE" ao lado dos links de XML, na tela do pedido. Ele
baixa o `nfeproc_path` pela URL assinada, parseia, monta e chama a impressão.

O download acontece na hora do clique, não no carregamento da tela: a maioria
das visitas ao pedido não quer imprimir, e buscar o XML de toda nota aberta
seria tráfego à toa.

## Tratamento de erro

| Situação | O que o usuário vê |
|---|---|
| Nota sem `nfeproc_path` | mensagem dizendo que o arquivo autorizado não está guardado aqui; a nota continua válida, e a chave pode ser consultada no portal da SEFAZ |
| URL assinada falha | a mensagem do erro, sem engolir — mesmo padrão de `verAnexo` em `app/recebimentos/page.js` |
| XML corrompido ou incompleto | recusa nomeando o campo que faltou, em vez de imprimir um DANFE com buracos |
| Nota não autorizada | o botão não aparece; DANFE de nota rejeitada não existe |

## Testes

**`lib/nfe/code128.js`**
- vetores conhecidos de Code128-C, conferidos dígito a dígito contra a
  especificação;
- a chave real da nota nº 2 produz um código com o dígito verificador correto;
- comprimento ímpar e caractere não numérico são recusados.

**`lib/nfe/danfe.js`**
- o `nfeProc` da nota nº 2 (fixture real, gravada em `tests/fixtures/`) produz
  os blocos com os valores do DANFE: `vProd 58,50`, `vBCST 76,05`, `vST 3,42`,
  `vNF 61,92`, protocolo `311260000018151`;
- `tpNF 1` vira SAÍDA; `tpAmb 2` marca o documento como sem valor fiscal;
- a chave sai formatada em grupos de quatro;
- `infAdProd` de cada item aparece nos dados adicionais;
- XML sem `protNFe` é recusado com mensagem nomeando o que faltou.

**`lib/nfe/arquivos.js`** — já coberto, commitado em `5d62a51`.

## Fora de escopo

- **Exportação em lote de XMLs de um período.** É ação da listagem
  (`/fiscal/notas`), que está sendo construída em paralelo; especificá-la aqui
  criaria duas frentes editando a mesma tela. Quando entrar, reaproveita
  `arquivosDaNota`.
- **Exportação XLS da listagem.** Mesma razão.
- **Geração de PDF no servidor.**
- **DANFE simplificado e DANFE de NFC-e** — outro leiaute, e a 364 emite NFC-e
  pelo PDV.
- **DANFE em contingência** (FS-DA, com o dizer de contingência) — o motor não
  emite em contingência.
- **Bloco de duplicatas/cobrança** — entra com o contas a receber.
- **Cancelamento e inutilização** — spec própria, a terceira da série.

## Pendências

- **A fiação do download do XML na tela do pedido está escrita e não
  commitada.** `app/pedidos/[id]/page.js` no diretório de trabalho já traz o
  `select` com `xml_path`/`nfeproc_path`, o handler `baixarXml` e os links. Não
  foi commitada porque o mesmo arquivo carrega, no mesmo diretório de trabalho,
  um refactor em andamento da sessão paralela (extração de `SITUACAO_NOTA` para
  `lib/emissaoFiscal.js`), e commitar a tela sem o `lib` correspondente
  quebraria a compilação. Entra junto quando aquele refactor for commitado.
- **A nota nº 2 é de homologação.** O DANFE dela sai com a marca d'água e com
  o destinatário fixado pela SEFAZ — serve para conferir o layout, não para
  acompanhar mercadoria.
