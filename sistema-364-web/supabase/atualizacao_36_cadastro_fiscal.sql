-- =========================================================
-- Atualização 36 — Cadastro fiscal e motor de regras tributárias
--
-- O sistema sabe o que a empresa vende, mas não sabe descrever isso para a
-- SEFAZ: `produtos` não tem NCM, CEST nem origem, e `clientes` não tem
-- endereço nem inscrição estadual. Sem esses dados não sai uma NF-e sequer,
-- por mais pronto que esteja o emissor. Esta migração é o cadastro; a
-- emissão (séries, numeração, notas emitidas, eventos) vem na 37.
--
-- A decisão de projeto que estrutura tudo aqui: o produto guarda só o que é
-- intrínseco à mercadoria (NCM, CEST, GTIN, origem, unidade tributável). O
-- que é tributação — CFOP, CSOSN, base, MVA — depende também da natureza da
-- operação, de quem é o destinatário e da UF, e por isso mora em
-- `regras_tributarias`, resolvida no momento da emissão por
-- fn_resolver_regra_tributaria. Gravar CFOP/CSOSN fixo no produto funciona
-- até a primeira devolução ou a primeira venda a consumidor final, e depois
-- passa a emitir nota com tributo errado sem dar erro nenhum.
--
-- Contexto fiscal apurado em docs/fiscal (24/08/2026): a 364 é optante do
-- Simples Nacional (CRT 1), compra carne já abatida, industrializa por
-- defumação e vende dentro de Rondônia, inclusive a consumidor final. Como
-- a isenção rondoniense alcança só "carnes e miúdos frescos resultantes do
-- abate", o produto defumado não é alcançado, e a 364 tende a ser substituta
-- tributária na própria saída. Isso está pendente de confirmação do contador:
-- por isso a alíquota e a MVA não estão embutidas em lugar nenhum do código,
-- e sim em linhas de `regras_tributarias` e `cest_uf_regra`, que se corrigem
-- sem deploy.
--
-- Rode depois de atualizacao_35_conciliacao_bancaria.sql. Idempotente.
-- Rollback comentado no fim.
-- =========================================================
begin;

-- ---------- GTIN: dígito verificador ----------
-- Usada em check constraint, então precisa vir antes das tabelas. O algoritmo
-- é o mesmo para GTIN-8, 12, 13 e 14: soma ponderada 3/1 da direita para a
-- esquerda, e o dígito é o que completa a próxima dezena. A NF-e rejeita
-- (código 611) GTIN com DV errado, então barrar no cadastro evita descobrir
-- isso só na hora de faturar.
create or replace function public.fn_gtin_digito_verificador(p_gtin text)
returns int
language plpgsql
immutable
as $$
declare
  corpo text;
  soma int := 0;
  peso int;
  i int;
begin
  if p_gtin is null then return null; end if;
  corpo := left(p_gtin, length(p_gtin) - 1);
  -- Da direita para a esquerda: o dígito mais à direita do corpo pesa 3.
  for i in reverse length(corpo)..1 loop
    peso := case when (length(corpo) - i) % 2 = 0 then 3 else 1 end;
    soma := soma + (substr(corpo, i, 1))::int * peso;
  end loop;
  return (10 - (soma % 10)) % 10;
end;
$$;

create or replace function public.fn_gtin_valido(p_gtin text)
returns boolean
language plpgsql
immutable
as $$
begin
  if p_gtin is null then return true; end if;
  -- Literal exigido pelo layout quando o item não tem código de barras.
  if p_gtin = 'SEM GTIN' then return true; end if;
  if p_gtin !~ '^\d+$' then return false; end if;
  if length(p_gtin) not in (8, 12, 13, 14) then return false; end if;
  return right(p_gtin, 1)::int = public.fn_gtin_digito_verificador(p_gtin);
end;
$$;

-- =========================================================
-- TABELAS OFICIAIS DE APOIO
-- Não têm empresa_id: são as mesmas para todo mundo. Ficam legíveis para
-- qualquer usuário autenticado e graváveis só pela service role, como
-- certificados_digitais — nenhuma tela deve editar tabela oficial na mão.
-- =========================================================

create table if not exists public.tabela_ncm (
  ncm text primary key check (ncm ~ '^\d{8}$'),
  descricao text not null,
  aliquota_ipi numeric(6,2),        -- da TIPI; null quando NT (não tributado)
  vigente_desde date not null,
  vigente_ate date,                 -- null = vigente
  ato_normativo text                -- ex.: 'ADE RFB 1/2026'
);
comment on table public.tabela_ncm is
  'Carga periódica da TIPI/RFB. Não existe endpoint oficial machine-readable: a carga é manual, por trimestre, e cada linha guarda o ato que a criou.';

create table if not exists public.tabela_cest (
  cest text not null check (cest ~ '^\d{7}$'),
  ncm text not null,                -- pode ser prefixo (posição) ou NCM completo
  descricao text not null,
  anexo_convenio text,              -- ex.: 'Anexo XVII' do Convênio ICMS 142/2018
  item_convenio text,               -- ex.: '83.1'
  primary key (cest, ncm)
);
comment on table public.tabela_cest is
  'Correlação CEST x NCM dos anexos do Convênio ICMS 142/2018. O CONFAZ não publica CSV: a carga sai do texto legal, e por isso item_convenio existe — é o que permite conferir a linha contra a norma.';

