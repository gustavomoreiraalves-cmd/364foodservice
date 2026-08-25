-- =========================================================
-- Atualização 38 — Nome fantasia no cadastro de clientes
--
-- Clientes já tinha nome/razão social, mas não nome fantasia (empregadores
-- já tinha os dois desde a atualização original). Aditiva e idempotente:
-- rodar duas vezes não quebra nada, e todo cliente existente nasce com o
-- campo vazio.
-- =========================================================

begin;

alter table public.clientes add column if not exists nome_fantasia text;

commit;
