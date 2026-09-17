-- Atualização 57: trigger_movimento_atualiza_saldo passa a ser SECURITY DEFINER
--
-- Bug: stock_balances tinha RLS habilitada mas só com policy de SELECT.
-- O trigger trigger_movimento_atualiza_saldo (disparado a partir de
-- trigger_inspecao_gera_movimento, ao inserir em inspecoes_qualidade com
-- status 'aprovado'/'aprovado_com_ressalva') fazia um INSERT ... ON CONFLICT
-- DO UPDATE em stock_balances rodando como o usuário autenticado. Sem policy
-- de INSERT/UPDATE, toda essa cadeia falhava com 403 (RLS), abortando o
-- insert em inspecoes_qualidade e revertendo o recebimento inteiro — em
-- qualquer matéria-prima, "simples" ou não.
--
-- Fix: em vez de abrir policy de INSERT/UPDATE em stock_balances para
-- qualquer usuário autenticado com permissão 'estoque' (o que permitiria
-- escrever direto na tabela via API, fabricando ou alterando saldo sem
-- nenhum recebimento/inspeção/movimento por trás — stock_balances não tem
-- auditoria própria, só o que stock_movements registra), a função do
-- trigger passa a ser SECURITY DEFINER, como já é o padrão de
-- tem_permissao()/empresas_permitidas()/is_admin() neste banco. Ela roda
-- como o owner (postgres), que já é dono da tabela e por isso ignora RLS,
-- sem precisar de nenhuma policy de escrita para o role authenticated.
--
-- stock_balances continua sem policy de INSERT/UPDATE/DELETE: só o trigger
-- escreve nela, e escrita direta via API continua bloqueada.

CREATE OR REPLACE FUNCTION public.trigger_movimento_atualiza_saldo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into stock_balances (empresa_id, unidade_id, deposito_id, materia_prima_id, lote, quantidade, custo_unitario, updated_at)
  values (new.empresa_id, new.unidade_id, new.deposito_id, new.materia_prima_id, new.lote, new.quantidade, new.custo_unitario, now())
  on conflict (empresa_id, deposito_id, materia_prima_id, lote)
  do update set
    quantidade = stock_balances.quantidade + excluded.quantidade,
    custo_unitario = excluded.custo_unitario,
    updated_at = now();
  return new;
end;
$function$;
