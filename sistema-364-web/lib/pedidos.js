// Helpers do módulo Pedidos de venda.
// Só lógica pura: as regras de imutabilidade valem de verdade no banco
// (trigger fn_pedido_bloquear_edicao, atualização 24). O que está aqui serve
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

// Saldo do produto que este pedido tem de fato para mexer.
//
// `vw_estoque_produto` calcula `saldo = produzido - vendido`, e `vendido` soma
// os itens de todo pedido não cancelado — inclusive o que está aberto na tela.
// No cadastro isso está certo: os itens ainda não existem no banco, e
// `itensJaGravados` chega vazio. Na edição, não: um pedido de 10 kg de um
// produto com 10 kg produzidos deixava saldo 0 e acendia a tarja "acima do
// saldo" em cada item já salvo. Aviso que aparece sempre deixa de ser aviso.
export function saldoDisponivel(estoque, itensJaGravados, produtoId) {
  const base = Number((estoque || []).find(e => e.produto_id === produtoId)?.saldo || 0);
  const reservado = (itensJaGravados || [])
    .filter(i => i.produto_id === produtoId)
    .reduce((s, i) => s + Number(i.quantidade || 0), 0);
  return base + reservado;
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
