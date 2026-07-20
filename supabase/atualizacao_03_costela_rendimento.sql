-- =========================================================
-- ATUALIZAÇÃO 03 — Política da costela (Conselho 364, 18/07/2026)
-- Rendimento real por lote de produção + preço-alvo de compra.
-- Rode no SQL Editor do Supabase APÓS o schema.sql.
-- =========================================================

-- Rendimento de defumação por lote: peso cru realmente usado e peso final obtido.
-- (O consumo teórico da ficha técnica continua fazendo a baixa de estoque;
--  estes campos medem a realidade para acompanhar o rendimento — alerta < 40% na tela.)
alter table producoes add column if not exists peso_bruto_kg numeric(12,4);
alter table producoes add column if not exists peso_final_kg numeric(12,4);

-- Preço-alvo de compra por matéria-prima (gatilho de oportunidade).
-- Ex.: costela com preco_alvo = 20.00 → recebimento a até R$ 20/kg mostra
-- "bom momento para estocar" na tela de Recebimento.
alter table materias_primas add column if not exists preco_alvo numeric(12,2);
