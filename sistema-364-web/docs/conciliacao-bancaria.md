# Conciliação bancária

## O que o sistema faz

Importa o extrato da conta corrente ou a fatura do cartão de crédito (em PDF,
OFX ou CSV), lista cada lançamento e ajuda a associar cada saída à parcela
correspondente do contas a pagar. A cada associação confirmada, o sistema
aprende a relação entre a descrição do extrato e o fornecedor — na importação
seguinte, o mesmo tipo de lançamento já chega sugerido, esperando só a
confirmação do colaborador.

O sistema **nunca concilia sozinho**: toda sugestão precisa de um clique de
confirmação antes de baixar qualquer parcela.

## O que esta fase não faz

- **Não concilia entradas** (recebimentos, vendas). Elas entram na lista com
  status "Entrada" só para ficarem visíveis — não geram sugestão nem cobram
  trabalho de ninguém.
- **Não baixa extrato do banco sozinho.** A importação é sempre por upload
  manual do arquivo que você baixa do internet banking; não existe integração
  automática com nenhum banco ainda.
- **Não associa um débito a várias parcelas.** Um único débito de R$ 3.000 que
  pagou três boletos de R$ 1.000 **não casa com nada** nesta tela: os
  candidatos exigem valor exatamente igual, e a confirmação manda uma parcela
  só. Nesse caso, dê baixa nas três parcelas por **Financeiro › Contas a
  Pagar** e deixe a linha do extrato como está. **Não crie uma conta a pagar
  nova** pelo botão da tela — as três parcelas reais continuariam abertas e a
  mesma despesa entraria duas vezes no financeiro.
- **Não tem painel de divergências.** Se um fornecedor mudar o texto de uma
  cobrança recorrente, ou uma saída ficar conciliada fora do prazo esperado,
  hoje isso não aparece destacado em lugar nenhum — só olhando a lista.
- **Não mostra, na linha já conciliada, com qual parcela ela foi conciliada.**
  Para conferir, o caminho é o Contas a Pagar.
- **A conferência automática de fechamento não cobre OFX nem CSV** — nem para
  extrato, nem para fatura de cartão. Só roda de fato com PDF, e só quando o
  documento traz os números necessários. Ver a seção própria abaixo: é o
  ponto mais fácil de confiar mais do que deveria.

## Como importar

Tela: **Financeiro › Conciliação Bancária**. Antes do primeiro arquivo,
cadastre a conta (ou o cartão) em **Financeiro › Contas Bancárias**.

O campo Instituição aceita qualquer texto. Ele sugere os seis bancos do grupo
— Sicoob, Cresol, Sicredi, Banco do Brasil, Santander e Bradesco — mais tudo
que você já cadastrou antes nessa empresa, mas você pode digitar outro nome à
vontade. Vale usar isso para descrever melhor, principalmente em cartão de
crédito, onde o emissor e a bandeira raramente têm o mesmo nome do banco:
"Bradesco Elo Nanquim" e "Nubank PJ" são nomes melhores que "Bradesco".

| Formato | Como é lido | Custo | Confiabilidade |
|---|---|---|---|
| OFX | Parser próprio, entende as duas versões do formato que os bancos usam | Nenhum | A mais alta: o banco já manda os dados estruturados, com um identificador único por transação |
| CSV | O sistema tenta reconhecer as colunas pelo cabeçalho | Nenhum | Boa quando o layout é reconhecido; se não for, o sistema **recusa** o arquivo e pede para reexportar em OFX ou PDF, em vez de arriscar ler a coluna errada e lançar valor trocado |
| PDF | Lido por inteligência artificial (Claude, da Anthropic), que devolve os lançamentos já organizados | Alguns centavos por arquivo (um extrato de ~10 páginas) | Boa, mas depende do PDF estar legível — prefira OFX sempre que o internet banking oferecer essa opção |

**Tamanho máximo do arquivo: 4 MB.** Esse número não é uma escolha arbitrária:
é o teto que a hospedagem do sistema (Vercel) aplica ao corpo de uma
requisição (por volta de 4,5 MB). Um arquivo maior nunca chegaria a ser lido —
a rejeição viria da própria hospedagem, como um erro técnico sem explicação
nenhuma para quem está tentando importar. Por isso o sistema barra antes, com
uma mensagem clara. Na prática: se o PDF de um extrato ficar grande demais,
exporte um período menor pelo internet banking, ou baixe o mesmo período em
OFX — o arquivo fica bem mais leve.