create table if not exists public.cest_uf_regra (
  uf char(2) not null,
  cest text not null,
  protocolo_convenio text,          -- ex.: 'Protocolo ICMS 01/2023'
  mva_original numeric(6,2),
  mva_ajustada numeric(6,2),
  reducao_base_percentual numeric(6,2),      -- na operação própria
  reducao_base_st_percentual numeric(6,2),   -- na base da ST; nem sempre igual à de cima
  mod_bc_st smallint,                        -- tag <modBCST>: 0 preço tabelado, 4 MVA, 5 pauta, 6 valor da operação
  aliquota_interna numeric(5,2),    -- alíquota interna da UF para o item
  sujeito_st boolean not null default true,
  base_legal text,                  -- ex.: 'RICMS-RO Anexo VI, Tabela XVII, item 83.1'
  vigencia_inicio date not null default current_date,
  vigencia_fim date,
  primary key (uf, cest, vigencia_inicio),
  constraint cest_uf_regra_st_exige_mva check (not sujeito_st or mva_original is not null)
);
comment on table public.cest_uf_regra is
  'O mesmo CEST tem MVA e protocolo diferentes por estado. Para RO os números vêm do Anexo VI, Parte 2, do RICMS/RO — ver docs/fiscal/01-icms-st-rondonia.md. Nada de MVA em constante de código.';
comment on column public.cest_uf_regra.aliquota_interna is
  'Não presuma a alíquota modal. A NF-e de entrada do frigorífico (21/08/2026) mostra carne bovina saindo com 12 por cento e redução de base de 41,67 por cento pelo item 18 da Parte 2 do Anexo II, não com os 19,5 por cento do art. 12. Coluna nula significa não confirmado para este item.';
comment on column public.cest_uf_regra.sujeito_st is
  'Separa dois estados que não podem ser confundidos: linha ausente significa "ninguém verificou ainda" e bloqueia a emissão; linha presente com false significa "verificado no texto da norma, o estado não adotou este item" e libera a venda sem retenção. Um CEST existir no Convênio 142/2018 não implica que a UF o tenha internalizado — Rondônia, por exemplo, não adotou os itens 79.0 a 82.0 da Tabela XVII.';

create table if not exists public.tabela_cfop (
  cfop text primary key check (cfop ~ '^\d{4}$'),
  descricao text not null,
  tipo char(1) not null check (tipo in ('E','S'))
);
comment on table public.tabela_cfop is 'Ajuste SINIEF 7/2001 e alterações. E = entrada, S = saída.';

create table if not exists public.tabela_unidade_medida (
  codigo text primary key,
  descricao text not null
);
comment on table public.tabela_unidade_medida is
  'Unidades aceitas em uCom/uTrib, do Portal Nacional da NF-e. Existe para o cadastro validar a unidade antes de a SEFAZ recusar.';

create table if not exists public.municipios_ibge (
  codigo_ibge char(7) primary key,
  nome text not null,
  uf char(2) not null
);
comment on table public.municipios_ibge is
  'Código do município (cMun) do emitente e do destinatário. Carga única a partir do CSV da Receita Federal, revisão anual.';

create table if not exists public.tabela_cclasstrib (
  cclasstrib char(6) primary key,
  cst_ibs_cbs char(3) not null,
  descricao text not null,
  base_legal text
);
comment on table public.tabela_cclasstrib is
  'Classificação Tributária do IBS/CBS (LC 214/2025), publicada no Informe Técnico RT 2025.002. O CST NÃO é substring do cClassTrib: a correlação é desta tabela, por isso as duas colunas são independentes. Tabela nasce vazia — só passa a importar para a 364 em 04/01/2027, quando a rejeição por falta do grupo IBSCBS alcança o CRT 1.';

do $$
declare t text;
begin
  foreach t in array array['tabela_ncm','tabela_cest','cest_uf_regra','tabela_cfop',
                           'tabela_unidade_medida','municipios_ibge','tabela_cclasstrib']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "leitura_autenticada" on public.%I', t);
    execute format($p$create policy "leitura_autenticada" on public.%I for select
                     using (auth.role() = 'authenticated')$p$, t);
  end loop;
end $$;

-- =========================================================
-- GRUPOS TRIBUTÁRIOS
-- Vários produtos compartilham o mesmo tratamento fiscal (todo defumado sem
-- cocção se comporta igual). O grupo evita repetir a mesma regra por SKU e é
-- o mesmo conceito que Bling, Omie e Protheus chamam de perfil fiscal.
-- =========================================================
create table if not exists public.grupos_tributarios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  codigo text not null,
  descricao text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (empresa_id, codigo)
);
alter table public.grupos_tributarios enable row level security;
drop policy if exists "empresa_scoped_access" on public.grupos_tributarios;
create policy "empresa_scoped_access" on public.grupos_tributarios for all
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()))
  with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

-- =========================================================
-- PRODUTOS — só o que é intrínseco à mercadoria
-- Nenhuma coluna de CFOP, CSOSN ou alíquota entra aqui de propósito: esses
-- valores dependem da operação e saem de regras_tributarias.
-- =========================================================
alter table public.produtos add column if not exists ncm text;
comment on column public.produtos.ncm is 'NCM de 8 dígitos, tag <NCM>. Sem ele não se emite nota.';

alter table public.produtos add column if not exists ex_tipi text;
comment on column public.produtos.ex_tipi is 'Exceção da TIPI, 2 dígitos, tag <EXTIPI>. Só quando o NCM tem exceção vigente.';

alter table public.produtos add column if not exists cest text;
comment on column public.produtos.cest is 'CEST de 7 dígitos, tag <CEST>. Obrigatório quando o item está em substituição tributária.';

