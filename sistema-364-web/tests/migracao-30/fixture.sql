-- Esqueleto mínimo para exercitar a atualização 30 num Postgres local.
--
-- Espelha a forma REAL de produção, conferida em 2026-08-22 lendo o catálogo
-- do Supabase (`information_schema.columns` + `pg_trigger`):
--   • `recebimento_itens` NÃO tem `status_recebimento` — o status sanitário
--     migrou para `inspecoes_qualidade` na atualização 09. É a mina.
--   • `embalagens` tem só id/lote/data/responsavel_id/sobra_kg/obs/empresa_id
--     /created_at; `embalagem_itens` só id/embalagem_id/produto_id/quantidade
--     /peso_total_kg/empresa_id (`peso_total_kg` aceita nulo).
--   • O trigger `trg_embalagem_items_to_producao` existe em `embalagem_itens`
--     e aponta para `trigger_embalagem_para_producao` — reproduzido aqui na
--     versão da atualização 10, lendo a coluna morta.
--   • As migrações 28 e 29 já estão aplicadas: por isso `volumes`,
--     `unique (empresa_id, lote)` em `recebimento_itens`, as colunas de status
--     em `defumacoes`/`defumacao_itens` e o check ampliado de
--     `etiqueta_impressoes`.

create schema if not exists auth;
create or replace function auth.uid() returns uuid
  language sql stable as $$ select nullif(current_setting('req.uid', true), '')::uuid $$;

create table empresas (id uuid primary key, nome text);
create table funcionarios (id uuid primary key, empresa_id uuid references empresas(id), nome text);
create table materias_primas (id uuid primary key, empresa_id uuid references empresas(id), nome text);

create table produtos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null,
  nome text not null,
  unidade text not null default 'un',
  validade_dias int not null default 90,
  conservacao_texto text,
  empresa_id uuid not null references empresas(id),
  created_at timestamptz not null default now(),
  unique (empresa_id, codigo)
);

create table ficha_tecnica (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references produtos(id) on delete cascade,
  materia_prima_id uuid not null references materias_primas(id),
  quantidade numeric(12,4) not null,
  empresa_id uuid not null references empresas(id)
);

create table recebimentos (
  id uuid primary key default gen_random_uuid(),
  data date not null default current_date,
  empresa_id uuid not null references empresas(id)
);

-- Sem `status_recebimento`: é exatamente esse buraco que faz o trigger antigo
-- estourar 42703 no primeiro item salvo.
create table recebimento_itens (
  id uuid primary key default gen_random_uuid(),
  recebimento_id uuid not null references recebimentos(id) on delete cascade,
  materia_prima_id uuid not null references materias_primas(id),
  lote text not null,
  quantidade numeric(12,4) not null,
  custo_unitario numeric(12,2) not null,
  validade date,
  volumes int,
  empresa_id uuid not null references empresas(id),
  created_at timestamptz not null default now(),
  unique (empresa_id, lote)
);

-- Só as colunas que a migração 30 lê. O DDL de produção tem mais campos
-- (temperatura_c, motivo_rejeicao, foto_url...), irrelevantes aqui.
create table inspecoes_qualidade (
  id uuid primary key default gen_random_uuid(),
  recebimento_item_id uuid not null references recebimento_itens(id) on delete cascade,
  empresa_id uuid not null references empresas(id),
  status text not null default 'pendente'
    check (status in ('pendente','aprovado','aprovado_com_ressalva','quarentena','rejeitado','devolvido'))
);

create table defumacoes (
  id uuid primary key default gen_random_uuid(),
  lote text not null,
  data date not null default current_date,
  responsavel_id uuid references funcionarios(id),
  obs text,
  empresa_id uuid not null references empresas(id),
  status text not null default 'rascunho',
  created_at timestamptz not null default now()
);

create table defumacao_itens (
  id uuid primary key default gen_random_uuid(),
  defumacao_id uuid not null references defumacoes(id) on delete cascade,
  materia_prima_id uuid not null references materias_primas(id),
  recebimento_item_id uuid references recebimento_itens(id),
  peso_bruto_kg numeric(12,4) not null,
  peso_final_kg numeric(12,4) not null,
  empresa_id uuid not null references empresas(id)
);

create table embalagens (
  id uuid primary key default gen_random_uuid(),
  lote text not null,
  data date not null default current_date,
  responsavel_id uuid references funcionarios(id),
  sobra_kg numeric(12,4) not null default 0,
  obs text,
  empresa_id uuid not null references empresas(id),
  created_at timestamptz not null default now()
);