## Variáveis de ambiente

Esta parte é configuração de sistema, não do dia a dia — geralmente fica a
cargo de quem cuida da parte técnica. Fica aqui como referência:

- `ANTHROPIC_API_KEY` — obrigatória para importar PDF. Sem ela, OFX e CSV
  continuam funcionando normalmente; só a leitura de PDF devolve um erro
  explicando o que falta configurar.
- `EXTRATO_IA_MODELO` — opcional. Se não for definida, o sistema usa
  `claude-opus-5` por padrão.

## A conferência automática — o que ela realmente cobre

Existem duas conferências, uma para cada tipo de documento. Para **extrato**,
o sistema soma os lançamentos e confere se bate com a diferença entre o saldo
do início e do fim do período. Para **fatura de cartão**, ele soma as compras
e confere se bate com o total informado da fatura. Nos dois casos, se não
bater, aparece um aviso na tela dizendo que alguma linha pode ter ficado de
fora do arquivo (uma página que não foi capturada, por exemplo) — é o momento
de conferir antes de sair conciliando. O texto do aviso muda conforme o
documento: para extrato ele fala em saldo; para fatura, no total que não bate
com a soma das compras.

Existe ainda um terceiro aviso, esse independente de formato: se um **extrato**
for importado e **nenhuma** linha dele for lida como saída, o sistema levanta a
mão. Extrato sem nenhuma saída não existe na prática — quase sempre é layout
mal interpretado (CSV cujo valor vem sem sinal, com débito e crédito numa
coluna à parte). Sem esse aviso a importação ficaria com a tag verde
"Conciliada" e o painel de lançamentos abriria vazio, porque as entradas ficam
escondidas até você marcar "Mostrar entradas".

**As duas conferências de fechamento só acontecem de fato com PDF, e só quando
o documento traz os números necessários** — saldo inicial e final, no caso do extrato; total da
fatura, no caso da fatura de cartão. Extrato em OFX ou CSV não traz o saldo
do início do período, e fatura em OFX ou CSV não traz o total — são
limitações do formato em si, não do sistema — então, para esses dois
formatos, a conferência correspondente nunca roda: a importação segue sem
aviso nenhum, o que **não é a mesma coisa** que "a conta foi conferida e está
certa". Quem importa extrato ou fatura por OFX ou CSV não tem essa rede de
segurança específica; a garantia de que nenhuma linha se perdeu nesses
formatos vem de terem sido gerados pelo próprio banco, não de uma conferência
feita pelo sistema.

## Como o sistema sugere a associação

Para cada saída do extrato, o sistema procura parcelas em aberto no contas a
pagar que:

1. tenham o **mesmo valor** (com tolerância de 1 centavo) — isso é
   obrigatório, não é só um critério de pontuação;
2. vençam **até 7 dias** antes ou depois da data do débito, contando os mais
   próximos como mais prováveis;
3. e, se aquela descrição já foi confirmada antes para um fornecedor,
   prioriza as parcelas daquele fornecedor. Se nenhuma parcela do fornecedor
   aprendido bater em valor e data, o sistema volta a mostrar todos os
   candidatos — um padrão desatualizado (fornecedor mudou de nome, boleto
   veio de outro CNPJ) nunca esconde a opção certa por causa do aprendizado.

Quando não há um favorito claro entre os candidatos, o lançamento fica como
"Sem correspondência" em vez de arriscar um palpite: um clique a mais do
colaborador custa muito menos do que uma parcela baixada no lugar errado.

## Fatura de cartão de crédito — o ponto que precisa ficar claro

Cada compra da fatura vira uma associação com uma conta a pagar individual, no
fornecedor real (o restaurante, a loja etc. que emitiu a compra). **Mas
conciliar a linha da fatura não baixa a parcela** — o dinheiro daquela compra
ainda não saiu do caixa, só saiu do limite do cartão.

