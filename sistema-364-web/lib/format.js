import { supabase } from './supabase.js';
import { inspecaoAprovada } from './qualidade.js';

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

// Gera os próximos `quantidade` números de lote no padrão LT-AAMMDD-###,
// contando recebimentos + produções já lançados no mesmo dia NA MESMA EMPRESA.
//
// A contagem é lida UMA vez e incrementada em memória. Chamar proximoLote em
// laço geraria lotes repetidos, porque cada chamada lê o mesmo saldo do banco
// antes de qualquer insert — e lote repetido quebra a rastreabilidade.
//
// `cliente` existe para os testes injetarem uma fachada do PostgREST.
export async function proximosLotes(dataStr, empresaId, quantidade, cliente = supabase) {
  if (!(quantidade > 0)) return [];
  const prefixo = `LT-${dataStr.slice(2, 4)}${dataStr.slice(5, 7)}${dataStr.slice(8, 10)}-`;
  const [r1, r2] = await Promise.all([
    cliente.from('recebimento_itens').select('lote').eq('empresa_id', empresaId).like('lote', `${prefixo}%`),
    cliente.from('producoes').select('lote').eq('empresa_id', empresaId).like('lote', `${prefixo}%`),
  ]);
  const n = (r1.data?.length || 0) + (r2.data?.length || 0);
  return Array.from({ length: quantidade }, (_, i) => prefixo + String(n + 1 + i).padStart(3, '0'));
}

// Um único lote — mesmo número que o primeiro do lote plural.
export async function proximoLote(dataStr, empresaId, cliente = supabase) {
  const [lote] = await proximosLotes(dataStr, empresaId, 1, cliente);
  return lote;
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

// Custo médio de uma matéria-prima a partir da lista de recebimentos
// (fallback: custo padrão cadastrado na matéria-prima). Só considera itens
// aprovados na inspeção — um lote rejeitado, em quarentena ou ainda pendente
// não deve puxar o custo médio, do mesmo jeito que não entra no saldo de
// estoque. O status vem de `inspecoes_qualidade`, então a query que alimenta
// `recebimentos` precisa trazer essa relação junto.
export function custoMedioMP(mpId, recebimentos, materiasPrimas) {
  const recs = (recebimentos || []).filter(r =>
    r.materia_prima_id === mpId && inspecaoAprovada(r)
  );
  if (!recs.length) {
    const mp = (materiasPrimas || []).find(m => m.id === mpId);
    return mp ? Number(mp.custo_unitario) : 0;
  }
  const totalQtd = recs.reduce((s, r) => s + Number(r.quantidade), 0);
  const totalCusto = recs.reduce((s, r) => s + Number(r.quantidade) * Number(r.custo_unitario), 0);
  return totalQtd ? totalCusto / totalQtd : 0;
}
