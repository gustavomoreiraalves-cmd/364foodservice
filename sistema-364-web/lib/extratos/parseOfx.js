// OFX vem em duas gerações e os seis bancos do grupo usam as duas: a 1.x é
// SGML (tag de folha sem fechamento, uma por linha) e a 2.x é XML de verdade.
// fast-xml-parser só lê a segunda, então aqui vai um tokenizador que trata as
// duas igual: abre-tag seguida de texto é folha; abre-tag seguida de abre-tag
// é agregado.
import { numeroBr, dataIso } from './numero.js';

function tokenizar(texto) {
  const inicio = texto.indexOf('<OFX>');
  if (inicio < 0) throw new Error('Este arquivo não parece ser um arquivo OFX.');
  const corpo = texto.slice(inicio);
  const tokens = [];
  const re = /<(\/?)([A-Za-z0-9._]+)>|([^<]+)/g;
  let m;
  while ((m = re.exec(corpo)) !== null) {
    if (m[2]) tokens.push({ tipo: m[1] ? 'fecha' : 'abre', nome: m[2].toUpperCase() });
    else {
      const valor = m[3].trim();
      if (valor) tokens.push({ tipo: 'texto', valor });
    }
  }
  return tokens;
}

function montar(tokens) {
  const raiz = {};
  const pilha = [raiz];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const pai = pilha[pilha.length - 1];
    if (t.tipo === 'abre') {
      const proximo = tokens[i + 1];
      if (proximo && proximo.tipo === 'texto') {
        pai[t.nome] = proximo.valor;
        i++;
        // Na 2.x a folha fecha; na 1.x não. Consome o fechamento se vier.
        if (tokens[i + 1]?.tipo === 'fecha' && tokens[i + 1].nome === t.nome) i++;
      } else {
        const no = {};
        if (pai[t.nome] === undefined) pai[t.nome] = no;
        else if (Array.isArray(pai[t.nome])) pai[t.nome].push(no);
        else pai[t.nome] = [pai[t.nome], no];
        pilha.push(no);
      }
    } else if (t.tipo === 'fecha' && pilha.length > 1) {
      pilha.pop();
    }
  }
  return raiz;
}

function comoLista(valor) {
  if (!valor) return [];
  return Array.isArray(valor) ? valor : [valor];
}

export function parseOfx(texto) {
  const arvore = montar(tokenizar(texto));
  const ofx = arvore.OFX || {};
  const extrato = ofx.BANKMSGSRSV1?.STMTTRNRS?.STMTRS
    || ofx.CREDITCARDMSGSRSV1?.CCSTMTTRNRS?.CCSTMTRS;
  if (!extrato) {
    throw new Error('Não achei o extrato dentro do OFX (nem conta corrente, nem cartão).');
  }

  const lista = extrato.BANKTRANLIST || {};
  const lancamentos = comoLista(lista.STMTTRN).map(t => {
    const valor = numeroBr(t.TRNAMT);
    const data = dataIso(t.DTPOSTED);
    if (!data || Number.isNaN(valor)) {
      throw new Error('Uma transação do OFX veio sem data ou sem valor legível.');
    }
    return {
      data,
      descricao: String(t.MEMO || t.NAME || '').trim() || 'SEM DESCRIÇÃO',
      valor: Math.abs(valor),
      tipo: valor < 0 ? 'saida' : 'entrada',
      documento: t.CHECKNUM ? String(t.CHECKNUM) : null,
      fitid: t.FITID ? String(t.FITID) : null,
    };
  });

  if (!lancamentos.length) {
    throw new Error('O OFX não trouxe nenhum lançamento — confira o período exportado no banco.');
  }

  const saldoFinal = numeroBr(extrato.LEDGERBAL?.BALAMT);
  return {
    periodoInicio: dataIso(lista.DTSTART),
    periodoFim: dataIso(lista.DTEND),
    saldoInicial: null, // o formato não traz; a conferência aritmética é ignorada
    saldoFinal: Number.isNaN(saldoFinal) ? null : saldoFinal,
    total: null,
    lancamentos,
  };
}
