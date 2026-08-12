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

// Gera o próximo número de lote no padrão LT-AAMMDD-###, contando
// recebimento_itens + produções já lançados no mesmo dia NA MESMA EMPRESA.
export async function proximoLote(dataStr, empresaId) {
  const prefixo = `LT-${dataStr.slice(2, 4)}${dataStr.slice(5, 7)}${dataStr.slice(8, 10)}-`;
  const [r1, r2] = await Promise.all([
    supabase.from('recebimento_itens').select('lote').eq('empresa_id', empresaId).like('lote', `${prefixo}%`),
    supabase.from('producoes').select('lote').eq('empresa_id', empresaId).like('lote', `${prefixo}%`),
  ]);
  const n = (r1.data?.length || 0) + (r2.data?.length || 0);
  return prefixo + String(n + 1).padStart(3, '0');
}

// Gera `quantidade` códigos de lote sequenciais em uma única consulta —
// usado no recebimento multi-item, onde vários itens da mesma nota
// precisam de lotes distintos numa única submissão (evita 1 consulta por
// item, e evita a corrida de duas chamadas a proximoLote() lendo a mesma
// contagem antes de qualquer insert acontecer).
export async function proximosLotes(dataStr, empresaId, quantidade) {
  const prefixo = `LT-${dataStr.slice(2, 4)}${dataStr.slice(5, 7)}${dataStr.slice(8, 10)}-`;
  const [r1, r2] = await Promise.all([
    supabase.from('recebimento_itens').select('lote').eq('empresa_id', empresaId).like('lote', `${prefixo}%`),
    supabase.from('producoes').select('lote').eq('empresa_id', empresaId).like('lote', `${prefixo}%`),
  ]);
  const n = (r1.data?.length || 0) + (r2.data?.length || 0);
  return Array.from({ length: quantidade }, (_, i) => prefixo + String(n + 1 + i).padStart(3, '0'));
}

// Gera o próximo código de produto usando o prefixo da empresa (ex: 0364-XXX
// para o Food Service, STK-XXX para o Steakhouse), contando só os produtos
// dessa empresa com esse prefixo.
export async function proximoCodigoProduto(empresaId, prefixo) {
  const { data } = await supabase.from('produtos').select('codigo').eq('empresa_id', empresaId);
  const nums = (data || [])
    .filter(p => (p.codigo || '').startsWith(prefixo + '-'))
    .map(p => parseInt(p.codigo.split('-')[1]) || 0);
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return prefixo + '-' + String(next).padStart(3, '0');
}

// Custo médio de uma matéria-prima a partir do ledger (stock_balances —
// Etapa 3), com fallback no custo padrão cadastrado na matéria-prima. Não
// precisa mais filtrar por status: só existe saldo em stock_balances para
// itens que a inspeção aprovou (aprovado/aprovado_com_ressalva) — um lote
// em quarentena ou rejeitado nunca gera entrada no ledger (ver trigger
// trigger_inspecao_gera_movimento).
export function custoMedioMP(mpId, saldosLote, materiasPrimas) {
  const recs = (saldosLote || []).filter(r => r.materia_prima_id === mpId);
  if (!recs.length) {
    const mp = (materiasPrimas || []).find(m => m.id === mpId);
    return mp ? Number(mp.custo_unitario) : 0;
  }
  const totalQtd = recs.reduce((s, r) => s + Number(r.quantidade), 0);
  const totalCusto = recs.reduce((s, r) => s + Number(r.quantidade) * Number(r.custo_unitario), 0);
  return totalQtd ? totalCusto / totalQtd : 0;
}
