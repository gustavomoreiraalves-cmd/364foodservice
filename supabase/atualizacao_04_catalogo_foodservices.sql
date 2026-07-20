-- =========================================================
-- ATUALIZAÇÃO 04 — Catálogo 364 Foodservices (10 SKUs)
-- Fonte: FICHA TECNICA FOOD SERVICE.xlsx (18/07/2026), preços de VAREJO.
-- Idempotente: produtos já existentes (mesmo código) não são alterados.
-- Rode no SQL Editor do Supabase.
-- =========================================================

insert into produtos (codigo, nome, categoria, unidade, preco_venda, validade_dias) values
  ('0364-001', 'Costela Defumada 500g',        'Defumados',       'un', 58.50, 90),
  ('0364-002', 'Costela Desfiada 500g',        'Defumados',       'un', 65.00, 90),
  ('0364-003', 'Costelinha BBQ 500g',          'Defumados',       'un', 58.50, 90),
  ('0364-004', 'Cupim Defumado 500g',          'Defumados',       'un', 65.00, 90),
  ('0364-005', 'Torresmo de Rolo 500g',        'Defumados',       'un', 45.50, 90),
  ('0364-006', 'Hambúrguer de Costela 140g',   'Derivados',       'un', 52.00, 90),
  ('0364-007', 'Escondidinho de Costela',      'Derivados',       'un', 52.00, 90),
  ('0364-008', 'Croquete de Costela 500g',     'Derivados',       'un', 52.00, 90),
  ('0364-009', 'Farofa Crocante 500g',         'Acompanhamentos', 'un', 22.90, 180),
  ('0364-010', 'Geleia de Abacaxi Picante',    'Acompanhamentos', 'un', 24.90, 180)
on conflict (codigo) do nothing;

-- Observações (Conselho 364):
-- - Preço da Farofa (R$ 22,90) é sugestão da CFO — a planilha estava sem preço definido.
-- - Preços de ATACADO ficam na tabela B2B (por cliente), não no catálogo:
--   001: 45,00 · 002: 50,00 · 003: 45,00 · 004: 50,00 · 005: 35,00 · 006: 40,00 · 007: 40,00 · 008: 40,00
-- - Depois de rodar, cadastre a ficha técnica de cada produto na aba Produtos
--   e defina o preço-alvo da costela (R$ 20/kg) na matéria-prima.