create table embalagem_itens (
  id uuid primary key default gen_random_uuid(),
  embalagem_id uuid not null references embalagens(id) on delete cascade,
  produto_id uuid not null references produtos(id),
  quantidade numeric(12,4) not null,
  peso_total_kg numeric(12,4),
  empresa_id uuid not null references empresas(id)
);

create table producoes (
  id uuid primary key default gen_random_uuid(),
  lote text not null,
  data date not null default current_date,
  produto_id uuid not null references produtos(id),
  quantidade numeric(12,4) not null,
  custo_total numeric(12,2) not null default 0,
  validade date,
  responsavel_id uuid references funcionarios(id),
  peso_final_kg numeric(12,4),
  origem text,
  empresa_id uuid not null references empresas(id),
  created_at timestamptz not null default now()
);

-- Só as colunas que `registrar_impressao` lê no ramo `producao_interna`.
create table producoes_internas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references empresas(id),
  status text,
  codigo text
);

-- Já com o check ampliado pela atualização 28 (aplicada em produção).
create table etiqueta_impressoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
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

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  usuario_id uuid, acao text not null, recurso text, recurso_id uuid,
  valores_anteriores jsonb, valores_novos jsonb, justificativa text,
  created_at timestamptz not null default now()
);

-- Vem da migração 11; a 17 usa em trigger de imutabilidade de
-- `etiqueta_impressoes`. Em produção o update/delete nessa tabela é sempre
-- recusado, e o cenário da RPC precisa desse mesmo chão.
create or replace function public.fn_bloquear_alteracao() returns trigger
  language plpgsql as $$
begin
  raise exception 'Tabela % é imutável (append-only).', tg_table_name;
end $$;

drop trigger if exists trg_etiqueta_impressoes_imutavel on etiqueta_impressoes;
create trigger trg_etiqueta_impressoes_imutavel
  before update or delete on etiqueta_impressoes
  for each statement execute function public.fn_bloquear_alteracao();

-- Dublês das funções de permissão que a RPC usa. Os cenários controlam o
-- retorno por `req.*`, sem precisar montar RLS.
create or replace function public.empresas_permitidas() returns setof uuid
  language sql stable as $$ select id from empresas
    where coalesce(current_setting('req.empresa_bloqueada', true), '') <> id::text $$;
create or replace function public.tem_permissao(m text) returns boolean
  language sql stable as $$
  select coalesce(current_setting('req.permissoes', true), 'recebimentos,producoes') like '%' || m || '%' $$;
create or replace function public.fn_nome_usuario() returns text
  language sql stable as $$ select 'Operador de Teste' $$;
create or replace function public.fn_registrar_auditoria(
  p_recurso text, p_recurso_id uuid, p_acao text, p_empresa uuid,
  p_anteriores jsonb, p_novos jsonb, p_justificativa text)
  returns void language sql as $$
  insert into audit_logs (empresa_id, usuario_id, acao, recurso, recurso_id,
                          valores_anteriores, valores_novos, justificativa)
  values (p_empresa, auth.uid(), p_acao, p_recurso, p_recurso_id, p_anteriores, p_novos, p_justificativa) $$;

