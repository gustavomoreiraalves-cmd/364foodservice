-- =========================================================
-- Simplifica o cadastro de parametros_simples_nacional.
--
-- A atualização 36 pedia anexo, RBT12, alíquota nominal e distribuição de
-- ICMS pra calcular pCredSN pela fórmula do art. 60 da Resolução CGSN
-- 140/2018. Na prática o contador já manda o percentual pronto todo mês —
-- pedir os insumos da fórmula era trabalho redundante. Agora só entram
-- competência e aliquota_credito_icms; os demais campos ficam opcionais
-- (mantidos pra não perder o que já foi registrado) e a unicidade não
-- depende mais de anexo.
--
-- Idempotente. Rollback comentado no fim.
-- =========================================================
begin;

alter table public.parametros_simples_nacional
  alter column anexo drop not null,
  alter column rbt12 drop not null,
  alter column aliquota_nominal drop not null;

alter table public.parametros_simples_nacional
  drop constraint if exists parametros_simples_nacional_empregador_id_competencia_anexo_key;
alter table public.parametros_simples_nacional
  add constraint parametros_simples_nacional_empregador_id_competencia_key
  unique (empregador_id, competencia);

comment on column public.parametros_simples_nacional.aliquota_credito_icms is
  'pCredSN da competência, informado direto pelo contador. anexo/rbt12/aliquota_nominal/parcela_deduzir/percentual_distribuicao_icms ficaram opcionais (atualização 59) — não são mais exigidos no cadastro.';

commit;

-- Rollback:
-- begin;
-- alter table public.parametros_simples_nacional
--   drop constraint if exists parametros_simples_nacional_empregador_id_competencia_key;
-- alter table public.parametros_simples_nacional
--   add constraint parametros_simples_nacional_empregador_id_competencia_anexo_key
--   unique (empregador_id, competencia, anexo);
-- alter table public.parametros_simples_nacional
--   alter column anexo set not null,
--   alter column rbt12 set not null,
--   alter column aliquota_nominal set not null;
-- commit;
