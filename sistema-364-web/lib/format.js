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

// Lê o custo unitário digitado (cadastro de produto ou prompt de edição) e
// devolve um número >= 0, ou `null` quando o texto não é um custo válido.
//
// Regras, iguais nos dois caminhos que gravam a coluna:
//   - vazio / null / undefined  -> 0. Zero é o valor documentado de "não
//     informado": o CMV cai no custo teórico da ficha técnica, que é o que o
//     texto de ajuda do formulário promete.
//   - vírgula decimal aceita ('45,50' == '45.50' == 45.5). A troca é global,
//     para o resultado não depender de quantas vírgulas o usuário digitou.
//   - separador de milhar NÃO é aceito: '1.234,56' vira '1.234.56', que não é
//     número, e a função devolve null para a tela avisar. Aceitá-lo exigiria
//     remover os pontos, e isso estragaria '1.5' — que o <input type="number">
//     produz querendo dizer um e meio, não mil e quinhentos.
//   - qualquer coisa que não vire número finito, ou número negativo -> null.
//     Custo negativo é pior que erro visível: todo leitor testa `> 0`, então
//     ele passaria a cair na ficha e reportaria um custo que o produto não tem.
export function parseCustoUnitario(valor) {
  if (valor === null || valor === undefined) return 0;
  const texto = String(valor).trim();
  if (texto === '') return 0;
  const numerico = Number(texto.replace(/,/g, '.'));
  if (!Number.isFinite(numerico) || numerico < 0) return null;
  return numerico;
}

export function hoje() {
  return new Date().toISOString().slice(0, 10);
}

export function diasEntre(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

// Gera os próximos `quantidade` números de lote no padrão LT-AAMMDD-###,
// a partir do MAIOR SUFIXO já usado no dia NA MESMA EMPRESA (recebimentos +
// produções) — não da contagem de linhas.
//
// Por que não contar linhas: `recebimento_itens.lote` tem
// unique(empresa_id, lote) (atualização 28), e excluir um item do meio do
// dia é fluxo normal (ver excluirItem em app/recebimentos/page.js). Se
// LT-260821-001/002/003 existem e o operador exclui o 002, a contagem cai
// para 2 e o próximo lançamento geraria "-003" de novo — que já existe, a
// constraint recusa, e o rollback da transação devolve a contagem ao mesmo
// valor: repetir o lançamento falha de novo, em loop. Derivar do maior
// sufixo não tem esse problema: com 001 e 003 sobrando, o próximo é 004,
// buraco no meio ou não.
//
// O estado é lido UMA vez e incrementado em memória. Chamar proximoLote em
// laço geraria lotes repetidos, porque cada chamada lê o mesmo estado do
// banco antes de qualquer insert — e lote repetido quebra a rastreabilidade.
//
// `cliente` existe para os testes injetarem uma fachada do PostgREST.
export async function proximosLotes(dataStr, empresaId, quantidade, cliente = supabase) {
  if (!(quantidade > 0)) return [];
  const prefixo = `LT-${dataStr.slice(2, 4)}${dataStr.slice(5, 7)}${dataStr.slice(8, 10)}-`;
  const [r1, r2] = await Promise.all([
    cliente.from('recebimento_itens').select('lote').eq('empresa_id', empresaId).like('lote', `${prefixo}%`),
    cliente.from('producoes').select('lote').eq('empresa_id', empresaId).like('lote', `${prefixo}%`),
  ]);
  const lotes = [...(r1.data || []), ...(r2.data || [])];
  // Sufixo não numérico (dado sujo, ou lote de outro padrão) é ignorado em
  // vez de derrubar a conta — não conta como "maior" nem quebra o parsing.
  const maiorSufixo = lotes.reduce((max, l) => {
    const sufixo = String(l.lote || '').slice(prefixo.length);
    return /^\d+$/.test(sufixo) ? Math.max(max, Number(sufixo)) : max;
  }, 0);
  return Array.from({ length: quantidade }, (_, i) => prefixo + String(maiorSufixo + 1 + i).padStart(3, '0'));
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
