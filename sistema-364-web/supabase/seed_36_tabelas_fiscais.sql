-- =========================================================
-- Carga inicial das tabelas oficiais da atualização 36
--
-- Não é migração: é dado, e dado que muda por ato normativo. Cada linha
-- guarda o ato ou o item da norma que a sustenta, para que qualquer número
-- aqui possa ser conferido contra a fonte sem arqueologia.
--
-- Cobertura desta carga: o recorte que a operação da 364 usa hoje. NCM e CEST
-- completos não têm publicação oficial em formato tabular — a carga integral,
-- quando for necessária, sai do texto do Convênio ICMS 142/2018 e da TIPI.
--
-- Rode depois de atualizacao_36_cadastro_fiscal.sql. Idempotente.
-- =========================================================
begin;

-- ---------- NCM ----------
-- Os três primeiros são os informados pela 364 em 24/08/2026. Os demais
-- existem porque aparecem nas notas de entrada de matéria-prima.
insert into public.tabela_ncm (ncm, descricao, aliquota_ipi, vigente_desde, ato_normativo) values
  ('02102000', 'Carnes da espécie bovina salgadas, em salmoura, secas ou defumadas', null, '2022-04-01', 'TIPI - Decreto 11.158/2022'),
  ('02101900', 'Outras carnes da espécie suína salgadas, em salmoura, secas ou defumadas', null, '2022-04-01', 'TIPI - Decreto 11.158/2022'),
  ('02109900', 'Outras carnes e miudezas comestíveis, salgadas, secas ou defumadas', null, '2022-04-01', 'TIPI - Decreto 11.158/2022'),
  ('16025000', 'Outras preparações e conservas de carne, de miudezas ou de sangue, da espécie bovina', null, '2022-04-01', 'TIPI - Decreto 11.158/2022'),
  ('16010000', 'Enchidos e produtos semelhantes, de carne, de miudezas ou de sangue', null, '2022-04-01', 'TIPI - Decreto 11.158/2022'),
  ('02013000', 'Carnes desossadas da espécie bovina, frescas ou refrigeradas', null, '2022-04-01', 'TIPI - Decreto 11.158/2022'),
  ('02012000', 'Outras peças não desossadas da espécie bovina, frescas ou refrigeradas', null, '2022-04-01', 'TIPI - Decreto 11.158/2022'),
  ('02023000', 'Carnes desossadas da espécie bovina, congeladas', null, '2022-04-01', 'TIPI - Decreto 11.158/2022'),
  ('02032900', 'Outras carnes da espécie suína, congeladas', null, '2022-04-01', 'TIPI - Decreto 11.158/2022')
on conflict (ncm) do update set
  descricao = excluded.descricao,
  ato_normativo = excluded.ato_normativo;

-- ---------- CEST x NCM ----------
-- Anexo XVII (Produtos Alimentícios) do Convênio ICMS 142/2018. O item do
-- convênio fica gravado porque é por ele que se confere a linha contra a norma.
insert into public.tabela_cest (cest, ncm, descricao, anexo_convenio, item_convenio) values
  ('1708300', '02102000',
   'Carne de gado bovino e produtos comestíveis resultantes da matança, submetidos à salga, secagem ou desidratação',
   'Anexo XVII', '83.0'),
  ('1708701', '02101900',
   'Carnes e demais produtos comestíveis frescos, resfriados, congelados, salgados, em salmoura, simplesmente temperados, secos ou defumados, resultantes do abate de suínos',
   'Anexo XVII', '87.1'),
  ('1707906', '16025000',
   'Outras preparações e conservas de carne, de miudezas ou de sangue, da espécie bovina',
   'Anexo XVII', '79.6'),
  ('1708400', '02013000',
   'Carne de gado bovino, ovino e bufalino e produtos comestíveis resultantes da matança desse gado, frescos, refrigerados ou congelados',
   'Anexo XVII', '84.0'),
  ('1708400', '02023000',
   'Carne de gado bovino, ovino e bufalino e produtos comestíveis resultantes da matança desse gado, frescos, refrigerados ou congelados',
   'Anexo XVII', '84.0'),
  ('1707600', '16010000',
   'Enchidos (embutidos) e produtos semelhantes, exceto salsicha, linguiça e mortadela',
   'Anexo XVII', '76.0'),
  ('1707700', '16010000',
   'Salsicha e linguiça',
   'Anexo XVII', '77.0'),
  ('1707800', '16010000',
   'Mortadela',
   'Anexo XVII', '78.0')
