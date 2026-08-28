// Regras do cadastro fiscal de produto, do lado do cliente.
//
// O banco tem as mesmas travas em check constraint (atualização 36): aqui elas
// existem para a tela explicar o que falta antes de a pessoa clicar em salvar,
// não para substituir o banco. Quando as duas divergirem, o banco é quem manda.

// Literal exigido pelo layout da NF-e quando o item não tem código de barras.
// A tag cEAN nunca vai vazia: ou tem GTIN, ou tem isto.
export const SEM_GTIN = 'SEM GTIN';

export function soDigitos(valor) {
  return String(valor ?? '').replace(/\D/g, '');
}

// Módulo 10, o mesmo para GTIN-8, 12, 13 e 14: da direita para a esquerda, o
// dígito mais à direita do corpo pesa 3 e os pesos alternam.
export function digitoVerificadorGtin(gtin) {
  const digitos = soDigitos(gtin);
  if (digitos.length < 2) return null;
  const corpo = digitos.slice(0, -1);
  let soma = 0;
  for (let i = corpo.length - 1, posicao = 0; i >= 0; i--, posicao++) {
    soma += Number(corpo[i]) * (posicao % 2 === 0 ? 3 : 1);
  }
  return (10 - (soma % 10)) % 10;
}

export function gtinValido(gtin) {
  if (gtin === null || gtin === undefined || gtin === '') return true;
  if (gtin === SEM_GTIN) return true;
  const digitos = soDigitos(gtin);
  // Comparar com o original pega letra no meio, que soDigitos removeria em
  // silêncio deixando um número de comprimento válido passar.
  if (digitos !== String(gtin)) return false;
  if (![8, 12, 13, 14].includes(digitos.length)) return false;
  return Number(digitos.slice(-1)) === digitoVerificadorGtin(digitos);
}

// O seletor de CEST só deve oferecer o que corresponde ao NCM escolhido: é o
// erro de cadastro que mais reprova nota, e a correlação já está na tabela.
export function cestsDoNcm(tabelaCest, ncm) {
  const alvo = soDigitos(ncm);
  if (!alvo) return tabelaCest;
  return tabelaCest.filter(linha => {
    const daLinha = soDigitos(linha.ncm);
    // O convênio às vezes lista a posição (0210) em vez do NCM completo.
    return daLinha === alvo || (daLinha.length < alvo.length && alvo.startsWith(daLinha));
  });
}

// Quando a unidade de venda e a tributável são a mesma, o fator só pode ser 1,
// e por isso o formulário nem mostra o campo. O banco, porém, exige o fator
// preenchido para ligar ativo_fiscal (constraint produtos_ativo_fiscal_completo),
// então é aqui que ele é derivado — senão o Liberar quebra com um erro de check
// que ninguém consegue resolver pela tela.
export function fatorConversaoTributavel(produto = {}) {
  const informado = produto.fator_conversao_tributavel;
  if (informado !== '' && informado !== null && informado !== undefined) {
    const n = Number(informado);
    if (Number.isFinite(n)) return n;
  }
  const unidade = String(produto.unidade ?? '').trim().toUpperCase();
  const tributavel = String(produto.unidade_tributavel ?? '').trim().toUpperCase();
  return tributavel && unidade === tributavel ? 1 : null;
}

