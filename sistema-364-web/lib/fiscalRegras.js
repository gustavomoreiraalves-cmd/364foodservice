// Regras do cadastro de tributação: grupos e regras tributárias.
//
// As validações aqui espelham as check constraints da atualização 36. Elas
// existem para a tela recusar antes de bater no banco e explicar o motivo em
// português — o PostgREST devolveria só o nome da constraint. Quando as duas
// divergirem, o banco é quem manda.

export const ST_RESPONSAVEL = {
  SUBSTITUTO: 'substituto',
  SUBSTITUIDO: 'substituido',
  NAO_APLICAVEL: 'nao_aplicavel',
};

export const ST_RESPONSAVEL_OPCOES = [
  { valor: ST_RESPONSAVEL.NAO_APLICAVEL, label: 'Sem substituição tributária' },
  { valor: ST_RESPONSAVEL.SUBSTITUTO, label: 'Esta saída retém a ST (somos o substituto)' },
  { valor: ST_RESPONSAVEL.SUBSTITUIDO, label: 'A ST já foi retida antes (somos o substituído)' },
];

// Os únicos CSOSN em que o destinatário do regime normal pode se creditar do
// ICMS embutido no preço — art. 23 da LC 123/2006.
export const CSOSN_QUE_PERMITE_CREDITO = ['101', '201', '900'];

export const CSOSN_OPCOES = [
  { valor: '101', label: '101 — Tributada pelo Simples com permissão de crédito' },
  { valor: '102', label: '102 — Tributada pelo Simples sem permissão de crédito' },
  { valor: '103', label: '103 — Isenção do ICMS para faixa de receita bruta' },
  { valor: '201', label: '201 — Com permissão de crédito e com cobrança de ICMS por ST' },
  { valor: '202', label: '202 — Sem permissão de crédito e com cobrança de ICMS por ST' },
  { valor: '203', label: '203 — Isenção para faixa de receita e com cobrança de ICMS por ST' },
  { valor: '300', label: '300 — Imune' },
  { valor: '400', label: '400 — Não tributada pelo Simples Nacional' },
  { valor: '500', label: '500 — ICMS cobrado anteriormente por ST ou antecipação' },
  { valor: '900', label: '900 — Outros' },
];

export const MOD_BC_OPCOES = [
  { valor: 0, label: '0 — Margem de valor agregado (%)' },
  { valor: 1, label: '1 — Pauta (valor)' },
  { valor: 2, label: '2 — Preço tabelado máximo (valor)' },
  { valor: 3, label: '3 — Valor da operação' },
];

export const MOD_BC_ST_OPCOES = [
  { valor: 0, label: '0 — Preço tabelado ou máximo sugerido' },
  { valor: 1, label: '1 — Lista negativa (valor)' },
  { valor: 2, label: '2 — Lista positiva (valor)' },
  { valor: 3, label: '3 — Lista neutra (valor)' },
  { valor: 4, label: '4 — Margem de valor agregado (%)' },
  { valor: 5, label: '5 — Pauta (valor)' },
  { valor: 6, label: '6 — Valor da operação' },
];

