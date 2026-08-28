-- =========================================================
-- Atualização 46 — Cadastro de produtos vindo do PDV Consumer
--
-- O cadastro do 364 OS tem 11 produtos e 7 matérias-primas digitados à mão,
-- enquanto o PDV Consumer tem 699 produtos em uso desde 2022, com preço,
-- custo, categoria e — o que não se esperava — NCM, CEST e origem.
-- Esta migração abre o caminho para a carga: uma chave de casamento e um
-- retrato do que a importação gravou.
--
-- `pdv_codigo_produto` guarda PRODUTOS.CODIGO do Consumer. Não se usa
-- `produtos.codigo` para isso: aquele é humano (0364-001, STK-001) e vira o
-- cProd da NF-e.
--
-- `pdv_valores` é o árbitro de "alguém mexeu aqui?". A importação seguinte só
-- atualiza um campo se o valor atual ainda for igual ao que ela mesma gravou
-- da última vez. Sem isso, a carga desfaria correção feita à mão.
--
-- O unique é parcial porque as 18 linhas de hoje foram digitadas à mão e
-- ficam com a coluna nula. De quebra, é a primeira constraint unique que
-- materias_primas ganha — é por não ter nenhuma que "Costela Suina" e
-- "Costela Suína" convivem lá.
--
-- Rode depois de atualizacao_45_contas_bancarias_grupo.sql. Idempotente.
--
-- ATENÇÃO à numeração: o branch feat/cadastro-produtos-ux carrega um
-- atualizacao_38_cabecalho_produto.sql que colide com o
-- atualizacao_38_cliente_nome_fantasia.sql já em main. Aquele deve ser
-- renumerado para 47 no merge, não este para 47.
-- =========================================================
begin;

alter table public.produtos
  add column if not exists pdv_codigo_produto int,
  add column if not exists pdv_valores jsonb,
  add column if not exists pdv_importado_em timestamptz;

alter table public.materias_primas
  add column if not exists pdv_codigo_produto int,
  add column if not exists pdv_valores jsonb,
  add column if not exists pdv_importado_em timestamptz;

comment on column public.produtos.pdv_codigo_produto is
  'PRODUTOS.CODIGO do PDV Consumer. Chave de casamento da importação e o que liga pdv_vendas_itens_dia.codigo_produto a este produto. Nulo em cadastro feito à mão.';
comment on column public.produtos.pdv_valores is
  'Retrato do que a última importação gravou, campo a campo. Um campo só é atualizado na rodada seguinte se o valor atual ainda for igual ao daqui — é assim que edição humana não é sobrescrita.';
comment on column public.materias_primas.pdv_codigo_produto is
  'PRODUTOS.CODIGO do PDV Consumer, para insumos (PRODUTOTIPO 2). Nulo em cadastro feito à mão.';
comment on column public.materias_primas.pdv_valores is
  'Mesmo papel de produtos.pdv_valores: retrato do que a última importação gravou.';

create unique index if not exists produtos_pdv_codigo_key
  on public.produtos(empresa_id, pdv_codigo_produto)
  where pdv_codigo_produto is not null;

create unique index if not exists materias_primas_pdv_codigo_key
  on public.materias_primas(empresa_id, pdv_codigo_produto)
  where pdv_codigo_produto is not null;

-- Serve o join com as vendas: pdv_vendas_itens_dia.codigo_produto -> produto.
create index if not exists produtos_pdv_codigo_idx
  on public.produtos(pdv_codigo_produto)
  where pdv_codigo_produto is not null;

commit;

-- ---------- ROLLBACK ----------
-- begin;
-- drop index if exists public.produtos_pdv_codigo_idx;
-- drop index if exists public.materias_primas_pdv_codigo_key;
-- drop index if exists public.produtos_pdv_codigo_key;
-- alter table public.materias_primas
--   drop column if exists pdv_importado_em,
--   drop column if exists pdv_valores,
--   drop column if exists pdv_codigo_produto;
-- alter table public.produtos
--   drop column if exists pdv_importado_em,
--   drop column if exists pdv_valores,
--   drop column if exists pdv_codigo_produto;
-- commit;
