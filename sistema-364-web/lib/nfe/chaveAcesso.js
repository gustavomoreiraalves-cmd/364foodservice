//
// Chave de acesso da NF-e: 44 dígitos que identificam a nota no país inteiro.
// A ordem e a largura dos campos são fixadas pelo leiaute 4.00 — nada aqui é
// escolha nossa, e errar uma posição gera rejeição por chave inválida.
//
// Puro: sem banco, sem rede.

function apenasDigitos(v) {
  return String(v ?? '').replace(/\D/g, '');
}

function comZeros(valor, largura, rotulo) {
  const s = String(valor);
  if (!/^\d+$/.test(s)) throw new Error(`${rotulo} precisa ser numérico: ${valor}`);
  if (s.length > largura) {
    throw new Error(`${rotulo} não cabe em ${largura} dígitos: ${valor}`);
  }
  return s.padStart(largura, '0');
}

// AAMM (ano/mês com 2 dígitos cada) do instante de emissão, no fuso horário
// informado — nunca no fuso do processo. `Intl.DateTimeFormat` com `timeZone`
// resolve o ano/mês civil correspondente àquele instante naquele fuso,
// independentemente de onde o Node está rodando (ex.: Vercel roda em UTC).
function aammNoFuso(d, fusoHorario) {
  if (typeof fusoHorario !== 'string' || fusoHorario.trim() === '') {
    throw new Error('fusoHorario é obrigatório para montar a chave de acesso (ex.: "America/Porto_Velho").');
  }
  let partes;
  try {
    partes = new Intl.DateTimeFormat('en-US', {
      timeZone: fusoHorario,
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(d);
  } catch {
    throw new Error(`fusoHorario inválido: ${fusoHorario}`);
  }
  const ano = partes.find((p) => p.type === 'year')?.value;
  const mes = partes.find((p) => p.type === 'month')?.value;
  if (!ano || !mes) throw new Error(`fusoHorario inválido: ${fusoHorario}`);
  return ano.slice(2) + mes;
}

// Módulo 11, pesos 2..9 ciclando da direita para a esquerda. Resto 0 ou 1 → 0.
export function digitoVerificadorChave(chave43) {
  const s = String(chave43 ?? '');
  if (!/^\d{43}$/.test(s)) throw new Error(`O dígito verificador exige exatamente 43 dígitos, recebi ${s.length}.`);
  let soma = 0;
  let peso = 2;
  for (let i = s.length - 1; i >= 0; i--) {
    soma += Number(s[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto === 0 || resto === 1 ? 0 : 11 - resto;
}

export function montarChaveAcesso({ cUF, dataEmissao, cnpj, modelo, serie, numero, tipoEmissao, codigoNumerico, fusoHorario }) {
  const d = dataEmissao instanceof Date ? dataEmissao : new Date(dataEmissao);
  if (Number.isNaN(d.getTime())) throw new Error('Data de emissão inválida para a chave de acesso.');

  const aamm = aammNoFuso(d, fusoHorario);
  const cnpjLimpo = apenasDigitos(cnpj);
  if (cnpjLimpo.length !== 14) throw new Error(`CNPJ do emitente precisa ter 14 dígitos: ${cnpj}`);

  const sem = [
    comZeros(cUF, 2, 'cUF'),
    aamm,
    cnpjLimpo,
    comZeros(modelo, 2, 'modelo'),
    comZeros(serie, 3, 'série'),
    comZeros(numero, 9, 'número da nota'),
    comZeros(tipoEmissao, 1, 'tipo de emissão'),
    comZeros(codigoNumerico, 8, 'código numérico'),
  ].join('');

  return sem + String(digitoVerificadorChave(sem));
}

// cNF igual ao nNF é rejeição 539. O sorteio evita, e o laço garante.
export function gerarCodigoNumerico(numero) {
  for (let tentativa = 0; tentativa < 50; tentativa++) {
    const cnf = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
    if (Number(cnf) !== Number(numero)) return cnf;
  }
  throw new Error('Não consegui sortear um código numérico diferente do número da nota.');
}
