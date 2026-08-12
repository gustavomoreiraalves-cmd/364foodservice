-- =========================================================
-- 364 — ATUALIZAÇÃO 16: ESTOQUE COMO LEDGER
-- Etapa 3 do plano de Suprimentos.
--
-- Até aqui o saldo de estoque era 100% calculado on-the-fly por view,
-- somando `recebimento_itens` filtrado pelo status da inspeção. Não havia
-- ledger (histórico de movimentações), nem saldo por depósito/lote — só o
-- agregado por matéria-prima/empresa.
--
-- Esta migração:
-- 1. Cria `stock_movements` (ledger append-only — sem UPDATE/DELETE nunca,
--    correções são por estorno/ajuste, não por edição).
-- 2. Cria `stock_balances` (saldo materializado por empresa/depósito/
--    matéria-prima/lote, mantido por trigger a cada movimento).
-- 3. Trigger em `inspecoes_qualidade`: quando um item é aprovado (ou
--    aprovado com ressalva), gera automaticamente a entrada no estoque —
--    fecha o requisito "ao concluir o recebimento, gerar entrada no
--    estoque" sem depender do frontend lembrar de fazer isso.
-- 4. Backfill: gera as entradas retroativas para os itens já aprovados.
-- 5. Corte: `vw_estoque_materia_prima` passa a somar `stock_balances` em
--    vez de recalcular via join toda vez — MESMO formato de colunas, então
--    `/estoque` não precisa mudar a query da tabela principal.
-- 6. Cada movimento gera automaticamente um registro em `audit_logs`
--    (criada na Etapa 1, ainda sem nenhum uso até agora).
--
-- Rode depois de atualizacao_15_inspecoes_qualidade.sql.
-- Idempotente.
-- =========================================================

-- ---------- 1. LEDGER DE MOVIMENTAÇÕES ----------
create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  unidade_id uuid references unidades(id),
  deposito_id uuid references depositos(id),
  materia_prima_id uuid not null references materias_primas(id),
  lote text not null,
  tipo text not null
    check (tipo in ('entrada', 'saida', 'transferencia_saida', 'transferencia_entrada', 'consumo', 'ajuste', 'estorno')),
  -- quantidade é sinalizada: positiva para entrada/transferencia_entrada/estorno-de-saida,
  -- negativa para saida/consumo/transferencia_saida — soma direta dá o saldo.
  quantidade numeric(12,4) not null,
  custo_unitario numeric(12,2) not null,
  recebimento_item_id uuid references recebimento_itens(id),
  motivo text,
  responsavel_id uuid references funcionarios(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_stock_movements_saldo on stock_movements(empresa_id, deposito_id, materia_prima_id, lote);
create index if not exists idx_stock_movements_item on stock_movements(recebimento_item_id);

alter table stock_movements enable row level security;

drop policy if exists "stock_movements_select" on stock_movements;
create policy "stock_movements_select" on stock_movements
  for select
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

-- Só via app (ajustes/estornos manuais, etapas futuras) — recebimento
-- automático é gerado pelo trigger abaixo, que roda como dono da tabela
-- e não passa por RLS (mesmo padrão já usado em trigger_embalagem_para_producao).
drop policy if exists "stock_movements_insert" on stock_movements;
create policy "stock_movements_insert" on stock_movements
  for insert
  with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()) and public.tem_permissao('estoque'));

-- Sem policy de update/delete — ledger é append-only, sempre.

-- ---------- 2. SALDO MATERIALIZADO ----------
create table if not exists public.stock_balances (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  unidade_id uuid references unidades(id),
  deposito_id uuid references depositos(id),
  materia_prima_id uuid not null references materias_primas(id),
  lote text not null,
  quantidade numeric(12,4) not null default 0 check (quantidade >= 0),
  custo_unitario numeric(12,2) not null default 0,
  updated_at timestamptz not null default now()
);

-- Nulls em deposito_id não colidem entre si (regra padrão do Postgres em
-- índices únicos) — sem impacto prático hoje porque cada lote só recebe
-- 1 movimento de entrada (checado no trigger), e depósito só é opcional
-- nos recebimentos anteriores à Etapa 2.1.
create unique index if not exists uq_stock_balances_chave on stock_balances(empresa_id, deposito_id, materia_prima_id, lote);
create index if not exists idx_stock_balances_mp on stock_balances(empresa_id, materia_prima_id);

alter table stock_balances enable row level security;

drop policy if exists "stock_balances_select" on stock_balances;
create policy "stock_balances_select" on stock_balances
  for select
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

-- Sem policy de insert/update/delete para o app — só o trigger (dono da
-- tabela) escreve aqui. Saldo nunca é editado diretamente, só via movimento.

