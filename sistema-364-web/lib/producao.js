// Helpers do módulo Produção (produção interna/sintética + etiquetas).
// O cálculo oficial de validade é do banco (calcular_validade_interna);
// aqui só existe o espelho para preview e a derivação da condição de validade.

export const CONSERVACOES = [
  { id: 'ambiente', label: 'Ambiente' },
  { id: 'resfriado', label: 'Resfriado' },
  { id: 'congelado', label: 'Congelado' },
];

export const STATUS_LABELS = {
  rascunho: 'Rascunho',
  em_producao: 'Em produção',
  finalizada: 'Finalizada',
  descartada: 'Descartada',
  cancelada: 'Cancelada',
};

export const MOTIVOS_REIMPRESSAO = [
  'Etiqueta danificada',
  'Impressão com falha',
  'Etiqueta perdida',
  'Troca de recipiente',
  'Outro',
];

export const MOTIVOS_DESCARTE = [
  'Vencimento',
  'Sobra',
  'Qualidade inadequada',
  'Falha no preparo',
  'Quebra de cadeia de conservação',
  'Outro',
];

export function conservacaoLabel(id) {
  return CONSERVACOES.find(c => c.id === id)?.label || id || '—';
}

export function fmtDateTime(iso) {
  if (!iso) return '—';
  // datas puras (YYYY-MM-DD, ex.: produção completa) saem sem hora
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) {
    const [y, m, d] = String(iso).split('-');
    return `${d}/${m}/${y}`;
  }
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Condição derivada em tempo real — nunca persistida.
// vencido: agora > validade | vence_hoje: vence ainda hoje |
// vence_em_breve: até 24h | valido: resto.
export function condicaoValidade(validadeIso, agora = new Date()) {
  if (!validadeIso) return { id: 'sem_validade', label: 'Sem validade', cor: '#888' };
  const validade = new Date(validadeIso);
  if (agora > validade) return { id: 'vencido', label: 'VENCIDO', cor: '#c0392b' };
  const mesmoDia = validade.getFullYear() === agora.getFullYear()
    && validade.getMonth() === agora.getMonth()
    && validade.getDate() === agora.getDate();
  if (mesmoDia) return { id: 'vence_hoje', label: 'VENCE HOJE', cor: '#d35400' };
  if (validade - agora <= 24 * 3600 * 1000) return { id: 'vence_em_breve', label: 'VENCE EM BREVE', cor: '#b7950b' };
  return { id: 'valido', label: 'Válido', cor: '#1e8449' };
}

// Espelho client-side da regra do banco, só para mostrar preview no form.
// regra = { permitido, validade_valor, validade_unidade: 'horas'|'dias' }
export function calcularValidadePreview(produzidoEmIso, regra) {
  if (!regra || !regra.permitido || !regra.validade_valor) return null;
  const d = new Date(produzidoEmIso);
  if (isNaN(d)) return null;
  const horas = regra.validade_unidade === 'horas'
    ? Number(regra.validade_valor)
    : Number(regra.validade_valor) * 24;
  return new Date(d.getTime() + horas * 3600 * 1000).toISOString();
}

export function temPermissao(permissoes, isAdmin, chave) {
  return !!isAdmin || (permissoes || []).includes(chave);
}

// datetime-local <input> ↔ ISO
export function isoParaInputLocal(iso) {
  const d = iso ? new Date(iso) : new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function inputLocalParaIso(valor) {
  const d = new Date(valor);
  return isNaN(d) ? null : d.toISOString();
}
