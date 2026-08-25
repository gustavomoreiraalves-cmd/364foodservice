-- =========================================================
-- Atualização 35 — Conciliação bancária
--
-- O financeiro registra conta a pagar e baixa parcela, mas nada prova que o
-- que saiu do banco é o que foi lançado. Esta migração traz o extrato para
-- dentro do sistema: cada arquivo importado (extrato ou fatura de cartão)
-- vira uma linha em extrato_importacoes, cada linha do arquivo vira um
-- extrato_lancamentos, e a associação com as parcelas do contas a pagar vive
-- em conciliacao_vinculos (N:N — um débito às vezes paga vários boletos).
--
-- conciliacao_padroes é o aprendizado: a cada confirmação do colaborador,
-- a descrição normalizada do extrato passa a apontar para um fornecedor e
-- uma categoria, e a importação seguinte já chega sugerida.
--
-- Nesta fase só as saídas são conciliadas; entradas entram com status
-- 'ignorado' para ficarem visíveis sem cobrar trabalho de ninguém.
--
-- Rode depois de atualizacao_34_pdv_margem_larga.sql. Idempotente.
-- =========================================================
begin;

-- ---------- CONTAS BANCÁRIAS ----------
-- Cadastro que não existia. Cartão de crédito é conta de tipo próprio: a
-- fatura importa contra ela, e o pagamento da fatura aparece na conta
-- corrente como uma única saída.
create table if not exists public.contas_bancarias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  nome text not null,
  instituicao text not null,
  tipo text not null check (tipo in ('conta_corrente','cartao_credito')),
  agencia text,
  numero_conta text,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists contas_bancarias_empresa_id_idx
  on public.contas_bancarias(empresa_id);

alter table public.contas_bancarias enable row level security;
drop policy if exists "empresa_scoped_access" on public.contas_bancarias;
create policy "empresa_scoped_access" on public.contas_bancarias for all
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()))
  with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

-- ---------- IMPORTAÇÕES ----------
-- Um registro por arquivo. Espelha pdv_importacoes: status do job, contadores
-- e a mensagem de erro ficam aqui para a tela poder explicar o que aconteceu.
create table if not exists public.extrato_importacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  conta_bancaria_id uuid not null references public.contas_bancarias(id),
  tipo text not null check (tipo in ('extrato','fatura_cartao')),
  arquivo_path text not null,
  arquivo_nome text,
  formato text not null check (formato in ('pdf','ofx','csv')),
  periodo_inicio date,
  periodo_fim date,
  status text not null default 'processando'
    check (status in ('processando','aguardando_conciliacao','concluida','erro')),
  total_lancamentos int not null default 0,
  conciliados int not null default 0,
  alerta text,
  erro text,
  created_at timestamptz not null default now()
);
create index if not exists extrato_importacoes_empresa_id_idx
  on public.extrato_importacoes(empresa_id);
create index if not exists extrato_importacoes_conta_idx
  on public.extrato_importacoes(conta_bancaria_id);

alter table public.extrato_importacoes enable row level security;
drop policy if exists "empresa_scoped_access" on public.extrato_importacoes;
create policy "empresa_scoped_access" on public.extrato_importacoes for all
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()))
  with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

-- ---------- PADRÕES (o aprendizado) ----------
-- Criada antes de extrato_lancamentos porque este referencia padrao_id.
-- Chave é a descrição normalizada: "PIX ENVIADO BOI FORTE" aprende o
-- fornecedor uma vez e sugere para sempre. Sem ML — de-para, no espírito
-- de lib/nfe/dePara.js.
create table if not exists public.conciliacao_padroes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  padrao text not null,
  fornecedor_id uuid references public.fornecedores(id),
  categoria_conta text,
  usos int not null default 1,
  ultimo_uso timestamptz default now(),
  created_at timestamptz not null default now(),
  unique (empresa_id, padrao)
);

alter table public.conciliacao_padroes enable row level security;
drop policy if exists "empresa_scoped_access" on public.conciliacao_padroes;
create policy "empresa_scoped_access" on public.conciliacao_padroes for all
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()))
  with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

