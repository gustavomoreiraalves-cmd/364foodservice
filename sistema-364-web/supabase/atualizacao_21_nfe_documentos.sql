-- =========================================================
-- 364 — ATUALIZAÇÃO 21: NF-e NO RECEBIMENTO
-- Caixa de entrada de notas fiscais eletrônicas: documentos vistos na SEFAZ
-- (ou enviados por upload), o ponteiro de leitura por empresa e o de-para que
-- liga o código do produto do fornecedor à matéria-prima cadastrada.
--
-- O XML em si não fica no banco: vai para o bucket privado 'recebimentos',
-- em {empresa_id}/nfe/{chave}.xml, e a coluna guarda só o path.
--
-- Rode depois de atualizacao_20_rls_escopo_empresa.sql.
-- =========================================================

begin;

-- ---------- DOCUMENTOS ----------
create table if not exists public.nfe_documentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  chave text not null check (chave ~ '^[0-9]{44}$'),
  nsu text,                                   -- número sequencial da SEFAZ; nulo quando veio de upload
  modelo text,                                -- '55' = NF-e; o resto entra como ignorada
  cnpj_emitente text,
  nome_emitente text,
  numero text,
  serie text,
  emitida_em timestamptz,
  valor_total numeric(12,2),
  status text not null default 'resumo'
    check (status in ('resumo', 'manifestada', 'xml_baixado', 'vinculada', 'ignorada')),
  origem text not null default 'sefaz' check (origem in ('sefaz', 'upload')),
  xml_path text,                              -- path no bucket privado, não URL
  recebimento_id uuid references recebimentos(id) on delete set null,
  manifestada_em timestamptz,
  ultimo_erro text,
  created_at timestamptz not null default now(),
  unique (empresa_id, chave)
);
create index if not exists nfe_documentos_empresa_status_idx
  on public.nfe_documentos (empresa_id, status);
create index if not exists nfe_documentos_recebimento_idx
  on public.nfe_documentos (recebimento_id);

alter table public.nfe_documentos enable row level security;
drop policy if exists "empresa_scoped_access" on public.nfe_documentos;
create policy "empresa_scoped_access" on public.nfe_documentos for all
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()))
  with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

-- ---------- PONTEIRO DE LEITURA DA SEFAZ ----------
-- Um registro por empresa. ultima_consulta_em existe para respeitar o limite de
-- consumo da SEFAZ (retorno 656 = consumo indevido).
create table if not exists public.nfe_sefaz_estado (
  empresa_id uuid primary key references empresas(id),
  ultimo_nsu text not null default '000000000000000',
  max_nsu text not null default '000000000000000',
  ultima_consulta_em timestamptz,
  ultimo_erro text,
  atualizado_em timestamptz not null default now()
);

alter table public.nfe_sefaz_estado enable row level security;
drop policy if exists "empresa_scoped_access" on public.nfe_sefaz_estado;
create policy "empresa_scoped_access" on public.nfe_sefaz_estado for all
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()))
  with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

-- ---------- DE-PARA FORNECEDOR x MATÉRIA-PRIMA ----------
-- fator_conversao traduz a unidade comercial da nota (CX, FD) para a unidade de
-- estoque (kg). 1 significa "a nota já vem na unidade de estoque".
create table if not exists public.fornecedor_produto_mapa (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  cnpj_emitente text not null,
  codigo_produto text not null,
  materia_prima_id uuid not null references materias_primas(id) on delete cascade,
  unidade_nf text,
  fator_conversao numeric(12,4) not null default 1 check (fator_conversao > 0),
  created_at timestamptz not null default now(),
  unique (empresa_id, cnpj_emitente, codigo_produto)
);
create index if not exists fornecedor_produto_mapa_empresa_cnpj_idx
  on public.fornecedor_produto_mapa (empresa_id, cnpj_emitente);

alter table public.fornecedor_produto_mapa enable row level security;
drop policy if exists "empresa_scoped_access" on public.fornecedor_produto_mapa;
create policy "empresa_scoped_access" on public.fornecedor_produto_mapa for all
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()))
  with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

-- ---------- VÍNCULO NO RECEBIMENTO ----------
alter table public.recebimentos add column if not exists nfe_chave text;
alter table public.recebimentos add column if not exists nfe_documento_id uuid references public.nfe_documentos(id);

-- A mesma nota não pode virar dois recebimentos na mesma empresa. Índice parcial
-- porque recebimento digitado à mão continua com nfe_chave nulo.
create unique index if not exists recebimentos_empresa_nfe_chave_idx
  on public.recebimentos (empresa_id, nfe_chave) where nfe_chave is not null;

commit;
