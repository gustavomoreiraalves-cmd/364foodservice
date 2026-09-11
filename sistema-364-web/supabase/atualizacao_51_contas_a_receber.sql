-- supabase/atualizacao_51_contas_a_receber.sql
--
-- Espelha contas_a_pagar/contas_a_pagar_parcelas (atualização 16) do lado da
-- receita. Schema já fechado em docs/superpowers/specs/
-- 2026-08-25-financeiro-contas-a-receber-design.md — sem mudança aqui.
-- Toda conta nasce de uma NF-e de saída autorizada (gravada pelo motor de
-- emissão, Task 11) — sem lançamento avulso nesta fase.
begin;

create table if not exists public.contas_a_receber (
  id uuid primary key default gen_random_uuid(),
  descricao text not null,
  cliente_id uuid not null references public.clientes(id),
  pedido_id uuid not null references public.pedidos(id),
  nfe_saida_documento_id uuid not null references public.nfe_saida_documentos(id),
  valor_total numeric(12,2) not null,
  responsavel_id uuid references public.funcionarios(id),
  empresa_id uuid not null references public.empresas(id),
  created_at timestamptz not null default now()
);
create unique index if not exists contas_a_receber_nfe_documento_unico
  on public.contas_a_receber(nfe_saida_documento_id);
create index if not exists contas_a_receber_empresa_id_idx on public.contas_a_receber(empresa_id);
create index if not exists contas_a_receber_pedido_id_idx on public.contas_a_receber(pedido_id);
create index if not exists contas_a_receber_cliente_id_idx on public.contas_a_receber(cliente_id);

create table if not exists public.contas_a_receber_parcelas (
  id uuid primary key default gen_random_uuid(),
  conta_a_receber_id uuid not null references public.contas_a_receber(id) on delete cascade,
  numero int not null,
  valor numeric(12,2) not null,
  vencimento date not null,
  status text not null default 'Pendente' check (status in ('Pendente', 'Recebido')),
  data_recebimento date,
  forma_recebimento text,
  comprovante_path text,
  empresa_id uuid not null references public.empresas(id),
  created_at timestamptz not null default now(),
  unique (conta_a_receber_id, numero)
);
create index if not exists contas_a_receber_parcelas_conta_id_idx on public.contas_a_receber_parcelas(conta_a_receber_id);
create index if not exists contas_a_receber_parcelas_empresa_id_idx on public.contas_a_receber_parcelas(empresa_id);

-- RLS "for all": a baixa de parcela (marcar Recebido) é update direto do
-- navegador, mesmo padrão de contas_a_pagar_parcelas — só a criação inicial
-- é do motor de emissão (service role, que ignora RLS de qualquer forma).
do $$
declare t text;
begin
  foreach t in array array['contas_a_receber','contas_a_receber_parcelas'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "empresa_scoped_access" on public.%I;', t);
    execute format('create policy "empresa_scoped_access" on public.%I for all
                    using (auth.role() = ''authenticated'' and empresa_id in (select public.empresas_permitidas()))
                    with check (auth.role() = ''authenticated'' and empresa_id in (select public.empresas_permitidas()));', t);
  end loop;
end $$;

-- Regra de integridade (espelha o bloqueio já existente de exclusão de
-- Recebimento com parcela paga, atualização 16): NF-e cancelada sem nenhuma
-- parcela recebida derruba a conta em cascata (a nota nunca existiu do ponto
-- de vista financeiro); com parcela recebida, bloqueia o cancelamento da
-- nota, apontando pra conta.
create or replace function public.bloquear_cancelamento_nfe_com_parcela_recebida()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelado' and old.status is distinct from 'cancelado' then
    if exists (
      select 1 from public.contas_a_receber cr
      join public.contas_a_receber_parcelas pc on pc.conta_a_receber_id = cr.id
      where cr.nfe_saida_documento_id = old.id and pc.status = 'Recebido'
    ) then
      raise exception 'Não é possível cancelar: esta nota já tem parcela recebida na Conta a Receber. Ajuste em Financeiro antes.'
        using errcode = 'check_violation';
    end if;
    delete from public.contas_a_receber where nfe_saida_documento_id = old.id;
  end if;
  return new;
end $$;

drop trigger if exists trg_bloquear_cancelamento_nfe_com_parcela_recebida on public.nfe_saida_documentos;
create trigger trg_bloquear_cancelamento_nfe_com_parcela_recebida
  before update on public.nfe_saida_documentos
  for each row execute function public.bloquear_cancelamento_nfe_com_parcela_recebida();

commit;

-- ---------- ROLLBACK ----------
-- begin;
-- drop trigger if exists trg_bloquear_cancelamento_nfe_com_parcela_recebida on public.nfe_saida_documentos;
-- drop function if exists public.bloquear_cancelamento_nfe_com_parcela_recebida();
-- drop table if exists public.contas_a_receber_parcelas;
-- drop table if exists public.contas_a_receber;
-- commit;
