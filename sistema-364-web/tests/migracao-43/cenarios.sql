-- Cenários da atualização 43: NF-e de saída (documentos, itens, eventos) e
-- reserva atômica de número. Cada bloco falha alto (raise exception) quando a
-- migração não se comporta.
--
-- empresa_a  = 11111111-1111-1111-1111-111111111111 (empregador_a)
-- empresa_b  = 22222222-2222-2222-2222-222222222222 (empregador_a — mesmo CNPJ de A)
-- empregador_a = 99999999-0000-0000-0000-000000000001
-- pedido_a1 = aaaaaaaa-0000-0000-0000-000000000001 (empresa_a)
-- pedido_item_1/2 = bbbbbbbb-...-01 / ...-02 (ambos do pedido_a1)
-- produto_a = cccccccc-0000-0000-0000-000000000001
-- natureza_a = dddddddd-0000-0000-0000-000000000001
--
-- fiscal_numeracao já tem uma linha: empregador_a, modelo 55, homologação,
-- série 1, ultimo_numero 10 (ver fixture.sql).
--
-- UUIDs hardcoded dentro dos blocos do $$ ... $$ (não :'var' do psql) porque a
-- substituição de variável não entra em string dollar-quoted — mesma
-- convenção de tests/migracao-40/cenarios.sql e tests/migracao-36/cenarios.sql.
\set ON_ERROR_STOP on

-- Cenário 1: reservar_numero_fiscal devolve números estritamente crescentes
-- em chamadas sucessivas, e ultimo_numero na linha acompanha.
--
-- Este teste roda dentro de uma única sessão/transação psql: prova o
-- incremento atômico do UPDATE ... RETURNING (a instrução única faz o
-- trabalho), mas NÃO prova a concorrência real de duas sessões disputando a
-- mesma linha ao mesmo tempo — isso depende do lock de linha do Postgres se
-- comportando sob concorrência de verdade, o que exige duas conexões
-- simultâneas. Fica para verificação manual (dois psql abertos ao mesmo
-- tempo chamando a função para a mesma chave) ou para um teste de integração
-- futuro que abra duas conexões de fato.
do $$
declare
  n1 int;
  n2 int;
  n3 int;
  gravado int;
begin
  select * into n1 from public.reservar_numero_fiscal(
    '99999999-0000-0000-0000-000000000001', '55', 'homologacao', 1);
  select * into n2 from public.reservar_numero_fiscal(
    '99999999-0000-0000-0000-000000000001', '55', 'homologacao', 1);
  select * into n3 from public.reservar_numero_fiscal(
    '99999999-0000-0000-0000-000000000001', '55', 'homologacao', 1);

  if n1 <> 11 or n2 <> 12 or n3 <> 13 then
    raise exception 'FALHA 1a: sequência esperada 11,12,13 saiu %,%,%', n1, n2, n3;
  end if;

  select ultimo_numero into gravado from public.fiscal_numeracao
   where empregador_id = '99999999-0000-0000-0000-000000000001' and modelo = '55'
     and ambiente = 'homologacao' and serie = 1;
  if gravado <> n3 then
    raise exception 'FALHA 1b: ultimo_numero gravado (%) não acompanhou o último devolvido (%)', gravado, n3;
  end if;

  raise notice 'OK 1: números estritamente crescentes (11,12,13) e ultimo_numero acompanha';
end $$;

-- Cenário 2: chave inexistente em fiscal_numeracao devolve ZERO LINHAS — não
-- erro, não null silencioso. A série 2 para este empregador/modelo/ambiente
-- nunca foi cadastrada em fiscal_numeracao (ver fixture.sql). Testado nas
-- duas formas de chamada (lista de SELECT e FROM), porque com "returns setof
-- int" as duas convergem em zero linhas — o que não aconteceria se a função
-- fosse escalar ("returns int"): aí uma chave ausente devolveria uma linha
-- com null, disfarçando "sem numeração cadastrada" de "número reservado é
-- nulo", que é exatamente o null silencioso que a função tem de evitar.
do $$
declare
  n int;
begin
  select count(*) into n from public.reservar_numero_fiscal(
    '99999999-0000-0000-0000-000000000001', '55', 'homologacao', 2);
  if n <> 0 then
    raise exception 'FALHA 2a: chave inexistente (FROM) devolveu % linha(s) em vez de zero', n;
  end if;

  select count(*) into n from (
    select public.reservar_numero_fiscal(
      '99999999-0000-0000-0000-000000000001', '55', 'homologacao', 2)
  ) s;
  if n <> 0 then
    raise exception 'FALHA 2b: chave inexistente (lista de SELECT) devolveu % linha(s) em vez de zero', n;
  end if;

  raise notice 'OK 2: chave inexistente em fiscal_numeracao devolve zero linhas (não erro, não null)';
end $$;

-- Cenário 3: nfe_saida_documentos_numero_unico rejeita duas notas com mesmo
-- empregador+modelo+ambiente+série+número; aceita número repetido em série ou
-- ambiente diferentes.
insert into public.nfe_saida_documentos
  (id, empresa_id, empregador_id, pedido_id, natureza_operacao_id, ambiente, serie, numero)
  values ('eeeeeeee-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
          '99999999-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
          'dddddddd-0000-0000-0000-000000000001', 'homologacao', 1, 100);

