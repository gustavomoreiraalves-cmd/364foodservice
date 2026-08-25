# Desenho do cadastro fiscal — atualização 36

Migração: `supabase/atualizacao_36_cadastro_fiscal.sql`.
Testes: `tests/migracao-36/verificar.sh` (12 cenários, idempotência e rollback).

Esta é a primeira das duas migrações do módulo de NF-e. A 36 é o cadastro: o que
a empresa vende, para quem vende e sob que regra. A 37 será a emissão: séries,
numeração, notas emitidas, eventos e log da SEFAZ. Separar as duas permite que o
preenchimento do cadastro — que é trabalho humano e demorado — comece em paralelo
com o desenvolvimento do emissor.

## A decisão que estrutura tudo

Produto guarda só o que é intrínseco à mercadoria: NCM, CEST, GTIN, origem,
unidade tributável, peso. Tributação não mora no produto.

CFOP, CSOSN, base, MVA e alíquota dependem de quatro eixos ao mesmo tempo: o que
é vendido, por que está saindo (natureza da operação), para quem (contribuinte ou
consumidor final, e em que UF) e sob que regime o emitente estava naquele mês. Um
campo `csosn` fixo em `produtos` funciona até a primeira devolução ou a primeira
venda a pessoa física — e a partir daí passa a emitir nota com tributo errado sem
gerar erro nenhum, o que só aparece numa fiscalização.

Por isso a tributação vive em `regras_tributarias` e é resolvida na emissão por
`fn_resolver_regra_tributaria`. Quando o contador corrige uma regra, é um update
numa linha, não um deploy.

## Diferenças em relação à proposta original da pesquisa

A especificação em `10-cadastro-produto-fiscal.md` foi seguida no essencial, com
cinco desvios deliberados:

1. **Sem `csosn_padrao`, `cst_icms_padrao` nem `cfop_saida_*_referencia` em
   produtos.** A proposta os incluía como "referência". Um campo de referência
   com nome de campo de verdade acaba sendo usado como campo de verdade. Se a
   regra tributária é a fonte, ela é a única fonte.
2. **Sem `papel_st` no produto.** Ser substituto ou substituído é propriedade da
   operação, não da mercadoria: o mesmo item pode sair com retenção numa venda e
   sem retenção noutra. Ficou só em `regras_tributarias.st_responsavel`.
3. **`cst_ibs_cbs` não é coluna gerada a partir de `cclasstrib`.** A proposta
   usava `left(cclasstrib, 3)`. A correlação entre os dois é de tabela (Informe
   Técnico RT 2025.002), não de substring — ver `08-reforma-tributaria-xml.md`,
   seção 4. São duas colunas independentes, com `tabela_cclasstrib` para ligá-las.
4. **Numeração e série ficaram fora.** A proposta punha `proximo_numero_nfe` em
   `empregadores`. Contador de numeração é estado de emissão com concorrência a
   tratar, e um `update` de coluna solta é exatamente onde nasce nota duplicada.
   Vai para a 37, em tabela própria com reserva atômica.
5. **Adicionado `grupos_tributarios`.** A proposta permitia regra por produto ou
   por NCM. Faltava o nível do meio, que é o que os ERPs chamam de perfil fiscal:
   todo defumado sem cocção se comporta igual, e escrever a mesma regra por SKU
   envelhece mal. A resolução agora tem três níveis de especificidade.

Também ficaram de fora `paises` (a 364 não exporta) e `cbenef_uf` (não foi
confirmado que Rondônia exige o preenchimento de `cBenef` — a coluna existe na
regra tributária, a tabela entra quando houver confirmação).

## Travas que impedem nota errada

- `produtos.ativo_fiscal` e `clientes.ativo_fiscal` só aceitam `true` com o bloco
  fiscal completo. A emissão recusa qualquer um dos dois em `false`. Isso impede
  que dado importado sem revisão vire nota.
- Produto marcado como sujeito a ST sem CEST é recusado no cadastro — seria
  rejeição da SEFAZ na hora de faturar.
