-- tests/migracao-52/fixture.sql
-- Esqueleto mínimo pra exercitar a atualização 52 num Postgres local
-- descartável. Recria `registrar_impressao` COMO ELA ESTÁ HOJE em produção
-- (atualização 30, sem o ramo `expedicao_caixa`) — a 52 faz `create or
-- replace`, então o runner prova a transição real: ramos antigos continuam
-- de pé, e o ramo novo só existe depois da migração.
--
-- Não recria o mundo inteiro da atualização 30 (custo/rendimento de
-- defumação, triggers de embalagem etc.) — só as tabelas que
-- `registrar_impressao` toca, mínimas o bastante pra existir sem quebrar a
-- criação da função (PL/pgSQL resolve os nomes de tabela na hora do `create
-- or replace function`, não só na execução).
create extension if not exists pgcrypto;

create schema if not exists auth;
create or replace function auth.uid() returns uuid
  language sql stable as $$ select nullif(current_setting('req.uid', true), '')::uuid $$;

create table public.empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null
);

-- Ramo `producao_interna`.
create table public.producoes_internas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id),
  status text,
  codigo text
);

-- Ramo `producao`.
create table public.producoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id)
);

-- Ramo `recebimento_item` — o que o cenário 4 (regressão) exercita.
create table public.recebimento_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id)
);

-- Ramo `embalagem_item`. `embalagens.status` já existe em produção desde a
-- própria atualização 30 (ela faz `alter table embalagens add column status`
-- antes de definir a RPC) — o fixture já nasce com a coluna, como está hoje.
create table public.embalagens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id),
  status text not null default 'rascunho'
);
create table public.embalagem_itens (
  id uuid primary key default gen_random_uuid(),
  embalagem_id uuid references public.embalagens(id) on delete cascade,
  empresa_id uuid references public.empresas(id)
);

-- Ramo novo `expedicao_caixa` — forma da atualização 50 (Task 1), reduzida
-- às colunas que `registrar_impressao` lê: `pedidos` só existe porque
-- `expedicoes.pedido_id` é `not null references pedidos(id)`.
create table public.pedidos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id)
);
create table public.expedicoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  pedido_id uuid not null references public.pedidos(id),
  numero text not null,
  status text not null default 'rascunho'
    check (status in ('rascunho', 'finalizado', 'cancelado'))
);
create table public.expedicao_caixas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  expedicao_id uuid not null references public.expedicoes(id) on delete cascade,
  numero int not null
);

-- Já com o check ampliado pela atualização 28 (aplicada em produção) —
-- `expedicao_caixa` já é um source_type válido na tabela, só falta o ramo na
-- função.
create table public.etiqueta_impressoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  source_type text not null
    check (source_type in ('producao','producao_interna','recebimento_item','embalagem_item','expedicao_caixa')),
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

-- Dublês das funções de permissão/auditoria que a RPC chama. Sempre
-- permissivos (empresa liberada, permissão concedida) — o objetivo destes
-- cenários é só o roteamento por `source_type` e o status da ficha-mãe, não
-- reexercitar RLS/permissão (isso já está coberto em tests/migracao-30).
create or replace function public.empresas_permitidas() returns setof uuid
  language sql stable as $$ select id from public.empresas $$;
create or replace function public.tem_permissao(m text) returns boolean
  language sql stable as $$ select true $$;
create or replace function public.fn_nome_usuario() returns text
  language sql stable as $$ select 'Operador de Teste' $$;
create or replace function public.fn_registrar_auditoria(
  p_recurso text, p_recurso_id uuid, p_acao text, p_empresa uuid,
  p_anteriores jsonb, p_novos jsonb, p_justificativa text)
  returns void language plpgsql as $$
begin
  -- no-op: só interessa aqui que registrar_impressao consiga chamar a
  -- função com esta assinatura, não o que a auditoria real grava.
end $$;