do $$
begin
  begin
    insert into public.nfe_saida_documentos
      (empresa_id, empregador_id, pedido_id, natureza_operacao_id, ambiente, serie, numero)
      values ('11111111-1111-1111-1111-111111111111', '99999999-0000-0000-0000-000000000001',
              'aaaaaaaa-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
              'homologacao', 1, 100);
    raise exception 'FALHA 3a: segunda nota com mesmo empregador+modelo+ambiente+série+número foi aceita';
  exception when unique_violation then null;
  end;

  -- mesma numeração, série diferente: passa
  insert into public.nfe_saida_documentos
    (empresa_id, empregador_id, pedido_id, natureza_operacao_id, ambiente, serie, numero)
    values ('11111111-1111-1111-1111-111111111111', '99999999-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
            'homologacao', 2, 100);

  -- mesma numeração e série, ambiente diferente: passa
  insert into public.nfe_saida_documentos
    (empresa_id, empregador_id, pedido_id, natureza_operacao_id, ambiente, serie, numero)
    values ('11111111-1111-1111-1111-111111111111', '99999999-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
            'producao', 1, 100);

  raise notice 'OK 3: número é único por empregador+modelo+ambiente+série; série/ambiente diferentes liberam repetir';
end $$;

-- Cenário 4: nfe_saida_documentos_chave_unica rejeita chave duplicada, e
-- permite várias linhas com chave null (rascunhos ainda sem número).
insert into public.nfe_saida_documentos
  (empresa_id, empregador_id, pedido_id, natureza_operacao_id, ambiente, chave)
  values ('11111111-1111-1111-1111-111111111111', '99999999-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
          'homologacao', repeat('4', 44));

do $$
begin
  begin
    insert into public.nfe_saida_documentos
      (empresa_id, empregador_id, pedido_id, natureza_operacao_id, ambiente, chave)
      values ('11111111-1111-1111-1111-111111111111', '99999999-0000-0000-0000-000000000001',
              'aaaaaaaa-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
              'homologacao', repeat('4', 44));
    raise exception 'FALHA 4a: chave duplicada foi aceita';
  exception when unique_violation then null;
  end;

  -- rascunhos sem número/chave: várias linhas com chave null convivem
  insert into public.nfe_saida_documentos
    (empresa_id, empregador_id, pedido_id, natureza_operacao_id, ambiente)
    values ('11111111-1111-1111-1111-111111111111', '99999999-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
            'homologacao');
  insert into public.nfe_saida_documentos
    (empresa_id, empregador_id, pedido_id, natureza_operacao_id, ambiente)
    values ('11111111-1111-1111-1111-111111111111', '99999999-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
            'homologacao');

  raise notice 'OK 4: chave é única quando presente; vários rascunhos com chave null convivem';
end $$;

-- Cenário 5: nfe_saida_itens_numero_unico rejeita dois itens com o mesmo
-- numero_item no mesmo documento.
insert into public.nfe_saida_itens
  (nfe_saida_documento_id, empresa_id, pedido_item_id, produto_id, numero_item,
   codigo, descricao, ncm, cfop, unidade, quantidade, valor_unitario, valor_total)
  values ('eeeeeeee-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
          'bbbbbbbb-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 1,
          'PROD-001', 'Costela defumada', '02102000', '5101', 'KG', 2.5000, 45.9000000000, 114.75);

do $$
begin
  begin
    insert into public.nfe_saida_itens
      (nfe_saida_documento_id, empresa_id, pedido_item_id, produto_id, numero_item,
       codigo, descricao, ncm, cfop, unidade, quantidade, valor_unitario, valor_total)
      values ('eeeeeeee-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
              'bbbbbbbb-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000001', 1,
              'PROD-002', 'Linguiça defumada', '16010020', '5101', 'KG', 1.0000, 30.0000000000, 30.00);
    raise exception 'FALHA 5a: dois itens com o mesmo numero_item no mesmo documento foram aceitos';
  exception when unique_violation then null;
  end;

  insert into public.nfe_saida_itens
    (nfe_saida_documento_id, empresa_id, pedido_item_id, produto_id, numero_item,
     codigo, descricao, ncm, cfop, unidade, quantidade, valor_unitario, valor_total)
    values ('eeeeeeee-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
            'bbbbbbbb-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000001', 2,
            'PROD-002', 'Linguiça defumada', '16010020', '5101', 'KG', 1.0000, 30.0000000000, 30.00);

  raise notice 'OK 5: numero_item é único por documento; segundo número no mesmo documento passa';
end $$;

-- Cenário 6: RLS ligada nas três tabelas, e a única policy criada é de
-- SELECT — nenhuma escrita liberada para authenticated (a gravação é do
-- pipeline de emissão, via service role).
do $$
declare
  t text;
  escritas int;
begin
  foreach t in array array['nfe_saida_documentos','nfe_saida_itens','nfe_saida_eventos'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception 'FALHA 6a: RLS desligada em %', t;
    end if;
  end loop;

  select count(*) into escritas from pg_policies
   where schemaname = 'public'
     and tablename in ('nfe_saida_documentos','nfe_saida_itens','nfe_saida_eventos')
     and cmd <> 'SELECT';
  if escritas <> 0 then
    raise exception 'FALHA 6b: existe(m) % policy(ies) de escrita para authenticated nas tabelas de NF-e de saída', escritas;
  end if;

  raise notice 'OK 6: RLS ligada nas três tabelas, só com policy de SELECT (escrita é do service role)';
end $$;

select 'CENÁRIOS DA 43 OK' as resultado;
