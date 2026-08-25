// lib/emissaoFiscal.js
export const MODELOS_EMISSAO = ['55', '65'];
export const AMBIENTES_EMISSAO = ['producao', 'homologacao'];

export function validarConfiguracaoEmissao({ modelo, ativo, ambiente, serie, cscId, cscToken, certificadoValido }) {
  const erros = [];
  if (!(Number.isInteger(serie) && serie > 0)) erros.push('Série precisa ser um número inteiro maior que zero.');

  const temCsc = Boolean(cscId) || Boolean(cscToken);
  if (modelo === '55' && temCsc) {
    erros.push('NF-e (modelo 55) não usa CSC — esse campo é só para NFC-e.');
  }
  if (modelo === '65' && ativo && !(cscId && cscToken)) {
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