alter table public.produtos add column if not exists gtin text;
alter table public.produtos add column if not exists gtin_tributavel text;
comment on column public.produtos.gtin is 'Código de barras comercial, tag <cEAN>. Literal SEM GTIN quando não houver — a tag nunca vai vazia.';
comment on column public.produtos.gtin_tributavel is 'Código de barras da unidade tributável, tag <cEANTrib>.';

alter table public.produtos add column if not exists origem_mercadoria smallint;
comment on column public.produtos.origem_mercadoria is
  'Tabela de origem 0 a 8 (nacional, importada, conteúdo de importação), tag <orig>. Para a 364, carne comprada no país é 0.';

alter table public.produtos add column if not exists unidade_tributavel text;
alter table public.produtos add column if not exists fator_conversao_tributavel numeric(12,4);
comment on column public.produtos.unidade_tributavel is
  'uTrib. A coluna unidade, que já existia, é a comercial (uCom). Quando o defumado é vendido em peça mas tributado em kg, as duas divergem.';
comment on column public.produtos.fator_conversao_tributavel is
  'Quantas unidades tributáveis cabem em uma unidade comercial: qTrib = qCom * fator. 1 quando as duas unidades são a mesma.';

alter table public.produtos add column if not exists peso_liquido_kg numeric(12,4);
alter table public.produtos add column if not exists peso_bruto_kg numeric(12,4);
comment on column public.produtos.peso_bruto_kg is 'Alimenta o grupo <vol> do transporte. Deve ser maior ou igual ao líquido.';

alter table public.produtos add column if not exists ind_escala char(1);
alter table public.produtos add column if not exists cnpj_fabricante text;
comment on column public.produtos.ind_escala is
  'Tag <indEscala>: S para produzido em escala relevante, N para não relevante. Quando N, a nota exige o CNPJ do fabricante na tag <CNPJFab>, e a MVA aplicável pode ser outra. A NF-e do frigorífico traz S nos três itens.';
comment on column public.produtos.cnpj_fabricante is
  'Tag <CNPJFab>, obrigatória quando ind_escala é N.';

alter table public.produtos add column if not exists aliquota_transparencia numeric(6,2);
comment on column public.produtos.aliquota_transparencia is
  'Percentual da Lei 12.741/2012 (Lei da Transparência), tabela IBPT, que alimenta <vTotTrib> na nota. Não é tributo devido: é o valor aproximado informado ao consumidor. Atualiza por trimestre, junto com a tabela IBPT.';

alter table public.produtos add column if not exists sujeito_st boolean not null default false;
comment on column public.produtos.sujeito_st is
  'Marca conferida pelo contador de que o item está em CEST/convênio de ST vigente. É indicativo de cadastro: quem decide se há retenção nesta nota é a regra tributária resolvida na emissão.';

alter table public.produtos add column if not exists grupo_tributario_id uuid references public.grupos_tributarios(id);
comment on column public.produtos.grupo_tributario_id is
  'Perfil fiscal compartilhado. Uma regra escrita para o grupo vale para todos os produtos dele, sem repetição por SKU.';

alter table public.produtos add column if not exists rastro_obrigatorio boolean not null default false;
comment on column public.produtos.rastro_obrigatorio is
  'Envia o grupo <rastro> (nLote, qLote, dFab, dVal) na nota. A NT 2016.002 só obriga o grupo para medicamentos: para carnes e preparações é opcional, e nasce em false por isso. Continua útil ligar por escolha, já que a produção da 364 rastreia lote e validade de qualquer forma.';

alter table public.produtos add column if not exists cclasstrib char(6) references public.tabela_cclasstrib(cclasstrib);
alter table public.produtos add column if not exists cst_ibs_cbs char(3);
comment on column public.produtos.cclasstrib is
  'Classificação Tributária do IBS/CBS. Fica nulo até a 364 precisar dele (rejeição alcança CRT 1 em 04/01/2027); a coluna nasce agora para o modelo não ter de ser reescrito.';

alter table public.produtos add column if not exists ativo_fiscal boolean not null default false;
alter table public.produtos add column if not exists sugerido_automaticamente boolean not null default false;
alter table public.produtos add column if not exists revisado_por_id uuid references auth.users(id);
alter table public.produtos add column if not exists revisado_em timestamptz;
comment on column public.produtos.ativo_fiscal is
  'Trava de segurança: só true depois que uma pessoa conferiu os campos fiscais. A emissão recusa produto com isto em false, o que impede nota errada saindo de dado importado sem revisão.';
comment on column public.produtos.sugerido_automaticamente is
  'true quando NCM/CEST/GTIN vieram do XML de entrada do fornecedor e ainda não foram confirmados.';

alter table public.produtos drop constraint if exists produtos_ncm_formato;
alter table public.produtos add constraint produtos_ncm_formato
  check (ncm is null or ncm ~ '^\d{8}$') not valid;
alter table public.produtos validate constraint produtos_ncm_formato;

alter table public.produtos drop constraint if exists produtos_cest_formato;
alter table public.produtos add constraint produtos_cest_formato
  check (cest is null or cest ~ '^\d{7}$') not valid;
alter table public.produtos validate constraint produtos_cest_formato;

alter table public.produtos drop constraint if exists produtos_ind_escala_valido;
alter table public.produtos add constraint produtos_ind_escala_valido
  check (ind_escala is null or (ind_escala in ('S','N')
         and (ind_escala = 'S' or cnpj_fabricante is not null))) not valid;
alter table public.produtos validate constraint produtos_ind_escala_valido;

