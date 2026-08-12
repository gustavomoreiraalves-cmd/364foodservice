-- =========================================================
-- 364 — ATUALIZAÇÃO 12: PONTO — DISPOSITIVOS, BIOMETRIA E
-- MARCAÇÕES (NSR sequencial + hash encadeado, imutáveis)
-- Rode este arquivo inteiro no SQL Editor do Supabase
-- (depois de atualizacao_11_ponto_cadastros.sql).
--
-- ATENÇÃO:
-- * Dispositivos (token), biometrias (descritor) e marcações são
--   escritos SOMENTE pelas rotas /api/ponto/* (service role).
--   O browser autenticado só lê metadados.
-- * Grants por coluna: se estas tabelas ganharem colunas novas,
--   os "grant select (colunas...)" abaixo precisam ser refeitos.
-- =========================================================

-- ---------- DISPOSITIVOS (tablets quiosque) ----------
create table if not exists public.ponto_dispositivos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  unidade_id uuid not null references unidades(id),
  nome text not null,
  codigo_ativacao text,                    -- 6 dígitos, uso único
  codigo_ativacao_expira timestamptz,
  token_hash text,                         -- sha256 do token; o token só sai 1x, na ativação
  status text not null default 'pendente' check (status in ('pendente','ativo','bloqueado')),
  ultimo_visto_em timestamptz,
  versao_app text,
  criado_por uuid,
  created_at timestamptz not null default now()
);
alter table public.ponto_dispositivos enable row level security;
drop policy if exists "ponto_dispositivos_select" on public.ponto_dispositivos;
create policy "ponto_dispositivos_select" on public.ponto_dispositivos
  for select using (public.tem_modulo('ponto') and empresa_id in (select public.empresas_permitidas()));
-- escrita de metadados (nome/status) pelo admin; código e token só via API
drop policy if exists "ponto_dispositivos_admin_write" on public.ponto_dispositivos;
create policy "ponto_dispositivos_admin_write" on public.ponto_dispositivos
  for all using (public.is_admin()) with check (public.is_admin());
-- browser nunca lê o código de ativação nem o hash do token
revoke select on public.ponto_dispositivos from authenticated;
grant select (id, empresa_id, unidade_id, nome, codigo_ativacao_expira, status,
              ultimo_visto_em, versao_app, criado_por, created_at)
  on public.ponto_dispositivos to authenticated;

drop trigger if exists trg_audit on public.ponto_dispositivos;
create trigger trg_audit after insert or update or delete on public.ponto_dispositivos
  for each row execute function public.fn_audit();

-- ---------- PIN DE CONTINGÊNCIA (só servidor) ----------
create table if not exists public.ponto_pins (
  colaborador_id uuid primary key references colaboradores(id) on delete cascade,
  pin_hash text not null,                  -- sha256(pin + salt por colaborador)
  salt text not null,
  updated_at timestamptz not null default now()
);
alter table public.ponto_pins enable row level security;
-- nenhuma policy: browser não lê nem escreve; só service role (bypassa RLS)
revoke all on public.ponto_pins from anon, authenticated;

-- ---------- BIOMETRIAS (descritores 128-d CIFRADOS; nunca foto bruta) ----------
create table if not exists public.ponto_biometrias (
  id uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references colaboradores(id) on delete cascade,
  tipo text not null default 'face_descritor',
  descritor_cifrado text not null,         -- base64 iv:tag:cipher (AES-256-GCM na API)
  algoritmo text not null default 'face-api/faceRecognitionNet@1',
  qualidade numeric(4,3),                  -- score de detecção da amostra
  amostra int not null default 1,          -- 1..N amostras por colaborador
  cadastrado_por uuid not null,            -- auth.uid() do RH que cadastrou
  dispositivo_id uuid references ponto_dispositivos(id),
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists ponto_biometrias_colab_idx on ponto_biometrias (colaborador_id);
alter table public.ponto_biometrias enable row level security;
drop policy if exists "ponto_biometrias_select" on public.ponto_biometrias;
create policy "ponto_biometrias_select" on public.ponto_biometrias
  for select using (public.tem_modulo('ponto') and exists (
    select 1 from colaboradores c where c.id = colaborador_id
      and c.empresa_id in (select public.empresas_permitidas())));
-- browser só enxerga METADADOS; o descritor cifrado só sai via service role
revoke select on public.ponto_biometrias from authenticated;
grant select (id, colaborador_id, tipo, algoritmo, qualidade, amostra,
              cadastrado_por, dispositivo_id, ativo, created_at)
  on public.ponto_biometrias to authenticated;
-- sem policy de insert/update/delete para authenticated: escrita só pela API

drop trigger if exists trg_audit on public.ponto_biometrias;
create trigger trg_audit after insert or update or delete on public.ponto_biometrias
  for each row execute function public.fn_audit();

-- ---------- LGPD: AVISO DE PRIVACIDADE + CONSENTIMENTOS ----------
create table if not exists public.ponto_avisos_privacidade (
  id uuid primary key default gen_random_uuid(),
  versao int not null unique,
  texto text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.ponto_avisos_privacidade enable row level security;
drop policy if exists "avisos_select" on public.ponto_avisos_privacidade;
create policy "avisos_select" on public.ponto_avisos_privacidade
  for select using (public.tem_modulo('ponto'));
drop policy if exists "avisos_admin_write" on public.ponto_avisos_privacidade;
create policy "avisos_admin_write" on public.ponto_avisos_privacidade
  for all using (public.is_admin()) with check (public.is_admin());

create table if not exists public.ponto_consentimentos (
  id uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references colaboradores(id),
  aviso_id uuid not null references ponto_avisos_privacidade(id),
  tipo text not null default 'ciencia_biometria' check (tipo in ('ciencia_biometria','revogacao')),
  base_legal text not null default 'obrigacao_legal',   -- registrar a base do art. 7º/11º LGPD usada
  coletado_por uuid not null,
  meio text not null default 'presencial_sistema',
  hash_texto text not null,                -- sha256 do texto do aviso no momento da ciência
  created_at timestamptz not null default now()
);
alter table public.ponto_consentimentos enable row level security;
drop policy if exists "consentimentos_select" on public.ponto_consentimentos;
create policy "consentimentos_select" on public.ponto_consentimentos
  for select using (public.tem_modulo('ponto') and exists (
    select 1 from colaboradores c where c.id = colaborador_id
      and c.empresa_id in (select public.empresas_permitidas())));
-- escrita só via API (service role)

insert into ponto_avisos_privacidade (versao, texto)
select 1, 'Aviso de privacidade — o Grupo 364 trata dados biométricos faciais dos colaboradores com a finalidade exclusiva de registro eletrônico de jornada de trabalho, conforme legislação trabalhista aplicável. Os dados são armazenados de forma criptografada, não são compartilhados com terceiros e serão eliminados conforme a política de retenção. (Substituir pelo texto jurídico final validado pela assessoria.)'
where not exists (select 1 from ponto_avisos_privacidade where versao = 1);

-- ---------- NSR: CONTROLE SEQUENCIAL POR EMPREGADOR ----------
create table if not exists public.ponto_nsr_controle (
  empregador_id uuid primary key references empregadores(id),
  ultimo_nsr bigint not null default 0
);
alter table public.ponto_nsr_controle enable row level security;
-- sem policies: só service role / funções security definer

-- ---------- MARCAÇÕES ORIGINAIS (imutáveis, hash encadeado) ----------
create table if not exists public.ponto_marcacoes (
  id uuid primary key default gen_random_uuid(),
  idempotencia uuid unique not null,       -- gerada no cliente; retry de rede não duplica
  empregador_id uuid not null references empregadores(id),
  empresa_id uuid not null references empresas(id),
  unidade_id uuid not null references unidades(id),
  colaborador_id uuid not null references colaboradores(id),
  dispositivo_id uuid references ponto_dispositivos(id),
  nsr bigint not null,
  tipo text not null check (tipo in ('entrada','intervalo_inicio','intervalo_fim','saida')),
  data_hora_utc timestamptz not null,      -- HORA OFICIAL: now() do Postgres, nunca do cliente
  data_hora_local timestamp not null,
  fuso text not null,
  capturado_em_cliente timestamptz,        -- relógio do tablet (só referência/perícia)
  offset_relogio_ms int,                   -- desvio medido do relógio do device
  metodo text not null check (metodo in ('facial','pin','manual_gestor')),
  score_similaridade numeric(6,4),         -- distância euclidiana (menor = melhor)
  liveness_ok boolean,
  liveness_detalhe jsonb,                  -- {"piscadas":2,"ear_min":0.18,...}
  descritor_capturado_cifrado text,        -- descritor ao vivo, p/ re-verificação futura
  origem text not null default 'quiosque' check (origem in ('quiosque','web_gestor')),
  motivo_manual text,                      -- obrigatório quando metodo='manual_gestor'
  registrado_por uuid,                     -- auth.uid() do gestor (contingência)
  status text not null default 'valida' check (status in ('valida','pendente')),
  previous_hash text not null,
  record_hash text not null,
  created_at timestamptz not null default now(),
  unique (empregador_id, nsr)
);
create index if not exists ponto_marcacoes_colab_dia_idx on ponto_marcacoes (colaborador_id, data_hora_utc);
create index if not exists ponto_marcacoes_empresa_idx on ponto_marcacoes (empresa_id, data_hora_utc);

-- imutabilidade: trigger + revoke (grants valem inclusive p/ service_role)
drop trigger if exists trg_marcacao_imutavel on public.ponto_marcacoes;
create trigger trg_marcacao_imutavel
  before update or delete on public.ponto_marcacoes
  for each statement execute function public.fn_bloquear_alteracao();
revoke update, delete, truncate on public.ponto_marcacoes from anon, authenticated, service_role;

alter table public.ponto_marcacoes enable row level security;
drop policy if exists "ponto_marcacoes_select" on public.ponto_marcacoes;
create policy "ponto_marcacoes_select" on public.ponto_marcacoes
  for select using (public.tem_modulo('ponto') and empresa_id in (select public.empresas_permitidas()));
-- browser não lê o descritor capturado
revoke select on public.ponto_marcacoes from authenticated;
grant select (id, idempotencia, empregador_id, empresa_id, unidade_id, colaborador_id,
              dispositivo_id, nsr, tipo, data_hora_utc, data_hora_local, fuso,
              capturado_em_cliente, offset_relogio_ms, metodo, score_similaridade,
              liveness_ok, liveness_detalhe, origem, motivo_manual, registrado_por,
              status, previous_hash, record_hash, created_at)
  on public.ponto_marcacoes to authenticated;
-- sem policy de insert p/ authenticated: só registrar_marcacao (service role) insere

-- ---------- TENTATIVAS RECUSADAS (telemetria/antifraude) ----------
create table if not exists public.ponto_tentativas (
  id bigint generated always as identity primary key,
  empresa_id uuid not null,
  unidade_id uuid not null,
  dispositivo_id uuid,
  motivo text not null check (motivo in ('sem_match','liveness_falhou','colaborador_bloqueado',
                                         'fora_da_unidade','pin_invalido','dispositivo_bloqueado')),
  melhor_score numeric(6,4),
  colaborador_proximo_id uuid,
  created_at timestamptz not null default now()
);
alter table public.ponto_tentativas enable row level security;
drop policy if exists "ponto_tentativas_select" on public.ponto_tentativas;
create policy "ponto_tentativas_select" on public.ponto_tentativas
  for select using (public.tem_modulo('ponto') and empresa_id in (select public.empresas_permitidas()));
-- escrita só via API (service role)

-- ---------- FUNÇÃO DE GRAVAÇÃO (NSR transacional + hash chain) ----------
create or replace function public.registrar_marcacao(
  p_idempotencia uuid,
  p_empregador_id uuid,
  p_empresa_id uuid,
  p_unidade_id uuid,
  p_colaborador_id uuid,
  p_dispositivo_id uuid,
  p_tipo text,
  p_metodo text,
  p_score numeric,
  p_liveness_ok boolean,
  p_liveness_detalhe jsonb,
  p_descritor_cifrado text,
  p_fuso text,
  p_capturado_em_cliente timestamptz,
  p_offset_relogio_ms int,
  p_origem text,
  p_motivo_manual text,
  p_registrado_por uuid
) returns public.ponto_marcacoes
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_nsr bigint;
  v_prev text;
  v_row ponto_marcacoes;
  v_agora timestamptz := now();            -- HORA OFICIAL: relógio do Postgres
  v_local timestamp;
  v_fuso text := coalesce(p_fuso, 'America/Sao_Paulo');
begin
  -- retry de rede: mesma idempotência devolve a marcação já gravada, sem novo NSR
  select * into v_row from ponto_marcacoes where idempotencia = p_idempotencia;
  if found then
    return v_row;
  end if;

  -- serializa o NSR por empregador via lock de linha (sem furo, sem duplicidade)
  insert into ponto_nsr_controle (empregador_id) values (p_empregador_id)
    on conflict (empregador_id) do nothing;
  select ultimo_nsr + 1 into v_nsr
    from ponto_nsr_controle
   where empregador_id = p_empregador_id
     for update;
  update ponto_nsr_controle set ultimo_nsr = v_nsr where empregador_id = p_empregador_id;

  select record_hash into v_prev
    from ponto_marcacoes
   where empregador_id = p_empregador_id and nsr = v_nsr - 1;
  v_prev := coalesce(v_prev, 'GENESIS');

  v_local := v_agora at time zone v_fuso;

  insert into ponto_marcacoes (
    idempotencia, empregador_id, empresa_id, unidade_id, colaborador_id, dispositivo_id,
    nsr, tipo, data_hora_utc, data_hora_local, fuso, capturado_em_cliente, offset_relogio_ms,
    metodo, score_similaridade, liveness_ok, liveness_detalhe, descritor_capturado_cifrado,
    origem, motivo_manual, registrado_por, previous_hash, record_hash
  ) values (
    p_idempotencia, p_empregador_id, p_empresa_id, p_unidade_id, p_colaborador_id, p_dispositivo_id,
    v_nsr, p_tipo, v_agora, v_local, v_fuso, p_capturado_em_cliente, p_offset_relogio_ms,
    p_metodo, p_score, p_liveness_ok, p_liveness_detalhe, p_descritor_cifrado,
    coalesce(p_origem, 'quiosque'), p_motivo_manual, p_registrado_por,
    v_prev,
    encode(digest(
      p_empregador_id::text || '|' || v_nsr || '|' || p_colaborador_id::text || '|' || p_tipo || '|' ||
      to_char(v_agora at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' ||
      p_metodo || '|' || coalesce(p_dispositivo_id::text, '-') || '|' || v_prev,
      'sha256'), 'hex')
  ) returning * into v_row;

  return v_row;
end $$;

-- só o servidor (service role) executa
revoke execute on function public.registrar_marcacao(uuid,uuid,uuid,uuid,uuid,uuid,text,text,
  numeric,boolean,jsonb,text,text,timestamptz,int,text,text,uuid) from public, anon, authenticated;

-- ---------- VERIFICAÇÃO DE INTEGRIDADE DA CADEIA ----------
-- Recomputa os hashes por NSR e retorna o primeiro NSR divergente (null = cadeia íntegra).
create or replace function public.verificar_cadeia_marcacoes(p_empregador_id uuid)
returns bigint
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  r record;
  v_prev text := 'GENESIS';
  v_esperado text;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem verificar a cadeia.';
  end if;

  for r in
    select * from ponto_marcacoes
     where empregador_id = p_empregador_id
     order by nsr
  loop
    if r.previous_hash is distinct from v_prev then
      return r.nsr;
    end if;
    v_esperado := encode(digest(
      r.empregador_id::text || '|' || r.nsr || '|' || r.colaborador_id::text || '|' || r.tipo || '|' ||
      to_char(r.data_hora_utc at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' ||
      r.metodo || '|' || coalesce(r.dispositivo_id::text, '-') || '|' || r.previous_hash,
      'sha256'), 'hex');
    if r.record_hash is distinct from v_esperado then
      return r.nsr;
    end if;
    v_prev := r.record_hash;
  end loop;

  return null;
end $$;
