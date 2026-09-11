# Romaneio de separação, faturamento automático e transporte na NF-e — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pedido de venda ganha romaneio de separação por lote (com FEFO, caixas e etiqueta de despacho), emissão de NF-e automática ao finalizar o romaneio (com transportadora/veículo/volumes reais no grupo `<transp>`), e conta a receber criada automaticamente quando a nota é autorizada.

**Architecture:** Extensão do fluxo já existente `pedido → NF-e` (hoje `Pendente → Faturado → Enviado`) para `Pendente → Separação → Conferido → Faturado → Enviado`, com duas tabelas novas de romaneio (`expedicoes`/`expedicao_caixas`/`expedicao_itens`), um cadastro novo (`transportadoras`), e financeiro novo (`contas_a_receber`/`contas_a_receber_parcelas`). O motor de emissão existente (`lib/nfe/*`) é estendido, não reescrito: troca a fonte dos itens (da expedição, não do pedido direto), ganha o grupo `<transp>` real, e no sucesso passa a fazer duas coisas a mais na mesma passada (atualizar `pedidos.status` e gravar a conta a receber).

**Tech Stack:** Next.js App Router, Supabase (Postgres + RLS + Storage), `node --test` nativo para lógica pura, verificação de migração em Postgres local descartável (padrão já usado em `tests/migracao-43/`).

**Spec:** [docs/superpowers/specs/2026-09-10-romaneio-faturamento-transporte-design.md](../specs/2026-09-10-romaneio-faturamento-transporte-design.md) — ler antes de implementar qualquer task. Specs de origem (não redesenhados, só retomados): [2026-08-25-processo-pedido-romaneio-emissao-nfe-design.md](../specs/2026-08-25-processo-pedido-romaneio-emissao-nfe-design.md), [2026-08-25-expedicao-romaneio-integracao-nfe-design.md](../specs/2026-08-25-expedicao-romaneio-integracao-nfe-design.md), [2026-08-20-controle-lote-rastreabilidade-design.md](../specs/2026-08-20-controle-lote-rastreabilidade-design.md), [2026-08-25-financeiro-contas-a-receber-design.md](../specs/2026-08-25-financeiro-contas-a-receber-design.md).

## Global Constraints

- **O schema em produção diverge do repositório.** Verificado via `psql` em 2026-09-10: `pedidos`, `pedido_itens`, `clientes`, `fornecedores`, `produtos`, `producoes`, `recebimento_itens`, `embalagem_itens`, `defumacao_itens` têm `empresa_id not null` com policy `empresa_scoped_access` (`for all using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas())) with check (...)`) — **nenhuma migração do repo documenta essas colunas**. `supabase/schema.sql` e as migrações anteriores à 43 estão desatualizadas como referência de schema; toda coluna usada abaixo foi conferida ao vivo, não copiada do repo.
- `nfe_saida_documentos`/`nfe_saida_itens`/`nfe_saida_eventos` têm RLS **só de `SELECT`** para `authenticated` — toda escrita nessas tabelas (e, a partir desta implementação, em `expedicoes`/`expedicao_caixas`/`expedicao_itens`) é feita por rota de API com service role, nunca pelo navegador direto.
- **Nunca aplique uma migração em produção sem confirmação explícita do usuário.** `SUPABASE_DB_URL` em `.env.local` dá acesso de escrita direto ao Postgres de produção — leitura é livre para conferir schema, escrita (incluindo `psql -f supabase/atualizacao_XX.sql`) só com o usuário revisando o arquivo e autorizando explicitamente, arquivo por arquivo.
- Migração mais recente aplicada em produção (conferido em 2026-09-10, colunas de crédito ICMS Simples presentes em `nfe_saida_itens`): **49**. Esta implementação usa **50** e **51**.
- `npm test` roda `node --test tests/*.test.mjs` — só o nível raiz de `tests/`; os diretórios `tests/migracao-NN/` (fixture/cenários/shell) são verificação manual de schema, não entram no `npm test`.
- Todo texto de erro, comentário e rótulo de UI em português, no mesmo tom direto e específico do resto do código (nome de campo, não "algo deu errado").

---

### Task 1: Migração 50 — transportadoras, expedição e novos status do pedido

**Files:**
- Create: `supabase/atualizacao_50_expedicao_romaneio.sql`
- Create: `tests/migracao-50/fixture.sql`
- Create: `tests/migracao-50/cenarios.sql`
- Create: `tests/migracao-50/verificar.sh`

**Interfaces:**
- Produces: tabelas `transportadoras` (id, empresa_id, nome, nome_fantasia, cnpj, ie, logradouro, numero, complemento, bairro, codigo_municipio_ibge, municipio, uf, cep, telefone, ativo, created_at), `expedicoes` (id, empresa_id, pedido_id, numero, data, responsavel_id, status ['rascunho'|'finalizado'|'cancelado'], transportadora_id, modo_frete ['0'|'1'|'9'], veiculo_placa, veiculo_uf, nfe_saida_documento_id, observacoes, created_at, updated_at), `expedicao_caixas` (id, empresa_id, expedicao_id, numero, peso_bruto_kg, created_at), `expedicao_itens` (id, empresa_id, expedicao_caixa_id, pedido_item_id, produto_id, recebimento_item_id nullable, quantidade), e a view `vw_estoque_produto_lote` (empresa_id, produto_id, recebimento_item_id, validade, total_embalado, total_expedido, saldo) — saldo de produto acabado por lote, que a Task 20 usa pra sugestão FEFO real (confirmado ao vivo: essa view nunca existiu; a fonte é `embalagem_itens.recebimento_item_id`/`quantidade` menos o que já saiu em `expedicao_itens` de expedições não canceladas). Estende `fn_pedido_bloquear_cabecalho` com as novas transições. Todas as tasks seguintes (2 a 24) dependem desta.

- [ ] **Step 1: Escrever a migração**

```sql
-- supabase/atualizacao_50_expedicao_romaneio.sql
--
-- Retoma o romaneio de separação (Fase 4 de atualizacao 20/08, revisado em
-- 25/08 pra integrar com o motor de NF-e) e o cadastro de transportadora
-- (delta novo, ver docs/superpowers/specs/2026-09-10-romaneio-faturamento-
-- transporte-design.md). Nunca implementado até aqui.
--
-- Pedido ganha dois status novos entre Pendente e Faturado: Separação e
-- Conferido. fn_pedido_bloquear_cabecalho (atualização 27) é reescrita para
-- impor as novas transições NO BANCO, não só na tela — mesmo padrão que já
-- trava cliente/data fora de Pendente e exige motivo pra reabrir.
--
-- Idempotente: create table if not exists, add column if not exists,
-- create or replace function. Rollback comentado no fim.
begin;

-- ---------- TRANSPORTADORAS ----------
create table if not exists public.transportadoras (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  nome text not null,
  nome_fantasia text,
  cnpj text,
  ie text,
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  codigo_municipio_ibge char(7),
  municipio text,
  uf char(2),
  cep char(8),
  telefone text,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists transportadoras_empresa_id_idx on public.transportadoras(empresa_id);

-- ---------- EXPEDIÇÕES (romaneio) ----------
create table if not exists public.expedicoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  pedido_id uuid not null references public.pedidos(id),
  numero text not null,
  data date not null default current_date,
  responsavel_id uuid references public.funcionarios(id),
  status text not null default 'rascunho' check (status in ('rascunho', 'finalizado', 'cancelado')),
  transportadora_id uuid references public.transportadoras(id),
  modo_frete text not null default '0' check (modo_frete in ('0', '1', '9')),
  veiculo_placa text,
  veiculo_uf char(2),
  nfe_saida_documento_id uuid references public.nfe_saida_documentos(id),
  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists expedicoes_empresa_numero_unico on public.expedicoes(empresa_id, numero);
create index if not exists expedicoes_pedido_id_idx on public.expedicoes(pedido_id);
-- Só um romaneio "vivo" (rascunho ou finalizado) por pedido — cancelado não
-- conta, é o que libera refazer o romaneio de um pedido que voltou a Pendente.
create unique index if not exists expedicoes_pedido_vivo_unico
  on public.expedicoes(pedido_id) where status <> 'cancelado';

create table if not exists public.expedicao_caixas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  expedicao_id uuid not null references public.expedicoes(id) on delete cascade,
  numero int not null,
  peso_bruto_kg numeric(12,3),
  created_at timestamptz not null default now(),
  unique (expedicao_id, numero)
);

create table if not exists public.expedicao_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  expedicao_caixa_id uuid not null references public.expedicao_caixas(id) on delete cascade,
  pedido_item_id uuid not null references public.pedido_itens(id),
  produto_id uuid not null references public.produtos(id),
  -- Fase 4 revisada (25/08): item sem lote rastreado (produto não passou por
  -- defumação/embalagem, ou não é `produtos.rastreado`) entra sem esta
  -- referência — só quantidade, sem FEFO/saldo por lote.
  recebimento_item_id uuid references public.recebimento_itens(id),
  quantidade numeric(12,4) not null check (quantidade > 0)
);
create index if not exists expedicao_itens_caixa_idx on public.expedicao_itens(expedicao_caixa_id);
create index if not exists expedicao_itens_pedido_item_idx on public.expedicao_itens(pedido_item_id);
create index if not exists expedicao_itens_recebimento_item_idx on public.expedicao_itens(recebimento_item_id);

-- ---------- SALDO DE PRODUTO ACABADO POR LOTE (FEFO) ----------
-- Confirmado ao vivo (2026-09-10): não existe vw_estoque_produto_lote nem
-- equivalente. `embalagem_itens.recebimento_item_id` é o lote que chega até
-- o produto acabado (cadeia recebimento→defumação→embalagem, spec de
-- 20/08); saldo = total embalado daquele lote menos o que já foi alocado em
-- expedição não cancelada. Produto sem `recebimento_item_id` (não
-- rastreado) não aparece aqui — cai no ramo "sem lote" de sugerirAlocacao.
create or replace view public.vw_estoque_produto_lote as
select
  ei.empresa_id,
  ei.produto_id,
  ei.recebimento_item_id,
  ei.validade,
  sum(ei.quantidade) as total_embalado,
  coalesce((
    select sum(exi.quantidade) from public.expedicao_itens exi
    join public.expedicao_caixas ec on ec.id = exi.expedicao_caixa_id
    join public.expedicoes ex on ex.id = ec.expedicao_id
    where exi.recebimento_item_id = ei.recebimento_item_id
      and exi.produto_id = ei.produto_id
      and ex.status <> 'cancelado'
  ), 0) as total_expedido,
  sum(ei.quantidade) - coalesce((
    select sum(exi.quantidade) from public.expedicao_itens exi
    join public.expedicao_caixas ec on ec.id = exi.expedicao_caixa_id
    join public.expedicoes ex on ex.id = ec.expedicao_id
    where exi.recebimento_item_id = ei.recebimento_item_id
      and exi.produto_id = ei.produto_id
      and ex.status <> 'cancelado'
  ), 0) as saldo
from public.embalagem_itens ei
where ei.recebimento_item_id is not null
group by ei.empresa_id, ei.produto_id, ei.recebimento_item_id, ei.validade;

-- ---------- RLS ----------
-- transportadoras: cadastro simples, CRUD direto do navegador — mesma
-- policy "for all" que clientes/fornecedores/pedidos já usam em produção.
alter table public.transportadoras enable row level security;
drop policy if exists "empresa_scoped_access" on public.transportadoras;
create policy "empresa_scoped_access" on public.transportadoras for all
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()))
  with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

-- expedicoes/expedicao_caixas/expedicao_itens: só SELECT para authenticated,
-- mesmo padrão de nfe_saida_* (atualização 43) — toda escrita passa pelas
-- rotas de API (app/api/expedicao/*), porque finalizar dispara o motor de
-- emissão (certificado, SEFAZ) e a validação de divergência/saldo por lote
-- não pode depender de policy de RLS pra ficar correta.
do $$
declare t text;
begin
  foreach t in array array['expedicoes','expedicao_caixas','expedicao_itens'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "%s_scoped" on public.%I;', t, t);
    execute format('create policy "%s_scoped" on public.%I for select to authenticated
                    using (empresa_id in (select public.empresas_permitidas()));', t, t);
  end loop;
end $$;

drop trigger if exists trg_expedicoes_updated_at on public.expedicoes;
create trigger trg_expedicoes_updated_at before update on public.expedicoes
  for each row execute function public.fn_set_updated_at();

-- ---------- PEDIDO: novos status e travas de transição ----------
--
-- Reescreve fn_pedido_bloquear_cabecalho (atualização 27) preservando TODO o
-- comportamento anterior (updated_at, cancelado_em, trava de cancelado→outro,
-- reabertura com motivo, trava de cliente/data fora de Pendente, trava de
-- pedido sem item) e acrescentando:
--   1. Cancelar ou reabrir um pedido com NF-e autorizada passa a exigir
--      cancelar a nota primeiro (regra 14 do spec de expedição de 25/08).
--   2. Toda transição de status agora passa por uma lista branca: só os pares
--      já prontos no fluxo (Pendente→Separação, Separação→Pendente,
--      Separação→Conferido, Conferido→Faturado, Faturado→Enviado,
--      Faturado/Enviado→Pendente) são aceitos; qualquer outro par é recusado
--      — fecha a brecha de hoje, em que `update pedidos set status =
--      'Faturado'` direto pulava separação e emissão.
--   3. Cada transição da lista branca exige que o registro correspondente já
--      exista no estado certo (expedição em rascunho pra ir a Separação,
--      expedição finalizada pra ir a Conferido, NF-e autorizada pra ir a
--      Faturado) — sempre gravado ANTES pela rota de API, nunca inferido.
create or replace function public.fn_pedido_bloquear_cabecalho() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := clock_timestamp();

  if new.status = 'Cancelado' and old.status is distinct from 'Cancelado' then
    if exists (select 1 from public.nfe_saida_documentos d where d.pedido_id = new.id and d.status = 'autorizado') then
      raise exception 'Pedido % tem NF-e autorizada — cancele a nota antes de cancelar o pedido.', new.id
        using errcode = 'check_violation';
    end if;
    new.cancelado_em := clock_timestamp();
  end if;

  if old.status = 'Cancelado' and new.status is distinct from 'Cancelado' then
    raise exception 'Pedido cancelado não volta para %.', new.status
      using errcode = 'check_violation';
  end if;

  if old.status in ('Faturado', 'Enviado') and new.status = 'Pendente' then
    if exists (select 1 from public.nfe_saida_documentos d where d.pedido_id = new.id and d.status = 'autorizado') then
      raise exception 'Pedido % tem NF-e autorizada — cancele a nota antes de reabrir o pedido.', new.id
        using errcode = 'check_violation';
    end if;
    if new.reaberto_motivo is null
       or btrim(new.reaberto_motivo) = ''
       or new.reaberto_motivo is not distinct from old.reaberto_motivo then
      raise exception 'Reabrir o pedido % exige informar um motivo novo da reabertura.', old.id
        using errcode = 'check_violation';
    end if;
    new.reaberto_em := clock_timestamp();
  end if;

  -- Lista branca de transição de status — roda só quando o status muda de
  -- verdade, pra não travar um update comum de observações/responsável.
  if new.status is distinct from old.status and new.status <> 'Cancelado' then
    if old.status = 'Pendente' and new.status = 'Separação' then
      if not exists (select 1 from public.expedicoes ex where ex.pedido_id = new.id and ex.status = 'rascunho') then
        raise exception 'Crie o romaneio de separação antes de mudar o pedido % para Separação.', new.id
          using errcode = 'check_violation';
      end if;
    elsif old.status = 'Separação' and new.status = 'Pendente' then
      if exists (select 1 from public.expedicoes ex where ex.pedido_id = new.id and ex.status = 'rascunho') then
        raise exception 'Cancele o romaneio em rascunho do pedido % antes de voltar para Pendente.', new.id
          using errcode = 'check_violation';
      end if;
    elsif old.status = 'Separação' and new.status = 'Conferido' then
      if not exists (select 1 from public.expedicoes ex where ex.pedido_id = new.id and ex.status = 'finalizado') then
        raise exception 'Finalize o romaneio de separação antes de mudar o pedido % para Conferido.', new.id
          using errcode = 'check_violation';
      end if;
    elsif old.status = 'Conferido' and new.status = 'Faturado' then
      if not exists (select 1 from public.nfe_saida_documentos d where d.pedido_id = new.id and d.status = 'autorizado') then
        raise exception 'Pedido % não tem NF-e autorizada — não é possível marcar como Faturado.', new.id
          using errcode = 'check_violation';
      end if;
    elsif old.status = 'Faturado' and new.status = 'Enviado' then
      null; -- livre, comportamento já existente
    elsif old.status in ('Faturado', 'Enviado') and new.status = 'Pendente' then
      null; -- reabertura: motivo e trava de nota autorizada já checados acima
    else
      raise exception 'Transição de status inválida: % → % (pedido %).', old.status, new.status, new.id
        using errcode = 'check_violation';
    end if;
  end if;

  if old.status is distinct from 'Pendente'
     and (new.cliente_id is distinct from old.cliente_id or new.data is distinct from old.data) then
    raise exception 'Pedido % está % — cliente e data não podem ser alterados.', old.id, old.status
      using errcode = 'check_violation';
  end if;

  if old.status = 'Pendente' and new.status not in ('Pendente', 'Cancelado')
     and not exists (select 1 from public.pedido_itens where pedido_id = new.id) then
    raise exception 'Pedido sem itens não pode sair de Pendente.'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

commit;

-- ---------- ROLLBACK ----------
-- begin;
--
-- -- Volta fn_pedido_bloquear_cabecalho para a versão da atualização 27 (sem
-- -- as travas de Separação/Conferido/Faturado e sem a trava de NF-e
-- -- autorizada) — copie o corpo da função de atualizacao_27_pedidos_edicao.sql
-- -- aqui antes de rodar este rollback em produção.
--
-- drop trigger if exists trg_expedicoes_updated_at on public.expedicoes;
-- drop view if exists public.vw_estoque_produto_lote;
-- drop table if exists public.expedicao_itens;
-- drop table if exists public.expedicao_caixas;
-- drop table if exists public.expedicoes;
-- drop table if exists public.transportadoras;
--
-- commit;
```

