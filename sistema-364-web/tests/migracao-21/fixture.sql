-- Esqueleto do schema de produção suficiente para aplicar a migração 21 e
-- exercitar as duas views num Postgres local descartável.
create schema if not exists auth;

create or replace function auth.uid() returns uuid
  language sql stable as $$ select nullif(current_setting('req.uid', true), '')::uuid $$;
create or replace function auth.role() returns text
  language sql stable as $$ select coalesce(nullif(current_setting('req.role', true), ''), 'anon') $$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
end $$;

create table auth.users (id uuid primary key, email text);

create table grupos (id uuid primary key, nome text);
create table empresas (id uuid primary key, nome text, grupo_id uuid references grupos(id));
create table permissoes (user_id uuid, modulo text, primary key (user_id, modulo));
create table usuario_empresas (user_id uuid, empresa_id uuid references empresas(id));
create table funcionarios (id uuid primary key, empresa_id uuid references empresas(id), nome text);
create table fornecedores (id uuid primary key, empresa_id uuid references empresas(id), nome text);

create table materias_primas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  nome text not null, unidade text not null default 'kg',
  custo_unitario numeric(12,2) not null default 0
);

create table produtos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  codigo text not null, nome text not null, categoria text,
  unidade text not null default 'un',
  preco_venda numeric(12,2) not null default 0,
  validade_dias int not null default 90,
  created_at timestamptz not null default now()
);

create table ficha_tecnica (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  produto_id uuid not null references produtos(id),
  materia_prima_id uuid not null references materias_primas(id),
  quantidade numeric(12,4) not null
);

create table clientes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id), nome text not null
);

create table pedidos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  data date not null, cliente_id uuid references clientes(id),
  status text not null default 'Pendente'
);

create table pedido_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  pedido_id uuid not null references pedidos(id),
  produto_id uuid not null references produtos(id),
  quantidade numeric(12,4) not null,
  preco_unitario numeric(12,2) not null
);

create table recebimentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  lote text not null, data date not null,
  fornecedor_id uuid references fornecedores(id)
);

create table recebimento_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  recebimento_id uuid not null references recebimentos(id),
  materia_prima_id uuid not null references materias_primas(id),
  lote text not null,
  quantidade numeric(12,4) not null,
  custo_unitario numeric(12,2) not null,
  status_recebimento text not null default 'Aceito'
);

create table contas_a_pagar (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  descricao text not null, categoria_conta text not null,
  fornecedor_id uuid references fornecedores(id),
  recebimento_id uuid references recebimentos(id),
  valor_total numeric(12,2) not null,
  created_at timestamptz not null default now()
);

create table contas_a_pagar_parcelas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  conta_a_pagar_id uuid not null references contas_a_pagar(id),
  numero int not null, valor numeric(12,2) not null,
  vencimento date not null,
  status text not null default 'Pendente',
  data_pagamento date
);

create or replace function public.empresas_permitidas() returns setof uuid
  language sql stable security definer set search_path = public as $$
  select empresa_id from usuario_empresas where user_id = auth.uid() $$;

-- RLS nas tabelas que a view lê, para provar que security_invoker respeita o escopo.
-- vw_consolidado_mensal também lê recebimentos/recebimento_itens/contas_a_pagar/
-- contas_a_pagar_parcelas: sem RLS nelas, security_invoker não tem o que respeitar
-- e essas linhas vazam entre empresas mesmo com a view "correta".
alter table pedidos enable row level security;
alter table pedido_itens enable row level security;
alter table produtos enable row level security;
alter table recebimentos enable row level security;
alter table recebimento_itens enable row level security;
alter table contas_a_pagar enable row level security;
alter table contas_a_pagar_parcelas enable row level security;
create policy empresa_scoped on pedidos for all
  using (empresa_id in (select public.empresas_permitidas()));
create policy empresa_scoped on pedido_itens for all
  using (empresa_id in (select public.empresas_permitidas()));
create policy empresa_scoped on produtos for all
  using (empresa_id in (select public.empresas_permitidas()));
create policy empresa_scoped on recebimentos for all
  using (empresa_id in (select public.empresas_permitidas()));
create policy empresa_scoped on recebimento_itens for all
  using (empresa_id in (select public.empresas_permitidas()));
create policy empresa_scoped on contas_a_pagar for all
  using (empresa_id in (select public.empresas_permitidas()));
create policy empresa_scoped on contas_a_pagar_parcelas for all
  using (empresa_id in (select public.empresas_permitidas()));

grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;

-- ---------- DADOS ----------
insert into grupos values ('10000000-0000-0000-0000-000000000001', 'Grupo 364');
insert into empresas values
  ('20000000-0000-0000-0000-00000000000a', 'Food Service', '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-00000000000b', 'Steakhouse',   '10000000-0000-0000-0000-000000000001');

