// Aritmética da dashboard consolidada do grupo, sobre as linhas de
// vw_consolidado_mensal (uma por empresa por mês).
//
// Nada aqui importa React ou Supabase de propósito: é o que permite testar
// todo o cálculo no `node --test`, sem browser e sem banco.
//
// O PostgREST devolve colunas `numeric` como string. Toda leitura passa por
// Number() — somar string em JavaScript concatena, e o erro passa silencioso.

// Divisão guardada: denominador zero devolve 0, nunca NaN nem Infinity.
export function div(a, b) {
  return b ? a / b : 0;
}

export function mesCorrente(agora = new Date()) {
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
}

// Date.UTC normaliza mês negativo sozinho, então a virada de ano sai de graça.
export function mesesAte(mesFinal, quantidade) {
  const [ano, mes] = mesFinal.split('-').map(Number);
  const meses = [];
  for (let i = quantidade - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(ano, mes - 1 - i, 1));
    meses.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return meses;
}

export function mesAnterior(mes) {
  return mesesAte(mes, 2)[0];
}

const CAMPOS = {
  receitaCompetencia: 'receita_competencia',
  receitaCaixa: 'receita_caixa',
  cmv: 'cmv',
  pedidos: 'pedidos_qtd',
  itens: 'itens_qtd',
  produtosSemCusto: 'produtos_sem_custo',
  produtosCustoFicha: 'produtos_custo_ficha',
  despesaCompetencia: 'despesa_competencia',
  despesaCaixa: 'despesa_caixa',
  compras: 'compras',
};

// Os contadores de produto (produtosSemCusto, produtosCustoFicha) são
// `count(distinct)` por mês. Somá-los ao longo de vários meses conta o mesmo
// produto mais de uma vez — só use esses dois campos num recorte de um mês.
export function consolidar(linhas) {
  const t = {};
  for (const chave of Object.keys(CAMPOS)) t[chave] = 0;
  for (const l of linhas || []) {
    for (const [chave, coluna] of Object.entries(CAMPOS)) {
      t[chave] += Number(l[coluna] || 0);
    }
  }
  const lucroBruto = t.receitaCompetencia - t.cmv;
  return {
    ...t,
    lucroBruto,
    margemBrutaPct: div(lucroBruto, t.receitaCompetencia) * 100,
    lucroLiquido: lucroBruto - t.despesaCompetencia,
    ticketMedio: div(t.receitaCompetencia, t.pedidos),
    saldoCaixa: t.receitaCaixa - t.despesaCaixa - t.compras,
  };
}

// Empresa sem movimento no recorte continua na lista, zerada. Sumir com ela
// esconderia justamente a operação que parou de vender.
export function porEmpresa(linhas, empresas) {
  const receitaGrupo = consolidar(linhas).receitaCompetencia;
  return (empresas || [])
    .map(e => {
      const t = consolidar((linhas || []).filter(l => l.empresa_id === e.id));
      return {
        id: e.id,
        nome: e.nome,
        ...t,
        participacaoPct: div(t.receitaCompetencia, receitaGrupo) * 100,
      };
    })
    .sort((a, b) => b.receitaCompetencia - a.receitaCompetencia);
}

// Base zero devolve null, renderizado como "—". Devolver Infinity ou 100%
// afirmaria um crescimento que não existe.
export function variacao(atual, anterior) {
  if (!anterior) return null;
  return ((atual - anterior) / Math.abs(anterior)) * 100;
}

export function serie12(linhas, mesFinal) {
  return mesesAte(mesFinal, 12).map(mes => ({
    mes,
    ...consolidar((linhas || []).filter(l => l.mes === mes)),
  }));
}

// Domínio vertical do gráfico. Inclui sempre o zero: barra que não parte da
// linha de base engana a leitura. `max` mínimo de 1 evita intervalo degenerado
// quando não há movimento nenhum.
export function dominioSerie(dados) {
  const valores = (dados || []).flatMap(d => [
    d.receitaCompetencia,
    d.cmv + d.despesaCompetencia,
    d.lucroLiquido,
  ]);
  return { min: Math.min(0, ...valores), max: Math.max(1, ...valores) };
}
