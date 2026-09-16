-- tests/migracao-54/fixture.sql
-- Base mínima pra exercitar a atualização 54 num Postgres local descartável.
-- Schema tal como a atualização 50 o deixou (pré-54): expedicao_itens sem
-- embalagem_id, vw_estoque_produto_lote agrupando por recebimento_item_id.
create extension if not exists pgcrypto;

create table public.empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null
);
create table public.produtos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id)
);
create table public.clientes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id)
);
create table public.pedidos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  cliente_id uuid references public.clientes(id),
  status text not null default 'Pendente'
);
create table public.pedido_itens (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  produto_id uuid not null references public.produtos(id),
  quantidade numeric(12,4) not null,
  preco_unitario numeric(12,2) not null default 0
);
create table public.recebimento_itens (
  id uuid primary key default gen_random_uuid(),
  validade date
);

-- embalagens tal como a atualização 30 a criou (colunas mínimas usadas aqui).
create table public.embalagens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  lote text not null,
  data date not null default current_date,
  status text not null default 'rascunho'
);
create table public.embalagem_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id),
  embalagem_id uuid references public.embalagens(id),
  produto_id uuid references public.produtos(id),
  recebimento_item_id uuid references public.recebimento_itens(id),
  quantidade numeric(12,3) not null,
  validade date
);

create table public.expedicoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  pedido_id uuid references public.pedidos(id),
  status text not null default 'rascunho'
);
create table public.expedicao_caixas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  expedicao_id uuid not null references public.expedicoes(id) on delete cascade,
  numero int not null
);
create table public.expedicao_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  expedicao_caixa_id uuid not null references public.expedicao_caixas(id) on delete cascade,
  pedido_item_id uuid not null references public.pedido_itens(id),
  produto_id uuid not null references public.produtos(id),
  recebimento_item_id uuid references public.recebimento_itens(id),
  quantidade numeric(12,4) not null check (quantidade > 0)
);

-- View tal como a atualização 50 a deixou (pré-54) — a 54 faz `create or
-- replace`, então o teste prova a transição real.
create or replace view public.vw_estoque_produto_lote as
select
  ei.empresa_id, ei.produto_id, ei.recebimento_item_id, ei.validade,
  sum(ei.quantidade) as total_embalado,
  0::numeric as total_expedido,
  sum(ei.quantidade) as saldo
from public.embalagem_itens ei
where ei.recebimento_item_id is not null
group by ei.empresa_id, ei.produto_id, ei.recebimento_item_id, ei.validade;

insert into public.empresas (id, nome) values
  ('11111111-1111-1111-1111-111111111111', 'Empresa Teste');
insert into public.produtos (id, empresa_id) values
  ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');
insert into public.clientes (id, empresa_id) values
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');
insert into public.pedidos (id, empresa_id, cliente_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000001');
insert into public.pedido_itens (id, pedido_id, produto_id, quantidade) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', 10);
insert into public.recebimento_itens (id, validade) values
  ('66666666-0000-0000-0000-000000000001', '2026-12-01');

-- Cenário-chave: DUAS embalagens finalizadas diferentes, mesmo produto,
-- consumindo a MESMA matéria-prima (mesmo recebimento_item_id) — é
-- exatamente a ambiguidade que a 54 corrige.
insert into public.embalagens (id, empresa_id, lote, data, status) values
  ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'LOTE-A', '2026-09-01', 'finalizada'),
  ('e0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'LOTE-B', '2026-09-02', 'finalizada'),
  -- Embalagem em rascunho — não deve contar como saldo disponível.
  ('e0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'LOTE-C-RASCUNHO', '2026-09-03', 'rascunho');
insert into public.embalagem_itens (id, empresa_id, embalagem_id, produto_id, recebimento_item_id, quantidade, validade) values
  ('f0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'e0000000-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
   '66666666-0000-0000-0000-000000000001', 5, '2026-12-01'),
  -- Segundo item da mesma embalagem (LOTE-A) com validade ANTERIOR (2026-11-01),
  -- para testar que min(validade) é implementado corretamente.
  ('f0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'e0000000-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
   '66666666-0000-0000-0000-000000000001', 3, '2026-11-01'),
  ('f0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'e0000000-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000001',
   '66666666-0000-0000-0000-000000000001', 7, '2026-11-15'),
  ('f0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'e0000000-0000-0000-0000-000000000003', 'dddddddd-0000-0000-0000-000000000001',
   '66666666-0000-0000-0000-000000000001', 100, '2026-12-01');

-- Expedição finalizada já consumiu 2 unidades do LOTE-A — prova que o
-- desconto de saldo é por embalagem, não mais fundido por matéria-prima.
insert into public.expedicoes (id, empresa_id, pedido_id, status) values
  ('11110000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000001', 'finalizado');
insert into public.expedicao_caixas (id, empresa_id, expedicao_id, numero) values
  ('caaa0000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '11110000-0000-0000-0000-000000000001', 1);
insert into public.expedicao_itens (id, empresa_id, expedicao_caixa_id, pedido_item_id, produto_id, recebimento_item_id, quantidade) values
  ('ee000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'caaa0000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000001', '66666666-0000-0000-0000-000000000001', 2);
