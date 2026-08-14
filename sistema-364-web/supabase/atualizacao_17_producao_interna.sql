-- =========================================================
-- 364 — ATUALIZAÇÃO 17: PRODUÇÃO INTERNA (SINTÉTICA) + ETIQUETAS
--
-- Evolui o módulo Produção para suportar dois tipos de processo:
--   • Produção Completa (fluxo atual da Food Services — INTOCADO:
--     producoes/producao_consumo/defumacoes/embalagens continuam iguais)
--   • Produção Interna/Sintética (cozinhas do grupo: molhos, preparos,
--     insumos fracionados) com regras de validade por conservação,
--     identificação única PRD-INT-######, descarte e etiquetas.
--
-- A etiqueta consome os dados da produção (source_type/source_id) —
-- nunca redigitação. Validações críticas ficam em funções RPC
-- (security definer) porque o frontend fala direto com o Supabase.
--
-- Rode este arquivo inteiro no SQL Editor do Supabase,
-- depois de atualizacao_16_financeiro_contas_a_pagar.sql.
-- =========================================================

-- ---------- PRODUTOS: flag de produção interna + modelo de etiqueta ----------
alter table produtos add column if not exists producao_interna boolean not null default false;
alter table produtos add column if not exists modelo_etiqueta text; -- null = modelo padrão 'validade-cozinha'

-- ---------- REGRAS DE CONSERVAÇÃO/VALIDADE POR PRODUTO ----------
create table if not exists produto_regras_validade (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  produto_id uuid not null references produtos(id) on delete cascade,
  conservacao text not null check (conservacao in ('ambiente','resfriado','congelado')),
  permitido boolean not null default true,
  validade_valor int check (validade_valor > 0),
  validade_unidade text check (validade_unidade in ('horas','dias')),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (produto_id, conservacao),
  -- se a conservação é permitida, o prazo é obrigatório
  check ((not permitido) or (validade_valor is not null and validade_unidade is not null))
);

-- ---------- PRODUÇÕES INTERNAS ----------
create sequence if not exists producoes_internas_codigo_seq;

create table if not exists producoes_internas (
  id uuid primary key default gen_random_uuid(),
  codigo text unique,                          -- PRD-INT-000001 (gerado por trigger)
  empresa_id uuid not null references empresas(id),
  unidade_id uuid references unidades(id),
  produto_id uuid not null references produtos(id),
  produzido_em timestamptz not null default now(),
  conservacao text not null check (conservacao in ('ambiente','resfriado','congelado')),
  validade timestamptz,
  validade_calculada timestamptz,              -- valor calculado pela regra (auditoria do override)
  validade_manual boolean not null default false,
  validade_motivo text,
  quantidade numeric(12,3),
  unidade_medida text,
  recipientes int check (recipientes > 0),
  responsavel_user_id uuid references auth.users(id),
  responsavel_funcionario_id uuid references funcionarios(id),
  status text not null default 'rascunho'
    check (status in ('rascunho','em_producao','finalizada','descartada','cancelada')),
  observacoes text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finalizada_em timestamptz,
  cancelada_em timestamptz
);
create index if not exists producoes_internas_empresa_idx on producoes_internas (empresa_id, status);
create index if not exists producoes_internas_validade_idx on producoes_internas (empresa_id, validade);

create or replace function public.fn_producao_interna_codigo()
returns trigger
language plpgsql
as $$
begin
  if new.codigo is null then
    new.codigo := 'PRD-INT-' || lpad(nextval('producoes_internas_codigo_seq')::text, 6, '0');
  end if;
  return new;
end $$;

drop trigger if exists trg_producao_interna_codigo on producoes_internas;
create trigger trg_producao_interna_codigo
  before insert on producoes_internas
  for each row execute function public.fn_producao_interna_codigo();

create or replace function public.fn_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_producao_interna_updated on producoes_internas;
create trigger trg_producao_interna_updated
  before update on producoes_internas
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_regras_validade_updated on produto_regras_validade;
create trigger trg_regras_validade_updated
  before update on produto_regras_validade
  for each row execute function public.fn_set_updated_at();

-- Produção finalizada/descartada/cancelada: campos críticos imutáveis.
-- Só status/cancelada_em/observacoes/updated_at podem mudar depois disso
-- (transições feitas pelas RPCs abaixo). Correções exigem cancelar + nova produção.
create or replace function public.fn_producao_interna_bloquear_edicao()
returns trigger
language plpgsql
as $$
declare
  campos_livres text[] := array['status','cancelada_em','observacoes','updated_at'];
