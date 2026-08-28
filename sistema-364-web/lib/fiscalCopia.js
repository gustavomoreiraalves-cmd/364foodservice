// O que a rota de cópia decide sobre um destino, separado dela para poder ser
// testado sem banco.
//
// A avaliação das pendências é sobre o produto DEPOIS da cópia: é a cópia que
// completa o cadastro, e olhar o estado anterior recusaria toda liberação.
// Campos que a cópia não toca (código de barras, unidade de venda) entram na
// conta assim mesmo — eles impedem a emissão do mesmo jeito.
import { pendenciasFiscaisProduto } from './fiscal.js';

export function avaliarDestino({ origem = {}, destino = {}, payload = {}, liberar = false }) {
  // grupo_tributario_id pertence a uma empresa. Propagá-lo entre CNPJs produz
  // uma regra que nunca resolve e leva a configuração fiscal de um
  // estabelecimento para outro.
  if (destino.empresa_id !== origem.empresa_id) {
    return {
      ok: false,
      erro: `"${destino.nome || destino.id}" é de outra marca; a configuração fiscal não atravessa CNPJ.`,
    };
  }

  const pendencias = pendenciasFiscaisProduto({ ...destino, ...payload });
  const liberado = Boolean(liberar) && pendencias.length === 0;
  // ativo_fiscal só entra no update quando a liberação foi pedida E o cadastro
  // ficou completo. Fora disso a chave nem aparece: mandar `false` apagaria a
  // liberação de um produto que já estava conferido.
  const gravar = liberado ? { ...payload, ativo_fiscal: true } : { ...payload };
  return { ok: true, gravar, liberado, pendencias };
}
