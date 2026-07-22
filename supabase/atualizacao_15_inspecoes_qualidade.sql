-- =========================================================
-- 364 — ATUALIZAÇÃO 15: INSPEÇÃO DE QUALIDADE COMO ENTIDADE SEPARADA
-- Etapa 2.2 do plano de Suprimentos.
--
-- Até aqui os campos de qualidade (condição da embalagem, temperatura,
-- status sanitário, aprovador, foto) eram colunas soltas em
-- `recebimento_itens`, com só 3 valores de status (Aceito / Aceito com
-- ressalva / Rejeitado) — sem quarentena, sem "devolvido", sem motivo de
-- rejeição, sem documento sanitário.
--
-- Esta migração:
-- 1. Cria `inspecoes_qualidade` (1 inspeção por item de recebimento, por
--    ora — reinspeção/histórico fica para quando houver necessidade real).
-- 2. Migra os dados existentes (mapeando os 3 status antigos para os 2
--    aprovados equivalentes; itens sem status explícito nascem "aprovado").
-- 3. Atualiza a view de estoque e o trigger de embalagem→produção para
--    considerar `inspecoes_qualidade.status` em vez da coluna antiga.
-- 4. Remove as colunas de qualidade de `recebimento_itens` e a coluna
--    `temperatura_c` órfã em `recebimentos` (cabeçalho) — combinadas na
--    Etapa 2.1, já sem uso desde então.
--
-- Rode depois de atualizacao_14_recebimento_multiitem.sql.
-- Os dados são copiados antes de qualquer DROP COLUMN — não há perda de
-- informação, mas o passo 4 é destrutivo sobre o schema (não reversível
-- sem restaurar as colunas manualmente). Idempotente para os passos 1-3;
-- o passo 4 é seguro rodar mais de uma vez (DROP COLUMN IF EXISTS).
-- =========================================================

-- ---------- 1. Tabela de inspeção de qualidade ----------
create table if not exists public.inspecoes_qualidade (
  id uuid primary key default gen_random_uuid(),
  recebimento_item_id uuid not null references recebimento_itens(id) on delete cascade,
  empresa_id uuid not null references empresas(id),
  status text not null default 'pendente'
    check (status in ('pendente', 'aprovado', 'aprovado_com_ressalva', 'quarentena', 'rejeitado', 'devolvido')),
  condicao_embalagem text,
  temperatura_c numeric(5,2),
  motivo_rejeicao text,
  documento_sanitario_url text,
  foto_url text,
  observacoes text,
  inspecionado_por_id uuid references funcionarios(id),
  inspecionado_em timestamptz,
  created_at timestamptz not null default now()
);

-- 1 inspeção "ativa" por item, por enquanto (sem histórico de reinspeção).
create unique index if not exists uq_inspecoes_qualidade_item on inspecoes_qualidade(recebimento_item_id);
create index if not exists idx_inspecoes_qualidade_empresa on inspecoes_qualidade(empresa_id, status);

-- ---------- 2. Migração de dados ----------
insert into inspecoes_qualidade (
  recebimento_item_id, empresa_id, status, condicao_embalagem, temperatura_c,
  foto_url, inspecionado_por_id, inspecionado_em, created_at
)
select
  ri.id,
  ri.empresa_id,
  case ri.status_recebimento
    when 'Aceito' then 'aprovado'
    when 'Aceito com ressalva' then 'aprovado_com_ressalva'
    when 'Rejeitado' then 'rejeitado'
    else 'aprovado'
  end,
  ri.condicao_embalagem,
  ri.temperatura_c,
  ri.foto_produto_url,
  ri.aprovado_por_id,
  ri.created_at,
  ri.created_at
from recebimento_itens ri
where exists (select 1 from information_schema.columns where table_name = 'recebimento_itens' and column_name = 'status_recebimento')
  and not exists (select 1 from inspecoes_qualidade iq where iq.recebimento_item_id = ri.id);

-- ---------- 3. RLS ----------
alter table inspecoes_qualidade enable row level security;

drop policy if exists "inspecoes_qualidade_select" on inspecoes_qualidade;
create policy "inspecoes_qualidade_select" on inspecoes_qualidade
  for select
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

drop policy if exists "inspecoes_qualidade_insert" on inspecoes_qualidade;
create policy "inspecoes_qualidade_insert" on inspecoes_qualidade
  for insert
  with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()) and public.tem_permissao('recebimentos'));