- [ ] **Step 2: Escrever a fixture de teste local**

```sql
-- tests/migracao-50/fixture.sql
-- Base mínima pra exercitar a atualização 50 num Postgres local descartável.
-- Recria pedidos/pedido_itens/nfe_saida_documentos e a função
-- fn_pedido_bloquear_cabecalho COMO ELAS EXISTEM HOJE (pré-50, atualização
-- 27) — a 50 faz `create or replace`, então o teste prova a transição real.
create extension if not exists pgcrypto;

create table if not exists public.empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null
);
create table if not exists public.funcionarios (
  id uuid primary key default gen_random_uuid()
);
create table if not exists public.clientes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id)
);
create table if not exists public.produtos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id)
);
create table if not exists public.pedidos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  data date not null default current_date,
  cliente_id uuid references public.clientes(id),
  status text not null default 'Pendente',
  responsavel_id uuid references public.funcionarios(id),
  observacoes text,
  cancelado_motivo text,
  cancelado_em timestamptz,
  cancelado_por_id uuid references public.funcionarios(id),
  reaberto_motivo text,
  reaberto_em timestamptz,
  reaberto_por_id uuid references public.funcionarios(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.pedido_itens (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  produto_id uuid not null references public.produtos(id),
  quantidade numeric(12,4) not null,
  preco_unitario numeric(12,2) not null
);
create table if not exists public.recebimento_itens (
  id uuid primary key default gen_random_uuid(),
  validade date
);
create table if not exists public.embalagem_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id),
  produto_id uuid references public.produtos(id),
  recebimento_item_id uuid references public.recebimento_itens(id),
  quantidade numeric(12,3) not null,
  validade date
);
create table if not exists public.naturezas_operacao (
  id uuid primary key default gen_random_uuid()
);
create table if not exists public.nfe_saida_documentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id),
  pedido_id uuid references public.pedidos(id),
  status text not null default 'rascunho'
);

create or replace function public.fn_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

create or replace function public.empresas_permitidas()
returns setof uuid language sql stable as $$
  select id from public.empresas where nome = '364 Food Services'
$$;

-- fn_pedido_bloquear_cabecalho tal como a atualização 27 a deixou (cópia
-- literal do corpo em supabase/atualizacao_27_pedidos_edicao.sql) — a 50
-- substitui por create or replace, então rodar a 50 aqui em cima prova a
-- transição real, não uma versão hipotética.
create or replace function public.fn_pedido_bloquear_cabecalho() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := clock_timestamp();
  if new.status = 'Cancelado' and old.status is distinct from 'Cancelado' then
    new.cancelado_em := clock_timestamp();
  end if;
  if old.status = 'Cancelado' and new.status is distinct from 'Cancelado' then
    raise exception 'Pedido cancelado não volta para %.', new.status using errcode = 'check_violation';
  end if;
  if old.status in ('Faturado', 'Enviado') and new.status = 'Pendente' then
    if new.reaberto_motivo is null or btrim(new.reaberto_motivo) = ''
       or new.reaberto_motivo is not distinct from old.reaberto_motivo then
      raise exception 'Reabrir o pedido % exige informar um motivo novo da reabertura.', old.id
        using errcode = 'check_violation';
    end if;
    new.reaberto_em := clock_timestamp();
  end if;
  if old.status is distinct from 'Pendente'
     and (new.cliente_id is distinct from old.cliente_id or new.data is distinct from old.data) then
    raise exception 'Pedido % está % — cliente e data não podem ser alterados.', old.id, old.status
      using errcode = 'check_violation';
  end if;
  if old.status = 'Pendente' and new.status not in ('Pendente', 'Cancelado')
     and not exists (select 1 from public.pedido_itens where pedido_id = new.id) then
    raise exception 'Pedido sem itens não pode sair de Pendente.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_pedidos_bloquear_cabecalho on public.pedidos;
create trigger trg_pedidos_bloquear_cabecalho before update on public.pedidos
  for each row execute function public.fn_pedido_bloquear_cabecalho();

do $$ begin create role authenticated; exception when duplicate_object then null; end $$;

insert into public.empresas (id, nome) values
  ('11111111-1111-1111-1111-111111111111', '364 Food Services')
  on conflict (id) do nothing;
insert into public.clientes (id, empresa_id) values
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111')
  on conflict (id) do nothing;
insert into public.produtos (id, empresa_id) values
  ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111')
  on conflict (id) do nothing;

-- pedido_a: Pendente, com 1 item (pronto pra sair de Pendente).
insert into public.pedidos (id, empresa_id, cliente_id, status) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'cccccccc-0000-0000-0000-000000000001', 'Pendente')
  on conflict (id) do nothing;
insert into public.pedido_itens (id, pedido_id, produto_id, quantidade, preco_unitario) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000001', 10, 25.5)
  on conflict (id) do nothing;
```

- [ ] **Step 3: Escrever os cenários**

```sql
-- tests/migracao-50/cenarios.sql
-- pedido_a = aaaaaaaa-0000-0000-0000-000000000001 (Pendente, 1 item — ver fixture.sql)
\set ON_ERROR_STOP on

-- Cenário 1: Pendente → Separação é recusado sem expedição em rascunho.
do $$
begin
  begin
    update public.pedidos set status = 'Separação' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
    raise exception 'FALHA 1: Pendente→Separação foi aceito sem expedição em rascunho';
  exception when check_violation then null;
  end;
  raise notice 'OK 1: Pendente→Separação recusado sem romaneio';
end $$;

-- Cenário 2: criando o romaneio em rascunho, a transição passa a ser aceita.
insert into public.expedicoes (id, empresa_id, pedido_id, numero, status) values
  ('eeeeeeee-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000001', 'RM-260910-001', 'rascunho');
update public.pedidos set status = 'Separação' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$
declare v_status text;
begin
  select status into v_status from public.pedidos where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  if v_status <> 'Separação' then raise exception 'FALHA 2: status esperado Separação, veio %', v_status; end if;
  raise notice 'OK 2: Pendente→Separação aceito com expedição em rascunho';
end $$;

-- Cenário 3: Separação → Conferido é recusado enquanto a expedição não foi finalizada.
do $$
begin
  begin
    update public.pedidos set status = 'Conferido' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
    raise exception 'FALHA 3: Separação→Conferido foi aceito com expedição em rascunho';
  exception when check_violation then null;
  end;
  raise notice 'OK 3: Separação→Conferido recusado sem romaneio finalizado';
end $$;

-- Cenário 4: Separação → Pendente é recusado enquanto o romaneio segue em rascunho.
do $$
begin
  begin
    update public.pedidos set status = 'Pendente' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
    raise exception 'FALHA 4: Separação→Pendente foi aceito com expedição ainda em rascunho';
  exception when check_violation then null;
  end;
  raise notice 'OK 4: Separação→Pendente recusado sem cancelar o romaneio primeiro';
end $$;

-- Cenário 5: finalizando a expedição, Separação → Conferido passa a ser aceito.
update public.expedicoes set status = 'finalizado' where id = 'eeeeeeee-0000-0000-0000-000000000001';
update public.pedidos set status = 'Conferido' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$
declare v_status text;
begin
  select status into v_status from public.pedidos where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  if v_status <> 'Conferido' then raise exception 'FALHA 5: status esperado Conferido, veio %', v_status; end if;
  raise notice 'OK 5: Separação→Conferido aceito com romaneio finalizado';
end $$;

-- Cenário 6: Conferido → Faturado é recusado sem NF-e autorizada.
do $$
begin
  begin
    update public.pedidos set status = 'Faturado' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
    raise exception 'FALHA 6: Conferido→Faturado foi aceito sem NF-e autorizada';
  exception when check_violation then null;
  end;
  raise notice 'OK 6: Conferido→Faturado recusado sem nota autorizada';
end $$;

-- Cenário 7: com a NF-e autorizada, Conferido → Faturado passa a ser aceito.
insert into public.nfe_saida_documentos (id, empresa_id, pedido_id, status) values
  ('ffffffff-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000001', 'autorizado');
update public.pedidos set status = 'Faturado' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$
declare v_status text;
begin
  select status into v_status from public.pedidos where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  if v_status <> 'Faturado' then raise exception 'FALHA 7: status esperado Faturado, veio %', v_status; end if;
  raise notice 'OK 7: Conferido→Faturado aceito com NF-e autorizada';
end $$;

-- Cenário 8: pedido com NF-e autorizada não cancela nem reabre direto.
do $$
begin
  begin
    update public.pedidos set status = 'Cancelado', cancelado_motivo = 'teste'
      where id = 'aaaaaaaa-0000-0000-0000-000000000001';
    raise exception 'FALHA 8a: cancelamento com NF-e autorizada foi aceito';
  exception when check_violation then null;
  end;
  begin
    update public.pedidos set status = 'Pendente', reaberto_motivo = 'teste'
      where id = 'aaaaaaaa-0000-0000-0000-000000000001';
    raise exception 'FALHA 8b: reabertura com NF-e autorizada foi aceita';
  exception when check_violation then null;
  end;
  raise notice 'OK 8: cancelar/reabrir com NF-e autorizada exige cancelar a nota primeiro';
end $$;

-- Cenário 9: transição fora da lista branca (ex.: Pendente→Faturado direto) é recusada.
insert into public.pedidos (id, empresa_id, cliente_id, status) values
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'cccccccc-0000-0000-0000-000000000001', 'Pendente');
insert into public.pedido_itens (id, pedido_id, produto_id, quantidade, preco_unitario) values
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002',
   'dddddddd-0000-0000-0000-000000000001', 1, 10);
do $$
begin
  begin
    update public.pedidos set status = 'Faturado' where id = 'aaaaaaaa-0000-0000-0000-000000000002';
    raise exception 'FALHA 9: Pendente→Faturado direto (pulando romaneio e emissão) foi aceito';
  exception when check_violation then null;
  end;
  raise notice 'OK 9: transição fora da lista branca recusada';
end $$;

-- Cenário 10: expedicoes_pedido_vivo_unico deixa refazer o romaneio depois de cancelar o anterior.
insert into public.expedicoes (id, empresa_id, pedido_id, numero, status) values
  ('eeeeeeee-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000002', 'RM-260910-002', 'rascunho');
do $$
begin
  begin
    insert into public.expedicoes (empresa_id, pedido_id, numero, status) values
      ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'RM-260910-003', 'rascunho');
    raise exception 'FALHA 10a: segundo romaneio vivo para o mesmo pedido foi aceito';
  exception when unique_violation then null;
  end;
  update public.expedicoes set status = 'cancelado' where id = 'eeeeeeee-0000-0000-0000-000000000002';
  insert into public.expedicoes (empresa_id, pedido_id, numero, status) values
    ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'RM-260910-003', 'rascunho');
  raise notice 'OK 10: cancelar o romaneio anterior libera criar um novo pro mesmo pedido';
end $$;

-- Cenário 11: RLS ligada com só policy de SELECT em expedicoes/expedicao_caixas/expedicao_itens.
do $$
declare t text; escritas int;
begin
  foreach t in array array['expedicoes','expedicao_caixas','expedicao_itens'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception 'FALHA 11a: RLS desligada em %', t;
    end if;
  end loop;
  select count(*) into escritas from pg_policies
   where schemaname = 'public' and tablename in ('expedicoes','expedicao_caixas','expedicao_itens')
     and cmd <> 'SELECT';
  if escritas <> 0 then
    raise exception 'FALHA 11b: existe policy de escrita para authenticated em tabela de expedição';
  end if;
  raise notice 'OK 11: RLS só de SELECT em expedicoes/expedicao_caixas/expedicao_itens';
end $$;

-- Cenário 12: vw_estoque_produto_lote calcula saldo = embalado - expedido em
-- expedições não canceladas, e ignora expedições canceladas.
insert into public.embalagem_itens (id, empresa_id, produto_id, recebimento_item_id, quantidade, validade) values
  ('99999999-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001', 20, '2026-12-01');
insert into public.recebimento_itens (id, validade) values ('aaaaaaaa-1111-0000-0000-000000000001', '2026-12-01')
  on conflict (id) do nothing;
with nova_caixa as (
  insert into public.expedicao_caixas (empresa_id, expedicao_id, numero)
  values ('11111111-1111-1111-1111-111111111111', 'eeeeeeee-0000-0000-0000-000000000002', 1)
  returning id
)
insert into public.expedicao_itens (empresa_id, expedicao_caixa_id, pedido_item_id, produto_id, recebimento_item_id, quantidade)
select '11111111-1111-1111-1111-111111111111', nova_caixa.id, 'bbbbbbbb-0000-0000-0000-000000000002',
       'dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001', 6
from nova_caixa;
do $$
declare v_saldo numeric;
begin
  select saldo into v_saldo from public.vw_estoque_produto_lote
   where recebimento_item_id = 'aaaaaaaa-1111-0000-0000-000000000001';
  if v_saldo <> 14 then raise exception 'FALHA 12: saldo esperado 14 (20-6), veio %', v_saldo; end if;
  raise notice 'OK 12: vw_estoque_produto_lote calcula saldo = embalado - expedido';
end $$;

select 'CENÁRIOS DA 50 OK' as resultado;
```

- [ ] **Step 4: Escrever o script de verificação**

```bash
#!/usr/bin/env bash
# tests/migracao-50/verificar.sh
# Mesmo padrão de tests/migracao-43/verificar.sh — Postgres local descartável.
set -euo pipefail
export PGOPTIONS='-c client_min_messages=notice'

AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
BANCO="${BANCO_TESTE_EXPEDICAO:-expedicao_test_364}"
MIGRACAO="$RAIZ/supabase/atualizacao_50_expedicao_romaneio.sql"

command -v psql >/dev/null || { echo "psql não encontrado no PATH"; exit 1; }
pg_isready -q || { echo "nenhum Postgres local aceitando conexões"; exit 1; }

limpar() { dropdb --if-exists "$BANCO" >/dev/null 2>&1 || true; }
trap limpar EXIT
limpar
createdb "$BANCO"

psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/fixture.sql"

# Duas vezes seguidas: prova idempotência.
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$MIGRACAO"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$MIGRACAO"

psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/cenarios.sql"

echo "MIGRAÇÃO 50 OK"
```

- [ ] **Step 5: Rodar a verificação local**

Run: `chmod +x tests/migracao-50/verificar.sh && ./tests/migracao-50/verificar.sh`
Expected: `MIGRAÇÃO 50 OK` — se não houver Postgres local, instale (`brew install postgresql@16` no Mac) e rode `brew services start postgresql@16` antes.

- [ ] **Step 6: Commit**

```bash
git add supabase/atualizacao_50_expedicao_romaneio.sql tests/migracao-50/
git commit -m "feat(pedidos): schema de romaneio de separação, transportadora e novos status do pedido"
```

---

### Task 2: Migração 51 — contas a receber

**Files:**
- Create: `supabase/atualizacao_51_contas_a_receber.sql`
- Create: `tests/migracao-51/fixture.sql`
- Create: `tests/migracao-51/cenarios.sql`
- Create: `tests/migracao-51/verificar.sh`

