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
- **Não tem painel de divergências.** Se um fornecedor mudar o texto de uma
  cobrança recorrente, ou uma saída ficar conciliada fora do prazo esperado,
  hoje isso não aparece destacado em lugar nenhum — só olhando a lista.
- **A conferência automática do saldo não cobre OFX nem CSV** — só PDF, e só
  quando o próprio documento traz os dois saldos. Ver a seção própria abaixo:
  é o ponto mais fácil de confiar mais do que deveria.

## Como importar

Tela: **Financeiro › Conciliação Bancária**. Antes do primeiro arquivo,
cadastre a conta (ou o cartão) em **Financeiro › Contas Bancárias**.

O campo Instituição desse cadastro hoje tem só seis opções fixas — Sicoob,
Cresol, Sicredi, Banco do Brasil, Santander e Bradesco — sem campo livre para
digitar outro nome. Se o grupo abrir conta em um banco fora dessa lista, o
cadastro vai precisar de um ajuste no sistema antes de aceitar essa conta.

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

## A conferência automática do saldo — o que ela realmente cobre

Quando o documento importado informa o saldo do início e do fim do período, o
sistema soma os lançamentos e confere se a conta fecha. Se não fechar, aparece
um aviso na tela dizendo que alguma linha pode ter ficado de fora do arquivo
(uma página que não foi capturada, por exemplo) — é o momento de conferir
antes de sair conciliando.

**Isso só acontece de fato com PDF, e só quando o documento traz os dois
saldos.** Extrato em OFX e em CSV não trazem o saldo do início do período —
é uma limitação do formato em si, não do sistema — então essa conferência
nunca roda para esses dois formatos: a importação segue sem aviso nenhum, o
que **não é a mesma coisa** que "a conta foi conferida e está certa". Quem
importa por OFX ou CSV não tem essa rede de segurança específica; a garantia
de que nenhuma linha se perdeu nesses formatos vem de terem sido gerados pelo
próprio banco, não de uma conferência feita pelo sistema.

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
saída no extrato da conta corrente. Nessa linha, o colaborador usa o botão
**"Associar à fatura"**, escolhe a fatura correspondente, e o sistema baixa de
uma vez todas as parcelas que foram vinculadas às compras daquela fatura, já
com a forma de pagamento "Cartão de Crédito". Assim a despesa é contada uma
única vez, pelo fornecedor certo — em vez de aparecer duas vezes: uma vez em
cada compra da fatura, e outra vez como uma despesa genérica de "cartão de
crédito" quando a fatura é paga.

Se esse passo não for feito, as parcelas das compras continuam pendentes no
contas a pagar mesmo com a fatura toda conciliada — isso é o comportamento
esperado, não uma falha: falta baixar o pagamento.

Se o débito da fatura no extrato não bater com a soma do que já foi conciliado
nela (fatura paga parcialmente, ou no rotativo), o sistema barra a baixa e
mostra a diferença; só segue adiante com uma confirmação explícita na tela,
para não baixar parcelas com base em um valor que não fecha.

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

## Passo a passo

1. Cadastre as contas em **Financeiro › Contas Bancárias** — uma linha para
   cada conta corrente e cada cartão de crédito (ver a observação sobre as
   seis instituições disponíveis, na seção "Como importar").
2. Importe o arquivo em **Financeiro › Conciliação Bancária**, escolhendo a
   conta e se é extrato ou fatura.
3. Se aparecer o aviso de que o saldo não fechou — o que só pode acontecer com
   PDF — confira se alguma linha do arquivo original ficou de fora antes de
   seguir.
4. Confirme as sugestões: quando há lançamentos sugeridos, aparece um botão
   "Confirmar N sugestões" que resolve todas de uma vez (uma falha em um item
   não trava os outros — a tela mostra quais ficaram de fora e por quê). O que
   não tiver sugestão automática fica para resolver um a um, pelo botão
   "Associar" da própria linha.
5. Saída sem conta a pagar correspondente: o botão "Associar" abre, no fim da
   lista de candidatos, um formulário para criar a conta a pagar direto dali
   — já nasce com uma parcela paga na data do débito.
6. Pagamento de fatura de cartão: use "Associar à fatura" na linha do extrato
   da conta corrente (ver a seção "Fatura de cartão de crédito" acima).
7. Conciliou errado? O botão "Desfazer", na própria linha já conciliada,
   desfaz a associação; se foi ele quem baixou a parcela, ela volta para
   "Pendente".
