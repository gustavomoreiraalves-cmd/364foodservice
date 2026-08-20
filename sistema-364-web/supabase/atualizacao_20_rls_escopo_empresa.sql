-- Devolve o escopo de empresa às policies que ficaram abertas ao grupo inteiro.
--
-- Auditoria de RLS em 20/08/2026 (leitura anônima + pg_policies em produção):
-- o perímetro externo está sólido — RLS habilitada em todas as tabelas de
-- `public`, nenhuma leitura anônima, os dois buckets privados. O furo é
-- interno: sete policies não filtram por empresa, então qualquer usuário com o
-- módulo `ponto` de qualquer marca do grupo alcança dados das outras.
--
-- Duas delas concedem `for all`, o que inclui UPDATE e DELETE. Esta migração
-- não desfaz o compartilhamento de leitura que a atualização 19 criou de
-- propósito; ela separa leitura de escrita, que a 19 abriu junto sem querer.
--
-- Idempotente: `drop policy if exists` antes de cada `create policy`. Rodar
-- duas vezes não quebra nada. Não altera dados, só policies.
--
-- Sem janela de compatibilidade: policy é troca atômica dentro da transação, e
-- o app não muda. O rollback está comentado no fim do arquivo.

begin;

-- ---------- ESCALAS ----------
-- A 19 tornou as escalas compartilhadas entre as marcas do grupo, para não
-- recadastrar "6x1 08h às 17h" em cada uma. A leitura compartilhada continua.
-- A escrita volta a ser de quem é dono: só edita/apaga quem tem acesso à
-- empresa que cadastrou a escala.
--
-- `empresa_id` é anulável desde a 19 (escala sem dono, criada como global).
-- `null in (select ...)` não é verdadeiro, então essas escalas ficariam sem
-- ninguém que possa editá-las — daí o `is_admin()` explícito.

drop policy if exists "escalas_compartilhadas" on public.escalas;
drop policy if exists "escalas_select" on public.escalas;
drop policy if exists "escalas_write" on public.escalas;

create policy "escalas_select" on public.escalas
  for select using (public.tem_modulo('ponto'));

create policy "escalas_write" on public.escalas
  for all
  using (
    public.tem_modulo('ponto')
    and (public.is_admin() or empresa_id in (select public.empresas_permitidas()))
  )
  with check (
    public.tem_modulo('ponto')
    and (public.is_admin() or empresa_id in (select public.empresas_permitidas()))
  );

-- ---------- ESCALA_DIAS ----------
-- Os dias seguem a escala pai: leitura compartilhada, escrita restrita a quem
-- pode escrever na escala.

drop policy if exists "via_escala" on public.escala_dias;
drop policy if exists "escala_dias_select" on public.escala_dias;
drop policy if exists "escala_dias_write" on public.escala_dias;

create policy "escala_dias_select" on public.escala_dias
  for select using (public.tem_modulo('ponto'));

create policy "escala_dias_write" on public.escala_dias
  for all
  using (
    public.tem_modulo('ponto')
    and exists (
      select 1 from public.escalas e
      where e.id = escala_id
        and (public.is_admin() or e.empresa_id in (select public.empresas_permitidas()))
    )
  )
  with check (
    public.tem_modulo('ponto')
    and exists (
      select 1 from public.escalas e
      where e.id = escala_id
        and (public.is_admin() or e.empresa_id in (select public.empresas_permitidas()))
    )
  );

-- ---------- STORAGE: bucket 'colaboradores' ----------
-- Guarda a foto cadastral do colaborador, no caminho
-- `{empresa_id}/{colaborador_id}/foto-*.ext` (ver lib/storage.js).
-- A policy antiga exigia só `tem_modulo('ponto')`: qualquer usuário de ponto
-- lia — e gravava — a foto de colaborador de qualquer marca. Dado pessoal em
-- contexto biométrico, então isso é exposição sob a LGPD.
--
-- A tabela `ponto_biometrias` já filtrava certo, via a empresa do colaborador;
-- só o arquivo correspondente no storage é que não filtrava.
--
-- Comparação por texto em vez de `::uuid` de propósito: um objeto cujo primeiro
-- segmento não seja um UUID faria o cast lançar erro em tempo de avaliação da
-- policy, derrubando a query inteira em vez de apenas esconder o arquivo.

