-- =========================================================
-- 364 — ATUALIZAÇÃO 26: SITUAÇÃO NOS CADASTROS
-- Clientes, fornecedores e produtos ganham `ativo`, para que um cadastro que
-- já tem movimento possa sair das listas de seleção sem ser apagado.
--
-- Excluir continua existindo para cadastro criado por engano, e continua
-- falhando quando há vínculo — é justamente esse caso que `ativo` resolve.
--
-- `materias_primas` já tinha a coluna e não é tocada aqui.
--
-- Aditiva e idempotente: rodar duas vezes não quebra nada, e todo registro
-- existente nasce ativo.
--
-- Rode depois de atualizacao_23_fornecedor_cnpj_normalizado.sql.
-- =========================================================

begin;

alter table public.clientes     add column if not exists ativo boolean not null default true;
alter table public.fornecedores add column if not exists ativo boolean not null default true;
alter table public.produtos     add column if not exists ativo boolean not null default true;

commit;
