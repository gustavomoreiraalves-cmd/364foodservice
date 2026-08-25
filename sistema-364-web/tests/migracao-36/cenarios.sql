-- Cenários da atualização 36: cadastro fiscal e motor de regras tributárias.
-- Cada bloco falha alto (raise exception) quando a migração não se comporta.
\set ON_ERROR_STOP on
\set empresa '11111111-1111-1111-1111-111111111111'
\set empregador '99999999-0000-0000-0000-000000000001'

-- Cenário 1: dígito verificador do GTIN, contra vetores conhecidos.
do $$
begin
  if public.fn_gtin_digito_verificador('7891910000197') <> 7 then
    raise exception 'FALHA 1a: DV de EAN-13 conhecido saiu errado';
  end if;
  if public.fn_gtin_digito_verificador('12345670') <> 0 then
    raise exception 'FALHA 1b: DV de EAN-8 conhecido saiu errado';
  end if;
  if not public.fn_gtin_valido('0614141000012') then
    raise exception 'FALHA 1c: GTIN-13 válido foi recusado';
  end if;
  if public.fn_gtin_valido('7891910000198') then
    raise exception 'FALHA 1d: GTIN com DV errado foi aceito';
  end if;
  if public.fn_gtin_valido('789191000019') then
    raise exception 'FALHA 1e: GTIN com 12 dígitos e DV errado foi aceito';
  end if;
  if public.fn_gtin_valido('789') then
    raise exception 'FALHA 1f: GTIN de tamanho inválido foi aceito';
  end if;
  if not public.fn_gtin_valido('SEM GTIN') then
    raise exception 'FALHA 1g: literal SEM GTIN, exigido pelo layout, foi recusado';
  end if;
  if not public.fn_gtin_valido(null) then
    raise exception 'FALHA 1h: nulo deveria passar (produto ainda sem cadastro fiscal)';
  end if;
  raise notice 'OK 1: dígito verificador do GTIN bate com os vetores';
end $$;

-- Cenário 2: produto aceita bloco fiscal completo e recusa NCM malformado.
insert into public.produtos (id, empresa_id, codigo, nome, unidade, ncm, cest, gtin,
                             gtin_tributavel, origem_mercadoria, unidade_tributavel,
                             fator_conversao_tributavel, peso_liquido_kg, peso_bruto_kg,
                             sujeito_st, producao_interna)
  values ('bbbbbbbb-0000-0000-0000-000000000001', :'empresa', 'DEF-001',
          'Costela defumada', 'PC', '02102000', '1708300', '7891910000197',
          '7891910000197', 0, 'KG', 1.2000, 1.1000, 1.2000, true, true);

do $$
begin
  begin
    insert into public.produtos (empresa_id, codigo, nome, ncm)
      values ('11111111-1111-1111-1111-111111111111', 'X-1', 'NCM curto', '0210');
    raise exception 'FALHA 2a: NCM com menos de 8 dígitos foi aceito';
  exception when check_violation then null;
  end;
  begin
    insert into public.produtos (empresa_id, codigo, nome, gtin)
      values ('11111111-1111-1111-1111-111111111111', 'X-2', 'GTIN torto', '7891910000198');
    raise exception 'FALHA 2b: GTIN com DV errado foi aceito no cadastro';
  exception when check_violation then null;
  end;
  begin
    insert into public.produtos (empresa_id, codigo, nome, sujeito_st)
      values ('11111111-1111-1111-1111-111111111111', 'X-3', 'ST sem CEST', true);
    raise exception 'FALHA 2c: produto em ST sem CEST foi aceito (a SEFAZ rejeitaria a nota)';
  exception when check_violation then null;
  end;
  begin
    insert into public.produtos (empresa_id, codigo, nome, peso_liquido_kg, peso_bruto_kg)
      values ('11111111-1111-1111-1111-111111111111', 'X-4', 'Peso invertido', 5.0, 2.0);
    raise exception 'FALHA 2d: peso bruto menor que o líquido foi aceito';
  exception when check_violation then null;
  end;
  raise notice 'OK 2: constraints fiscais de produtos barram cadastro que viraria rejeição';
