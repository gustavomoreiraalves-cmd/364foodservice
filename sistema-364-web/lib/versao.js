// Identificação da build que está no ar.
//
// Existe porque o mesmo código roda em três lugares (máquina local, preview da
// Vercel e produção) e, olhando a tela, não havia como saber qual deles é qual
// nem se a produção já recebeu a última entrega.
//
// Os valores brutos são congelados no momento do build (ver next.config.mjs).
// Este arquivo só formata, e por isso é puro e testável.

// VERCEL_ENV usa estes dois nomes; qualquer outra coisa (inclusive ausência da
// variável, que é o caso de `next dev`) é máquina local.
const ROTULOS_AMBIENTE = {
  production: 'produção',
  preview: 'teste',
};

export function rotularAmbiente(vercelEnv) {
  return ROTULOS_AMBIENTE[vercelEnv] || 'local';
}

export function ehProducao(vercelEnv) {
  return vercelEnv === 'production';
}

// Campo em branco vira '?' em vez de sumir: um espaço vazio parece bug de
// layout, enquanto '?' diz que a informação não chegou.
function ou(valor) {
  const texto = String(valor ?? '').trim();
  return texto || '?';
}

export function montarVersao({ versao, commit, branch, ambiente, buildEm } = {}) {
  const producao = ehProducao(ambiente);
  const rotulo = rotularAmbiente(ambiente);
  const commitTexto = ou(commit);
  const branchTexto = ou(branch);
  const buildTexto = ou(buildEm);
  const versaoTexto = 'v' + ou(versao);

  return {
    versao: versaoTexto,
    ambiente: rotulo,
    ehProducao: producao,
    // Em produção o branch é sempre `main` e não informa nada — fica só no
    // title. Em preview e local ele é a informação mais útil da linha.
    branch: producao ? null : branchTexto,
    commit: commitTexto,
    buildEm: buildTexto,
    titulo: [
      versaoTexto,
      'ambiente: ' + rotulo,
      'branch: ' + branchTexto,
      'commit: ' + commitTexto,
      'build: ' + buildTexto,
    ].join('\n'),
  };
}
