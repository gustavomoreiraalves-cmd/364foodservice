-- Complemento da fixture da 35, carregado depois que a atualização 35 já rodou
-- e antes da 45. Traz duas coisas:
--
--  1. tem_modulo(), que a 45 usa na policy e a fixture da 35 não tinha. Aqui é
--     um stub ligado a uma GUC, para os cenários poderem desligar o módulo e
--     provar que o gate existe.
--  2. Dados de antes da 45, para o backfill de conta_bancaria_id ter o que
--     preencher — um lançamento criado sob o mundo antigo.
create or replace function public.tem_modulo(m text) returns boolean
  language sql stable as $$
    select coalesce(current_setting('teste.modulo_financeiro', true), 'on') = 'on'
  $$;

-- Conta e importação da empresa 1, no formato antigo (empresa_id obrigatório).
insert into public.contas_bancarias (id, empresa_id, nome, instituicao, tipo)
  values ('cccccccc-0000-0000-0000-000000000011',
          '11111111-1111-1111-1111-111111111111', 'Sicoob Centro', 'Sicoob', 'conta_corrente');
insert into public.extrato_importacoes (id, empresa_id, conta_bancaria_id, tipo, arquivo_path, formato)
  values ('dddddddd-0000-0000-0000-000000000011',
          '11111111-1111-1111-1111-111111111111',
          'cccccccc-0000-0000-0000-000000000011', 'extrato', 'p/11.ofx', 'ofx');
insert into public.extrato_lancamentos
  (id, importacao_id, empresa_id, data, descricao, descricao_normalizada, valor, tipo, hash_dedupe)
  values ('eeeeeeee-0000-0000-0000-000000000011', 'dddddddd-0000-0000-0000-000000000011',
          '11111111-1111-1111-1111-111111111111', '2026-08-01', 'TARIFA PACOTE', 'TARIFA PACOTE',
          49.90, 'saida', 'hash-antigo');