- GTIN é validado pelo dígito verificador (módulo 10, GTIN-8/12/13/14) na própria
  constraint. O literal `SEM GTIN`, exigido pelo layout, passa.
- `indIEDest` e a inscrição estadual têm de concordar: indicador 1 exige IE
  preenchida, 2 e 9 exigem que não venha.
- CRT do emitente não pode divergir de `regime_tributario`.
- `ambiente_nfe` nasce em 2 (homologação). Passar para produção é decisão
  explícita, depois do credenciamento na SEFIN-RO.
- `fn_resolver_regra_tributaria` devolve zero linhas quando nada casa. A emissão
  precisa parar aí: chutar um CFOP padrão é o que produz nota errada silenciosa.

## Como fica o catálogo da 364

Classificação informada pela empresa em 24/08/2026. São três famílias fiscais, e
é por isso que o cadastro precisa suportar tributação diferente na mesma nota:

| Família | NCM | CEST | Item | ST em RO | MVA |
|---|---|---|---|---|---|
| Defumado bovino | `02102000` | `1708300` | 83.0 | sim | 35% |
| Defumado suíno (lombo, costelinha, bacon) | `02101900` | `1708701` | 87.1 | sim | 30% |
| Preparações prontas (escondidinho, croquete) | `16025000` | `1707906` | 79.6 | **não** | — |

Três correções vieram da verificação no texto do Anexo VI do RICMS/RO
(`13-itens-st-ro-364.md`):

- **O CEST do suíno informado inicialmente estava errado.** `17.081.00` é
  sardinha em conserva, NCM 1604. O correto para carne suína defumada é
  `17.087.01`, item 87.1, com MVA de **30%** e não 35%.
- **Rondônia não adotou o item 79.6.** No corpo da Tabela XVII a numeração salta
  de 78.0 (mortadela) direto para 83.0 — os itens 79.0 a 82.0 não foram
  internalizados. As preparações prontas ficam fora da ST em RO, no regime
  normal. Fica a ressalva de que o mesmo PDF reproduz esses itens num índice de
  referência cruzada nas páginas 229-230, o que merece consulta formal à SEFIN-RO.
- **O grupo `rastro` não é obrigatório para carnes.** A NT 2016.002 só o exige
  para medicamentos. Por isso `produtos.rastro_obrigatorio` nasce em `false` —
  ligar por escolha continua fazendo sentido, já que a produção rastreia lote e
  validade de qualquer forma.

Existe ainda uma pista que pode valer dinheiro no defumado suíno: o §3º da Parte
1 do Anexo VI diz que, para o item 87.1, se o imposto foi pago sobre o animal
vivo nos termos dos itens 27 e 34 do Anexo II, considera-se pago o ICMS de toda
a cadeia até o consumo final. Vale perguntar ao frigorífico fornecedor se ele
opera sob esse regime — se sim, pode não haver nova retenção a fazer.

Preenchimento de um SKU, tomando a costela defumada como exemplo:

| Campo | Valor |
|---|---|
| `ncm` | `02102000` |
| `cest` | `1708300` |
| `origem_mercadoria` | `0` — nacional |
| `unidade` (uCom) | `PC` |
| `unidade_tributavel` (uTrib) | `KG` |
| `fator_conversao_tributavel` | peso médio da peça |
| `sujeito_st` | `true` |
| `grupo_tributario_id` | `DEFUMADO_BOVINO_ST` |
| `rastro_obrigatorio` | `false` — opcional para carnes; ligar é escolha da empresa |
| `cclasstrib` | nulo até 04/01/2027 |

E as regras que esse grupo precisa, para vender só dentro de Rondônia:

| Natureza | Destinatário | CFOP | CSOSN | st_responsavel | MVA |
|---|---|---|---|---|---|
| `VENDA_PRODUCAO` | contribuinte (revendedor) | 5401 | 201 ou 202 | `substituto` | 35% |
| `VENDA_PRODUCAO` | consumidor final | 5101 | 102 | `nao_aplicavel` | — |
| `VENDA_REVENDA` | qualquer | 5405 | 500 | `substituido` | — |
| `DEVOLUCAO_VENDA` | espelha a nota original | 1202 ou 1411 | espelha | espelha | espelha |

