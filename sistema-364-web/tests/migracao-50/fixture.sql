-- tests/migracao-50/fixture.sql
-- Base mínima pra exercitar a atualização 50 num Postgres local descartável.
-- Recria pedidos/pedido_itens/nfe_saida_documentos e a função
-- fn_pedido_bloquear_cabecalho COMO ELAS EXISTEM HOJE (pré-50, atualização
-- 27) — a 50 faz `create or replace`, então o teste prova a transição real.
create extension if not exists pgcrypto;

-- Stub de auth.role(), mesmo padrão de tests/migracao-36/fixture.sql — a
-- policy de transportadoras (RLS, this atualização) chama auth.role() como
-- as demais policies "empresa_scoped_access" já em produção.
create schema if not exists auth;
create or replace function auth.role() returns text
  language sql stable as $$ select 'authenticated'::text $$;

create table if not exists public.empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null
);
create table if not exists public.funcionarios (
  id uuid primary key default gen_random_uuid()
);
create table if not exists public.clientes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id)
);
create table if not exists public.produtos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id)
);
create table if not exists public.pedidos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  data date not null default current_date,
  cliente_id uuid references public.clientes(id),
  status text not null default 'Pendente',
  responsavel_id uuid references public.funcionarios(id),
  observacoes text,
  cancelado_motivo text,
  cancelado_em timestamptz,
  cancelado_por_id uuid references public.funcionarios(id),
  reaberto_motivo text,
  reaberto_em timestamptz,
  reaberto_por_id uuid references public.funcionarios(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.pedido_itens (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  produto_id uuid not null references public.produtos(id),
  quantidade numeric(12,4) not null,
  preco_unitario numeric(12,2) not null
);
create table if not exists public.recebimento_itens (
  id uuid primary key default gen_random_uuid(),
  validade date
);
create table if not exists public.embalagem_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id),
  produto_id uuid references public.produtos(id),
  recebimento_item_id uuid references public.recebimento_itens(id),
  quantidade numeric(12,3) not null,
  validade date
);
create table if not exists public.naturezas_operacao (
  id uuid primary key default gen_random_uuid()
);
create table if not exists public.nfe_saida_documentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id),
  pedido_id uuid references public.pedidos(id),
  status text not null default 'rascunho'
);

create or replace function public.fn_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

create or replace function public.empresas_permitidas()
returns setof uuid language sql stable as $$
  select id from public.empresas where nome = '364 Food Services'
$$;

-- fn_pedido_bloquear_cabecalho tal como a atualização 27 a deixou (cópia
-- literal do corpo em supabase/atualizacao_27_pedidos_edicao.sql) — a 50
-- substitui por create or replace, então rodar a 50 aqui em cima prova a
-- transição real, não uma versão hipotética.
create or replace function public.fn_pedido_bloquear_cabecalho() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := clock_timestamp();
  if new.status = 'Cancelado' and old.status is distinct from 'Cancelado' then
    new.cancelado_em := clock_timestamp();
  end if;
  if old.status = 'Cancelado' and new.status is distinct from 'Cancelado' then
    raise exception 'Pedido cancelado não volta para %.', new.status using errcode = 'check_violation';
  end if;
  if old.status in ('Faturado', 'Enviado') and new.status = 'Pendente' then
    if new.reaberto_motivo is null or btrim(new.reaberto_motivo) = ''
       or new.reaberto_motivo is not distinct from old.reaberto_motivo then
      raise exception 'Reabrir o pedido % exige informar um motivo novo da reabertura.', old.id
        using errcode = 'check_violation';
    end if;
    new.reaberto_em := clock_timestamp();
  end if;
  if old.status is distinct from 'Pendente'
     and (new.cliente_id is distinct from old.cliente_id or new.data is distinct from old.data) then
    raise exception 'Pedido % está % — cliente e data não podem ser alterados.', old.id, old.status
      using errcode = 'check_violation';
  end if;
  if old.status = 'Pendente' and new.status not in ('Pendente', 'Cancelado')
     and not exists (select 1 from public.pedido_itens where pedido_id = new.id) then
    raise exception 'Pedido sem itens não pode sair de Pendente.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_pedidos_bloquear_cabecalho on public.pedidos;
create trigger trg_pedidos_bloquear_cabecalho before update on public.pedidos
  for each row execute function public.fn_pedido_bloquear_cabecalho();

do $$ begin create role authenticated; exception when duplicate_object then null; end $$;

insert into public.empresas (id, nome) values
  ('11111111-1111-1111-1111-111111111111', '364 Food Services')
  on conflict (id) do nothing;
insert into public.clientes (id, empresa_id) values
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111')
  on conflict (id) do nothing;
insert into public.produtos (id, empresa_id) values
  ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111')
  on conflict (id) do nothing;

-- pedido_a: Pendente, com 1 item (pronto pra sair de Pendente).
insert into public.pedidos (id, empresa_id, cliente_id, status) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'cccccccc-0000-0000-0000-000000000001', 'Pendente')
  on conflict (id) do nothing;
insert into public.pedido_itens (id, pedido_id, produto_id, quantidade, preco_unitario) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000001', 10, 25.5)
  on conflict (id) do nothing;