alter table public.produtos drop constraint if exists produtos_origem_valida;
alter table public.produtos add constraint produtos_origem_valida
  check (origem_mercadoria is null or origem_mercadoria between 0 and 8) not valid;
alter table public.produtos validate constraint produtos_origem_valida;

alter table public.produtos drop constraint if exists produtos_gtin_valido;
alter table public.produtos add constraint produtos_gtin_valido
  check (public.fn_gtin_valido(gtin) and public.fn_gtin_valido(gtin_tributavel)) not valid;
alter table public.produtos validate constraint produtos_gtin_valido;

alter table public.produtos drop constraint if exists produtos_peso_coerente;
alter table public.produtos add constraint produtos_peso_coerente
  check (peso_bruto_kg is null or peso_liquido_kg is null or peso_bruto_kg >= peso_liquido_kg) not valid;
alter table public.produtos validate constraint produtos_peso_coerente;

-- ST exige CEST: sem ele a nota é rejeitada. Barrar aqui é mais barato.
alter table public.produtos drop constraint if exists produtos_st_exige_cest;
alter table public.produtos add constraint produtos_st_exige_cest
  check (not sujeito_st or cest is not null) not valid;
alter table public.produtos validate constraint produtos_st_exige_cest;

-- A trava só faz sentido se o mínimo estiver preenchido.
alter table public.produtos drop constraint if exists produtos_ativo_fiscal_completo;
alter table public.produtos add constraint produtos_ativo_fiscal_completo
  check (not ativo_fiscal or (ncm is not null and origem_mercadoria is not null
         and unidade_tributavel is not null and fator_conversao_tributavel is not null)) not valid;
alter table public.produtos validate constraint produtos_ativo_fiscal_completo;

create index if not exists produtos_ncm_idx on public.produtos(ncm) where ncm is not null;

-- =========================================================
-- MATÉRIAS-PRIMAS — o mesmo bloco, para o insumo comprado
-- O de-para de NF-e de entrada (fornecedor_produto_mapa, atualização 22)
-- aponta para cá, então é aqui que os campos fiscais lidos do XML do
-- fornecedor têm onde cair. Atenção: o NCM da carne crua não é o NCM do
-- defumado — são produtos diferentes, por isso os campos são separados.
-- =========================================================
alter table public.materias_primas add column if not exists ncm text;
alter table public.materias_primas add column if not exists cest text;
alter table public.materias_primas add column if not exists gtin text;
alter table public.materias_primas add column if not exists origem_mercadoria smallint;
alter table public.materias_primas add column if not exists unidade_tributavel text;
alter table public.materias_primas add column if not exists fator_conversao_tributavel numeric(12,4);
alter table public.materias_primas add column if not exists sugerido_automaticamente boolean not null default false;
alter table public.materias_primas add column if not exists confianca_sugestao numeric(5,2);
alter table public.materias_primas add column if not exists revisado_por_id uuid references auth.users(id);
alter table public.materias_primas add column if not exists revisado_em timestamptz;
comment on column public.materias_primas.confianca_sugestao is
  'Percentual de concordância entre as notas de entrada que sustentaram a sugestão. Cem por cento significa que todas as notas do insumo trouxeram o mesmo NCM.';

alter table public.materias_primas drop constraint if exists materias_primas_ncm_formato;
alter table public.materias_primas add constraint materias_primas_ncm_formato
  check (ncm is null or ncm ~ '^\d{8}$') not valid;
alter table public.materias_primas validate constraint materias_primas_ncm_formato;

-- =========================================================
-- CLIENTES — o bloco <dest> do XML
-- Hoje o cadastro tem nome, cnpj e telefone: nada do que a nota exige.
-- =========================================================
alter table public.clientes add column if not exists tipo_pessoa char(1);
alter table public.clientes add column if not exists cpf text;
alter table public.clientes add column if not exists ie text;
alter table public.clientes add column if not exists ind_ie_dest smallint;
alter table public.clientes add column if not exists isuf text;
alter table public.clientes add column if not exists logradouro text;
alter table public.clientes add column if not exists numero text;
alter table public.clientes add column if not exists complemento text;
alter table public.clientes add column if not exists bairro text;
alter table public.clientes add column if not exists codigo_municipio_ibge char(7);
alter table public.clientes add column if not exists municipio text;
alter table public.clientes add column if not exists uf char(2);
alter table public.clientes add column if not exists cep char(8);
alter table public.clientes add column if not exists email_nfe text;
alter table public.clientes add column if not exists consumidor_final boolean;
alter table public.clientes add column if not exists ativo_fiscal boolean not null default false;

comment on column public.clientes.ind_ie_dest is
  'Tag <indIEDest>: 1 contribuinte de ICMS, 2 contribuinte isento de inscrição, 9 não contribuinte. É o campo que separa o revendedor da pessoa física no balcão.';
comment on column public.clientes.consumidor_final is
  'Tag <indFinal>. Fica nulo de propósito: não há default seguro (revendedor e pessoa física convivem na mesma carteira), e a emissão bloqueia enquanto não for respondido.';
comment on column public.clientes.isuf is 'Inscrição SUFRAMA. Só cliente em área de livre comércio.';
comment on column public.clientes.email_nfe is 'Para onde o XML e o DANFE são enviados depois da autorização.';
comment on column public.clientes.ativo_fiscal is
  'Mesma trava de produtos: só true depois de conferência humana do endereço e da inscrição.';