O CSOSN e a MVA acima são a hipótese que a pesquisa sustenta, não conclusão
fechada — por isso estão em linhas de banco, e não em código.

## Carga inicial

`supabase/seed_36_tabelas_fiscais.sql` carrega o recorte que a operação usa
hoje: os oito NCM que aparecem no catálogo e nas notas de entrada, os seis CEST
do Anexo XVII correspondentes, a aplicação rondoniense dos itens confirmados, os
dezoito CFOP de saída interna e devolução, as unidades de medida e os cinco
municípios de RO por onde a operação circula. É idempotente e cada linha carrega
o ato normativo que a sustenta.

## Marca, CNPJ e a quem pertence cada coisa

O sistema tem dois eixos que parecem o mesmo e não são: `empresas` é a marca
(eixo do RLS e de todo `empresa_id`) e `empregadores` é a pessoa jurídica. Em
produção há dois CNPJs e quatro marcas:

| CNPJ | Razão social | Emite | Marcas |
|---|---|---|---|
| `37541736000187` | 364 Steakhouse Comercio de Alimentos Ltda | **NF-e 55** | 364 Steakhouse, 364 Food Service |
| `60361009000150` | 364 Steakhouse Buffet e Eventos Ltda | **NFS-e** (Ji-Paraná) | 364 Foodtruck/Afya, 364 Burguer |

Decisão da empresa em 24/08/2026: a marca 364 Food Service fatura no CNPJ da
Steakhouse Comercio de Alimentos, e o CNPJ de Buffet e Eventos concentra o
faturamento da 364 Afya e dos eventos, que é onde mora o ISS. Em produção o
vínculo de 364 Food Service ainda apontava para o CNPJ errado — corrigir pela
tela `/empresas`, desvinculando a marca de um e vinculando ao outro. Os dois
CNPJs já têm certificado A1 ativo.

Quem emite a nota é o **CNPJ**, não a marca. Isso fixa três regras de desenho:

1. **Numeração e série pertencem ao `empregador_id`**, nunca ao `empresa_id`. Se
   três marcas do mesmo CNPJ tivessem sequências próprias, a segunda nota de
   número 1 seria rejeitada por duplicidade. A migração 37 ancora `nfe_series`
   no empregador — esta é a razão.
2. **Os parâmetros do Simples também são do CNPJ**, porque o RBT12 é da pessoa
   jurídica inteira. Por isso `parametros_simples_nacional` já aponta para
   `empregador_id`.
3. **A configuração fiscal continua por marca** (`naturezas_operacao`,
   `regras_tributarias`, `grupos_tributarios`), porque é ali que o RLS opera e
   porque marcas diferentes vendem coisas diferentes. Quando duas marcas do mesmo
   CNPJ vendem o mesmo produto, a regra precisa existir nas duas.

## O que falta antes de emitir

1. **Consulta formal à SEFIN-RO** sobre o item 79.6: a ausência no corpo da
   Tabela XVII contra a presença no índice das páginas 229-230 é uma
   inconsistência do próprio texto oficial, e o custo de errar é retenção
   indevida ou falta de retenção.
2. **Tela de cadastro fiscal** para produto e cliente, com a trava `ativo_fiscal`.
3. **Importador de dados fiscais a partir dos XML de entrada.** Os XML de
   fornecedores já armazenados trazem NCM, CEST, GTIN e unidade por item; dá para
   pré-preencher `materias_primas` com `sugerido_automaticamente = true` e
   `confianca_sugestao`, deixando a conferência para uma pessoa.
4. **Resposta do contador** sobre o papel na ST (substituto ou substituído) e a
   classificação dos pratos prontos, onde 1602.50.00 concorre com 2106.90 e 1902.
5. **Migração 37**, com séries, numeração atômica, notas emitidas e eventos.
