-- =========================================================
-- 364 — ATUALIZAÇÃO 23: CNPJ DE FORNECEDOR SÓ COM DÍGITOS
-- O CNPJ do fornecedor era texto livre, então o mesmo fornecedor podia estar
-- cadastrado como '12.345.678/0001-99' e a NF-e trazer '12345678000199'. A rota
-- /preparar casa o emitente da nota com o fornecedor por igualdade de CNPJ, e
-- fornecedor cadastrado com pontuação nunca casava: a tela mandava cadastrar de
-- novo e o cadastro ganhava um duplicado.
--
-- Esta migração faz três coisas, nesta ordem:
--   1. tira a pontuação dos CNPJ já cadastrados;
--   2. FUNDE os fornecedores que viram duplicados por causa disso — sem este
--      passo o passo 1 criaria duas linhas com o mesmo (empresa_id, cnpj), e o
--      .maybeSingle() da rota /preparar passaria a dar erro de "mais de uma
--      linha", trocando um casamento que só falhava por uma importação travada;
--   3. cria o índice único que impede o duplicado de voltar.
--
-- ⚠️ ATENÇÃO — O PASSO 2 É DESTRUTIVO E IRREVERSÍVEL. Ele apaga linhas de
-- `fornecedores` e reaponta as chaves estrangeiras que dependiam delas.
-- FAÇA BACKUP DO BANCO ANTES DE RODAR. Se qualquer coisa não puder ser fundida
-- com segurança, a migração aborta inteira (está tudo numa transação) com uma
-- mensagem dizendo o que impediu — nunca funde pela metade.
--
-- O formulário de Fornecedores também já grava só dígitos (app/fornecedores/page.js).
--
-- Rode depois de atualizacao_22_nfe_documentos.sql.
-- =========================================================

begin;

-- ---------- 1. NORMALIZAÇÃO ----------
-- CNPJ que só tinha pontuação (ou espaço em branco) vira null em vez de string
-- vazia — a coluna é opcional.
update public.fornecedores
   set cnpj = nullif(regexp_replace(cnpj, '\D', '', 'g'), '')
 where cnpj is not null
   and cnpj is distinct from nullif(regexp_replace(cnpj, '\D', '', 'g'), '');

-- ---------- 2. FUSÃO DOS DUPLICADOS ----------
do $$
declare
  refs      record;
  ligacoes  text[][] := array[]::text[];  -- trios {schema, tabela, coluna} que apontam pra fornecedores
  grupo     record;
  sobrevive uuid;
  perdedores uuid[];
  i         int;
  restantes bigint;
  fundidos  int := 0;
begin
  -- Levanta no catálogo toda chave estrangeira que aponta pra fornecedores(id).
  -- Não dá pra confiar na lista de tabelas do repositório: o banco de produção
  -- tem tabela sem migração versionada, e esquecer uma órfã dados reais.
  for refs in
    select con.conname    as nome,
           nsp.nspname    as esquema,
           rel.relname    as tabela,
           con.conkey     as colunas_origem,
           con.confkey    as colunas_destino,
           con.conrelid   as oid_tabela
      from pg_constraint con
      join pg_class     rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
     where con.contype = 'f'
       and con.confrelid = 'public.fornecedores'::regclass
     order by 2, 3
  loop
    if array_length(refs.colunas_origem, 1) <> 1 then
      raise exception
        'A chave estrangeira % em %.% usa mais de uma coluna para apontar para fornecedores. '
        'Não sei fundir isso com segurança — funda esses fornecedores à mão e rode a migração de novo.',
        refs.nome, refs.esquema, refs.tabela;
    end if;

    if (select attname from pg_attribute
         where attrelid = 'public.fornecedores'::regclass
           and attnum = refs.colunas_destino[1]) <> 'id' then
      raise exception
        'A chave estrangeira % em %.% aponta para uma coluna de fornecedores que não é o id. '
        'Não sei fundir isso com segurança — funda esses fornecedores à mão e rode a migração de novo.',
        refs.nome, refs.esquema, refs.tabela;
    end if;

    ligacoes := ligacoes || array[array[
      refs.esquema,
      refs.tabela,
      (select attname from pg_attribute
        where attrelid = refs.oid_tabela and attnum = refs.colunas_origem[1])
    ]];
  end loop;

  -- Um grupo por (empresa_id, cnpj) com mais de uma linha depois da normalização.
  -- Sobrevive o cadastro mais antigo: numa dupla criada por causa do casamento que
  -- falhava, o antigo é o original e o novo é o duplicado que a tela mandou criar.
  for grupo in
    select empresa_id, cnpj,
           (array_agg(id order by created_at, id))[1]                as manter,
           (array_agg(id order by created_at, id))[2:]               as remover
      from public.fornecedores
     where cnpj is not null
     group by empresa_id, cnpj
    having count(*) > 1
  loop
    sobrevive  := grupo.manter;
    perdedores := grupo.remover;

    -- Reaponta cada referência dos perdedores para o sobrevivente, antes de apagar.
    for i in 1 .. coalesce(array_length(ligacoes, 1), 0) loop
      execute format('update %I.%I set %I = $1 where %I = any($2)',
                     ligacoes[i][1], ligacoes[i][2], ligacoes[i][3], ligacoes[i][3])
        using sobrevive, perdedores;
    end loop;

    -- Cinto e suspensório: se sobrou alguma referência, aborta em vez de apagar
    -- linha que ainda é apontada por dado real.
    for i in 1 .. coalesce(array_length(ligacoes, 1), 0) loop
      execute format('select count(*) from %I.%I where %I = any($1)',
                     ligacoes[i][1], ligacoes[i][2], ligacoes[i][3])
        into restantes using perdedores;
      if restantes > 0 then
        raise exception
          'Ainda restam % referências a fornecedor duplicado em %.%(%) depois do reapontamento. '
          'A migração foi desfeita — nada foi apagado.',
          restantes, ligacoes[i][1], ligacoes[i][2], ligacoes[i][3];
      end if;
    end loop;

    delete from public.fornecedores where id = any(perdedores);
    fundidos := fundidos + array_length(perdedores, 1);
  end loop;

  if fundidos > 0 then
    raise notice 'Fornecedores duplicados fundidos: %.', fundidos;
  end if;
end $$;

-- ---------- 3. O DUPLICADO NÃO VOLTA ----------
-- Só dígitos, sem exigir os 14 do CNPJ: produtor rural e MEI aparecem no cadastro
-- com CPF (11 dígitos), e travar o tamanho impediria esse cadastro.
alter table public.fornecedores drop constraint if exists fornecedores_cnpj_digitos;
alter table public.fornecedores add constraint fornecedores_cnpj_digitos
  check (cnpj is null or cnpj ~ '^[0-9]+$');

-- Índice parcial, no mesmo padrão do recebimentos_empresa_nfe_chave_idx da 21:
-- fornecedor sem CNPJ (o cadastro é opcional) continua podendo repetir.
create unique index if not exists fornecedores_empresa_cnpj_idx
  on public.fornecedores (empresa_id, cnpj) where cnpj is not null;

commit;
