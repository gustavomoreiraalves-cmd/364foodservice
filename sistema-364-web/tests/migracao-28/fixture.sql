-- Esqueleto mínimo para exercitar a atualização 28 num Postgres local.
create schema if not exists auth;
create or replace function auth.uid() returns uuid
  language sql stable as $$ select nullif(current_setting('req.uid', true), '')::uuid $$;

create table empresas (id uuid primary key, nome text);
create table fornecedores (id uuid primary key, empresa_id uuid references empresas(id), nome text);
create table materias_primas (id uuid primary key, empresa_id uuid references empresas(id), nome text);
create table produtos (id uuid primary key, empresa_id uuid references empresas(id), nome text);
create table funcionarios (id uuid primary key, empresa_id uuid references empresas(id), nome text);
create table producoes (id uuid primary key, empresa_id uuid references empresas(id));

-- Só as colunas que registrar_impressao lê no ramo `producao_interna`.
create table producoes_internas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references empresas(id),
  status text,
  codigo text
);

create table recebimentos (
  id uuid primary key default gen_random_uuid(),
  data date not null default current_date,
  fornecedor_id uuid references fornecedores(id),
  nota_fiscal text,
  empresa_id uuid references empresas(id)
);

create table recebimento_itens (
  id uuid primary key default gen_random_uuid(),
  recebimento_id uuid not null references recebimentos(id) on delete cascade,
  materia_prima_id uuid not null references materias_primas(id),
  lote text not null,
  quantidade numeric(12,4) not null,
  custo_unitario numeric(12,2) not null,
  empresa_id uuid not null references empresas(id)
);

create table etiqueta_impressoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  source_type text not null check (source_type in ('producao','producao_interna')),
  source_id uuid not null,
  tipo text not null check (tipo in ('original','reimpressao')),
  quantidade int not null check (quantidade > 0),
  modelo text not null default 'validade-cozinha',
  impressora text,
  motivo text,
  usuario_id uuid,
  usuario_nome text,
  created_at timestamptz not null default now()
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  usuario_id uuid, acao text not null, recurso text, recurso_id uuid,
  valores_anteriores jsonb, valores_novos jsonb, justificativa text,
  created_at timestamptz not null default now()
);

-- Vem da migração 11; a 17 usa em trigger de imutabilidade de
-- `etiqueta_impressoes`. Sem isso o runner não provaria nada sobre o
-- rollback: em produção o `delete`/`update` nessa tabela é sempre recusado.
create or replace function public.fn_bloquear_alteracao() returns trigger
  language plpgsql as $$
begin
  raise exception 'Tabela % é imutável (append-only).', tg_table_name;
end $$;

drop trigger if exists trg_etiqueta_impressoes_imutavel on etiqueta_impressoes;
create trigger trg_etiqueta_impressoes_imutavel
  before update or delete on etiqueta_impressoes
  for each statement execute function public.fn_bloquear_alteracao();

-- Dublês das funções de permissão que a RPC usa. Os cenários controlam o
-- retorno por `req.*`, sem precisar montar RLS.
create or replace function public.empresas_permitidas() returns setof uuid
  language sql stable as $$ select id from empresas
    where coalesce(current_setting('req.empresa_bloqueada', true), '') <> id::text $$;
create or replace function public.tem_permissao(m text) returns boolean
  language sql stable as $$
  select coalesce(current_setting('req.permissoes', true), 'recebimentos,producoes') like '%' || m || '%' $$;
create or replace function public.fn_nome_usuario() returns text
  language sql stable as $$ select 'Operador de Teste' $$;
create or replace function public.fn_registrar_auditoria(
  p_recurso text, p_recurso_id uuid, p_acao text, p_empresa uuid,
  p_anteriores jsonb, p_novos jsonb, p_justificativa text)
  returns void language sql as $$
  insert into audit_logs (empresa_id, usuario_id, acao, recurso, recurso_id,
                          valores_anteriores, valores_novos, justificativa)
  values (p_empresa, auth.uid(), p_acao, p_recurso, p_recurso_id, p_anteriores, p_novos, p_justificativa) $$;

-- A RPC anterior à 28, para provar que a migração a substitui.
create or replace function public.registrar_impressao(
  p_source_type text, p_source_id uuid, p_tipo text, p_quantidade int,
  p_modelo text default 'validade-cozinha', p_impressora text default null, p_motivo text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  raise exception 'versão anterior da RPC: source_type inválido: %', p_source_type;
end $$;

insert into empresas (id, nome) values ('11111111-1111-1111-1111-111111111111', 'Food Services');
insert into fornecedores (id, empresa_id, nome) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Vale Grande');
insert into materias_primas (id, empresa_id, nome) values ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'Costela Bovina');
insert into produtos (id, empresa_id, nome) values ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'Costela Defumada 500g');
insert into recebimentos (id, empresa_id, fornecedor_id, nota_fiscal) values ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '61.379.327');
insert into recebimento_itens (id, recebimento_id, materia_prima_id, lote, quantidade, custo_unitario, empresa_id)
  values ('66666666-6666-6666-6666-666666666666', '55555555-5555-5555-5555-555555555555', '33333333-3333-3333-3333-333333333333', 'LT-260821-001', 180, 21.90, '11111111-1111-1111-1111-111111111111');