Quem baixa a parcela é o **pagamento da fatura**, quando ele aparece como uma
saída no extrato da conta corrente. Nessa linha, o colaborador clica em
**"Associar à fatura"** para abrir a lista de faturas importadas, escolhe a
fatura correspondente e confirma em **"Baixar parcelas da fatura"** — só aí o
sistema baixa de uma vez todas as parcelas que foram vinculadas às compras
daquela fatura, já com a forma de pagamento "Cartão de Crédito". Assim a
despesa é contada uma única vez, pelo fornecedor certo — em vez de aparecer
duas vezes: uma vez em cada compra da fatura, e outra vez como uma despesa
genérica de "cartão de crédito" quando a fatura é paga.

Essa lista mostra as faturas mais recentes **de todos os cartões da
empresa** — não filtra pelo cartão daquele extrato, porque o débito do
pagamento não carrega essa informação; o próprio sistema não tem como
adivinhar qual cartão foi pago. Escolha pelo nome da conta e pelo período
mostrados em cada opção. A lista traz até 100 faturas, ordenadas pelo período
de cada uma (não pela data em que foi importada) — cobre bem mais de um ano
de operação, mesmo com vários cartões. Se uma fatura muito antiga não
aparecer, ela continua importada e conciliada normalmente; só esse fluxo
específico de baixar o pagamento não alcança faturas fora dessas 100 mais
recentes.

Se esse passo não for feito, as parcelas das compras continuam pendentes no
contas a pagar mesmo com a fatura toda conciliada — isso é o comportamento
esperado, não uma falha: falta baixar o pagamento.

Se o débito da fatura no extrato não bater com a soma do que já foi conciliado
nela (fatura paga parcialmente, ou no rotativo), o sistema barra a baixa e
mostra a diferença; só segue adiante com uma confirmação explícita na tela,
para não baixar parcelas com base em um valor que não fecha.

**Cada fatura é paga uma vez só.** Se você tentar associar um segundo débito à
mesma fatura, o sistema recusa e diz qual lançamento já é o pagamento dela —
antes essa segunda associação não baixava nada e mesmo assim ficava verde, com
uma saída real do banco conciliada contra nada. Pelo mesmo motivo, um débito
que não teria nenhuma parcela a baixar (porque todas já constavam pagas) é
recusado em vez de ser aceito como "0 parcela(s) baixada(s)".

**Uma parcela é de um lançamento só.** Se você tentar conciliar uma parcela que
outro lançamento do extrato já reivindica, o sistema recusa e diz qual é esse
lançamento. Isso é o que impede duas saídas reais de serem contabilizadas
contra a mesma dívida — situação que aparecia justamente com o cartão, porque a
compra da fatura deixa a parcela em aberto de propósito.

## Aprendizado

Cada confirmação ensina o sistema: a descrição do extrato — limpa de acentos,
maiúscula e sem números soltos (data, número de documento, CNPJ) — passa a
apontar para um fornecedor e uma categoria de despesa. Na importação seguinte,
o mesmo tipo de lançamento já chega com status "Sugerido".

Confirmar de novo o mesmo fornecedor para aquela descrição soma mais um uso ao
padrão aprendido. Confirmar um fornecedor diferente **sobrescreve o padrão e
reinicia a contagem em 1** — a última confirmação do colaborador é sempre a
que vale, mesmo que o padrão anterior já tivesse sido confirmado várias vezes.

## Reimportar é seguro

Cada lançamento importado ganha uma identidade única por empresa. Quando o
arquivo é OFX, o próprio banco fornece um número de transação exclusivo para
cada lançamento, e é ele quem garante que reenviar o mesmo arquivo não duplica
nada.

PDF e CSV não trazem esse número. Neles a identidade é montada a partir de
conta + data + valor + descrição, **mais um contador de repetição** que
distingue a primeira, a segunda, a terceira ocorrência idêntica no mesmo dia
— por exemplo, duas tarifas de mesmo valor, ou dois Pix iguais para o mesmo
fornecedor. Sem esse contador, a segunda linha seria descartada por engano,
como se fosse a mesma da primeira. Reenviar o mesmo arquivo continua seguro
porque as linhas aparecem sempre na mesma ordem: os contadores batem de novo
com o que já foi gravado, e nada é duplicado nem perdido.

Na prática: reenviar o mesmo arquivo, ou um período que se sobrepõe a uma
importação anterior, não cria lançamento repetido. O resumo que aparece
depois de importar informa quantos lançamentos já estavam no sistema.

## O que cada status do lançamento significa

