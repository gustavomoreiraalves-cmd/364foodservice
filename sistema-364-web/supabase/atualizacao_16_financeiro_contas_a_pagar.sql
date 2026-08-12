-- =========================================================
-- 364 — ATUALIZAÇÃO 16: FINANCEIRO (CATEGORIAS DE CONTA + CONTAS A PAGAR)
-- Substitui a tela solta de Despesas por Contas a Pagar: toda saída
-- financeira (compra de matéria-prima via Recebimento, nota fiscal
-- avulsa ou despesa manual) vira uma única entidade, categorizada,
-- com vencimento/parcelas e rastreável até a origem.
--
-- Categorias de conta (Custos Fixos/Diretos/Variáveis, Investimentos) são
-- uma lista fixa no código (lib/financeiro.js), não uma tabela — check
-- constraint abaixo é a única validação no banco.
--
-- Rode depois de atualizacao_15_unificar_colaboradores.sql.
-- =========================================================

-- ---------- CONTAS A PAGAR ----------
create table contas_a_pagar (
  id uuid primary key default gen_random_uuid(),
  descricao text not null,
  categoria_conta text not null
    check (categoria_conta in ('Custos Fixos', 'Custos Diretos', 'Custos Variáveis', 'Investimentos')),
  fornecedor_id uuid not null references fornecedores(id),
  recebimento_id uuid references recebimentos(id) on delete cascade,
  nota_fiscal_numero text,
  nota_fiscal_anexo_path text,
  valor_total numeric(12,2) not null,
  responsavel_id uuid references funcionarios(id),
  empresa_id uuid not null references empresas(id),
  created_at timestamptz not null default now()
);
create index contas_a_pagar_empresa_id_idx on contas_a_pagar (empresa_id);
create index contas_a_pagar_recebimento_id_idx on contas_a_pagar (recebimento_id);
create index contas_a_pagar_fornecedor_id_idx on contas_a_pagar (fornecedor_id);

alter table contas_a_pagar enable row level security;
create policy "empresa_scoped_access" on contas_a_pagar for all
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()))
  with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

-- ---------- PARCELAS ----------
create table contas_a_pagar_parcelas (
  id uuid primary key default gen_random_uuid(),
  conta_a_pagar_id uuid not null references contas_a_pagar(id) on delete cascade,
  numero int not null,
  valor numeric(12,2) not null,
  vencimento date not null,
  status text not null default 'Pendente' check (status in ('Pendente', 'Pago')),
  data_pagamento date,
  forma_pagamento text,
  comprovante_path text,
  empresa_id uuid not null references empresas(id),
  created_at timestamptz not null default now(),
  unique (conta_a_pagar_id, numero)
);
create index contas_a_pagar_parcelas_conta_id_idx on contas_a_pagar_parcelas (conta_a_pagar_id);
create index contas_a_pagar_parcelas_empresa_id_idx on contas_a_pagar_parcelas (empresa_id);

alter table contas_a_pagar_parcelas enable row level security;
create policy "empresa_scoped_access" on contas_a_pagar_parcelas for all
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()))
  with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

-- ---------- BLOQUEIO: não apagar recebimento com conta já paga ----------
-- Sem parcela paga, a FK recebimento_id acima (on delete cascade) já limpa
-- a conta a pagar junto. Com parcela paga, bloqueia — o usuário precisa
-- resolver isso em Financeiro antes de mexer no recebimento.
create or replace function public.bloquear_exclusao_recebimento_pago()
returns trigger language plpgsql as $function$
begin
  if exists (
    select 1 from contas_a_pagar cp
    join contas_a_pagar_parcelas pc on pc.conta_a_pagar_id = cp.id
    where cp.recebimento_id = old.id and pc.status = 'Pago'
  ) then
    raise exception 'Não é possível excluir: esta nota já tem parcela paga na Conta a Pagar. Ajuste em Financeiro antes.';
  end if;
  return old;
end;
$function$;

drop trigger if exists trg_bloquear_exclusao_recebimento_pago on recebimentos;
create trigger trg_bloquear_exclusao_recebimento_pago
  before delete on recebimentos
  for each row execute function public.bloquear_exclusao_recebimento_pago();

-- ---------- BACKFILL: despesas → contas_a_pagar ----------
-- Fornecedor genérico por empresa, pra cobrir despesas antigas sem
-- fornecedor real (o campo passa a ser obrigatório daqui pra frente).
insert into fornecedores (nome, categoria, empresa_id)
select 'Diversos (despesas migradas)', 'Outros', e.id
from empresas e
where exists (select 1 from despesas d where d.empresa_id = e.id)
  and not exists (
    select 1 from fornecedores f where f.empresa_id = e.id and f.nome = 'Diversos (despesas migradas)'
  );

-- Cada despesa vira 1 conta a pagar (categoria "Custos Fixos") + 1 parcela
-- já paga na própria data do lançamento antigo (dado histórico: já
-- aconteceu, não tinha conceito de pendente/pago).
do $$
declare
  d record;
  fornecedor_generico_id uuid;
  nova_conta_id uuid;
begin
  for d in select * from despesas loop
    select id into fornecedor_generico_id from fornecedores
      where empresa_id = d.empresa_id and nome = 'Diversos (despesas migradas)';

    insert into contas_a_pagar (descricao, categoria_conta, fornecedor_id, valor_total, responsavel_id, empresa_id, created_at)
    values (d.descricao, 'Custos Fixos', fornecedor_generico_id, d.valor, d.responsavel_id, d.empresa_id, d.created_at)
    returning id into nova_conta_id;

    insert into contas_a_pagar_parcelas (conta_a_pagar_id, numero, valor, vencimento, status, data_pagamento, empresa_id)
    values (nova_conta_id, 1, d.valor, d.data, 'Pago', d.data, d.empresa_id);
  end loop;
end $$;

drop table despesas;

-- ---------- MÓDULO 'financeiro': quem tinha 'despesas' ganha 'financeiro' ----------
insert into permissoes (user_id, modulo)
select p.user_id, 'financeiro'
from permissoes p
where p.modulo = 'despesas'
  and not exists (select 1 from permissoes p2 where p2.user_id = p.user_id and p2.modulo = 'financeiro');

delete from permissoes where modulo = 'despesas';
