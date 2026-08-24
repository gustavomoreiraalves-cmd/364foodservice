// Motor de sugestão: dado um débito do extrato e as parcelas pendentes,
// diz qual parcela provavelmente é aquele débito. Funções puras — a rota
// usa para pré-associar na importação, e a tela usa para ranquear o dropdown
// quando o colaborador vai escolher na mão.
//
// A régua: valor igual é pré-requisito (banco não erra centavo), data perto
// pontua, e o fornecedor aprendido no padrão é o desempate. Sem certeza não
// se sugere nada — deixar em 'pendente' custa um clique; sugerir errado custa
// uma parcela baixada no lugar errado.

export const JANELA_DIAS = 7;
export const TOLERANCIA = 0.01;
export const LIMIAR_SUGESTAO = 60;
export const MARGEM_SUGESTAO = 15;

const PONTOS_VALOR = 50;      // pré-requisito: todo candidato tem
const PONTOS_FORNECEDOR = 30; // padrão aprendido aponta para este fornecedor
const PONTOS_DATA = 20;       // proporcional à proximidade do vencimento

export function valorCasa(a, b) {
  return Math.abs(Number(a) - Number(b)) <= TOLERANCIA;
}

export function diferencaDias(dataA, dataB) {
  const ms = Date.parse(`${dataA}T00:00:00Z`) - Date.parse(`${dataB}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

export function inferirFormaPagamento(descricao) {
  const t = String(descricao ?? '').toUpperCase();
  if (t.includes('PIX')) return 'Pix';
  if (/BOLETO|TITULO|COBRANCA|COBRANÇA/.test(t)) return 'Boleto';
  return 'Transferência';
}

export function candidatosParaLancamento(lancamento, parcelas, padrao) {
  if (!lancamento || lancamento.tipo !== 'saida' || !Array.isArray(parcelas)) return [];

  let candidatos = [];
  for (const p of parcelas) {
    if (!p || !valorCasa(lancamento.valor, p.valor)) continue;
    const dias = diferencaDias(lancamento.data, p.vencimento);
    if (Number.isNaN(dias) || Math.abs(dias) > JANELA_DIAS) continue;
    candidatos.push({ parcela: p, dias });
  }

  // Padrão aprendido filtra pelo fornecedor — mas só quando ele acha alguém.
  // Padrão desatualizado (fornecedor trocou de nome, boleto veio de outro CNPJ)
  // não pode esconder o candidato certo do colaborador.
  const fornecedorPadrao = padrao?.fornecedorId || null;
  if (fornecedorPadrao) {
    const doPadrao = candidatos.filter(c => c.parcela.fornecedorId === fornecedorPadrao);
    if (doPadrao.length) candidatos = doPadrao;
  }

  return candidatos
    .map(({ parcela, dias }) => {
      const motivos = ['valor igual'];
      let score = PONTOS_VALOR;
      if (fornecedorPadrao && parcela.fornecedorId === fornecedorPadrao) {
        score += PONTOS_FORNECEDOR;
        motivos.push('fornecedor já aprendido');
      }
      score += Math.round(PONTOS_DATA * (1 - Math.abs(dias) / JANELA_DIAS));
      motivos.push(dias === 0 ? 'vence no dia do débito' : `vence a ${Math.abs(dias)} dia(s) do débito`);
      return { parcelaId: parcela.id, score, motivos };
    })
    .sort((a, b) => b.score - a.score);
}

// Só sugere quando há um vencedor claro: pontuação acima do limiar e folga
// sobre o segundo colocado. Empate vira 'pendente' e a tela pede a escolha.
export function escolherSugestao(lancamento, parcelas, padrao) {
  const candidatos = candidatosParaLancamento(lancamento, parcelas, padrao);
  if (!candidatos.length) return null;
  const [primeiro, segundo] = candidatos;
  if (!Number.isFinite(primeiro.score) || primeiro.score < LIMIAR_SUGESTAO) return null;
  if (segundo && primeiro.score - segundo.score < MARGEM_SUGESTAO) return null;
  return { parcelaId: primeiro.parcelaId, score: primeiro.score };
}
