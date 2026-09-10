-- =========================================================
-- Crédito de ICMS do Simples Nacional (CSOSN 101) no congelamento do item.
--
-- CSOSN 101 tem grupo próprio no leiaute 4.00 (ICMSSN101), com pCredSN
-- (percentual de crédito) e vCredICMSSN (valor do crédito) obrigatórios — o
-- serializador (lib/nfe/montarXml.js) recusava todo item com este CSOSN
-- porque não havia de onde tirar o percentual: ele muda todo mês com o RBT12
-- (art. 60 da Resolução CGSN 140/2018) e não pode ser fixado em cadastro.
--
-- A atualização 36 já criou parametros_simples_nacional para guardar esse
-- percentual mês a mês; esta atualização só acrescenta onde congelar o que
-- foi calculado na emissão, no mesmo padrão da 48 (ICMS-ST): a regra muda
-- depois, a nota já emitida não muda junto.
--
-- Rode depois de atualizacao_48_nfe_itens_st.sql. Idempotente.
-- Rollback comentado no fim.
-- =========================================================
begin;

alter table public.nfe_saida_itens
  add column if not exists percentual_credito_icms_sn numeric(6,4),
  add column if not exists valor_credito_icms_sn numeric(12,2) not null default 0;

comment on column public.nfe_saida_itens.percentual_credito_icms_sn is
  'pCredSN do grupo ICMSSN101 — percentual de crédito do mês, lido de parametros_simples_nacional na competência da nota. NULL para item sem CSOSN 101.';
comment on column public.nfe_saida_itens.valor_credito_icms_sn is
  'vCredICMSSN do grupo ICMSSN101 — vProd do item * percentual_credito_icms_sn. Zero para item sem CSOSN 101 (mesmo padrão de valor_icms_st).';

commit;

-- Rollback:
-- begin;
-- alter table public.nfe_saida_itens
--   drop column if exists percentual_credito_icms_sn,
--   drop column if exists valor_credito_icms_sn;
-- commit;