insert into auth.users values
  ('a0000000-0000-0000-0000-00000000000a', 'ana@364.local'),
  ('b0000000-0000-0000-0000-00000000000b', 'bruno@364.local');
insert into usuario_empresas values
  ('a0000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a'),
  ('b0000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b');
insert into permissoes values
  ('a0000000-0000-0000-0000-00000000000a', 'relatorios'),
  ('b0000000-0000-0000-0000-00000000000b', 'pedidos');

insert into fornecedores values ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', 'Frigorífico X');

insert into materias_primas (id, empresa_id, nome, unidade, custo_unitario) values
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', 'Costela', 'kg', 20.00);

-- P1: custo cadastrado (30). P2: sem custo cadastrado, ficha de 2kg x 20 = 40. P3: sem custo e sem ficha.
insert into produtos (id, empresa_id, codigo, nome, preco_venda) values
  ('50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', '0364-001', 'Costela defumada', 100.00),
  ('50000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000a', '0364-002', 'Linguiça',         60.00),
  ('50000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-00000000000a', '0364-003', 'Pão de alho',      10.00);

insert into ficha_tecnica (empresa_id, produto_id, materia_prima_id, quantidade) values
  ('20000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', 2.0);

insert into clientes (id, empresa_id, nome) values
  ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', 'Mercado Y');

-- Julho/2026 na Food Service: 1 pedido faturado, 1 pendente, 1 cancelado.
insert into pedidos (id, empresa_id, data, cliente_id, status) values
  ('70000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', '2026-07-10', '60000000-0000-0000-0000-000000000001', 'Faturado'),
  ('70000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000a', '2026-07-12', '60000000-0000-0000-0000-000000000001', 'Pendente'),
  ('70000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-00000000000a', '2026-07-14', '60000000-0000-0000-0000-000000000001', 'Cancelado');

insert into pedido_itens (empresa_id, pedido_id, produto_id, quantidade, preco_unitario) values
  ('20000000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 2, 100.00),
  ('20000000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', 1,  60.00),
  ('20000000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000003', 1,  10.00),
  ('20000000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000001', 5, 100.00);

-- Steakhouse tem venda no mesmo mês, para o teste de escopo por RLS.
insert into produtos (id, empresa_id, codigo, nome, preco_venda) values
  ('50000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', 'STK-001', 'Picanha', 200.00);
insert into pedidos (id, empresa_id, data, status) values
  ('70000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', '2026-07-20', 'Faturado');
insert into pedido_itens (empresa_id, pedido_id, produto_id, quantidade, preco_unitario) values
  ('20000000-0000-0000-0000-00000000000b', '70000000-0000-0000-0000-00000000000b', '50000000-0000-0000-0000-00000000000b', 1, 200.00);

-- Recebimento: um item aceito (200) e um rejeitado (999), que não pode entrar em compras.
insert into recebimentos (id, empresa_id, lote, data, fornecedor_id) values
  ('80000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', 'LT-260705-001', '2026-07-05', '30000000-0000-0000-0000-000000000001');
insert into recebimento_itens (empresa_id, recebimento_id, materia_prima_id, lote, quantidade, custo_unitario, status_recebimento) values
  ('20000000-0000-0000-0000-00000000000a', '80000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'LT-260705-001', 10, 20.00, 'Aceito'),
  ('20000000-0000-0000-0000-00000000000a', '80000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'LT-260705-002',  1, 999.00, 'Rejeitado');

-- Despesa avulsa de julho (500) + conta ligada ao recebimento (200), que NÃO é despesa.
insert into contas_a_pagar (id, empresa_id, descricao, categoria_conta, fornecedor_id, recebimento_id, valor_total, created_at) values
  ('90000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', 'Energia',  'Custos Fixos',   '30000000-0000-0000-0000-000000000001', null, 500.00, '2026-07-15T12:00:00Z'),
  ('90000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000a', 'NF compra','Custos Diretos', '30000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001', 200.00, '2026-07-06T12:00:00Z'),
  -- lançada 01/08 às 01h UTC = 31/07 às 22h em São Paulo: tem que cair em 2026-07.
  ('90000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-00000000000a', 'Virada',   'Custos Fixos',   '30000000-0000-0000-0000-000000000001', null,  70.00, '2026-08-01T01:00:00Z');

-- Parcela paga em julho (300) e parcela pendente (200), que não entra no caixa.
insert into contas_a_pagar_parcelas (empresa_id, conta_a_pagar_id, numero, valor, vencimento, status, data_pagamento) values
  ('20000000-0000-0000-0000-00000000000a', '90000000-0000-0000-0000-000000000001', 1, 300.00, '2026-07-20', 'Pago', '2026-07-20'),
  ('20000000-0000-0000-0000-00000000000a', '90000000-0000-0000-0000-000000000001', 2, 200.00, '2026-08-20', 'Pendente', null);