// ---------- CST de PIS e COFINS ----------
// Tabelas 4.3.3 e 4.3.4 do ADE Cofis 25/2010. As duas contribuições usam a
// mesma lista de códigos, por isso uma tabela só serve às duas.
//
// Fica em constante, e não em tabela do banco como NCM e CEST, porque é lista
// fechada que não muda por ato normativo trimestral — mesmo caso do CSOSN.
//
// O que separa os códigos NÃO é o regime tributário: é o sentido da operação.
// De 01 a 49 é saída, de 50 a 99 é entrada (crédito). Regime é uso corrente, e
// entra aqui só como destaque em CST_USUAIS_POR_REGIME — nunca escondendo
// código, porque um item monofásico no Simples usa 04 e ninguém adivinharia.
export const CST_PIS_COFINS = [
  { codigo: '01', sentido: 'S', descricao: 'Operação tributável com alíquota básica' },
  { codigo: '02', sentido: 'S', descricao: 'Operação tributável com alíquota diferenciada' },
  { codigo: '03', sentido: 'S', descricao: 'Operação tributável com alíquota por unidade de medida' },
  { codigo: '04', sentido: 'S', descricao: 'Operação tributável monofásica — revenda a alíquota zero' },
  { codigo: '05', sentido: 'S', descricao: 'Operação tributável por substituição tributária' },
  { codigo: '06', sentido: 'S', descricao: 'Operação tributável a alíquota zero' },
  { codigo: '07', sentido: 'S', descricao: 'Operação isenta da contribuição' },
  { codigo: '08', sentido: 'S', descricao: 'Operação sem incidência da contribuição' },
  { codigo: '09', sentido: 'S', descricao: 'Operação com suspensão da contribuição' },
  { codigo: '49', sentido: 'S', descricao: 'Outras operações de saída' },
  { codigo: '50', sentido: 'E', descricao: 'Crédito — vinculado só a receita tributada no mercado interno' },
  { codigo: '51', sentido: 'E', descricao: 'Crédito — vinculado só a receita não tributada no mercado interno' },
  { codigo: '52', sentido: 'E', descricao: 'Crédito — vinculado só a receita de exportação' },
  { codigo: '53', sentido: 'E', descricao: 'Crédito — receitas tributadas e não tributadas no mercado interno' },
  { codigo: '54', sentido: 'E', descricao: 'Crédito — receitas tributadas no mercado interno e de exportação' },
  { codigo: '55', sentido: 'E', descricao: 'Crédito — receitas não tributadas no mercado interno e de exportação' },
  { codigo: '56', sentido: 'E', descricao: 'Crédito — receitas tributadas, não tributadas e de exportação' },
  { codigo: '60', sentido: 'E', descricao: 'Crédito presumido — só receita tributada no mercado interno' },
  { codigo: '61', sentido: 'E', descricao: 'Crédito presumido — só receita não tributada no mercado interno' },
  { codigo: '62', sentido: 'E', descricao: 'Crédito presumido — só receita de exportação' },
  { codigo: '63', sentido: 'E', descricao: 'Crédito presumido — receitas tributadas e não tributadas no mercado interno' },
  { codigo: '64', sentido: 'E', descricao: 'Crédito presumido — receitas tributadas no mercado interno e de exportação' },
  { codigo: '65', sentido: 'E', descricao: 'Crédito presumido — receitas não tributadas no mercado interno e de exportação' },
  { codigo: '66', sentido: 'E', descricao: 'Crédito presumido — receitas tributadas, não tributadas e de exportação' },
  { codigo: '67', sentido: 'E', descricao: 'Crédito presumido — outras operações' },
  { codigo: '70', sentido: 'E', descricao: 'Aquisição sem direito a crédito' },
  { codigo: '71', sentido: 'E', descricao: 'Aquisição com isenção' },
  { codigo: '72', sentido: 'E', descricao: 'Aquisição com suspensão' },
  { codigo: '73', sentido: 'E', descricao: 'Aquisição a alíquota zero' },
  { codigo: '74', sentido: 'E', descricao: 'Aquisição sem incidência da contribuição' },
  { codigo: '75', sentido: 'E', descricao: 'Aquisição por substituição tributária' },
  { codigo: '98', sentido: 'E', descricao: 'Outras operações de entrada' },
  { codigo: '99', sentido: 'E', descricao: 'Outras operações' },
];

// Ordem importa: o primeiro de cada lista é o que a tela mostra no topo.
// No Simples o PIS e a COFINS estão dentro do DAS e a nota não destaca nada —
// daí o 49 liderar. Os demais existem porque continuam legítimos: monofásico
// (04), alíquota zero (06), isento (07), sem incidência (08), suspensão (09).
export const CST_USUAIS_POR_REGIME = {
  simples:   { S: ['49', '04', '06', '07', '08', '09'], E: ['70', '99'] },
  presumido: { S: ['01', '04', '06', '07', '08', '09', '49'], E: ['70', '73', '75', '99'] },
  real:      { S: ['01', '02', '04', '06', '07', '08', '09', '49'], E: ['50', '53', '56', '70', '73', '75', '99'] },
};

