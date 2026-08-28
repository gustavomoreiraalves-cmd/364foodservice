# ICMS retido por substituição tributária: CSOSN 202 e destaque de ST na NF-e

Data: 2026-08-28
Status: aprovado para plano de implementação

## Contexto

O motor de emissão está em produção e provou o transporte: a primeira NF-e
enviada à SVRS em 28/08/2026 (chave
`11260837541736000187550030000000011862210289`, série 3, número 1,
homologação) foi **recusada por conteúdo**, não por comunicação — rejeição
`434 — NF-e sem indicativo do intermediador`. Isso significa que certificado
A1, assinatura XMLDSig, mTLS com a raiz ICP-Brasil, envelope SOAP e chave de
acesso funcionaram, e a SEFAZ chegou a validar a nota campo a campo. A 434 foi
corrigida no commit `16a0ab9` (`indIntermed` no `ide`).

O que falta agora não é transporte: é tributação.

O contador emitiu, no sistema dele, uma NF-e modelo para servir de referência.
Ela mostra que a operação da 364 Food Service é **substituição tributária com a
364 na posição de substituta** — ela calcula e recolhe o ICMS de toda a cadeia
presumida. O motor não sabe fazer isso.

## A nota modelo, decodificada

NF-e nº 000.000.029, série 005, emitida por 364 Steakhouse Comercio de
Alimentos Ltda (`37.541.736/0001-87`), natureza "Venda", para destinatário
contribuinte em Rondônia.

Item único:

```
196  CARNE SUINA DEFUMADA 364
     NCM 0210.1900   O/CSOSN 0202   CFOP 5401   UN KG   1,0000 × 3.150,00
     EAN: SEM GTIN
```

Impostos:

```
BASE DE CÁLC. DO ICMS     0,00      VALOR DO ICMS          0,00
BASE DE CÁLC. ICMS S.T.   4.095,00  VALOR DO ICMS SUBST.   184,27
VALOR DO PIS              0,00      VALOR DA COFINS        0,00
V. TOTAL PRODUTOS         3.150,00  V. TOTAL DA NOTA       3.334,27
```

Rodapé: `DOCUMENTO EMITIDO POR ME OPTANTE PELO SIMPLES NACIONAL, NAO GERA
DIREITO A CREDITO FISCAL, NAO PERMITE O APROVEITAMENTO DE ICMS, ISS E IPI.`

Três leituras que orientam todo o resto:

1. **CSOSN 202** — tributada pelo Simples, sem permissão de crédito, **com
   cobrança do ICMS por substituição tributária**. A 364 é a substituta.
2. **ICMS próprio zero, ST destacada.** No Simples não há destaque próprio a
   abater: o valor retido é o imposto cheio sobre a base de ST.
3. **O total da nota soma a ST**: `3.334,27 = 3.150,00 + 184,27`.

## O que o sistema tem hoje

| Peça | Estado |
|---|---|
| `lib/nfe/calculoST.js` — `calcularIcmsST` | **existe, testado contra NF-e real autorizada, e não é chamado por ninguém** |
| `CSOSN_SUPORTADOS` em `montarXml.js` | `['102','103','300','400','500','900']` — 202 é recusado |
| Grupo `ICMSSN202` no serializador | não existe |
| `vBCST` / `vST` no `<ICMSTot>` | fixos em `0` |
| `total.vNF` em `resolverNota` | `vNF: vProd` — não soma ST |
| Campos de ST em `regras_tributarias` | `mod_bc_st`, `mva_percentual`, `mva_ajustada`, `reducao_base_st_percentual`, `aliquota_st_retido`, `st_responsavel` — todos já existem, quase todos nulos |

O cálculo é a parte difícil e ela já está pronta. `calcularIcmsST` recebe
percentuais como percentuais (35 para 35%), trata `creditaOperacaoPropria:
false` para o Simples, e usa arredondamento meio-para-cima em duas casas
porque a SEFAZ confere os totais somando os itens.

## Decisões tomadas

### Os parâmetros vêm da regra tributária, nunca do código

MVA, redução de base de ST e alíquota entram por `regras_tributarias`, que já
tem as colunas. Nenhum número fiscal fica embutido no serializador ou no
resolver.

Isso não é preferência de estilo: MVA e alíquota mudam por protocolo, por
estado e por NCM, e mudam sem aviso. Um valor no código vira uma nota errada
que ninguém percebe até a fiscalização.

### O cálculo roda no resolver, antes de reservar número

`resolverItem` passa a chamar `calcularIcmsST`. Toda a validação e todo o
cálculo continuam acontecendo **antes** de `reservar_numero_fiscal`, pela
mesma razão que o resto já respeita: falhar antes é de graça, falhar depois
queima numeração fiscal.

O serializador não calcula nada — recebe os valores prontos e os escreve.

### O que decide se há ST é `st_responsavel`, não o CSOSN

A regra já tem `st_responsavel` (`substituto` | `substituido` |
`nao_aplicavel`). O CSOSN é consequência do papel, não a causa:

