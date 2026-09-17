-- supabase/atualizacao_55_preco_atacado_produto.sql
--
-- Preço de atacado no produto: até aqui só existia preco_venda (balcão).
-- Cliente com tipo 'Revenda' (já cadastrado em clientes.tipo, sem coluna
-- nova) agora pode ter um preço diferenciado no pedido — se o produto não
-- tiver preco_atacado cadastrado, o pedido cai no preco_venda normal, o
-- mesmo fallback que já existia para preço vazio (lib/pedidos.js precoDoItem).
begin;

alter table public.produtos
  add column if not exists preco_atacado numeric(12,2);

commit;
