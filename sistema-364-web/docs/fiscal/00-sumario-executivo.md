# Emissão de NF-e na 364 Food Services — sumário executivo da pesquisa

Pesquisa feita em 24/08/2026 por 11 agentes, em duas rodadas, sobre fontes primárias
(RICMS/RO, CONFAZ, portal nacional da NF-e, SEFIN-RO, Resolução CGSN 140/2018, LC 214/2025).
Cada afirmação numerada abaixo tem fonte e data no documento de origem. O que não foi
possível confirmar está marcado como lacuna, aqui e no fim de cada documento.

## Perfil confirmado da operação

| Item | Resposta |
|---|---|
| Regime tributário | Simples Nacional (CRT 1) |
| Operação central | compra carne **já abatida** de frigorífico e industrializa (defumação) |
| Destino das vendas | **somente dentro de Rondônia**, incluindo venda a consumidor final pessoa física |
| Documentos | NF-e modelo 55 e NFS-e; NFC-e e MDF-e fora do escopo por ora |
| Emissão hoje | emissor gratuito / PDV Consumer — já existem XML autorizados da própria empresa |
| NFS-e | Ji-Paraná e outro município de RO a definir |
| Arquitetura | a decidir com base nesta pesquisa |

## As sete conclusões que decidem o projeto

**1. Vender só dentro de RO corta metade da complexidade.** Sem operação interestadual não há
GNRE, não há inscrição como substituto tributário em outra UF, não há DIFAL e não há partilha
com estado de destino. O motor tributário da primeira versão precisa resolver apenas operações
internas de RO, incluindo venda a consumidor final (`indFinal=1`, CFOP 5.101/5.102/5.405).
Isso reduz drasticamente o escopo da fatia 6 do plano de implementação.

**2. A 364 é substituta tributária no produto defumado, não substituída.** Como compra a carne
já abatida e a transforma, a 364 é a primeira a colocar o produto industrializado em circulação.
A isenção rondoniense da carne (Convênio ICMS 108/2023 para suíno, 128/2025 para bovino) é
expressamente restrita a *"carnes e miúdos frescos comestíveis resultantes do abate"* — não
alcança produto defumado. Logo, na saída do defumado a 364 calcula e retém ICMS-ST, usando
CSOSN 201/202/203, com MVA de 35% sobre a alíquota interna de 19,5%.
Confirmação do contador ainda pendente (ver lista no fim).

**3. O NCM do produto defumado depende do processo, e é ele que define tudo.**
- Defumação a frio, só sal e fumaça, **sem cozimento** → NCM 0210 → CEST 17.083.00/17.083.01 → em ST, MVA 35%.
- Defumação a quente **com cozimento** ou tempero elaborado, sem invólucro → NCM 1602 → provavelmente fora da lista de ST.
- Produto **embutido** em tripa (linguiça, calabresa defumada) → NCM 1601 → CEST 17.076.00/17.077.00/17.078.00 → em ST, MVA 35%.

Antes de fechar o cadastro é preciso levantar, SKU a SKU, a ficha técnica: se há cocção,
temperatura interna atingida e se há invólucro. O sistema precisa suportar NCMs diferentes por
produto, com tributações diferentes, no mesmo pedido.

**4. A compra da carne crua não deve sofrer ST na entrada.** A Cláusula Nona do Convênio ICMS
142/2018 e o art. 11 da Parte 1 do Anexo VI do RICMS/RO afastam a ST quando a mercadoria se
destina a emprego em industrialização. Na prática isso exige uma declaração de destinação
industrial entregue ao fornecedor. Vale conferir se os XML de entrada já recebidos estão
vindo com ou sem ST retida — o sistema já tem esses XML armazenados.

**5. Ser Simples Nacional dá fôlego de quatro meses no prazo mais apertado do calendário.**
A reforma tributária (grupo IBSCBS no XML, NT 2025.002) já rejeita nota de emitente do regime
normal desde 03/08/2026. Para CRT 1, 2 e 4 — o caso da 364 — a rejeição só entra em
**04/01/2027**. Isso permite lançar a NF-e sem o grupo completo e evoluir o gerador depois,
mas o modelo de dados precisa nascer preparado: `cClassTrib` e CST de IBS/CBS por produto,
e a alíquota de crédito do Simples por competência.

**6. A alíquota de crédito do Simples muda todo mês.** O art. 60 da Resolução CGSN 140/2018
fixa a fórmula `{[(RBT12 × alíquota nominal) − parcela a deduzir] / RBT12} × percentual de
distribuição do ICMS`. Como depende do RBT12, é recalculada mensalmente e vai no XML em
`pCredSN`/`vCredICMSSN` mais a frase obrigatória em `infAdic`. Isso **não pode** morar no
cadastro do produto: precisa de uma tabela de parâmetros do Simples por competência.