-- ---------- LANÇAMENTOS ----------
-- valor é sempre positivo; o sinal vive em tipo. hash_dedupe é a identidade
-- do lançamento: reimportar o mesmo período não duplica linha.
-- parcela_sugerida_id é sugestão do motor, não vínculo — o vínculo só nasce
-- quando o colaborador confirma.
create table if not exists public.extrato_lancamentos (
  id uuid primary key default gen_random_uuid(),
  importacao_id uuid not null references public.extrato_importacoes(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id),
  data date not null,
  descricao text not null,
  descricao_normalizada text not null,
  valor numeric(12,2) not null,
  tipo text not null check (tipo in ('saida','entrada')),
  documento text,
  hash_dedupe text not null,
  status text not null default 'pendente'
    check (status in ('pendente','sugerido','conciliado','ignorado')),
  parcela_sugerida_id uuid references public.contas_a_pagar_parcelas(id) on delete set null,
  padrao_id uuid references public.conciliacao_padroes(id) on delete set null,
  fatura_id uuid references public.extrato_importacoes(id) on delete set null,
  conta_criada_id uuid references public.contas_a_pagar(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (empresa_id, hash_dedupe)
);
create index if not exists extrato_lancamentos_importacao_idx
  on public.extrato_lancamentos(importacao_id);
create index if not exists extrato_lancamentos_empresa_status_idx
  on public.extrato_lancamentos(empresa_id, status);
create index if not exists extrato_lancamentos_fatura_idx
  on public.extrato_lancamentos(fatura_id);

alter table public.extrato_lancamentos enable row level security;
drop policy if exists "empresa_scoped_access" on public.extrato_lancamentos;
create policy "empresa_scoped_access" on public.extrato_lancamentos for all
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()))
  with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

-- ---------- VÍNCULOS ----------
-- N:N porque um débito único às vezes paga dois ou três boletos do mesmo
-- fornecedor. baixou_parcela guarda se foi esta conciliação que baixou a
-- parcela — é o que permite desfazer sem reabrir parcela que já estava paga
-- antes (ex.: linha de fatura de cartão, que concilia mas não baixa).
create table if not exists public.conciliacao_vinculos (
  id uuid primary key default gen_random_uuid(),
  lancamento_id uuid not null references public.extrato_lancamentos(id) on delete cascade,
  parcela_id uuid not null references public.contas_a_pagar_parcelas(id) on delete cascade,
  valor_aplicado numeric(12,2) not null,
  baixou_parcela boolean not null default false,
  empresa_id uuid not null references public.empresas(id),
  created_at timestamptz not null default now(),
  unique (lancamento_id, parcela_id)
);
create index if not exists conciliacao_vinculos_lancamento_idx
  on public.conciliacao_vinculos(lancamento_id);
create index if not exists conciliacao_vinculos_parcela_idx
  on public.conciliacao_vinculos(parcela_id);

alter table public.conciliacao_vinculos enable row level security;
drop policy if exists "empresa_scoped_access" on public.conciliacao_vinculos;
create policy "empresa_scoped_access" on public.conciliacao_vinculos for all
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()))
  with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

-- ---------- BUCKET ----------
-- O bucket 'recebimentos' foi criado com allowed_mime_types restrito (PDF,
-- imagens e, desde a atualização 25, XML). O extrato em OFX e em CSV bate em
-- "mime type is not supported" e o upload falha. Libera os dois aqui, mantendo
-- a lista anterior inteira. O catch-all 'application/octet-stream' fica de
-- fora de propósito: a rota de upload sempre define o contentType explícito
-- (application/x-ofx, text/csv ou application/pdf), e um catch-all só
-- alargaria o que qualquer usuário autenticado pode gravar no bucket sem
-- servir a nenhum caso real.
--
-- O guard existe porque o schema storage só existe no Supabase: o teste local
-- (tests/migracao-35/) roda esta mesma migração num Postgres cru.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets
       set allowed_mime_types = array[
             'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic',
             'application/xml', 'text/xml',
             'application/x-ofx', 'text/csv', 'text/plain'
           ]
     where id = 'recebimentos';
  end if;
