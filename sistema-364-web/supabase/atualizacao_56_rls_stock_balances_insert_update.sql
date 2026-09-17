-- Atualização 56: adiciona policies de INSERT/UPDATE em stock_balances
--
-- Bug: stock_balances tinha RLS habilitada mas só com policy de SELECT.
-- O trigger trigger_movimento_atualiza_saldo (disparado a partir de
-- trigger_inspecao_gera_movimento, ao inserir em inspecoes_qualidade com
-- status 'aprovado'/'aprovado_com_ressalva') roda como o usuário autenticado
-- (não é SECURITY DEFINER) e faz um INSERT ... ON CONFLICT DO UPDATE em
-- stock_balances. Sem policy de INSERT/UPDATE, toda essa cadeia falha com
-- 403 (RLS), abortando o insert em inspecoes_qualidade e revertendo o
-- recebimento inteiro — em qualquer matéria-prima, "simples" ou não.
--
-- Fix: espelha o padrão já usado em stock_movements_insert.

create policy stock_balances_insert on stock_balances
  for insert
  with check (
    auth.role() = 'authenticated'
    and empresa_id in (select empresas_permitidas())
    and tem_permissao('estoque')
  );

create policy stock_balances_update on stock_balances
  for update
  using (
    auth.role() = 'authenticated'
    and empresa_id in (select empresas_permitidas())
    and tem_permissao('estoque')
  )
  with check (
    auth.role() = 'authenticated'
    and empresa_id in (select empresas_permitidas())
    and tem_permissao('estoque')
  );
