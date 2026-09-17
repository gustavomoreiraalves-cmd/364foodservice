-- supabase/atualizacao_57_assinatura_wix_envios.sql
-- Confirmação de data de envio por ciclo das assinaturas importadas do Wix
-- (aba Assinaturas de /pedidos, ver lib/wixAssinaturas.js). Cada pedido do
-- Wix já é um ciclo (o Wix cria um pedido novo a cada cobrança recorrente),
-- então a chave é só empresa + id do pedido do Wix — sem tabela de
-- assinatura nem de ciclo por trás, os dados da assinatura em si continuam
-- vindo ao vivo do Wix, nunca gravados aqui.
--
-- Sem relação com as tabelas `assinaturas`/`assinatura_entregas` que já
-- existem em produção sem migração versionada e sem nenhum código usando —
-- achado ao vivo em 17/09/2026, ver docs/IDEIAS.md.
--
-- Idempotente: create table if not exists. Rollback comentado no fim.
begin;

create table if not exists public.assinatura_wix_envios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  wix_order_id text not null,
  data_envio date not null,
  confirmado_por uuid references public.funcionarios(id),
  confirmado_em timestamptz not null default now(),
  unique (empresa_id, wix_order_id)
);
create index if not exists assinatura_wix_envios_empresa_id_idx on public.assinatura_wix_envios(empresa_id);

-- Cadastro simples, sem regra de negócio por trás — mesma policy "for all"
-- que transportadoras (atualização 50) já usa em produção: grava direto do
-- navegador, sem rota de API.
alter table public.assinatura_wix_envios enable row level security;
drop policy if exists "empresa_scoped_access" on public.assinatura_wix_envios;
create policy "empresa_scoped_access" on public.assinatura_wix_envios for all
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()))
  with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

commit;

-- ---------- ROLLBACK ----------
-- begin;
-- drop table if exists public.assinatura_wix_envios;
-- commit;
