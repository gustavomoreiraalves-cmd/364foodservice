// Identidade do lançamento. Reimportar o mesmo período (ou o extrato do mês
// que repete os últimos dias do anterior) não pode duplicar linha.
// Quando o arquivo é OFX, o banco já dá um id único por transação (FITID) —
// aí ele manda, e dois débitos idênticos no mesmo dia não colidem.
// Sem FITID (PDF e CSV), conta+data+valor+descrição não bastam: duas tarifas
// de R$ 50 ou dois Pix iguais para o mesmo fornecedor no mesmo dia colapsariam
// no mesmo hash, e o "on conflict do nothing" descartaria a segunda em
// silêncio. `ocorrencia` é o ordinal da linha entre as idênticas (0, 1, 2...)
// e só entra nesse ramo — o ramo com FITID já é único pelo banco.
import crypto from 'node:crypto';

export function hashDedupe({ contaBancariaId, data, valor, descricaoNormalizada, fitid, ocorrencia = 0 }) {
  const chave = fitid
    ? `${contaBancariaId}|FITID|${fitid}`
    : `${contaBancariaId}|${data}|${Number(valor).toFixed(2)}|${descricaoNormalizada}|${ocorrencia}`;
  return crypto.createHash('sha256').update(chave).digest('hex');
}