alter table public.clientes drop constraint if exists clientes_tipo_pessoa_valido;
alter table public.clientes add constraint clientes_tipo_pessoa_valido
  check (tipo_pessoa is null or tipo_pessoa in ('F','J')) not valid;
alter table public.clientes validate constraint clientes_tipo_pessoa_valido;

alter table public.clientes drop constraint if exists clientes_ind_ie_dest_valido;
alter table public.clientes add constraint clientes_ind_ie_dest_valido
  check (ind_ie_dest is null or ind_ie_dest in (1,2,9)) not valid;
alter table public.clientes validate constraint clientes_ind_ie_dest_valido;

-- indIEDest 1 é o único que exige IE preenchida; 2 e 9 exigem que não venha.
alter table public.clientes drop constraint if exists clientes_ie_coerente_indicador;
alter table public.clientes add constraint clientes_ie_coerente_indicador
  check (ind_ie_dest is null or (ind_ie_dest = 1) = (ie is not null and ie <> '')) not valid;
alter table public.clientes validate constraint clientes_ie_coerente_indicador;

alter table public.clientes drop constraint if exists clientes_uf_formato;
alter table public.clientes add constraint clientes_uf_formato
  check (uf is null or uf ~ '^[A-Z]{2}$') not valid;
alter table public.clientes validate constraint clientes_uf_formato;

alter table public.clientes drop constraint if exists clientes_ativo_fiscal_completo;
alter table public.clientes add constraint clientes_ativo_fiscal_completo
  check (not ativo_fiscal or (
    tipo_pessoa is not null and ind_ie_dest is not null and consumidor_final is not null
    and logradouro is not null and numero is not null and bairro is not null
    and codigo_municipio_ibge is not null and uf is not null and cep is not null
    and (cnpj is not null or cpf is not null)
  )) not valid;
alter table public.clientes validate constraint clientes_ativo_fiscal_completo;

-- =========================================================
-- EMPREGADORES (emitente) — o que falta para assinar uma nota
-- Numeração e série ficam de fora de propósito: são estado de emissão, com
-- concorrência a tratar, e entram na 37 em tabela própria.
-- =========================================================
alter table public.empregadores add column if not exists inscricao_estadual text;
comment on column public.empregadores.inscricao_estadual is
  'IE do emitente. Existia só inscricao_municipal, que serve ao ISS e não à NF-e.';

alter table public.empregadores add column if not exists crt smallint;
comment on column public.empregadores.crt is
  'Tag <CRT>: 1 Simples Nacional, 2 Simples com excesso de sublimite, 3 Regime Normal, 4 MEI. A 364 é 1.';

alter table public.empregadores add column if not exists iest text;
comment on column public.empregadores.iest is
  'Inscrição de substituto tributário em outra UF. Fica nulo enquanto a 364 vender só dentro de Rondônia.';

alter table public.empregadores add column if not exists ambiente_nfe smallint not null default 2;
comment on column public.empregadores.ambiente_nfe is
  'Tag <tpAmb>: 1 produção, 2 homologação. Nasce em 2 de propósito — passar para 1 é uma decisão explícita, depois do credenciamento na SEFIN-RO.';

alter table public.empregadores drop constraint if exists empregadores_crt_valido;
alter table public.empregadores add constraint empregadores_crt_valido
  check (crt is null or crt in (1,2,3,4)) not valid;
alter table public.empregadores validate constraint empregadores_crt_valido;

alter table public.empregadores drop constraint if exists empregadores_ambiente_nfe_valido;
alter table public.empregadores add constraint empregadores_ambiente_nfe_valido
  check (ambiente_nfe in (1,2)) not valid;
alter table public.empregadores validate constraint empregadores_ambiente_nfe_valido;

-- CRT e regime_tributario descrevem a mesma realidade; divergência entre os
-- dois é erro de cadastro que só apareceria como rejeição da SEFAZ.
alter table public.empregadores drop constraint if exists empregadores_crt_coerente_regime;
alter table public.empregadores add constraint empregadores_crt_coerente_regime
  check (
    crt is null or regime_tributario is null
    or (regime_tributario = 'simples' and crt in (1,2))
    or (regime_tributario = 'mei' and crt = 4)
    or (regime_tributario in ('presumido','real') and crt = 3)
  ) not valid;
alter table public.empregadores validate constraint empregadores_crt_coerente_regime;

-- =========================================================
-- NATUREZAS DE OPERAÇÃO — o porquê da saída
-- =========================================================
create table if not exists public.naturezas_operacao (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  codigo text not null,                 -- identificador curto, ex.: 'VENDA_PRODUCAO'
  descricao text not null,              -- vai na tag <natOp> da nota
  tipo_operacao text not null check (tipo_operacao in ('entrada','saida')),
  fin_nfe smallint not null default 1 check (fin_nfe in (1,2,3,4)),
  movimenta_estoque boolean not null default true,
  gera_financeiro boolean not null default true,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (empresa_id, codigo)
);
comment on column public.naturezas_operacao.fin_nfe is
  'Tag <finNFe>: 1 normal, 2 complementar, 3 ajuste, 4 devolução ou retorno.';
comment on column public.naturezas_operacao.gera_financeiro is
  'Bonificação, amostra e remessa saem sem título a receber. Separado de movimenta_estoque porque uma coisa não implica a outra.';

alter table public.naturezas_operacao enable row level security;
drop policy if exists "empresa_scoped_access" on public.naturezas_operacao;
create policy "empresa_scoped_access" on public.naturezas_operacao for all
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()))
  with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

