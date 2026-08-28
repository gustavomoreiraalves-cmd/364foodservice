# Cadastro fiscal de produtos: alíquotas, informação adicional por item e cópia de configuração

Data: 2026-08-28
Status: aprovado para plano de implementação

## Contexto

O motor de emissão de NF-e está em produção desde 26/08/2026 (specs
[configuração do emissor](2026-08-25-configuracao-emissor-fiscal-design.md) e
[motor de emissão](2026-08-25-motor-emissao-nfe-design.md), migrações 40 e 43),
mas nenhuma nota foi emitida ainda — nem em homologação. O impedimento não é o
motor: é o cadastro.

Levantamento em produção, 27/08/2026:

```
0364-001  Costela Defumada 500g       NCM 02102000  CEST 1708300  grupo DEFUMADO_BOVINO_ST
0364-002  Costela Desfiada 500g       —
0364-003  Costelinha BBQ 500g         —
0364-004  Cupim Defumado 500g         —
0364-005  Torresmo de Rolo 500g       —
0364-006  Hamburguer de Costela 140g  —
0364-007  Escondidinho de Costela     —
0364-008  Croquete de Costela 500g    —
0364-009  Farofa Crocante 500g        —
0364-010  Geleia de Abacaxi Picante   —
```

Dez dos onze produtos estão sem NCM, sem grupo tributário e sem
`ativo_fiscal`. `resolverNota` recusa cada um deles item a item, com mensagem
que aponta para `/fiscal/tributacao` — mas essa tela cadastra regras, não
completa produtos, e não existe tela nenhuma que mostre quais produtos estão
impedidos de emitir.

### Relação com a importação de produtos do PDV

Corre em paralelo, no branch `feat/importacao-produtos-pdv`, a importação do
cadastro de produtos do PDV Consumer. Ela **já traz campo fiscal**:
`normalizaProdutos.js` grava `ncm`, `cest`, `origem_mercadoria`,
`unidade_tributavel`, `ativo_fiscal: false` e um `grupo_tributario_codigo` —
chave natural no formato `"PDV <CFOP>/<CSOSN>"` — que o script resolve para
`grupo_tributario_id`, criando os grupos que faltarem. São quatro grupos para
458 produtos.

Isso divide o catálogo em duas populações com problemas diferentes:

- **Produtos do PDV (Steakhouse e demais marcas de restaurante).** Chegam com
  NCM vindo do cadastro do Consumer, que é a fonte autoritativa — é com ele
  que a 364 emite NFC-e hoje. Não precisam de cópia de configuração.
- **Linha Food Service (`0364-001` a `0364-010`).** Cadastro B2B feito à mão no
  364 OS, não existe no PDV, não vem nessa carga. São exatamente os dez
  produtos que hoje bloqueiam a emissão de NF-e.

A ferramenta de cópia deste spec serve a segunda população. Ela não é, e não
deve ser desenhada como, o caminho principal de preencher NCM no sistema — esse
caminho é a importação.

Um ponto que a importação **não** resolve, de propósito: o CFOP/CSOSN do PDV
não vira `regras_tributarias`. A regra se resolve por natureza de operação e UF
de destino, que o Consumer não tem; inventar uma seria fabricar informação
fiscal. Depois da carga haverá quatro grupos tributários novos e nenhuma regra
para eles — e produto sem regra é recusado por `resolverNota` mesmo com todo o
cadastro completo.

## Origem

Este é o primeiro de três specs derivados da revisão do módulo fiscal pedida em
27/08/2026, tendo como referência o cadastro de produtos e o gerenciador de
notas do Consumer (PDV usado hoje pela 364 Steakhouse). Os outros dois são o
gerenciador de notas fiscais e os eventos de SEFAZ (cancelamento e
inutilização). A ordem de execução — cadastro, gerenciador, eventos — foi
escolhida porque sem produto liberado não há nota para gerenciar nem para
cancelar.

## O que este spec resolve

Três entregas, nenhuma delas tocando a comunicação com a SEFAZ:

1. Alíquota de PIS/COFINS, base legal e observação fiscal visíveis e editáveis
   na tela de regras tributárias.
2. `infAdProd` por item no XML, alimentado pela base legal e pela observação da
   regra que classificou o item.
3. Tela de situação fiscal dos produtos, com cópia de configuração de um
   produto-fonte para produtos-destino escolhidos.

## Decisões tomadas

### PIS/COFINS continuam na regra tributária, não no produto