end $$;

-- Cenário 3: a trava ativo_fiscal só libera com o mínimo preenchido.
do $$
begin
  begin
    insert into public.produtos (empresa_id, codigo, nome, ncm, ativo_fiscal)
      values ('11111111-1111-1111-1111-111111111111', 'X-5', 'Meio cadastrado', '02102000', true);
    raise exception 'FALHA 3a: produto marcado como pronto sem origem/unidade tributável';
  exception when check_violation then null;
  end;
  update public.produtos set ativo_fiscal = true
   where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  raise notice 'OK 3: ativo_fiscal exige o bloco fiscal completo';
end $$;

-- Cenário 4: cliente. IE tem de ser coerente com o indicador, e a trava
-- fiscal exige endereço inteiro.
insert into public.clientes (id, empresa_id, nome, cnpj, tipo_pessoa, ie, ind_ie_dest,
                             consumidor_final, logradouro, numero, bairro,
                             codigo_municipio_ibge, municipio, uf, cep)
  values ('cccccccc-0000-0000-0000-000000000001', :'empresa', 'Mercado Central', '98765432000188',
          'J', '00000000000', 1, false, 'Av. Brasil', '1000', 'Centro',
          '1100205', 'Porto Velho', 'RO', '76801000');

do $$
begin
  begin
    insert into public.clientes (empresa_id, nome, ind_ie_dest, ie)
      values ('11111111-1111-1111-1111-111111111111', 'Contribuinte sem IE', 1, null);
    raise exception 'FALHA 4a: indIEDest 1 sem inscrição estadual foi aceito';
  exception when check_violation then null;
  end;
  begin
    insert into public.clientes (empresa_id, nome, ind_ie_dest, ie)
      values ('11111111-1111-1111-1111-111111111111', 'Não contribuinte com IE', 9, '123');
    raise exception 'FALHA 4b: indIEDest 9 com IE preenchida foi aceito';
  exception when check_violation then null;
  end;
  begin
    insert into public.clientes (empresa_id, nome, ativo_fiscal)
      values ('11111111-1111-1111-1111-111111111111', 'Cliente vazio', true);
    raise exception 'FALHA 4c: cliente sem endereço foi marcado como pronto para emitir';
  exception when check_violation then null;
  end;
  update public.clientes set ativo_fiscal = true
   where id = 'cccccccc-0000-0000-0000-000000000001';
  raise notice 'OK 4: bloco do destinatário exige IE coerente e endereço completo';
end $$;

-- Cenário 5: CRT do emitente não pode divergir do regime tributário.
do $$
begin
  begin
    update public.empregadores set crt = 3 where id = '99999999-0000-0000-0000-000000000001';
    raise exception 'FALHA 5a: empresa do Simples aceitou CRT 3 (regime normal)';
  exception when check_violation then null;
  end;
  update public.empregadores set crt = 1, inscricao_estadual = '00000000000001'
   where id = '99999999-0000-0000-0000-000000000001';
  if (select ambiente_nfe from public.empregadores
       where id = '99999999-0000-0000-0000-000000000001') <> 2 then
    raise exception 'FALHA 5b: ambiente da NF-e não nasceu em homologação';
  end if;
  raise notice 'OK 5: CRT coerente com o regime e ambiente nasce em homologação';
end $$;

-- Cenário 6: naturezas de operação. A semente é idempotente.
do $$
declare
  primeira int;
  segunda int;