-- A RPC como a atualização 28 a deixou: sem o ramo `embalagem_item`. Prova
-- que é a 30 quem acrescenta o ramo, não o fixture.
create or replace function public.registrar_impressao(
  p_source_type text, p_source_id uuid, p_tipo text, p_quantidade int,
  p_modelo text default 'validade-cozinha', p_impressora text default null, p_motivo text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  raise exception 'versão 28 da RPC: source_type inválido: %', p_source_type;
end $$;

-- ---------- A MINA ----------
-- A versão do trigger que está em produção hoje (atualização 10), lendo
-- `recebimento_itens.status_recebimento` — coluna que a tabela acima NÃO tem.
-- Nunca rodou porque a tela de embalagem nunca existiu: o primeiro item salvo
-- pela tela nova estouraria 42703. O cenário 2 prova que a migração 30 desarma
-- isso derrubando o trigger, e não contornando.
create or replace function public.trigger_embalagem_para_producao()
returns trigger language plpgsql as $function$
declare
  v_producao_id uuid;
  v_produto_id uuid := new.produto_id;
  v_quantidade numeric(12,3) := new.quantidade;
  v_embalagem_id uuid := new.embalagem_id;
  v_data date;
  v_empresa_id uuid;
  v_custo_total numeric(12,2);
  v_custo_mp numeric(12,2);
begin
  select data, empresa_id into v_data, v_empresa_id from embalagens where id = v_embalagem_id;

  select coalesce(sum(r.quantidade * r.custo_unitario) / nullif(sum(r.quantidade), 0), 0) into v_custo_mp
    from recebimento_itens r
    join ficha_tecnica ft on ft.materia_prima_id = r.materia_prima_id
    where ft.produto_id = v_produto_id and r.empresa_id = v_empresa_id
      and r.status_recebimento in ('Aceito', 'Aceito com ressalva');

  v_custo_total := v_quantidade * v_custo_mp;

  select id into v_producao_id from producoes
    where produto_id = v_produto_id and data = v_data and origem = 'embalagem' and empresa_id = v_empresa_id
    limit 1;

  if v_producao_id is not null then
    update producoes set quantidade = quantidade + v_quantidade, custo_total = custo_total + v_custo_total
      where id = v_producao_id;
  else
    insert into producoes (lote, data, produto_id, quantidade, custo_total, origem, empresa_id)
    values ('EMBALAGEM-' || to_char(v_data, 'DD/MM/YY') || '-' || substring(gen_random_uuid()::text, 1, 3),
      v_data, v_produto_id, v_quantidade, v_custo_total, 'embalagem', v_empresa_id);
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_embalagem_items_to_producao on embalagem_itens;
create trigger trg_embalagem_items_to_producao
  after insert on embalagem_itens
  for each row execute function public.trigger_embalagem_para_producao();

-- ---------- DADOS ----------

insert into empresas (id, nome) values
  ('11111111-1111-1111-1111-111111111111', 'Food Services'),
  ('99999999-9999-9999-9999-999999999999', 'Steakhouse');

insert into funcionarios (id, empresa_id, nome) values
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Embalador Teste');

insert into materias_primas (id, empresa_id, nome) values
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'Costela Bovina'),
  ('34343434-3434-3434-3434-343434343434', '11111111-1111-1111-1111-111111111111', 'Tempero Seco'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '99999999-9999-9999-9999-999999999999', 'Picanha');

insert into produtos (id, codigo, nome, empresa_id) values
  ('44444444-4444-4444-4444-444444444444', '0364-001', 'Costela Defumada 500g', '11111111-1111-1111-1111-111111111111'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '0364-002', 'Costela Defumada 1kg', '11111111-1111-1111-1111-111111111111');

-- Ficha técnica REALISTA e, de propósito, incoerente com o peso que os cenários
-- embalam: 0,6 kg de costela crua por unidade de 500 g (a defumação perde peso),
-- mais um tempero. Duas coisas dependem desses números:
--
--   • 50 unidades × 0,6 kg = 30 kg, e o cenário 4 embala 23,4 kg. Enquanto a
--     ficha técnica batia com o peso embalado (era 0,5 kg/un para 25 kg), trocar
--     `peso × custo` por `unidades × ficha_tecnica × custo` dava o MESMO
--     resultado e o cenário não distinguia as fórmulas.
--   • O tempero é caro (R$ 80,00/kg) e está na ficha técnica do produto A. Se o
--     custo voltar a ser média ponderada das matérias-primas da ficha técnica,
--     em vez de vir do lote declarado no item, o número do cenário 4 muda na
--     hora. `ficha_tecnica` NÃO é consultada pelo trigger novo — este tempero
--     está aqui exatamente para provar isso.
insert into ficha_tecnica (produto_id, materia_prima_id, quantidade, empresa_id) values
  ('44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333', 0.6, '11111111-1111-1111-1111-111111111111'),
  ('44444444-4444-4444-4444-444444444444', '34343434-3434-3434-3434-343434343434', 0.02, '11111111-1111-1111-1111-111111111111'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '33333333-3333-3333-3333-333333333333', 1.2, '11111111-1111-1111-1111-111111111111');

insert into recebimentos (id, empresa_id) values
  ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '99999999-9999-9999-9999-999999999999');

-- ---------- OS LOTES E O QUE ELES RENDERAM ----------
-- O custo do produto embalado vem do LOTE de origem e do RENDIMENTO real da
-- defumação daquele lote (atualização 30). Os números abaixo são escolhidos
-- para que cada regra da conta tenha um jeito de falhar visível.

-- LOTE A — aprovado, R$ 21,90/kg, 200 kg recebidos.
insert into recebimento_itens (id, recebimento_id, materia_prima_id, lote, quantidade, custo_unitario, volumes, empresa_id)
  values ('66666666-6666-6666-6666-666666666666', '55555555-5555-5555-5555-555555555555',
          '33333333-3333-3333-3333-333333333333', 'LT-260822-001', 200, 21.90, 20,
          '11111111-1111-1111-1111-111111111111');

