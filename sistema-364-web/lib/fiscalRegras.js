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
