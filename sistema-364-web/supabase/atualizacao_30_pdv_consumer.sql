-- =========================================================
-- Atualização 30 — vendas importadas do PDV Consumer
--
-- Tabelas pdv_* guardam, por empresa, o que o painel Consumer Connect
-- mostra para a 364 Steakhouse e a 364 Foodtruck/Afya: pedidos com itens e
-- pagamentos, caixas com movimentações, recebimentos (com taxa e líquido) e
-- o snapshot diário de itens vendidos. O importador (scripts/
-- importar-pdv-consumer.mjs) escreve com a service role; usuários só leem.
--
-- Rode depois de atualizacao_29_ficha_defumacao.sql. Idempotente.
-- Spec: docs/superpowers/specs/2026-08-23-importacao-vendas-consumer-design.md
-- =========================================================
begin;

-- ---------- LOJAS DO CONNECT ----------
-- O payload do Connect diz "364 Steakhouse" para as duas lojas; a unidade
-- vem do filtro de loja, e esta tabela traduz o id do filtro em empresa.
create table if not exists public.pdv_lojas (
  id_connect bigint primary key,
  empresa_id uuid not null references public.empresas(id),
  nome_connect text not null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

insert into public.pdv_lojas (id_connect, empresa_id, nome_connect)
select v.id_connect, e.id, v.nome_connect
from (values
  (-2147478159::bigint, 'steakhouse',     'RO/Ji-Paraná - Dois de Abril 364 Steakhouse'),
  (-2147458165::bigint, 'foodtruck-afya', 'RO/Ji-Paraná - Jardim dos Migrantes 364 Steakhouse')
) as v(id_connect, slug, nome_connect)
join public.empresas e on e.slug = v.slug
on conflict (id_connect) do nothing;

-- ---------- PEDIDOS ----------
create table if not exists public.pdv_pedidos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  codigo integer not null,
  id_connect bigint,
  tipo text not null check (tipo in ('mesa', 'delivery', 'outro')),
  tipo_original text,
  origem text,
  status text,
  finalizado boolean not null default false,
  cliente text,
  numero integer,
  colaborador text,
  qtd_itens numeric(12,4),
  valor_total numeric(12,2) not null default 0,
  valor_itens numeric(12,2),
  valor_desconto numeric(12,2),
  valor_entrega numeric(12,2),
  valor_servico numeric(12,2),
  valor_acrescimo numeric(12,2),
  aberto_em timestamptz not null,
  fechado_em timestamptz,
  dia_venda date not null,
  excluido_em timestamptz,
  origem_raw jsonb,
  origem_html text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, codigo)
);
create index if not exists pdv_pedidos_dia_idx on public.pdv_pedidos (empresa_id, dia_venda);

create table if not exists public.pdv_pedido_itens (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pdv_pedidos(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id),
  posicao integer not null,
  nome text not null,
  observacao text,
  quantidade numeric(12,4) not null default 0,
  preco_unitario numeric(12,2),
  valor numeric(12,2),
  item_pai_posicao integer,
  eh_combo boolean not null default false
);
create index if not exists pdv_pedido_itens_pedido_idx on public.pdv_pedido_itens (pedido_id);

create table if not exists public.pdv_pagamentos (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pdv_pedidos(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id),
  posicao integer not null,
  valor numeric(12,2) not null,
  forma text,
  operadora text,
  forma_grupo text not null check (forma_grupo in ('pix','credito','debito','dinheiro','ifood_online','voucher','fiado','outro')),
  pago_em timestamptz
);
create index if not exists pdv_pagamentos_pedido_idx on public.pdv_pagamentos (pedido_id);

-- ---------- CAIXAS ----------
create table if not exists public.pdv_caixas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  codigo integer not null,
  id_connect bigint,
  usuario text,
  status text,
  aberto_em timestamptz not null,
  fechado_em timestamptz,
  dia_caixa date not null,
  saldo_inicial numeric(12,2),
  saldo_final numeric(12,2),
  total_dinheiro numeric(12,2),
  observacao text,
  origem_raw jsonb,
  origem_html text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, codigo)
);
create index if not exists pdv_caixas_dia_idx on public.pdv_caixas (empresa_id, dia_caixa);

create table if not exists public.pdv_caixa_movimentos (
  id uuid primary key default gen_random_uuid(),
  caixa_id uuid not null references public.pdv_caixas(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id),
  posicao integer not null,
  operacao text not null,
  origem text,
  pedido_codigo integer,
  momento timestamptz,
  entrada numeric(12,2),
  saida numeric(12,2),
  forma text,
  operadora text,
  forma_grupo text,
  observacao text
);
create index if not exists pdv_caixa_movimentos_caixa_idx on public.pdv_caixa_movimentos (caixa_id);

-- ---------- RECEBIMENTOS ----------
-- Única fonte com taxa e valor líquido. Sem chave própria no payload, então a
-- chave natural é a combinação que identifica um lançamento.
--
-- `unique nulls not distinct`, não `unique` puro: `pedido_codigo` (recebimento
-- avulso de caixa) e `operadora` (por exemplo, pagamentos em "Dinheiro") podem
-- vir nulos no payload. Com `unique` comum, dois nulos nunca são considerados
-- iguais e o upsert do importador (on conflict nesta mesma chave) duplicava a
-- linha a cada reimportação em vez de atualizar.
create table if not exists public.pdv_recebimentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  pedido_codigo integer,
  caixa_codigo integer,
  categoria text,
  forma text,
  operadora text,
  forma_grupo text not null,
  valor numeric(12,2) not null,
  valor_liquido numeric(12,2),
  percentual_taxa numeric(8,4),
  parcela integer,
  pago_em timestamptz not null,
  dia_pagamento date not null,
  credito_em date,
  observacao text,
  origem_raw jsonb,
  criado_em timestamptz not null default now(),
  unique nulls not distinct (empresa_id, pedido_codigo, caixa_codigo, forma, operadora, valor, pago_em)
);
create index if not exists pdv_recebimentos_dia_idx on public.pdv_recebimentos (empresa_id, dia_pagamento);

