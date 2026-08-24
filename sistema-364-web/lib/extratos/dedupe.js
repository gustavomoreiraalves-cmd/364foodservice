// Identidade do lançamento. Reimportar o mesmo período (ou o extrato do mês
// que repete os últimos dias do anterior) não pode duplicar linha.
// Quando o arquivo é OFX, o banco já dá um id único por transação (FITID) —
// aí ele manda, e dois débitos idênticos no mesmo dia não colidem.
import crypto from 'node:crypto';

export function hashDedupe({ contaBancariaId, data, valor, descricaoNormalizada, fitid }) {
  const chave = fitid
    ? `${contaBancariaId}|FITID|${fitid}`
    : `${contaBancariaId}|${data}|${Number(valor).toFixed(2)}|${descricaoNormalizada}`;
  return crypto.createHash('sha256').update(chave).digest('hex');
}
