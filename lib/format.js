import { supabase } from './supabase';

export function fmtMoney(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export function hoje() {
  return new Date().toISOString().slice(0, 10);
}

export function diasEntre(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

// Gera o próximo número de lote no padrão LT-DD/MM/AA-XXX,
// contando recebimentos + produções já lançados no mesmo dia.
export async function proximoLote(dataStr) {
  const [aaaa, mm, dd] = dataStr.slice(0, 10).split('-');
  const prefixo = `LT-${dd}/${mm}/${aaaa.slice(2)}-`;
  const [r1, r2] = await Promise.all([
    supabase.from('recebimentos').select('lote').like('lote', `${prefixo}%`),
    supabase.from('producoes').select('lote').like('lote', `${prefixo}%`),
  ]);
  const n = (r1.data?.length || 0) + (r2.data?.length || 0);
  return prefixo + String(n + 1).padStart(3, '0');
}

// Gera o próximo código de produto no padrão 0364-XXX
export async function proximoCodigoProduto() {
  const { data } = await supabase.from('produtos').select('codigo');
  const nums = (data || []).map(p => parseInt((p.codigo || '0364-000').split('-')[1]) || 0);
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return '0364-' + String(next).padStart(3, '0');
}

// Custo médio de uma matéria-prima a partir da lista de recebimentos
// (fallback: custo padrão cadastrado na matéria-prima)
export function custoMedioMP(mpId, recebimentos, materiasPrimas) {
  const recs = (recebimentos || []).filter(r => r.materia_prima_id === mpId);
  if (!recs.length) {
    const mp = (materiasPrimas || []).find(m => m.id === mpId);
    return mp ? Number(mp.custo_unitario) : 0;
  }
  const totalQtd = recs.reduce((s, r) => s + Number(r.quantidade), 0);
  const totalCusto = recs.reduce((s, r) => s + Number(r.quantidade) * Number(r.custo_unitario), 0);
  return totalQtd ? totalCusto / totalQtd : 0;
}