end $$;

-- ---------- FUNÇÕES DE CONCILIAÇÃO ----------
-- Por que função no banco e não código na rota: conciliar mexe em três
-- tabelas (vínculo, parcela, padrão) e não pode ficar pela metade se cair no
-- meio. Aqui é uma transação só. As rotas chamam por RPC.
--
-- Todas rodam como security invoker (default): a rota usa service role e já
-- conferiu a empresa com garantirEmpresa(), e as funções revalidam a empresa
-- de cada id que recebem de fora (parcela, fatura, fornecedor, responsável)
-- contra a do lançamento — nenhum deles é confiado só porque veio no corpo
-- da requisição.

-- Recalcula contadores e status da importação. Uma importação está concluída
-- quando não sobra saída pendente nem sugerida.
--
-- total_lancamentos conta SAÍDAS, não todas as linhas: a tela exibe
-- conciliados/total_lancamentos como "quanto falta", e conciliados só conta
-- saídas (entradas estão fora da conciliação nesta fase). Contando as duas
-- pontas em populações diferentes, um extrato inteiramente conciliado exibia
-- "12/40" ao lado da tag verde "Conciliada" — a razão nunca podia chegar a 1.
create or replace function public.fn_recalcular_importacao(p_importacao_id uuid)
returns void language plpgsql as $$
declare v_total int; v_conciliados int; v_abertos int;
begin
  select count(*) filter (where tipo = 'saida'),
         count(*) filter (where tipo = 'saida' and status = 'conciliado'),
         count(*) filter (where tipo = 'saida' and status in ('pendente','sugerido'))
    into v_total, v_conciliados, v_abertos
    from public.extrato_lancamentos where importacao_id = p_importacao_id;

  update public.extrato_importacoes
     set total_lancamentos = coalesce(v_total, 0),
         conciliados = coalesce(v_conciliados, 0),
         status = case when status = 'erro' then 'erro'
                       when coalesce(v_abertos, 0) = 0 then 'concluida'
                       else 'aguardando_conciliacao' end
   where id = p_importacao_id;
end $$;

-- Grava o aprendizado. Mesmo fornecedor: soma um uso. Fornecedor diferente:
-- sobrescreve e volta a 1 — a última confirmação do colaborador é a verdade.
-- Fornecedor de outra empresa é ignorado, mesmo tratamento do fornecedor
-- nulo: esta função só alimenta uma sugestão futura, não grava obrigação
-- financeira nenhuma, e ela é chamada de dentro de fn_conciliar_lancamento e
-- fn_criar_conta_e_conciliar — levantar exceção aqui abortaria a
-- conciliação inteira por causa de um id que só serve de dica. Quem faz
-- valer a fronteira de empresa de verdade, com exceção, é
-- fn_criar_conta_e_conciliar (grava a obrigação) e a checagem de parcela em
-- fn_conciliar_lancamento (baixa a obrigação existente).
create or replace function public.fn_registrar_padrao(
  p_empresa_id uuid, p_padrao text, p_fornecedor_id uuid, p_categoria_conta text)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  if p_fornecedor_id is null or coalesce(trim(p_padrao), '') = '' then return null; end if;
  if not exists (select 1 from public.fornecedores
                  where id = p_fornecedor_id and empresa_id = p_empresa_id) then
    -- Só ESTE ramo avisa. Fornecedor nulo (acima) é o caso normal de quem
    -- concilia sem informar fornecedor e tem que continuar silencioso; já um
    -- fornecedor que existe mas é de outra empresa é sempre bug de chamador
    -- ou tentativa de atravessar a fronteira, e sem rastro nenhum some.
    raise warning 'fn_registrar_padrao: fornecedor % não pertence à empresa % — padrão "%" não foi aprendido.',
      p_fornecedor_id, p_empresa_id, p_padrao;
    return null;
  end if;
  insert into public.conciliacao_padroes
    (empresa_id, padrao, fornecedor_id, categoria_conta, usos, ultimo_uso)
    values (p_empresa_id, p_padrao, p_fornecedor_id, p_categoria_conta, 1, now())
  on conflict (empresa_id, padrao) do update
    set fornecedor_id = excluded.fornecedor_id,
        categoria_conta = coalesce(excluded.categoria_conta, public.conciliacao_padroes.categoria_conta),
        usos = case when public.conciliacao_padroes.fornecedor_id = excluded.fornecedor_id
                    then public.conciliacao_padroes.usos + 1 else 1 end,
        ultimo_uso = now()
  returning id into v_id;
  return v_id;