**7. NF-e própria, NFS-e terceirizada.** Rondônia usa a SVRS como autorizador e SVC-AN em
contingência — um único ambiente estável, com URLs conhecidas, e o certificado A1 já está
cifrado e funcionando no sistema. Já a NFS-e é fragmentada por prefeitura: Ji-Paraná não teve
o sistema confirmado (as fontes divergem entre ISSWEB/Fiorilli e portal próprio), Ariquemes usa
ISSWEB, Vilhena e Cacoal usam WebISS. Construir e manter integração municipal para um volume
marginal de serviço não se paga; a recomendação é usar um provedor (PlugNotas ou equivalente)
só para a NFS-e.

## Recomendação de arquitetura

Integração direta com a SEFAZ, num módulo isolado dentro do próprio Next.js, reaproveitando
`lib/certificadoServer.js`. Sem lib pronta de NF-e: a única viva (`node-sped-nfe`) depende do
pacote `pem`, que executa o binário `openssl` do sistema, ausente no runtime da Vercel. O
caminho é `node-forge` (já dominado no projeto) para extrair a chave do .pfx, `xml-crypto` para
assinar, e `https.Agent` com pfx para o mTLS — `fetch()` nativo não aceita certificado de
cliente e quebraria silenciosamente.

Focus NFe e NFE.io ficam documentados como plano B, não contratados. Vale registrar que a Nuvem
Fiscal foi desativada em 31/07/2026 com 90 dias de aviso — é o argumento concreto contra
depender de fornecedor pequeno nesse mercado.

## Ordem de implementação proposta

Oito fatias verticais, detalhadas em `11-arquitetura-no-repo.md`. A primeira é deliberadamente
a menor coisa que elimina o maior risco: consultar `NfeStatusServico4` na homologação da SVRS
com o certificado real, provando que o mTLS funciona na Vercel sem binário externo. Depois vêm
numeração e chave de acesso (100% offline e testável), montagem e assinatura do XML validada
contra o XSD, transmissão ponta a ponta em homologação, idempotência, motor tributário de ST,
cancelamento e DANFE, e por fim o botão em produção atrás de flag.

## Bloqueios de produto, não de código

Nenhum cliente cadastrado hoje tem endereço, IE ou indicador de IE — nada do bloco `dest` do
XML. Nenhum produto tem NCM, CEST, GTIN ou origem. Mesmo com todo o código pronto, não sai uma
nota sequer sem preencher isso. A boa notícia: os XML de entrada de fornecedores já armazenados
trazem NCM, CEST, GTIN e unidade por item, e servem para pré-preencher o cadastro com
conferência humana. O algoritmo está descrito em `10-cadastro-produto-fiscal.md`, seção 5.

## Perguntas para o contador

1. Confirma que a 364 é substituta tributária na saída do defumado, e não substituída?
2. Qual o NCM correto de cada SKU, dado o processo real de defumação (com ou sem cocção, com ou sem invólucro)?
3. O art. 16, §3º, da Parte 1 do Anexo VI do RICMS/RO condiciona o "imposto pago sobre o animal vivo cobre toda a cadeia" ao regime de abate por encomenda, ou é mais amplo?
4. Existe modelo oficial da SEFIN-RO para a declaração de destinação industrial que dispensa a ST na entrada?
5. Sendo Simples, a 364 está automaticamente no ROT-ST de RO — convém manter ou renunciar?
6. Qual Anexo do Simples se aplica à defumação de carne, e como fica a segregação com o restaurante?
7. Rondônia exige o preenchimento de `cBenef` na NF-e? Se sim, onde está a tabela publicada?

## Pedido operacional

Os XML das notas já autorizadas pelo emissor atual são o gabarito mais valioso disponível:
mostram CFOP, CSOSN e tratamento de ST que a SEFAZ já aceitou desta empresa. Vale juntar dez
ou vinte deles antes de escrever a primeira linha do gerador.

## Índice dos documentos

| Documento | Conteúdo |
|---|---|
| `01-icms-st-rondonia.md` | RICMS/RO, Anexo VI, MVA, alíquotas, Fecoep, antecipação, ROT-ST |
| `02-layout-nfe-4.00.md` | MOC, notas técnicas, estrutura do XML, campos de ST, rejeições comuns, DANFE |
| `03-webservices-sefaz-ro.md` | SVRS, URLs de produção e homologação, contingência, assinatura, credenciamento |
| `04-stack-node-emissor.md` | Bibliotecas npm, mTLS na Vercel, comparativo de SaaS, numeração, recomendação |
| `05-naturezas-cfop.md` | Treze naturezas de operação com CFOP, CSOSN e tratamento de ST |
| `06-simples-nacional-st.md` | CSOSN, pCredSN, ST no Simples, PGDAS-D, sublimite de RO, DeSTDA |
| `07-carne-defumada-ro.md` | NCM e CEST do defumado, alcance do benefício, cenários de compra, IPI |
| `08-reforma-tributaria-xml.md` | Cronograma da LC 214/2025, grupo IBSCBS, datas de rejeição por CRT |
| `09-nfse-nacional-ro.md` | Padrão nacional, municípios de RO, ISS no Simples, recomendação |
| `10-cadastro-produto-fiscal.md` | Especificação do cadastro fiscal e do motor de regras, com DDL completo |
| `11-arquitetura-no-repo.md` | Mapa do repositório, migração 36, camadas de código, oito fatias, riscos |
