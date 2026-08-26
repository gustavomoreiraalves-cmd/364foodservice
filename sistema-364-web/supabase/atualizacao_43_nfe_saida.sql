-- =========================================================
-- Atualização 43 — NF-e de saída: documentos, itens, eventos e numeração
--
-- Três tabelas e uma função. A função é o coração: reservar_numero_fiscal
-- incrementa e devolve numa instrução só. Ler o último número e depois gravar
-- o próximo, em dois passos, é a corrida que faz duas notas nascerem com o
-- mesmo número — e número repetido é rejeição na SEFAZ com a nota já assinada.
--
-- nfe_saida_itens congela o resultado do motor de regras tributárias. A regra
-- muda (correção de alíquota, mudança de CFOP); a nota já emitida não muda
-- junto, então o que foi declarado fica gravado aqui.
--
-- Rode depois de atualizacao_42_logo_empresa.sql. Idempotente.
-- Rollback comentado no fim.
-- =========================================================
begin;

create table if not exists public.nfe_saida_documentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  empregador_id uuid not null references public.empregadores(id),
  pedido_id uuid not null references public.pedidos(id),
  natureza_operacao_id uuid not null references public.naturezas_operacao(id),
  modelo text not null default '55' check (modelo in ('55', '65')),
  ambiente text not null check (ambiente in ('producao', 'homologacao')),
  serie int,
  numero int,
  chave char(44),
  codigo_numerico char(8),
  status text not null default 'rascunho'
    check (status in ('rascunho','numero_reservado','assinado','enviado',
                      'autorizado','denegado','rejeitado','erro_comunicacao','contingencia','cancelado')),
  motivo_rejeicao text,
  protocolo_autorizacao text,
  recibo_lote text,
  xml_path text,
  -- nfeProc (NFe assinada + protNFe da SEFAZ) — o que DANFE e o arquivo legal
  -- exigem. Só protocolo_autorizacao (nProt) não é suficiente: digVal,
  -- dhRecbto e verAplic da autorização não sobrevivem sem o protNFe inteiro
  -- (achado da revisão, Importante I8).
  nfeproc_path text,
  danfe_path text,
  valor_total numeric(12,2) not null default 0,
  emitida_em timestamptz,
  cancelada_em timestamptz,
  criado_por uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Segunda barreira contra número repetido: a primeira é a própria
-- fiscal_numeracao, esta pega o caso de alguém gravar documento à mão.
create unique index if not exists nfe_saida_documentos_numero_unico
  on public.nfe_saida_documentos(empregador_id, modelo, ambiente, serie, numero)
  where numero is not null;
create unique index if not exists nfe_saida_documentos_chave_unica
  on public.nfe_saida_documentos(chave) where chave is not null;
create index if not exists nfe_saida_documentos_pedido_idx on public.nfe_saida_documentos(pedido_id);

-- Terceira barreira, agora contra duas notas AUTORIZADAS para o mesmo
-- pedido: as duas de cima protegem número e chave, mas nada até aqui impedia
-- duas linhas 'autorizado' co-existindo para o mesmo pedido_id (achado da
-- revisão, Importante I10) — o guard em lib/nfe/emitir.js (aplicação) já
-- recusa isso, mas só a aplicação, não o banco. Parcial e forward-compatible:
-- cancelar uma nota libera o pedido para uma reemissão legítima (a condição
-- `where status = 'autorizado'` some da linha cancelada).
create unique index if not exists nfe_saida_documentos_um_autorizado_por_pedido
  on public.nfe_saida_documentos(pedido_id) where status = 'autorizado';

