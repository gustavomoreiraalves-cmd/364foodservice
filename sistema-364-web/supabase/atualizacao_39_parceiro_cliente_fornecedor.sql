-- =========================================================
-- Atualização 39 — Cliente e fornecedor vinculados
--
-- Uma empresa pode ser cliente e fornecedor do Grupo 364 ao mesmo tempo (ex.:
-- Supermercado Manar, que fornece costela e compra defumado de volta). Esta
-- migração só cria a ligação 1-para-1 entre um registro de `clientes` e um de
-- `fornecedores`; as duas tabelas continuam existindo como são hoje, e nenhuma
-- FK de `pedidos`, `recebimentos`, `contas_a_pagar` ou `conciliacao_padroes`
-- muda de lugar.
--
-- `nome_fantasia` em fornecedores só faltava para os dois lados terem os
-- mesmos campos compartilháveis que a tela de parceiro sincroniza.
--
-- Aditiva e idempotente: rodar duas vezes não quebra nada.
-- =========================================================

begin;

alter table public.fornecedores add column if not exists nome_fantasia text;

alter table public.clientes
  add column if not exists fornecedor_vinculado_id uuid references public.fornecedores(id) on delete set null;
alter table public.fornecedores
  add column if not exists cliente_vinculado_id uuid references public.clientes(id) on delete set null;

create unique index if not exists clientes_fornecedor_vinculado_idx
  on public.clientes (fornecedor_vinculado_id) where fornecedor_vinculado_id is not null;
create unique index if not exists fornecedores_cliente_vinculado_idx
  on public.fornecedores (cliente_vinculado_id) where cliente_vinculado_id is not null;

commit;