on conflict (cest, ncm) do update set
  descricao = excluded.descricao,
  item_convenio = excluded.item_convenio;

-- ---------- Aplicação estadual do CEST ----------
-- Só entram aqui itens verificados no texto do Anexo VI do RICMS/RO. Ausência
-- desta tabela significa "ninguém conferiu ainda" e bloqueia o faturamento;
-- para dizer "conferido, RO não adotou" existe a coluna sujeito_st, usada mais
-- abaixo. As duas situações não podem ser confundidas: uma é ignorância, a
-- outra é conhecimento.
-- Item 84.0: os números não vêm de leitura de norma, vêm de documento fiscal
-- autorizado. A NF-e 34.840 do frigorífico (21/08/2026, protocolo
-- 211260024029638) traz MVA de 35 por cento, redução de base de 41,67 por cento
-- na operação própria e na ST, alíquota de 12 por cento e modBCST 3. A conta da
-- nota fecha ao centavo com esses parâmetros — é a melhor evidência disponível.
insert into public.cest_uf_regra
  (uf, cest, protocolo_convenio, mva_original, reducao_base_percentual,
   reducao_base_st_percentual, mod_bc_st, aliquota_interna, base_legal, vigencia_inicio) values
  ('RO', '1708400', 'Protocolo ICMS 01/2023', 35.00, 41.67, 41.67, 3, 12.00,
   'RICMS-RO Anexo VI, Tabela XVII, item 84.0; redução de base do item 18 da Parte 2 do Anexo II do Decreto 22.721/2018. Parâmetros conferidos contra a NF-e 34.840, série 1, autorizada em 21/08/2026',
   '2023-03-01')
on conflict (uf, cest, vigencia_inicio) do update set
  mva_original = excluded.mva_original,
  reducao_base_percentual = excluded.reducao_base_percentual,
  reducao_base_st_percentual = excluded.reducao_base_st_percentual,
  mod_bc_st = excluded.mod_bc_st,
  aliquota_interna = excluded.aliquota_interna,
  base_legal = excluded.base_legal;

-- Demais itens: a adoção por RO e a MVA estão confirmadas no texto do Anexo VI,
-- mas a ALÍQUOTA não. Deixar 19,5 por cento aqui seria presumir a modal do art.
-- 12 justamente onde a nota do frigorífico mostra que carne anda com 12 por
-- cento e redução de base. Alíquota nula é o pedido de confirmação, e a emissão
-- para até que ela venha.
insert into public.cest_uf_regra
  (uf, cest, protocolo_convenio, mva_original, base_legal, vigencia_inicio) values
  ('RO', '1708300', 'Protocolo ICMS 01/2023', 35.00,
   'RICMS-RO Anexo VI, Parte 2, Tabela XVII, item 83.0. Alíquota e eventual redução de base a confirmar com o contador',
   '2023-03-01'),
  ('RO', '1707600', 'Protocolo ICMS 01/2023', 35.00,
   'RICMS-RO Anexo VI, Parte 2, Tabela XVII, item 76.0', '2023-03-01'),
  ('RO', '1707700', 'Protocolo ICMS 01/2023', 35.00,
   'RICMS-RO Anexo VI, Parte 2, Tabela XVII, item 77.0', '2023-03-01'),
  ('RO', '1707800', 'Protocolo ICMS 01/2023', 35.00,
   'RICMS-RO Anexo VI, Parte 2, Tabela XVII, item 78.0', '2023-03-01'),
  ('RO', '1708701', 'Protocolo ICMS 01/2023', 30.00,
   'RICMS-RO Anexo VI, Parte 2, Tabela XVII, item 87.1, CEST 17.087.01 (NCM 0210.1). Alíquota a confirmar',
   '2023-03-01')
on conflict (uf, cest, vigencia_inicio) do update set
  mva_original = excluded.mva_original,
  base_legal = excluded.base_legal;