// O que impede este produto de entrar numa nota. Lista vazia = pode faturar.
export function pendenciasFiscaisProduto(produto = {}) {
  const faltando = [];
  const {
    ncm, cest, origem_mercadoria, unidade, unidade_tributavel,
    fator_conversao_tributavel, gtin, gtin_tributavel, sujeito_st,
    grupo_tributario_id, ind_escala, cnpj_fabricante,
  } = produto;

  if (!soDigitos(ncm)) faltando.push('NCM não informado');
  else if (soDigitos(ncm).length !== 8) faltando.push('NCM precisa ter 8 dígitos');

  if (origem_mercadoria === null || origem_mercadoria === undefined || origem_mercadoria === '') {
    faltando.push('origem da mercadoria não informada');
  }

  if (!unidade_tributavel) faltando.push('unidade tributável não informada');
  // O fator só faz sentido quando a unidade de venda difere da tributável: se
  // vende em peça e tributa em quilo, alguém precisa dizer quantos quilos tem a
  // peça, senão a quantidade tributável sai errada na nota.
  else if (unidade && String(unidade).toUpperCase() !== String(unidade_tributavel).toUpperCase()
           && !Number(fator_conversao_tributavel)) {
    faltando.push('fator de conversão entre a unidade de venda e a tributável');
  }

  if (sujeito_st && !soDigitos(cest)) {
    faltando.push('CEST é obrigatório em produto sujeito a substituição tributária');
  }

  if (!gtinValido(gtin) || !gtinValido(gtin_tributavel)) {
    faltando.push('código de barras com dígito verificador inválido');
  }

  if (ind_escala === 'N' && !soDigitos(cnpj_fabricante)) {
    faltando.push('CNPJ do fabricante, exigido quando a escala não é relevante');
  }

  if (!grupo_tributario_id) faltando.push('grupo tributário não definido');

  return faltando;
}

// Os campos que uma cópia de configuração fiscal leva de um produto a outro.
// Lista única, lida pela tela e pela rota — duas listas divergiriam no primeiro
// campo novo que alguém acrescentasse ao cadastro.
//
// Fora daqui, de propósito: gtin e gtin_tributavel (código de barras é único
// por produto), unidade (é a unidade de venda, não dado fiscal), peso líquido
// e bruto (atributo físico do item) e ativo_fiscal — que não é dado, é a
// declaração de que alguém conferiu a classificação.
//
// sujeito_st anda junto com o CEST de propósito: é a mesma classificação que
// decide os dois. Copiar um sem o outro deixa o destino marcado como sujeito a
// substituição tributária e sem o CEST que a ST exige — cadastro incoerente
// que só apareceria na hora de emitir.
export const CAMPOS_COPIA_FISCAL = [
  'ncm', 'ex_tipi', 'cest', 'origem_mercadoria', 'sujeito_st',
  'unidade_tributavel', 'fator_conversao_tributavel',
  'grupo_tributario_id', 'ind_escala', 'cnpj_fabricante', 'cst_ibs_cbs',
];

// Copiar é espelhar, inclusive o vazio: se a fonte está sem CEST, o destino
// fica sem CEST. Por isso campo ausente vira `null` explícito e não some do
// payload — sumir seria mesclar, e mesclar produz um produto que não é igual a
// nenhum dos dois e que ninguém conferiu.
export function camposCopiaFiscal(produtoFonte = {}) {
  const payload = {};
  for (const campo of CAMPOS_COPIA_FISCAL) {
    payload[campo] = produtoFonte[campo] ?? null;
  }
  return payload;
}

// O que a cópia muda num destino, campo a campo. Existe para a pessoa ver
// antes de aplicar — em especial `apaga`, o campo que tinha valor e vai ficar
// vazio porque a origem está vazia. Copiar é espelhar, e a remoção é a parte
// que ninguém espera.
//
// A comparação é frouxa de propósito: o formulário devolve '' onde o banco tem
// null, e o <select> devolve '0' onde o banco tem 0. Comparar cru marcaria
// mudança em todo campo em branco, toda vez que a aba abrisse.
export function diferencasCopiaFiscal(destino = {}, payload = {}) {
  const mesmo = (a, b) => String(a ?? '') === String(b ?? '');
  const vazio = v => v === null || v === undefined || v === '';
  const mudancas = [];
  for (const campo of CAMPOS_COPIA_FISCAL) {
    const atual = destino[campo] ?? null;
    const novoValor = payload[campo] ?? null;
    if (mesmo(atual, novoValor)) continue;
    mudancas.push({ campo, atual, novo: novoValor, apaga: !vazio(atual) && vazio(novoValor) });
  }
  return mudancas;
}

// Quais grupos tributários têm ao menos uma regra ativa.
//
// Não é simulação de fn_resolver_regra_tributaria: a resolução real depende de
// natureza da operação, UF de destino e perfil do destinatário, que só existem
// na hora de emitir. "Zero regras" é certeza de falha na emissão; "tem regra"
// não é garantia de sucesso — e a tela precisa dizer isso nesses termos.
export function gruposComRegra(regras = []) {
  const comRegra = new Set();
  for (const regra of regras) {
    if (regra?.ativo === false) continue;
    if (regra?.grupo_tributario_id) comRegra.add(regra.grupo_tributario_id);
  }
  return comRegra;
}

