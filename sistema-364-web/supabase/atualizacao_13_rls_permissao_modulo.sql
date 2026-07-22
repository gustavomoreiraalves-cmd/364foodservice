-- =========================================================
-- 364 — ATUALIZAÇÃO 13: RLS POR PERMISSÃO DE MÓDULO (escopo: Suprimentos)
--
-- Diagnóstico (jul/2026): hoje a RLS só filtra por empresa
-- (`empresas_permitidas()`); a tabela `permissoes` (aba liberada por
-- usuário) só é checada no frontend, então qualquer usuário autenticado
-- com acesso a uma empresa tem CRUD completo em qualquer tabela dessa
-- empresa via API, mesmo sem a permissão daquele módulo. Esta migração
-- fecha esse gap para as tabelas NOVAS do módulo de Suprimentos
-- (depositos, centros_custo, e as que vierem nas próximas etapas).
--
-- Escopo desta migração é só Suprimentos, não as tabelas legadas
-- (fornecedores, produtos, recebimentos etc.) — mudar RLS de módulos já
-- em uso é uma decisão maior, fora do pedido atual, e fica registrada
-- como pendência no ROADMAP.
--
-- Checado hoje (jul/2026) contra o banco de produção: só existem 2 grants
-- em `permissoes` (um 'admin', um 'fornecedores' sem empresa associada em
-- `usuario_empresas`) — ou seja, esta migração não tira acesso de nenhum
-- usuário real em uso.
--
-- Rode depois de atualizacao_12_audit_log.sql.
-- =========================================================

create or replace function public.tem_permissao(p_modulo text)
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1 from permissoes
    where user_id = auth.uid() and modulo in (p_modulo, 'admin')
  );
$$;

-- ---------- depositos: leitura por empresa, escrita exige permissão 'depositos' ----------
drop policy if exists "empresa_scoped_access" on depositos;

drop policy if exists "depositos_select" on depositos;
create policy "depositos_select" on depositos
  for select
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

drop policy if exists "depositos_write" on depositos;
create policy "depositos_write" on depositos
  for insert
  with check (
    auth.role() = 'authenticated'
    and empresa_id in (select public.empresas_permitidas())
    and public.tem_permissao('depositos')
  );

drop policy if exists "depositos_update" on depositos;
create policy "depositos_update" on depositos
  for update
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()) and public.tem_permissao('depositos'))
  with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()) and public.tem_permissao('depositos'));

drop policy if exists "depositos_delete" on depositos;
create policy "depositos_delete" on depositos
  for delete
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()) and public.tem_permissao('depositos'));

-- ---------- centros_custo: mesmo padrão ----------
drop policy if exists "empresa_scoped_access" on centros_custo;

drop policy if exists "centros_custo_select" on centros_custo;
create policy "centros_custo_select" on centros_custo
  for select
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

drop policy if exists "centros_custo_write" on centros_custo;
create policy "centros_custo_write" on centros_custo
  for insert
  with check (
    auth.role() = 'authenticated'
    and empresa_id in (select public.empresas_permitidas())
    and public.tem_permissao('centros_custo')
  );

drop policy if exists "centros_custo_update" on centros_custo;
create policy "centros_custo_update" on centros_custo
  for update
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()) and public.tem_permissao('centros_custo'))
  with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()) and public.tem_permissao('centros_custo'));

drop policy if exists "centros_custo_delete" on centros_custo;
create policy "centros_custo_delete" on centros_custo
  for delete
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()) and public.tem_permissao('centros_custo'));
