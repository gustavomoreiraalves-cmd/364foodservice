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
--     responsável; depois disso não muda mais (exceto para cancelada, com
--     motivo).
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
-- E que nenhum item já lançado viola o check de pesos coerentes, senão a
-- constraint nova falha ao ser criada:
--   select id from defumacao_itens
--     where coalesce(peso_bruto_kg, 1) <= 0
--        or coalesce(perda_limpeza_kg, 0) < 0
--        or coalesce(sobra_kg, 0) < 0
--        or coalesce(peso_final_kg, 0) < 0
--        or (peso_bruto_kg is not null and peso_final_kg is not null and peso_final_kg > peso_bruto_kg);
-- Ambas as consultas precisam devolver zero linhas.

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

-- `security definer` não é conforto: como `invoker`, o `select status from
-- defumacoes` abaixo roda sujeito à policy `empresa_scoped_access` (atualização
-- 06). Um usuário de outra empresa não enxerga a ficha pai, o `not found` dá
-- verdadeiro, o trigger acha que é cascata de delete e libera a escrita — e a
-- FK `defumacao_id` não restringe por empresa. Como definer, a leitura enxerga
-- a ficha de verdade e a trava vale para todo mundo. A detecção de cascata
-- continua correta: naquele caso a linha sumiu mesmo.
--
-- A comparação usa `is distinct from` (não `<>`) de propósito: em SQL, `null
-- <> 'rascunho'` é `null`, não `true`, então um `<>` já deixaria a cascata
-- passar sozinho, sem depender do `if not found`. Com `is distinct from`, o
-- `if not found` deixa de ser redundante — é ele quem garante que a cascata
-- passa; sem ele, `v_status` ficaria nulo e a exceção dispararia.
create or replace function public.fn_defumacao_bloquear_edicao() returns trigger
language plpgsql security definer set search_path = public as $$
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
  if v_status is distinct from 'rascunho' then
    raise exception 'A ficha de defumação está % — os itens não podem ser alterados. Cancele com motivo e refaça.', v_status
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_defumacao_itens_bloquear_edicao on public.defumacao_itens;
create trigger trg_defumacao_itens_bloquear_edicao
  before insert or update or delete on public.defumacao_itens
  for each row execute function public.fn_defumacao_bloquear_edicao();

-- `security definer` pelo mesmo motivo: a checagem de "ficha sem item" lê
-- `defumacao_itens`, e como invoker a policy da tabela podia esconder as
-- linhas de quem escreve e deixar a trava passar.
--
-- Roda em `before insert or update` (não só `update`): sem cobrir o insert, um
-- `insert into defumacoes (..., status) values (..., 'finalizada')` nasceria
-- finalizado sem passar pela regra "ficha sem item não finaliza" — a regra só
-- existe no ramo de update no cabeçalho, e ela é aplicada aqui embaixo, fora
-- do bloco exclusivo de update, exatamente para valer nos dois casos.
create or replace function public.fn_defumacao_cabecalho() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.updated_at := clock_timestamp();

    if old.status = 'cancelada' and new.status is distinct from 'cancelada' then
      raise exception 'Ficha cancelada não volta para %.', new.status
        using errcode = 'check_violation';
    end if;

    -- De finalizada só se sai para cancelada (com motivo, via constraint
    -- `defumacoes_cancelamento_motivo`). Sem esta trava, `update defumacoes
    -- set status = 'rascunho'` numa ficha finalizada reabria ficha e itens
    -- por baixo da imutabilidade inteira.
    if old.status = 'finalizada'
       and new.status is distinct from 'finalizada'
       and new.status <> 'cancelada' then
      raise exception 'A ficha de defumação está finalizada — só pode virar cancelada, com motivo.'
        using errcode = 'check_violation';
    end if;

    -- `lote` é o número da ficha impressa e a base do rastro: não pode mudar
    -- depois que a ficha sai de rascunho, no mesmo nível dos campos de
    -- processo.
    if old.status <> 'rascunho'
       and (new.lote is distinct from old.lote
            or new.obs is distinct from old.obs
            or new.data is distinct from old.data
            or new.hora_inicio is distinct from old.hora_inicio
            or new.hora_fim is distinct from old.hora_fim
            or new.temperatura_c is distinct from old.temperatura_c
            or new.responsavel_id is distinct from old.responsavel_id) then
      raise exception 'A ficha de defumação está % — o cabeçalho não pode ser alterado.', old.status
        using errcode = 'check_violation';
    end if;
  end if;

  -- A data do cancelamento vem do relógio do banco, não do navegador — mesmo
  -- raciocínio de `cancelado_em` na atualização 27 (pedidos): o cliente
  -- mandaria `new Date().toISOString()`, que é o relógio da máquina do
  -- operador e pode estar em qualquer hora.
  --
  -- Fora do bloco exclusivo de update, pelo mesmo motivo da checagem de item
  -- logo abaixo: um `insert into defumacoes (..., status) values (...,
  -- 'cancelada')` é caminho alcançável (o cenário 9 já cobre insert direto
  -- com status arbitrário) e também precisa nascer com a data carimbada pelo
  -- banco, não em branco.
  if new.status = 'cancelada' and (tg_op = 'INSERT' or old.status is distinct from 'cancelada') then
    new.cancelada_em := clock_timestamp();
  end if;

  if new.status = 'finalizada'
     and not exists (select 1 from public.defumacao_itens where defumacao_id = new.id) then
    raise exception 'Ficha sem nenhuma matéria-prima lançada não pode ser finalizada.'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists trg_defumacoes_cabecalho on public.defumacoes;
create trigger trg_defumacoes_cabecalho
  before insert or update on public.defumacoes
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
--
-- -- `lote` é coluna anterior a esta migração; só o comentário que ela ganhou
-- -- volta a nulo, a coluna em si fica.
-- comment on column public.defumacoes.lote is null;
--
-- alter table public.defumacoes
--   drop column if exists status,
--   drop column if exists cancelada_motivo,
--   drop column if exists cancelada_em,
--   drop column if exists cancelada_por_id,
--   drop column if exists updated_at;
--
-- commit;
