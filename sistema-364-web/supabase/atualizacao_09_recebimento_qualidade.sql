-- =========================================================
-- 364 — ATUALIZAÇÃO 09: QUALIDADE NO RECEBIMENTO DE MATÉRIA-PRIMA
-- Lote do fornecedor, temperatura, condição da embalagem, peso conferido
-- vs. peso da nota, status de aceite/rejeição/ressalva, anexos de nota
-- fiscal e foto, local de armazenamento, aprovação técnica, categoria e
-- preço-alvo por matéria-prima.
--
-- A partir desta migração, `recebimentos.quantidade` passa a representar
-- o "peso/quantidade CONFERIDA" (o que é usado no saldo de estoque) — só
-- muda o significado do rótulo na tela, nenhum dado existente é alterado.
-- `peso_nota_kg` é um campo novo e independente.
--
-- Rode depois de atualizacao_08_producao_avancada.sql.
-- =========================================================

-- ---------- MATÉRIAS-PRIMAS: categoria e preço-alvo ----------
alter table materias_primas add column if not exists categoria text;
alter table materias_primas add column if not exists preco_alvo_kg numeric(12,2);

-- ---------- RECEBIMENTOS: qualidade, pesagem, status, anexos ----------
alter table recebimentos add column if not exists numero_lote_fornecedor text;
alter table recebimentos add column if not exists temperatura_c numeric(5,2);
alter table recebimentos add column if not exists condicao_embalagem text;
alter table recebimentos add column if not exists peso_nota_kg numeric(12,4);
alter table recebimentos add column if not exists local_armazenamento text;
alter table recebimentos add column if not exists nota_fiscal_arquivo_url text; -- path no bucket (privado), não URL pública
alter table recebimentos add column if not exists foto_produto_url text;       -- idem
alter table recebimentos add column if not exists aprovado_por_id uuid references funcionarios(id);

alter table recebimentos add column if not exists status_recebimento text not null default 'Aceito';

alter table recebimentos drop constraint if exists recebimentos_status_recebimento_check;
alter table recebimentos add constraint recebimentos_status_recebimento_check
  check (status_recebimento in ('Aceito', 'Aceito com ressalva', 'Rejeitado'));

-- ---------- VIEW DE ESTOQUE: só Aceito / Aceito com ressalva contam ----------
-- FILTER em vez de WHERE no join para não descartar a linha da matéria-prima
-- quando todos os recebimentos dela forem "Rejeitado" (mantém saldo 0).
drop view if exists vw_estoque_materia_prima;
create view vw_estoque_materia_prima
with (security_invoker = true) as
select
  mp.empresa_id,
  mp.id as materia_prima_id,
  mp.nome,
  mp.unidade,
  coalesce(sum(r.quantidade) filter (where r.status_recebimento in ('Aceito', 'Aceito com ressalva')), 0) as total_recebido,
  coalesce((select sum(pc.quantidade) from producao_consumo pc
            where pc.materia_prima_id = mp.id and pc.empresa_id = mp.empresa_id), 0) as total_consumido,
  coalesce(sum(r.quantidade) filter (where r.status_recebimento in ('Aceito', 'Aceito com ressalva')), 0)
  - coalesce((select sum(pc.quantidade) from producao_consumo pc
              where pc.materia_prima_id = mp.id and pc.empresa_id = mp.empresa_id), 0) as saldo
from materias_primas mp
left join recebimentos r on r.materia_prima_id = mp.id and r.empresa_id = mp.empresa_id
group by mp.empresa_id, mp.id, mp.nome, mp.unidade;

-- ---------- TRIGGER DE EMBALAGEM→PRODUÇÃO: custo médio só de recebimentos aceitos ----------
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
    where ft.produto_id = v_produto_id and r.empresa_id = v_empresa_id
      and r.status_recebimento in ('Aceito', 'Aceito com ressalva');
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

-- =========================================================
-- STORAGE: bucket privado para anexos de recebimento
-- =========================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'recebimentos', 'recebimentos', false,
  10485760, -- 10 MB por arquivo
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Path usado pela aplicação: {empresa_id}/{recebimento_id}/{prefixo}-{timestamp}.{ext}
-- storage.foldername(name)[1] = empresa_id; reaproveita empresas_permitidas()
-- (mesma função usada nas tabelas de negócio, atualizacao_05/06).

drop policy if exists "recebimentos_storage_select" on storage.objects;
create policy "recebimentos_storage_select" on storage.objects
  for select using (
    bucket_id = 'recebimentos'
    and (storage.foldername(name))[1]::uuid in (select public.empresas_permitidas())
  );

drop policy if exists "recebimentos_storage_insert" on storage.objects;
create policy "recebimentos_storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'recebimentos'
    and (storage.foldername(name))[1]::uuid in (select public.empresas_permitidas())
  );

-- update/delete só admin: são documentos fiscais/fotos de auditoria — um
-- atendente não deve poder trocar ou apagar um anexo já enviado.
drop policy if exists "recebimentos_storage_update" on storage.objects;
create policy "recebimentos_storage_update" on storage.objects
  for update using (bucket_id = 'recebimentos' and public.is_admin())
  with check (bucket_id = 'recebimentos' and public.is_admin());

drop policy if exists "recebimentos_storage_delete" on storage.objects;
create policy "recebimentos_storage_delete" on storage.objects
  for delete using (bucket_id = 'recebimentos' and public.is_admin());
