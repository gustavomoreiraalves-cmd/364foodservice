-- =========================================================
-- ICMS-ST no congelamento do item da NF-e de saída.
--
-- nfe_saida_itens guarda o que o motor de regras decidiu em cada emissão: a
-- regra muda depois, a nota já emitida não muda junto. Só que a tabela nasceu
-- (atualização 43) sem nenhuma coluna de substituição tributária, porque o
-- motor ainda não emitia ST.
--
-- Desde 28/08/2026 emite: a NF-e nº 2, série 3, chave
-- 11260837541736000187550030000000021541041714, foi autorizada com
-- ICMSSN202, base de ST 76,05 e ICMS-ST 3,42. Esses valores existiam só
-- dentro do XML — qualquer relatório de ST recolhida teria de abrir arquivo
-- por arquivo.
--
-- Rode depois de atualizacao_47_solicitacao_importacao_pdv.sql. Idempotente.
-- Rollback comentado no fim.
-- =========================================================
begin;

alter table public.nfe_saida_itens
  -- Modalidade da base de cálculo da ST (tabela do leiaute: 4 = margem de
  -- valor agregado, 5 = pauta, 6 = valor da operação...). Texto, como as
  -- outras colunas de código deste bloco (csosn, cfop, cst_icms).
  add column if not exists modalidade_bc_st text,

  -- Margem e redução ficam NULL quando a regra não as tinha. A distinção
  -- importa: no XML pMVAST e pRedBCST são opcionais, e omitir é dizer "não se
  -- aplica" enquanto mandar zero declara margem ou redução de 0%. Um default
  -- 0 aqui apagaria a diferença que o serializador faz questão de preservar.
  add column if not exists mva_percentual numeric(7,4),
  add column if not exists reducao_base_st_percentual numeric(7,4),

  -- Valores, com o mesmo formato das colunas de ICMS próprio já existentes.
  -- Estes têm default 0 porque item sem ST tem ST zero — não é ausência de
  -- informação, é a informação.
  add column if not exists base_calculo_icms_st numeric(12,2) not null default 0,
  add column if not exists aliquota_icms_st numeric(7,4) not null default 0,
  add column if not exists valor_icms_st numeric(12,2) not null default 0;

comment on column public.nfe_saida_itens.modalidade_bc_st is
  'modBCST do leiaute 4.00 — como a base de ST foi determinada.';
comment on column public.nfe_saida_itens.mva_percentual is
  'pMVAST. NULL quando a regra não informou (omitido no XML), 0 quando informou zero.';
comment on column public.nfe_saida_itens.reducao_base_st_percentual is
  'pRedBCST. Mesma distinção entre NULL e zero do mva_percentual.';
comment on column public.nfe_saida_itens.base_calculo_icms_st is 'vBCST do item.';
comment on column public.nfe_saida_itens.aliquota_icms_st is
  'pICMSST — a alíquota interna do destino aplicada sobre a base de ST.';
comment on column public.nfe_saida_itens.valor_icms_st is 'vICMSST do item.';

-- Índice para o relatório que motivou estas colunas: quanto de ICMS-ST foi
-- recolhido num período. Parcial porque a esmagadora maioria dos itens não
-- tem ST, e varrer todos para somar zeros é desperdício.
create index if not exists nfe_saida_itens_com_st_idx
  on public.nfe_saida_itens (nfe_saida_documento_id)
  where valor_icms_st > 0;

commit;

-- As notas emitidas ANTES desta atualização ficam com 0 nas colunas novas.
-- Hoje é uma só, a nº 2 da série 3, em homologação e sem valor fiscal — os
-- valores reais dela estão no nfeProc guardado no Storage. Não vale um UPDATE
-- costurado à mão numa migração; se um dia precisar, a fonte é o XML.

-- Rollback:
-- begin;
-- drop index if exists public.nfe_saida_itens_com_st_idx;
-- alter table public.nfe_saida_itens
--   drop column if exists modalidade_bc_st,
--   drop column if exists mva_percentual,
--   drop column if exists reducao_base_st_percentual,
--   drop column if exists base_calculo_icms_st,
--   drop column if exists aliquota_icms_st,
--   drop column if exists valor_icms_st;
-- commit;
