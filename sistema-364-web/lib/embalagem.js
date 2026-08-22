// Helpers da ficha de embalagem (Fase 3 do controle de lote).
//
// A ficha de papel que esta tela substitui está em
// fichas-impressas/364_Fichas_Impressas_v2.pdf, página 3. A embalagem é onde o
// peso defumado vira produto acabado com lote e validade.

import { proximoNumeroFicha } from './format.js';

export const STATUS_EMBALAGEM = ['rascunho', 'finalizada', 'cancelada'];

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
export function saldoDefumado(loteId, itensDefumados, itensEmbalados) {
  const defumado = (itensDefumados || [])
    .filter(i => i.recebimento_item_id === loteId && i.defumacoes?.status === 'finalizada')
    .reduce((s, i) => s + (num(i.peso_final_kg) || 0), 0);
  const embalado = (itensEmbalados || [])
    .filter(i => i.recebimento_item_id === loteId
      && i.embalagens?.status && i.embalagens.status !== 'cancelada')
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
  const dias = regra.validade_unidade === 'horas' ? Math.ceil(valor / 24) : valor;
  const d = new Date(`${dataEmbalagem}T12:00:00`);
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
