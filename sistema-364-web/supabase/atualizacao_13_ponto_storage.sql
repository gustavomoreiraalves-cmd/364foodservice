-- =========================================================
-- 364 — ATUALIZAÇÃO 13: PONTO — POLICIES DO BUCKET "colaboradores"
-- Rode depois de criar o bucket privado "colaboradores" no Storage
-- (painel Supabase) e das atualizações 11 e 12.
-- Padrão igual ao bucket "recebimentos": usuários autenticados com o
-- módulo ponto podem enviar/ler; alterar/excluir é admin-only.
-- =========================================================

drop policy if exists "colaboradores_select" on storage.objects;
create policy "colaboradores_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'colaboradores' and public.tem_modulo('ponto'));

drop policy if exists "colaboradores_insert" on storage.objects;
create policy "colaboradores_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'colaboradores' and public.tem_modulo('ponto'));

drop policy if exists "colaboradores_admin_update" on storage.objects;
create policy "colaboradores_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'colaboradores' and public.is_admin())
  with check (bucket_id = 'colaboradores' and public.is_admin());

drop policy if exists "colaboradores_admin_delete" on storage.objects;
create policy "colaboradores_admin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'colaboradores' and public.is_admin());
