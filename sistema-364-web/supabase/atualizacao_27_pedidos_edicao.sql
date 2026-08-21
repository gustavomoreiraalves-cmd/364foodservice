-- Edição de pedido de venda: colunas de cancelamento e reabertura, e travas de
-- imutabilidade.
--
-- Até aqui o pedido lançado só podia ser excluído, e o `delete` levava os itens
-- junto por cascata, sem deixar motivo nem autor. A tela passa a editar pedido
-- em `Pendente` e a cancelar com motivo no lugar de excluir; estas regras valem
-- no banco para que continuem valendo quando alguém escrever por fora da tela.
--
-- Voltar de `Faturado` ou `Enviado` para `Pendente` também exige motivo: reabrir
-- devolve a edição de itens e preços, então um clique sem motivo e sem autor
-- esvaziava as travas de imutabilidade inteiras.
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
--   select count(*) from pedidos p where not exists (select 1 from pedido_itens where pedido_id = p.id);
-- A primeira precisa dar 0. Se a segunda for maior que 0, os cancelados antigos
-- não têm motivo: preencha com 'Cancelado antes da atualização 27' antes de
-- criar a constraint. A terceira conta os pedidos vazios que já existem: eles
-- continuam podendo ser cancelados, mas não vão mais poder ser faturados sem
-- ganhar um item antes.

begin;

-- ---------- COLUNAS ----------

alter table public.pedidos
  add column if not exists observacoes text,
  add column if not exists cancelado_motivo text,
  add column if not exists cancelado_em timestamptz,
  add column if not exists cancelado_por_id uuid references public.funcionarios(id),
  add column if not exists reaberto_motivo text,
  add column if not exists reaberto_em timestamptz,
  add column if not exists reaberto_por_id uuid references public.funcionarios(id),
  add column if not exists updated_at timestamptz not null default now();

comment on column public.pedidos.cancelado_motivo is
  'Motivo do cancelamento. Obrigatório quando status = Cancelado.';

comment on column public.pedidos.reaberto_motivo is
  'Motivo da última reabertura. Obrigatório para voltar de Faturado ou Enviado para Pendente.';

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

-- `security definer` não é conforto: como `invoker`, o `select status from
-- pedidos` abaixo roda sujeito à policy `empresa_scoped_access`. Um usuário de
-- outra empresa não enxerga o pedido pai, o `not found` dá verdadeiro, o
-- trigger acha que é cascata de delete e libera a escrita — e a policy de
-- `pedido_itens` só confere o `empresa_id` da própria linha. Como definer, a
-- leitura enxerga o pedido de verdade e a trava vale para todo mundo. A
-- detecção de cascata continua correta: naquele caso a linha sumiu mesmo.
create or replace function public.fn_pedido_bloquear_edicao() returns trigger
language plpgsql security definer set search_path = public as $$
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

-- ---------- CABEÇALHO: cliente e data travados, reabertura com motivo ----------

-- `security definer` pelo mesmo motivo de fn_pedido_bloquear_edicao: a
-- checagem de "pedido sem itens" lê `pedido_itens`, e como invoker a policy da
-- tabela podia esconder as linhas de quem escreve e deixar a trava passar.
create or replace function public.fn_pedido_bloquear_cabecalho() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- `now()` fica parado no horário de início da transação; como todo o
  -- cenário de teste (e uma edição real) roda numa única transação, usar
  -- `now()` aqui nunca avançaria o timestamp. `clock_timestamp()` lê o
  -- relógio de verdade a cada chamada.
  new.updated_at := clock_timestamp();

  -- A data do cancelamento vem do relógio do banco, não do navegador: o
  -- cliente mandava `new Date().toISOString()`, que é o relógio da máquina do
  -- operador e pode estar em qualquer hora.
  if new.status = 'Cancelado' and old.status is distinct from 'Cancelado' then
    new.cancelado_em := clock_timestamp();
  end if;

  if old.status = 'Cancelado' and new.status is distinct from 'Cancelado' then
    raise exception 'Pedido cancelado não volta para %.', new.status
      using errcode = 'check_violation';
  end if;

  -- Reabrir devolve a edição de itens e preços: um clique levando Faturado de
  -- volta para Pendente esvaziava toda a imutabilidade acima, sem motivo e sem
  -- autor. Passa a exigir motivo, no mesmo padrão do cancelamento.
  --
  -- O motivo precisa ser *diferente* do que já está gravado, não só não vazio:
  -- depois da primeira reabertura a coluna fica preenchida, e um
  -- `update pedidos set status = 'Pendente'` pelado — vindo da API, sem passar
  -- pela tela — herdaria o motivo antigo e passaria. Reabrir duas vezes pela
  -- mesma razão exige reescrever a razão; é o preço de não ter tabela de
  -- histórico.
  if old.status in ('Faturado', 'Enviado') and new.status = 'Pendente' then
    if new.reaberto_motivo is null
       or btrim(new.reaberto_motivo) = ''
       or new.reaberto_motivo is not distinct from old.reaberto_motivo then
      raise exception 'Reabrir o pedido % exige informar um motivo novo da reabertura.', old.id
        using errcode = 'check_violation';
    end if;
    -- Como em cancelado_em, a data vem do relógio do banco.
    new.reaberto_em := clock_timestamp();
  end if;

  if old.status is distinct from 'Pendente'
     and (new.cliente_id is distinct from old.cliente_id or new.data is distinct from old.data) then
    raise exception 'Pedido % está % — cliente e data não podem ser alterados.', old.id, old.status
      using errcode = 'check_violation';
  end if;

  -- Cancelar fica de fora: é a única saída de um pedido vazio. A tela cria o
  -- cabeçalho e os itens em duas chamadas separadas, e quando a segunda falha
  -- sobra um pedido `Pendente` sem item nenhum. Sem esta exceção esse pedido
  -- não sairia de lugar nenhum — a exclusão saiu da interface junto com a
  -- atualização 27.
  if old.status = 'Pendente' and new.status not in ('Pendente', 'Cancelado')
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
-- -- apenas motivo, autor e data de cancelamento e de reabertura gravados
-- -- depois da migração.
-- alter table public.pedidos
--   drop column if exists observacoes,
--   drop column if exists cancelado_motivo,
--   drop column if exists cancelado_em,
--   drop column if exists cancelado_por_id,
--   drop column if exists reaberto_motivo,
--   drop column if exists reaberto_em,
--   drop column if exists reaberto_por_id,
--   drop column if exists updated_at;
--
-- commit;