begin
  if old.status <> 'rascunho'
     and (to_jsonb(new) - campos_livres) <> (to_jsonb(old) - campos_livres) then
    raise exception 'Produção % está com status "%" — campos críticos não podem ser alterados. Cancele e crie uma nova produção.', old.codigo, old.status;
  end if;
  if old.status in ('descartada','cancelada') and new.status <> old.status then
    raise exception 'Produção % já foi % — status final não pode mudar.', old.codigo, old.status;
  end if;
  return new;
end $$;

drop trigger if exists trg_producao_interna_bloqueio on producoes_internas;
create trigger trg_producao_interna_bloqueio
  before update on producoes_internas
  for each row execute function public.fn_producao_interna_bloquear_edicao();

-- ---------- ETIQUETAS: REGISTRO DE IMPRESSÕES (produção completa E interna) ----------
create table if not exists etiqueta_impressoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  source_type text not null check (source_type in ('producao','producao_interna')),
  source_id uuid not null,
  tipo text not null check (tipo in ('original','reimpressao')),
  quantidade int not null check (quantidade > 0),
  modelo text not null default 'validade-cozinha',
  impressora text,
  motivo text,                                 -- obrigatório em reimpressão (validado na RPC)
  usuario_id uuid,
  usuario_nome text,
  created_at timestamptz not null default now()
);
create index if not exists etiqueta_impressoes_source_idx on etiqueta_impressoes (source_type, source_id);

-- ---------- DESCARTES DE PRODUÇÃO INTERNA ----------
create table if not exists producao_descartes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  producao_interna_id uuid not null references producoes_internas(id),
  quantidade numeric(12,3),
  unidade_medida text,
  motivo text not null,
  observacao text,
  usuario_id uuid,
  usuario_nome text,
  created_at timestamptz not null default now()
);

-- ---------- AUDITORIA GLOBAL (mesma estrutura do ponto_audit_logs) ----------
create table if not exists audit_logs (
  id bigint generated always as identity primary key,
  ator_user_id uuid,
  acao text not null,
  entidade text not null,
  entidade_id text,
  empresa_id uuid,
  valores_antes jsonb,
  valores_depois jsonb,
  motivo text,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_entidade_idx on audit_logs (entidade, entidade_id);

drop trigger if exists trg_audit_logs_imutavel on audit_logs;
create trigger trg_audit_logs_imutavel
  before update or delete on audit_logs
  for each statement execute function public.fn_bloquear_alteracao();

drop trigger if exists trg_etiqueta_impressoes_imutavel on etiqueta_impressoes;
create trigger trg_etiqueta_impressoes_imutavel
  before update or delete on etiqueta_impressoes
  for each statement execute function public.fn_bloquear_alteracao();

drop trigger if exists trg_producao_descartes_imutavel on producao_descartes;
create trigger trg_producao_descartes_imutavel
  before update or delete on producao_descartes
  for each statement execute function public.fn_bloquear_alteracao();

-- ---------- RLS ----------
alter table produto_regras_validade enable row level security;
alter table producoes_internas enable row level security;
alter table etiqueta_impressoes enable row level security;
alter table producao_descartes enable row level security;
alter table audit_logs enable row level security;

do $$
declare t text;
begin
  for t in select unnest(array['produto_regras_validade','producoes_internas'])
  loop
    execute format('drop policy if exists "empresa_scoped_access" on %I;', t);
    execute format($f$
      create policy "empresa_scoped_access" on %I
      for all
      using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()))
      with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));
    $f$, t);
  end loop;
end $$;

-- impressões/descartes: leitura por empresa; escrita SÓ via RPC (security definer)
drop policy if exists "empresa_select" on etiqueta_impressoes;
create policy "empresa_select" on etiqueta_impressoes
  for select using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

drop policy if exists "empresa_select" on producao_descartes;
create policy "empresa_select" on producao_descartes
  for select using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

-- auditoria: leitura restrita a admin
drop policy if exists "audit_select_admin" on audit_logs;
create policy "audit_select_admin" on audit_logs
  for select using (public.is_admin());

revoke update, delete, truncate on audit_logs from anon, authenticated;
revoke update, delete, truncate on etiqueta_impressoes from anon, authenticated;
revoke update, delete, truncate on producao_descartes from anon, authenticated;

-- ---------- HELPERS ----------
-- permissões granulares reutilizam a tabela `permissoes` (uma linha por chave);
-- 'admin' passa em qualquer checagem.
create or replace function public.tem_permissao(p_modulo text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from permissoes
    where user_id = auth.uid() and modulo in (p_modulo, 'admin')
  );
$$;

create or replace function public.fn_nome_usuario()
returns text
language sql stable
as $$
  select coalesce(auth.jwt() -> 'user_metadata' ->> 'nome', auth.jwt() ->> 'email');
$$;

