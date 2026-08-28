// lib/emissaoFiscal.js
export const MODELOS_EMISSAO = ['55', '65'];
export const AMBIENTES_EMISSAO = ['producao', 'homologacao'];

export function validarConfiguracaoEmissao({ modelo, ativo, ambiente, serie, cscId, cscToken, certificadoValido, cscJaConfigurado = false }) {
  const erros = [];
  if (!(Number.isInteger(serie) && serie > 0)) erros.push('Série precisa ser um número inteiro maior que zero.');

  const temCsc = Boolean(cscId) || Boolean(cscToken);
  if (modelo === '55' && temCsc) {
    erros.push('NF-e (modelo 55) não usa CSC — esse campo é só para NFC-e.');
  }
  if (modelo === '65' && ativo && !((cscId && cscToken) || cscJaConfigurado)) {
    erros.push('NFC-e ativa exige CSC ID e CSC Token preenchidos.');
  }

  if (ativo && ambiente === 'producao' && !certificadoValido) {
    erros.push('Não é possível ativar produção sem um certificado digital A1 válido e não vencido.');
  }

  return erros;
}

export function serieConflita(configsDoEmpregador, candidato) {
  return configsDoEmpregador.some(c =>
    c.id !== candidato.id
    && c.modelo === candidato.modelo
    && c.ambiente === candidato.ambiente
    && c.serie === candidato.serie);
}

export function podeAjustarNumero(ultimoNumeroAtual, novoNumero) {
  if (!(Number.isInteger(novoNumero) && novoNumero >= 0)) return false;
  if (ultimoNumeroAtual === null || ultimoNumeroAtual === undefined) return true;
  return novoNumero > ultimoNumeroAtual;
}

// Rótulo e cor de tag para cada status de nfe_saida_documentos (atualização
// 43). 'enviado' e 'erro_comunicacao' são os dois estados "indeterminados" de
// lib/nfe/emitir.js (STATUS_INDETERMINADO): a nota foi transmitida, mas o que
// a SEFAZ decidiu não ficou confirmado neste sistema — visualmente e
// textualmente isto precisa ficar diferente de uma rejeição comum, porque o
// que resolve não é clicar de novo, é conferir na SEFAZ. Compartilhado entre
// app/pedidos/[id]/page.js e app/fiscal/notas/page.js.
export const SITUACAO_NOTA = {
  rascunho: { rotulo: 'Rascunho', classe: 'neutro' },
  numero_reservado: { rotulo: 'Número reservado', classe: 'neutro' },
  assinado: { rotulo: 'Assinada — não transmitida', classe: 'neutro' },
  enviado: { rotulo: 'Enviada — resultado não confirmado', classe: 'warn' },
  erro_comunicacao: { rotulo: 'Falha de comunicação — resultado não confirmado', classe: 'warn' },
  autorizado: { rotulo: 'Autorizada', classe: 'ok' },
  denegado: { rotulo: 'Denegada', classe: 'bad' },
  rejeitado: { rotulo: 'Rejeitada pela SEFAZ', classe: 'bad' },
  contingencia: { rotulo: 'Contingência', classe: 'warn' },
  cancelado: { rotulo: 'Cancelada', classe: 'neutro' },
};
export const STATUS_NOTA_INDETERMINADO = ['enviado', 'erro_comunicacao'];

// Em qual das 3 abas do relatório de notas (emitida/pendente/erro) cada
// status de nfe_saida_documentos cai. 'cancelado' entra em 'emitida' — a
// nota foi autorizada e só depois cancelada, continua sendo um documento
// fiscal emitido, não uma pendência.
const BUCKET_POR_STATUS_NOTA = {
  autorizado: 'emitida',
  cancelado: 'emitida',
  rejeitado: 'erro',
  denegado: 'erro',
  erro_comunicacao: 'erro',
  rascunho: 'pendente',
  numero_reservado: 'pendente',
  assinado: 'pendente',
  enviado: 'pendente',
  contingencia: 'pendente',
};

export function bucketNota(status) {
  return BUCKET_POR_STATUS_NOTA[status] || 'pendente';
}

// Monta uma linha de relatório por pedido faturado, cruzando com a nota mais
// recente de cada um (mesma regra de "pedido relevante para nota fiscal" que
// app/pedidos/[id]/page.js usa: `pedido.status === 'Faturado' || notaFiscal`
// — aqui os candidatos já chegam filtrados por Faturado/Enviado na query, e
// esta função só decide o bucket). Puro: não toca banco.
//
// Assume `notas` ordenada por created_at desc (a query já traz assim) — o
// primeiro registro que aparece para um pedido_id é o mais recente, sem
// precisar reparsear datas aqui.
export function montarRelatorioNotas(pedidos, notas) {
  const notaMaisRecentePorPedido = new Map();
  for (const nota of notas) {
    if (!notaMaisRecentePorPedido.has(nota.pedido_id)) {
      notaMaisRecentePorPedido.set(nota.pedido_id, nota);
    }
  }
  return pedidos.map(pedido => {
    const nota = notaMaisRecentePorPedido.get(pedido.id) || null;
    return { pedido, nota, bucket: nota ? bucketNota(nota.status) : 'pendente' };
  });
}