end $$;

-- Concilia um lançamento com uma ou mais parcelas.
-- p_parcelas: [{"parcela_id":"<uuid>","valor_aplicado":123.45}, ...]
-- Parcela ainda Pendente é baixada (baixou_parcela = true). Parcela já Paga é
-- só vinculada — inclusive o caso da linha de fatura de cartão, que espera o
-- pagamento da fatura para baixar.
create or replace function public.fn_conciliar_lancamento(
  p_lancamento_id uuid,
  p_parcelas jsonb,
  p_forma_pagamento text default null,
  p_fornecedor_id uuid default null,
  p_categoria_conta text default null)
returns jsonb language plpgsql as $$
declare
  v_lanc record; v_parc record; v_item jsonb;
  v_baixou boolean; v_padrao_id uuid; v_baixadas int := 0; v_vinculadas int := 0;
  v_ehFatura boolean; v_outro record;
begin
  select * into v_lanc from public.extrato_lancamentos where id = p_lancamento_id for update;
  if v_lanc is null then raise exception 'Lançamento não encontrado.'; end if;
  if v_lanc.tipo <> 'saida' then
    raise exception 'Só saídas são conciliadas nesta fase (este lançamento é uma entrada).';
  end if;
  if v_lanc.status = 'conciliado' then
    raise exception 'Este lançamento já está conciliado. Desfaça antes de conciliar de novo.';
  end if;
  if p_parcelas is null or jsonb_array_length(p_parcelas) = 0 then
    raise exception 'Informe pelo menos uma parcela.';
  end if;

  -- Linha de fatura de cartão não baixa parcela: a compra ainda não saiu do
  -- caixa. Quem baixa é fn_conciliar_pagamento_fatura.
  select tipo = 'fatura_cartao' into v_ehFatura
    from public.extrato_importacoes where id = v_lanc.importacao_id;

  for v_item in select * from jsonb_array_elements(p_parcelas) loop
    select * into v_parc from public.contas_a_pagar_parcelas
      where id = (v_item->>'parcela_id')::uuid for update;
    if v_parc is null then raise exception 'Parcela % não encontrada.', v_item->>'parcela_id'; end if;
    if v_parc.empresa_id <> v_lanc.empresa_id then
      raise exception 'Parcela de outra empresa não pode ser conciliada aqui.';
    end if;

    -- Uma parcela é uma obrigação só: se outro lançamento já a reivindica,
    -- conciliar esta aqui contabilizaria duas saídas reais do banco contra a
    -- mesma dívida. O unique de conciliacao_vinculos é (lancamento_id,
    -- parcela_id) e não impede isso, e o status da parcela também não: a linha
    -- de fatura de cartão concilia deixando a parcela 'Pendente' de propósito,
    -- que é exatamente o estado que a devolve para o pool de sugestões da
    -- importação seguinte.
    select l.id, l.descricao, l.data into v_outro
      from public.conciliacao_vinculos v
      join public.extrato_lancamentos l on l.id = v.lancamento_id
     where v.parcela_id = v_parc.id and v.lancamento_id <> p_lancamento_id
     limit 1;
    if found then
      raise exception 'Esta parcela já está conciliada com o lançamento "%" de %. Desfaça aquela conciliação antes de associar esta.',
        v_outro.descricao, to_char(v_outro.data, 'DD/MM/YYYY');
    end if;

    v_baixou := (v_parc.status = 'Pendente') and not coalesce(v_ehFatura, false);
    if v_baixou then
      update public.contas_a_pagar_parcelas
         set status = 'Pago', data_pagamento = v_lanc.data,
             forma_pagamento = coalesce(p_forma_pagamento, forma_pagamento)
       where id = v_parc.id;
      v_baixadas := v_baixadas + 1;
    end if;

    insert into public.conciliacao_vinculos
      (lancamento_id, parcela_id, valor_aplicado, baixou_parcela, empresa_id)
      values (p_lancamento_id, v_parc.id,
              coalesce((v_item->>'valor_aplicado')::numeric, v_parc.valor),
              v_baixou, v_lanc.empresa_id)
    on conflict (lancamento_id, parcela_id) do nothing;
    v_vinculadas := v_vinculadas + 1;
  end loop;

  v_padrao_id := public.fn_registrar_padrao(v_lanc.empresa_id, v_lanc.descricao_normalizada,
                                            p_fornecedor_id, p_categoria_conta);

  update public.extrato_lancamentos
     set status = 'conciliado', padrao_id = coalesce(v_padrao_id, padrao_id)
   where id = p_lancamento_id;

  perform public.fn_recalcular_importacao(v_lanc.importacao_id);
  return jsonb_build_object('vinculadas', v_vinculadas, 'baixadas', v_baixadas);