-- ---------- 3. TRIGGER: MOVIMENTO ATUALIZA SALDO ----------
create or replace function public.trigger_movimento_atualiza_saldo()
returns trigger
language plpgsql
as $$
begin
  insert into stock_balances (empresa_id, unidade_id, deposito_id, materia_prima_id, lote, quantidade, custo_unitario, updated_at)
  values (new.empresa_id, new.unidade_id, new.deposito_id, new.materia_prima_id, new.lote, new.quantidade, new.custo_unitario, now())
  on conflict (empresa_id, deposito_id, materia_prima_id, lote)
  do update set
    quantidade = stock_balances.quantidade + excluded.quantidade,
    custo_unitario = excluded.custo_unitario,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_movimento_atualiza_saldo on stock_movements;
create trigger trg_movimento_atualiza_saldo
  after insert on stock_movements
  for each row execute function public.trigger_movimento_atualiza_saldo();

-- ---------- 4. TRIGGER: MOVIMENTO GERA AUDITORIA ----------
create or replace function public.trigger_movimento_audita()
returns trigger
language plpgsql
as $$
begin
  insert into audit_logs (empresa_id, unidade_id, usuario_id, acao, recurso, recurso_id, valores_novos)
  values (new.empresa_id, new.unidade_id, auth.uid(), 'criado', 'stock_movements', new.id, to_jsonb(new));
  return new;
end;
$$;

drop trigger if exists trg_movimento_audita on stock_movements;
create trigger trg_movimento_audita
  after insert on stock_movements
  for each row execute function public.trigger_movimento_audita();

-- ---------- 5. TRIGGER: INSPEÇÃO APROVADA GERA ENTRADA NO ESTOQUE ----------
-- Roda em insert (fluxo atual: status já vem definido na criação) e em
-- update de status (fluxo futuro: tela de inspeção que aprova depois).
-- Idempotente: nunca gera uma segunda entrada para o mesmo item.
create or replace function public.trigger_inspecao_gera_movimento()
returns trigger
language plpgsql
as $$
declare
  v_item record;
  v_unidade_id uuid;
begin
  if new.status not in ('aprovado', 'aprovado_com_ressalva') then
    return new;
  end if;
  if exists (select 1 from stock_movements where recebimento_item_id = new.recebimento_item_id and tipo = 'entrada') then
    return new;
  end if;

  select * into v_item from recebimento_itens where id = new.recebimento_item_id;
  if v_item is null then
    return new;
  end if;

  if v_item.deposito_id is not null then
    select unidade_id into v_unidade_id from depositos where id = v_item.deposito_id;
  end if;

  insert into stock_movements (
    empresa_id, unidade_id, deposito_id, materia_prima_id, lote, tipo,
    quantidade, custo_unitario, recebimento_item_id, responsavel_id
  ) values (
    v_item.empresa_id, v_unidade_id, v_item.deposito_id, v_item.materia_prima_id, v_item.lote, 'entrada',
    v_item.quantidade, v_item.custo_unitario, v_item.id, new.inspecionado_por_id
  );

  return new;
end;
$$;

drop trigger if exists trg_inspecao_gera_movimento on inspecoes_qualidade;
create trigger trg_inspecao_gera_movimento
  after insert or update of status on inspecoes_qualidade
  for each row execute function public.trigger_inspecao_gera_movimento();

-- ---------- 6. BACKFILL: entradas retroativas dos itens já aprovados ----------
insert into stock_movements (empresa_id, unidade_id, deposito_id, materia_prima_id, lote, tipo, quantidade, custo_unitario, recebimento_item_id, responsavel_id, created_at)
select
  ri.empresa_id, d.unidade_id, ri.deposito_id, ri.materia_prima_id, ri.lote, 'entrada',
  ri.quantidade, ri.custo_unitario, ri.id, iq.inspecionado_por_id, ri.created_at
from recebimento_itens ri
join inspecoes_qualidade iq on iq.recebimento_item_id = ri.id
left join depositos d on d.id = ri.deposito_id
where iq.status in ('aprovado', 'aprovado_com_ressalva')
  and not exists (select 1 from stock_movements sm where sm.recebimento_item_id = ri.id and sm.tipo = 'entrada');

-- ---------- 7. CORTE: view de estoque passa a somar o ledger ----------
drop view if exists vw_estoque_materia_prima;
create view vw_estoque_materia_prima
with (security_invoker = true) as
select
  mp.empresa_id,
  mp.id as materia_prima_id,
  mp.nome,
  mp.unidade,
  coalesce(sb.total, 0) as total_recebido,
  coalesce(pc.total, 0) as total_consumido,
  coalesce(sb.total, 0) - coalesce(pc.total, 0) as saldo
from materias_primas mp
left join (
  select empresa_id, materia_prima_id, sum(quantidade) as total
  from stock_balances
  group by empresa_id, materia_prima_id
) sb on sb.empresa_id = mp.empresa_id and sb.materia_prima_id = mp.id
left join (
  select empresa_id, materia_prima_id, sum(quantidade) as total
  from producao_consumo
  group by empresa_id, materia_prima_id
) pc on pc.empresa_id = mp.empresa_id and pc.materia_prima_id = mp.id;
