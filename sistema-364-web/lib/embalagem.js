// Helpers da ficha de embalagem (Fase 3 do controle de lote).
//
// A ficha de papel que esta tela substitui está em
// fichas-impressas/364_Fichas_Impressas_v2.pdf, página 3. A embalagem é onde o
// peso defumado vira produto acabado com lote e validade.

import { proximoNumeroFicha } from './format.js';

export const STATUS_EMBALAGEM = ['rascunho', 'finalizada', 'cancelada'];

// Rótulo em português e classe visual (`tag ok/warn/bad`) de cada status —
// achado da revisão final: as duas telas de embalagem
// (app/producoes/embalagem/page.js e app/producoes/embalagem/[id]/page.js)
// duplicavam este par de objetos literalmente, e `STATUS_EMBALAGEM`, acima,
// não era consumido por nenhuma das duas. Fonte única aqui: quem editar um
// rótulo ou uma cor edita uma vez só.
export const STATUS_LABELS = {
  rascunho: 'Rascunho',
  finalizada: 'Finalizada',
  cancelada: 'Cancelada',
};

export const STATUS_TAG = {
  rascunho: 'warn',
  finalizada: 'ok',
  cancelada: 'bad',
};

const num = v => (v === null || v === undefined || v === '' ? null : Number(v));

export function prefixoFichaEmbalagem(dataStr) {
  return `EMB-${dataStr.slice(2, 4)}${dataStr.slice(5, 7)}${dataStr.slice(8, 10)}-`;
}

export function proximaFichaEmbalagem(dataStr, fichas) {
  return proximoNumeroFicha(prefixoFichaEmbalagem(dataStr), fichas);
}

// Quilos defumados ainda disponíveis de um lote: o que saiu das fichas de
// defumação FINALIZADAS menos o que já foi embalado em fichas que não estão
// canceladas. Rascunho de defumação não conta como disponível — o peso ainda
// pode mudar; ficha de embalagem cancelada devolve o peso ao lote.
//
// Os dois lados desta conta erram para lados opostos de propósito. Do lado
// defumado, item sem `defumacoes.status` (join ausente, dado incompleto) NÃO
// conta como disponível — errar para "menos saldo" é o lado seguro, o pior
// que acontece é a tela mostrar zero onde havia peso de verdade. Do lado
// embalado é o oposto: só `'cancelada'` livra o peso do desconto — item sem
// `embalagens.status` (join ausente) É descontado, porque a leitura contrária
// (falta de status = não desconta) devolveria ao saldo peso que já foi
// embalado de verdade, e o operador embalaria de novo em cima do que já
// existe, sem nenhuma constraint de banco para travar — esse saldo só existe
// aqui em JS.
export function saldoDefumado(loteId, itensDefumados, itensEmbalados) {
  const defumado = (itensDefumados || [])
    .filter(i => i.recebimento_item_id === loteId && i.defumacoes?.status === 'finalizada')
    .reduce((s, i) => s + (num(i.peso_final_kg) || 0), 0);
  const embalado = (itensEmbalados || [])
    .filter(i => i.recebimento_item_id === loteId && i.embalagens?.status !== 'cancelada')
    .reduce((s, i) => s + (num(i.peso_total_kg) || 0), 0);
  return Math.max(0, defumado - embalado);
}

// Validade gravada no item, calculada a partir da data da embalagem e da regra
// de conservação do produto. Fica congelada: mudar a regra depois não altera
// validade já impressa em etiqueta.
export function validadeDoItem(dataEmbalagem, regra) {
  if (!regra || !regra.permitido) return null;
  const valor = num(regra.validade_valor);
  if (!valor || valor <= 0) return null;
  const d = new Date(`${dataEmbalagem}T12:00:00`);
  // Data de embalagem vazia ou inválida (a tela começa com o campo em
  // branco nas fichas em rascunho) não pode virar 'NaN-NaN-NaN' — sem data
  // válida não há validade para calcular, então devolve null como qualquer
  // outro caso "sem dado o suficiente".
  if (isNaN(d)) return null;
  // Horas viram dias arredondando para BAIXO, nunca para cima: o prazo
  // impresso na etiqueta não pode passar do prazo que a regra permite. Uma
  // regra de 12 horas não pode virar "1 dia" de validade — quando o
  // arredondamento zera, a validade fica na própria data da embalagem (zero
  // dias de folga), que é o comportamento conservador.
  const dias = regra.validade_unidade === 'horas' ? Math.floor(valor / 24) : valor;
  d.setDate(d.getDate() + dias);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function itemEmbalagemValido({ quantidade, peso_total_kg } = {}) {
  const qtd = num(quantidade);
  const peso = num(peso_total_kg);
  if (qtd === null || !Number.isInteger(qtd) || qtd <= 0) {
    return { ok: false, erro: 'A quantidade embalada precisa ser um número inteiro de unidades, maior que zero.' };
  }
  if (peso === null || Number.isNaN(peso) || peso <= 0) {
    return { ok: false, erro: 'Informe o peso final dos produtos embalados.' };
  }
  return { ok: true };
}
