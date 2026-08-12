-- =========================================================
-- 364 — ATUALIZAÇÃO 11: PONTO FASE 1 — CADASTROS
-- Empregadores (CNPJ real), unidades operacionais, centros de
-- custo, colaboradores, escalas e auditoria imutável.
-- Rode este arquivo inteiro no SQL Editor do Supabase
-- (depois de atualizacao_10_recebimento_itens.sql).
--
-- AÇÃO MANUAL NECESSÁRIA no painel do Supabase:
--   Storage → criar bucket privado "colaboradores"
--   (foto cadastral dos colaboradores, acesso via signed URL).
-- =========================================================

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- ---------- HELPER: usuário logado tem o módulo? ----------
-- Reforço de RLS no banco para dados trabalhistas sensíveis
-- (hoje o gating por módulo é só na interface).
create or replace function public.tem_modulo(m text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from permissoes
    where user_id = auth.uid() and modulo in (m, 'admin')
  );
$$;

-- ---------- EMPREGADORES (pessoa jurídica real, nível grupo) ----------
-- As "empresas" do sistema são marcas/operações; o vínculo
-- trabalhista do colaborador é com o CNPJ empregador.
create table if not exists public.empregadores (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references grupos(id) on delete restrict,
  razao_social text not null,
  nome_fantasia text,
  cnpj text unique not null,               -- só dígitos
  inscricao_estadual text,
  endereco text,
  cidade text,
  uf text,
  cep text,
  responsavel_legal text,
  fuso text not null default 'America/Sao_Paulo',
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- UNIDADES OPERACIONAIS ----------
-- Estende a tabela criada na atualizacao_03 (nunca usada até aqui)
-- para virar local físico de trabalho: endereço, geo, fuso, empregador.
alter table public.unidades add column if not exists empregador_id uuid references empregadores(id);
alter table public.unidades add column if not exists codigo text;
alter table public.unidades add column if not exists endereco text;
alter table public.unidades add column if not exists cidade text;
alter table public.unidades add column if not exists uf text;
alter table public.unidades add column if not exists cep text;
alter table public.unidades add column if not exists latitude numeric(9,6);
alter table public.unidades add column if not exists longitude numeric(9,6);
alter table public.unidades add column if not exists fuso text not null default 'America/Sao_Paulo';
alter table public.unidades add column if not exists responsavel text;

-- ---------- CENTROS DE CUSTO ----------
create table if not exists public.centros_custo (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  codigo text not null,
  nome text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (empresa_id, codigo)
);

-- ---------- COLABORADORES (canônico: 1 por pessoa física/CPF) ----------
-- Não confundir com "funcionarios" (cadastro operacional por empresa,
-- usado como responsável em recebimentos/produções/pedidos) — aquele
-- permanece como está; aqui é o cadastro trabalhista do ponto.
create table if not exists public.colaboradores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),          -- marca "dona" (dimensão de RLS)
  empregador_id uuid not null references empregadores(id),
  unidade_principal_id uuid references unidades(id),
  centro_custo_id uuid references centros_custo(id),
  gestor_id uuid references colaboradores(id),
  -- dados pessoais
  nome text not null,
  cpf text unique not null,                                  -- só dígitos
  data_nascimento date,
  email text,
  telefone text,
  foto_cadastral_path text,                                  -- bucket privado 'colaboradores'
  -- dados trabalhistas
  matricula text,
  pis text,
  cargo text,
  tipo_contrato text not null default 'clt'
    check (tipo_contrato in ('clt','estagio','pj','temporario','socio')),
  data_admissao date,
  data_desligamento date,
  carga_horaria_semanal numeric(5,2),
  banco_horas boolean not null default false,
  tolerancia_minutos int not null default 10,
  status text not null default 'ativo'
    check (status in ('ativo','afastado','ferias','suspenso','desligado')),
  -- controle de ponto
  registra_ponto boolean not null default true,
  metodos_permitidos text[] not null default array['facial'], -- 'facial','pin','manual_gestor'
  biometria_status text not null default 'pendente'
    check (biometria_status in ('pendente','cadastrada','bloqueada')),
  -- PIN de contingência fica em ponto_pins (atualizacao_12), acessível só pelo servidor
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists colaboradores_empresa_idx on colaboradores (empresa_id);
create index if not exists colaboradores_empregador_idx on colaboradores (empregador_id);

