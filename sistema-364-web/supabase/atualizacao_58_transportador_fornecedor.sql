-- supabase/atualizacao_58_transportador_fornecedor.sql
--
-- Cadastro de transportadora deixa de ser tabela própria (atualização 50) e
-- vira só mais um papel do cadastro de fornecedor — mesma tela de
-- Clientes/Fornecedores, dois flags novos em `fornecedores`:
--   is_fornecedor    — papel "fornecedor" (default true: todo fornecedor de
--                       hoje já é isso, é o que a tabela sempre significou)
--   is_transportador — papel novo, marcável junto ou sozinho
-- `ie` também sobe pra `fornecedores` (transportadora tinha, fornecedor não).
--
-- Migração de dados preserva o id de cada transportadora sempre que possível
-- (linha nova em fornecedores com o MESMO id da transportadora), pra
-- `expedicoes.transportadora_id` não precisar reescrever nada além da FK. Só
-- quando a transportadora já tinha um fornecedor irmão (mesmo empresa_id +
-- cnpj) é que os dois viram uma linha só — aí sim expedicoes.transportadora_id
-- muda de valor, pra apontar pro fornecedor sobrevivente.
--
-- Não é idempotente (mexe em dado, dropa tabela no fim) — roda uma vez.
begin;

-- ---------- 1. COLUNAS NOVAS EM FORNECEDORES ----------
alter table public.fornecedores add column if not exists ie text;
alter table public.fornecedores add column if not exists is_fornecedor boolean not null default true;
alter table public.fornecedores add column if not exists is_transportador boolean not null default false;

-- ---------- 2. MAPA transportadora.id -> fornecedor.id de destino ----------
create temporary table _map_transportador (
  transportadora_id uuid primary key,
  fornecedor_id uuid not null
) on commit drop;

-- 2a. Transportadora com CNPJ que já existe como fornecedor da mesma empresa:
-- funde nela (mesmo padrão de normalização da atualização 23 — a tela de
-- transportadoras nunca tirou pontuação do CNPJ digitado, fornecedores sim).
insert into _map_transportador (transportadora_id, fornecedor_id)
select t.id, f.id
from public.transportadoras t
join public.fornecedores f
  on f.empresa_id = t.empresa_id
 and f.cnpj = nullif(regexp_replace(t.cnpj, '\D', '', 'g'), '')
where nullif(regexp_replace(t.cnpj, '\D', '', 'g'), '') is not null;

update public.fornecedores f
set is_transportador = true,
    ie = coalesce(f.ie, nullif(regexp_replace(t.ie, '\D', '', 'g'), ''))
from public.transportadoras t
join _map_transportador m on m.transportadora_id = t.id
where f.id = m.fornecedor_id;

-- 2b. Sem fornecedor irmão: vira linha nova em fornecedores, com o MESMO id
-- (é o que deixa a FK de expedicoes seguir válida sem reescrever o valor).
insert into public.fornecedores (
  id, empresa_id, nome, nome_fantasia, cnpj, ie, categoria, contato, telefone, email,
  logradouro, numero, complemento, bairro, codigo_municipio_ibge, municipio, uf, cep,
  ativo, created_at, is_fornecedor, is_transportador
)
select
  t.id, t.empresa_id, t.nome, t.nome_fantasia,
  nullif(regexp_replace(t.cnpj, '\D', '', 'g'), ''),
  nullif(regexp_replace(t.ie, '\D', '', 'g'), ''),
  'Serviços', null, t.telefone, null,
  t.logradouro, t.numero, t.complemento, t.bairro, t.codigo_municipio_ibge, t.municipio, t.uf, t.cep,
  t.ativo, t.created_at, false, true
from public.transportadoras t
where not exists (select 1 from _map_transportador m where m.transportadora_id = t.id);

insert into _map_transportador (transportadora_id, fornecedor_id)
select t.id, t.id from public.transportadoras t
where not exists (select 1 from _map_transportador m where m.transportadora_id = t.id);

-- ---------- 3. REPONTA expedicoes.transportadora_id ----------
update public.expedicoes ex
set transportadora_id = m.fornecedor_id
from _map_transportador m
where ex.transportadora_id = m.transportadora_id
  and m.fornecedor_id <> m.transportadora_id;

alter table public.expedicoes drop constraint if exists expedicoes_transportadora_id_fkey;
alter table public.expedicoes add constraint expedicoes_transportadora_id_fkey
  foreign key (transportadora_id) references public.fornecedores(id);

-- ---------- 4. TABELA ANTIGA SAI ----------
drop table if exists public.transportadoras;

commit;

-- ---------- ROLLBACK ----------
-- Sem volta automática: a tabela `transportadoras` já foi dropada no passo 4.
-- Restaurar exige recriar a tabela (DDL da atualização 50) e reimportar as
-- linhas a partir de `fornecedores where is_transportador` — refazer manual,
-- não um script pronto.