**Interfaces:**
- Consumes: `pedidos`, `clientes`, `empresas`, `nfe_saida_documentos` (Task 1's schema não é necessário aqui, mas `nfe_saida_documentos` precisa existir — já existe em produção desde a atualização 43).
- Produces: `contas_a_receber` (id, descricao, cliente_id, pedido_id, nfe_saida_documento_id único, valor_total, responsavel_id, empresa_id, created_at), `contas_a_receber_parcelas` (id, conta_a_receber_id, numero, valor, vencimento, status ['Pendente'|'Recebido'], data_recebimento, forma_recebimento, comprovante_path, empresa_id, created_at). Task 11 (emitir.js) grava nestas tabelas; Task 22 (tela) lê e dá baixa.

- [ ] **Step 1: Escrever a migração**

```sql
-- supabase/atualizacao_51_contas_a_receber.sql
--
-- Espelha contas_a_pagar/contas_a_pagar_parcelas (atualização 16) do lado da
-- receita. Schema já fechado em docs/superpowers/specs/
-- 2026-08-25-financeiro-contas-a-receber-design.md — sem mudança aqui.
-- Toda conta nasce de uma NF-e de saída autorizada (gravada pelo motor de
-- emissão, Task 11) — sem lançamento avulso nesta fase.
begin;

create table if not exists public.contas_a_receber (
  id uuid primary key default gen_random_uuid(),
  descricao text not null,
  cliente_id uuid not null references public.clientes(id),
  pedido_id uuid not null references public.pedidos(id),
  nfe_saida_documento_id uuid not null references public.nfe_saida_documentos(id),
  valor_total numeric(12,2) not null,
  responsavel_id uuid references public.funcionarios(id),
  empresa_id uuid not null references public.empresas(id),
  created_at timestamptz not null default now()
);
create unique index if not exists contas_a_receber_nfe_documento_unico
  on public.contas_a_receber(nfe_saida_documento_id);
create index if not exists contas_a_receber_empresa_id_idx on public.contas_a_receber(empresa_id);
create index if not exists contas_a_receber_pedido_id_idx on public.contas_a_receber(pedido_id);
create index if not exists contas_a_receber_cliente_id_idx on public.contas_a_receber(cliente_id);

create table if not exists public.contas_a_receber_parcelas (
  id uuid primary key default gen_random_uuid(),
  conta_a_receber_id uuid not null references public.contas_a_receber(id) on delete cascade,
  numero int not null,
  valor numeric(12,2) not null,
  vencimento date not null,
  status text not null default 'Pendente' check (status in ('Pendente', 'Recebido')),
  data_recebimento date,
  forma_recebimento text,
  comprovante_path text,
  empresa_id uuid not null references public.empresas(id),
  created_at timestamptz not null default now(),
  unique (conta_a_receber_id, numero)
);
create index if not exists contas_a_receber_parcelas_conta_id_idx on public.contas_a_receber_parcelas(conta_a_receber_id);
create index if not exists contas_a_receber_parcelas_empresa_id_idx on public.contas_a_receber_parcelas(empresa_id);

-- RLS "for all": a baixa de parcela (marcar Recebido) é update direto do
-- navegador, mesmo padrão de contas_a_pagar_parcelas — só a criação inicial
-- é do motor de emissão (service role, que ignora RLS de qualquer forma).
do $$
declare t text;
begin
  foreach t in array array['contas_a_receber','contas_a_receber_parcelas'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "empresa_scoped_access" on public.%I;', t);
    execute format('create policy "empresa_scoped_access" on public.%I for all
                    using (auth.role() = ''authenticated'' and empresa_id in (select public.empresas_permitidas()))
                    with check (auth.role() = ''authenticated'' and empresa_id in (select public.empresas_permitidas()));', t);
  end loop;
end $$;

-- Regra de integridade (espelha o bloqueio já existente de exclusão de
-- Recebimento com parcela paga, atualização 16): NF-e cancelada sem nenhuma
-- parcela recebida derruba a conta em cascata (a nota nunca existiu do ponto
-- de vista financeiro); com parcela recebida, bloqueia o cancelamento da
-- nota, apontando pra conta.
create or replace function public.bloquear_cancelamento_nfe_com_parcela_recebida()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelado' and old.status is distinct from 'cancelado' then
    if exists (
      select 1 from public.contas_a_receber cr
      join public.contas_a_receber_parcelas pc on pc.conta_a_receber_id = cr.id
      where cr.nfe_saida_documento_id = old.id and pc.status = 'Recebido'
    ) then
      raise exception 'Não é possível cancelar: esta nota já tem parcela recebida na Conta a Receber. Ajuste em Financeiro antes.'
        using errcode = 'check_violation';
    end if;
    delete from public.contas_a_receber where nfe_saida_documento_id = old.id;
  end if;
  return new;
end $$;

drop trigger if exists trg_bloquear_cancelamento_nfe_com_parcela_recebida on public.nfe_saida_documentos;
create trigger trg_bloquear_cancelamento_nfe_com_parcela_recebida
  before update on public.nfe_saida_documentos
  for each row execute function public.bloquear_cancelamento_nfe_com_parcela_recebida();

commit;

-- ---------- ROLLBACK ----------
-- begin;
-- drop trigger if exists trg_bloquear_cancelamento_nfe_com_parcela_recebida on public.nfe_saida_documentos;
-- drop function if exists public.bloquear_cancelamento_nfe_com_parcela_recebida();
-- drop table if exists public.contas_a_receber_parcelas;
-- drop table if exists public.contas_a_receber;
-- commit;
```

- [ ] **Step 2: Escrever fixture.sql**

```sql
-- tests/migracao-51/fixture.sql
create extension if not exists pgcrypto;
create table if not exists public.empresas (id uuid primary key default gen_random_uuid(), nome text not null);
create table if not exists public.funcionarios (id uuid primary key default gen_random_uuid());
create table if not exists public.clientes (id uuid primary key default gen_random_uuid(), empresa_id uuid references public.empresas(id));
create table if not exists public.pedidos (id uuid primary key default gen_random_uuid(), empresa_id uuid references public.empresas(id));
create table if not exists public.nfe_saida_documentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id),
  pedido_id uuid references public.pedidos(id),
  status text not null default 'rascunho'
);

create or replace function public.empresas_permitidas()
returns setof uuid language sql stable as $$
  select id from public.empresas where nome = '364 Food Services'
$$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;

insert into public.empresas (id, nome) values ('11111111-1111-1111-1111-111111111111', '364 Food Services') on conflict (id) do nothing;
insert into public.clientes (id, empresa_id) values ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111') on conflict (id) do nothing;
insert into public.pedidos (id, empresa_id) values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111') on conflict (id) do nothing;
insert into public.nfe_saida_documentos (id, empresa_id, pedido_id, status) values
  ('ffffffff-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'autorizado')
  on conflict (id) do nothing;
```

- [ ] **Step 3: Escrever cenarios.sql**

```sql
-- tests/migracao-51/cenarios.sql
\set ON_ERROR_STOP on

-- Cenário 1: unique(nfe_saida_documento_id) — uma conta por nota, nunca duas.
insert into public.contas_a_receber (id, descricao, cliente_id, pedido_id, nfe_saida_documento_id, valor_total, empresa_id) values
  ('11111111-0000-0000-0000-000000000001', 'NF-e 1 — Cliente Teste', 'cccccccc-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000001', 255.00,
   '11111111-1111-1111-1111-111111111111');
do $$
begin
  begin
    insert into public.contas_a_receber (descricao, cliente_id, pedido_id, nfe_saida_documento_id, valor_total, empresa_id) values
      ('duplicata', 'cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
       'ffffffff-0000-0000-0000-000000000001', 255.00, '11111111-1111-1111-1111-111111111111');
    raise exception 'FALHA 1: segunda conta pra mesma nota foi aceita';
  exception when unique_violation then null;
  end;
  raise notice 'OK 1: uma conta a receber por nota';
end $$;

insert into public.contas_a_receber_parcelas (id, conta_a_receber_id, numero, valor, vencimento, empresa_id) values
  ('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 1, 255.00, current_date,
   '11111111-1111-1111-1111-111111111111');

-- Cenário 2: cancelar a NF-e sem parcela recebida derruba a conta em cascata.
update public.nfe_saida_documentos set status = 'cancelado' where id = 'ffffffff-0000-0000-0000-000000000001';
do $$
declare n int;
begin
  select count(*) into n from public.contas_a_receber where nfe_saida_documento_id = 'ffffffff-0000-0000-0000-000000000001';
  if n <> 0 then raise exception 'FALHA 2: conta a receber sobreviveu ao cancelamento da nota sem parcela recebida'; end if;
  raise notice 'OK 2: cancelamento sem parcela recebida remove a conta em cascata';
end $$;

-- Cenário 3: cancelar NF-e com parcela recebida é bloqueado.
insert into public.nfe_saida_documentos (id, empresa_id, pedido_id, status) values
  ('ffffffff-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000001', 'autorizado');
insert into public.contas_a_receber (id, descricao, cliente_id, pedido_id, nfe_saida_documento_id, valor_total, empresa_id) values
  ('11111111-0000-0000-0000-000000000002', 'NF-e 2', 'cccccccc-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000002', 100.00,
   '11111111-1111-1111-1111-111111111111');
insert into public.contas_a_receber_parcelas (conta_a_receber_id, numero, valor, vencimento, status, data_recebimento, empresa_id) values
  ('11111111-0000-0000-0000-000000000002', 1, 100.00, current_date, 'Recebido', current_date,
   '11111111-1111-1111-1111-111111111111');
do $$
begin
  begin
    update public.nfe_saida_documentos set status = 'cancelado' where id = 'ffffffff-0000-0000-0000-000000000002';
    raise exception 'FALHA 3: cancelamento com parcela recebida foi aceito';
  exception when check_violation then null;
  end;
  raise notice 'OK 3: cancelamento bloqueado com parcela já recebida';
end $$;

select 'CENÁRIOS DA 51 OK' as resultado;
```

- [ ] **Step 4: Escrever verificar.sh** (idêntico ao padrão do Task 1, trocando o número da migração e do banco: `BANCO_TESTE_RECEBER`, `atualizacao_51_contas_a_receber.sql`).

- [ ] **Step 5: Rodar a verificação local**

Run: `chmod +x tests/migracao-51/verificar.sh && ./tests/migracao-51/verificar.sh`
Expected: `MIGRAÇÃO 51 OK`

- [ ] **Step 6: Commit**

```bash
git add supabase/atualizacao_51_contas_a_receber.sql tests/migracao-51/
git commit -m "feat(financeiro): schema de contas a receber, geradas na autorização da NF-e"
```

---

### Task 3: `lib/expedicao.js` — FEFO e sugestão de alocação

**Files:**
- Create: `lib/expedicao.js`
- Test: `tests/expedicao.test.mjs`

**Interfaces:**
- Consumes: nada de outras tasks (lógica pura).
- Produces: `ordenarFefo(lotes)`, `sugerirAlocacao(itensPedido, lotesPorProduto)` — usados por Task 20 (UI de expedição) e testados aqui.

- [ ] **Step 1: Escrever os testes**

```js
// tests/expedicao.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { ordenarFefo, sugerirAlocacao } from '../lib/expedicao.js';

test('ordenarFefo: lote que vence primeiro vem primeiro', () => {
  const lotes = [
    { recebimentoItemId: 'b', validade: '2026-12-01', saldo: 10 },
    { recebimentoItemId: 'a', validade: '2026-10-01', saldo: 5 },
  ];
  const ordenado = ordenarFefo(lotes);
  assert.deepEqual(ordenado.map(l => l.recebimentoItemId), ['a', 'b']);
});

test('ordenarFefo: lote sem validade vai para o fim', () => {
  const lotes = [
    { recebimentoItemId: 'sem_validade', validade: null, saldo: 10 },
    { recebimentoItemId: 'com_validade', validade: '2026-10-01', saldo: 5 },
  ];
  const ordenado = ordenarFefo(lotes);
  assert.deepEqual(ordenado.map(l => l.recebimentoItemId), ['com_validade', 'sem_validade']);
});

test('sugerirAlocacao: item rastreado consome o lote que vence primeiro até cobrir a quantidade', () => {
  const itensPedido = [{ pedidoItemId: 'i1', produtoId: 'p1', quantidade: 8, rastreado: true }];
  const lotesPorProduto = {
    p1: [
      { recebimentoItemId: 'lote_a', validade: '2026-10-01', saldo: 5 },
      { recebimentoItemId: 'lote_b', validade: '2026-11-01', saldo: 10 },
    ],
  };
  const alocacao = sugerirAlocacao(itensPedido, lotesPorProduto);
  assert.deepEqual(alocacao, [
    { pedidoItemId: 'i1', recebimentoItemId: 'lote_a', quantidade: 5 },
    { pedidoItemId: 'i1', recebimentoItemId: 'lote_b', quantidade: 3 },
  ]);
});

test('sugerirAlocacao: item não rastreado entra sem lote, com a quantidade inteira', () => {
  const itensPedido = [{ pedidoItemId: 'i1', produtoId: 'p1', quantidade: 4, rastreado: false }];
  const alocacao = sugerirAlocacao(itensPedido, {});
  assert.deepEqual(alocacao, [{ pedidoItemId: 'i1', recebimentoItemId: null, quantidade: 4 }]);
});

test('sugerirAlocacao: item rastreado sem saldo suficiente completa o resto sem lote', () => {
  const itensPedido = [{ pedidoItemId: 'i1', produtoId: 'p1', quantidade: 10, rastreado: true }];
  const lotesPorProduto = { p1: [{ recebimentoItemId: 'lote_a', validade: '2026-10-01', saldo: 4 }] };
  const alocacao = sugerirAlocacao(itensPedido, lotesPorProduto);
  assert.deepEqual(alocacao, [
    { pedidoItemId: 'i1', recebimentoItemId: 'lote_a', quantidade: 4 },
    { pedidoItemId: 'i1', recebimentoItemId: null, quantidade: 6 },
  ]);
});

test('sugerirAlocacao: lote com saldo zero é ignorado', () => {
  const itensPedido = [{ pedidoItemId: 'i1', produtoId: 'p1', quantidade: 3, rastreado: true }];
  const lotesPorProduto = {
    p1: [
      { recebimentoItemId: 'lote_zerado', validade: '2026-09-01', saldo: 0 },
      { recebimentoItemId: 'lote_a', validade: '2026-10-01', saldo: 5 },
    ],
  };
  const alocacao = sugerirAlocacao(itensPedido, lotesPorProduto);
  assert.deepEqual(alocacao, [{ pedidoItemId: 'i1', recebimentoItemId: 'lote_a', quantidade: 3 }]);
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node --test tests/expedicao.test.mjs`
Expected: FAIL — `lib/expedicao.js` não existe ainda.

- [ ] **Step 3: Implementar**

```js
// lib/expedicao.js
//
// Lógica pura do romaneio de separação (expedição): FEFO, empacotamento em
// caixas, divergência pedido × alocado, numeração e volumes pra NF-e. Nada
// aqui toca banco — quem chama já leu as linhas (mesmo padrão de
// lib/nfe/resolverNota.js).

// Lote sem validade vai para o fim — não é "vence primeiro", é "não se sabe
// quando vence", e a lista tem que continuar utilizável antes dele.
export function ordenarFefo(lotes) {
  return [...lotes].sort((a, b) => {
    if (!a.validade && !b.validade) return 0;
    if (!a.validade) return 1;
    if (!b.validade) return -1;
    return a.validade < b.validade ? -1 : a.validade > b.validade ? 1 : 0;
  });
}

// Para cada item do pedido: se o produto é rastreado, consome os lotes
// disponíveis em ordem FEFO até cobrir a quantidade; o que sobrar sem saldo
// de lote (ou o item inteiro, se não for rastreado) entra com
// recebimentoItemId null — "sem lote", aceito desde a revisão de 25/08 da
// Fase 4. Nunca aloca mais do que a quantidade pedida.
export function sugerirAlocacao(itensPedido, lotesPorProduto) {
  const alocacao = [];
  for (const item of itensPedido) {
    let restante = Number(item.quantidade);
    if (item.rastreado) {
      const lotes = ordenarFefo(lotesPorProduto[item.produtoId] || []);
      for (const lote of lotes) {
        if (restante <= 0) break;
        const saldo = Number(lote.saldo);
        if (!(saldo > 0)) continue;
        const usar = Math.min(saldo, restante);
        alocacao.push({ pedidoItemId: item.pedidoItemId, recebimentoItemId: lote.recebimentoItemId, quantidade: usar });
        restante -= usar;
      }
    }
    if (restante > 0) {
      alocacao.push({ pedidoItemId: item.pedidoItemId, recebimentoItemId: null, quantidade: restante });
    }
  }
  return alocacao;
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node --test tests/expedicao.test.mjs`
Expected: PASS (6 testes)

- [ ] **Step 5: Commit**

```bash
git add lib/expedicao.js tests/expedicao.test.mjs
git commit -m "feat(expedicao): FEFO e sugestão de alocação de lote por item do pedido"
```

---

### Task 4: `lib/expedicao.js` — empacotamento em caixas

**Files:**
- Modify: `lib/expedicao.js`
- Modify: `tests/expedicao.test.mjs`

**Interfaces:**
- Consumes: saída de `sugerirAlocacao` (Task 3): `{ pedidoItemId, recebimentoItemId, quantidade }[]`.
- Produces: `empacotarCaixas(alocacao, itensPorPedidoItemId)` → `{ produtoId, itens: [{pedidoItemId, recebimentoItemId, quantidade}] }[][]` (array de caixas, cada caixa é array de itens). Usado por Task 20.

- [ ] **Step 1: Adicionar os testes**

```js
// acrescentar em tests/expedicao.test.mjs
import { empacotarCaixas } from '../lib/expedicao.js';

const PRODUTO_POR_ITEM = { i1: 'p1', i2: 'p2', i3: 'p3' };

test('empacotarCaixas: até 12 unidades do mesmo produto cabem numa caixa', () => {
  const alocacao = [{ pedidoItemId: 'i1', recebimentoItemId: 'lote_a', quantidade: 12 }];
  const caixas = empacotarCaixas(alocacao, PRODUTO_POR_ITEM);
  assert.equal(caixas.length, 1);
  assert.equal(caixas[0].reduce((s, i) => s + i.quantidade, 0), 12);
});

test('empacotarCaixas: 13 unidades do mesmo produto viram duas caixas', () => {
  const alocacao = [{ pedidoItemId: 'i1', recebimentoItemId: 'lote_a', quantidade: 13 }];
  const caixas = empacotarCaixas(alocacao, PRODUTO_POR_ITEM);
  assert.equal(caixas.length, 2);
  assert.deepEqual(caixas.map(c => c.reduce((s, i) => s + i.quantidade, 0)), [12, 1]);
});

test('empacotarCaixas: no máximo 2 produtos distintos por caixa', () => {
  const alocacao = [
    { pedidoItemId: 'i1', recebimentoItemId: null, quantidade: 4 },
    { pedidoItemId: 'i2', recebimentoItemId: null, quantidade: 4 },
    { pedidoItemId: 'i3', recebimentoItemId: null, quantidade: 4 },
  ];
  const caixas = empacotarCaixas(alocacao, PRODUTO_POR_ITEM);
  for (const caixa of caixas) {
    const produtosDistintos = new Set(caixa.map(i => PRODUTO_POR_ITEM[i.pedidoItemId]));
    assert.ok(produtosDistintos.size <= 2, `caixa com ${produtosDistintos.size} produtos distintos`);
  }
  // 3 produtos de 4 un., limite de 2 produtos/caixa: não cabem todos numa só.
  assert.ok(caixas.length >= 2);
});

test('empacotarCaixas: caixa não passa de 12 unidades mesmo com 2 produtos cabendo em teoria', () => {
  const alocacao = [
    { pedidoItemId: 'i1', recebimentoItemId: null, quantidade: 10 },
    { pedidoItemId: 'i2', recebimentoItemId: null, quantidade: 10 },
  ];
  const caixas = empacotarCaixas(alocacao, PRODUTO_POR_ITEM);
  for (const caixa of caixas) {
    assert.ok(caixa.reduce((s, i) => s + i.quantidade, 0) <= 12);
  }
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `node --test tests/expedicao.test.mjs`
Expected: FAIL — `empacotarCaixas` não exportado.

- [ ] **Step 3: Implementar**

```js
// acrescentar em lib/expedicao.js
const MAX_UNIDADES_CAIXA = 12;
const MAX_PRODUTOS_DISTINTOS_CAIXA = 2;

// Empacota a alocação em caixas: no máximo 2 produtos distintos e 12
// unidades por caixa (regra 6 do desenho de 20/08). Guloso, em ordem de
// chegada — não otimiza o número de caixas, só respeita os dois limites.
// `produtoPorPedidoItemId` é um mapa simples { pedidoItemId: produtoId },
// já que a alocação não carrega o produto (só o pedidoItemId).
export function empacotarCaixas(alocacao, produtoPorPedidoItemId) {
  const caixas = [];
  let atual = null;

  function novaCaixa() {
    atual = [];
    caixas.push(atual);
    return atual;
  }

  for (const item of alocacao) {
    let restante = Number(item.quantidade);
    while (restante > 0) {
      if (!atual) novaCaixa();
      const produtosNaCaixa = new Set(atual.map(i => produtoPorPedidoItemId[i.pedidoItemId]));
      const produto = produtoPorPedidoItemId[item.pedidoItemId];
      const cabeProduto = produtosNaCaixa.has(produto) || produtosNaCaixa.size < MAX_PRODUTOS_DISTINTOS_CAIXA;
      const unidadesNaCaixa = atual.reduce((s, i) => s + i.quantidade, 0);
      const espaco = MAX_UNIDADES_CAIXA - unidadesNaCaixa;
      if (!cabeProduto || espaco <= 0) {
        novaCaixa();
        continue;
      }
      const usar = Math.min(espaco, restante);
      atual.push({ pedidoItemId: item.pedidoItemId, recebimentoItemId: item.recebimentoItemId, quantidade: usar });
      restante -= usar;
    }
  }
  return caixas;
}
```

- [ ] **Step 4: Rodar e confirmar que passam**

Run: `node --test tests/expedicao.test.mjs`
Expected: PASS (10 testes)

- [ ] **Step 5: Commit**

```bash
git add lib/expedicao.js tests/expedicao.test.mjs
git commit -m "feat(expedicao): empacotamento em caixas (2 produtos/12 unidades)"
```

---

### Task 5: `lib/expedicao.js` — divergência pedido × alocado

**Files:**
- Modify: `lib/expedicao.js`
- Modify: `tests/expedicao.test.mjs`

**Interfaces:**
- Produces: `calcularDivergencia(pedidoItens, alocacao)` → `{ pedidoItemId, pedido: number, alocado: number, diferenca: number }[]` (só os itens com diferença ≠ 0). Usado por Task 16 (rota `finalizar`) para bloquear a finalização.

- [ ] **Step 1: Adicionar os testes**

```js
// acrescentar em tests/expedicao.test.mjs
import { calcularDivergencia } from '../lib/expedicao.js';

test('calcularDivergencia: nada diverge quando o alocado bate com o pedido', () => {
  const pedidoItens = [{ id: 'i1', quantidade: 10 }];
  const alocacao = [{ pedidoItemId: 'i1', recebimentoItemId: 'lote_a', quantidade: 10 }];
  assert.deepEqual(calcularDivergencia(pedidoItens, alocacao), []);
});

test('calcularDivergencia: soma várias linhas de alocação do mesmo item', () => {
  const pedidoItens = [{ id: 'i1', quantidade: 10 }];
  const alocacao = [
    { pedidoItemId: 'i1', recebimentoItemId: 'lote_a', quantidade: 6 },
    { pedidoItemId: 'i1', recebimentoItemId: 'lote_b', quantidade: 4 },
  ];
  assert.deepEqual(calcularDivergencia(pedidoItens, alocacao), []);
});

test('calcularDivergencia: falta alocar aparece com diferença negativa', () => {
  const pedidoItens = [{ id: 'i1', quantidade: 10 }];
  const alocacao = [{ pedidoItemId: 'i1', recebimentoItemId: null, quantidade: 7 }];
  assert.deepEqual(calcularDivergencia(pedidoItens, alocacao), [
    { pedidoItemId: 'i1', pedido: 10, alocado: 7, diferenca: -3 },
  ]);
});

test('calcularDivergencia: item do pedido sem nenhuma alocação aparece com alocado 0', () => {
  const pedidoItens = [{ id: 'i1', quantidade: 5 }];
  assert.deepEqual(calcularDivergencia(pedidoItens, []), [
    { pedidoItemId: 'i1', pedido: 5, alocado: 0, diferenca: -5 },
  ]);
});
```

- [ ] **Step 2: Rodar e confirmar falha, implementar, rodar e confirmar sucesso**

```js
// acrescentar em lib/expedicao.js
// Diferença entre o que o pedido pede e o que foi de fato alocado nas
// caixas, por item — só devolve os itens com diferença ≠ 0 (regra 11 do
// spec de expedição de 25/08: finalizar exige lista vazia aqui).
export function calcularDivergencia(pedidoItens, alocacao) {
  const alocadoPorItem = new Map();
  for (const linha of alocacao) {
    alocadoPorItem.set(linha.pedidoItemId, (alocadoPorItem.get(linha.pedidoItemId) || 0) + Number(linha.quantidade));
  }
  const divergencias = [];
  for (const item of pedidoItens) {
    const pedido = Number(item.quantidade);
    const alocado = alocadoPorItem.get(item.id) || 0;
    const diferenca = Math.round((alocado - pedido) * 10000) / 10000;
    if (diferenca !== 0) divergencias.push({ pedidoItemId: item.id, pedido, alocado, diferenca });
  }
  return divergencias;
}
```

Run: `node --test tests/expedicao.test.mjs`
Expected: PASS (14 testes)

- [ ] **Step 3: Commit**

```bash
git add lib/expedicao.js tests/expedicao.test.mjs
git commit -m "feat(expedicao): cálculo de divergência entre pedido e alocado"
```

---

### Task 6: `lib/expedicao.js` — numeração do romaneio e volumes para a NF-e

**Files:**
- Modify: `lib/expedicao.js`
- Modify: `tests/expedicao.test.mjs`

**Interfaces:**
- Produces: `proximoNumeroExpedicao(dataStr, empresaId, cliente)` (async, padrão `RM-AAMMDD-###`, mesmo mecanismo de `lib/format.js:proximoLote`) e `calcularVolumesNfe(caixas)` → `{ qVol, esp, pesoB, pesoL }`. A primeira é usada por Task 13 (rota de criação da expedição); a segunda por Task 9 (`resolverNota.js`).

- [ ] **Step 1: Escrever os testes**

```js
// acrescentar em tests/expedicao.test.mjs
import { calcularVolumesNfe, proximoNumeroExpedicao } from '../lib/expedicao.js';

test('calcularVolumesNfe: soma o peso bruto de todas as caixas', () => {
  const caixas = [{ peso_bruto_kg: 5.5 }, { peso_bruto_kg: 3.2 }, { peso_bruto_kg: null }];
  assert.deepEqual(calcularVolumesNfe(caixas), { qVol: 3, esp: 'Caixa', pesoB: 8.7, pesoL: 8.7 });
});

test('calcularVolumesNfe: nenhuma caixa devolve null (nada a declarar)', () => {
  assert.equal(calcularVolumesNfe([]), null);
});

test('proximoNumeroExpedicao: primeiro romaneio do dia começa em 001', async () => {
  const clienteFalso = {
    from: () => ({
      select: () => ({ eq: () => ({ like: async () => ({ data: [] }) }) }),
    }),
  };
  const numero = await proximoNumeroExpedicao('2026-09-10', 'empresa-1', clienteFalso);
  assert.equal(numero, 'RM-260910-001');
});

test('proximoNumeroExpedicao: continua do maior sufixo já usado no dia', async () => {
  const linhas = [{ numero: 'RM-260910-001' }, { numero: 'RM-260910-003' }];
  const clienteFalso = {
    from: () => ({
      select: () => ({ eq: () => ({ like: async () => ({ data: linhas }) }) }),
    }),
  };
  const numero = await proximoNumeroExpedicao('2026-09-10', 'empresa-1', clienteFalso);
  assert.equal(numero, 'RM-260910-004');
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `node --test tests/expedicao.test.mjs`
Expected: FAIL

- [ ] **Step 3: Implementar**

```js
// acrescentar em lib/expedicao.js

// Grupo `vol` da NF-e (transp/vol) — sempre derivado das caixas do romaneio,
// nunca redigitado (spec de 10/09). null quando não há caixa nenhuma (não
// deveria acontecer: romaneio só finaliza com o pedido inteiro alocado).
export function calcularVolumesNfe(caixas) {
  if (!caixas?.length) return null;
  const pesoB = Math.round(caixas.reduce((s, c) => s + Number(c.peso_bruto_kg || 0), 0) * 1000) / 1000;
  return { qVol: caixas.length, esp: 'Caixa', pesoB, pesoL: pesoB };
}

// RM-AAMMDD-###, mesmo mecanismo de lib/format.js:proximoLote — maior
// sufixo já usado no dia NA MESMA EMPRESA, não contagem de linhas (evita a
// mesma corrida que o comentário daquela função documenta). `cliente` é o
// client Supabase já injetado por quem chama (mesmo padrão de proximoLote).
export async function proximoNumeroExpedicao(dataStr, empresaId, cliente) {
  const prefixo = `RM-${dataStr.slice(2, 4)}${dataStr.slice(5, 7)}${dataStr.slice(8, 10)}-`;
  const { data } = await cliente.from('expedicoes').select('numero').eq('empresa_id', empresaId).like('numero', `${prefixo}%`);
  const maiorSufixo = (data || []).reduce((max, l) => {
    const sufixo = String(l.numero || '').slice(prefixo.length);
    return /^\d+$/.test(sufixo) ? Math.max(max, Number(sufixo)) : max;
  }, 0);
  return prefixo + String(maiorSufixo + 1).padStart(3, '0');
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `node --test tests/expedicao.test.mjs`
Expected: PASS (18 testes)

- [ ] **Step 5: Commit**

```bash
git add lib/expedicao.js tests/expedicao.test.mjs
git commit -m "feat(expedicao): numeração do romaneio e cálculo de volumes para a NF-e"
```

---

### Task 7: `lib/pedidos.js` — novos status na máquina de estados

**Files:**
- Modify: `lib/pedidos.js`
- Modify: `tests/pedidos.test.mjs`

**Interfaces:**
- Produces: `STATUS_PEDIDO` com `Separação`/`Conferido`; `podeEditar`/`exigeMotivoReabertura` sem mudança de assinatura, só de comportamento. Consumido por Task 23 (`app/pedidos/*`) e Task 11 (`emitir.js`, que hoje faz `if (pedido.status !== 'Faturado')`).

- [ ] **Step 1: Ler o arquivo de teste atual pra não duplicar nem quebrar teste existente**

Run: `cat tests/pedidos.test.mjs`

- [ ] **Step 2: Acrescentar os testes dos novos status**

```js
// acrescentar em tests/pedidos.test.mjs (mesmo arquivo, imports já existentes)
test('STATUS_PEDIDO inclui Separação e Conferido, entre Pendente e Faturado', () => {
  assert.deepEqual(STATUS_PEDIDO, ['Pendente', 'Separação', 'Conferido', 'Faturado', 'Enviado', 'Cancelado']);
});

test('podeEditar: só Pendente libera edição — Separação e Conferido continuam travados', () => {
  assert.equal(podeEditar('Pendente'), true);
  assert.equal(podeEditar('Separação'), false);
  assert.equal(podeEditar('Conferido'), false);
});
```

- [ ] **Step 3: Rodar e confirmar falha**

Run: `node --test tests/pedidos.test.mjs`
Expected: FAIL — `STATUS_PEDIDO` ainda não tem os dois novos valores.

- [ ] **Step 4: Atualizar `lib/pedidos.js`**

```js
// lib/pedidos.js:6 — trocar a linha existente por:
export const STATUS_PEDIDO = ['Pendente', 'Separação', 'Conferido', 'Faturado', 'Enviado', 'Cancelado'];
```

`podeEditar` (linha 10-12) e `exigeMotivoReabertura` (linha 18-21) não mudam de código — `podeEditar` já é `status === 'Pendente'` (Separação/Conferido caem no `false` automaticamente) e `exigeMotivoReabertura` já só dispara de `Faturado`/`Enviado` para `Pendente`, que continua sendo a única reabertura que existe.

- [ ] **Step 5: Rodar e confirmar sucesso**

Run: `node --test tests/pedidos.test.mjs`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/pedidos.js tests/pedidos.test.mjs
git commit -m "feat(pedidos): Separação e Conferido na máquina de estados do pedido"
```

---

### Task 8: `lib/autorizacao.js` — `garantirExpedicao`

**Files:**
- Modify: `lib/autorizacao.js`
- Test: `tests/autorizacao.test.mjs` (ler primeiro para seguir o padrão exato dos testes de `garantirPedido`/`garantirProduto` já existentes)

**Interfaces:**
- Produces: `garantirExpedicao(sb, user, isAdmin, expedicaoId, campos?)` — mesmo formato de `garantirPedido` (`lib/autorizacao.js:93-101`). Consumido pelas Tasks 14-17 (rotas `/api/expedicao/*`).

- [ ] **Step 1: Ler o teste existente de `garantirPedido` pra copiar o padrão**

Run: `grep -n "garantirPedido" -A 15 tests/autorizacao.test.mjs`

- [ ] **Step 2: Acrescentar o teste de `garantirExpedicao`** (seguindo o mesmo formato encontrado no passo 1 — mock de `sb.from('expedicoes')` devolvendo uma linha com `empresa_id`, e o mesmo par de casos "não encontrado" / "de outra empresa" devolvendo a mesma mensagem 404, já testado para os irmãos).

- [ ] **Step 3: Rodar e confirmar falha**

Run: `node --test tests/autorizacao.test.mjs`

- [ ] **Step 4: Implementar**

```js
// acrescentar em lib/autorizacao.js, depois de garantirProduto (linha 116)
export async function garantirExpedicao(sb, user, isAdmin, expedicaoId,
  campos = 'id, pedido_id, status, transportadora_id, modo_frete, veiculo_placa, veiculo_uf, empresa_id') {
  return garantirLinhaDaEmpresa(sb, user, isAdmin, {
    tabela: 'expedicoes',
    id: expedicaoId,
    campos,
    rotulo: { artigo: 'a', nome: 'expedição', titulo: 'Expedição' },
    naoEncontrado: 'Expedição não encontrada.',
  });
}
```

- [ ] **Step 5: Rodar e confirmar sucesso**

Run: `node --test tests/autorizacao.test.mjs`

- [ ] **Step 6: Commit**

```bash
git add lib/autorizacao.js tests/autorizacao.test.mjs
git commit -m "feat(autorizacao): garantirExpedicao, mesmo padrão de garantirPedido"
```

---

### Task 9: `resolverNota.js` — grupo de transporte

**Files:**
- Modify: `lib/nfe/resolverNota.js`
- Modify: `tests/nfe-resolver.test.mjs`

**Interfaces:**
- Consumes: nenhuma task anterior diretamente (parâmetro novo é passado por quem chama — `emitir.js`, Task 11).
- Produces: `resolverNota({ ..., expedicao })` (parâmetro novo, opcional) devolvendo `nota.transp` além dos campos já existentes (`ide`, `emit`, `dest`, `itens`, `total`). Consumido por Task 10 (`montarXml.js`).

- [ ] **Step 1: Acrescentar os testes**

```js
// acrescentar em tests/nfe-resolver.test.mjs
test('sem expedição, nota.transp é só modFrete 9 (sem frete) — comportamento de hoje preservado', () => {
  const nota = resolverNota(ENTRADA);
  assert.deepEqual(nota.transp, { modFrete: '9', transportadora: null, veicTransp: null, vol: null });
});

test('expedição com transportadora monta o grupo transporta', () => {
  const expedicao = {
    modo_frete: '0',
    transportadora: {
      cnpj: '12345678000199', nome: 'Transportadora Rondônia LTDA', ie: '00000001112223',
      logradouro: 'RUA DOS FRETES', municipio: 'JI-PARANA', uf: 'RO',
    },
    veiculo_placa: null, veiculo_uf: null,
    caixas: [{ peso_bruto_kg: 12 }],
  };
  const nota = resolverNota({ ...ENTRADA, expedicao });
  assert.equal(nota.transp.modFrete, '0');
  assert.equal(nota.transp.transportadora.cnpj, '12345678000199');
  assert.equal(nota.transp.transportadora.xNome, 'Transportadora Rondônia LTDA');
  assert.equal(nota.transp.veicTransp, null);
  assert.deepEqual(nota.transp.vol, { qVol: 1, esp: 'Caixa', pesoB: 12, pesoL: 12 });
});

test('expedição com veículo monta o grupo veicTransp', () => {
  const expedicao = {
    modo_frete: '0', transportadora: null,
    veiculo_placa: 'ABC1D23', veiculo_uf: 'RO', caixas: [],
  };
  const nota = resolverNota({ ...ENTRADA, expedicao });
  assert.deepEqual(nota.transp.veicTransp, { placa: 'ABC1D23', UF: 'RO' });
});

test('expedição sem transportadora nem veículo não monta os grupos, mas modo_frete vale', () => {
  const expedicao = { modo_frete: '9', transportadora: null, veiculo_placa: null, veiculo_uf: null, caixas: [] };
  const nota = resolverNota({ ...ENTRADA, expedicao });
  assert.equal(nota.transp.modFrete, '9');
  assert.equal(nota.transp.transportadora, null);
  assert.equal(nota.transp.veicTransp, null);
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `node --test tests/nfe-resolver.test.mjs`
Expected: FAIL — `nota.transp` ainda não existe.

- [ ] **Step 3: Implementar**

```js
// lib/nfe/resolverNota.js — adicionar no topo do arquivo (perto de resolverIndIEDest)
import { calcularVolumesNfe } from '../expedicao.js';

// Sem expedição (chamada antiga, ou pedido sem romaneio — não deveria mais
// acontecer depois desta implementação, mas a função continua pura e não
// assume quem a chama): modFrete 9 preserva o comportamento de hoje.
function resolverTransporte(expedicao) {
  if (!expedicao) return { modFrete: '9', transportadora: null, veicTransp: null, vol: null };
  const t = expedicao.transportadora;
  return {
    modFrete: String(expedicao.modo_frete ?? '9'),
    transportadora: t ? {
      cnpj: digitos(t.cnpj),
      xNome: normalizarTexto(t.nome, 60, 'xNome da transportadora'),
      IE: t.ie ? digitos(t.ie) : undefined,
      xEnder: t.logradouro ? normalizarTexto(t.logradouro, 60, 'endereço da transportadora') : undefined,
      xMun: t.municipio ? normalizarTexto(t.municipio, 60, 'município da transportadora') : undefined,
      UF: t.uf || undefined,
    } : null,
    veicTransp: expedicao.veiculo_placa ? { placa: expedicao.veiculo_placa, UF: expedicao.veiculo_uf } : null,
    vol: calcularVolumesNfe(expedicao.caixas || []),
  };
}

// dentro de resolverNota(...), no objeto devolvido — acrescentar a chave:
//   transp: resolverTransporte(expedicao),
// (expedicao chega desestruturado do parâmetro: resolverNota({ pedido,
// cliente, itens, emitente, naturezaOperacao, ambiente, parametroSimples,
// expedicao }))
```

Ajustar a assinatura de `resolverNota` (linha 357) para aceitar `expedicao` e incluir `transp: resolverTransporte(expedicao)` no objeto de retorno (linha ~376-406).

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `node --test tests/nfe-resolver.test.mjs`
Expected: PASS (todos os testes antigos continuam passando + os 4 novos)

- [ ] **Step 5: Commit**

```bash
git add lib/nfe/resolverNota.js tests/nfe-resolver.test.mjs
git commit -m "feat(nfe): resolverNota monta o grupo de transporte a partir da expedição"
```

---

### Task 10: `montarXml.js` — serializar `<transp>` real

**Files:**
- Modify: `lib/nfe/montarXml.js`
- Modify: `tests/nfe-montar-xml.test.mjs`

**Interfaces:**
- Consumes: `nota.transp` (Task 9).
- Produces: XML com `<transp>` completo. Substitui a linha fixa `'<transp>' + tag('modFrete', '9') + '</transp>'` (`lib/nfe/montarXml.js:409`).

- [ ] **Step 1: Acrescentar os testes**

```js
// acrescentar em tests/nfe-montar-xml.test.mjs
test('sem transp na nota (chamada antiga), sai modFrete 9 — compatibilidade preservada', () => {
  const nota = notaBase();
  delete nota.transp;
  const { xml } = montarXmlNFe(nota, OPCOES);
  assert.match(xml, /<transp><modFrete>9<\/modFrete><\/transp>/);
});

test('transp com transportadora monta transporta e vol', () => {
  const nota = notaBase();
  nota.transp = {
    modFrete: '0',
    transportadora: { cnpj: '12345678000199', xNome: 'Transportadora Rondônia LTDA', IE: '00000001112223', xEnder: 'RUA DOS FRETES', xMun: 'JI-PARANA', UF: 'RO' },
    veicTransp: null,
    vol: { qVol: 2, esp: 'Caixa', pesoB: 24.5, pesoL: 24.5 },
  };
  const { xml } = montarXmlNFe(nota, OPCOES);
  assert.match(xml, /<transp><modFrete>0<\/modFrete><transporta><CNPJ>12345678000199<\/CNPJ><xNome>Transportadora Rondônia LTDA<\/xNome>/);
  assert.match(xml, /<vol><qVol>2<\/qVol><esp>Caixa<\/esp><pesoL>24\.5000<\/pesoL><pesoB>24\.5000<\/pesoB><\/vol>/);
});

test('transp com veículo monta veicTransp', () => {
  const nota = notaBase();
  nota.transp = { modFrete: '0', transportadora: null, veicTransp: { placa: 'ABC1D23', UF: 'RO' }, vol: null };
  const { xml } = montarXmlNFe(nota, OPCOES);
  assert.match(xml, /<veicTransp><placa>ABC1D23<\/placa><UF>RO<\/UF><\/veicTransp>/);
});

test('transp vem antes de pag, na ordem do leiaute', () => {
  const nota = notaBase();
  nota.transp = { modFrete: '9', transportadora: null, veicTransp: null, vol: null };
  const { xml } = montarXmlNFe(nota, OPCOES);
  assert.ok(xml.indexOf('<transp>') < xml.indexOf('<pag>'));
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `node --test tests/nfe-montar-xml.test.mjs`

- [ ] **Step 3: Implementar**

```js
// lib/nfe/montarXml.js — nova função, perto de montarTotal
function montarTransp(transp) {
  const t = transp || { modFrete: '9', transportadora: null, veicTransp: null, vol: null };
  const transporta = t.transportadora
    ? '<transporta>'
      + tag('CNPJ', t.transportadora.cnpj)
      + tag('xNome', t.transportadora.xNome)
      + tag('IE', t.transportadora.IE)
      + tag('xEnder', t.transportadora.xEnder)
      + tag('xMun', t.transportadora.xMun)
      + tag('UF', t.transportadora.UF)
      + '</transporta>'
    : '';
  const veicTransp = t.veicTransp
    ? `<veicTransp>${tag('placa', t.veicTransp.placa)}${tag('UF', t.veicTransp.UF)}</veicTransp>`
    : '';
  const vol = t.vol
    ? '<vol>'
      + tag('qVol', String(t.vol.qVol))
      + tag('esp', t.vol.esp)
      + tag('pesoL', numero(t.vol.pesoL, 4))
      + tag('pesoB', numero(t.vol.pesoB, 4))
      + '</vol>'
    : '';
  return `<transp>${tag('modFrete', t.modFrete)}${transporta}${veicTransp}${vol}</transp>`;
}

// dentro de montarXmlNFe, trocar a linha 409:
//   + '<transp>' + tag('modFrete', '9') + '</transp>'
// por:
//   + montarTransp(nota.transp)
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `node --test tests/nfe-montar-xml.test.mjs`
Expected: PASS (todos os testes antigos + 4 novos)

- [ ] **Step 5: Commit**

```bash
git add lib/nfe/montarXml.js tests/nfe-montar-xml.test.mjs
git commit -m "feat(nfe): serializa transportadora, veículo e volumes reais no grupo transp"
```

---

### Task 11: `emitir.js` — emitir a partir da expedição finalizada

**Files:**
- Modify: `lib/nfe/emitir.js`

**Interfaces:**
- Consumes: `garantirExpedicao` (Task 8), `resolverNota` com `expedicao` (Task 9), `expedicao.transportadora`/`caixas` montados por quem chama (Task 12/16).
- Produces: `emitirNfe({ sb, pedido, expedicao, naturezaOperacaoId, userId })` — assinatura ganha `expedicao` (obrigatório); no sucesso (9a), além de gravar `nfe_saida_documentos`, atualiza `pedidos.status = 'Faturado'` e cria `contas_a_receber`/parcela. Chamado por Task 16 (rota `finalizar`), e por Task 12 (rota `POST /api/fiscal/emitir-nfe`, caminho de retentativa).

Este é o task mais sensível do plano — `emitir.js` tem 762 linhas com ordenação deliberada pra nunca duplicar uma nota autorizada (ver o comentário no topo do arquivo). Mudar a guarda de status e o sucesso 9a sem tocar em mais nada.

- [ ] **Step 1: Trocar a assinatura da função (linha 197) e a guarda de status (linha 205-210)**

```js
// lib/nfe/emitir.js:197 — trocar:
export async function emitirNfe({ sb, pedido, naturezaOperacaoId, userId }) {
// por:
export async function emitirNfe({ sb, pedido, expedicao, naturezaOperacaoId, userId }) {
```

```js
// lib/nfe/emitir.js:205-210 — trocar:
  if (pedido.status !== 'Faturado') {
    throw erro(
      `O pedido está com status "${pedido.status}" — só é possível emitir NF-e para um pedido `
      + 'Faturado. Fature o pedido antes de emitir.',
    );
  }
// por:
  if (pedido.status !== 'Conferido') {
    throw erro(
      `O pedido está com status "${pedido.status}" — só é possível emitir NF-e para um pedido `
      + 'Conferido (romaneio de separação finalizado). Finalize o romaneio antes de emitir.',
    );
  }
```

- [ ] **Step 2: Trocar a fonte dos itens (linha 213-219) para vir da expedição, não direto de `pedido_itens`**

```js
// lib/nfe/emitir.js:213-219 — a query de itensPedido continua igual (ainda
// precisa dos itens do pedido pra resolver tributos por produto), mas
// itensParaResolver (linha 350-356) passa a agrupar por pedido_item_id
// somando as quantidades ALOCADAS na expedição (podem estar em caixas
// diferentes) em vez de usar pedidoItem.quantidade direto — o que foi
// separado é o que vai na nota, não o que foi pedido (regra do spec-mãe:
// "a emissão nunca parte de dados que o estoque não confirmou").
//
// Troca o loop de "---------- 2. Resolver tributos ----------" (linha
// 350-356):
  const quantidadeAlocadaPorItem = new Map();
  for (const caixa of expedicao.caixas) {
    for (const item of caixa.itens) {
      quantidadeAlocadaPorItem.set(item.pedido_item_id,
        (quantidadeAlocadaPorItem.get(item.pedido_item_id) || 0) + Number(item.quantidade));
    }
  }
  const itensParaResolver = [];
  for (const pedidoItem of itensPedido) {
    const produto = produtoPorId.get(pedidoItem.produto_id);
    if (!produto) throw erro(`O produto do item ${pedidoItem.id} do pedido não foi encontrado.`);
    const quantidadeAlocada = quantidadeAlocadaPorItem.get(pedidoItem.id) || 0;
    if (!(quantidadeAlocada > 0)) continue; // item sem alocação não entra na nota
    const regra = await resolverRegraDoItem(sb, { empresaId: pedido.empresa_id, produto, naturezaOperacaoId, cliente });
    itensParaResolver.push({ pedidoItem: { ...pedidoItem, quantidade: quantidadeAlocada }, produto, regra });
  }
```

- [ ] **Step 3: Passar `expedicao` para `resolverNota` (linha 387-389)**

```js
// lib/nfe/emitir.js:387-389 — trocar:
  const nota = resolverNota({
    pedido, cliente, itens: itensParaResolver, emitente, naturezaOperacao: natureza, ambiente, parametroSimples,
  });
// por:
  const nota = resolverNota({
    pedido, cliente, itens: itensParaResolver, emitente, naturezaOperacao: natureza, ambiente, parametroSimples,
    expedicao,
  });
```

`expedicao` chega no parâmetro da função (`emitirNfe({ sb, pedido, expedicao, naturezaOperacaoId, userId })`, ajustar a assinatura na linha 197) já com `.transportadora` (linha carregada por quem chama, Task 12 ou 16, via `select('*, transportadora:transportadoras(*)')`) e `.caixas` (array de `{ peso_bruto_kg, itens: [{ pedido_item_id, quantidade }] }`, também montado por quem chama).

- [ ] **Step 4: No sucesso (9a), atualizar o pedido e criar a conta a receber (depois da linha 660, dentro do bloco de sucesso, antes do `return`)**

```js
// lib/nfe/emitir.js — dentro do bloco "---- 9a. Autorizada ----", logo
// depois do UPDATE que grava status: 'autorizado' (linha 653-660) e antes do
// `return { status: 'autorizado', ... }` (linha 675):

    // Pedido → Faturado e conta a receber nascem na mesma passada em que a
    // nota é confirmada autorizada — nunca antes (o motor de emissão não
    // pode gravar "Faturado" achando que vai autorizar; só depois que
    // autorizou de verdade). fn_pedido_bloquear_cabecalho (atualização 50)
    // exige exatamente esta ordem: nfe_saida_documentos já 'autorizado'
    // ANTES do update de pedidos.status.
    const { error: erroStatusPedido } = await sb.from('pedidos')
      .update({ status: 'Faturado' }).eq('id', pedido.id);
    if (erroStatusPedido) {
      // A nota está autorizada de verdade — mesmo raciocínio dos outros
      // "melhor esforço" deste arquivo: não reverte, só avisa quem for
      // investigar. O pedido fica em Conferido com nota autorizada; alguém
      // precisa rodar o update manualmente.
      throw erro(
        `A nota foi autorizada (protocolo ${veredito.nProt}), mas falhou ao avançar o pedido para `
        + `Faturado: ${erroStatusPedido.message}. Atualize o status manualmente.`,
        500,
      );
    }

    // Conta a receber: à vista, vencendo na data de emissão (decisão já
    // registrada no spec de 25/08 — parcelamento é resolvido depois, em
    // Financeiro, não aqui). gera_financeiro da natureza da operação decide
    // se esta operação deve virar conta a receber (ex.: uma natureza de
    // "Remessa para conserto" não gera financeiro).
    if (natureza.gera_financeiro) {
      const { data: conta, error: erroConta } = await sb.from('contas_a_receber').insert([{
        descricao: `NF-e ${numero} — ${cliente.nome}`,
        cliente_id: pedido.cliente_id,
        pedido_id: pedido.id,
        nfe_saida_documento_id: documento.id,
        valor_total: valorTotal,
        empresa_id: pedido.empresa_id,
      }]).select('id').single();
      if (erroConta) {
        throw erro(
          `A nota foi autorizada e o pedido avançou para Faturado, mas falhou ao gravar a conta a `
          + `receber: ${erroConta.message}. Lance manualmente em Financeiro.`,
          500,
        );
      }
      const { error: erroParcela } = await sb.from('contas_a_receber_parcelas').insert([{
        conta_a_receber_id: conta.id,
        numero: 1,
        valor: valorTotal,
        vencimento: dataEmissao.toISOString().slice(0, 10),
        empresa_id: pedido.empresa_id,
      }]);
      if (erroParcela) {
        throw erro(
          `A nota foi autorizada, mas falhou ao gravar a parcela da conta a receber: ${erroParcela.message}. `
          + 'Lance manualmente em Financeiro.',
          500,
        );
      }
    }
```

- [ ] **Step 5: Atualizar as chamadas existentes que dependem da assinatura antiga**

Run: `grep -rn "emitirNfe(" app/ lib/ tests/` — Task 12 corrige `app/api/fiscal/emitir-nfe/route.js`; confirme que não sobra nenhuma outra chamada com a assinatura velha.

- [ ] **Step 6: Escrever um teste de integração leve pro novo comportamento** (mock de `sb`, sem rede) em `tests/nfe-emitir.test.mjs` — se o arquivo não existir, criar; se existir, seguir seu padrão de mocks (ler o arquivo primeiro com `cat tests/nfe-emitir.test.mjs` antes de escrever, pois `emitir.js` faz chamadas de rede/SEFAZ que precisam ser mockadas com o mesmo padrão já usado ali). Cobrir pelo menos:
  - pedido `Conferido` sem `expedicao` correspondente é rejeitado antes de qualquer chamada de rede;
  - item sem alocação na expedição não entra em `itensParaResolver` (não aparece na nota).

- [ ] **Step 7: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add lib/nfe/emitir.js tests/nfe-emitir.test.mjs
git commit -m "feat(nfe): emitir a partir da expedição finalizada; Faturado e conta a receber no sucesso"
```

---

### Task 12: `app/api/fiscal/emitir-nfe/route.js` — carregar e passar a expedição

**Files:**
- Modify: `app/api/fiscal/emitir-nfe/route.js`

**Interfaces:**
- Consumes: `emitirNfe` com assinatura nova (Task 11), `garantirExpedicao` (Task 8) — mas esta rota deixa de ser chamada pelo botão da tela de pedido (Task 23 remove o botão "Emitir NF-e" solto); passa a ser usada só pelo caminho de retentativa ("Tentar emitir novamente" quando a emissão automática falhou, Task 23/20).

- [ ] **Step 1: Atualizar a rota pra carregar a expedição do pedido e repassar**

```js
// app/api/fiscal/emitir-nfe/route.js — dentro do POST, depois de garantirPedido
// (que já carrega `pedido`), antes de chamar emitirNfe:
  const { data: expedicaoRow, error: erroExpedicao } = await sb.from('expedicoes')
    .select('*, transportadora:transportadoras(*), expedicao_caixas(*, expedicao_itens(*))')
    .eq('pedido_id', pedido.id).eq('status', 'finalizado')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (erroExpedicao) return NextResponse.json({ error: `Falha ao carregar o romaneio: ${erroExpedicao.message}` }, { status: 500 });
  if (!expedicaoRow) return NextResponse.json({ error: 'Pedido sem romaneio finalizado — finalize o romaneio antes de emitir.' }, { status: 400 });

  const expedicao = {
    modo_frete: expedicaoRow.modo_frete,
    transportadora: expedicaoRow.transportadora,
    veiculo_placa: expedicaoRow.veiculo_placa,
    veiculo_uf: expedicaoRow.veiculo_uf,
    caixas: (expedicaoRow.expedicao_caixas || []).map(c => ({
      peso_bruto_kg: c.peso_bruto_kg,
      itens: (c.expedicao_itens || []).map(i => ({ pedido_item_id: i.pedido_item_id, quantidade: i.quantidade })),
    })),
  };

  try {
    const resultado = await emitirNfe({ sb, pedido, expedicao, naturezaOperacaoId, userId: user.id });
    return NextResponse.json(resultado);
  } catch (e) { /* bloco catch já existente, sem mudança */ }
```

- [ ] **Step 2: Rodar a suíte**

Run: `npm test`
Expected: PASS (nenhum teste de rota HTTP nesta suíte — a verificação real desta task é manual, no Task 20 depois que a UI existir).

- [ ] **Step 3: Commit**

```bash
git add app/api/fiscal/emitir-nfe/route.js
git commit -m "feat(nfe): rota de emissão carrega a expedição finalizada do pedido"
```

---

### Task 13: `POST /api/expedicao` — criar romaneio em rascunho

**Files:**
- Create: `app/api/expedicao/route.js`

**Interfaces:**
- Consumes: `autorizarModulo` (`lib/pontoServer.js:22`), `garantirPedido` (`lib/autorizacao.js:93`), `proximoNumeroExpedicao` (Task 6).
- Produces: `POST /api/expedicao` — body `{ pedidoId }`, cria `expedicoes` em `rascunho` e atualiza `pedidos.status = 'Separação'`. Consumido por Task 19 (tela `/expedicao`).

- [ ] **Step 1: Implementar**

```js
// app/api/expedicao/route.js
import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../lib/pontoServer';
import { garantirPedido } from '../../../lib/autorizacao';
import { proximoNumeroExpedicao } from '../../../lib/expedicao';

export const runtime = 'nodejs';

// POST body: { pedidoId }
export async function POST(request) {
  const { sb, user, isAdmin, erro } = await autorizarModulo(request, 'expedicao');
  if (erro) return erro;

  let corpo;
  try { corpo = await request.json(); } catch { return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 }); }
  const { pedidoId } = corpo;
  if (!pedidoId) return NextResponse.json({ error: 'Informe pedidoId.' }, { status: 400 });

  let pedido;
  try {
    pedido = await garantirPedido(sb, user, isAdmin, pedidoId, 'id, empresa_id, status, data');
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 404 });
  }
  if (pedido.status !== 'Pendente') {
    return NextResponse.json({ error: `Pedido está "${pedido.status}" — só um pedido Pendente pode iniciar romaneio.` }, { status: 400 });
  }

  const numero = await proximoNumeroExpedicao(pedido.data, pedido.empresa_id, sb);
  const { data: expedicao, error: erroExpedicao } = await sb.from('expedicoes').insert([{
    empresa_id: pedido.empresa_id, pedido_id: pedido.id, numero, responsavel_id: null,
  }]).select('*').single();
  if (erroExpedicao) return NextResponse.json({ error: `Falha ao criar o romaneio: ${erroExpedicao.message}` }, { status: 500 });

  // A expedição em rascunho já existe quando este UPDATE roda — é a ordem
  // que fn_pedido_bloquear_cabecalho (atualização 50) exige pra aceitar a
  // transição Pendente→Separação.
  const { error: erroStatus } = await sb.from('pedidos').update({ status: 'Separação' }).eq('id', pedido.id);
  if (erroStatus) {
    await sb.from('expedicoes').delete().eq('id', expedicao.id);
    return NextResponse.json({ error: `Falha ao avançar o pedido para Separação: ${erroStatus.message}` }, { status: 500 });
  }

  return NextResponse.json({ expedicaoId: expedicao.id, numero });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/expedicao/route.js
