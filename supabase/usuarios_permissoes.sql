-- =========================================================
-- 364 FOODSERVICES — USUÁRIOS E PERMISSÕES POR ABA
-- Rode este arquivo inteiro no SQL Editor do Supabase
-- (depois de já ter rodado schema.sql).
-- =========================================================

-- ---------- PERMISSÕES POR MÓDULO/ABA ----------
-- Cada linha dá a um usuário acesso a uma aba do sistema.
-- O módulo especial 'admin' dá acesso total + gestão de usuários.
create table if not exists public.permissoes (
  user_id uuid not null references auth.users(id) on delete cascade,
  modulo text not null,
  primary key (user_id, modulo)
);

alter table public.permissoes enable row level security;

-- Função com SECURITY DEFINER para checar admin sem cair em recursão de RLS
create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from permissoes
    where user_id = auth.uid() and modulo = 'admin'
  );
$$;

drop policy if exists "permissoes_select" on public.permissoes;
create policy "permissoes_select" on public.permissoes
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "permissoes_admin_write" on public.permissoes;
create policy "permissoes_admin_write" on public.permissoes
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- USUÁRIO DE TESTE: admin / admin ----------
-- Criado direto em auth.users (só possível pelo SQL Editor).
-- Login no sistema: usuário "admin", senha "admin"
-- (internamente vira o e-mail admin@364.local).
do $$
declare
  uid uuid := gen_random_uuid();
begin
  if not exists (select 1 from auth.users where email = 'admin@364.local') then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new
    ) values (
      '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
      'admin@364.local', crypt('admin', gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}', '{"nome":"Administrador"}',
      now(), now(),
      '', '', '', ''
    );

    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), uid, uid::text,
      jsonb_build_object('sub', uid::text, 'email', 'admin@364.local', 'email_verified', true),
      'email', now(), now(), now()
    );
  end if;
end $$;

-- Permissão de administrador
insert into public.permissoes (user_id, modulo)
select id, 'admin' from auth.users where email = 'admin@364.local'
on conflict do nothing;

-- Registro correspondente na equipe
insert into public.funcionarios (user_id, nome, cargo)
select u.id, 'Administrador', 'Administrador'
from auth.users u
where u.email = 'admin@364.local'
  and not exists (select 1 from public.funcionarios f where f.user_id = u.id);
