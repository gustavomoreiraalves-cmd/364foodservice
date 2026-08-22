-- Fase 2 do controle de lote: a ficha de defumação sai do papel.
--
-- As tabelas `defumacoes` e `defumacao_itens` já existem desde a atualização 08
-- e foram modeladas quase campo a campo a partir da ficha impressa (hora de
-- início, hora de fim, temperatura, peso bruto, perda na limpeza, sobra e peso
-- defumado). Nunca ganharam tela: até aqui a ficha era preenchida à mão.
--
-- Falta o que liga a ficha ao lote e o que a torna confiável:
--   • `defumacao_itens.recebimento_item_id` — o lote de matéria-prima que
--     entrou. É o elo entre a Fase 1 (recebimento) e a Fase 3 (embalagem).
--   • `defumacoes.status` — a ficha nasce em rascunho e é finalizada pelo
--     responsável; depois disso não muda mais.
--
-- `defumacoes.lote` passa a ser o NÚMERO DA FICHA (DEF-AAMMDD-###), não o lote
-- rastreável: uma ficha pode conter vários lotes, um por item. O lote
-- rastreável mora em `defumacao_itens.recebimento_item_id`.
--
-- Idempotente: `add column if not exists`, `drop constraint if exists` e
-- `create or replace`. Fichas já lançadas nascem em `rascunho` e com
-- `recebimento_item_id` nulo — nulo significa "ficha anterior à rastreabilidade".
--
-- Antes de aplicar, confira que não há número de ficha repetido na mesma
-- empresa, senão a constraint de unicidade falha:
--   select empresa_id, lote, count(*) from defumacoes group by 1,2 having count(*) > 1;

begin;

-- ---------- CABEÇALHO DA FICHA ----------

alter table public.defumacoes
  add column if not exists status text not null default 'rascunho',
  add column if not exists cancelada_motivo text,
  add column if not exists cancelada_em timestamptz,
  add column if not exists cancelada_por_id uuid references public.funcionarios(id),
  add column if not exists updated_at timestamptz not null default now();

alter table public.defumacoes drop constraint if exists defumacoes_status_valido;
alter table public.defumacoes add constraint defumacoes_status_valido
  check (status in ('rascunho', 'finalizada', 'cancelada'));

alter table public.defumacoes drop constraint if exists defumacoes_cancelamento_motivo;
alter table public.defumacoes add constraint defumacoes_cancelamento_motivo
  check (status <> 'cancelada' or (cancelada_motivo is not null and btrim(cancelada_motivo) <> ''));

-- O número da ficha é único dentro da empresa. Sem isso, duas fichas do mesmo
-- dia podem receber o mesmo número e o rastro fica ambíguo.
alter table public.defumacoes drop constraint if exists defumacoes_lote_unico_por_empresa;
alter table public.defumacoes add constraint defumacoes_lote_unico_por_empresa
  unique (empresa_id, lote);

comment on column public.defumacoes.lote is
  'Número da ficha de defumação (DEF-AAMMDD-###). O lote rastreável fica em defumacao_itens.recebimento_item_id.';

-- ---------- ITENS: o lote que entrou ----------

alter table public.defumacao_itens
  add column if not exists recebimento_item_id uuid references public.recebimento_itens(id);

create index if not exists defumacao_itens_recebimento_item_idx
  on public.defumacao_itens (recebimento_item_id);

comment on column public.defumacao_itens.recebimento_item_id is
  'Lote de matéria-prima que entrou nesta defumação. Nulo = ficha anterior à atualização 29.';

alter table public.defumacao_itens drop constraint if exists defumacao_itens_pesos_coerentes;
alter table public.defumacao_itens add constraint defumacao_itens_pesos_coerentes
  check (
    (peso_bruto_kg is null or peso_bruto_kg > 0)
    and (perda_limpeza_kg is null or perda_limpeza_kg >= 0)
    and (sobra_kg is null or sobra_kg >= 0)
    and (peso_final_kg is null or peso_final_kg >= 0)
    -- O peso defumado nunca supera o peso bruto que entrou.
    and (peso_final_kg is null or peso_bruto_kg is null or peso_final_kg <= peso_bruto_kg)
  );

-- ---------- IMUTABILIDADE ----------
-- Mesmo padrão da atualização 27 (pedidos): ficha finalizada não muda mais;
-- correção exige cancelar com motivo e refazer.

create or replace function public.fn_defumacao_bloquear_edicao() returns trigger
language plpgsql as $$
declare
  v_ficha uuid;
  v_status text;
begin
  v_ficha := coalesce(new.defumacao_id, old.defumacao_id);
  select status into v_status from public.defumacoes where id = v_ficha;
  -- Ficha já apagada: é a cascata do `on delete cascade`, deixa passar.
  if not found then
    return coalesce(new, old);
  end if;
  if v_status <> 'rascunho' then
    raise exception 'A ficha de defumação está % — os itens não podem ser alterados. Cancele com motivo e refaça.', v_status
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_defumacao_itens_bloquear_edicao on public.defumacao_itens;
create trigger trg_defumacao_itens_bloquear_edicao
  before insert or update or delete on public.defumacao_itens
  for each row execute function public.fn_defumacao_bloquear_edicao();

create or replace function public.fn_defumacao_cabecalho() returns trigger
language plpgsql as $$
begin
  new.updated_at := clock_timestamp();

  if old.status = 'cancelada' and new.status is distinct from 'cancelada' then
    raise exception 'Ficha cancelada não volta para %.', new.status
      using errcode = 'check_violation';
  end if;

  if old.status <> 'rascunho'
     and (new.data is distinct from old.data
          or new.hora_inicio is distinct from old.hora_inicio
          or new.hora_fim is distinct from old.hora_fim
          or new.temperatura_c is distinct from old.temperatura_c
          or new.responsavel_id is distinct from old.responsavel_id) then
    raise exception 'A ficha de defumação está % — o cabeçalho não pode ser alterado.', old.status
      using errcode = 'check_violation';
  end if;

  if old.status = 'rascunho' and new.status = 'finalizada'
     and not exists (select 1 from public.defumacao_itens where defumacao_id = new.id) then
    raise exception 'Ficha sem nenhuma matéria-prima lançada não pode ser finalizada.'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists trg_defumacoes_cabecalho on public.defumacoes;
create trigger trg_defumacoes_cabecalho
  before update on public.defumacoes
  for each row execute function public.fn_defumacao_cabecalho();

commit;

-- ---------- ROLLBACK ----------
-- Derruba o que a migração criou. Nenhum dado de processo é perdido: as
-- colunas de peso e de horário são anteriores a esta migração.
--
-- begin;
--
-- drop trigger if exists trg_defumacao_itens_bloquear_edicao on public.defumacao_itens;
-- drop trigger if exists trg_defumacoes_cabecalho on public.defumacoes;
-- drop function if exists public.fn_defumacao_bloquear_edicao();
-- drop function if exists public.fn_defumacao_cabecalho();
--
-- alter table public.defumacao_itens drop constraint if exists defumacao_itens_pesos_coerentes;
-- drop index if exists public.defumacao_itens_recebimento_item_idx;
-- alter table public.defumacao_itens drop column if exists recebimento_item_id;
--
-- alter table public.defumacoes drop constraint if exists defumacoes_lote_unico_por_empresa;
-- alter table public.defumacoes drop constraint if exists defumacoes_cancelamento_motivo;
-- alter table public.defumacoes drop constraint if exists defumacoes_status_valido;
-- alter table public.defumacoes
--   drop column if exists status,
--   drop column if exists cancelada_motivo,
--   drop column if exists cancelada_em,
--   drop column if exists cancelada_por_id,
--   drop column if exists updated_at;
--
-- commit;