-- Semente das naturezas que a operação da 364 usa hoje. É função e não
-- insert porque a migração não conhece os ids das empresas; a tela chama
-- isso uma vez por empresa. Idempotente.
create or replace function public.fn_seed_naturezas_operacao(p_empresa_id uuid)
returns int
language plpgsql
as $$
declare
  inseridas int;
begin
  insert into public.naturezas_operacao
    (empresa_id, codigo, descricao, tipo_operacao, fin_nfe, movimenta_estoque, gera_financeiro)
  values
    (p_empresa_id, 'VENDA_PRODUCAO',   'Venda de produção do estabelecimento',      'saida',   1, true,  true),
    (p_empresa_id, 'VENDA_REVENDA',    'Venda de mercadoria adquirida de terceiros','saida',   1, true,  true),
    (p_empresa_id, 'DEVOLUCAO_VENDA',  'Devolução de venda',                        'entrada', 4, true,  true),
    (p_empresa_id, 'DEVOLUCAO_COMPRA', 'Devolução de compra',                       'saida',   4, true,  true),
    (p_empresa_id, 'BONIFICACAO',      'Bonificação, doação ou brinde',             'saida',   1, true,  false),
    (p_empresa_id, 'AMOSTRA',          'Remessa de amostra grátis',                 'saida',   1, true,  false),
    (p_empresa_id, 'REMESSA_INDUSTR',  'Remessa para industrialização por encomenda','saida',  1, true,  false),
    (p_empresa_id, 'RETORNO_INDUSTR',  'Retorno de industrialização por encomenda', 'entrada', 1, true,  false),
    (p_empresa_id, 'COMPLEMENTO',      'Nota complementar',                         'saida',   2, false, false)
  on conflict (empresa_id, codigo) do nothing;
  get diagnostics inseridas = row_count;
  return inseridas;
end;
$$;

-- =========================================================
-- REGRAS TRIBUTÁRIAS — a matriz que decide a tributação da linha
-- Alvo em três níveis: produto exato, grupo tributário, ou NCM. Exatamente
-- um deles por regra. O resto da chave é para quem e para onde.
-- =========================================================
create table if not exists public.regras_tributarias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),

  produto_id uuid references public.produtos(id) on delete cascade,
  grupo_tributario_id uuid references public.grupos_tributarios(id) on delete cascade,
  ncm_generico text,

  natureza_operacao_id uuid not null references public.naturezas_operacao(id) on delete cascade,

  uf_destino char(2) not null default '*',      -- '*' = qualquer UF
  destinatario_contribuinte boolean,            -- null = indiferente
  destinatario_consumidor_final boolean,        -- null = indiferente

  -- resultado da resolução
  cfop text not null,
  csosn text,                                   -- Simples Nacional
  cst_icms text,                                -- só se a empresa sair do Simples
  cst_ibs_cbs char(3),
  cclasstrib char(6),

  mod_bc smallint,                              -- tag <modBC>: 0 margem agregada, 1 pauta, 2 preço tabelado, 3 valor da operação
  reducao_base_percentual numeric(6,2),
  mod_bc_st smallint,                           -- tag <modBCST>
  reducao_base_st_percentual numeric(6,2),
  mva_percentual numeric(6,2),
  mva_ajustada boolean not null default false,
  aliquota_interna_destino numeric(5,2),        -- alíquota da UF de destino, base da ST
  fcp_percentual numeric(5,2),
  cbenef text,
  motivo_desoneracao smallint,                  -- tag <motDesICMS>

  -- ST já retida anteriormente (CSOSN 500): a alíquota suportada pelo
  -- consumidor final, tag <pST>, é cadastro e não sai do cálculo desta nota.
  aliquota_st_retido numeric(5,2),

  -- PIS e COFINS. No Simples eles estão no DAS, mas as tags continuam
  -- obrigatórias no XML: a nota do frigorífico sai com CST 06 e alíquota zero
  -- pela Lei 10.925/2004, e a nossa precisa dizer alguma coisa também.
  cst_pis text,
  cst_cofins text,
  aliquota_pis numeric(6,4),
  aliquota_cofins numeric(6,4),

  -- Crédito presumido: código e percentual, quando a UF concede.
  codigo_credito_presumido text,
  percentual_credito_presumido numeric(6,2),

  st_responsavel text not null default 'nao_aplicavel'
    check (st_responsavel in ('substituto','substituido','nao_aplicavel')),
  permite_credito_simples boolean not null default false,
  isento boolean not null default false,
  observacao_fiscal text,                       -- vai para <infAdProd> na nota

  base_legal text,
  prioridade int not null default 100,
  vigencia_inicio date not null default current_date,
  vigencia_fim date,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint regras_tributarias_um_alvo check (
    (produto_id is not null)::int + (grupo_tributario_id is not null)::int
      + (ncm_generico is not null)::int = 1
  ),
  constraint regras_tributarias_uf_formato check (uf_destino = '*' or uf_destino ~ '^[A-Z]{2}$'),
  constraint regras_tributarias_st_exige_mva check (
    st_responsavel <> 'substituto' or mva_percentual is not null
  ),
  constraint regras_tributarias_credito_exige_csosn check (
    not permite_credito_simples or csosn in ('101','201','900')
  )
);
comment on table public.regras_tributarias is
  'Cruza produto, grupo ou NCM com natureza da operação, destinatário e UF, e devolve CFOP, CSOSN, MVA e o resto. É o único lugar onde tributação mora. Corrigir uma regra do contador é um update, não um deploy.';
