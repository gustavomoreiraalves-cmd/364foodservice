// Status sanitário do recebimento. Desde a migração da condição sanitária para
// a tabela `inspecoes_qualidade`, a coluna `recebimento_itens.status_recebimento`
// não existe mais: o status de um item mora em `inspecoes_qualidade.status`.
// Este módulo é a única fonte desses valores — a tela de recebimentos, o custo
// médio e os relatórios leem daqui para não voltarem a divergir.

export const STATUS_QUALIDADE = [
  { valor: 'pendente', label: 'Pendente' },
  { valor: 'aprovado', label: 'Aprovado' },
  { valor: 'aprovado_com_ressalva', label: 'Aprovado com ressalva' },
  { valor: 'quarentena', label: 'Quarentena' },
  { valor: 'rejeitado', label: 'Rejeitado' },
  { valor: 'devolvido', label: 'Devolvido' },
];

export const STATUS_QUALIDADE_LABEL = Object.fromEntries(
  STATUS_QUALIDADE.map(s => [s.valor, s.label])
);

// Só itens com esse status efetivo (após a inspeção) contam pra estoque/ledger
// — é o critério do trigger_inspecao_gera_movimento. O mesmo critério vale pro
// valor que entra na conta a pagar e pro custo médio da matéria-prima.
export const STATUS_QUALIDADE_APROVADO = ['aprovado', 'aprovado_com_ressalva'];

// Extrai o status da inspeção de um item de recebimento, aceitando as formas em
// que ele chega das queries: a relação crua do PostgREST (`inspecoes_qualidade`,
// array ou objeto, conforme a cardinalidade que o PostgREST infere), a relação
// já achatada pela tela de recebimentos (`inspecao`) e o campo já extraído pelos
// relatórios (`status_qualidade`). Retorna null quando o item não tem inspeção.
export function statusInspecao(item) {
  if (!item) return null;
  if (item.status_qualidade != null) return item.status_qualidade;
  const rel = item.inspecao ?? item.inspecoes_qualidade;
  const insp = Array.isArray(rel) ? rel[0] : rel;
  return insp?.status ?? null;
}

// Um item entrou de fato no estoque? Item sem inspeção não gerou movimento de
// estoque, então também não conta — mesmo critério do trigger.
export function inspecaoAprovada(item) {
  return STATUS_QUALIDADE_APROVADO.includes(statusInspecao(item));
}
