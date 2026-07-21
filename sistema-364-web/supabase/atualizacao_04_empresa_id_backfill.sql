-- =========================================================
-- 364 — ATUALIZAÇÃO 04: EMPRESA_ID NAS TABELAS DE NEGÓCIO
-- Adiciona empresa_id em todas as tabelas operacionais, preenche os
-- registros existentes com "364 Food Service" (preserva os dados reais
-- já cadastrados) e ajusta as unicidades que passam a ser por empresa.
--
-- Inclui, além das 12 tabelas originais, as 7 tabelas de produção
-- avançada (defumação/embalagem/assinaturas/preços por cliente) que já
-- existiam no banco quando esta migração foi escrita — ver
-- atualizacao_08_producao_avancada.sql para o ajuste do trigger que
-- liga embalagem_itens a producoes.
--
-- Rode depois de atualizacao_03_grupos_empresas.sql.
-- =========================================================

do $$
declare
  t text;
  fs_id uuid;
begin
  select id into fs_id from empresas where slug = 'food-service';
  if fs_id is null then
    raise exception 'Empresa "364 Food Service" não encontrada — rode atualizacao_03_grupos_empresas.sql antes.';
  end if;

  for t in select unnest(array[
    'funcionarios','fornecedores','materias_primas','produtos','ficha_tecnica',
    'recebimentos','producoes','producao_consumo','clientes','pedidos','pedido_itens','despesas',
    'defumacoes','defumacao_itens','embalagens','embalagem_itens',
    'assinaturas','assinatura_entregas','cliente_precos'
  ])
  loop
    execute format('alter table %I add column if not exists empresa_id uuid references empresas(id)', t);
    execute format('update %I set empresa_id = $1 where empresa_id is null', t) using fs_id;
    execute format('alter table %I alter column empresa_id set not null', t);
    execute format('create index if not exists %I on %I (empresa_id)', t || '_empresa_id_idx', t);
  end loop;
end $$;

-- ---------- Unicidades que passam a ser por empresa ----------

-- produtos.codigo era único globalmente (constraint inline "unique" nomeada
-- automaticamente pelo Postgres como <tabela>_<coluna>_key); agora é único por empresa.
alter table produtos drop constraint if exists produtos_codigo_key;
alter table produtos add constraint produtos_empresa_codigo_key unique (empresa_id, codigo);

-- funcionarios.user_id era único globalmente (criado em atualizacao_02_cadastro.sql);
-- agora um mesmo login pode ter um registro de funcionário por empresa à qual acessa.
drop index if exists funcionarios_user_id_key;
create unique index if not exists funcionarios_empresa_user_id_key on funcionarios (empresa_id, user_id);