comment on column public.regras_tributarias.aliquota_st_retido is
  'Tag <pST>. Só faz sentido quando st_responsavel é substituido: é a alíquota que já foi suportada na retenção anterior, e entra na nota junto de vBCSTRet e vICMSSubstituto.';
comment on column public.regras_tributarias.mod_bc is
  'Modalidade de determinação da base. Existe como coluna porque a tag é obrigatória no XML e varia por operação: derivá-la de heurística no gerador é como se perde rastro do porquê de uma base ter saído daquele jeito.';
comment on column public.regras_tributarias.st_responsavel is
  'substituto = esta saída retém ICMS-ST (CSOSN 201/202/203); substituido = a ST já foi retida antes (CSOSN 500); nao_aplicavel = fora do regime.';
comment on column public.regras_tributarias.permite_credito_simples is
  'Quando true, a emissão calcula pCredSN e vCredICMSSN a partir de parametros_simples_nacional na competência da nota e escreve a frase do art. 23 da LC 123/2006 em infAdic. O percentual nunca é fixado aqui: ele muda todo mês com o RBT12.';
comment on column public.regras_tributarias.prioridade is
  'Desempate final. A ordem de especificidade (produto, depois grupo, depois NCM; UF exata antes de coringa) já é aplicada antes disto.';

create index if not exists regras_tributarias_produto_idx
  on public.regras_tributarias (empresa_id, produto_id) where ativo;
create index if not exists regras_tributarias_grupo_idx
  on public.regras_tributarias (empresa_id, grupo_tributario_id) where ativo;
create index if not exists regras_tributarias_ncm_idx
  on public.regras_tributarias (empresa_id, ncm_generico) where ativo;
create index if not exists regras_tributarias_natureza_idx
  on public.regras_tributarias (empresa_id, natureza_operacao_id, uf_destino) where ativo;

alter table public.regras_tributarias enable row level security;
drop policy if exists "empresa_scoped_access" on public.regras_tributarias;
create policy "empresa_scoped_access" on public.regras_tributarias for all
  using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()))
  with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));

drop trigger if exists trg_regras_tributarias_updated_at on public.regras_tributarias;
create trigger trg_regras_tributarias_updated_at before update on public.regras_tributarias
  for each row execute function public.fn_set_updated_at();

-- Resolve a regra mais específica que se aplica à linha do pedido. Devolve
-- zero linhas quando nada casa, e nesse caso a emissão precisa parar: chutar
-- um CFOP padrão é o que produz nota errada que ninguém percebe.
create or replace function public.fn_resolver_regra_tributaria(
  p_empresa_id uuid,
  p_produto_id uuid,
  p_natureza_operacao_id uuid,
  p_uf_destino char(2),
  p_contribuinte boolean default null,
  p_consumidor_final boolean default null,
  p_data date default current_date
)
returns setof public.regras_tributarias
language sql
stable
as $$
  select rt.*
    from public.regras_tributarias rt
    join public.produtos p on p.id = p_produto_id
   where rt.empresa_id = p_empresa_id
     and rt.natureza_operacao_id = p_natureza_operacao_id
     and rt.ativo
     and p_data >= rt.vigencia_inicio
     and (rt.vigencia_fim is null or p_data <= rt.vigencia_fim)
     and (
       rt.produto_id = p.id
       or (rt.grupo_tributario_id is not null and rt.grupo_tributario_id = p.grupo_tributario_id)
       or (rt.ncm_generico is not null and rt.ncm_generico = p.ncm)
     )
     and (rt.uf_destino = '*' or rt.uf_destino = p_uf_destino)
     and (rt.destinatario_contribuinte is null or rt.destinatario_contribuinte is not distinct from p_contribuinte)
     and (rt.destinatario_consumidor_final is null or rt.destinatario_consumidor_final is not distinct from p_consumidor_final)
   order by
     (rt.produto_id is not null) desc,
     (rt.grupo_tributario_id is not null) desc,
     (rt.uf_destino <> '*') desc,
     (rt.destinatario_contribuinte is not null) desc,
     (rt.destinatario_consumidor_final is not null) desc,
     rt.prioridade asc,
     rt.vigencia_inicio desc
   limit 1;
$$;

-- =========================================================
-- PARÂMETROS DO SIMPLES NACIONAL
-- A alíquota efetiva do Simples é função do RBT12 e muda todo mês. É ela que
-- alimenta o pCredSN quando o cliente é do regime normal e pode se creditar.
-- Uma linha por empregador e competência.
-- =========================================================
create table if not exists public.parametros_simples_nacional (
  id uuid primary key default gen_random_uuid(),
  empregador_id uuid not null references public.empregadores(id) on delete cascade,
  competencia date not null,                -- primeiro dia do mês
  anexo text not null check (anexo in ('I','II','III','IV','V')),
  rbt12 numeric(14,2) not null check (rbt12 >= 0),
  aliquota_nominal numeric(6,4) not null,
  parcela_deduzir numeric(14,2) not null default 0,
  percentual_distribuicao_icms numeric(6,4),  -- fatia de ICMS dentro da alíquota, por faixa
  aliquota_credito_icms numeric(6,4),         -- pCredSN já calculado para a competência
  informado_por_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (empregador_id, competencia, anexo)
);
comment on table public.parametros_simples_nacional is
  'Fórmula do art. 60 da Resolução CGSN 140/2018: ((RBT12 * aliquota_nominal - parcela_deduzir) / RBT12) * percentual_distribuicao_icms. Guardar a entrada e o resultado permite reproduzir depois qualquer nota já emitida — na fiscalização, o que vale é a alíquota do mês da operação, não a de hoje.';