create or replace function public.fn_registrar_auditoria(
  p_entidade text, p_entidade_id text, p_acao text,
  p_empresa_id uuid, p_antes jsonb, p_depois jsonb, p_motivo text default null
)
returns void
language sql security definer
set search_path = public
as $$
  insert into audit_logs (ator_user_id, acao, entidade, entidade_id, empresa_id, valores_antes, valores_depois, motivo)
  values (auth.uid(), p_acao, p_entidade, p_entidade_id, p_empresa_id, p_antes, p_depois, p_motivo);
$$;

-- ---------- CÁLCULO DE VALIDADE (autoridade = banco) ----------
create or replace function public.calcular_validade_interna(
  p_produto_id uuid, p_conservacao text, p_produzido_em timestamptz
)
returns timestamptz
language plpgsql stable security definer
set search_path = public
as $$
declare
  r produto_regras_validade%rowtype;
  v_nome text;
begin
  select nome into v_nome from produtos where id = p_produto_id;
  select * into r from produto_regras_validade
    where produto_id = p_produto_id and conservacao = p_conservacao and ativo
    limit 1;
  if not found or not r.permitido then
    raise exception 'O produto % não possui conservação "%" autorizada.', coalesce(v_nome, '?'), p_conservacao;
  end if;
  if r.validade_unidade = 'horas' then
    return p_produzido_em + make_interval(hours => r.validade_valor);
  end if;
  return p_produzido_em + make_interval(days => r.validade_valor);
end $$;

-- ---------- FINALIZAR (transacional: valida, calcula validade, audita) ----------
create or replace function public.finalizar_producao_interna(
  p_id uuid,
  p_validade_manual timestamptz default null,
  p_motivo_validade text default null
)
returns producoes_internas
language plpgsql security definer
set search_path = public
as $$
declare
  v producoes_internas%rowtype;
  v_antes jsonb;
  v_calc timestamptz;
begin
  select * into v from producoes_internas where id = p_id for update;
  if not found then raise exception 'Produção não encontrada.'; end if;
  if v.empresa_id not in (select public.empresas_permitidas()) then
    raise exception 'Sem acesso à empresa desta produção.';
  end if;
  if not public.tem_permissao('producoes') then
    raise exception 'Sem permissão para finalizar produção.';
  end if;
  if v.status not in ('rascunho','em_producao') then
    raise exception 'Produção % já está com status "%".', v.codigo, v.status;
  end if;
  -- responsável diferente do usuário logado exige permissão específica
  if v.responsavel_funcionario_id is not null
     and not exists (select 1 from funcionarios f where f.id = v.responsavel_funcionario_id and f.user_id = auth.uid())
     and not public.tem_permissao('producoes.responsavel_outro') then
    raise exception 'Sem permissão para atribuir outro responsável pela produção.';
  end if;

  v_calc := public.calcular_validade_interna(v.produto_id, v.conservacao, v.produzido_em);
  v_antes := to_jsonb(v);

  if p_validade_manual is not null and p_validade_manual <> v_calc then
    if not public.tem_permissao('producoes.validade_override') then
      raise exception 'Sem permissão para alterar a validade calculada.';
    end if;
    if p_motivo_validade is null or btrim(p_motivo_validade) = '' then
      raise exception 'Informe o motivo da alteração manual da validade.';
    end if;
    update producoes_internas
      set validade = p_validade_manual, validade_calculada = v_calc,
          validade_manual = true, validade_motivo = p_motivo_validade,
          status = 'finalizada', finalizada_em = now()
      where id = p_id
      returning * into v;
  else
    update producoes_internas
      set validade = v_calc, validade_calculada = v_calc,
          validade_manual = false, validade_motivo = null,
          status = 'finalizada', finalizada_em = now()
      where id = p_id
      returning * into v;
  end if;

  perform public.fn_registrar_auditoria('producoes_internas', p_id::text, 'FINALIZAR',
                                        v.empresa_id, v_antes, to_jsonb(v), p_motivo_validade);
  return v;
end $$;