const ROTULO_REGIME = {
  simples: 'Usuais no Simples Nacional',
  presumido: 'Usuais no Lucro Presumido',
  real: 'Usuais no Lucro Real',
};

// O regime que serve de destaque. O CRT da nota é a fonte preferida, mas ele
// não distingue presumido de real (os dois são CRT 3), e hoje está nulo nas
// duas empresas — por isso o regime_tributario do cadastro é a segunda fonte.
// Sem nenhuma das duas devolve null, e a tela mostra a tabela sem destaque:
// destaque errado desinforma mais do que a ausência dele.
export function regimeDoEmpregador(pj) {
  const crt = Number(pj?.crt);
  if (crt === 1 || crt === 2 || crt === 4) return 'simples';
  const declarado = String(pj?.regime_tributario ?? '').trim().toLowerCase();
  return ROTULO_REGIME[declarado] ? declarado : null;
}

function rotuloCst(cst) {
  return { valor: cst.codigo, label: `${cst.codigo} — ${cst.descricao}` };
}

// Os CST que cabem numa natureza, agrupados para <optgroup>. Devolve um grupo
// só quando o regime é desconhecido, e dois quando há o que destacar.
export function cstPisCofinsPara(tipoOperacao, regime) {
  const sentido = tipoOperacao === 'entrada' ? 'E' : 'S';
  const doSentido = CST_PIS_COFINS.filter(c => c.sentido === sentido);
  const usuais = CST_USUAIS_POR_REGIME[regime]?.[sentido];
  if (!usuais) return [{ grupo: 'Todos os códigos da tabela', itens: doSentido.map(rotuloCst) }];

  const destacados = usuais
    .map(codigo => doSentido.find(c => c.codigo === codigo))
    .filter(Boolean);
  const resto = doSentido.filter(c => !usuais.includes(c.codigo));
  return [
    { grupo: ROTULO_REGIME[regime], itens: destacados.map(rotuloCst) },
    { grupo: 'Outros códigos da tabela', itens: resto.map(rotuloCst) },
  ];
}

function ehVazio(valor) {
  return valor === null || valor === undefined || valor === '';
}

// O que impede esta regra de ser salva. Lista vazia = pode gravar.
export function validarRegraTributaria(regra = {}) {
  const erros = [];
  const alvos = [regra.produto_id, regra.grupo_tributario_id, regra.ncm_generico]
    .filter(a => !ehVazio(a)).length;
  if (alvos === 0) erros.push('escolha o alvo da regra: um produto, um grupo tributário ou um NCM');
  if (alvos > 1) erros.push('a regra tem mais de um alvo — escolha só produto, só grupo ou só NCM');

  if (ehVazio(regra.natureza_operacao_id)) erros.push('natureza da operação não escolhida');

  const cfop = String(regra.cfop ?? '').trim();
  if (!/^\d{4}$/.test(cfop)) {
    erros.push('CFOP precisa ter 4 dígitos');
  } else if (regra.tipo_operacao) {
    // O primeiro dígito do CFOP diz o sentido: 1, 2 e 3 entram; 5, 6 e 7 saem.
    // Uma devolução de venda é entrada, e sai com CFOP 1.202 mesmo sendo a
    // contrapartida de uma venda — confundir isso é rejeição na certa.
    const entrada = ['1', '2', '3'].includes(cfop[0]);
    if (regra.tipo_operacao === 'entrada' && !entrada) {
      erros.push(`CFOP ${cfop} é de saída, e esta natureza é de entrada`);
    }
    if (regra.tipo_operacao === 'saida' && entrada) {
      erros.push(`CFOP ${cfop} é de entrada, e esta natureza é de saída`);
    }
  }

  // Mesma checagem de sentido que o CFOP acima, pelo mesmo motivo: um CST de
  // entrada numa nota de saída é rejeição na SEFAZ. Campo em branco ainda
  // passa — tornar obrigatório é decisão separada, com o contador.
  for (const [campo, rotulo] of [['cst_pis', 'CST do PIS'], ['cst_cofins', 'CST da COFINS']]) {
    const cst = String(regra[campo] ?? '').trim();
    if (cst === '') continue;
    const linha = CST_PIS_COFINS.find(c => c.codigo === cst);
    if (!linha) {
      erros.push(`${rotulo} ${cst} não existe na tabela do ADE Cofis 25/2010`);
    } else if (regra.tipo_operacao === 'saida' && linha.sentido === 'E') {
      erros.push(`${rotulo} ${cst} é de entrada, e esta natureza é de saída`);
    } else if (regra.tipo_operacao === 'entrada' && linha.sentido === 'S') {
      erros.push(`${rotulo} ${cst} é de saída, e esta natureza é de entrada`);
    }
  }

  const uf = String(regra.uf_destino ?? '*').trim();
  if (uf !== '*' && !/^[A-Z]{2}$/.test(uf)) erros.push('UF de destino: use a sigla de 2 letras ou * para qualquer uma');

  if (regra.st_responsavel === ST_RESPONSAVEL.SUBSTITUTO && ehVazio(regra.mva_percentual)) {
    erros.push('a MVA é obrigatória quando esta saída retém a ST');
  }

  if (regra.permite_credito_simples && !CSOSN_QUE_PERMITE_CREDITO.includes(String(regra.csosn ?? ''))) {
    erros.push(`crédito do Simples só existe nos CSOSN ${CSOSN_QUE_PERMITE_CREDITO.join(', ')}`);
  }

  if (regra.vigencia_inicio && regra.vigencia_fim && regra.vigencia_fim < regra.vigencia_inicio) {
    erros.push('o fim da vigência é anterior ao início');
  }

  return erros;
}