begin
  primeira := public.fn_seed_naturezas_operacao('11111111-1111-1111-1111-111111111111');
  segunda  := public.fn_seed_naturezas_operacao('11111111-1111-1111-1111-111111111111');
  if primeira < 9 then
    raise exception 'FALHA 6a: semente inseriu só % naturezas', primeira;
  end if;
  if segunda <> 0 then
    raise exception 'FALHA 6b: segunda chamada da semente duplicou % linhas', segunda;
  end if;
  if (select fin_nfe from public.naturezas_operacao
       where empresa_id = '11111111-1111-1111-1111-111111111111'
         and codigo = 'DEVOLUCAO_VENDA') <> 4 then
    raise exception 'FALHA 6c: devolução de venda não saiu com finNFe 4';
  end if;
  if (select gera_financeiro from public.naturezas_operacao
       where empresa_id = '11111111-1111-1111-1111-111111111111'
         and codigo = 'BONIFICACAO') then
    raise exception 'FALHA 6d: bonificação não deveria gerar título a receber';
  end if;
  raise notice 'OK 6: semente de naturezas é idempotente e classifica finNFe';
end $$;

-- Cenário 7: a regra tributária exige exatamente um alvo, e coerência interna.
insert into public.grupos_tributarios (id, empresa_id, codigo, descricao)
  values ('dddddddd-0000-0000-0000-000000000001', :'empresa', 'DEFUMADO_ST',
          'Defumado sem cocção, NCM 0210, em substituição tributária');
update public.produtos set grupo_tributario_id = 'dddddddd-0000-0000-0000-000000000001'
 where id = 'bbbbbbbb-0000-0000-0000-000000000001';

do $$
declare
  natureza uuid;
begin
  select id into natureza from public.naturezas_operacao
   where empresa_id = '11111111-1111-1111-1111-111111111111' and codigo = 'VENDA_PRODUCAO';

  begin
    insert into public.regras_tributarias
      (empresa_id, produto_id, ncm_generico, natureza_operacao_id, cfop)
      values ('11111111-1111-1111-1111-111111111111',
              'bbbbbbbb-0000-0000-0000-000000000001', '02102000', natureza, '5101');
    raise exception 'FALHA 7a: regra com dois alvos ao mesmo tempo foi aceita';
  exception when check_violation then null;
  end;

  begin
    insert into public.regras_tributarias
      (empresa_id, natureza_operacao_id, cfop)
      values ('11111111-1111-1111-1111-111111111111', natureza, '5101');
    raise exception 'FALHA 7b: regra sem alvo nenhum foi aceita';
  exception when integrity_constraint_violation then null;
  end;

  begin
    insert into public.regras_tributarias
      (empresa_id, ncm_generico, natureza_operacao_id, cfop, st_responsavel)
      values ('11111111-1111-1111-1111-111111111111', '02102000', natureza, '5401', 'substituto');
    raise exception 'FALHA 7c: regra de substituto sem MVA foi aceita';
  exception when check_violation then null;
  end;

  begin
    insert into public.regras_tributarias
      (empresa_id, ncm_generico, natureza_operacao_id, cfop, csosn, permite_credito_simples)
      values ('11111111-1111-1111-1111-111111111111', '02102000', natureza, '5102', '102', true);
    raise exception 'FALHA 7d: crédito do Simples liberado em CSOSN que não permite crédito';
  exception when check_violation then null;
  end;

  raise notice 'OK 7: regra tributária exige um alvo, MVA no substituto e CSOSN coerente';
end $$;

-- Cenário 8: precedência da resolução — produto vence grupo, que vence NCM;
-- UF exata vence coringa; regra fora de vigência não aparece.
do $$
declare
  natureza uuid;
  achada public.regras_tributarias;
