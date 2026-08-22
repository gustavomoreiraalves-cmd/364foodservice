// Helpers da ficha de defumação (Fase 2 do controle de lote).
//
// A ficha de papel que esta tela substitui está em
// fichas-impressas/364_Fichas_Impressas_v2.pdf, página 2. O rendimento é a
// conta que o defumador acompanha ao vivo: peso defumado dividido pelo peso
// bruto que entrou.

export const STATUS_DEFUMACAO = ['rascunho', 'finalizada', 'cancelada'];

const num = v => (v === null || v === undefined || v === '' ? null : Number(v));

// Fração de 0 a 1. Sem peso bruto não existe conta — devolve null em vez de
// fingir zero, para a tela mostrar "—" em lugar de "0%".
export function rendimento(pesoBrutoKg, pesoFinalKg) {
  const bruto = num(pesoBrutoKg);
  const final = num(pesoFinalKg);
  if (!bruto || bruto <= 0 || final === null || Number.isNaN(final)) return null;
  return final / bruto;
}

// Abaixo de 40% o sistema avisa, mas deixa salvar: pode ser real, e travar
// faria o operador ajustar o número para passar.
export function condicaoRendimento(r) {
  if (r === null || r === undefined || Number.isNaN(r)) {
    return { id: 'sem_dado', label: '—', cor: '#888' };
  }
  if (r < 0.40) return { id: 'baixo', label: 'Rendimento baixo', cor: '#c0392b' };
  return { id: 'normal', label: 'Rendimento normal', cor: '#2e7d32' };
}

// Quilos ainda disponíveis do lote: o que foi recebido menos o peso bruto já
// lançado em fichas de defumação daquele mesmo item de recebimento.
//
// O saldo NÃO sai de stock_balances: a tabela existe em produção mas nenhum
// código escreve nela, então a lista de lotes sairia vazia.
//
// Só descontam do saldo itens de ficha em rascunho ou finalizada. Itens de
// ficha cancelada continuam gravados — a imutabilidade da migração 29 proíbe
// apagá-los —, mas o peso que eles lançaram nunca chegou a sair do lote de
// verdade. Sem este filtro, cancelar uma ficha lançada por engano prendia o
// peso para sempre: ao tentar refazer, o lote aparecia "sem saldo
// disponível" mesmo sem nenhum consumo real. `itensJaDefumados` precisa
// trazer o status da ficha pai em `i.defumacoes.status` (join
// `defumacoes!inner(status)` na consulta) — item sem esse dado é tratado
// como não descontável, nunca como descontável por padrão.
export function saldoLote(recebimentoItem, itensJaDefumados) {
  const recebido = num(recebimentoItem?.quantidade) || 0;
  const usado = (itensJaDefumados || [])
    .filter(i => i.recebimento_item_id === recebimentoItem?.id)
    .filter(i => {
      const status = i.defumacoes?.status;
      return status === 'rascunho' || status === 'finalizada';
    })
    .reduce((s, i) => s + (num(i.peso_bruto_kg) || 0), 0);
  return Math.max(0, recebido - usado);
}

// Rendimento da ficha inteira, não a média dos itens: soma bruto e final e
// divide no fim.
//
// Só entram na conta os itens que já têm peso_final_kg — o fluxo normal é
// pesar bruto no início da defumação e o defumado só horas depois
// (pesosValidos aceita item sem peso final de propósito). Item ainda não
// pesado não é "rendimento zero", é "ainda sem dado": se ele entrasse com
// final=0, o rendimento da ficha desabava para perto de zero assim que o
// primeiro item fosse lançado, mesmo que nenhum tivesse sido pesado no fim
// ainda. Enquanto NENHUM item tiver peso final, a ficha não tem rendimento
// ainda — devolve null (a tela mostra "—"), igual a `rendimento()` sem bruto.
//
// O bruto somado é só o dos itens que entraram na soma do final — não o
// bruto de todos os itens da ficha. Misturar bruto de item ainda não pesado
// com final só dos pesados infla o denominador sem contrapartida no
// numerador e o percentual fica torto (parece pior do que é).
export function rendimentoDaFicha(itens) {
  const pesados = (itens || []).filter(i => {
    const final = num(i.peso_final_kg);
    return final !== null && !Number.isNaN(final);
  });
  if (!pesados.length) return null;
  const bruto = pesados.reduce((s, i) => s + (num(i.peso_bruto_kg) || 0), 0);
  const final = pesados.reduce((s, i) => s + (num(i.peso_final_kg) || 0), 0);
  return rendimento(bruto, final);
}

export function pesosValidos({ peso_bruto_kg, perda_limpeza_kg, sobra_kg, peso_final_kg } = {}) {
  const bruto = num(peso_bruto_kg);
  const perda = num(perda_limpeza_kg) || 0;
  const sobra = num(sobra_kg) || 0;
  const final = num(peso_final_kg);

  if (bruto === null || Number.isNaN(bruto) || bruto <= 0) {
    return { ok: false, erro: 'Informe o peso bruto que entrou na manipulação.' };
  }
  if (perda < 0 || sobra < 0 || (final !== null && final < 0)) {
    return { ok: false, erro: 'Peso negativo não existe.' };
  }
  if (final !== null && final > bruto) {
    return { ok: false, erro: 'O peso defumado não pode ser maior que o peso bruto.' };
  }
  if (perda + sobra > bruto) {
    return { ok: false, erro: 'Perda e sobra somadas passam do peso bruto.' };
  }
  return { ok: true };
}

// Prefixo do número da ficha, sem o sufixo — DEF-AAMMDD-. Usado tanto para
// gerar o próximo número (proximaFicha) quanto para buscar as fichas "do
// dia" pelo próprio prefixo gravado em `lote`, não pela coluna `data`: `data`
// é editável a qualquer momento em rascunho (o lançamento costuma acontecer
// no dia seguinte à defumação de verdade) e o número da ficha nunca é
// renumerado quando ela muda. Filtrar por `data` faria uma ficha editada sair
// do filtro do dia em que nasceu, `proximaFicha` repetiria o número dela, e
// todo insert seguinte bateria na constraint de unicidade — ver
// app/producoes/defumacao/page.js.
export function prefixoFicha(dataStr) {
  return `DEF-${dataStr.slice(2, 4)}${dataStr.slice(5, 7)}${dataStr.slice(8, 10)}-`;
}

// Número da ficha: DEF-AAMMDD-###. Deriva do maior sufixo já usado dentre as
// fichas com este prefixo, nunca da contagem de fichas — contagem repete
// número assim que uma some.
export function proximaFicha(dataStr, fichasExistentes) {
  const prefixo = prefixoFicha(dataStr);
  const maior = (fichasExistentes || []).reduce((max, f) => {
    const lote = String(f?.lote || '');
    if (!lote.startsWith(prefixo)) return max;
    const sufixo = lote.slice(prefixo.length);
    if (!/^\d+$/.test(sufixo)) return max;
    return Math.max(max, parseInt(sufixo, 10));
  }, 0);
  return prefixo + String(maior + 1).padStart(3, '0');
}