- `substituto` → CSOSN 202, calcula ST, destaca `vBCST` e `vICMSST`
- `substituido` → CSOSN 500, ICMS já retido antes, não destaca nada
- `nao_aplicavel` → os CSOSN que já existem

Derivar o comportamento do papel, e não do código, evita a incoerência que
está no cadastro hoje: o grupo `DEFUMADO_SUINO_ST` está com
`st_responsavel = substituto` e CSOSN 500 ao mesmo tempo — um diz que a 364
cobra a ST, o outro diz que outro já cobrou. **A implementação deve recusar
essa combinação**, com mensagem dizendo qual dos dois corrigir.

### `vNF` passa a somar `vST`

`total.vNF` deixa de ser `vProd` e passa a ser `vProd + vST`. Isso alcança
também o `<pag>`, que já usa `nota.total.vNF` no `vPag` — não precisa de
mudança, mas precisa de teste, porque `vPag` diferente de `vNF` é rejeição.

### O arredondamento fica como está, e a diferença é registrada

`calcularIcmsST` arredonda meio-para-cima. Aplicado ao modelo do contador:

```
4.095,00 × 4,5% = 184,275  →  nosso: 184,28   |   modelo do contador: 184,27
```

O sistema dele truncou. Um centavo não gera rejeição — a SEFAZ confere a
coerência interna da nota, e a nossa fecha em 184,28 do item ao total. Mas as
duas notas não ficam idênticas.

**Não mudar o arredondamento por causa disto.** Meio-para-cima está conferido
contra uma NF-e real autorizada (34.840, série 1, protocolo 211260024029638), e
trocar por truncamento para casar com um caso quebraria o outro. Se o contador
confirmar que a regra do estado é truncar, isso vira uma decisão própria, com
seu próprio conjunto de vetores de teste.

## Arquitetura

### Componente 1 — ST no resolver

**Arquivo:** `lib/nfe/resolverNota.js`, dentro de `resolverItem`.

Quando `regra.st_responsavel === 'substituto'`:

```
calcularIcmsST({
  valorProduto: vProd,
  aliquota: regra.aliquota_interna_destino,
  reducaoBase: regra.reducao_base_percentual,
  mva: regra.mva_percentual,
  reducaoBaseST: regra.reducao_base_st_percentual,
  aliquotaST: regra.aliquota_st_retido,
  creditaOperacaoPropria: false,   // Simples: não há destaque próprio a abater
})
```

`creditaOperacaoPropria: false` é fixo enquanto o emitente for CRT 1 ou 2. Se
um dia a 364 sair do Simples, o valor passa a depender do CRT — e o lugar de
decidir isso é aqui, onde o emitente já é conhecido, não no serializador.

**`202` também entra em `CSOSN_SEM_DESTAQUE`**, a lista que hoje é
`['101','102','103','300','400','500']`. Sem isso o resolver calcularia `vBC`,
`pICMS` e `vICMS` próprios para o item — e o grupo `ICMSSN202` **não tem campo
para nenhum dos três**. O efeito seria uma nota em que o `<ICMSTot>` declara
ICMS próprio que item nenhum destaca: total incoerente, rejeição na SEFAZ, e
difícil de enxergar porque cada metade parece certa isolada. O modelo do
contador confirma: `BASE DE CÁLC. DO ICMS 0,00`, `VALOR DO ICMS 0,00`.

O item resolvido ganha `modBCST`, `pMVAST`, `pRedBCST`, `vBCST`, `pICMSST` e
`vICMSST`. `modBCST` sai do cadastro (`mod_bc_st`); quando a regra usa MVA e o
campo está vazio, o valor é `4` (margem de valor agregado), que é o que o
cadastro descreve.

Validações, todas antes da reserva de número:

- `st_responsavel = substituto` sem MVA **e** sem alíquota de ST → recusa
  nomeando a regra e os campos vazios;
- `st_responsavel = substituto` com CSOSN que não seja 201, 202 ou 203 →
  recusa explicando a contradição;
- `st_responsavel = substituido` com CSOSN 201/202/203 → mesma recusa, ao
  contrário.

### Componente 2 — `ICMSSN202` no serializador

**Arquivo:** `lib/nfe/montarXml.js`.

`202` entra em `CSOSN_SUPORTADOS`. Novo ramo em `montarICMS`, na ordem que o
schema exige:

```xml
<ICMS><ICMSSN202>
  <orig/><CSOSN>202</CSOSN>
  <modBCST/><pMVAST/><pRedBCST/><vBCST/><pICMSST/><vICMSST/>
</ICMSSN202></ICMS>
```

`pMVAST` e `pRedBCST` são opcionais no leiaute e saem omitidos quando não há
valor — `omitir` é diferente de `mandar zero`, e mandar `pRedBCST` zerado
declara uma redução de 0% que não foi cadastrada.

`201` e `203` **não** entram nesta fase. Compartilham o grupo mas mudam o que
mais vai junto (crédito do Simples no 201, redução no 203), e cada um precisa
do seu próprio conjunto de vetores. Ficam recusados com mensagem própria, como
o 101 já é hoje.

