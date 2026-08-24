-- =========================================================
-- Atualização 34 — margem e participação com faixa larga
--
-- A primeira carga real do backup derrubou a rodada com "numeric field
-- overflow": item vendido por centavos com custo cheio (brinde/ajuste) gera
-- margem tipo -449.900%, que não cabe em numeric(8,4) (máx. ±9.999,9999).
-- O número é feio mas é o que está no PDV; alargar a coluna preserva o dado
-- e a tela continua exibindo normalmente.
--
-- Rode depois de atualizacao_33_pdv_backup.sql. Idempotente (alter para o
-- mesmo tipo é no-op re-aplicável).
-- =========================================================
begin;

alter table public.pdv_vendas_itens_dia
  alter column margem type numeric(12,4),
  alter column participacao_lucro type numeric(12,4);

commit;

-- ---------- ROLLBACK ----------
-- (volta ao tipo estreito; falha se houver valor fora da faixa — apague-os antes)
-- begin;
-- alter table public.pdv_vendas_itens_dia
--   alter column margem type numeric(8,4),
--   alter column participacao_lucro type numeric(8,4);
-- commit;