begin
  select id into natureza from public.naturezas_operacao
   where empresa_id = '11111111-1111-1111-1111-111111111111' and codigo = 'VENDA_PRODUCAO';

  -- a mais genérica de todas
  insert into public.regras_tributarias
    (empresa_id, ncm_generico, natureza_operacao_id, cfop, csosn, base_legal)
    values ('11111111-1111-1111-1111-111111111111', '02102000', natureza, '5102', '102', 'por NCM');

  select * into achada from public.fn_resolver_regra_tributaria(
    '11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001',
    natureza, 'RO', true, false);
  if achada.base_legal <> 'por NCM' then
    raise exception 'FALHA 8a: regra por NCM não foi encontrada (achou %)', coalesce(achada.base_legal, 'nada');
  end if;

  -- grupo tributário é mais específico que NCM
  insert into public.regras_tributarias
    (empresa_id, grupo_tributario_id, natureza_operacao_id, cfop, csosn,
     st_responsavel, mva_percentual, aliquota_interna_destino, base_legal)
    values ('11111111-1111-1111-1111-111111111111', 'dddddddd-0000-0000-0000-000000000001',
            natureza, '5401', '201', 'substituto', 35.00, 19.50, 'por grupo');

  select * into achada from public.fn_resolver_regra_tributaria(
    '11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001',
    natureza, 'RO', true, false);
  if achada.base_legal <> 'por grupo' then
    raise exception 'FALHA 8b: grupo tributário não venceu a regra por NCM (achou %)', achada.base_legal;
  end if;

  -- produto exato vence o grupo
  insert into public.regras_tributarias
    (empresa_id, produto_id, natureza_operacao_id, cfop, csosn, base_legal)
    values ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001',
            natureza, '5101', '102', 'por produto');

  select * into achada from public.fn_resolver_regra_tributaria(
    '11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001',
    natureza, 'RO', true, false);
  if achada.base_legal <> 'por produto' then
    raise exception 'FALHA 8c: regra por produto não venceu a por grupo (achou %)', achada.base_legal;
  end if;

  -- consumidor final tem regra própria e vence a que é indiferente
  insert into public.regras_tributarias
    (empresa_id, produto_id, natureza_operacao_id, cfop, csosn,
     destinatario_consumidor_final, base_legal)
    values ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001',
            natureza, '5101', '102', true, 'consumidor final');

  select * into achada from public.fn_resolver_regra_tributaria(
    '11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001',
    natureza, 'RO', false, true);
  if achada.base_legal <> 'consumidor final' then
    raise exception 'FALHA 8d: venda a consumidor final caiu na regra genérica (achou %)', achada.base_legal;
  end if;

  -- e o revendedor continua na regra de antes
  select * into achada from public.fn_resolver_regra_tributaria(
    '11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001',
    natureza, 'RO', true, false);
  if achada.base_legal <> 'por produto' then
    raise exception 'FALHA 8e: regra de consumidor final vazou para o revendedor (achou %)', achada.base_legal;
  end if;

  raise notice 'OK 8: resolução respeita produto > grupo > NCM e destinatário específico';
end $$;

-- Cenário 9: vigência e ausência de regra.
do $$
declare
  natureza uuid;
  quantas int;
begin
  select id into natureza from public.naturezas_operacao
   where empresa_id = '11111111-1111-1111-1111-111111111111' and codigo = 'VENDA_PRODUCAO';

  -- data anterior à vigência de todas as regras: nada casa
  select count(*) into quantas from public.fn_resolver_regra_tributaria(
    '11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001',
    natureza, 'RO', true, false, current_date - 1);
  if quantas <> 0 then
    raise exception 'FALHA 9a: regra respondeu para data anterior à vigência';
  end if;

  -- natureza sem nenhuma regra escrita: também nada, e a emissão deve parar
  select count(*) into quantas from public.fn_resolver_regra_tributaria(
    '11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001',
    (select id from public.naturezas_operacao
      where empresa_id = '11111111-1111-1111-1111-111111111111' and codigo = 'BONIFICACAO'),
    'RO', true, false);
  if quantas <> 0 then
    raise exception 'FALHA 9b: natureza sem regra devolveu algo em vez de nada';
  end if;

  -- regra desativada some
  update public.regras_tributarias set ativo = false
   where empresa_id = '11111111-1111-1111-1111-111111111111' and base_legal = 'por produto';
  select count(*) into quantas from public.fn_resolver_regra_tributaria(
    '11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001',
    natureza, 'RO', true, false);
  if quantas <> 1 then
    raise exception 'FALHA 9c: esperava cair na regra por grupo, achou % linhas', quantas;
  end if;
  update public.regras_tributarias set ativo = true
   where empresa_id = '11111111-1111-1111-1111-111111111111' and base_legal = 'por produto';

  raise notice 'OK 9: vigência, ausência de regra e desativação se comportam';