drop policy if exists "colaboradores_select" on storage.objects;
drop policy if exists "colaboradores_insert" on storage.objects;

create policy "colaboradores_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'colaboradores'
    and public.tem_modulo('ponto')
    and (storage.foldername(name))[1] in (select id::text from public.empresas where id in (select public.empresas_permitidas()))
  );

create policy "colaboradores_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'colaboradores'
    and public.tem_modulo('ponto')
    and (storage.foldername(name))[1] in (select id::text from public.empresas where id in (select public.empresas_permitidas()))
  );

-- `colaboradores_admin_update` e `colaboradores_admin_delete` continuam como
-- estão: já exigem `is_admin()`.

-- ---------- EMPREGADORES ----------
-- Empregador é a pessoa jurídica real (CNPJ, razão social, responsável legal) e
-- pertence ao grupo, não à empresa — uma unidade aponta para um empregador. Por
-- isso o filtro certo aqui é o grupo, e não `empresa_id`, que a tabela não tem.
-- Hoje o grupo é um só, então na prática nada muda; a policy passa a valer
-- quando existir um segundo grupo, que é justamente quando o vazamento contaria.

drop policy if exists "empregadores_select" on public.empregadores;

create policy "empregadores_select" on public.empregadores
  for select using (
    public.tem_modulo('ponto')
    and grupo_id in (select grupo_id from public.empresas where id in (select public.empresas_permitidas()))
  );

-- ---------- GRUPOS ----------
-- Mesma correção: qualquer usuário autenticado enxergava todos os grupos.

drop policy if exists "grupos_select" on public.grupos;

create policy "grupos_select" on public.grupos
  for select using (
    id in (select grupo_id from public.empresas where id in (select public.empresas_permitidas()))
  );

-- ---------- PONTO_AVISOS_PRIVACIDADE: deixado como está, de propósito ----------
-- `avisos_select` também não filtra por empresa, mas a tabela guarda o texto do
-- aviso de privacidade exibido no quiosque — conteúdo institucional, não dado
-- pessoal. Compartilhar entre as marcas do grupo é o comportamento desejado.
-- Registrado aqui para a próxima auditoria não tratar como esquecimento.

commit;

-- ---------------------------------------------------------------------------
-- ROLLBACK — restaura exatamente o estado anterior a esta migração.
-- ---------------------------------------------------------------------------
-- begin;
--
-- drop policy if exists "escalas_select" on public.escalas;
-- drop policy if exists "escalas_write" on public.escalas;
-- create policy "escalas_compartilhadas" on public.escalas for all
--   using (public.tem_modulo('ponto'))
--   with check (public.tem_modulo('ponto'));
--
-- drop policy if exists "escala_dias_select" on public.escala_dias;
-- drop policy if exists "escala_dias_write" on public.escala_dias;
-- create policy "via_escala" on public.escala_dias for all
--   using (public.tem_modulo('ponto'))
--   with check (public.tem_modulo('ponto'));
--
-- drop policy if exists "colaboradores_select" on storage.objects;
-- drop policy if exists "colaboradores_insert" on storage.objects;
-- create policy "colaboradores_select" on storage.objects
--   for select to authenticated
--   using (bucket_id = 'colaboradores' and public.tem_modulo('ponto'));
-- create policy "colaboradores_insert" on storage.objects
--   for insert to authenticated
--   with check (bucket_id = 'colaboradores' and public.tem_modulo('ponto'));
--
-- drop policy if exists "empregadores_select" on public.empregadores;
-- create policy "empregadores_select" on public.empregadores
--   for select using (public.tem_modulo('ponto'));
--
-- drop policy if exists "grupos_select" on public.grupos;
-- create policy "grupos_select" on grupos for select using (auth.role() = 'authenticated');
--
-- commit;
