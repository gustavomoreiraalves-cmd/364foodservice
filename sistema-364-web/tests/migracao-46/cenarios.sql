-- Cenários da atualização 46: chave de origem e retrato da importação.
\set ON_ERROR_STOP on
\set empresa '11111111-1111-1111-1111-111111111111'
\set outra '22222222-2222-2222-2222-222222222222'

-- Cenário 1: o unique é parcial — as duas linhas manuais convivem com nulo.
-- É o que impede a migração de quebrar num cadastro que já existe. As duas
-- matérias-primas da fixture são a duplicata por acento que existe hoje.
do $$
declare n int;
begin
  select count(*) into n from public.materias_primas where pdv_codigo_produto is null;
  if n <> 2 then raise exception 'FALHA 1: esperava 2 matérias-primas com nulo, achei %', n; end if;
  raise notice 'OK 1: unique parcial convive com cadastro manual';
end $$;

-- Cenário 2: mesmo pdv_codigo_produto na mesma empresa é rejeitado.
insert into public.produtos (empresa_id, codigo, nome, unidade, pdv_codigo_produto)
  values (:'empresa', 'STK-P339', 'Costela Bovina', 'kg', 339);
do $$
begin
  begin
    insert into public.produtos (empresa_id, codigo, nome, unidade, pdv_codigo_produto)
      values ('11111111-1111-1111-1111-111111111111', 'STK-P339-BIS', 'Costela Bovina de novo', 'kg', 339);
    raise exception 'FALHA 2: código do PDV repetido na mesma empresa foi aceito';
  exception when unique_violation then
    raise notice 'OK 2: unique barra o mesmo produto do PDV duas vezes na empresa';
  end;
end $$;

-- Cenário 3: o mesmo número em outra empresa passa — são dois PDVs distintos,
-- e o código 339 de um não é o 339 do outro.
insert into public.produtos (empresa_id, codigo, nome, unidade, pdv_codigo_produto)
  values (:'outra', 'OUT-P339', 'Outro produto 339', 'un', 339);
do $$
begin
  raise notice 'OK 3: o mesmo código do PDV convive entre empresas';
end $$;

-- Cenário 4: pdv_valores guarda e devolve o retrato como jsonb.
update public.produtos
   set pdv_valores = '{"nome":"Costela Bovina","preco_venda":"49.90"}'::jsonb,
       pdv_importado_em = now()
 where empresa_id = :'empresa' and pdv_codigo_produto = 339;
do $$
declare v text;
begin
  select pdv_valores->>'preco_venda' into v from public.produtos
   where empresa_id = '11111111-1111-1111-1111-111111111111' and pdv_codigo_produto = 339;
  if v is distinct from '49.90' then raise exception 'FALHA 4: retrato voltou %', v; end if;
  raise notice 'OK 4: pdv_valores guarda o retrato campo a campo';
end $$;

-- Cenário 5: matérias-primas ganham a mesma trava.
insert into public.materias_primas (empresa_id, nome, unidade, pdv_codigo_produto)
  values (:'empresa', 'Salsa', 'kg', 16);
do $$
begin
  begin
    insert into public.materias_primas (empresa_id, nome, unidade, pdv_codigo_produto)
      values ('11111111-1111-1111-1111-111111111111', 'Salsa duplicada', 'kg', 16);
    raise exception 'FALHA 5: insumo do PDV repetido foi aceito';
  exception when unique_violation then
    raise notice 'OK 5: unique vale também para materias_primas';
  end;
end $$;

-- Cenário 6: produto sem custo e sem preço — o que a normalização produz
-- quando o Consumer não informa — entra e cai no default 0. É esta forma que
-- lib/pdvBackup/normalizaProdutos.js precisa emitir: chave ausente, não null.
insert into public.produtos (empresa_id, codigo, nome, unidade, pdv_codigo_produto)
  values (:'empresa', 'STK-P3', 'Batata c/ Cheddar', 'un', 3);
do $$
declare c numeric; v numeric;
begin
  select custo_unitario, preco_venda into c, v from public.produtos
   where empresa_id = '11111111-1111-1111-1111-111111111111' and pdv_codigo_produto = 3;
  if c <> 0 or v <> 0 then raise exception 'FALHA 6: esperava 0/0, achei %/%', c, v; end if;
  raise notice 'OK 6: chave ausente cai no default 0';
end $$;

-- Cenário 7: o mesmo produto com null explícito é recusado. É o motivo de a
-- normalização não poder mandar null: null não cai no default.
do $$
begin
  begin
    insert into public.produtos (empresa_id, codigo, nome, unidade, pdv_codigo_produto, custo_unitario)
      values ('11111111-1111-1111-1111-111111111111', 'STK-P4', 'Sem custo', 'un', 4, null);
    raise exception 'FALHA 7: custo_unitario nulo foi aceito';
  exception when not_null_violation then
    raise notice 'OK 7: null explícito não cai no default, é violação de NOT NULL';
  end;
end $$;

-- Cenário 8: sujeito_st sem CEST é recusado pelo check. Por isso a linha com
-- CSOSN 500 e CEST vazio sai na lista de recusados, e não vira produto.
do $$
begin
  begin
    insert into public.produtos (empresa_id, codigo, nome, unidade, pdv_codigo_produto, sujeito_st, cest)
      values ('11111111-1111-1111-1111-111111111111', 'STK-P5', 'ST sem CEST', 'kg', 5, true, null);
    raise exception 'FALHA 8: sujeito_st sem CEST foi aceito';
  exception when check_violation then
    raise notice 'OK 8: produtos_st_exige_cest barra ST sem CEST';
  end;
end $$;
