-- =========================================================
-- Atualização 41 — Endereço em fornecedores
--
-- Fornecedores nunca teve colunas de endereço — só clientes tinha (bloco
-- fiscal da atualização 36). Como um parceiro pode ser cliente e fornecedor
-- ao mesmo tempo (atualização 39) e o endereço é da empresa, não do papel,
-- os dois lados precisam poder guardar o mesmo endereço.
--
-- Mesmos tipos de coluna que public.clientes usa pros mesmos campos.
--
-- Aditiva e idempotente: rodar duas vezes não quebra nada.
-- =========================================================

begin;

alter table public.fornecedores add column if not exists logradouro text;
alter table public.fornecedores add column if not exists numero text;
alter table public.fornecedores add column if not exists complemento text;
alter table public.fornecedores add column if not exists bairro text;
alter table public.fornecedores add column if not exists codigo_municipio_ibge char(7);
alter table public.fornecedores add column if not exists municipio text;
alter table public.fornecedores add column if not exists uf char(2);
alter table public.fornecedores add column if not exists cep char(8);

commit;
