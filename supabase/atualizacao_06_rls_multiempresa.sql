-- =========================================================
-- 364 — ATUALIZAÇÃO 06: RLS MULTIEMPRESA
-- Substitui a policy "authenticated_full_access" (que dava acesso total
-- a qualquer usuário logado) por uma que filtra por empresas_permitidas().
-- Rode depois de atualizacao_05_usuario_empresas.sql.
-- =========================================================

-- ---------- Tabelas de negócio: filtra por empresa ----------
do $$
declare t text;
begin
  for t in select unnest(array[
    'funcionarios','fornecedores','materias_primas','produtos','ficha_tecnica',
    'recebimentos','producoes','producao_consumo','clientes','pedidos','pedido_itens','despesas',
    'defumacoes','defumacao_itens','embalagens','embalagem_itens',
    'assinaturas','assinatura_entregas','cliente_precos'
  ])
  loop
    execute format('drop policy if exists "authenticated_full_access" on %I;', t);
    execute format('drop policy if exists "empresa_scoped_access" on %I;', t);
    execute format($f$
      create policy "empresa_scoped_access" on %I
      for all
      using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()))
      with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));
    $f$, t);
  end loop;
end $$;

-- ---------- Tabelas novas: grupos, empresas, unidades ----------
-- Sem policy própria aqui, "enable row level security" bloquearia tudo —
-- inclusive o seletor de empresa no frontend deixaria de carregar.

alter table grupos enable row level security;
drop policy if exists "grupos_select" on grupos;
create policy "grupos_select" on grupos for select using (auth.role() = 'authenticated');
drop policy if exists "grupos_admin_write" on grupos;
create policy "grupos_admin_write" on grupos for all using (public.is_admin()) with check (public.is_admin());

alter table empresas enable row level security;
drop policy if exists "empresas_select" on empresas;
create policy "empresas_select" on empresas
  for select using (auth.role() = 'authenticated' and id in (select public.empresas_permitidas()));
drop policy if exists "empresas_admin_write" on empresas;
create policy "empresas_admin_write" on empresas for all using (public.is_admin()) with check (public.is_admin());

alter table unidades enable row level security;
drop policy if exists "unidades_select" on unidades;
create policy "unidades_select" on unidades
  for select using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));
drop policy if exists "unidades_admin_write" on unidades;
create policy "unidades_admin_write" on unidades for all using (public.is_admin()) with check (public.is_admin());
