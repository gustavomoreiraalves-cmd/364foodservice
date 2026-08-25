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