-- ---------- ITENS VENDIDOS POR DIA ----------
create table if not exists public.pdv_vendas_itens_dia (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  dia date not null,
  codigo_produto integer,
  codigo_detalhe integer not null,
  nome text not null,
  categoria text,
  quantidade numeric(12,4) not null default 0,
  valor_vendido numeric(12,2) not null default 0,
  preco_venda numeric(12,2),
  preco_custo numeric(12,2),
  custo_medio numeric(12,2),
  lucro numeric(12,2),
  margem numeric(8,4),
  participacao_lucro numeric(8,4),
  curva_abc char(1),
  origem_raw jsonb,
  criado_em timestamptz not null default now(),
  unique (empresa_id, dia, codigo_detalhe)
);

-- ---------- LOG DE EXECUÇÃO ----------
create table if not exists public.pdv_importacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id),
  iniciado_em timestamptz not null default now(),
  terminado_em timestamptz,
  janela_inicio date,
  janela_fim date,
  status text not null default 'executando' check (status in ('executando','ok','erro','parcial')),
  pedidos integer not null default 0,
  caixas integer not null default 0,
  recebimentos integer not null default 0,
  itens_dia integer not null default 0,
  erro text,
  detalhes jsonb
);
create index if not exists pdv_importacoes_inicio_idx on public.pdv_importacoes (iniciado_em desc);

-- ---------- TRIGGERS ----------
drop trigger if exists trg_pdv_pedidos_updated on public.pdv_pedidos;
create trigger trg_pdv_pedidos_updated before update on public.pdv_pedidos
  for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_pdv_caixas_updated on public.pdv_caixas;
create trigger trg_pdv_caixas_updated before update on public.pdv_caixas
  for each row execute function public.fn_set_updated_at();

-- ---------- RLS ----------
-- Só leitura para usuários: escrita é do importador, que usa a service role
-- (que passa por cima da RLS). pdv_lojas e pdv_importacoes não têm
-- empresa_id obrigatório, então a regra é "qualquer autenticado lê".
do $$
declare t text;
begin
  foreach t in array array['pdv_pedidos','pdv_pedido_itens','pdv_pagamentos','pdv_caixas',
                           'pdv_caixa_movimentos','pdv_recebimentos','pdv_vendas_itens_dia']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "empresa_scoped_read" on public.%I', t);
    execute format('create policy "empresa_scoped_read" on public.%I for select
      using (auth.role() = ''authenticated'' and empresa_id in (select public.empresas_permitidas()))', t);
  end loop;
end $$;

alter table public.pdv_lojas enable row level security;
drop policy if exists "authenticated_read" on public.pdv_lojas;
create policy "authenticated_read" on public.pdv_lojas for select using (auth.role() = 'authenticated');

alter table public.pdv_importacoes enable row level security;
drop policy if exists "authenticated_read" on public.pdv_importacoes;
create policy "authenticated_read" on public.pdv_importacoes for select using (auth.role() = 'authenticated');

-- ---------- VIEWS ----------
-- security_invoker: a view roda com a RLS de quem consulta (padrão da 21).
drop view if exists public.vw_pdv_vendas_dia;
create view public.vw_pdv_vendas_dia with (security_invoker = true) as
select
  empresa_id,
  dia_venda as dia,
  tipo,
  coalesce(origem, '') as origem,
  count(*)::integer as qtd_pedidos,
  coalesce(sum(qtd_itens), 0) as qtd_itens,
  coalesce(sum(valor_total), 0) as valor_total,
  coalesce(sum(valor_desconto), 0) as valor_desconto,
  coalesce(sum(valor_entrega), 0) as valor_entrega,
  coalesce(sum(valor_servico), 0) as valor_servico
from public.pdv_pedidos
where finalizado and excluido_em is null
group by empresa_id, dia_venda, tipo, coalesce(origem, '');

drop view if exists public.vw_pdv_caixa_formas_dia;
create view public.vw_pdv_caixa_formas_dia with (security_invoker = true) as
select
  empresa_id,
  dia_pagamento as dia,
  forma_grupo,
  coalesce(forma, '') as forma,
  coalesce(operadora, '') as operadora,
  count(*)::integer as qtd,
  sum(valor) as valor_bruto,
  sum(coalesce(valor_liquido, valor)) as valor_liquido,
  sum(valor - coalesce(valor_liquido, valor)) as taxa
from public.pdv_recebimentos
group by empresa_id, dia_pagamento, forma_grupo, coalesce(forma, ''), coalesce(operadora, '');

commit;

-- ---------- ROLLBACK ----------
-- begin;
-- drop view if exists public.vw_pdv_caixa_formas_dia;
-- drop view if exists public.vw_pdv_vendas_dia;
-- drop table if exists public.pdv_importacoes;
-- drop table if exists public.pdv_vendas_itens_dia;
-- drop table if exists public.pdv_recebimentos;
-- drop table if exists public.pdv_caixa_movimentos;
-- drop table if exists public.pdv_caixas;
-- drop table if exists public.pdv_pagamentos;
-- drop table if exists public.pdv_pedido_itens;
-- drop table if exists public.pdv_pedidos;
-- drop table if exists public.pdv_lojas;
-- commit;
