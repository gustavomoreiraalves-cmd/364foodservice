-- supabase/atualizacao_54_categoria_conta_recebimento.sql
-- Categoria de custo (Fixo/Direto/Variável/Investimento) por item de recebimento,
-- para o DRE separar compras de matéria-prima por natureza do custo.
-- Mesmo enum de contas_a_pagar.categoria_conta (ver atualizacao_16).

begin;

alter table public.materias_primas
  add column if not exists categoria_conta_padrao text;

alter table public.materias_primas
  drop constraint if exists materias_primas_categoria_conta_padrao_valida;
alter table public.materias_primas
  add constraint materias_primas_categoria_conta_padrao_valida
  check (categoria_conta_padrao is null or categoria_conta_padrao in
    ('Custos Fixos', 'Custos Diretos', 'Custos Variáveis', 'Investimentos'));

alter table public.recebimento_itens
  add column if not exists categoria_conta text not null default 'Custos Diretos';

alter table public.recebimento_itens
  drop constraint if exists recebimento_itens_categoria_conta_valida;
alter table public.recebimento_itens
  add constraint recebimento_itens_categoria_conta_valida
  check (categoria_conta in
    ('Custos Fixos', 'Custos Diretos', 'Custos Variáveis', 'Investimentos'));

commit;