create table if not exists public.nfe_saida_itens (
  id uuid primary key default gen_random_uuid(),
  nfe_saida_documento_id uuid not null references public.nfe_saida_documentos(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id),
  pedido_item_id uuid not null references public.pedido_itens(id),
  produto_id uuid not null references public.produtos(id),
  numero_item int not null,
  codigo text not null,
  descricao text not null,
  ncm text not null,
  cest text,
  gtin text,
  cfop text not null,
  unidade text not null,
  quantidade numeric(15,4) not null,
  valor_unitario numeric(15,10) not null,
  valor_total numeric(12,2) not null,
  origem_mercadoria text,
  csosn text,
  cst_icms text,
  base_calculo_icms numeric(12,2) not null default 0,
  aliquota_icms numeric(7,4) not null default 0,
  valor_icms numeric(12,2) not null default 0,
  cst_pis text,
  aliquota_pis numeric(7,4) not null default 0,
  valor_pis numeric(12,2) not null default 0,
  cst_cofins text,
  aliquota_cofins numeric(7,4) not null default 0,
  valor_cofins numeric(12,2) not null default 0,
  regra_tributaria_id uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists nfe_saida_itens_numero_unico
  on public.nfe_saida_itens(nfe_saida_documento_id, numero_item);

create table if not exists public.nfe_saida_eventos (
  id uuid primary key default gen_random_uuid(),
  nfe_saida_documento_id uuid not null references public.nfe_saida_documentos(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id),
  tipo text not null check (tipo in ('cancelamento','carta_correcao')),
  sequencia int not null default 1,
  justificativa text not null,
  protocolo text,
  xml_path text,
  status text not null default 'enviado' check (status in ('enviado','aceito','rejeitado')),
  criado_por uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create unique index if not exists nfe_saida_eventos_seq_unica
  on public.nfe_saida_eventos(nfe_saida_documento_id, tipo, sequencia);

do $$
declare t text;
begin
  foreach t in array array['nfe_saida_documentos','nfe_saida_itens','nfe_saida_eventos'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "%s_scoped" on public.%I;', t, t);
    execute format('create policy "%s_scoped" on public.%I for select to authenticated
                    using (empresa_id in (select public.empresas_permitidas()));', t, t);
  end loop;
end $$;

drop trigger if exists trg_nfe_saida_documentos_updated_at on public.nfe_saida_documentos;
create trigger trg_nfe_saida_documentos_updated_at before update on public.nfe_saida_documentos
  for each row execute function public.fn_set_updated_at();

-- ---------- reserva atômica de número ----------
-- Uma instrução só. Duas chamadas simultâneas para a mesma chave travam uma na
-- outra no lock de linha do Postgres e cada uma recebe um número diferente;
-- nenhuma enxerga o valor intermediário da outra. Não precisa de select ... for
-- update nem de lock de aplicação.
--
-- security definer porque fiscal_numeracao tem RLS sem policy: só o service
-- role (e esta função) alcança.
--
-- Desvio deliberado do desenho original: a função foi especificada como
-- "returns int" (escalar), mas um "language sql" escalar sobre um
-- UPDATE ... RETURNING que não casa nenhuma linha não devolve zero linhas —
-- devolve uma linha com null (comportamento padrão do Postgres para função
-- escalar cuja query interna não bate nenhuma linha, confirmado empiricamente
-- antes de escrever este arquivo). Isso é exatamente o "null silencioso" que
-- o comentário acima promete evitar, e o pipeline não conseguiria distinguir
-- "sem numeração cadastrada" de "número reservado é nulo". "returns setof
-- int" resolve com a mesma instrução única: chave ausente devolve zero
-- linhas de verdade (testado no cenário 2 de tests/migracao-43/cenarios.sql),
-- chave presente devolve exatamente uma linha com o número.
create or replace function public.reservar_numero_fiscal(
  p_empregador_id uuid, p_modelo text, p_ambiente text, p_serie int
)
returns setof int
language sql
security definer
set search_path = public
as $$
  update fiscal_numeracao
     set ultimo_numero = ultimo_numero + 1, updated_at = now()
   where empregador_id = p_empregador_id and modelo = p_modelo
     and ambiente = p_ambiente and serie = p_serie
  returning ultimo_numero;
$$;

revoke all on function public.reservar_numero_fiscal(uuid, text, text, int) from public, anon, authenticated;

commit;

-- ---------- rollback ----------
-- begin;
-- drop function if exists public.reservar_numero_fiscal(uuid, text, text, int);
-- drop table if exists public.nfe_saida_eventos;
-- drop table if exists public.nfe_saida_itens;
-- drop table if exists public.nfe_saida_documentos;
-- commit;