// A linha da tela de situação fiscal, derivada fora da tela para ser testável.
//
// `grupoSemRegra` só existe para produto QUE TEM grupo: produto sem grupo já
// aparece na lista de pendências, e marcar os dois avisos esconderia um deles.
export function situacaoFiscalProduto(produto = {}, gruposComRegraSet = new Set()) {
  const pendencias = pendenciasFiscaisProduto(produto);
  return {
    pendencias,
    grupoSemRegra: Boolean(produto.grupo_tributario_id)
      && !gruposComRegraSet.has(produto.grupo_tributario_id),
    liberado: pendencias.length === 0,
  };
}

// O que impede este cliente de receber uma nota. Espelha a constraint
// clientes_ativo_fiscal_completo da atualização 36 — aqui para explicar em
// português, lá para garantir.
export function pendenciasFiscaisCliente(cliente = {}) {
  const faltando = [];
  const {
    tipo_pessoa, cnpj, cpf, ie, ind_ie_dest, consumidor_final,
    logradouro, numero, bairro, codigo_municipio_ibge, municipio, uf, cep,
  } = cliente;

  if (!tipo_pessoa) faltando.push('pessoa física ou jurídica não informado');
  if (!soDigitos(cnpj) && !soDigitos(cpf)) faltando.push('CNPJ ou CPF não informado');

  if (ind_ie_dest === null || ind_ie_dest === undefined || ind_ie_dest === '') {
    faltando.push('indicador de inscrição estadual não informado');
  } else if (Number(ind_ie_dest) === 1 && !String(ie ?? '').trim()) {
    faltando.push('contribuinte sem inscrição estadual');
  } else if (Number(ind_ie_dest) !== 1 && String(ie ?? '').trim()) {
    faltando.push('não contribuinte não pode ter inscrição estadual preenchida');
  }

  if (consumidor_final === null || consumidor_final === undefined) {
    faltando.push('não está dito se é consumidor final');
  }

  if (!String(logradouro ?? '').trim()) faltando.push('endereço (logradouro) não informado');
  if (!String(numero ?? '').trim()) faltando.push('número do endereço não informado');
  if (!String(bairro ?? '').trim()) faltando.push('bairro não informado');
  if (!soDigitos(codigo_municipio_ibge)) faltando.push('município (código IBGE) não informado');
  if (!String(municipio ?? '').trim()) faltando.push('nome do município não informado');
  if (!String(uf ?? '').trim()) faltando.push('UF não informada');
  if (!soDigitos(cep)) faltando.push('CEP não informado');

  return faltando;
}

export function clienteProntoParaNota(cliente) {
  return pendenciasFiscaisCliente(cliente).length === 0;
}

export function prontoParaEmissao(produto) {
  return pendenciasFiscaisProduto(produto).length === 0;
}

// Origem da mercadoria — tabela A do layout. A 364 compra carne no país, então
// na prática só o 0 é usado, mas a lista inteira evita ter de voltar aqui.
export const ORIGENS_MERCADORIA = [
  { valor: 0, label: '0 — Nacional, exceto os códigos 3, 4, 5 e 8' },
  { valor: 1, label: '1 — Estrangeira, importação direta' },
  { valor: 2, label: '2 — Estrangeira, adquirida no mercado interno' },
  { valor: 3, label: '3 — Nacional, importação entre 40% e 70%' },
  { valor: 4, label: '4 — Nacional, produção conforme processos produtivos básicos' },
  { valor: 5, label: '5 — Nacional, importação até 40%' },
  { valor: 6, label: '6 — Estrangeira, importação direta, sem similar nacional' },
  { valor: 7, label: '7 — Estrangeira, mercado interno, sem similar nacional' },
  { valor: 8, label: '8 — Nacional, importação superior a 70%' },
];

// Unidades usadas quando a tabela oficial ainda não foi carregada no banco.
export const UNIDADES_PADRAO = ['KG', 'G', 'UN', 'PC', 'CX', 'FD', 'PT', 'BD', 'L', 'DZ'];