end $$;

-- Saída sem conta a pagar: cria conta + parcela única + vínculo, e guarda a
-- conta em conta_criada_id para o desfazer poder apagá-la.
-- Fornecedor e responsável chegam da requisição, então revalida os dois
-- contra a empresa do lançamento antes de gravar — senão a conta a pagar
-- nasceria com FK apontando para o cadastro de outra empresa do grupo.
--
-- A parcela nasce paga no extrato bancário (o dinheiro saiu na data do
-- lançamento) e ABERTA na fatura de cartão — mesma regra de
-- fn_conciliar_lancamento, e o caminho MAIS usado dela: a compra do cartão
-- quase nunca tem conta a pagar prévia, então é por aqui que ela entra. O
-- dinheiro da compra ainda não saiu do banco; quem baixa é
-- fn_conciliar_pagamento_fatura, quando o débito da fatura aparecer no extrato
-- da conta corrente. Sem essa distinção a mesma despesa era contada duas vezes.
create or replace function public.fn_criar_conta_e_conciliar(
  p_lancamento_id uuid,
  p_descricao text,
  p_categoria_conta text,
  p_fornecedor_id uuid,
  p_responsavel_id uuid default null,
  p_forma_pagamento text default null)
returns jsonb language plpgsql as $$
declare
  v_lanc record; v_conta_id uuid; v_parcela_id uuid; v_padrao_id uuid;
  v_ehFatura boolean;