| Status na tela | O que quer dizer |
|---|---|
| Sem correspondência | Nenhuma parcela bateu automaticamente; resolva pelo botão "Associar" |
| Sugerido | O sistema achou uma parcela provável; falta só confirmar |
| Conciliado | Já associado a uma ou mais parcelas do contas a pagar |
| Entrada | Lançamento de entrada — fora da conciliação nesta fase, listado só para ficar visível |

A coluna **"Conciliados"** da lista de importações conta **só as saídas** nas
duas pontas — "12/12" quer dizer que as doze saídas daquele arquivo estão
resolvidas, não que ele tinha só doze linhas. As entradas ficam de fora porque
não são conciliadas nesta fase; elas continuam na lista, marcando "Mostrar
entradas".

## Passo a passo

1. Cadastre as contas em **Financeiro › Contas Bancárias** — uma linha para
   cada conta corrente e cada cartão de crédito. O campo Instituição sugere os
   bancos do grupo, mas aceita qualquer texto: use o nome que descreva melhor,
   sobretudo nos cartões.
2. Importe o arquivo em **Financeiro › Conciliação Bancária**, escolhendo a
   conta e se é extrato ou fatura.
3. Se aparecer um aviso de que a conta não fechou — o texto muda conforme o
   documento: fala em saldo para extrato, e no total da fatura para fatura de
   cartão; só pode acontecer com PDF — confira se alguma linha do arquivo
   original ficou de fora antes de seguir.
4. Confirme as sugestões: quando há lançamentos sugeridos, aparece um botão
   "Confirmar N sugestões" que resolve todas de uma vez (uma falha em um item
   não trava os outros — a tela mostra quais ficaram de fora e por quê). O que
   não tiver sugestão automática fica para resolver um a um, pelo botão
   "Associar" da própria linha.
5. Saída sem conta a pagar correspondente: o botão "Associar" abre, no fim da
   lista de candidatos, um formulário para criar a conta a pagar direto dali.
   **O que essa conta nasce valendo depende do documento:**
   - **No extrato bancário**, ela nasce com uma parcela única **já paga** na
     data do débito — o dinheiro saiu do banco naquele dia.
   - **Na fatura de cartão**, ela nasce com uma parcela única **ainda em
     aberto**, vencendo na data da compra. É a mesma regra da seção "Fatura de
     cartão de crédito" acima, e vale igual por este caminho: a compra no
     cartão não tira dinheiro do banco, então ela não pode nascer baixada.
     Quem baixa é o pagamento da fatura, no passo 6. A tela avisa isso no
     próprio formulário.

   Antes de usar este formulário, confira que a despesa **realmente não está
   lançada**. Se ela já existe no contas a pagar mas não apareceu como
   candidata (valor diferente, vencimento fora da janela de 7 dias, ou um
   débito que pagou vários boletos de uma vez), criar uma conta aqui lança a
   mesma despesa duas vezes.
6. Pagamento de fatura de cartão: na linha do extrato da conta corrente,
   clique em "Associar à fatura", escolha a fatura na lista e confirme em
   "Baixar parcelas da fatura" (ver a seção "Fatura de cartão de crédito"
   acima — inclusive o que fazer se a fatura procurada não aparecer).
7. Conciliou errado? O botão "Desfazer", na própria linha já conciliada,
   desfaz a associação; se foi ele quem baixou a parcela, ela volta para
   "Pendente".

   Numa fatura de cartão já paga, o desfazer tem **ordem**: primeiro o
   pagamento da fatura (a linha do extrato da conta corrente), depois a
   compra. O sistema recusa a ordem inversa e explica na hora — desfazer a
   compra primeiro deixaria a parcela em aberto para sempre, porque o
   pagamento da fatura não roda de novo.
8. Importou o arquivo errado (a conta errada, o mês errado)? O botão
   **"Excluir"**, na linha da importação, apaga a importação, todos os
   lançamentos dela e o arquivo guardado. Ele fica **desabilitado enquanto
   houver lançamento conciliado** naquela importação — nesse caso, desfaça as
   conciliações primeiro. Excluir importa mais do que parece: enquanto a
   importação errada existe, cada lançamento dela continua "segurando" a
   parcela que o sistema tinha sugerido, e essa parcela não é oferecida em
   nenhuma importação seguinte. Depois de excluir, é só importar o arquivo de
   novo pela conta certa.
