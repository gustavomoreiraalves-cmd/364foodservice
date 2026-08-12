-- =========================================================
-- 364 — ATUALIZAÇÃO 10: CATCH-UP — RECEBIMENTOS → CABEÇALHO + ITENS
--
-- Esta migração DOCUMENTA no repositório uma alteração de schema que já
-- havia sido aplicada manualmente no banco de produção (fora do git):
-- a tabela `recebimentos` foi dividida em `recebimentos` (cabeçalho: data,
-- fornecedor, nota fiscal, responsável, temperatura, anexo da nota) e
-- `recebimento_itens` (linhas: matéria-prima, lote, validade, custo,
-- status sanitário, condição da embalagem, local de armazenamento, foto,
-- aprovador da qualidade).
--
-- Este arquivo é IDEMPOTENTE e seguro para rodar tanto em bancos que ainda
-- estão no formato antigo (uma linha só em `recebimentos`, como deixado
-- por atualizacao_09) quanto no banco de produção atual, que já está no
-- formato novo — nesse caso os blocos de migração de dados são pulados.
--
-- Rode depois de atualizacao_09_recebimento_qualidade.sql.
-- =========================================================

-- ---------- 1. Tabela de itens do recebimento ----------
create table if not exists recebimento_itens (
  id uuid primary key default gen_random_uuid(),
  recebimento_id uuid not null references recebimentos(id) on delete cascade,
  materia_prima_id uuid not null references materias_primas(id) on delete restrict,
  lote text not null,
  numero_lote_fornecedor text,
  quantidade numeric(12,4) not null,
  peso_nota_kg numeric(12,4),
  custo_unitario numeric(12,2) not null,
  condicao_embalagem text,
  status_recebimento text not null default 'Aceito'
    check (status_recebimento in ('Aceito', 'Aceito com ressalva', 'Rejeitado')),
  local_armazenamento text,
  validade date,
  foto_produto_url text,
  aprovado_por_id uuid references funcionarios(id),
  empresa_id uuid not null references empresas(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_recebimento_itens_recebimento on recebimento_itens(recebimento_id);
create index if not exists idx_recebimento_itens_materia_prima on recebimento_itens(materia_prima_id, empresa_id);

-- ---------- 2. Migração de dados (só roda se o formato antigo ainda existir) ----------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'recebimentos' and column_name = 'materia_prima_id'
  ) then
    insert into recebimento_itens (
      recebimento_id, materia_prima_id, lote, numero_lote_fornecedor, quantidade,
      peso_nota_kg, custo_unitario, condicao_embalagem, status_recebimento,
      local_armazenamento, validade, foto_produto_url, aprovado_por_id, empresa_id, created_at
    )
    select
      id, materia_prima_id, lote, numero_lote_fornecedor, quantidade,
      peso_nota_kg, custo_unitario, condicao_embalagem, status_recebimento,
      local_armazenamento, validade, foto_produto_url, aprovado_por_id, empresa_id, created_at
    from recebimentos
    where not exists (select 1 from recebimento_itens where recebimento_id = recebimentos.id);

    alter table recebimentos
      drop column if exists materia_prima_id,
      drop column if exists lote,
      drop column if exists numero_lote_fornecedor,
      drop column if exists quantidade,
      drop column if exists peso_nota_kg,
      drop column if exists custo_unitario,
      drop column if exists condicao_embalagem,
      drop column if exists status_recebimento,
      drop column if exists local_armazenamento,
      drop column if exists validade,
      drop column if exists foto_produto_url,
      drop column if exists aprovado_por_id;
  end if;
end $$;

-- ---------- 3. RLS de recebimento_itens (mesmo padrão multiempresa das demais tabelas) ----------
alter table recebimento_itens enable row level security;

drop policy if exists "empresa_scoped_access" on recebimento_itens;
create policy "empresa_scoped_access" on recebimento_itens
  for all
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()))
  with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

-- ---------- 4. View de estoque de matéria-prima: recalcula a partir de recebimento_itens ----------
drop view if exists vw_estoque_materia_prima;
create view vw_estoque_materia_prima
with (security_invoker = true) as
select
  mp.empresa_id,
  mp.id as materia_prima_id,
  mp.nome,
  mp.unidade,
  coalesce(sum(ri.quantidade) filter (where ri.status_recebimento in ('Aceito', 'Aceito com ressalva')), 0) as total_recebido,
  coalesce((select sum(pc.quantidade) from producao_consumo pc
            where pc.materia_prima_id = mp.id and pc.empresa_id = mp.empresa_id), 0) as total_consumido,
  coalesce(sum(ri.quantidade) filter (where ri.status_recebimento in ('Aceito', 'Aceito com ressalva')), 0)
  - coalesce((select sum(pc.quantidade) from producao_consumo pc
              where pc.materia_prima_id = mp.id and pc.empresa_id = mp.empresa_id), 0) as saldo
from materias_primas mp
left join recebimento_itens ri on ri.materia_prima_id = mp.id and ri.empresa_id = mp.empresa_id
group by mp.empresa_id, mp.id, mp.nome, mp.unidade;

-- ---------- 5. Trigger de embalagem→produção: custo médio a partir de recebimento_itens ----------
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
    from recebimento_itens ri join ficha_tecnica ft on ft.materia_prima_id = ri.materia_prima_id
    where ft.produto_id = v_produto_id and ri.empresa_id = v_empresa_id
      and ri.status_recebimento in ('Aceito', 'Aceito com ressalva');
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
