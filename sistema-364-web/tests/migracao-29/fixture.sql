-- Esqueleto mínimo para exercitar a atualização 29 num Postgres local.
create schema if not exists auth;
create or replace function auth.uid() returns uuid
  language sql stable as $$ select nullif(current_setting('req.uid', true), '')::uuid $$;

create table empresas (id uuid primary key, nome text);
create table funcionarios (id uuid primary key, empresa_id uuid references empresas(id), nome text);
create table materias_primas (id uuid primary key, empresa_id uuid references empresas(id), nome text);
create table recebimentos (id uuid primary key default gen_random_uuid(), data date not null default current_date, empresa_id uuid references empresas(id));
create table recebimento_itens (
  id uuid primary key default gen_random_uuid(),
  recebimento_id uuid not null references recebimentos(id) on delete cascade,
  materia_prima_id uuid not null references materias_primas(id),
  lote text not null,
  quantidade numeric(12,4) not null,
  custo_unitario numeric(12,2) not null,
  volumes int,
  empresa_id uuid not null references empresas(id),
  unique (empresa_id, lote)
);

create table defumacoes (
  id uuid primary key default gen_random_uuid(),
  lote text not null,
  data date not null default current_date,
  hora_inicio time,
  hora_fim time,
  temperatura_c numeric(6,2),
  responsavel_id uuid references funcionarios(id),
  obs text,
  empresa_id uuid not null references empresas(id),
  created_at timestamptz not null default now()
);

create table defumacao_itens (
  id uuid primary key default gen_random_uuid(),
  defumacao_id uuid not null references defumacoes(id) on delete cascade,
  materia_prima_id uuid not null references materias_primas(id),
  peso_bruto_kg numeric(12,4),
  perda_limpeza_kg numeric(12,4),
  sobra_kg numeric(12,4),
  peso_final_kg numeric(12,4),
  empresa_id uuid not null references empresas(id)
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  usuario_id uuid, acao text not null, recurso text, recurso_id uuid,
  valores_anteriores jsonb, valores_novos jsonb, justificativa text,
  created_at timestamptz not null default now()
);

insert into empresas (id, nome) values ('11111111-1111-1111-1111-111111111111', 'Food Services');
insert into funcionarios (id, empresa_id, nome) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Defumador Teste');
insert into materias_primas (id, empresa_id, nome) values ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'Costela Bovina');
insert into recebimentos (id, empresa_id) values ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111');
insert into recebimento_itens (id, recebimento_id, materia_prima_id, lote, quantidade, custo_unitario, volumes, empresa_id)
  values ('55555555-5555-5555-5555-555555555555', '44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333', 'LT-260822-001', 180, 21.90, 20, '11111111-1111-1111-1111-111111111111');

-- Ficha legada, anterior à 29: sem status e sem lote de origem. Prova que a
-- migração não quebra o que já está em produção.
insert into defumacoes (id, lote, empresa_id) values ('66666666-6666-6666-6666-666666666666', 'DEF-LEGADO-001', '11111111-1111-1111-1111-111111111111');
insert into defumacao_itens (defumacao_id, materia_prima_id, peso_bruto_kg, peso_final_kg, empresa_id)
  values ('66666666-6666-6666-6666-666666666666', '33333333-3333-3333-3333-333333333333', 100, 45, '11111111-1111-1111-1111-111111111111');
