-- =========================================================
-- 364 — ATUALIZAÇÃO 15: UNIFICAÇÃO DE CADASTROS
-- A tela /funcionarios é aposentada (vira redirect, como /usuarios).
-- O cadastro de colaboradores (Ponto → Colaboradores) passa a ser o
-- único ponto de cadastro de pessoas. A tabela `funcionarios`
-- continua existindo por baixo (FKs responsavel_id em recebimentos,
-- producoes, pedidos, despesas não podem quebrar) e é sincronizada
-- automaticamente a partir do colaborador (já era assim desde a
-- atualização 14 — painel "Acesso").
--
-- Este script faz o backfill: cria um colaborador para cada
-- funcionário ativo que ainda não tem um (casando por CPF quando
-- já existe colaborador com o mesmo CPF, para não duplicar pessoa).
-- Funcionários sem CPF cadastrado são deixados de fora (não dá para
-- unificar com segurança) — ficam como estão, "legados".
-- =========================================================

with emp as (
  select id from empregadores order by created_at limit 1
),
cpfs_existentes as (
  select cpf from colaboradores
),
novos as (
  insert into colaboradores (empresa_id, empregador_id, nome, cpf, telefone, cargo, registra_ponto)
  select f.empresa_id, (select id from emp), f.nome,
         regexp_replace(f.cpf, '[^0-9]', '', 'g'),
         f.telefone, f.cargo, true
  from funcionarios f
  where f.colaborador_id is null
    and f.ativo
    and f.cpf is not null
    and regexp_replace(f.cpf, '[^0-9]', '', 'g') <> ''
    and regexp_replace(f.cpf, '[^0-9]', '', 'g') not in (select cpf from cpfs_existentes)
  returning id, cpf
)
update funcionarios f
set colaborador_id = c.id
from (
  select id, cpf from novos
  union all
  select id, cpf from colaboradores
) c
where f.colaborador_id is null
  and f.cpf is not null
  and regexp_replace(f.cpf, '[^0-9]', '', 'g') = c.cpf;

-- usuários que tinham só o módulo 'funcionarios' ganham 'ponto' no lugar,
-- para não perder acesso quando a aba antiga sair da navegação
insert into permissoes (user_id, modulo)
select p.user_id, 'ponto'
from permissoes p
where p.modulo = 'funcionarios'
  and not exists (select 1 from permissoes p2 where p2.user_id = p.user_id and p2.modulo = 'ponto');
