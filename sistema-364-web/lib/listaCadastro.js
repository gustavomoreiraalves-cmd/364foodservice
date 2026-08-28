// Busca e filtro das listas de cadastro (clientes, fornecedores, produtos).
// Fica fora do componente para poder ser testado sem renderizar nada.

// Tira acento, caixa e espaço sobrando. Quem procura "Açougue São José" digita
// "acougue sao jose" — e deveria achar.
export function textoDaBusca(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function soDigitos(valor) {
  return String(valor ?? '').replace(/\D/g, '');
}

/**
 * @param {Array} registros
 * @param {object} opcoes
 * @param {string[]} opcoes.campos    campos varridos pela busca
 * @param {string} [opcoes.busca]
 * @param {boolean} [opcoes.mostrarInativos]
 */
export function filtrarRegistros(registros, { campos = [], busca = '', mostrarInativos = false } = {}) {
  const visiveis = (registros || []).filter(r => mostrarInativos || r.ativo !== false);
  const termo = textoDaBusca(busca);
  if (!termo) return visiveis;

  // Um termo só de dígitos é quase sempre um documento ou um código, e a pessoa
  // costuma digitar com a máscara que está vendo na tela ou no papel.
  const digitos = soDigitos(busca);

  return visiveis.filter(r => campos.some(campo => {
    const valor = r[campo];
    if (valor === null || valor === undefined) return false;
    if (textoDaBusca(valor).includes(termo)) return true;
    return digitos.length > 0 && soDigitos(valor).includes(digitos);
  }));
}

// Mecânica pura da ListaCadastro: redimensionar, esconder coluna, ordenar e paginar.
// Estas funções não dependem de React nem do DOM — só de arrays e objetos.

export function clampLargura(largura, minimo, maximo) {
  return Math.min(maximo, Math.max(minimo, largura));
}

export function larguraMaximaPadrao(largura) {
  return Math.min(400, largura * 3);
}

export function chaveLargura(chave) {
  return `${chave}:colunas:largura`;
}

export function chaveVisiveis(chave) {
  return `${chave}:colunas:visiveis`;
}

export function chaveTamanhoPagina(chave) {
  return `${chave}:paginacao:tamanho`;
}

// Coluna sem `escondivel` (ou com escondivel:false) nunca sai de vista — é o
// caso das colunas fixas (ex.: nome). As demais ficam visíveis até alguém
// desmarcar no menu; por isso "ausente no estado" também conta como visível.
export function colunaVisivel(colunas, colunasVisiveis, id) {
  const coluna = colunas.find(c => c.id === id);
  if (!coluna || !coluna.escondivel) return true;
  return colunasVisiveis[id] !== false;
}

export function alternarColuna(colunasVisiveis, id) {
  return { ...colunasVisiveis, [id]: colunasVisiveis[id] === false ? true : false };
}

export function alternarOrdenacao(ordenacaoAtual, campo) {
  if (ordenacaoAtual.campo === campo) {
    return { campo, direcao: ordenacaoAtual.direcao === 'asc' ? 'desc' : 'asc' };
  }
  return { campo, direcao: 'asc' };
}

// `valor()` (não `render()`) é o que compara — a célula pode desenhar "R$
// 45,50" enquanto o valor comparável é o número 45.5. Coluna sem `valor()`
// não ordena: devolve a lista como veio em vez de quebrar.
export function ordenarRegistros(registros, colunas, ordenacao) {
  if (!ordenacao.campo) return registros;
  const coluna = colunas.find(c => c.id === ordenacao.campo);
  if (!coluna || !coluna.valor) return registros;
  const dir = ordenacao.direcao === 'asc' ? 1 : -1;
  return [...registros].sort((a, b) => {
    const va = coluna.valor(a);
    const vb = coluna.valor(b);
    if (typeof va === 'string' || typeof vb === 'string') {
      return String(va ?? '').localeCompare(String(vb ?? ''), 'pt-BR') * dir;
    }
    return ((va ?? 0) - (vb ?? 0)) * dir;
  });
}

// tamanhoPagina 0 = "Todos": uma página só, do tamanho da lista inteira.
// paginaAtual sempre cai dentro de [1, totalPaginas] mesmo que `pagina` peça
// uma página que não existe mais (ex.: um filtro reduziu o total enquanto a
// pessoa estava numa página adiantada).
export function paginar(registros, pagina, tamanhoPagina) {
  const total = registros.length;
  const totalPaginas = tamanhoPagina ? Math.max(1, Math.ceil(total / tamanhoPagina)) : 1;
  const paginaAtual = Math.min(Math.max(1, pagina), totalPaginas);
  const linhas = tamanhoPagina
    ? registros.slice((paginaAtual - 1) * tamanhoPagina, paginaAtual * tamanhoPagina)
    : registros;
  const inicio = total ? (tamanhoPagina ? (paginaAtual - 1) * tamanhoPagina + 1 : 1) : 0;
  const fim = tamanhoPagina ? Math.min(paginaAtual * tamanhoPagina, total) : total;
  return { linhas, paginaAtual, totalPaginas, inicio, fim, total };
}
