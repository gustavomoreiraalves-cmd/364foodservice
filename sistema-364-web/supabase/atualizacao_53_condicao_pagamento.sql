-- supabase/atualizacao_53_condicao_pagamento.sql
--
-- Dados de pagamento no pedido: até aqui registrarFaturamentoDoPedido
-- (lib/nfe/emitir.js) sempre gerava 1 parcela à vista, hardcoded. Agora o
-- pedido carrega forma de pagamento (livre, só descritiva) e condição de
-- pagamento (numero_parcelas + intervalo_dias, cadastrável em Financeiro >
-- Contas a Receber), e a conta a receber nasce com as parcelas certas na
-- hora da emissão da NF-e.
begin;

create table if not exists public.condicoes_pagamento (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  nome text not null,
  numero_parcelas int not null check (numero_parcelas > 0),
  intervalo_dias int not null default 0 check (intervalo_dias >= 0),
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists condicoes_pagamento_empresa_nome_unico
  on public.condicoes_pagamento(empresa_id, nome);
create index if not exists condicoes_pagamento_empresa_id_idx on public.condicoes_pagamento(empresa_id);

alter table public.pedidos
  add column if not exists forma_pagamento text
    check (forma_pagamento in ('dinheiro', 'pix', 'boleto', 'cartao_credito', 'cartao_debito', 'transferencia')),
  add column if not exists condicao_pagamento_id uuid references public.condicoes_pagamento(id);

-- Pedidos já existentes ficam com os dois campos nulos — registrarFaturamentoDoPedido
-- trata condicao_pagamento_id nulo como à vista (1 parcela, 0 dias), o mesmo
-- comportamento hardcoded de antes desta migração. O formulário passa a
-- exigir os dois campos daqui pra frente, só para pedido novo.

alter table public.condicoes_pagamento enable row level security;
drop policy if exists "empresa_scoped_access" on public.condicoes_pagamento;
create policy "empresa_scoped_access" on public.condicoes_pagamento for all
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()))
  with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

-- Seed: uma condição "À vista" por empresa, pra já ter opção default no
-- select do pedido assim que a migração roda.
insert into public.condicoes_pagamento (empresa_id, nome, numero_parcelas, intervalo_dias)
select id, 'À vista', 1, 0 from public.empresas
on conflict (empresa_id, nome) do nothing;

commit;

-- ---------- ROLLBACK ----------
-- begin;
-- alter table public.pedidos drop column if exists condicao_pagamento_id;
-- alter table public.pedidos drop column if exists forma_pagamento;
-- drop table if exists public.condicoes_pagamento;
-- commit;