No Consumer, situação tributária e alíquota de PIS/COFINS ficam no cadastro do
produto. Aqui elas ficam em `regras_tributarias`, e é onde continuam.

PIS/COFINS variam por operação, não só por produto: uma venda tributada, uma
devolução e uma bonificação do mesmo item têm tratamento diferente. A regra já
é resolvida por produto, grupo tributário, natureza da operação, UF de destino
e perfil do destinatário (`fn_resolver_regra_tributaria`) — é o lugar que
comporta essa variação. Mover os campos para o produto perderia isso.

As colunas `aliquota_pis`, `aliquota_cofins`, `base_legal` e
`observacao_fiscal` **já existem** em `regras_tributarias` e **já são
gravadas** por `salvar()` em `app/fiscal/tributacao/page.js`. Nunca foram
renderizadas no formulário. Portanto esta entrega é exposição de campo
existente, não migração de dados.

### Sem alíquota em valor (`PISQtde` / `COFINSQtde`)

O leiaute 4.00 tem dois grupos para PIS e dois para COFINS: `PISAliq`
(`vBC` + `pPIS` em percentual) e `PISQtde` (`qBCProd` + `vAliqProd`, reais por
unidade). O segundo existe para combustível, bebida e cigarro — mercadoria
vendida por volume com alíquota fixa em reais por litro ou por unidade.

A 364 é Simples Nacional vendendo carne e derivados; PIS/COFINS saem no DAS,
não são calculados nota a nota. `PISQtde` não tem uso previsto. Implementá-lo
custaria serializador, resolver e testes para um caminho que ninguém percorre,
e um seletor de "tipo de alíquota" com uma opção só confunde quem cadastra.

O serializador continua com `PISAliq` / `PISNT` / `PISOutr` (e os equivalentes
de COFINS), como está hoje. Se algum dia entrar revenda de bebida, este spec
não impede — é uma extensão localizada em `montarPIS` / `montarCOFINS`.

### A cópia de configuração é seletiva, nunca em massa

O pedido original era copiar a tributação e o NCM do produto `0364-001` para
todos os produtos da 364 Food Service. Isso classificaria errado boa parte do
catálogo.

`0210.20.00` é carne bovina salgada, seca ou defumada. Aplicá-lo a **Farofa
Crocante** e a **Geleia de Abacaxi Picante** é falso: não são carne. Para
**Escondidinho**, **Croquete** e **Hambúrguer** também é duvidoso — preparação
de carne é capítulo 16 (`1602.50.00`), que é justamente o NCM que aparece no
cadastro do Consumer para pratos prontos.

NCM não é rótulo: define enquadramento em substituição tributária, MVA e
alíquota. Errar o NCM classifica errado a operação inteira.

Por isso a cópia exige escolher os destinos, um por um, e a tela mostra o que
vai mudar em cada um antes de aplicar. A classificação de farofa, geleia e
pratos prontos é pergunta de contador, e este sistema não a responde por
conta própria.

O alcance previsto da ferramenta são os dez produtos da linha Food Service, e
dentro deles o subconjunto que de fato compartilha classificação com o
`0364-001` — os defumados bovinos. Farofa, geleia e pratos prontos ficam de
fora até alguém classificá-los. Para o resto do catálogo, quem preenche NCM é a
importação do PDV, não esta tela.

### `ativo_fiscal` não é copiado

Existe uma trava no banco:

```sql
produtos_ativo_fiscal_completo:
  CHECK (NOT ativo_fiscal OR (ncm IS NOT NULL AND origem_mercadoria IS NOT NULL
         AND unidade_tributavel IS NOT NULL AND fator_conversao_tributavel IS NOT NULL))
```

`ativo_fiscal` não é dado fiscal: é a declaração de que alguém conferiu a
classificação e assume que se pode emitir nota com ela. Copiá-la junto com o
NCM seria assinar embaixo de uma classificação que ninguém olhou.

A liberação fica como ação separada na mesma tela, imediatamente depois da
cópia, oferecida apenas para os destinos cujos quatro campos obrigatórios
ficaram completos. Separada o suficiente para ser consciente, próxima o
suficiente para não obrigar a abrir dez produtos um a um.

### Base legal e observação vão para `infAdProd`

`infAdProd` é o campo de informação adicional **por item** (500 caracteres).
É onde a fiscalização espera encontrar "ICMS retido por substituição
tributária conforme…" ou "Isento nos termos do art. X do RICMS/RO", no item a
que se aplica. `infAdic/infCpl` é o rodapé da nota inteira (5000 caracteres) e
já funciona, alimentado pelo texto padrão do emitente mais as observações do
pedido.

