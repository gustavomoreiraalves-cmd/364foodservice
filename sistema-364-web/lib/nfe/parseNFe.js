// Converte o XML de uma NF-e (procNFe ou NFe avulsa) num objeto simples.
// Função pura: sem rede, sem banco, sem estado. É a única parte do sistema
// que conhece o layout do XML — o resto trabalha só com o objeto devolvido.
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false, // números viram string; a conversão é nossa, para não perder zeros à esquerda
  trimValues: true,
});

// A NF-e omite o array quando há um só elemento (um det, uma dup).
function lista(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function digitos(v) {
  return String(v || '').replace(/\D/g, '');
}

// Único arredondamento do parser, e ele é sobre um valor DERIVADO (a soma dos
// itens), não sobre um valor lido: sem isso a soma de floats deixa um resto que
// atrapalha a comparação com o total conferido.
function arredMoeda(v) {
  return Math.round(Number(v) * 100) / 100;
}

export function parseNFe(xml) {
  const raiz = parser.parse(xml);
  const nfe = raiz?.nfeProc?.NFe || raiz?.NFe;
  const inf = nfe?.infNFe;
  if (!inf) throw new Error('XML não é uma NF-e: infNFe não encontrado.');

  const chave = String(inf['@_Id'] || '').replace(/^NFe/, '');
  if (!/^\d{44}$/.test(chave)) throw new Error('Chave de acesso inválida no XML.');

  const ide = inf.ide || {};
  const emit = inf.emit || {};

  const itens = lista(inf.det).map((d, i) => ({
    indice: Number(d['@_nItem'] || i + 1),
    codigo: String(d.prod?.cProd ?? ''),
    descricao: String(d.prod?.xProd ?? ''),
    ncm: d.prod?.NCM ? String(d.prod.NCM) : null,
    unidade: String(d.prod?.uCom ?? ''),
    quantidade: num(d.prod?.qCom),
    valorUnitario: num(d.prod?.vUnCom),
    valorTotal: num(d.prod?.vProd),
  }));

  return {
    chave,
    modelo: String(ide.mod ?? ''),
    tipoOperacao: String(ide.tpNF ?? ''), // 0 = entrada, 1 = saída, do ponto de vista do emitente
    numero: String(ide.nNF ?? ''),
    serie: String(ide.serie ?? ''),
    emitidaEm: String(ide.dhEmi ?? ide.dEmi ?? ''),
    valorTotal: num(inf.total?.ICMSTot?.vNF),
    // Σ vProd: o que os itens custam, sem frete, IPI nem ST. É este valor que se
    // compara com o total conferido no recebimento — o vNF não serve para isso.
    somaItens: arredMoeda(itens.reduce((s, i) => s + i.valorTotal, 0)),
    emitente: {
      cnpj: digitos(emit.CNPJ),
      nome: String(emit.xNome ?? ''),
      fantasia: emit.xFant ? String(emit.xFant) : null,
      telefone: emit.enderEmit?.fone ? String(emit.enderEmit.fone) : null,
      // O layout 4.00 não tem e-mail obrigatório no emitente; quando não vem, fica nulo
      // e o cadastro de fornecedor é preenchido à mão.
      email: emit.email ? String(emit.email) : null,
      uf: emit.enderEmit?.UF ? String(emit.enderEmit.UF) : null,
    },
    itens,
    duplicatas: lista(inf.cobr?.dup).map(d => ({
      numero: String(d.nDup ?? ''),
      vencimento: String(d.dVenc ?? '').slice(0, 10),
      valor: num(d.vDup),
    })),
  };
}
