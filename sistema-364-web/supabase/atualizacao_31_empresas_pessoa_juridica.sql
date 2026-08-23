-- Cadastro central da pessoa jurídica + certificado digital A1.
--
-- O sistema tinha duas tabelas que pareciam "empresa": `empresas` é a marca /
-- operação (eixo do RLS e de todo empresa_id) e `empregadores` é o CNPJ de
-- verdade, criado para o eSocial. Em produção, três marcas compartilham o mesmo
-- CNPJ copiado em `empresas.cnpj`, e o upload de NF-e conferia a nota contra
-- essa cópia. Aqui `empregadores` vira a fonte única da pessoa jurídica e cada
-- marca aponta para ela por `empregador_id`. Mantivemos o nome `empregadores`
-- porque quatro tabelas do ponto já o referenciam; a tela chama de "Empresas (CNPJ)".
--
-- O certificado A1 (.pfx + senha) fica em `certificados_digitais`, cifrado pela
-- aplicação (AES-256-GCM, chave CERTIFICADO_CHAVE). A tabela não tem policy de
-- select para `authenticated`: só a API com service role lê.
--
-- Idempotente. Rollback comentado no fim.

-- ---------- empregadores: campos fiscais, contato, responsáveis ----------
alter table public.empregadores add column if not exists regime_tributario text;
alter table public.empregadores add column if not exists cnae_principal text;
alter table public.empregadores add column if not exists inscricao_municipal text;
alter table public.empregadores add column if not exists numero text;
alter table public.empregadores add column if not exists complemento text;
alter table public.empregadores add column if not exists bairro text;
alter table public.empregadores add column if not exists codigo_municipio_ibge text;
alter table public.empregadores add column if not exists telefone text;
alter table public.empregadores add column if not exists email text;
alter table public.empregadores add column if not exists email_fiscal text;
alter table public.empregadores add column if not exists responsavel_legal_cpf text;
alter table public.empregadores add column if not exists responsavel_legal_email text;
alter table public.empregadores add column if not exists responsavel_legal_telefone text;
alter table public.empregadores add column if not exists contador_nome text;
alter table public.empregadores add column if not exists contador_crc text;
alter table public.empregadores add column if not exists contador_email text;
alter table public.empregadores add column if not exists contador_telefone text;
alter table public.empregadores add column if not exists observacoes text;
alter table public.empregadores add column if not exists updated_at timestamptz not null default now();

comment on column public.empregadores.endereco is 'Logradouro. Número, complemento e bairro têm colunas próprias (atualização 31).';

-- Normaliza antes do check: cadastro antigo pode ter máscara.
update public.empregadores set cnpj = regexp_replace(cnpj, '\D', '', 'g') where cnpj ~ '\D';

alter table public.empregadores drop constraint if exists empregadores_cnpj_digitos;
alter table public.empregadores add constraint empregadores_cnpj_digitos check (cnpj ~ '^\d{14}$') not valid;
alter table public.empregadores validate constraint empregadores_cnpj_digitos;

alter table public.empregadores drop constraint if exists empregadores_regime_tributario_valido;
alter table public.empregadores add constraint empregadores_regime_tributario_valido
  check (regime_tributario is null or regime_tributario in ('simples', 'presumido', 'real', 'mei'));

drop trigger if exists trg_empregadores_updated_at on public.empregadores;
create trigger trg_empregadores_updated_at before update on public.empregadores
  for each row execute function public.fn_set_updated_at();

-- ---------- empresas -> empregadores ----------
alter table public.empresas add column if not exists empregador_id uuid references public.empregadores(id) on delete restrict;
create index if not exists empresas_empregador_id_idx on public.empresas(empregador_id);

-- Marca cujo CNPJ já tem pessoa jurídica: vincula.
update public.empresas e set empregador_id = p.id
  from public.empregadores p
 where e.empregador_id is null and e.cnpj is not null
   and p.cnpj = regexp_replace(e.cnpj, '\D', '', 'g');

-- CNPJ sem pessoa jurídica: cria uma por CNPJ distinto, com razão social
-- provisória para o administrador completar na tela.
insert into public.empregadores (grupo_id, razao_social, nome_fantasia, cnpj)
select distinct on (regexp_replace(e.cnpj, '\D', '', 'g'))
       e.grupo_id, e.nome || ' (completar razão social)', e.nome, regexp_replace(e.cnpj, '\D', '', 'g')
  from public.empresas e
 where e.empregador_id is null and e.cnpj is not null and regexp_replace(e.cnpj, '\D', '', 'g') ~ '^\d{14}$'
   and not exists (select 1 from public.empregadores p where p.cnpj = regexp_replace(e.cnpj, '\D', '', 'g'))
 order by regexp_replace(e.cnpj, '\D', '', 'g'), e.nome;

update public.empresas e set empregador_id = p.id
  from public.empregadores p
 where e.empregador_id is null and e.cnpj is not null
   and p.cnpj = regexp_replace(e.cnpj, '\D', '', 'g');

-- ---------- certificados digitais ----------
create table if not exists public.certificados_digitais (
  id uuid primary key default gen_random_uuid(),
  empregador_id uuid not null references public.empregadores(id) on delete cascade,
  pfx_cifrado text not null,        -- "iv:tag:cipher" base64, AES-256-GCM (lib/certificadoServer.js)
  senha_cifrada text not null,      -- mesmo formato
  cnpj_certificado text not null,   -- extraído do certificado; bate com empregadores.cnpj
  titular text,
  emissor text,
  numero_serie text,
  valido_de timestamptz not null,
  valido_ate timestamptz not null,
  ativo boolean not null default true,
  enviado_por uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create unique index if not exists certificados_digitais_um_ativo_por_empregador
  on public.certificados_digitais(empregador_id) where ativo;
create index if not exists certificados_digitais_empregador_idx on public.certificados_digitais(empregador_id);

alter table public.certificados_digitais enable row level security;
-- Sem policy para authenticated de propósito: nenhum cliente lê o pfx.
-- Service role ignora RLS e é o único caminho (app/api/empresas/*).

-- ---------- rollback ----------
-- Não desfaz a criação de pessoas jurídicas migradas dos CNPJs compartilhados:
-- depois que o administrador completa a razão social, não há como distinguir
-- com segurança o que veio da migração do que foi editado manualmente.
-- begin;
-- drop table if exists public.certificados_digitais;
-- alter table public.empresas drop column if exists empregador_id;
-- drop trigger if exists trg_empregadores_updated_at on public.empregadores;
-- alter table public.empregadores drop constraint if exists empregadores_regime_tributario_valido;
-- alter table public.empregadores drop constraint if exists empregadores_cnpj_digitos;
-- alter table public.empregadores
--   drop column if exists regime_tributario, drop column if exists cnae_principal,
--   drop column if exists inscricao_municipal, drop column if exists numero,
--   drop column if exists complemento, drop column if exists bairro,
--   drop column if exists codigo_municipio_ibge, drop column if exists telefone,
--   drop column if exists email, drop column if exists email_fiscal,
--   drop column if exists responsavel_legal_cpf, drop column if exists responsavel_legal_email,
--   drop column if exists responsavel_legal_telefone, drop column if exists contador_nome,
--   drop column if exists contador_crc, drop column if exists contador_email,
--   drop column if exists contador_telefone, drop column if exists observacoes,
--   drop column if exists updated_at;
-- comment on column public.empregadores.endereco is null;
-- commit;
