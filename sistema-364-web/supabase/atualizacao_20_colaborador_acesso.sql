-- =========================================================
-- 364 — ATUALIZAÇÃO 20: COLABORADOR COMO CADASTRO-MESTRE DE ACESSO
-- O login do sistema passa a ser gerenciado pelo cadastro de
-- colaborador (/ponto/colaboradores → painel "Acesso"), que também
-- sincroniza permissões, empresas e a tabela funcionarios.
-- Rode depois de atualizacao_19_ponto_storage.sql.
-- =========================================================

-- vínculo colaborador ↔ login (1 login pertence a no máximo 1 colaborador)
alter table public.colaboradores add column if not exists user_id uuid references auth.users(id) on delete set null;
create unique index if not exists colaboradores_user_id_key on colaboradores (user_id) where user_id is not null;