git commit -m "feat(expedicao): rota que cria o romaneio em rascunho e avança o pedido para Separação"
```

---

### Task 14: `PUT /api/expedicao/[id]` — salvar caixas e itens

**Files:**
- Create: `app/api/expedicao/[id]/route.js`

**Interfaces:**
- Consumes: `garantirExpedicao` (Task 8).
- Produces: `PUT /api/expedicao/[id]` — body `{ transportadoraId, modoFrete, veiculoPlaca, veiculoUf, caixas: [{ numero, pesoBrutoKg, itens: [{ pedidoItemId, produtoId, recebimentoItemId, quantidade }] }] }`. Substitui todas as caixas/itens da expedição (mesmo padrão de `emitir.js` ao regravar `nfe_saida_itens` do zero a cada tentativa — "sempre regravados do zero, nunca só complementados").

- [ ] **Step 1: Implementar**

```js
// app/api/expedicao/[id]/route.js
import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../../lib/pontoServer';
import { garantirExpedicao } from '../../../../lib/autorizacao';

export const runtime = 'nodejs';

export async function PUT(request, { params }) {
  const { sb, user, isAdmin, erro } = await autorizarModulo(request, 'expedicao');
  if (erro) return erro;

  let expedicao;
  try {
    expedicao = await garantirExpedicao(sb, user, isAdmin, params.id, 'id, status, empresa_id');
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 404 });
  }
  if (expedicao.status !== 'rascunho') {
    return NextResponse.json({ error: `Romaneio está "${expedicao.status}" — só um romaneio em rascunho pode ser editado.` }, { status: 400 });
  }

  let corpo;
  try { corpo = await request.json(); } catch { return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 }); }
  const { transportadoraId, modoFrete, veiculoPlaca, veiculoUf, caixas } = corpo;

  const { error: erroCabecalho } = await sb.from('expedicoes').update({
    transportadora_id: transportadoraId || null,
    modo_frete: modoFrete || '0',
    veiculo_placa: veiculoPlaca || null,
    veiculo_uf: veiculoUf || null,
  }).eq('id', expedicao.id);
  if (erroCabecalho) return NextResponse.json({ error: `Falha ao gravar os dados de transporte: ${erroCabecalho.message}` }, { status: 500 });

  // Regravado do zero — mesma disciplina de emitir.js ao regravar
  // nfe_saida_itens: a tela manda o estado inteiro da montagem de caixas a
  // cada salvamento, nunca um diff.
  const { error: erroLimpar } = await sb.from('expedicao_caixas').delete().eq('expedicao_id', expedicao.id);
  if (erroLimpar) return NextResponse.json({ error: `Falha ao limpar as caixas anteriores: ${erroLimpar.message}` }, { status: 500 });

  for (const [indice, caixa] of (caixas || []).entries()) {
    const { data: caixaGravada, error: erroCaixa } = await sb.from('expedicao_caixas').insert([{
      empresa_id: expedicao.empresa_id, expedicao_id: expedicao.id,
      numero: caixa.numero ?? indice + 1, peso_bruto_kg: caixa.pesoBrutoKg || null,
    }]).select('id').single();
    if (erroCaixa) return NextResponse.json({ error: `Falha ao gravar a caixa ${indice + 1}: ${erroCaixa.message}` }, { status: 500 });

    const linhasItens = (caixa.itens || []).map(item => ({
      empresa_id: expedicao.empresa_id, expedicao_caixa_id: caixaGravada.id,
      pedido_item_id: item.pedidoItemId, produto_id: item.produtoId,
      recebimento_item_id: item.recebimentoItemId || null, quantidade: item.quantidade,
    }));
    if (linhasItens.length) {
      const { error: erroItens } = await sb.from('expedicao_itens').insert(linhasItens);
      if (erroItens) return NextResponse.json({ error: `Falha ao gravar os itens da caixa ${indice + 1}: ${erroItens.message}` }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/expedicao/[id]/route.js
git commit -m "feat(expedicao): rota que salva caixas e itens do romaneio em rascunho"
```

---

### Task 15: `POST /api/expedicao/[id]/cancelar`

**Files:**
- Create: `app/api/expedicao/[id]/cancelar/route.js`

**Interfaces:**
- Consumes: `garantirExpedicao` (Task 8).
- Produces: `POST /api/expedicao/[id]/cancelar` — marca `expedicoes.status = 'cancelado'` e devolve o pedido para `Pendente` (ordem exigida pelo trigger da Task 1: cancelar a expedição primeiro).

- [ ] **Step 1: Implementar**

```js
// app/api/expedicao/[id]/cancelar/route.js
import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../../../lib/pontoServer';
import { garantirExpedicao } from '../../../../../lib/autorizacao';

export const runtime = 'nodejs';

export async function POST(request, { params }) {
  const { sb, user, isAdmin, erro } = await autorizarModulo(request, 'expedicao');
  if (erro) return erro;

  let expedicao;
  try {
    expedicao = await garantirExpedicao(sb, user, isAdmin, params.id, 'id, pedido_id, status');
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 404 });
  }
  if (expedicao.status !== 'rascunho') {
    return NextResponse.json({ error: `Romaneio está "${expedicao.status}" — só um romaneio em rascunho pode ser cancelado por aqui.` }, { status: 400 });
  }

  const { error: erroCancelar } = await sb.from('expedicoes').update({ status: 'cancelado' }).eq('id', expedicao.id);
  if (erroCancelar) return NextResponse.json({ error: `Falha ao cancelar o romaneio: ${erroCancelar.message}` }, { status: 500 });

  const { error: erroStatusPedido } = await sb.from('pedidos').update({ status: 'Pendente' }).eq('id', expedicao.pedido_id);
  if (erroStatusPedido) return NextResponse.json({ error: `Romaneio cancelado, mas falhou ao devolver o pedido para Pendente: ${erroStatusPedido.message}` }, { status: 500 });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/expedicao/[id]/cancelar/route.js
git commit -m "feat(expedicao): rota que cancela romaneio em rascunho e devolve o pedido para Pendente"
```

---

### Task 16: `POST /api/expedicao/[id]/finalizar` — fecha o romaneio e dispara a emissão

**Files:**
- Create: `app/api/expedicao/[id]/finalizar/route.js`

**Interfaces:**
- Consumes: `garantirExpedicao` (Task 8), `calcularDivergencia` (Task 5), `emitirNfe` (Task 11).
- Produces: `POST /api/expedicao/[id]/finalizar` — body `{ naturezaOperacaoId }`. Valida cobertura total sem divergência, marca `expedicoes.status = 'finalizado'`, avança `pedidos.status = 'Conferido'`, e chama `emitirNfe`.

- [ ] **Step 1: Implementar**

```js
// app/api/expedicao/[id]/finalizar/route.js
import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../../../lib/pontoServer';
import { garantirExpedicao, exigirUuid } from '../../../../../lib/autorizacao';
import { calcularDivergencia } from '../../../../../lib/expedicao';
import { emitirNfe } from '../../../../../lib/nfe/emitir';

export const runtime = 'nodejs';
export const maxDuration = 60;

// POST body: { naturezaOperacaoId }
export async function POST(request, { params }) {
  const { sb, user, isAdmin, erro } = await autorizarModulo(request, 'expedicao');
  if (erro) return erro;

  let expedicao;
  try {
    expedicao = await garantirExpedicao(sb, user, isAdmin, params.id,
      'id, pedido_id, status, empresa_id, modo_frete, veiculo_placa, veiculo_uf, transportadora_id');
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 404 });
  }
  if (expedicao.status !== 'rascunho') {
    return NextResponse.json({ error: `Romaneio está "${expedicao.status}" — só um romaneio em rascunho pode ser finalizado.` }, { status: 400 });
  }

  let corpo;
  try { corpo = await request.json(); } catch { return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 }); }
  try { exigirUuid(corpo.naturezaOperacaoId, 'Natureza da operação'); } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }

  const [
    { data: pedidoItens, error: erroItens },
    { data: caixas, error: erroCaixas },
    { data: transportadora, error: erroTransportadora },
    { data: pedido, error: erroPedido },
  ] = await Promise.all([
    sb.from('pedido_itens').select('id, quantidade').eq('pedido_id', expedicao.pedido_id),
    sb.from('expedicao_caixas').select('*, expedicao_itens(*)').eq('expedicao_id', expedicao.id),
    expedicao.transportadora_id
      ? sb.from('transportadoras').select('*').eq('id', expedicao.transportadora_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    sb.from('pedidos').select('id, empresa_id, cliente_id, status, observacoes').eq('id', expedicao.pedido_id).maybeSingle(),
  ]);
  if (erroItens || erroCaixas || erroTransportadora || erroPedido) {
    return NextResponse.json({ error: 'Falha ao carregar os dados do romaneio para finalizar.' }, { status: 500 });
  }

  const alocacao = (caixas || []).flatMap(c => (c.expedicao_itens || [])
    .map(i => ({ pedidoItemId: i.pedido_item_id, quantidade: i.quantidade })));
  const divergencias = calcularDivergencia(pedidoItens, alocacao);
  if (divergencias.length) {
    return NextResponse.json({
      error: 'O romaneio não cobre exatamente o pedido — ajuste as caixas ou o pedido antes de finalizar.',
      divergencias,
    }, { status: 400 });
  }

  const { error: erroFinalizar } = await sb.from('expedicoes').update({ status: 'finalizado' }).eq('id', expedicao.id);
  if (erroFinalizar) return NextResponse.json({ error: `Falha ao finalizar o romaneio: ${erroFinalizar.message}` }, { status: 500 });

  const { error: erroConferido } = await sb.from('pedidos').update({ status: 'Conferido' }).eq('id', expedicao.pedido_id);
  if (erroConferido) {
    return NextResponse.json({ error: `Romaneio finalizado, mas falhou ao avançar o pedido para Conferido: ${erroConferido.message}` }, { status: 500 });
  }

  const expedicaoParaEmitir = {
    modo_frete: expedicao.modo_frete, transportadora, veiculo_placa: expedicao.veiculo_placa, veiculo_uf: expedicao.veiculo_uf,
    caixas: (caixas || []).map(c => ({
      peso_bruto_kg: c.peso_bruto_kg,
      itens: (c.expedicao_itens || []).map(i => ({ pedido_item_id: i.pedido_item_id, quantidade: i.quantidade })),
    })),
  };

  try {
    const resultado = await emitirNfe({ sb, pedido: { ...pedido, status: 'Conferido' }, expedicao: expedicaoParaEmitir, naturezaOperacaoId: corpo.naturezaOperacaoId, userId: user.id });
    return NextResponse.json(resultado);
  } catch (e) {
    // Falha da emissão nunca desfaz o romaneio finalizado (regra 13 do spec
    // de 25/08) — o pedido fica em Conferido, e "Tentar emitir novamente"
    // (Task 12, rota /api/fiscal/emitir-nfe) é o caminho de recuperação.
    const corpoErro = { error: e.message };
    if (e.codigo) corpoErro.codigo = e.codigo;
    return NextResponse.json(corpoErro, { status: e.status || 400 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/expedicao/[id]/finalizar/route.js
git commit -m "feat(expedicao): finalizar o romaneio dispara a emissão automática da NF-e"
```

---

### Task 17: Módulos novos e permissão

**Files:**
- Modify: `lib/auth.js`

**Interfaces:**
- Produces: entradas `expedicao` e `transportadoras` em `MODULOS` (`lib/auth.js:8-21`). Consumido por `AppShell` (Task 18-20).

- [ ] **Step 1: Ler o arquivo pra confirmar o formato exato antes de editar**

Run: `sed -n '1,25p' lib/auth.js`

- [ ] **Step 2: Acrescentar as duas entradas** (mesma forma `{ id, label, href, ic, desc }` das existentes, logo depois de `pedidos` e antes de `financeiro`)

```js
{ id: 'expedicao', label: 'Expedição', href: '/expedicao', ic: '▤', desc: 'Romaneio de separação, lotes e emissão de NF-e' },
{ id: 'transportadoras', label: 'Transportadoras', href: '/transportadoras', ic: '▥', desc: 'Cadastro de transportadoras' },
```

- [ ] **Step 3: Commit**

```bash
git add lib/auth.js
git commit -m "feat(menu): módulos Expedição e Transportadoras"
```

Nota: dar acesso aos módulos novos para os usuários certos é ação manual do admin em `/usuarios` (tabela `permissoes`) — fora do escopo desta implementação, avise o usuário ao final.

---

### Task 18: `app/transportadoras/page.js` — cadastro

**Files:**
- Create: `app/transportadoras/page.js`

**Interfaces:**
- Consumes: `useEmpresaAtual` (`lib/empresa.js:9`), `AppShell` (`components/AppShell.js:15`), `ListaCadastro`, `FichaModal` (mesmos componentes de `app/clientes/page.js`).

- [ ] **Step 1: Implementar** (CRUD simples de uma tabela só — mais enxuto que `app/clientes/page.js`, que combina duas tabelas)

```jsx
// app/transportadoras/page.js
'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import AppShell from '../../components/AppShell';
import Icone from '../../components/Icone';
import ListaCadastro from '../../components/ListaCadastro';
import FichaModal from '../../components/FichaModal';
import { useEmpresaAtual } from '../../lib/empresa';
import { filtrarRegistros } from '../../lib/listaCadastro';
import { formatarCnpj } from '../../lib/cnpj';

const FORM_VAZIO = {
  nome: '', nome_fantasia: '', cnpj: '', ie: '', logradouro: '', numero: '', complemento: '',
  bairro: '', codigo_municipio_ibge: '', municipio: '', uf: '', cep: '', telefone: '',
};
const CAMPOS_BUSCA = ['nome', 'nome_fantasia', 'cnpj', 'municipio'];

export default function TransportadorasPage() {
  return (
    <AppShell modulo="transportadoras" titulo="Transportadoras" desc="Cadastro de transportadoras, pra informar no romaneio e na NF-e">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const { empresaAtual } = useEmpresaAtual();
  const [lista, setLista] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [mostrarInativos, setMostrarInativos] = useState(false);
  const [selecionadoId, setSelecionadoId] = useState(null);
  const [criando, setCriando] = useState(false);
  const [form, setForm] = useState(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    const { data } = await supabase.from('transportadoras').select('*').eq('empresa_id', empresaAtual.id).order('nome');
    setLista(data || []);
    setLoading(false);
  }
  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  const visiveis = useMemo(
    () => filtrarRegistros(lista, { campos: CAMPOS_BUSCA, busca, mostrarInativos }),
    [lista, busca, mostrarInativos],
  );
  const selecionado = selecionadoId ? lista.find(t => t.id === selecionadoId) ?? null : null;
  const aberto = criando || !!selecionado;

  function abrirNovo() { setSelecionadoId(null); setCriando(true); setForm(FORM_VAZIO); }
  function fechar() { setSelecionadoId(null); setCriando(false); setForm(FORM_VAZIO); }
  function abrir(t) { setCriando(false); setSelecionadoId(t.id); setForm({ ...FORM_VAZIO, ...t }); }

  async function salvar(e) {
    e.preventDefault();
    if (salvando) return;
    setSalvando(true);
    try {
      const linha = { ...form, empresa_id: empresaAtual.id };
      const { error } = selecionado
        ? await supabase.from('transportadoras').update(linha).eq('id', selecionado.id)
        : await supabase.from('transportadoras').insert([linha]);
      if (error) { alert(error.message); return; }
      await carregar();
      fechar();
    } finally { setSalvando(false); }
  }

  async function alternarAtivo() {
    if (!selecionado) return;
    const { error } = await supabase.from('transportadoras').update({ ativo: selecionado.ativo === false }).eq('id', selecionado.id);
    if (error) { alert(error.message); return; }
    await carregar();
  }

  const COLUNAS = [
    { id: 'nome', titulo: 'Nome', principal: true, minimo: 200, render: t => t.nome_fantasia || t.nome, textoPuro: t => t.nome_fantasia || t.nome },
    { id: 'cnpj', titulo: 'CNPJ', largura: 140, mono: true, render: t => (t.cnpj ? formatarCnpj(t.cnpj) : null), textoPuro: t => t.cnpj || '' },
    { id: 'municipio', titulo: 'Município', largura: 140, render: t => (t.municipio ? `${t.municipio}/${t.uf || ''}` : null), textoPuro: t => t.municipio || '' },
    { id: 'telefone', titulo: 'Telefone', largura: 120, mono: true, render: t => t.telefone || null, textoPuro: t => t.telefone || '' },
  ];

  if (loading) return <p className="muted">Carregando…</p>;

  return (
    <>
      <section className="panel">
        <div className="filter-bar" style={{ marginBottom: 10 }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label htmlFor="busca-transportadora">Buscar</label>
            <input id="busca-transportadora" value={busca} placeholder="nome, CNPJ ou município"
                   onChange={e => setBusca(e.target.value)} />
          </div>
          <button className="btn" type="button" onClick={abrirNovo}><Icone nome="mais" tamanho={14} /> Nova transportadora</button>
        </div>
        <label className="check-line" style={{ fontSize: 12, marginBottom: 8 }}>
          <input type="checkbox" checked={mostrarInativos} onChange={e => setMostrarInativos(e.target.checked)} /> Mostrar inativas
        </label>
        <ListaCadastro chave="transportadoras" colunas={COLUNAS} registros={visiveis} selecionado={selecionado?.id}
          onAbrir={abrir} rotulo="Transportadoras" vazio="Nenhuma transportadora cadastrada ainda." />
      </section>

      {aberto && (
        <FichaModal titulo={selecionado ? selecionado.nome : 'Nova transportadora'} onFechar={fechar}>
          <form onSubmit={salvar}>
            <label>Nome (razão social)</label>
            <input required value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} />
            <label>Nome fantasia</label>
            <input value={form.nome_fantasia} onChange={e => setForm(f => ({ ...f, nome_fantasia: e.target.value }))} />
            <div className="row-actions">
              <div style={{ flex: 1 }}>
                <label>CNPJ</label>
                <input value={form.cnpj} onChange={e => setForm(f => ({ ...f, cnpj: e.target.value }))} />
              </div>
              <div style={{ flex: 1 }}>
                <label>Inscrição estadual</label>
                <input value={form.ie} onChange={e => setForm(f => ({ ...f, ie: e.target.value }))} />
              </div>
            </div>
            <label>Logradouro</label>
            <input value={form.logradouro} onChange={e => setForm(f => ({ ...f, logradouro: e.target.value }))} />
            <div className="row-actions">
              <div style={{ flex: 1 }}>
                <label>Município</label>
                <input value={form.municipio} onChange={e => setForm(f => ({ ...f, municipio: e.target.value }))} />
              </div>
              <div style={{ width: 80 }}>
                <label>UF</label>
                <input maxLength={2} value={form.uf} onChange={e => setForm(f => ({ ...f, uf: e.target.value.toUpperCase() }))} />
              </div>
            </div>
            <label>Código do município (IBGE)</label>
            <input value={form.codigo_municipio_ibge} onChange={e => setForm(f => ({ ...f, codigo_municipio_ibge: e.target.value }))} />
            <label>Telefone</label>
            <input value={form.telefone} onChange={e => setForm(f => ({ ...f, telefone: e.target.value }))} />
            <div className="modal-foot">
              <button className="btn" type="submit" disabled={salvando}>{salvando ? 'Salvando…' : (selecionado ? 'Salvar alterações' : 'Criar transportadora')}</button>
              <button className="btn secondary" type="button" onClick={fechar}>Cancelar</button>
              {selecionado && (
                <button className="btn secondary small" type="button" style={{ marginLeft: 'auto' }} onClick={alternarAtivo}>
                  {selecionado.ativo === false ? 'Reativar' : 'Desativar'}
                </button>
              )}
            </div>
          </form>
        </FichaModal>
      )}
    </>
  );
}
```

- [ ] **Step 2: Rodar o dev server e verificar manualmente**

Run: `npm run dev` (ou usar o preview do harness), abrir `/transportadoras`, criar uma transportadora, editar, desativar/reativar.
Expected: fluxo completo funciona sem erro no console.

- [ ] **Step 3: Commit**

```bash
git add app/transportadoras/page.js
git commit -m "feat(transportadoras): tela de cadastro"
```

---

### Task 19: `app/expedicao/page.js` — escolher pedido pendente

**Files:**
- Create: `app/expedicao/page.js`

**Interfaces:**
- Consumes: `POST /api/expedicao` (Task 13).
- Produces: lista de pedidos `Pendente` com botão "Iniciar romaneio" → navega para `/expedicao/[id]` (Task 20).

- [ ] **Step 1: Implementar**

```jsx
// app/expedicao/page.js
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import AppShell from '../../components/AppShell';
import { useEmpresaAtual } from '../../lib/empresa';
import { fmtDate, fmtMoney } from '../../lib/format';
import { totalPedido } from '../../lib/pedidos';

export default function ExpedicaoPage() {
  return (
    <AppShell modulo="expedicao" titulo="Expedição" desc="Romaneio de separação: escolha o pedido pendente pra começar">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const { empresaAtual } = useEmpresaAtual();
  const router = useRouter();
  const [pedidos, setPedidos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [iniciando, setIniciando] = useState(null);
  const [erro, setErro] = useState('');

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    const { data } = await supabase.from('pedidos')
      .select('*, cliente:clientes(nome), pedido_itens(quantidade, preco_unitario)')
      .eq('empresa_id', empresaAtual.id).eq('status', 'Pendente').order('data');
    setPedidos(data || []);
    setLoading(false);
  }
  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  async function iniciar(pedidoId) {
    setIniciando(pedidoId);
    setErro('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch('/api/expedicao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ pedidoId }),
      });
      const json = await r.json();
      if (!r.ok) { setErro(json.error || 'Falha ao iniciar o romaneio.'); return; }
      router.push(`/expedicao/${json.expedicaoId}`);
    } finally {
      setIniciando(null);
    }
  }

  if (loading) return <p className="muted">Carregando…</p>;

  return (
    <section className="panel">
      {erro && <p className="erro">{erro}</p>}
      {!pedidos.length && <p className="muted">Nenhum pedido pendente pra separar.</p>}
      {pedidos.map(p => (
        <div key={p.id} className="row-actions" style={{ justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--linha)' }}>
          <div>
            <strong>{p.cliente?.nome}</strong> — {fmtDate(p.data)} — {fmtMoney(totalPedido(p.pedido_itens))}
          </div>
          <button className="btn small" disabled={iniciando === p.id} onClick={() => iniciar(p.id)}>
            {iniciando === p.id ? 'Iniciando…' : 'Iniciar romaneio'}
          </button>
        </div>
      ))}
    </section>
  );
}
```

- [ ] **Step 2: Verificar manualmente**

Run: abrir `/expedicao`, confirmar que só pedidos `Pendente` aparecem, clicar "Iniciar romaneio" e confirmar que navega e que o pedido muda para `Separação` em `/pedidos`.

- [ ] **Step 3: Commit**

```bash
git add app/expedicao/page.js
git commit -m "feat(expedicao): tela de escolha do pedido pendente"
```

---

### Task 20: `app/expedicao/[id]/page.js` — montar o romaneio e finalizar

**Files:**
- Create: `app/expedicao/[id]/page.js`

**Interfaces:**
- Consumes: `ordenarFefo`/`sugerirAlocacao`/`empacotarCaixas`/`calcularDivergencia` (Tasks 3-5), `vw_estoque_produto_lote` (Task 1), `PUT /api/expedicao/[id]` (Task 14), `POST /api/expedicao/[id]/cancelar` (Task 15), `POST /api/expedicao/[id]/finalizar` (Task 16).

- [ ] **Step 1: Implementar**

Esta tela é a mais longa da feature — segue o padrão de arquivo único com seções empilhadas de `app/pedidos/[id]/page.js` (sem abas). Carrega a expedição + itens do pedido + saldo de lote por produto (`vw_estoque_produto_lote`, criada na Task 1).

```jsx
// app/expedicao/[id]/page.js — estrutura (preencher a consulta de saldo por
// lote depois de confirmar vw_estoque_produto_lote ou equivalente ao vivo):
'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';
import AppShell from '../../../components/AppShell';
import { useEmpresaAtual } from '../../../lib/empresa';
import { sugerirAlocacao, empacotarCaixas, calcularDivergencia } from '../../../lib/expedicao';

export default function ExpedicaoDetalhePage() {
  return (
    <AppShell modulo="expedicao" titulo="Romaneio de separação" desc="Lotes, caixas, transporte e emissão da NF-e">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const { id } = useParams();
  const router = useRouter();
  const { empresaAtual } = useEmpresaAtual();
  const [expedicao, setExpedicao] = useState(null);
  const [pedidoItens, setPedidoItens] = useState([]);
  const [lotesPorProduto, setLotesPorProduto] = useState({});
  const [alocacao, setAlocacao] = useState([]);
  const [transportadoras, setTransportadoras] = useState([]);
  const [transportadoraId, setTransportadoraId] = useState('');
  const [modoFrete, setModoFrete] = useState('0');
  const [veiculoPlaca, setVeiculoPlaca] = useState('');
  const [veiculoUf, setVeiculoUf] = useState('');
  const [naturezas, setNaturezas] = useState([]);
  const [naturezaEscolhida, setNaturezaEscolhida] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [finalizando, setFinalizando] = useState(false);
  const [erro, setErro] = useState('');
  const [divergencias, setDivergencias] = useState([]);

  useEffect(() => { carregar(); }, [id, empresaAtual?.id]);

  async function carregar() {
    if (!empresaAtual) return;
    const { data: exp } = await supabase.from('expedicoes').select('*').eq('id', id).maybeSingle();
    if (!exp) return;
    setExpedicao(exp);
    setTransportadoraId(exp.transportadora_id || '');
    setModoFrete(exp.modo_frete || '0');
    setVeiculoPlaca(exp.veiculo_placa || '');
    setVeiculoUf(exp.veiculo_uf || '');

    const produtoIds = [...new Set((await supabase.from('pedido_itens').select('produto_id').eq('pedido_id', exp.pedido_id)).data?.map(i => i.produto_id) || [])];
    const [{ data: itens }, { data: transp }, { data: nats }, { data: saldosLote }] = await Promise.all([
      supabase.from('pedido_itens').select('*, produto:produtos(id, nome, rastreado)').eq('pedido_id', exp.pedido_id),
      supabase.from('transportadoras').select('*').eq('empresa_id', empresaAtual.id).eq('ativo', true).order('nome'),
      supabase.from('naturezas_operacao').select('id, descricao').eq('empresa_id', empresaAtual.id).eq('tipo_operacao', 'saida').eq('ativo', true),
      supabase.from('vw_estoque_produto_lote').select('*').eq('empresa_id', empresaAtual.id).in('produto_id', produtoIds).gt('saldo', 0),
    ]);
    setPedidoItens(itens || []);
    setTransportadoras(transp || []);
    setNaturezas(nats || []);

    // Agrupa o saldo por produto — sugerirAlocacao espera { [produtoId]: lotes[] }.
    const porProduto = {};
    for (const l of saldosLote || []) {
      (porProduto[l.produto_id] ||= []).push({ recebimentoItemId: l.recebimento_item_id, validade: l.validade, saldo: l.saldo });
    }
    setLotesPorProduto(porProduto);

    const itensPedidoParaSugestao = (itens || []).map(i => ({
      pedidoItemId: i.id, produtoId: i.produto_id, quantidade: i.quantidade, rastreado: i.produto?.rastreado,
    }));
    setAlocacao(sugerirAlocacao(itensPedidoParaSugestao, porProduto));
  }

  const caixas = empacotarCaixas(alocacao, Object.fromEntries(pedidoItens.map(i => [i.id, i.produto_id])));

  async function salvar() {
    setSalvando(true);
    setErro('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const corpo = {
        transportadoraId: transportadoraId || null, modoFrete, veiculoPlaca: veiculoPlaca || null, veiculoUf: veiculoUf || null,
        caixas: caixas.map((itensCaixa, indice) => ({
          numero: indice + 1,
          pesoBrutoKg: null,
          itens: itensCaixa.map(i => ({ pedidoItemId: i.pedidoItemId, produtoId: pedidoItens.find(pi => pi.id === i.pedidoItemId)?.produto_id, recebimentoItemId: i.recebimentoItemId, quantidade: i.quantidade })),
        })),
      };
      const r = await fetch(`/api/expedicao/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify(corpo),
      });
      const json = await r.json();
      if (!r.ok) setErro(json.error || 'Falha ao salvar o romaneio.');
    } finally {
      setSalvando(false);
    }
  }

  async function cancelar() {
    if (!confirm('Cancelar este romaneio e voltar o pedido para Pendente?')) return;
    const { data: { session } } = await supabase.auth.getSession();
    await fetch(`/api/expedicao/${id}/cancelar`, { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token || ''}` } });
    router.push('/expedicao');
  }

  async function finalizar() {
    if (!naturezaEscolhida) { alert('Selecione a natureza da operação.'); return; }
    const divs = calcularDivergencia(pedidoItens, alocacao);
    if (divs.length) { setDivergencias(divs); return; }
    setFinalizando(true);
    setErro('');
    try {
      await salvar();
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch(`/api/expedicao/${id}/finalizar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ naturezaOperacaoId: naturezaEscolhida }),
      });
      const json = await r.json();
      if (!r.ok) { setErro(json.error || 'Falha ao finalizar.'); if (json.divergencias) setDivergencias(json.divergencias); return; }
      router.push(`/pedidos/${expedicao.pedido_id}`);
    } finally {
      setFinalizando(false);
    }
  }

  if (!expedicao) return <p className="muted">Carregando…</p>;

  return (
    <section className="panel">
      <h3>Romaneio {expedicao.numero}</h3>
      {erro && <p className="erro">{erro}</p>}
      {!!divergencias.length && (
        <div className="erro">
          <p>O romaneio não cobre exatamente o pedido:</p>
          <ul>{divergencias.map(d => <li key={d.pedidoItemId}>item {d.pedidoItemId}: pedido {d.pedido}, alocado {d.alocado} (diferença {d.diferenca})</li>)}</ul>
        </div>
      )}

      <h4>Caixas ({caixas.length})</h4>
      {caixas.map((itensCaixa, i) => (
        <div key={i} className="row-actions" style={{ borderBottom: '1px solid var(--linha)', padding: '4px 0' }}>
          <strong>Caixa {i + 1}</strong> — {itensCaixa.reduce((s, it) => s + it.quantidade, 0)} un.
          {itensCaixa.map((it, j) => <span key={j} className="tag"> {it.recebimentoItemId || 'sem lote'} × {it.quantidade}</span>)}
        </div>
      ))}

      <h4>Transporte</h4>
      <label>Transportadora</label>
      <select value={transportadoraId} onChange={e => setTransportadoraId(e.target.value)}>
        <option value="">Nenhuma (retirada / frota própria)</option>
        {transportadoras.map(t => <option key={t.id} value={t.id}>{t.nome_fantasia || t.nome}</option>)}
      </select>
      <label>Modo de frete</label>
      <select value={modoFrete} onChange={e => setModoFrete(e.target.value)}>
        <option value="0">Contratação por conta do remetente (CIF)</option>
        <option value="1">Contratação por conta do destinatário (FOB)</option>
        <option value="9">Sem frete (retirada)</option>
      </select>
      <div className="row-actions">
        <div><label>Placa do veículo</label><input value={veiculoPlaca} onChange={e => setVeiculoPlaca(e.target.value.toUpperCase())} /></div>
        <div><label>UF do veículo</label><input maxLength={2} value={veiculoUf} onChange={e => setVeiculoUf(e.target.value.toUpperCase())} /></div>
      </div>

      <div className="row-actions" style={{ marginTop: 12 }}>
        <button className="btn secondary" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar rascunho'}</button>
        <button className="btn secondary" onClick={cancelar}>Cancelar romaneio</button>
      </div>

      <h4>Finalizar</h4>
      <label>Natureza da operação</label>
      <select value={naturezaEscolhida} onChange={e => setNaturezaEscolhida(e.target.value)}>
        <option value="">Selecione…</option>
        {naturezas.map(n => <option key={n.id} value={n.id}>{n.descricao}</option>)}
      </select>
      <button className="btn" onClick={finalizar} disabled={finalizando || !naturezaEscolhida}>
        {finalizando ? 'Finalizando e emitindo…' : 'Finalizar e emitir NF-e'}
      </button>
    </section>
  );
}
```

- [ ] **Step 2: Verificar manualmente end-to-end**

Run: a partir de `/expedicao`, iniciar romaneio de um pedido de teste (ambiente homologação), montar caixas, escolher natureza, finalizar, confirmar que a NF-e sai autorizada (homologação) e que o pedido aparece `Faturado` em `/pedidos`.
Expected: fluxo completo sem erro; `contas_a_receber` tem uma linha nova pro pedido.

- [ ] **Step 3: Commit**

```bash
git add app/expedicao/[id]/page.js
git commit -m "feat(expedicao): tela de montagem do romaneio, transporte e finalização"
```

---

### Task 21: Etiqueta de despacho

**Files:**
- Create: `components/EtiquetaDespachoPrint.js`
- Modify: `lib/etiquetas.js` (novo template/medida, se o motor genérico já suportar por config; senão, seguir o padrão de `components/EtiquetaPrint.js`)

**Interfaces:**
- Consumes: `imprimirEtiquetas` (`components/EtiquetaPrint.js:180`) como referência de padrão `window.print()`.
- Produces: componente de etiqueta 101×50mm por caixa, com QR de rastreio (reaproveita `lib/etiquetas.js` e o pacote `qrcode` já usado pelas etiquetas de recebimento/produção — spec de 20/08, seção "Despacho").

- [ ] **Step 1: Ler `components/EtiquetaPrint.js` inteiro e `lib/etiquetas.js` inteiro antes de implementar**, pra reaproveitar exatamente o mecanismo de paginação/medida em mm e a chamada a `registrar_impressao` (fora do escopo desta implementação verificar se a etiqueta 101×50 de coluna única precisa de paginação especial — as de 50×30 têm; confirmar lendo o arquivo).

- [ ] **Step 2: Implementar o componente**, seguindo a estrutura de `EtiquetaPrint` (linha 17 em diante) e o layout já desenhado no spec de 20/08 (seção "3. Despacho"): nome da empresa, lista de produtos/lote/fabricação/validade/quantidade por caixa, selo S.I.M. (SVG, dados de `empresas.sim_numero`/`sim_municipio`), dizer de conservação (`produtos.conservacao_texto`), número da caixa e do romaneio.

- [ ] **Step 3: Ligar o botão de imprimir na tela do Task 20**, chamando `registrar_impressao` com `source_type = 'expedicao_caixa'` (já aceito pelo check da atualização 28, conferido no levantamento desta implementação) e `source_id` = id da caixa.

- [ ] **Step 4: Verificar manualmente**

Run: finalizar um romaneio de teste, clicar "Imprimir etiquetas de despacho", conferir no preview de impressão (`window.print()`) que os dados batem com o que foi separado.

- [ ] **Step 5: Commit**

```bash
git add components/EtiquetaDespachoPrint.js lib/etiquetas.js
git commit -m "feat(expedicao): etiqueta de despacho 101x50 por caixa"
```

---

### Task 22: `app/financeiro/contas-a-receber/page.js`

**Files:**
- Create: `app/financeiro/contas-a-receber/page.js`

**Interfaces:**
- Consumes: `CATEGORIAS_CONTA`/`FORMAS_PAGAMENTO`/`isVencida` (`lib/financeiro.js`) — reaproveita `FORMAS_PAGAMENTO` e `isVencida`, não `CATEGORIAS_CONTA` (conta a receber não tem categoria). Espelha `app/financeiro/contas-a-pagar/page.js` (ler o arquivo inteiro antes de implementar, para copiar exatamente o padrão de listagem/filtro/baixa).

- [ ] **Step 1: Ler `app/financeiro/contas-a-pagar/page.js` inteiro** (322 linhas) — já parcialmente citado nesta implementação (imports, `carregar()`, filtro, baixa de parcela com upload de comprovante); ler o restante (JSX da tabela e do modal de baixa) antes de escrever.

- [ ] **Step 2: Implementar**, com as diferenças do spec de 25/08 em relação a contas-a-pagar:
  - Sem formulário de lançamento manual (toda conta nasce da emissão da NF-e — Task 11) — a tela só lista, filtra e dá baixa.
  - Cada linha mostra link pro pedido (`/pedidos/[id]`) e pra NF-e de origem (reaproveitar `arquivosDaNota`/DANFE já usados em `app/pedidos/[id]/page.js`).
  - Baixa de parcela: mesmo fluxo de `contas_a_pagar_parcelas` (`update` direto com `status: 'Recebido'`, `data_recebimento`, `forma_recebimento`, `comprovante_path` opcional), trocando "pagamento" por "recebimento" no texto.
  - Filtro por status (Pendente/Recebido/Vencida via `isVencida`), cliente, faixa de vencimento.

- [ ] **Step 3: Verificar manualmente**

Run: depois de uma emissão de teste (Task 20), abrir `/financeiro/contas-a-receber`, confirmar que a conta aparece, dar baixa numa parcela, confirmar que o status muda pra Recebido.

- [ ] **Step 4: Commit**

```bash
git add app/financeiro/contas-a-receber/page.js
git commit -m "feat(financeiro): tela de contas a receber"
```

---

### Task 23: `app/pedidos/page.js` e `app/pedidos/[id]/page.js` — botões guiados

**Files:**
- Modify: `app/pedidos/page.js`
- Modify: `app/pedidos/[id]/page.js`

**Interfaces:**
- Consumes: `STATUS_PEDIDO` (Task 7), rotas de expedição (Tasks 13-16).

- [ ] **Step 1: `app/pedidos/page.js` (linhas 106-110, `mudarStatus`, e a tabela que usa `<select>` de status por linha)** — trocar a lista de status livre por: se `Pendente`, botão "Iniciar romaneio" (chama `POST /api/expedicao`, mesmo padrão de Task 19, e navega pra `/expedicao/[id]`); se `Separação`/`Conferido`, link "Continuar romaneio" pra `/expedicao/[expedicaoId]` (precisa de uma query extra pra achar a expedição viva do pedido); `Faturado`/`Enviado`/`Cancelado` continuam com o `<select>` restrito às transições que ainda são diretas (`Faturado`→`Enviado`, e cancelamento com motivo).

- [ ] **Step 2: `app/pedidos/[id]/page.js`** — no cabeçalho (linhas 518-532), trocar o `<select>` de status por:
  - `Pendente`: botão "Ir para separação" (mesma chamada do Task 19).
  - `Separação`/`Conferido`: link "Continuar romaneio" (busca a expedição viva do pedido e navega).
  - `Faturado`/`Enviado`: mantém o `<select>` restrito a essas duas opções (comportamento já existente, só removendo `Pendente` da lista quando o pedido já passou por emissão — reabertura continua pelo fluxo de motivo já existente, linhas 548-566, sem mudança).
  - Remover o bloco "Nota fiscal (NF-e)" da tela de pedido no caminho normal (linhas 588-706) — ele passa a existir só como **exibição** do resultado (chave, protocolo, DANFE) e como caminho de retentativa (`escolhendoNatureza`/`emitir()` continuam existindo, mas só aparecem quando `notaFiscal?.status` indica falha e o pedido está em `Conferido` — o caminho normal de emissão passa a ser exclusivamente `/expedicao/[id]`, Task 20).

- [ ] **Step 3: Verificar manualmente**

Run: percorrer o ciclo completo `Pendente → Separação → Conferido → Faturado → Enviado` pela UI, confirmando que os botões levam aos lugares certos e que o `<select>` livre não aparece mais fora de `Faturado`/`Enviado`.

- [ ] **Step 4: Commit**

```bash
git add app/pedidos/page.js "app/pedidos/[id]/page.js"
git commit -m "feat(pedidos): botões guiados no lugar do dropdown de status livre"
```

---

### Task 24: `/relatorios` — somar contas a receber

**Files:**
- Modify: arquivo de `/relatorios` que hoje soma `contas_a_pagar` (localizar primeiro: `grep -rln "contas_a_pagar" app/relatorios/`)

**Interfaces:**
- Consumes: `contas_a_receber`/`contas_a_receber_parcelas` (Task 2).

- [ ] **Step 1: Localizar e ler o arquivo**

Run: `grep -rn "contas_a_pagar" app/relatorios/`

- [ ] **Step 2: Acrescentar a soma de `contas_a_receber`/`contas_a_receber_parcelas`** ao lado do que já soma de `contas_a_pagar`, mesmo nível "simplificado" já existente (sem introduzir distinção competência/caixa nova — decisão já registrada no spec de 25/08).

- [ ] **Step 3: Verificar manualmente**

Run: abrir `/relatorios`, confirmar que a conta a receber criada no Task 20 aparece somada.

- [ ] **Step 4: Commit**

```bash
git add app/relatorios/
git commit -m "feat(relatorios): soma contas a receber ao lado de contas a pagar"
```

---

## Verificação final

- [ ] `npm test` — suíte inteira passa.
- [ ] `tests/migracao-50/verificar.sh` e `tests/migracao-51/verificar.sh` — `MIGRAÇÃO 50/51 OK`.
- [ ] `npm run build` — sem erro de compilação.
- [ ] Ciclo completo manual em homologação: pedido → romaneio → caixas → transporte → finalizar → NF-e autorizada → pedido Faturado → conta a receber → baixa de parcela.
- [ ] Aplicar `atualizacao_50_expedicao_romaneio.sql` e `atualizacao_51_contas_a_receber.sql` em produção **só depois de**: (a) todas as tasks acima commitadas e testadas, (b) o usuário revisar os dois arquivos SQL, (c) confirmação explícita do usuário pra rodar contra `SUPABASE_DB_URL` de produção.
