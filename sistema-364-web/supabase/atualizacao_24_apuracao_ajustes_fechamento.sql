-- Fase 2 do Ponto: apuração da jornada, banco de horas, ajustes retroativos,
-- fechamento de período e painel do gestor. A apuração em si (previsto x
-- realizado, atrasos, extras, saldo) é CALCULADA sob demanda no cliente
-- (lib/apuracao.js) a partir de colaboradores/escalas/escala_dias/
-- ponto_marcacoes/ponto_ajustes — nunca persistida como fonte de verdade,
-- só o FECHAMENTO grava um snapshot consolidado do período.

-- ---------- AJUSTES (correção retroativa, nunca altera ponto_marcacoes) ----------
create table if not exists public.ponto_ajustes (
  id uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references colaboradores(id) on delete cascade,
  dia date not null,
  tipo text not null check (tipo in ('marcacao_retroativa','falta_abonada','compensacao_manual')),
  marcacao_tipo text check (marcacao_tipo in ('entrada','intervalo_inicio','intervalo_fim','saida')),
  horario time,
  minutos_ajuste int,
  motivo text not null,
  criado_por uuid not null,
  created_at timestamptz not null default now(),
  constraint ponto_ajustes_campos_por_tipo check (
    (tipo = 'marcacao_retroativa' and marcacao_tipo is not null and horario is not null and minutos_ajuste is null)
    or (tipo = 'falta_abonada' and marcacao_tipo is null and horario is null and minutos_ajuste is null)
    or (tipo = 'compensacao_manual' and marcacao_tipo is null and horario is null and minutos_ajuste is not null)
  )
);
create index if not exists ponto_ajustes_colab_dia_idx on ponto_ajustes (colaborador_id, dia);

alter table public.ponto_ajustes enable row level security;
drop policy if exists "ponto_ajustes_scoped" on public.ponto_ajustes;
create policy "ponto_ajustes_scoped" on public.ponto_ajustes for all
  using (public.tem_modulo('ponto') and exists (
    select 1 from colaboradores c where c.id = colaborador_id
      and c.empresa_id in (select public.empresas_permitidas())))
  with check (public.tem_modulo('ponto') and exists (
    select 1 from colaboradores c where c.id = colaborador_id
      and c.empresa_id in (select public.empresas_permitidas())));

drop trigger if exists trg_audit on public.ponto_ajustes;
create trigger trg_audit after insert or update or delete on public.ponto_ajustes
  for each row execute function public.fn_audit();

-- ---------- FECHAMENTO DE PERÍODO (snapshot mensal por colaborador) ----------
create table if not exists public.ponto_fechamentos (
  id uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references colaboradores(id) on delete cascade,
  competencia date not null,               -- sempre o dia 1 do mês fechado
  status text not null default 'fechado' check (status in ('fechado','reaberto')),
  previsto_minutos int not null default 0,
  trabalhado_minutos int not null default 0,
  atraso_minutos int not null default 0,
  extra_minutos int not null default 0,
  saldo_minutos int not null default 0,
  dias_falta int not null default 0,
  fechado_por uuid not null,
  fechado_em timestamptz not null default now(),
  reaberto_por uuid,
  reaberto_em timestamptz,
  reaberto_motivo text,
  unique (colaborador_id, competencia)
);
create index if not exists ponto_fechamentos_competencia_idx on ponto_fechamentos (competencia);

alter table public.ponto_fechamentos enable row level security;
drop policy if exists "ponto_fechamentos_scoped" on public.ponto_fechamentos;
create policy "ponto_fechamentos_scoped" on public.ponto_fechamentos for all
  using (public.tem_modulo('ponto') and exists (
    select 1 from colaboradores c where c.id = colaborador_id
      and c.empresa_id in (select public.empresas_permitidas())))
  with check (public.tem_modulo('ponto') and exists (
    select 1 from colaboradores c where c.id = colaborador_id
      and c.empresa_id in (select public.empresas_permitidas())));

drop trigger if exists trg_audit on public.ponto_fechamentos;
create trigger trg_audit after insert or update or delete on public.ponto_fechamentos
  for each row execute function public.fn_audit();
