-- =========================================================
-- 364 — ATUALIZAÇÃO 05: ACESSO POR EMPRESA
-- Segunda dimensão de permissão (independente das abas em `permissoes`):
-- quais empresas cada usuário pode ver/editar.
-- Rode depois de atualizacao_04_empresa_id_backfill.sql.
-- =========================================================

create table if not exists public.usuario_empresas (
  user_id uuid not null references auth.users(id) on delete cascade,
  empresa_id uuid not null references empresas(id) on delete cascade,
  primary key (user_id, empresa_id)
);

alter table public.usuario_empresas enable row level security;

drop policy if exists "usuario_empresas_select" on public.usuario_empresas;
create policy "usuario_empresas_select" on public.usuario_empresas
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "usuario_empresas_admin_write" on public.usuario_empresas;
create policy "usuario_empresas_admin_write" on public.usuario_empresas
  for all using (public.is_admin()) with check (public.is_admin());

-- Resolve "quais empresas este usuário enxerga": admin cai automaticamente no
-- primeiro braço do union (todas as empresas); os demais só o que foi concedido.
-- security definer + stable, mesmo padrão de is_admin() — evita recursão de RLS.
create or replace function public.empresas_permitidas()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select id from empresas where public.is_admin()
  union
  select empresa_id from usuario_empresas where user_id = auth.uid();
$$;
