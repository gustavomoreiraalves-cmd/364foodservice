-- =========================================================
-- 364 FOODSERVICES — ATUALIZAÇÃO 02: CADASTRO COMPLETO DE USUÁRIOS
-- Rode este arquivo inteiro no SQL Editor do Supabase
-- (depois de schema.sql e usuarios_permissoes.sql).
-- =========================================================

-- Campos de cadastro completo no registro de funcionário/usuário
alter table public.funcionarios add column if not exists email text;
alter table public.funcionarios add column if not exists telefone text;
alter table public.funcionarios add column if not exists cpf text;

-- Garante no máximo um registro de funcionário por login
create unique index if not exists funcionarios_user_id_key
  on public.funcionarios (user_id);
