-- =========================================================
-- Atualização 42 — Logo da marca
--
-- Cada marca (public.empresas) passa a ter uma logo PNG, usada hoje no
-- cabeçalho da barra lateral e, mais adiante, nas fichas impressas, nos
-- relatórios e no DANFE. A logo é da marca, não da pessoa jurídica: o mesmo
-- CNPJ opera marcas diferentes, e quem aparece na tela é a marca selecionada.
--
-- Bucket público de propósito: o cabeçalho renderiza em toda navegação, e uma
-- signed URL por página custaria um round-trip e ainda expiraria. Logo não é
-- dado sensível — é a mesma imagem que vai impressa em documento entregue a
-- terceiro. O que continua protegido é a escrita (só admin).
--
-- Aditiva e idempotente: rodar duas vezes não quebra nada.
-- =========================================================

begin;

alter table public.empresas add column if not exists logo_path text;

comment on column public.empresas.logo_path is
  'Caminho da logo no bucket público "logos" ({empresa_id}/logo-{timestamp}.png). Nulo = sem logo, a interface cai no texto padrão.';

-- ---------- STORAGE: bucket público 'logos' ----------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', true, 1048576, array['image/png'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Leitura liberada: bucket público serve o arquivo pelo endpoint /object/public
-- sem passar por policy, e o select explícito mantém o listar coerente com isso.
drop policy if exists "logos_select" on storage.objects;
create policy "logos_select" on storage.objects
  for select using (bucket_id = 'logos');

-- Escrita só admin, igual à policy empresas_admin_write da atualização 06: quem
-- troca a logo é quem edita o cadastro da empresa.
drop policy if exists "logos_admin_insert" on storage.objects;
create policy "logos_admin_insert" on storage.objects
  for insert with check (bucket_id = 'logos' and public.is_admin());

drop policy if exists "logos_admin_update" on storage.objects;
create policy "logos_admin_update" on storage.objects
  for update using (bucket_id = 'logos' and public.is_admin())
  with check (bucket_id = 'logos' and public.is_admin());

drop policy if exists "logos_admin_delete" on storage.objects;
create policy "logos_admin_delete" on storage.objects
  for delete using (bucket_id = 'logos' and public.is_admin());

commit;

-- ---------- Reversão ----------
-- begin;
-- alter table public.empresas drop column if exists logo_path;
-- drop policy if exists "logos_select" on storage.objects;
-- drop policy if exists "logos_admin_insert" on storage.objects;
-- drop policy if exists "logos_admin_update" on storage.objects;
-- drop policy if exists "logos_admin_delete" on storage.objects;
-- delete from storage.objects where bucket_id = 'logos';
-- delete from storage.buckets where id = 'logos';
-- commit;