begin
  select * into v_lanc from public.extrato_lancamentos where id = p_lancamento_id for update;
  if v_lanc is null then raise exception 'Lançamento não encontrado.'; end if;
  if v_lanc.tipo <> 'saida' then raise exception 'Só saídas viram conta a pagar aqui.'; end if;
  if v_lanc.status = 'conciliado' then raise exception 'Este lançamento já está conciliado.'; end if;
  if p_fornecedor_id is null then raise exception 'Escolha o fornecedor.'; end if;
  if not exists (select 1 from public.fornecedores
                  where id = p_fornecedor_id and empresa_id = v_lanc.empresa_id) then
    raise exception 'Fornecedor de outra empresa.';
  end if;
  if p_responsavel_id is not null and not exists (
       select 1 from public.funcionarios
        where id = p_responsavel_id and empresa_id = v_lanc.empresa_id) then
    raise exception 'Responsável de outra empresa.';
  end if;

  select tipo = 'fatura_cartao' into v_ehFatura
    from public.extrato_importacoes where id = v_lanc.importacao_id;

  insert into public.contas_a_pagar
    (descricao, categoria_conta, fornecedor_id, valor_total, responsavel_id, empresa_id)
    values (coalesce(nullif(trim(p_descricao), ''), v_lanc.descricao), p_categoria_conta,
            p_fornecedor_id, v_lanc.valor, p_responsavel_id, v_lanc.empresa_id)
    returning id into v_conta_id;

  -- vencimento é sempre a data do lançamento (a data da compra, na fatura);
  -- o que muda é se ela já nasce baixada.
  insert into public.contas_a_pagar_parcelas
    (conta_a_pagar_id, numero, valor, vencimento, status, data_pagamento, forma_pagamento, empresa_id)
    values (v_conta_id, 1, v_lanc.valor, v_lanc.data,
            case when coalesce(v_ehFatura, false) then 'Pendente' else 'Pago' end,
            case when coalesce(v_ehFatura, false) then null else v_lanc.data end,
            case when coalesce(v_ehFatura, false) then null else p_forma_pagamento end,
            v_lanc.empresa_id)
    returning id into v_parcela_id;

  insert into public.conciliacao_vinculos
    (lancamento_id, parcela_id, valor_aplicado, baixou_parcela, empresa_id)
    values (p_lancamento_id, v_parcela_id, v_lanc.valor,
            not coalesce(v_ehFatura, false), v_lanc.empresa_id);

  v_padrao_id := public.fn_registrar_padrao(v_lanc.empresa_id, v_lanc.descricao_normalizada,
                                            p_fornecedor_id, p_categoria_conta);

  update public.extrato_lancamentos
     set status = 'conciliado', conta_criada_id = v_conta_id,
         padrao_id = coalesce(v_padrao_id, padrao_id)
   where id = p_lancamento_id;

  perform public.fn_recalcular_importacao(v_lanc.importacao_id);
  return jsonb_build_object('conta_id', v_conta_id, 'parcela_id', v_parcela_id);
end $$;

-- Desfaz: reabre só as parcelas que esta conciliação baixou, apaga os
-- vínculos e, se a conta a pagar nasceu daqui, apaga a conta (o cascade
-- limpa parcela e vínculo). Se o lançamento é o pagamento de uma fatura (tem
-- fatura_id), ele não tem vínculo próprio — quem baixou as parcelas foi
-- fn_conciliar_pagamento_fatura nos vínculos das LINHAS da fatura. Aqui a
-- gente reabre só as parcelas que aquele pagamento baixou e devolve
-- baixou_parcela a false nesses vínculos, sem apagá-los: a compra continua
-- conciliada, só o pagamento é desfeito.
create or replace function public.fn_desfazer_conciliacao(p_lancamento_id uuid)
returns jsonb language plpgsql as $$
declare v_lanc record; v_reabertas int := 0; v_fatura_reabertas int := 0;
begin
  select * into v_lanc from public.extrato_lancamentos where id = p_lancamento_id for update;
  if v_lanc is null then raise exception 'Lançamento não encontrado.'; end if;

  -- Desfazer uma COMPRA cuja fatura já foi paga deixaria a parcela órfã: o
  -- vínculo some, a parcela reabre, e o lançamento do pagamento continua
  -- conciliado — e ele nunca roda de novo. Reconciliar a mesma compra criaria
  -- um vínculo com baixou_parcela = false, e a parcela ficaria 'Pendente' para
  -- sempre, apesar de a fatura ter sido paga. A ordem certa é desfazer o
  -- pagamento primeiro; o cenário 21 prova as duas pontas.
  if exists (select 1 from public.extrato_lancamentos pagamento
              where pagamento.fatura_id = v_lanc.importacao_id
                and pagamento.status = 'conciliado'
                and pagamento.id <> p_lancamento_id) then
    raise exception 'Esta compra está numa fatura cujo pagamento já foi conciliado no extrato. Desfaça primeiro o pagamento da fatura, depois esta linha.';
  end if;

  update public.contas_a_pagar_parcelas p
     set status = 'Pendente', data_pagamento = null, forma_pagamento = null
   where p.id in (select v.parcela_id from public.conciliacao_vinculos v
                   where v.lancamento_id = p_lancamento_id and v.baixou_parcela);
  get diagnostics v_reabertas = row_count;

  delete from public.conciliacao_vinculos where lancamento_id = p_lancamento_id;

  if v_lanc.conta_criada_id is not null then
    delete from public.contas_a_pagar where id = v_lanc.conta_criada_id;
  end if;

  if v_lanc.fatura_id is not null then
    update public.contas_a_pagar_parcelas p
       set status = 'Pendente', data_pagamento = null, forma_pagamento = null
     where p.id in (select v.parcela_id from public.conciliacao_vinculos v
                     join public.extrato_lancamentos l on l.id = v.lancamento_id
                    where l.importacao_id = v_lanc.fatura_id and v.baixou_parcela);
    get diagnostics v_fatura_reabertas = row_count;
    v_reabertas := v_reabertas + v_fatura_reabertas;

    update public.conciliacao_vinculos v
       set baixou_parcela = false
      from public.extrato_lancamentos l
     where l.id = v.lancamento_id
       and l.importacao_id = v_lanc.fatura_id
       and v.baixou_parcela;
  end if;

  update public.extrato_lancamentos
     set status = case when tipo = 'entrada' then 'ignorado'
                       when parcela_sugerida_id is not null then 'sugerido'
                       else 'pendente' end,
         conta_criada_id = null, fatura_id = null
   where id = p_lancamento_id;

  perform public.fn_recalcular_importacao(v_lanc.importacao_id);
  return jsonb_build_object('reabertas', v_reabertas);
