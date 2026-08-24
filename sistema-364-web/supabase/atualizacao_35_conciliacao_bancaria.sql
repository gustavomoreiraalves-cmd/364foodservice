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
-- a lista anterior inteira.
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
             'application/x-ofx', 'text/csv', 'text/plain', 'application/octet-stream'
           ]
     where id = 'recebimentos';
  end if;
end $$;

commit;

-- ---------- ROLLBACK ----------
-- begin;
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