-- ---------- CANCELAR ----------
create or replace function public.cancelar_producao_interna(p_id uuid, p_motivo text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v producoes_internas%rowtype;
  v_antes jsonb;
begin
  select * into v from producoes_internas where id = p_id for update;
  if not found then raise exception 'Produção não encontrada.'; end if;
  if v.empresa_id not in (select public.empresas_permitidas()) then
    raise exception 'Sem acesso à empresa desta produção.';
  end if;
  if not public.tem_permissao('producoes') then
    raise exception 'Sem permissão para cancelar produção.';
  end if;
  if v.status in ('descartada','cancelada') then
    raise exception 'Produção % já está com status "%".', v.codigo, v.status;
  end if;
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'Informe o motivo do cancelamento.';
  end if;
  v_antes := to_jsonb(v);
  update producoes_internas set status = 'cancelada', cancelada_em = now() where id = p_id returning * into v;
  perform public.fn_registrar_auditoria('producoes_internas', p_id::text, 'CANCELAR',
                                        v.empresa_id, v_antes, to_jsonb(v), p_motivo);
end $$;

-- ---------- REGISTRAR DESCARTE ----------
create or replace function public.registrar_descarte_interno(
  p_id uuid, p_quantidade numeric, p_unidade text, p_motivo text, p_observacao text default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v producoes_internas%rowtype;
  v_antes jsonb;
begin
  select * into v from producoes_internas where id = p_id for update;
  if not found then raise exception 'Produção não encontrada.'; end if;
  if v.empresa_id not in (select public.empresas_permitidas()) then
    raise exception 'Sem acesso à empresa desta produção.';
  end if;
  if not public.tem_permissao('producoes.descarte') then
    raise exception 'Sem permissão para registrar descarte.';
  end if;
  if v.status <> 'finalizada' then
    raise exception 'Só é possível descartar produção finalizada (status atual: %).', v.status;
  end if;
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'Informe o motivo do descarte.';
  end if;
  v_antes := to_jsonb(v);
  insert into producao_descartes (empresa_id, producao_interna_id, quantidade, unidade_medida, motivo, observacao, usuario_id, usuario_nome)
  values (v.empresa_id, p_id, p_quantidade, p_unidade, p_motivo, p_observacao, auth.uid(), public.fn_nome_usuario());
  update producoes_internas set status = 'descartada' where id = p_id returning * into v;
  perform public.fn_registrar_auditoria('producoes_internas', p_id::text, 'DESCARTE',
                                        v.empresa_id, v_antes, to_jsonb(v), p_motivo);
end $$;

-- ---------- REGISTRAR IMPRESSÃO / REIMPRESSÃO ----------
-- Falha de impressão física nunca desfaz a produção: este registro é feito
-- quando o usuário dispara a impressão; produção e impressão são independentes.
create or replace function public.registrar_impressao(
  p_source_type text, p_source_id uuid, p_tipo text, p_quantidade int,
  p_modelo text default 'validade-cozinha', p_impressora text default null, p_motivo text default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_empresa uuid;
  v_status text;
  v_codigo text;
begin
  if p_source_type = 'producao_interna' then
    select empresa_id, status, codigo into v_empresa, v_status, v_codigo
      from producoes_internas where id = p_source_id;
    if not found then raise exception 'Produção interna não encontrada.'; end if;
    if v_status <> 'finalizada' then
      raise exception 'Etiquetas só podem ser impressas para produção finalizada (% está "%").', v_codigo, v_status;
    end if;
  elsif p_source_type = 'producao' then
    select empresa_id into v_empresa from producoes where id = p_source_id;
    if not found then raise exception 'Produção não encontrada.'; end if;
  else
    raise exception 'source_type inválido: %', p_source_type;
  end if;

  if v_empresa not in (select public.empresas_permitidas()) then
    raise exception 'Sem acesso à empresa desta produção.';
  end if;
  if not public.tem_permissao('producoes') then
    raise exception 'Sem permissão para imprimir etiquetas.';
  end if;
  if p_tipo = 'reimpressao' and (p_motivo is null or btrim(p_motivo) = '') then
    raise exception 'Informe o motivo da reimpressão.';
  end if;

  insert into etiqueta_impressoes (empresa_id, source_type, source_id, tipo, quantidade, modelo, impressora, motivo, usuario_id, usuario_nome)
  values (v_empresa, p_source_type, p_source_id, p_tipo, p_quantidade, p_modelo, p_impressora, p_motivo, auth.uid(), public.fn_nome_usuario());

  perform public.fn_registrar_auditoria('etiqueta_impressoes', p_source_id::text,
                                        case when p_tipo = 'reimpressao' then 'REIMPRESSAO' else 'IMPRESSAO' end,
                                        v_empresa, null,
                                        jsonb_build_object('source_type', p_source_type, 'quantidade', p_quantidade,
                                                           'modelo', p_modelo, 'impressora', p_impressora),
                                        p_motivo);
end $$;

-- =========================================================
-- PERMISSÕES GRANULARES (opcionais — 'admin' passa em todas)
-- Conceda por usuário conforme necessário:
--   insert into permissoes (user_id, modulo) values
--     ('<user_id>', 'producoes'),                    -- acesso ao módulo + finalizar/cancelar/imprimir
--     ('<user_id>', 'producoes.validade_override'),  -- alterar validade calculada (com motivo, auditado)
--     ('<user_id>', 'producoes.responsavel_outro'),  -- atribuir outro responsável pela produção
--     ('<user_id>', 'producoes.descarte');           -- registrar descarte
-- =========================================================
