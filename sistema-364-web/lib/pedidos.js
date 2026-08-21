// Helpers do módulo Pedidos de venda.
// Só lógica pura: as regras de imutabilidade valem de verdade no banco
// (trigger fn_pedido_bloquear_edicao, atualização 21). O que está aqui serve
// para a tela decidir o que mostrar e para montar o diff antes de gravar.

export const STATUS_PEDIDO = ['Pendente', 'Faturado', 'Enviado', 'Cancelado'];

// Pedido só é editável enquanto está Pendente. Status desconhecido vindo do
// banco não libera edição — na dúvida, tela em leitura.
export function podeEditar(status) {
  return status === 'Pendente';
}

export function totalPedido(itens) {
  return (itens || []).reduce(
    (s, i) => s + Number(i.quantidade || 0) * Number(i.preco_unitario || 0),
    0,
  );
}

// Preço vazio na tela cai no preço de venda do produto; zero digitado é zero
// de propósito (bonificação, brinde), por isso o teste é contra string vazia
// e null, e não um `||` sobre o número.
export function precoDoItem(precoDigitado, produto) {
  const digitado = precoDigitado === '' || precoDigitado === null || precoDigitado === undefined
    ? null
    : Number(precoDigitado);
  if (digitado !== null && !Number.isNaN(digitado)) return digitado;
  return Number(produto?.preco_venda || 0);
}

function mesmoItem(a, b) {
  return a.produto_id === b.produto_id
    && Number(a.quantidade) === Number(b.quantidade)
    && Number(a.preco_unitario) === Number(b.preco_unitario);
}

// Compara a lista carregada do banco com a lista da tela e devolve só o que
// mudou. Item intocado não gera update: menos escrita, menos linha no histórico.
export function diffItens(original, atual) {
  const antes = original || [];
  const depois = atual || [];
  const porId = new Map(antes.map(i => [i.id, i]));

  const inserir = depois.filter(i => !i.id);
  const atualizar = depois.filter(i => i.id && porId.has(i.id) && !mesmoItem(porId.get(i.id), i));
  const idsDepois = new Set(depois.filter(i => i.id).map(i => i.id));
  const remover = antes.filter(i => !idsDepois.has(i.id)).map(i => i.id);

  return { inserir, atualizar, remover };
}