-- unidades onde o colaborador pode bater ponto (com vigência; encerrar, não deletar)
create table if not exists public.colaborador_unidades (
  id uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references colaboradores(id) on delete cascade,
  unidade_id uuid not null references unidades(id),
  data_inicio date not null default current_date,
  data_fim date,
  created_at timestamptz not null default now()
);
create index if not exists colaborador_unidades_colab_idx on colaborador_unidades (colaborador_id);
create index if not exists colaborador_unidades_unidade_idx on colaborador_unidades (unidade_id);

-- vínculo opcional do cadastro operacional existente (comportamento não muda)
alter table public.funcionarios add column if not exists colaborador_id uuid references colaboradores(id);

-- ---------- ESCALAS ----------
create table if not exists public.escalas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  nome text not null,
  tipo text not null default 'fixo' check (tipo in ('5x2','6x1','12x36','fixo','livre')),
  ciclo_dias int,                          -- 12x36 => 2; escalas semanais => null
  tolerancia_minutos int not null default 10,
  vigencia_inicio date,
  vigencia_fim date,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

-- semanais: dia = 0(dom)..6(sáb); cíclicas (12x36): dia = posição no ciclo (0..ciclo_dias-1)
create table if not exists public.escala_dias (
  id uuid primary key default gen_random_uuid(),
  escala_id uuid not null references escalas(id) on delete cascade,
  dia smallint not null,
  trabalha boolean not null default true,
  entrada time,
  intervalo_inicio time,
  intervalo_fim time,
  saida time,
  unique (escala_id, dia)
);

-- atribuição com histórico: nunca sobrescrever — encerra data_fim e cria nova linha.
-- exclusion constraint impede duas escalas vigentes ao mesmo tempo para o colaborador.
create table if not exists public.colaborador_escalas (
  id uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references colaboradores(id) on delete cascade,
  escala_id uuid not null references escalas(id),
  data_inicio date not null,
  data_fim date,
  data_referencia_ciclo date,              -- âncora do ciclo (dia 0) para 12x36
  motivo text,
  criado_por uuid,                         -- auth.uid() de quem atribuiu
  created_at timestamptz not null default now(),
  exclude using gist (
    colaborador_id with =,
    daterange(data_inicio, coalesce(data_fim, 'infinity'::date), '[]') with &&
  )
);

-- ---------- AUDIT LOGS (append-only, imutável) ----------
create table if not exists public.ponto_audit_logs (
  id bigint generated always as identity primary key,
  ator_user_id uuid,                       -- auth.uid() quando via browser
  ator_tipo text not null default 'usuario' check (ator_tipo in ('usuario','dispositivo','sistema')),
  ator_dispositivo_id uuid,
  acao text not null,                      -- INSERT/UPDATE/DELETE ou ação aplicativa
  entidade text not null,
  entidade_id text,
  valores_antes jsonb,
  valores_depois jsonb,
  motivo text,
  ip text,
  user_agent text,
  hash text,                               -- sha256 do payload (integridade individual)
  created_at timestamptz not null default now()
);
create index if not exists ponto_audit_logs_entidade_idx on ponto_audit_logs (entidade, entidade_id);

create or replace function public.fn_bloquear_alteracao()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Tabela % é imutável (append-only).', tg_table_name;
end $$;

drop trigger if exists trg_audit_imutavel on public.ponto_audit_logs;
create trigger trg_audit_imutavel
  before update or delete on public.ponto_audit_logs
  for each statement execute function public.fn_bloquear_alteracao();

revoke update, delete, truncate on public.ponto_audit_logs from anon, authenticated, service_role;