end $$;

-- Pagamento da fatura no extrato bancário: baixa em lote todas as parcelas
-- vinculadas às linhas daquela fatura. p_forcar libera o caso de pagamento
-- parcial/rotativo, onde o débito não bate com a soma conciliada.
create or replace function public.fn_conciliar_pagamento_fatura(
  p_lancamento_id uuid, p_fatura_id uuid, p_forcar boolean default false)
returns jsonb language plpgsql as $$
declare
  v_lanc record; v_fatura record; v_soma numeric(12,2);
  v_baixadas int := 0; v_parcela_ids uuid[]; v_outro_pagamento record;
begin
  select * into v_lanc from public.extrato_lancamentos where id = p_lancamento_id for update;
  if v_lanc is null then raise exception 'Lançamento não encontrado.'; end if;
  if v_lanc.tipo <> 'saida' then raise exception 'O pagamento da fatura é uma saída.'; end if;
  if v_lanc.status = 'conciliado' then raise exception 'Este lançamento já está conciliado.'; end if;

  select * into v_fatura from public.extrato_importacoes where id = p_fatura_id;
  if v_fatura is null then raise exception 'Fatura não encontrada.'; end if;
  if v_fatura.tipo <> 'fatura_cartao' then raise exception 'A importação escolhida não é uma fatura.'; end if;
  if v_fatura.empresa_id <> v_lanc.empresa_id then
    raise exception 'Fatura de outra empresa.';
  end if;

  -- Uma fatura é paga uma vez. Sem esta guarda, a segunda saída associada à
  -- mesma fatura não encontrava parcela 'Pendente' nenhuma para baixar,
  -- devolvia baixadas = 0 — que a tela anunciava como "0 parcela(s)
  -- baixada(s)" — e ficava conciliada assim mesmo: uma saída real do banco
  -- contabilizada contra nada. A soma continuava batendo, então nem o aviso de
  -- divergência disparava.
  select * into v_outro_pagamento from public.extrato_lancamentos
   where fatura_id = p_fatura_id and status = 'conciliado' and id <> p_lancamento_id
   limit 1;
  if found then
    raise exception 'Esta fatura já teve o pagamento conciliado no lançamento "%" de %. Desfaça aquele pagamento antes de associar outro.',
      v_outro_pagamento.descricao, to_char(v_outro_pagamento.data, 'DD/MM/YYYY');
  end if;

  select coalesce(sum(v.valor_aplicado), 0) into v_soma
    from public.conciliacao_vinculos v
    join public.extrato_lancamentos l on l.id = v.lancamento_id
   where l.importacao_id = p_fatura_id;

  if v_soma = 0 then
    raise exception 'Nenhuma linha desta fatura foi conciliada ainda — concilie as compras antes de baixar o pagamento.';
  end if;
  if abs(v_soma - v_lanc.valor) > 0.01 and not coalesce(p_forcar, false) then
    raise exception 'O débito de % não bate com a soma conciliada da fatura (%). Confirme para baixar assim mesmo.',
      to_char(v_lanc.valor, 'FM999999990.00'), to_char(v_soma, 'FM999999990.00');
  end if;

  -- Só marca baixou_parcela = true nos vínculos cuja parcela esta chamada
  -- realmente virou Pendente -> Pago agora. Linha de fatura conciliada
  -- contra parcela que já estava Pago antes fica de fora: senão o desfazer
  -- reabriria uma baixa que este pagamento nunca fez (o mesmo erro que o
  -- cenário 8 existe para impedir na conciliação de linha avulsa).
  with baixadas as (
    update public.contas_a_pagar_parcelas p
       set status = 'Pago', data_pagamento = v_lanc.data, forma_pagamento = 'Cartão de Crédito'
     where p.status = 'Pendente'
       and p.id in (select v.parcela_id from public.conciliacao_vinculos v
                     join public.extrato_lancamentos l on l.id = v.lancamento_id
                    where l.importacao_id = p_fatura_id)
    returning p.id
  )
  select count(*), coalesce(array_agg(id), array[]::uuid[])
    into v_baixadas, v_parcela_ids
    from baixadas;

  -- Baixar zero parcela não é sucesso: significa que todas as parcelas
  -- vinculadas às linhas desta fatura já estavam 'Pago' antes deste pagamento
  -- existir. Conciliar assim marcaria uma saída real do banco como resolvida
  -- sem quitar obrigação nenhuma — e a tela ainda diria "0 parcela(s) da
  -- fatura baixada(s)" com a linha ficando verde.
  if v_baixadas = 0 then
    raise exception 'Nenhuma parcela desta fatura ficou por baixar — todas já constavam como pagas. Confira se este débito é mesmo o pagamento desta fatura, ou desfaça as baixas anteriores antes.';
  end if;

  update public.conciliacao_vinculos v
     set baixou_parcela = true
   where v.lancamento_id in (select id from public.extrato_lancamentos where importacao_id = p_fatura_id)
     and v.parcela_id = any(v_parcela_ids);

  update public.extrato_lancamentos
     set status = 'conciliado', fatura_id = p_fatura_id
   where id = p_lancamento_id;

  perform public.fn_recalcular_importacao(v_lanc.importacao_id);
  perform public.fn_recalcular_importacao(p_fatura_id);
  return jsonb_build_object('baixadas', v_baixadas, 'soma_fatura', v_soma);