drop policy if exists "inspecoes_qualidade_update" on inspecoes_qualidade;
create policy "inspecoes_qualidade_update" on inspecoes_qualidade
  for update
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()) and public.tem_permissao('recebimentos'))
  with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()) and public.tem_permissao('recebimentos'));

-- ---------- 4. View de estoque: considera status da inspeção ----------
-- Lotes em quarentena, rejeitados, devolvidos ou ainda pendentes de
-- inspeção não contam no saldo disponível (não podem ser "usados").
drop view if exists vw_estoque_materia_prima;
create view vw_estoque_materia_prima
with (security_invoker = true) as
select
  mp.empresa_id,
  mp.id as materia_prima_id,
  mp.nome,
  mp.unidade,
  coalesce(sum(ri.quantidade) filter (where iq.status in ('aprovado', 'aprovado_com_ressalva')), 0) as total_recebido,
  coalesce((select sum(pc.quantidade) from producao_consumo pc
            where pc.materia_prima_id = mp.id and pc.empresa_id = mp.empresa_id), 0) as total_consumido,
  coalesce(sum(ri.quantidade) filter (where iq.status in ('aprovado', 'aprovado_com_ressalva')), 0)
  - coalesce((select sum(pc.quantidade) from producao_consumo pc
              where pc.materia_prima_id = mp.id and pc.empresa_id = mp.empresa_id), 0) as saldo
from materias_primas mp
left join recebimento_itens ri on ri.materia_prima_id = mp.id and ri.empresa_id = mp.empresa_id
left join inspecoes_qualidade iq on iq.recebimento_item_id = ri.id
group by mp.empresa_id, mp.id, mp.nome, mp.unidade;

-- ---------- 5. Trigger de embalagem→produção: idem ----------
create or replace function public.trigger_embalagem_para_producao()
returns trigger
language plpgsql
as $function$
declare
  v_producao_id uuid;
  v_produto_id uuid := new.produto_id;
  v_quantidade numeric(12,3) := new.quantidade;
  v_embalagem_id uuid := new.embalagem_id;
  v_data date;
  v_empresa_id uuid;
  v_custo_total numeric(12,2);
  v_custo_mp numeric(12,2);
begin
  select data, empresa_id into v_data, v_empresa_id from embalagens where id = v_embalagem_id;

  select coalesce(sum(ri.quantidade * ri.custo_unitario) / nullif(sum(ri.quantidade), 0), 0) into v_custo_mp
    from recebimento_itens ri
    join ficha_tecnica ft on ft.materia_prima_id = ri.materia_prima_id
    left join inspecoes_qualidade iq on iq.recebimento_item_id = ri.id
    where ft.produto_id = v_produto_id and ri.empresa_id = v_empresa_id
      and iq.status in ('aprovado', 'aprovado_com_ressalva');
  v_custo_total := v_quantidade * v_custo_mp;

  select id into v_producao_id from producoes
    where produto_id = v_produto_id and data = v_data and origem = 'embalagem' and empresa_id = v_empresa_id
    limit 1;

  if v_producao_id is not null then
    update producoes set quantidade = quantidade + v_quantidade, custo_total = custo_total + v_custo_total
      where id = v_producao_id;
  else
    insert into producoes (lote, data, produto_id, quantidade, custo_total, origem, empresa_id)
    values (
      'EMBALAGEM-' || to_char(v_data, 'DD/MM/YY') || '-' || substring(gen_random_uuid()::text, 1, 3),
      v_data, v_produto_id, v_quantidade, v_custo_total, 'embalagem', v_empresa_id
    );
  end if;

  return new;
end;
$function$;

-- ---------- 6. Remove colunas de qualidade duplicadas ----------
-- Já copiadas para inspecoes_qualidade no passo 2 — o app (Etapa 2.2) para
-- de gravar aqui e passa a gravar só na tabela nova.
alter table recebimento_itens
  drop column if exists status_recebimento,
  drop column if exists condicao_embalagem,
  drop column if exists temperatura_c,
  drop column if exists aprovado_por_id,
  drop column if exists foto_produto_url;

-- Órfã desde a Etapa 2.1 (temperatura virou campo de item, não de nota).
alter table recebimentos drop column if exists temperatura_c;
