//
// Bloco emit da NF-e. Puro: recebe a linha de empregadores, devolve o objeto
// que o serializador consome.
//
// Falhar aqui é barato; falhar depois de reservar número queima numeração
// fiscal. Por isso toda ausência de campo obrigatório vira exceção nomeando o
// campo, e nenhuma vira valor padrão silencioso.

const CRT_POR_REGIME = { simples: '1', mei: '4', presumido: '3', real: '3' };

export function crtDoRegime(regimeTributario, crtExplicito) {
  // O CRT 2 (Simples com excesso de sublimite) não se deduz do regime — só
  // existe se alguém declarar. Por isso o override vem primeiro.
  if (crtExplicito !== null && crtExplicito !== undefined && String(crtExplicito).trim() !== '') {
    const c = String(crtExplicito).trim();
    if (!['1', '2', '3', '4'].includes(c)) throw new Error(`CRT inválido: ${crtExplicito}. Use 1, 2, 3 ou 4.`);
    return c;
  }
  const crt = CRT_POR_REGIME[String(regimeTributario || '').toLowerCase()];
  if (!crt) {
    throw new Error(
      `Não sei o regime tributário do emitente (recebi "${regimeTributario}"). `
      + 'Preencha o regime em /empresas, ou informe o CRT explicitamente.',
    );
  }
  return crt;
}

function exigir(valor, campo) {
  const v = typeof valor === 'string' ? valor.trim() : valor;
  if (v === null || v === undefined || v === '') {
    throw new Error(`O emitente está sem ${campo}. Complete o cadastro em /empresas antes de emitir.`);
  }
  return v;
}

const digitos = v => String(v ?? '').replace(/\D/g, '');

export function dadosEmitente(empregador) {
  return {
    cnpj: exigir(digitos(empregador.cnpj), 'CNPJ'),
    xNome: exigir(empregador.razao_social, 'razão social'),
    xFant: empregador.nome_fantasia || undefined,
    IE: exigir(digitos(empregador.inscricao_estadual), 'inscricao_estadual (inscrição estadual)'),
    CRT: crtDoRegime(empregador.regime_tributario, empregador.crt),
    enderEmit: {
      xLgr: exigir(empregador.endereco, 'endereco (logradouro)'),
      nro: exigir(empregador.numero, 'número do endereço'),
      xCpl: empregador.complemento || undefined,
      xBairro: exigir(empregador.bairro, 'bairro'),
      cMun: exigir(digitos(empregador.codigo_municipio_ibge), 'codigo_municipio_ibge'),
      xMun: exigir(empregador.cidade, 'cidade'),
      UF: exigir(empregador.uf, 'uf'),
      CEP: exigir(digitos(empregador.cep), 'cep'),
      cPais: '1058',
      xPais: 'BRASIL',
      fone: digitos(empregador.telefone) || undefined,
    },
  };
}