end $$;

commit;

-- ---------- ROLLBACK ----------
-- begin;
-- drop function if exists public.fn_conciliar_pagamento_fatura(uuid, uuid, boolean);
-- drop function if exists public.fn_desfazer_conciliacao(uuid);
-- drop function if exists public.fn_criar_conta_e_conciliar(uuid, text, text, uuid, uuid, text);
-- drop function if exists public.fn_conciliar_lancamento(uuid, jsonb, text, uuid, text);
-- drop function if exists public.fn_registrar_padrao(uuid, text, uuid, text);
-- drop function if exists public.fn_recalcular_importacao(uuid);
-- drop table if exists public.conciliacao_vinculos;
-- drop table if exists public.extrato_lancamentos;
-- drop table if exists public.conciliacao_padroes;
-- drop table if exists public.extrato_importacoes;
-- drop table if exists public.contas_bancarias;
-- commit;
--
-- O bucket fica FORA do bloco acima de propósito: tests/migracao-35/verificar.sh
-- extrai o rollback por sed entre "-- begin;" e "-- commit;" e roda num Postgres
-- cru, onde o schema storage não existe. Para desfazer a parte do bucket em
-- produção, rode à mão:
--   update storage.buckets set allowed_mime_types = array['application/pdf',
--     'image/jpeg','image/png','image/webp','image/heic','application/xml','text/xml']
--    where id = 'recebimentos';
