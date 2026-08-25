-- =========================================================
-- Atualização 39 — Configuração de emissão fiscal (NF-e/NFC-e)
--
-- empresas_emissao_fiscal é a config por marca (empresa_id); fiscal_numeracao
-- é o contador, chaveado por empregador_id (o CNPJ real, quem emite de
-- verdade) — separadas de propósito, ver
-- docs/superpowers/specs/2026-08-25-configuracao-emissor-fiscal-design.md.
--
-- empregador_id em empresas_emissao_fiscal nunca vem da API: o trigger abaixo
-- copia de empresas.empregador_id sempre que a linha é gravada, para a
-- constraint de série única por CNPJ nunca validar contra um valor que a API
-- mandou errado.
--
-- Rode depois de atualizacao_38_cliente_nome_fantasia.sql. Idempotente.
-- Rollback comentado no fim.
-- =========================================================
begin;

alter table public.empresas add column if not exists informacoes_complementares_padrao text;

create table if not exists public.empresas_emissao_fiscal (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  empregador_id uuid not null references public.empregadores(id),
  modelo text not null check (modelo in ('55', '65')),
  ambiente text not null default 'homologacao' check (ambiente in ('producao', 'homologacao')),
  ativo boolean not null default false,
  serie int not null check (serie > 0),
  csc_id text,
  csc_token_cifrado text,
  csc_key_version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists empresas_emissao_fiscal_marca_modelo_ambiente
  on public.empresas_emissao_fiscal(empresa_id, modelo, ambiente);
create unique index if not exists empresas_emissao_fiscal_serie_por_cnpj
  on public.empresas_emissao_fiscal(empregador_id, modelo, ambiente, serie);
create index if not exists empresas_emissao_fiscal_empregador_idx
  on public.empresas_emissao_fiscal(empregador_id);

drop trigger if exists trg_empresas_emissao_fiscal_updated_at on public.empresas_emissao_fiscal;
create trigger trg_empresas_emissao_fiscal_updated_at before update on public.empresas_emissao_fiscal
  for each row execute function public.fn_set_updated_at();

alter table public.empresas_emissao_fiscal enable row level security;
-- Sem policy de select para authenticated de propósito: csc_token_cifrado é
-- credencial (assina o QR Code da NFC-e). Só o service role, usado nas rotas
-- de app/api/empresas/[id]/emissao-fiscal/*, alcança a tabela.

create or replace function public.fn_emissao_fiscal_popular_empregador()
returns trigger
language plpgsql
as $$
begin
  select empregador_id into new.empregador_id from public.empresas where id = new.empresa_id;
  if new.empregador_id is null then
    raise exception 'A marca % não tem pessoa jurídica (empregador) vinculada — vincule em /empresas antes de configurar a emissão.', new.empresa_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_emissao_fiscal_popular_empregador on public.empresas_emissao_fiscal;
create trigger trg_emissao_fiscal_popular_empregador before insert or update
  on public.empresas_emissao_fiscal
  for each row execute function public.fn_emissao_fiscal_popular_empregador();

create table if not exists public.fiscal_numeracao (
  id uuid primary key default gen_random_uuid(),
  empregador_id uuid not null references public.empregadores(id),
  modelo text not null check (modelo in ('55', '65')),
  ambiente text not null check (ambiente in ('producao', 'homologacao')),
  serie int not null check (serie > 0),
  ultimo_numero int not null default 0 check (ultimo_numero >= 0),
  updated_at timestamptz not null default now()
);

create unique index if not exists fiscal_numeracao_chave
  on public.fiscal_numeracao(empregador_id, modelo, ambiente, serie);

drop trigger if exists trg_fiscal_numeracao_updated_at on public.fiscal_numeracao;
create trigger trg_fiscal_numeracao_updated_at before update on public.fiscal_numeracao
  for each row execute function public.fn_set_updated_at();

alter table public.fiscal_numeracao enable row level security;
-- Mesmo motivo: só service role. O número em si não é segredo, mas só o
-- pipeline de emissão (fase seguinte) e a ação administrativa devem escrever
-- aqui — nenhum client-side write.

commit;

-- ---------- rollback ----------
-- begin;
-- drop trigger if exists trg_fiscal_numeracao_updated_at on public.fiscal_numeracao;
-- drop table if exists public.fiscal_numeracao;
-- drop trigger if exists trg_emissao_fiscal_popular_empregador on public.empresas_emissao_fiscal;
-- drop function if exists public.fn_emissao_fiscal_popular_empregador();
-- drop trigger if exists trg_empresas_emissao_fiscal_updated_at on public.empresas_emissao_fiscal;
-- drop table if exists public.empresas_emissao_fiscal;
-- alter table public.empresas drop column if exists informacoes_complementares_padrao;
-- commit;
