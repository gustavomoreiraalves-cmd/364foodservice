-- Esqueleto mínimo para exercitar a atualização 24 num Postgres local.
-- Só as tabelas que a migração toca, com as colunas que ela usa.
create table empresas (id uuid primary key, nome text);
create table clientes (id uuid primary key, empresa_id uuid references empresas(id), nome text);
create table funcionarios (id uuid primary key, empresa_id uuid references empresas(id), nome text);
create table produtos (id uuid primary key, empresa_id uuid references empresas(id), nome text);

create table pedidos (
  id uuid primary key default gen_random_uuid(),
  data date not null default current_date,
  cliente_id uuid references clientes(id),
  status text not null default 'Pendente',
  responsavel_id uuid references funcionarios(id),
  empresa_id uuid references empresas(id),
  created_at timestamptz not null default now()
);

create table pedido_itens (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references pedidos(id) on delete cascade,
  produto_id uuid not null references produtos(id),
  quantidade numeric(12,4) not null,
  preco_unitario numeric(12,2) not null,
  empresa_id uuid references empresas(id)
);

insert into empresas (id, nome) values ('11111111-1111-1111-1111-111111111111', 'Food Services');
insert into clientes (id, empresa_id, nome) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Cliente Teste');
insert into funcionarios (id, empresa_id, nome) values ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'Responsável Teste');
insert into produtos (id, empresa_id, nome) values ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'Costela Defumada 500g');
