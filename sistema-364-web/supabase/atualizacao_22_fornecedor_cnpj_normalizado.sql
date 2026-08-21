-- =========================================================
-- 364 — ATUALIZAÇÃO 22: CNPJ DE FORNECEDOR SÓ COM DÍGITOS
-- O CNPJ do fornecedor era texto livre, então o mesmo fornecedor podia estar
-- cadastrado como '12.345.678/0001-99' e a NF-e trazer '12345678000199'. A rota
-- /preparar casa o emitente da nota com o fornecedor por igualdade de CNPJ, e
-- fornecedor cadastrado com pontuação nunca casava: a tela mandava cadastrar de
-- novo e o cadastro ganhava um duplicado.
--
-- Aqui os cadastros existentes perdem a pontuação e a coluna passa a aceitar só
-- dígitos daqui pra frente. O formulário de Fornecedores também já grava só
-- dígitos (app/fornecedores/page.js).
--
-- Rode depois de atualizacao_21_nfe_documentos.sql.
-- =========================================================

begin;

-- Normaliza o que já está cadastrado. CNPJ que só tinha pontuação (ou espaço em
-- branco) vira null em vez de string vazia — a coluna é opcional.
update public.fornecedores
   set cnpj = nullif(regexp_replace(cnpj, '\D', '', 'g'), '')
 where cnpj is not null
   and cnpj is distinct from nullif(regexp_replace(cnpj, '\D', '', 'g'), '');

-- Só dígitos, sem exigir os 14 do CNPJ: produtor rural e MEI aparecem no cadastro
-- com CPF (11 dígitos), e travar o tamanho impediria esse cadastro.
alter table public.fornecedores drop constraint if exists fornecedores_cnpj_digitos;
alter table public.fornecedores add constraint fornecedores_cnpj_digitos
  check (cnpj is null or cnpj ~ '^[0-9]+$');

commit;