end $$;

-- Cenário 10: parâmetros do Simples Nacional, um por competência.
insert into public.parametros_simples_nacional
  (empregador_id, competencia, anexo, rbt12, aliquota_nominal, parcela_deduzir,
   percentual_distribuicao_icms, aliquota_credito_icms)
  values (:'empregador', '2026-08-01', 'II', 1800000.00, 0.1020, 22500.00, 0.3200, 0.0286);

do $$
begin
  begin
    insert into public.parametros_simples_nacional
      (empregador_id, competencia, anexo, rbt12, aliquota_nominal)
      values ('99999999-0000-0000-0000-000000000001', '2026-08-01', 'II', 1800000.00, 0.1020);
    raise exception 'FALHA 10a: duas linhas para a mesma competência e anexo';
  exception when unique_violation then null;
  end;
  begin
    insert into public.parametros_simples_nacional
      (empregador_id, competencia, anexo, rbt12, aliquota_nominal)
      values ('99999999-0000-0000-0000-000000000001', '2026-09-01', 'VI', 1800000.00, 0.1020);
    raise exception 'FALHA 10b: anexo fora da lista I-V foi aceito';
  exception when check_violation then null;
  end;
  raise notice 'OK 10: parâmetros do Simples são únicos por competência e anexo';
end $$;

-- Cenário 11: RLS ligada em todas as tabelas novas e nas auxiliares.
do $$
declare
  t text;
  sem_rls text := '';
begin
  foreach t in array array['grupos_tributarios','naturezas_operacao','regras_tributarias',
                           'parametros_simples_nacional','tabela_ncm','tabela_cest',
                           'cest_uf_regra','tabela_cfop','tabela_unidade_medida',
                           'municipios_ibge','tabela_cclasstrib']
  loop
    if not (select relrowsecurity from pg_class
             where oid = ('public.' || t)::regclass) then
      sem_rls := sem_rls || ' ' || t;
    end if;
  end loop;
  if sem_rls <> '' then
    raise exception 'FALHA 11: tabelas sem RLS:%', sem_rls;
  end if;
  raise notice 'OK 11: RLS ligada em todas as tabelas da 36';
end $$;

-- Cenário 12: tabela oficial não é editável por usuário autenticado — só a
-- service role escreve. A policy de leitura existe, a de escrita não.
do $$
declare
  escritas int;
begin
  select count(*) into escritas from pg_policies
   where schemaname = 'public' and tablename = 'tabela_ncm' and cmd <> 'SELECT';
  if escritas <> 0 then
    raise exception 'FALHA 12: tabela_ncm tem % policy(ies) de escrita para usuário comum', escritas;
  end if;
  raise notice 'OK 12: tabelas oficiais são somente leitura para o app';
end $$;