A regra tributária vigente da 364 Food Service é CSOSN 500 — ICMS já cobrado
anteriormente por substituição tributária. Nota com ST retido que não diz no
item de onde vem a retenção gera dois problemas concretos: questionamento
fiscal e cliente sem como se creditar.

Como os dois textos vêm da mesma regra e servem ao mesmo propósito, os dois
saem no XML. Separá-los — um sai, outro não — criaria a dúvida "esse campo
sai na nota?" toda vez que alguém cadastrasse uma regra.

## Arquitetura

### Componente 1 — campos de PIS/COFINS e textos no formulário de regra

**Arquivo:** `app/fiscal/tributacao/page.js`

Entram no formulário quatro campos que já existem no estado e na gravação:

| Campo | Tipo | Observação |
|---|---|---|
| `aliquota_pis` | `numeric(6,4)` | precisão de `pPIS` no leiaute |
| `aliquota_cofins` | `numeric(6,4)` | precisão de `pCOFINS` no leiaute |
| `base_legal` | texto | citação do dispositivo legal |
| `observacao_fiscal` | texto | complemento livre |

Validação no envio do formulário:

- alíquotas entre 0 e 99,9999. O limite superior não é 100: as colunas são
  `numeric(6,4)`, ou seja, dois dígitos inteiros e quatro decimais — gravar
  `100` estoura a precisão e vira erro de banco em vez de mensagem de
  formulário. Vazio é permitido e vira `null`, que o resolver já trata como
  zero;
- **base legal e observação, concatenadas, não passam de 500 caracteres**,
  porque é esse o destino delas.

A validação do tamanho vive no cadastro, não na emissão. Falhar na emissão é
caro: o operador já escolheu o pedido, já abriu a tela, e a mensagem chega no
pior momento. Falhar no cadastro é de graça.

O arquivo tem 398 linhas hoje. Se depois da mudança passar de 450, extrair o
bloco de PIS/COFINS e textos para `components/RegraPisCofins.js` — apenas esse
bloco, não um refactor amplo da tela.

### Componente 2 — `infAdProd` no motor de emissão

Duas mudanças, cada uma no arquivo que já tem essa responsabilidade.

**`lib/nfe/resolverNota.js`** — `resolverItem` passa a montar `infAdProd`:

- junta `regra.base_legal` e `regra.observacao_fiscal`, nessa ordem, separados
  por ` — `; partes vazias são omitidas, e as duas vazias resultam em
  `undefined`;
- passa o resultado por `normalizarTexto(valor, 500, descricao)`, que já
  existe, já remove caractere de controle e espaço redundante, e já **lança**
  quando o texto estoura o limite.

Base legal primeiro porque é a citação que dá amparo; a observação complementa.

Isso roda no resolver, e não no serializador, pela mesma razão que toda a
normalização de texto já roda ali: o resolver executa **antes** de
`reservar_numero_fiscal`. Uma falha de schema descoberta no serializador
acontece depois de o número ter sido queimado.

**`lib/nfe/montarXml.js`** — `det` hoje é montado como `prod + imposto`. Passa
a ser `prod + imposto + infAdProd`, que é a posição do leiaute: `infAdProd` é
o último filho opcional de `det`, depois de `imposto` e do `impostoDevol` que
este sistema não emite. A tag é omitida quando o item não tem texto.

### Componente 3 — tela de situação fiscal dos produtos

**Rota:** `/fiscal/produtos`
**Menu:** grupo Fiscal em `lib/menu.js`, entre "Tributação" e "Emissor
(NF-e/NFC-e)", rótulo "Produtos — situação fiscal", módulo `fiscal`.

A tela não é apenas uma caixa de cópia. É uma tabela dos produtos da marca
selecionada com o estado fiscal de cada um: código, nome, NCM, CEST, grupo
tributário, pendências e se está liberado para emissão. Ela responde a uma
pergunta que hoje não tem resposta em tela nenhuma — *quais produtos ainda não
conseguem emitir nota* — e que é exatamente o impedimento atual, em dez dos
onze produtos.

As pendências vêm de `pendenciasFiscaisProduto` (`lib/fiscal.js`), que já
existe e já devolve a lista em português de tudo que falta.

