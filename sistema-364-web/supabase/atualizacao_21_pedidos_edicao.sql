-- Edição de pedido de venda: colunas de cancelamento e travas de imutabilidade.
--
-- Até aqui o pedido lançado só podia ser excluído, e o `delete` levava os itens
-- junto por cascata, sem deixar motivo nem autor. A tela passa a editar pedido
-- em `Pendente` e a cancelar com motivo no lugar de excluir; estas regras valem
-- no banco para que continuem valendo quando alguém escrever por fora da tela.
--
-- `vw_estoque_produto` já ignora pedido `Cancelado` no saldo, então cancelar
-- devolve estoque sem nenhuma mudança de view.
--
-- Idempotente: `add column if not exists`, `drop constraint if exists` e
-- `drop trigger if exists` antes de cada criação. Não altera dados existentes.
-- O rollback está comentado no fim do arquivo.
--
-- Antes de aplicar em produção, confira que nenhuma linha viola os novos checks:
--   select count(*) from pedido_itens where quantidade <= 0 or preco_unitario < 0;
--   select count(*) from pedidos where status = 'Cancelado';
-- A primeira precisa dar 0. Se a segunda for maior que 0, os cancelados antigos
-- não têm motivo: preencha com 'Cancelado antes da atualização 21' antes de
-- criar a constraint.

begin;

-- ---------- COLUNAS ----------

alter table public.pedidos
  add column if not exists observacoes text,
  add column if not exists cancelado_motivo text,
  add column if not exists cancelado_em timestamptz,
  add column if not exists cancelado_por_id uuid references public.funcionarios(id),
  add column if not exists updated_at timestamptz not null default now();

comment on column public.pedidos.cancelado_motivo is
  'Motivo do cancelamento. Obrigatório quando status = Cancelado.';

-- ---------- CHECKS ----------

alter table public.pedidos drop constraint if exists pedidos_cancelamento_motivo;
alter table public.pedidos add constraint pedidos_cancelamento_motivo
  check (status <> 'Cancelado' or (cancelado_motivo is not null and btrim(cancelado_motivo) <> ''));

alter table public.pedido_itens drop constraint if exists pedido_itens_quantidade_positiva;
alter table public.pedido_itens add constraint pedido_itens_quantidade_positiva
  check (quantidade > 0);

alter table public.pedido_itens drop constraint if exists pedido_itens_preco_nao_negativo;
alter table public.pedido_itens add constraint pedido_itens_preco_nao_negativo
  check (preco_unitario >= 0);

-- ---------- ITENS: só mudam com o pedido Pendente ----------

create or replace function public.fn_pedido_bloquear_edicao() returns trigger
language plpgsql as $$
declare
  v_pedido uuid;
  v_status text;
begin
  v_pedido := coalesce(new.pedido_id, old.pedido_id);
  select status into v_status from public.pedidos where id = v_pedido;
  -- Pedido já apagado: é a cascata do `on delete cascade`, deixa passar.
  if not found then
    return coalesce(new, old);
  end if;
  if v_status is distinct from 'Pendente' then
    raise exception 'Pedido % está % — os itens não podem ser alterados. Cancele o pedido com motivo e lance outro.', v_pedido, v_status
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_pedido_itens_bloquear_edicao on public.pedido_itens;
create trigger trg_pedido_itens_bloquear_edicao
  before insert or update or delete on public.pedido_itens
  for each row execute function public.fn_pedido_bloquear_edicao();

-- ---------- CABEÇALHO: cliente e data travados, status livre ----------

create or replace function public.fn_pedido_bloquear_cabecalho() returns trigger
language plpgsql as $$
begin
  -- `now()` fica parado no horário de início da transação; como todo o
  -- cenário de teste (e uma edição real) roda numa única transação, usar
  -- `now()` aqui nunca avançaria o timestamp. `clock_timestamp()` lê o
  -- relógio de verdade a cada chamada.
  new.updated_at := clock_timestamp();

  if old.status = 'Cancelado' and new.status is distinct from 'Cancelado' then
    raise exception 'Pedido cancelado não volta para %.', new.status
      using errcode = 'check_violation';
  end if;

  if old.status is distinct from 'Pendente'
     and (new.cliente_id is distinct from old.cliente_id or new.data is distinct from old.data) then
    raise exception 'Pedido % está % — cliente e data não podem ser alterados.', old.id, old.status
      using errcode = 'check_violation';
  end if;

  if old.status = 'Pendente' and new.status is distinct from 'Pendente'
     and not exists (select 1 from public.pedido_itens where pedido_id = new.id) then
    raise exception 'Pedido sem itens não pode sair de Pendente.'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists trg_pedidos_bloquear_cabecalho on public.pedidos;
create trigger trg_pedidos_bloquear_cabecalho
  before update on public.pedidos
  for each row execute function public.fn_pedido_bloquear_cabecalho();

commit;

-- ---------- ROLLBACK ----------
-- begin;
--
-- drop trigger if exists trg_pedido_itens_bloquear_edicao on public.pedido_itens;
-- drop trigger if exists trg_pedidos_bloquear_cabecalho on public.pedidos;
-- drop function if exists public.fn_pedido_bloquear_edicao();
-- drop function if exists public.fn_pedido_bloquear_cabecalho();
--
-- alter table public.pedido_itens drop constraint if exists pedido_itens_quantidade_positiva;
-- alter table public.pedido_itens drop constraint if exists pedido_itens_preco_nao_negativo;
-- alter table public.pedidos drop constraint if exists pedidos_cancelamento_motivo;
--
-- -- As colunas são novas; derrubá-las devolve o schema anterior e descarta
-- -- apenas motivo, autor e data de cancelamento gravados depois da migração.
-- alter table public.pedidos
--   drop column if exists observacoes,
--   drop column if exists cancelado_motivo,
--   drop column if exists cancelado_em,
--   drop column if exists cancelado_por_id,
--   drop column if exists updated_at;
--
-- commit;
