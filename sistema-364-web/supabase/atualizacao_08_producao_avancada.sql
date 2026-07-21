-- =========================================================
-- 364 — ATUALIZAÇÃO 08: PRODUÇÃO AVANÇADA (DEFUMAÇÃO/EMBALAGEM) MULTIEMPRESA
--
-- Encontrado durante a migração multiempresa: o banco já tinha um fluxo mais
-- detalhado de produção (recebimento → defumação → embalagem), com um
-- trigger em embalagem_itens que grava automaticamente em `producoes` para
-- a view de estoque de produto continuar funcionando. Dois ajustes:
--
-- 1. A função do trigger referencia uma coluna `producoes.origem` que não
--    existe na tabela (bug pré-existente, nunca disparado porque
--    embalagem_itens ainda não tinha nenhum registro) — cria a coluna.
-- 2. A função não propagava empresa_id para o registro que ela mesma cria em
--    `producoes` — depois de atualizacao_04/06, isso quebraria o trigger na
--    primeira embalagem lançada (empresa_id passa a ser obrigatório). Ajusta
--    a função para propagar a empresa a partir de `embalagens`.
--
-- Rode depois de atualizacao_04_empresa_id_backfill.sql e
-- atualizacao_06_rls_multiempresa.sql.
-- =========================================================

alter table producoes add column if not exists origem text;

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

  select coalesce(sum(r.quantidade * r.custo_unitario) / nullif(sum(r.quantidade), 0), 0) into v_custo_mp
    from recebimentos r join ficha_tecnica ft on ft.materia_prima_id = r.materia_prima_id
    where ft.produto_id = v_produto_id and r.empresa_id = v_empresa_id;
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