Além delas, a tela mostra um aviso próprio: **o grupo tributário do produto não
tem nenhuma regra cadastrada**. `pendenciasFiscaisProduto` confere que existe
`grupo_tributario_id`, não que exista regra para ele — então um produto pode
passar em todas as pendências, ser liberado, e ainda assim ser recusado na
emissão com "Não há regra tributária para…". Depois da importação do PDV essa
será a situação de todos os 458 produtos, nos quatro grupos que a carga cria.

O aviso é a contagem de regras ativas do grupo, não uma simulação de
`fn_resolver_regra_tributaria`: a resolução real depende de natureza de
operação, UF de destino e perfil do destinatário, que só existem no momento da
emissão. "Zero regras" é certeza de falha; "tem regra" não é garantia de
sucesso, e a tela diz isso nesses termos.

Fluxo da cópia:

1. escolher o produto-fonte num seletor que lista os produtos da marca;
2. marcar os produtos-destino;
3. ver, antes de aplicar, o que muda em cada destino — campo a campo, valor
   atual contra valor que entra, com destaque para sobrescrita de valor já
   preenchido;
4. aplicar;
5. para os destinos cujos obrigatórios ficaram completos, aparece a opção de
   liberar para emissão, como ação separada.

Campos copiados:

| Copia | Não copia | Por quê |
|---|---|---|
| `ncm`, `ex_tipi`, `cest` | `gtin`, `gtin_tributavel` | código de barras é único por produto |
| `origem_mercadoria` | `unidade` | unidade de venda, não é dado fiscal |
| `unidade_tributavel`, `fator_conversao_tributavel` | `peso_liquido_kg`, `peso_bruto_kg` | atributo físico do item |
| `grupo_tributario_id` | `ativo_fiscal` | é declaração de conferência, não dado |
| `ind_escala`, `cnpj_fabricante` | | |
| `cst_ibs_cbs` | | |

A cópia espelha a fonte, inclusive o vazio: se o produto-fonte está sem CEST e
o destino tem um, o destino fica sem CEST. Copiar é substituir, não mesclar —
mesclar produziria um produto que não é igual a nenhum dos dois e que ninguém
conferiu. É por isso que o passo 3 do fluxo existe e destaca sobrescrita: a
remoção de valor tem que estar visível antes de aplicar, não descoberta depois.

A montagem do payload vive em `lib/fiscal.js`, ao lado de
`pendenciasFiscaisProduto`, como função pura — recebe o produto-fonte, devolve
o objeto de campos copiáveis. Assim a lista de campos tem um lugar só, testável
sem banco, e a tela e a rota leem dali.

### Componente 4 — rota de cópia

**`POST /api/fiscal/copiar-tributacao`**

Corpo: `{ origemId, destinoIds: [], liberar: boolean }`.

Autorização, em três camadas, cada uma por causa de um erro já cometido neste
projeto:

1. `autorizarModulo('fiscal')` — confere a permissão de módulo, e só isso.
2. `garantirEmpresa` na origem **e em cada destino**. `autorizarModulo` não
   escopa por empresa; foi exatamente a ausência desse par que produziu o IDOR
   real encontrado na revisão final da fase 1, em rotas que tinham passado por
   revisão individual.
3. Origem e destinos na mesma marca. `grupo_tributario_id` pertence a uma
   empresa; propagá-lo entre CNPJs produz uma regra que nunca resolve, e pior,
   leva a configuração fiscal de um estabelecimento para outro.

Auditoria: inserção direta em `audit_logs` com `usuario_id: user.id`. A RPC
`fn_registrar_auditoria` preenche `usuario_id` com `auth.uid()`, que é sempre
nulo no client service-role que as rotas usam — auditar por ela de dentro de
uma rota grava linha órfã.

A liberação (`ativo_fiscal = true`) acontece na mesma rota quando
`liberar: true`, e só para os destinos que passam em
`pendenciasFiscaisProduto` com lista vazia. A trava
`produtos_ativo_fiscal_completo` é a garantia final no banco; a checagem na
rota existe para dar mensagem em português em vez de erro de constraint.

## Tratamento de erro

| Situação | Onde falha | O que o usuário vê |
|---|---|---|
| Alíquota fora de 0–100 | formulário de regra | mensagem no campo, não envia |
| Base legal + observação acima de 500 | formulário de regra | contador de caracteres e recusa no envio |
| Texto estourado chegando pela API | `resolverNota`, antes da reserva | exceção nomeando o campo e o limite |
| Destino de outra marca | rota de cópia | recusa, sem revelar se o id existe |
| Destino fora do `garantirEmpresa` | rota de cópia | mesma mensagem do caso acima |
| Liberação com pendência | rota de cópia | lista das pendências, por produto |
| Cópia parcial | rota de cópia | cada destino é independente; o relatório de retorno diz o que entrou e o que não entrou |