-- Verificado no texto e fora da ST em Rondônia. A linha existe justamente para
-- registrar a verificação: sem ela, a ausência bloquearia o faturamento.
-- Rondônia não internalizou os itens 79.0 a 82.0 da Tabela XVII — no corpo da
-- tabela a numeração salta de 78.0 (mortadela) direto para 83.0.
insert into public.cest_uf_regra
  (uf, cest, sujeito_st, base_legal, vigencia_inicio) values
  ('RO', '1707906', false,
   'RICMS-RO Anexo VI, Parte 2, Tabela XVII: item 79.6 ausente do corpo da tabela (salto de 78.0 para 83.0). Pendente de consulta formal à SEFIN-RO, porque o mesmo PDF traz o item num índice de referência cruzada nas páginas 229-230.',
   '2023-03-01')
on conflict (uf, cest, vigencia_inicio) do update set
  sujeito_st = excluded.sujeito_st,
  base_legal = excluded.base_legal;

-- ---------- CFOP ----------
-- Recorte de saída interna e de entrada por devolução. A 364 vende só dentro de
-- Rondônia, então os CFOP 6.xxx ficam de fora até haver operação interestadual.
insert into public.tabela_cfop (cfop, descricao, tipo) values
  ('5101', 'Venda de produção do estabelecimento', 'S'),
  ('5102', 'Venda de mercadoria adquirida ou recebida de terceiros', 'S'),
  ('5103', 'Venda de produção do estabelecimento, efetuada fora do estabelecimento', 'S'),
  ('5401', 'Venda de produção do estabelecimento em operação com produto sujeito a ST, na condição de substituto', 'S'),
  ('5403', 'Venda de mercadoria adquirida de terceiros em operação com ST, na condição de substituto', 'S'),
  ('5405', 'Venda de mercadoria adquirida de terceiros, sujeita a ST, na condição de substituído', 'S'),
  ('5910', 'Remessa em bonificação, doação ou brinde', 'S'),
  ('5911', 'Remessa de amostra grátis', 'S'),
  ('5912', 'Remessa de mercadoria ou bem para demonstração', 'S'),
  ('5920', 'Remessa de vasilhame ou sacaria', 'S'),
  ('5949', 'Outra saída de mercadoria ou prestação de serviço não especificada', 'S'),
  ('5202', 'Devolução de compra para comercialização', 'S'),
  ('5411', 'Devolução de compra para comercialização em operação com mercadoria sujeita a ST', 'S'),
  ('1102', 'Compra para comercialização', 'E'),
  ('1202', 'Devolução de venda de mercadoria adquirida ou recebida de terceiros', 'E'),
  ('1201', 'Devolução de venda de produção do estabelecimento', 'E'),
  ('1411', 'Devolução de venda de mercadoria sujeita a ST', 'E'),
  ('1410', 'Devolução de venda de produção do estabelecimento em operação com ST', 'E')
on conflict (cfop) do update set descricao = excluded.descricao;

-- ---------- Unidades de medida ----------
insert into public.tabela_unidade_medida (codigo, descricao) values
  ('KG', 'Quilograma'),
  ('G',  'Grama'),
  ('UN', 'Unidade'),
  ('PC', 'Peça'),
  ('CX', 'Caixa'),
  ('FD', 'Fardo'),
  ('PT', 'Pacote'),
  ('BD', 'Balde'),
  ('L',  'Litro'),
  ('DZ', 'Dúzia')
on conflict (codigo) do update set descricao = excluded.descricao;

-- ---------- Municípios ----------
-- Recorte de Rondônia por onde a operação circula. A carga completa sai do CSV
-- de municípios da Receita Federal.
insert into public.municipios_ibge (codigo_ibge, nome, uf) values
  ('1100205', 'Porto Velho', 'RO'),
  ('1100122', 'Ji-Paraná', 'RO'),
  ('1100023', 'Ariquemes', 'RO'),
  ('1100304', 'Vilhena', 'RO'),
  ('1100049', 'Cacoal', 'RO')
on conflict (codigo_ibge) do update set nome = excluded.nome;

commit;
