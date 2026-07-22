-- =========================================================
-- 364 — ATUALIZAÇÃO 14: RECEBIMENTO MULTI-ITEM + DEPÓSITO REAL
-- Etapa 2.1 do plano de Suprimentos.
--
-- Até aqui `app/recebimentos` gravava 1 item por submit (1 nota = N envios
-- separados) e `local_armazenamento` era texto livre sem ligação com a
-- tabela `depositos` criada na Etapa 1. Esta migração:
-- 1. Liga cada item de recebimento a um depósito real (`deposito_id`).
--    `local_armazenamento` é mantido como complemento (endereço/posição
--    específica dentro do depósito, ex.: "Prateleira 3"), não como
--    substituto — os dois campos coexistem (ver seção 6 do comando).
-- 2. Move `temperatura_c` para o nível do item: a exigência de temperatura
--    é por item (`materias_primas.exige_temperatura`, Etapa 1), então uma
--    mesma nota pode ter itens que precisam de temperatura e itens que não
--    precisam — a coluna em `recebimentos` (cabeçalho) não representava
--    isso corretamente. A coluna antiga em `recebimentos` fica órfã por
--    ora (será removida na Etapa 2.2, quando a qualidade virar entidade
--    própria) — não migramos os 2 valores já gravados nela por serem
--    poucos e de baixo valor histórico (câmera de temperatura de nota,
--    não de item).
-- 3. Adiciona `observacoes` por item (previsto na seção 6, ainda não existia).
--
-- Rode depois de atualizacao_13_rls_permissao_modulo.sql.
-- Idempotente.
-- =========================================================

alter table recebimento_itens add column if not exists deposito_id uuid references depositos(id);
alter table recebimento_itens add column if not exists temperatura_c numeric(5,2);
alter table recebimento_itens add column if not exists observacoes text;

create index if not exists idx_recebimento_itens_deposito on recebimento_itens(deposito_id);