// Sugestão de CFOP a partir do que a pessoa já respondeu. É palpite de
// preenchimento, não decisão: o campo continua editável.
export function cfopSugerido({ producaoPropria = true, stResponsavel = ST_RESPONSAVEL.NAO_APLICAVEL, mesmaUf = true } = {}) {
  const digito = mesmaUf ? '5' : '6';
  if (stResponsavel === ST_RESPONSAVEL.SUBSTITUIDO) return `${digito}405`;
  if (stResponsavel === ST_RESPONSAVEL.SUBSTITUTO) return producaoPropria ? `${digito}401` : `${digito}403`;
  return producaoPropria ? `${digito}101` : `${digito}102`;
}

export function descreverDestinatario(regra = {}) {
  const partes = [];
  if (regra.destinatario_contribuinte === true) partes.push('contribuinte');
  if (regra.destinatario_contribuinte === false) partes.push('não contribuinte');
  if (regra.destinatario_consumidor_final === true) partes.push('consumidor final');
  if (regra.destinatario_consumidor_final === false) partes.push('para revenda');
  return partes.length ? partes.join(', ') : 'qualquer destinatário';
}

export function descreverAlvo(regra = {}, { grupos = [], produtos = [] } = {}) {
  if (regra.grupo_tributario_id) {
    const g = grupos.find(x => x.id === regra.grupo_tributario_id);
    return g ? `grupo ${g.codigo}` : 'grupo';
  }
  if (regra.produto_id) {
    const p = produtos.find(x => x.id === regra.produto_id);
    return p ? `produto ${p.codigo}` : 'produto';
  }
  if (regra.ncm_generico) return `NCM ${regra.ncm_generico}`;
  return 'sem alvo';
}

export function resumoRegra(regra = {}) {
  const partes = [`CFOP ${regra.cfop || '—'}`];
  if (regra.csosn) partes.push(`CSOSN ${regra.csosn}`);
  if (regra.st_responsavel === ST_RESPONSAVEL.SUBSTITUTO) {
    partes.push(`retém ST com MVA ${Number(regra.mva_percentual ?? 0)}%`);
  }
  if (regra.st_responsavel === ST_RESPONSAVEL.SUBSTITUIDO) partes.push('ST já retida');
  if (!ehVazio(regra.reducao_base_percentual)) partes.push(`base reduzida ${Number(regra.reducao_base_percentual)}%`);
  if (regra.isento) partes.push('isento');
  if (regra.permite_credito_simples) partes.push('permite crédito');
  return partes.join(' · ');
}
