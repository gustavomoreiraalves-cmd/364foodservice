-- =========================================================
-- Atualização 45 — Contas bancárias e cartões no nível do grupo
--
-- Conta de banco e cartão de crédito são do Grupo 364, não de uma marca.
-- Recadastrar a mesma "Sicoob Centro 3337" em cada empresa só cria cópias
-- que divergem. Aqui `contas_bancarias` segue o caminho que `escalas`
-- percorreu na atualização 19: `empresa_id` deixa de ser filtro de RLS e
-- vira registro de quem cadastrou primeiro (pode ficar nulo dali em diante),
-- e o acesso passa a ser gated pelo módulo financeiro.
--
-- Cartão não tem tabela própria: é `tipo = 'cartao_credito'` na mesma
-- tabela, então a mudança vale para os dois de uma vez.
--
-- Consequência que precisa ser fechada junto: com a conta visível em toda
-- empresa, o mesmo extrato pode ser importado duas vezes, uma por empresa.
-- O dedupe de lançamentos era `(empresa_id, hash_dedupe)` e deixaria as duas
-- passarem. Passa a ser `(conta_bancaria_id, hash_dedupe)`: a identidade do
-- lançamento é a conta de onde ele saiu, não quem o importou.
--
-- O que NÃO muda: extrato_importacoes, extrato_lancamentos,
-- conciliacao_padroes e conciliacao_vinculos continuam escopados por
-- empresa. Só o cadastro é compartilhado.
--
-- Rode depois de atualizacao_44_fuso_iana.sql. Idempotente.
-- =========================================================
begin;

-- ---------- CADASTRO COMPARTILHADO ----------
-- empresa_id sobrevive como origem: serve para saber quem cadastrou, nunca
-- mais para decidir quem enxerga.
alter table public.contas_bancarias alter column empresa_id drop not null;

-- tem_modulo() já cobre o admin ('admin' entra na lista dentro da função).
-- Isto aperta o acesso em vez de afrouxar: antes bastava estar autenticado e
-- ter a empresa; agora é preciso o módulo financeiro — o mesmo gate que o
-- menu já aplica em lib/menu.js.
drop policy if exists "empresa_scoped_access" on public.contas_bancarias;
drop policy if exists "contas_bancarias_compartilhadas" on public.contas_bancarias;
create policy "contas_bancarias_compartilhadas" on public.contas_bancarias for all
  using (public.tem_modulo('financeiro'))
  with check (public.tem_modulo('financeiro'));

-- ---------- DEDUPE POR CONTA ----------
-- A coluna é denormalização deliberada: o dedupe precisa ser um índice único,
-- e índice único não enxerga a conta através de extrato_importacoes.
alter table public.extrato_lancamentos
  add column if not exists conta_bancaria_id uuid references public.contas_bancarias(id);

update public.extrato_lancamentos l
   set conta_bancaria_id = i.conta_bancaria_id
  from public.extrato_importacoes i
 where i.id = l.importacao_id
   and l.conta_bancaria_id is distinct from i.conta_bancaria_id;

alter table public.extrato_lancamentos
  alter column conta_bancaria_id set not null;

alter table public.extrato_lancamentos
  drop constraint if exists extrato_lancamentos_empresa_id_hash_dedupe_key;
create unique index if not exists extrato_lancamentos_conta_hash_key
  on public.extrato_lancamentos(conta_bancaria_id, hash_dedupe);

commit;

-- ---------- ROLLBACK ----------
-- Descomente e rode para voltar ao estado da 35. Só volta se nenhuma conta
-- tiver ficado com empresa_id nulo e nenhum par (empresa_id, hash_dedupe)
-- estiver repetido — o `set not null` e o unique falham sozinhos se não for
-- o caso, e é assim que deve ser.
-- begin;
-- drop index if exists public.extrato_lancamentos_conta_hash_key;
-- alter table public.extrato_lancamentos
--   add constraint extrato_lancamentos_empresa_id_hash_dedupe_key unique (empresa_id, hash_dedupe);
-- alter table public.extrato_lancamentos drop column if exists conta_bancaria_id;
-- drop policy if exists "contas_bancarias_compartilhadas" on public.contas_bancarias;
-- create policy "empresa_scoped_access" on public.contas_bancarias for all
--   using (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()))
--   with check (auth.role() = 'authenticated' and empresa_id in (select public.empresas_permitidas()));
-- alter table public.contas_bancarias alter column empresa_id set not null;
-- commit;
