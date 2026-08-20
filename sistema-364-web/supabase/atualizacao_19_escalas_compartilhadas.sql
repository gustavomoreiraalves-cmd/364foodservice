-- Escalas passam a ser compartilhadas entre todas as empresas do Grupo 364:
-- deixa de fazer sentido recriar a mesma escala (ex.: "6x1 08h às 17h") em
-- cada marca. `empresa_id` deixa de ser filtro de RLS e vira só um registro
-- de origem (quem cadastrou primeiro); pode ficar nulo dali em diante.
-- A atribuição colaborador -> escala (colaborador_escalas) continua
-- escopada pela empresa do colaborador, sem mudança nenhuma aqui.

alter table public.escalas alter column empresa_id drop not null;

drop policy if exists "ponto_empresa_scoped" on public.escalas;
drop policy if exists "escalas_compartilhadas" on public.escalas;
create policy "escalas_compartilhadas" on public.escalas for all
  using (public.tem_modulo('ponto'))
  with check (public.tem_modulo('ponto'));

drop policy if exists "via_escala" on public.escala_dias;
create policy "via_escala" on public.escala_dias for all
  using (public.tem_modulo('ponto'))
  with check (public.tem_modulo('ponto'));