-- A RPC como a atualização 30 a deixou em produção: sem o ramo
-- `expedicao_caixa`. Cópia literal do corpo publicado em
-- supabase/atualizacao_30_ficha_embalagem.sql:669-757. Prova que é a 52 quem
-- acrescenta o ramo, não o fixture.
create or replace function public.registrar_impressao(
  p_source_type text, p_source_id uuid, p_tipo text, p_quantidade int,
  p_modelo text default 'validade-cozinha', p_impressora text default null, p_motivo text default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_empresa uuid;
  v_status text;
  v_codigo text;
  v_modulo text;
  v_modulo_label text;
begin
  if p_source_type = 'producao_interna' then
    v_modulo := 'producoes';
    select empresa_id, status, codigo into v_empresa, v_status, v_codigo
      from producoes_internas where id = p_source_id;
    if not found then raise exception 'Produção interna não encontrada.'; end if;
    if v_status <> 'finalizada' then
      raise exception 'Etiquetas só podem ser impressas para produção finalizada (% está "%").', v_codigo, v_status;
    end if;
  elsif p_source_type = 'producao' then
    v_modulo := 'producoes';
    select empresa_id into v_empresa from producoes where id = p_source_id;
    if not found then raise exception 'Produção não encontrada.'; end if;
  elsif p_source_type = 'recebimento_item' then
    v_modulo := 'recebimentos';
    select empresa_id into v_empresa
      from recebimento_itens where id = p_source_id;
    if not found then raise exception 'Item de recebimento não encontrado.'; end if;
  elsif p_source_type = 'embalagem_item' then
    v_modulo := 'producoes';
    select ei.empresa_id, e.status into v_empresa, v_status
      from embalagem_itens ei
      join embalagens e on e.id = ei.embalagem_id
     where ei.id = p_source_id;
    if not found then raise exception 'Item de embalagem não encontrado.'; end if;
    if v_status <> 'finalizada' then
      raise exception 'Etiquetas só podem ser impressas para ficha de embalagem finalizada (está "%").', v_status;
    end if;
  else
    raise exception 'source_type inválido: %', p_source_type;
  end if;

  if v_empresa not in (select public.empresas_permitidas()) then
    raise exception 'Sem acesso à empresa desta impressão.';
  end if;
  if not public.tem_permissao(v_modulo) then
    v_modulo_label := case v_modulo
      when 'producoes' then 'Produção'
      when 'recebimentos' then 'Recebimento'
      else v_modulo
    end;
    raise exception 'Sem permissão para imprimir etiquetas de %.', v_modulo_label;
  end if;
  if p_tipo = 'reimpressao' and (p_motivo is null or btrim(p_motivo) = '') then
    raise exception 'Informe o motivo da reimpressão.';
  end if;

  insert into etiqueta_impressoes (empresa_id, source_type, source_id, tipo, quantidade, modelo, impressora, motivo, usuario_id, usuario_nome)
  values (v_empresa, p_source_type, p_source_id, p_tipo, p_quantidade, p_modelo, p_impressora, p_motivo, auth.uid(), public.fn_nome_usuario());

  perform public.fn_registrar_auditoria('etiqueta_impressoes', p_source_id,
                                        case when p_tipo = 'reimpressao' then 'REIMPRESSAO' else 'IMPRESSAO' end,
                                        v_empresa, null,
                                        jsonb_build_object('source_type', p_source_type, 'quantidade', p_quantidade,
                                                           'modelo', p_modelo, 'impressora', p_impressora),
                                        p_motivo);
end $$;

-- ---------- DADOS ----------

insert into public.empresas (id, nome) values
  ('11111111-1111-1111-1111-111111111111', 'Food Services');

-- Item de recebimento pra exercitar o ramo antigo `recebimento_item` no
-- cenário 4 (prova de não-regressão).
insert into public.recebimento_itens (id, empresa_id) values
  ('66666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111');

-- Pedido + um romaneio finalizado e outro em rascunho, pra exercitar o ramo
-- novo `expedicao_caixa` (cenários 1 e 2).
insert into public.pedidos (id, empresa_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');

insert into public.expedicoes (id, empresa_id, pedido_id, numero, status) values
  ('eeeeeeee-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000001', 'RM-260910-001', 'finalizado'),
  ('eeeeeeee-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000001', 'RM-260910-002', 'rascunho');

insert into public.expedicao_caixas (id, empresa_id, expedicao_id, numero) values
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'eeeeeeee-0000-0000-0000-000000000001', 1),
  ('cccccccc-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'eeeeeeee-0000-0000-0000-000000000002', 1);