-- LOTE REJEITADO, da mesma matéria-prima e caríssimo. O cenário 4 tenta
-- finalizar uma ficha que o consome e exige recusa: é o que torna a leitura de
-- `inspecoes_qualidade` discriminante.
insert into recebimento_itens (id, recebimento_id, materia_prima_id, lote, quantidade, custo_unitario, empresa_id)
  values ('67676767-6767-6767-6767-676767676767', '55555555-5555-5555-5555-555555555555',
          '33333333-3333-3333-3333-333333333333', 'LT-260822-002', 20, 100.00,
          '11111111-1111-1111-1111-111111111111');

-- LOTE C — aprovado, R$ 30,00/kg e rendimento DIFERENTE do lote A. O cenário 4
-- embala os dois na mesma ficha: se o custo voltar a ser uma média por produto,
-- em vez de item a item pelo lote de cada um, o número muda.
insert into recebimento_itens (id, recebimento_id, materia_prima_id, lote, quantidade, custo_unitario, empresa_id)
  values ('68686868-6868-6868-6868-686868686868', '55555555-5555-5555-5555-555555555555',
          '33333333-3333-3333-3333-333333333333', 'LT-260822-003', 100, 30.00,
          '11111111-1111-1111-1111-111111111111');

-- LOTE D — aprovado, mas cuja única defumação está em RASCUNHO: não tem
-- rendimento utilizável. O cenário 4 exige que finalizar embalagem dele seja
-- recusado.
insert into recebimento_itens (id, recebimento_id, materia_prima_id, lote, quantidade, custo_unitario, empresa_id)
  values ('69696969-6969-6969-6969-696969696969', '55555555-5555-5555-5555-555555555555',
          '33333333-3333-3333-3333-333333333333', 'LT-260822-004', 50, 40.00,
          '11111111-1111-1111-1111-111111111111');

-- LOTE DE TEMPERO — aprovado e caro, ligado ao produto A pela ficha técnica.
-- Nenhum item de embalagem aponta para ele: se o custo voltar a somar as
-- matérias-primas da ficha técnica, este lote entra na conta e o cenário 4
-- acusa.
insert into recebimento_itens (id, recebimento_id, materia_prima_id, lote, quantidade, custo_unitario, empresa_id)
  values ('6a6a6a6a-6a6a-6a6a-6a6a-6a6a6a6a6a6a', '55555555-5555-5555-5555-555555555555',
          '34343434-3434-3434-3434-343434343434', 'LT-260822-005', 500, 80.00,
          '11111111-1111-1111-1111-111111111111');

-- Lote de OUTRA empresa, para o cenário 8b.
insert into recebimento_itens (id, recebimento_id, materia_prima_id, lote, quantidade, custo_unitario, empresa_id)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'LT-260822-001', 50, 10.00,
          '99999999-9999-9999-9999-999999999999');

insert into inspecoes_qualidade (recebimento_item_id, empresa_id, status) values
  ('66666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111', 'aprovado'),
  ('67676767-6767-6767-6767-676767676767', '11111111-1111-1111-1111-111111111111', 'rejeitado'),
  ('68686868-6868-6868-6868-686868686868', '11111111-1111-1111-1111-111111111111', 'aprovado'),
  ('69696969-6969-6969-6969-696969696969', '11111111-1111-1111-1111-111111111111', 'aprovado'),
  ('6a6a6a6a-6a6a-6a6a-6a6a-6a6a6a6a6a6a', '11111111-1111-1111-1111-111111111111', 'aprovado'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '99999999-9999-9999-9999-999999999999', 'aprovado');

