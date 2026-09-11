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