comment on column public.parametros_simples_nacional.competencia is
  'Primeiro dia do mês de referência. O RBT12 usado é o dos 12 meses anteriores ao mês anterior ao da operação.';

create index if not exists parametros_simples_nacional_competencia_idx
  on public.parametros_simples_nacional (empregador_id, competencia desc);

alter table public.parametros_simples_nacional enable row level security;
drop policy if exists "empresa_scoped_access" on public.parametros_simples_nacional;
create policy "empresa_scoped_access" on public.parametros_simples_nacional for all
  using (
    auth.role() = 'authenticated'
    and empregador_id in (
      select e.empregador_id from public.empresas e
       where e.id in (select public.empresas_permitidas()) and e.empregador_id is not null
    )
  )
  with check (
    auth.role() = 'authenticated'
    and empregador_id in (
      select e.empregador_id from public.empresas e
       where e.id in (select public.empresas_permitidas()) and e.empregador_id is not null
    )
  );

commit;

-- =========================================================
-- ROLLBACK — descomente o bloco inteiro e rode
-- =========================================================
-- begin;
-- drop function if exists public.fn_resolver_regra_tributaria(uuid, uuid, uuid, char, boolean, boolean, date);
-- drop function if exists public.fn_seed_naturezas_operacao(uuid);
-- drop table if exists public.parametros_simples_nacional;
-- drop trigger if exists trg_regras_tributarias_updated_at on public.regras_tributarias;
-- drop table if exists public.regras_tributarias;
-- drop table if exists public.naturezas_operacao;
-- alter table public.empregadores drop constraint if exists empregadores_crt_coerente_regime;
-- alter table public.empregadores drop constraint if exists empregadores_ambiente_nfe_valido;
-- alter table public.empregadores drop constraint if exists empregadores_crt_valido;
-- alter table public.empregadores drop column if exists ambiente_nfe, drop column if exists iest,
--   drop column if exists crt, drop column if exists inscricao_estadual;
-- alter table public.clientes drop constraint if exists clientes_ativo_fiscal_completo;
-- alter table public.clientes drop constraint if exists clientes_uf_formato;
-- alter table public.clientes drop constraint if exists clientes_ie_coerente_indicador;
-- alter table public.clientes drop constraint if exists clientes_ind_ie_dest_valido;
-- alter table public.clientes drop constraint if exists clientes_tipo_pessoa_valido;
-- alter table public.clientes drop column if exists ativo_fiscal, drop column if exists consumidor_final,
--   drop column if exists email_nfe, drop column if exists cep, drop column if exists uf,
--   drop column if exists municipio, drop column if exists codigo_municipio_ibge, drop column if exists bairro,
--   drop column if exists complemento, drop column if exists numero, drop column if exists logradouro,
--   drop column if exists isuf, drop column if exists ind_ie_dest, drop column if exists ie,
--   drop column if exists cpf, drop column if exists tipo_pessoa;
-- alter table public.materias_primas drop constraint if exists materias_primas_ncm_formato;
-- alter table public.materias_primas drop column if exists revisado_em, drop column if exists revisado_por_id,
--   drop column if exists confianca_sugestao, drop column if exists sugerido_automaticamente,
--   drop column if exists fator_conversao_tributavel, drop column if exists unidade_tributavel,
--   drop column if exists origem_mercadoria, drop column if exists gtin, drop column if exists cest,
--   drop column if exists ncm;
-- drop index if exists public.produtos_ncm_idx;
-- alter table public.produtos drop constraint if exists produtos_ativo_fiscal_completo;
-- alter table public.produtos drop constraint if exists produtos_st_exige_cest;
-- alter table public.produtos drop constraint if exists produtos_peso_coerente;
-- alter table public.produtos drop constraint if exists produtos_gtin_valido;
-- alter table public.produtos drop constraint if exists produtos_ind_escala_valido;
-- alter table public.produtos drop constraint if exists produtos_origem_valida;
-- alter table public.produtos drop constraint if exists produtos_cest_formato;
-- alter table public.produtos drop constraint if exists produtos_ncm_formato;
-- alter table public.produtos drop column if exists revisado_em, drop column if exists revisado_por_id,
--   drop column if exists sugerido_automaticamente, drop column if exists ativo_fiscal,
--   drop column if exists aliquota_transparencia, drop column if exists cnpj_fabricante,
--   drop column if exists ind_escala,
--   drop column if exists cst_ibs_cbs, drop column if exists cclasstrib,
--   drop column if exists rastro_obrigatorio, drop column if exists grupo_tributario_id,
--   drop column if exists sujeito_st, drop column if exists peso_bruto_kg, drop column if exists peso_liquido_kg,
--   drop column if exists fator_conversao_tributavel, drop column if exists unidade_tributavel,
--   drop column if exists origem_mercadoria, drop column if exists gtin_tributavel, drop column if exists gtin,
--   drop column if exists cest, drop column if exists ex_tipi, drop column if exists ncm;
-- drop table if exists public.grupos_tributarios;
-- drop table if exists public.tabela_cclasstrib;
-- drop table if exists public.municipios_ibge;
-- drop table if exists public.tabela_unidade_medida;
-- drop table if exists public.tabela_cfop;
-- drop table if exists public.cest_uf_regra;
-- drop table if exists public.tabela_cest;
-- drop table if exists public.tabela_ncm;
-- drop function if exists public.fn_gtin_valido(text);
-- drop function if exists public.fn_gtin_digito_verificador(text);
-- commit;