-- trigger genérica de auditoria de DML nas tabelas de cadastro do ponto
create or replace function public.fn_audit()
returns trigger
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_id text;
begin
  v_id := case when tg_op = 'DELETE' then old.id::text else new.id::text end;
  insert into ponto_audit_logs (ator_user_id, ator_tipo, ator_dispositivo_id, acao, entidade, entidade_id,
                          valores_antes, valores_depois, motivo, hash)
  values (
    auth.uid(),
    case when auth.uid() is not null then 'usuario'
         when nullif(current_setting('app.dispositivo_id', true), '') is not null then 'dispositivo'
         else 'sistema' end,
    nullif(current_setting('app.dispositivo_id', true), '')::uuid,
    tg_op, tg_table_name, v_id,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
    nullif(current_setting('app.motivo', true), ''),
    encode(digest(coalesce(to_jsonb(new)::text, to_jsonb(old)::text), 'sha256'), 'hex')
  );
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['empregadores','unidades','centros_custo','colaboradores',
                           'colaborador_unidades','escalas','escala_dias','colaborador_escalas']
  loop
    execute format('drop trigger if exists trg_audit on public.%I;', t);
    execute format('create trigger trg_audit after insert or update or delete on public.%I
                    for each row execute function public.fn_audit();', t);
  end loop;
end $$;

-- ---------- RLS ----------

-- empregadores: nível grupo — leitura para quem tem o módulo ponto, escrita admin
alter table public.empregadores enable row level security;
drop policy if exists "empregadores_select" on public.empregadores;
create policy "empregadores_select" on public.empregadores
  for select using (public.tem_modulo('ponto'));
drop policy if exists "empregadores_admin_write" on public.empregadores;
create policy "empregadores_admin_write" on public.empregadores
  for all using (public.is_admin()) with check (public.is_admin());

-- tabelas com empresa_id: padrão empresa_scoped + módulo ponto
do $$
declare t text;
begin
  foreach t in array array['centros_custo','colaboradores','escalas']
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "ponto_empresa_scoped" on public.%I;', t);
    execute format($f$
      create policy "ponto_empresa_scoped" on %I for all
      using (public.tem_modulo('ponto') and empresa_id in (select public.empresas_permitidas()))
      with check (public.tem_modulo('ponto') and empresa_id in (select public.empresas_permitidas()));
    $f$, t);
  end loop;
end $$;

-- filhas sem empresa_id: resolve pela tabela-mãe
alter table public.colaborador_unidades enable row level security;
drop policy if exists "via_colaborador" on public.colaborador_unidades;
create policy "via_colaborador" on public.colaborador_unidades for all
  using (public.tem_modulo('ponto') and exists (
    select 1 from colaboradores c where c.id = colaborador_id
      and c.empresa_id in (select public.empresas_permitidas())))
  with check (public.tem_modulo('ponto') and exists (
    select 1 from colaboradores c where c.id = colaborador_id
      and c.empresa_id in (select public.empresas_permitidas())));

alter table public.escala_dias enable row level security;
drop policy if exists "via_escala" on public.escala_dias;
create policy "via_escala" on public.escala_dias for all
  using (public.tem_modulo('ponto') and exists (
    select 1 from escalas e where e.id = escala_id
      and e.empresa_id in (select public.empresas_permitidas())))
  with check (public.tem_modulo('ponto') and exists (
    select 1 from escalas e where e.id = escala_id
      and e.empresa_id in (select public.empresas_permitidas())));

alter table public.colaborador_escalas enable row level security;
drop policy if exists "via_colaborador" on public.colaborador_escalas;
create policy "via_colaborador" on public.colaborador_escalas for all
  using (public.tem_modulo('ponto') and exists (
    select 1 from colaboradores c where c.id = colaborador_id
      and c.empresa_id in (select public.empresas_permitidas())))
  with check (public.tem_modulo('ponto') and exists (
    select 1 from colaboradores c where c.id = colaborador_id
      and c.empresa_id in (select public.empresas_permitidas())));

-- ponto_audit_logs: leitura só admin; sem policy de insert para authenticated
-- (inserts acontecem só pela trigger fn_audit, que é security definer)
alter table public.ponto_audit_logs enable row level security;
drop policy if exists "audit_admin_select" on public.ponto_audit_logs;
create policy "audit_admin_select" on public.ponto_audit_logs
  for select using (public.is_admin());