-- O lote A foi ao defumador em DUAS fornadas finalizadas, com rendimentos
-- diferentes (0,50 e 0,3875), e uma terceira ainda em rascunho:
--   agregado das finalizadas = (50 + 31) ÷ (100 + 80) = 81 ÷ 180 = 0,45
--   só a primeira fornada    = 50 ÷ 100                        = 0,50
--   contando o rascunho      = 101 ÷ 200                       = 0,505
-- Os três números são diferentes de propósito: só quem agrega as finalizadas —
-- e só elas — chega no custo que o cenário 4 exige.
insert into defumacoes (id, lote, responsavel_id, empresa_id, status) values
  ('88888888-8888-8888-8888-888888888888', 'DEF-260822-001',
   '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'finalizada'),
  ('89898989-8989-8989-8989-898989898989', 'DEF-260822-002',
   '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'finalizada'),
  ('8a8a8a8a-8a8a-8a8a-8a8a-8a8a8a8a8a8a', 'DEF-260822-003',
   '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'rascunho'),
  ('8b8b8b8b-8b8b-8b8b-8b8b-8b8b8b8b8b8b', 'DEF-260822-004',
   '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'finalizada'),
  ('8c8c8c8c-8c8c-8c8c-8c8c-8c8c8c8c8c8c', 'DEF-260822-005',
   '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'rascunho'),
  ('8d8d8d8d-8d8d-8d8d-8d8d-8d8d8d8d8d8d', 'DEF-260822-006',
   '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'finalizada');

insert into defumacao_itens (defumacao_id, materia_prima_id, recebimento_item_id, peso_bruto_kg, peso_final_kg, empresa_id) values
  -- Lote A, fornadas finalizadas.
  ('88888888-8888-8888-8888-888888888888', '33333333-3333-3333-3333-333333333333',
   '66666666-6666-6666-6666-666666666666', 100, 50, '11111111-1111-1111-1111-111111111111'),
  ('89898989-8989-8989-8989-898989898989', '33333333-3333-3333-3333-333333333333',
   '66666666-6666-6666-6666-666666666666', 80, 31, '11111111-1111-1111-1111-111111111111'),
  -- Lote A, fornada em rascunho: peso ainda pode mudar, não conta.
  ('8a8a8a8a-8a8a-8a8a-8a8a-8a8a8a8a8a8a', '33333333-3333-3333-3333-333333333333',
   '66666666-6666-6666-6666-666666666666', 20, 20, '11111111-1111-1111-1111-111111111111'),
  -- Lote C: rendimento 0,60.
  ('8b8b8b8b-8b8b-8b8b-8b8b-8b8b8b8b8b8b', '33333333-3333-3333-3333-333333333333',
   '68686868-6868-6868-6868-686868686868', 100, 60, '11111111-1111-1111-1111-111111111111'),
  -- Lote D: só rascunho, então não tem rendimento nenhum utilizável.
  ('8c8c8c8c-8c8c-8c8c-8c8c-8c8c8c8c8c8c', '33333333-3333-3333-3333-333333333333',
   '69696969-6969-6969-6969-696969696969', 50, 25, '11111111-1111-1111-1111-111111111111'),
  -- Lote REJEITADO, com defumação finalizada e rendimento perfeitamente
  -- utilizável (0,45). Parece contraditório — lote reprovado não deveria ir ao
  -- defumador —, e está aqui exatamente por isso: sem esta fornada, a ficha do
  -- cenário 4b seria recusada por FALTA DE RENDIMENTO, e o cenário passaria
  -- verde mesmo que a recusa por inspeção reprovada fosse removida do trigger.
  -- Com ela, a única coisa que impede aquela ficha de finalizar é a inspeção.
  ('8d8d8d8d-8d8d-8d8d-8d8d-8d8d8d8d8d8d', '33333333-3333-3333-3333-333333333333',
   '67676767-6767-6767-6767-676767676767', 20, 9, '11111111-1111-1111-1111-111111111111');

-- Ficha de embalagem LEGADA, anterior à 30: sem status, sem lote de origem no
-- item, sem validade. Prova que a migração não quebra o que já está lançado.
insert into embalagens (id, lote, responsavel_id, empresa_id)
  values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'EMB-LEGADO-001',
          '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111');

-- O trigger antigo dispara `after insert` neste item e leria a coluna morta:
-- desativado só para poder semear a ficha legada. Fora deste bloco o trigger
-- fica de pé, exatamente como está em produção — é o cenário 2 que prova que a
-- migração o derruba.
alter table embalagem_itens disable trigger trg_embalagem_items_to_producao;
insert into embalagem_itens (embalagem_id, produto_id, quantidade, peso_total_kg, empresa_id)
  values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '44444444-4444-4444-4444-444444444444',
          40, 20, '11111111-1111-1111-1111-111111111111');
alter table embalagem_itens enable trigger trg_embalagem_items_to_producao;

-- Linha de produção anterior à 30, com `origem = 'embalagem'` e sem
-- `embalagem_id`: o cancelamento do cenário 5 não pode encostar nela.
insert into producoes (lote, produto_id, quantidade, custo_total, origem, empresa_id)
  values ('EMBALAGEM-20/08/26-abc', '44444444-4444-4444-4444-444444444444', 40, 438.00,
          'embalagem', '11111111-1111-1111-1111-111111111111');
