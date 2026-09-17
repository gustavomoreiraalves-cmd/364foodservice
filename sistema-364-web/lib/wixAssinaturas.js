// Busca as assinaturas (compra recorrente de produto) do site Wix
// "364 Food Services" via API de pedidos do eCommerce (Pricing Plans não está
// instalado nesse site — a assinatura é um lineItem de pedido normal com
// `subscriptionInfo`, criada pelo checkout de assinatura do Wix Stores).
//
// Server-only: autentica como o app headless do próprio projeto do site
// (WIX_CLIENT_ID/SECRET/INSTANCE_ID do projeto "loja-364", mesmas credenciais
// de scripts/wixapi.sh de lá) via OAuth client_credentials — token de app,
// sem sessão de usuário. Nunca importar este arquivo em código que rode no
// navegador.

const TOKEN_ENDPOINT = 'https://www.wixapis.com/oauth2/token';
const ENDPOINT = 'https://www.wixapis.com/ecom/v1/orders/search';

export function wixConfigurado() {
  return !!(process.env.WIX_CLIENT_ID && process.env.WIX_CLIENT_SECRET && process.env.WIX_CLIENT_INSTANCE_ID);
}

// Cache em memória do processo: o token dura `expires_in` segundos (tipo 5
// min); reaproveitar evita pedir um novo a cada assinatura carregada na tela.
let tokenCache = null;

async function obterToken() {
  if (tokenCache && tokenCache.expiraEm > Date.now()) return tokenCache.token;

  const r = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: process.env.WIX_CLIENT_ID,
      client_secret: process.env.WIX_CLIENT_SECRET,
      instance_id: process.env.WIX_CLIENT_INSTANCE_ID,
    }),
  });
  if (!r.ok) throw new Error(`Falha ao autenticar no Wix (${r.status}): ${(await r.text()).slice(0, 300)}`);
  const json = await r.json();
  // Margem de 60s antes de expirar de verdade, pra nunca usar um token vencido no meio de uma página.
  tokenCache = { token: json.access_token, expiraEm: Date.now() + (json.expires_in - 60) * 1000 };
  return tokenCache.token;
}

// Um pedido pode ter mais de um lineItem de assinatura (raro, mas o checkout
// de assinatura do Wix não impede); achatamos pra uma linha por assinatura.
function extrairAssinaturas(pedido) {
  const linhas = [];
  // recipientInfo é quem recebe a entrega (pode ser diferente de quem paga);
  // cai pra billingInfo quando o Wix não grava recipientInfo (pedido sem frete).
  const endereco = pedido.recipientInfo?.address || pedido.billingInfo?.address || null;
  for (const item of pedido.lineItems || []) {
    if (!item.subscriptionInfo) continue;
    const cfg = item.subscriptionInfo;
    linhas.push({
      wixOrderId: pedido.id,
      numeroWix: pedido.number,
      subscriptionId: cfg.id,
      produtoNome: item.productName?.original || cfg.subscriptionOptionTitle || '',
      cicloNumero: cfg.cycleNumber ?? null,
      frequencia: cfg.subscriptionSettings?.frequency || null,
      intervalo: cfg.subscriptionSettings?.interval ?? null,
      autoRenovacao: cfg.subscriptionSettings?.autoRenewal ?? null,
      valor: item.price?.amount ?? null,
      moeda: pedido.currency || null,
      statusPedido: pedido.status || null,
      statusPagamento: pedido.paymentStatus || null,
      dataCompra: pedido.purchasedDate || pedido.createdDate || null,
      compradorNome: [pedido.billingInfo?.contactDetails?.firstName, pedido.billingInfo?.contactDetails?.lastName].filter(Boolean).join(' '),
      compradorCpf: pedido.billingInfo?.contactDetails?.vatId?.id || null,
      compradorEmail: pedido.buyerInfo?.email || null,
      compradorTelefone: pedido.billingInfo?.contactDetails?.phone || null,
      enderecoRua: endereco?.streetAddress?.name || null,
      enderecoNumero: endereco?.streetAddress?.number || null,
      enderecoComplemento: endereco?.streetAddress?.apt || null,
      enderecoCidade: endereco?.city || null,
      enderecoUf: endereco?.subdivisionFullname || endereco?.subdivision || null,
      enderecoCep: endereco?.postalCode || null,
    });
  }
  return linhas;
}

// Pagina toda a busca (a API devolve até 100 por página) e filtra em memória:
// Search Orders não permite filtrar por lineItems.subscriptionInfo existir.
export async function buscarAssinaturasWix() {
  const token = await obterToken();
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  const assinaturas = [];
  let cursor;
  do {
    const search = { cursorPaging: { limit: 100, ...(cursor ? { cursor } : {}) } };
    const r = await fetch(ENDPOINT, { method: 'POST', headers, body: JSON.stringify({ search }) });
    if (!r.ok) {
      const corpo = await r.text();
      throw new Error(`Wix respondeu ${r.status}: ${corpo.slice(0, 300)}`);
    }
    const json = await r.json();
    for (const pedido of json.orders || []) assinaturas.push(...extrairAssinaturas(pedido));
    cursor = json.metadata?.hasNext ? json.metadata.cursors?.next : null;
  } while (cursor);

  return assinaturas;
}