### Componente 3 — totais

**Arquivos:** `lib/nfe/resolverNota.js` e `lib/nfe/montarXml.js`.

No resolver, `total` ganha `vBCST` e `vST`, ambos somados item a item, e
`vNF` passa a `vProd + vST`.

No serializador, `<ICMSTot>` deixa de escrever zero fixo em `vBCST` e `vST` e
passa a escrever os totais. Os outros zeros do bloco continuam zero — não há
frete, seguro, desconto, II nem IPI nesta fase.

### Componente 4 — pré-check em `emitir.js`

**Arquivo:** `lib/nfe/emitir.js`.

O pré-check que hoje barra CSOSN não suportado antes de reservar número passa a
barrar também as combinações incoerentes de `st_responsavel` e CSOSN, com o
mesmo texto do resolver. A duplicação é deliberada e já existe no arquivo: o
serializador não pode confiar que quem o chamou validou, e o pré-check evita
queimar numeração.

## Tratamento de erro

| Situação | Onde falha | Mensagem |
|---|---|---|
| Substituto sem MVA e sem alíquota de ST | resolver, antes da reserva | nomeia a regra e os campos a preencher |
| Substituto com CSOSN 500 | resolver e pré-check | aponta a contradição e pede para corrigir um dos dois |
| Substituído com CSOSN 202 | resolver e pré-check | idem, ao contrário |
| CSOSN 201 ou 203 | serializador e pré-check | recusa própria, dizendo que a fase não cobre |
| `vPag` diferente de `vNF` | teste, não runtime | coberto por teste porque a SEFAZ rejeita |

## Testes

**`lib/nfe/resolverNota.js`**
- substituto produz `vBCST` e `vICMSST`; substituído não produz nenhum dos dois;
- **CSOSN 202 zera `vBC`, `pICMS` e `vICMS` do item**, e o `<ICMSTot>` soma
  zero em `vBC` e `vICMS` — o grupo `ICMSSN202` não comporta ICMS próprio, e
  total sem item correspondente é rejeição;
- **o vetor da nota do contador**: `vProd 3.150,00`, MVA 30%, redução 0,
  alíquota 4,5% → `vBCST 4.095,00`. O `vICMSST` esperado é **184,28** (nosso
  arredondamento), e o teste registra em comentário que o sistema do contador
  gravou 184,27 por truncar;
- `vNF = vProd + vST`;
- substituto sem MVA e sem alíquota lança antes de qualquer reserva;
- as duas combinações incoerentes de `st_responsavel` × CSOSN lançam.

**`lib/nfe/montarXml.js`**
- `ICMSSN202` com os campos na ordem do schema;
- `pMVAST` e `pRedBCST` omitidos quando não há valor, não zerados;
- `<ICMSTot>` com `vBCST` e `vST` reais;
- `vPag` igual a `vNF` quando há ST;
- `201` e `203` continuam recusados, com mensagem própria.

## Fora de escopo

- CSOSN 201 e 203.
- FCP e FCP-ST (`vBCFCPST`, `pFCPST`, `vFCPST`).
- ST interestadual e MVA ajustada (`mva_ajustada` fica onde está, sem uso).
- Mudança do arredondamento para truncamento.
- Ressarcimento e restituição de ST.
- O grupo opcional de `ICMSSN500` (`vBCSTRet`, `pST`, `vICMSSubstituto`,
  `vICMSSTRet`), que continua saindo só com `orig` e `CSOSN`.

## Pendências que este spec não resolve

Nenhuma delas impede implementar; todas impedem emitir a nota final.

- **Os três parâmetros de ST.** Do DANFE saem duas razões exatas —
  `vBCST/vProd = 1,30` e `vICMSST/vBCST = 4,5%` — e duas equações não
  determinam três incógnitas. MVA 30% com redução 0% e alíquota 4,5%
  reproduzem a nota, mas MVA 35% com redução também reproduziria a primeira.
  **Perguntar ao contador**, não inferir.
- **O centavo.** Confirmar se a alíquota é 4,5% com truncamento ou uma
  alíquota diferente que fecha redondo.
- **`informacoes_complementares_padrao` da 364 Food Service está vazio.** A
  frase do Simples é exigência legal e o modelo do contador a traz.
- **O produto do modelo não existe liberado aqui.** É carne suína, NCM
  `0210.1900`; o equivalente é `0364-003` (Costelinha BBQ), hoje sem fator de
  conversão e sem liberação. `0364-001` é bovina, NCM `0210.2000`.
- **O CFOP do modelo é 5401** (venda de produção do estabelecimento em
  operação com ST), coerente com a 364 ser substituta porque ela defuma o
  produto. O grupo `DEFUMADO_BOVINO_ST` está com 5405, que é revenda de
  mercadoria de terceiro já substituída. Se a 364 defuma também a costela
  bovina, esse grupo está classificado errado — pergunta de contador, não de
  sistema.