-- Cenário 13: cest_uf_regra separa "não verificado" de "verificado e fora da
-- ST". Confundir os dois é o que faria a emissão tratar ignorância como
-- ausência de imposto.
do $$
begin
  insert into public.tabela_cest (cest, ncm, descricao, anexo_convenio, item_convenio)
    values ('1708300', '02102000', 'Carne bovina salgada, seca ou defumada', 'Anexo XVII', '83.0')
    on conflict do nothing;
  insert into public.tabela_cest (cest, ncm, descricao, anexo_convenio, item_convenio)
    values ('1707906', '16025000', 'Outras preparações de carne bovina', 'Anexo XVII', '79.6')
    on conflict do nothing;

  -- adotado por RO: precisa de MVA
  insert into public.cest_uf_regra (uf, cest, mva_original, aliquota_interna, base_legal)
    values ('RO', '1708300', 35.00, 19.50, 'Tabela XVII, item 83.0');

  begin
    insert into public.cest_uf_regra (uf, cest, aliquota_interna, base_legal)
      values ('RO', '1707600', 19.50, 'sem MVA e marcado como sujeito a ST');
    raise exception 'FALHA 13a: item marcado como sujeito a ST sem MVA foi aceito';
  exception when check_violation then null;
  end;

  -- não adotado por RO: linha existe justamente para registrar a verificação
  insert into public.cest_uf_regra (uf, cest, sujeito_st, aliquota_interna, base_legal)
    values ('RO', '1707906', false, 19.50, 'item 79.6 ausente do corpo da Tabela XVII');

  if (select sujeito_st from public.cest_uf_regra
       where uf = 'RO' and cest = '1707906') then
    raise exception 'FALHA 13b: item não adotado por RO ficou marcado como sujeito a ST';
  end if;
  if not (select sujeito_st from public.cest_uf_regra
           where uf = 'RO' and cest = '1708300') then
    raise exception 'FALHA 13c: item adotado por RO deveria nascer sujeito a ST';
  end if;
  if exists (select 1 from public.cest_uf_regra where uf = 'RO' and cest = '1708701') then
    raise exception 'FALHA 13d: CEST não verificado não deveria ter linha nenhuma';
  end if;
  raise notice 'OK 13: ausência de linha e sujeito_st false são estados distintos';
end $$;

-- Cenário 14: campos que o cadastro do PDV Consumer revelou como necessários —
-- escala relevante, fabricante e Lei da Transparência.
do $$
begin
  begin
    insert into public.produtos (empresa_id, codigo, nome, ind_escala)
      values ('11111111-1111-1111-1111-111111111111', 'X-6', 'Escala N sem fabricante', 'N');
    raise exception 'FALHA 14a: indEscala N sem CNPJ do fabricante foi aceito';
  exception when check_violation then null;
  end;
  begin
    insert into public.produtos (empresa_id, codigo, nome, ind_escala)
      values ('11111111-1111-1111-1111-111111111111', 'X-7', 'Escala inválida', 'X');
    raise exception 'FALHA 14b: indEscala fora de S/N foi aceito';
  exception when check_violation then null;
  end;
  insert into public.produtos (empresa_id, codigo, nome, ind_escala, cnpj_fabricante, aliquota_transparencia)
    values ('11111111-1111-1111-1111-111111111111', 'X-8', 'Terceirizado',
            'N', '06088741002520', 12.00);
  update public.produtos set ind_escala = 'S', aliquota_transparencia = 12.00
   where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  raise notice 'OK 14: escala relevante exige fabricante quando N';
end $$;

-- Cenário 15: a regra tributária carrega PIS/COFINS e a alíquota já retida.
do $$
declare
  natureza uuid;
  achada public.regras_tributarias;
begin
  select id into natureza from public.naturezas_operacao
   where empresa_id = '11111111-1111-1111-1111-111111111111' and codigo = 'VENDA_REVENDA';

  insert into public.regras_tributarias
    (empresa_id, produto_id, natureza_operacao_id, cfop, csosn, st_responsavel,
     aliquota_st_retido, cst_pis, cst_cofins, aliquota_pis, aliquota_cofins, base_legal)
    values ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001',
            natureza, '5405', '500', 'substituido', 12.00, '06', '06', 0, 0,
            'revenda de mercadoria com ST já retida');

  select * into achada from public.fn_resolver_regra_tributaria(
    '11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001',
    natureza, 'RO', true, false);
  if achada.csosn <> '500' or achada.aliquota_st_retido <> 12.00 then
    raise exception 'FALHA 15a: regra de substituído não devolveu CSOSN 500 com pST';
  end if;
  if achada.cst_pis <> '06' then
    raise exception 'FALHA 15b: CST de PIS não sobreviveu à resolução';
  end if;

  -- substituído não precisa de MVA: quem retém não é esta operação
  if achada.mva_percentual is not null then
    raise exception 'FALHA 15c: regra de substituído não deveria exigir MVA';
  end if;
  raise notice 'OK 15: PIS, COFINS e alíquota já retida chegam na resolução';
end $$;

select 'CENÁRIOS DA 36 OK' as resultado;