A cópia não é transação única sobre todos os destinos: um destino que falhe não
desfaz os que deram certo. O retorno diz, por destino, o que aconteceu. Essa é
a escolha certa aqui porque a operação é idempotente — reaplicar a mesma cópia
no mesmo destino produz o mesmo resultado — e porque um lote de dez produtos
parando inteiro por causa de um é pior do que nove entrarem.

## Testes

**`lib/fiscal.js`**
- o payload da cópia leva os dez campos previstos;
- o payload não leva `gtin`, `gtin_tributavel`, `unidade`, `peso_liquido_kg`,
  `peso_bruto_kg`, `ativo_fiscal`;
- campo nulo na fonte é copiado como nulo, não omitido — copiar significa
  espelhar, inclusive o vazio.

**Tela de situação fiscal**
- produto cujo grupo não tem regra ativa recebe o aviso;
- produto cujo grupo tem ao menos uma regra ativa não recebe o aviso;
- produto sem grupo nenhum aparece com a pendência de
  `pendenciasFiscaisProduto`, não com o aviso de regra — são coisas diferentes.

**`lib/nfe/resolverNota.js`**
- `infAdProd` com base legal e observação, na ordem, separados por ` — `;
- só base legal; só observação; nenhuma das duas (resulta em `undefined`);
- texto com quebra de linha crua é normalizado;
- texto acima de 500 lança, e o teste verifica que isso acontece antes de
  qualquer reserva de número.

**`lib/nfe/montarXml.js`**
- `infAdProd` presente e posicionado depois de `</imposto>`, dentro de `det`;
- `det` sem `infAdProd` quando o item não tem texto;
- caractere que exige escape XML no texto sai escapado.

**`app/api/fiscal/copiar-tributacao`**
- recusa sem o módulo `fiscal`;
- recusa destino de outra marca;
- recusa destino que não passa em `garantirEmpresa`;
- copia os campos previstos e não toca `ativo_fiscal`;
- com `liberar: true`, libera só os destinos sem pendência e relata os demais;
- grava `audit_logs` com `usuario_id` preenchido.

## Fora de escopo

- `PISQtde` / `COFINSQtde` (alíquota em valor por unidade).
- Cópia em massa sem seleção de destinos.
- Mover PIS/COFINS do cadastro de regra para o cadastro de produto.
- Sugestão automática de NCM por descrição do produto.
- Gerenciador de notas fiscais, exportação XLS, download de XML — spec própria,
  segunda da série.
- Cancelamento e inutilização de numeração — spec própria, terceira da série.

## Pendências que este spec não resolve

Continuam abertas, e nenhuma delas impede a implementação:

- **A classificação fiscal de farofa, geleia e pratos prontos é do contador.**
  Este spec dá a ferramenta para aplicar a classificação; não a decide.
- **A regra tributária vigente está com CSOSN 101 e CFOP 5405**, par
  incoerente. `5405` é venda de mercadoria com ST retido anteriormente, na
  condição de contribuinte substituído — e o campo `st_responsavel` da própria
  regra diz `substituido`. O CSOSN que corresponde é `500`, que o serializador
  já emite; `101` é recusado de propósito, por exigir `pCredSN`, que vem de
  `parametros_simples_nacional` e ainda não é lido. O cadastro do Consumer para
  o mesmo tipo de produto usa `5405` com `500`, e a chave natural de grupo que
  a importação gera para esses itens é literalmente `"PDV 5405/500"`. Três
  confirmações independentes do mesmo par. Corrigir é ação de cadastro, não de
  código.

- **Depois da importação do PDV haverá quatro grupos tributários sem nenhuma
  regra.** Cadastrá-las é trabalho de contador — uma por grupo, não uma por
  produto. Este spec entrega o aviso que torna essa lacuna visível; não
  cadastra as regras.
- **O grupo `DEFUMADO_BOVINO_ST` tem descrição "Defumado Bovino, NCM 0201" e o
  produto tem NCM `0210.20.00`.** Um dos dois está errado.
- **`ICMSSN500` sai com `orig` e `CSOSN` apenas**, sem o grupo opcional
  `vBCSTRet` / `pST` / `vICMSSubstituto` / `vICMSSTRet`. É válido no schema e
  suficiente para homologação; para produção, confirmar com o contador se o
  cliente precisa desses valores para se creditar.
