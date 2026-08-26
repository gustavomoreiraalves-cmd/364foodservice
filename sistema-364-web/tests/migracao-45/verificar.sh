#!/usr/bin/env bash
# Exercita a atualização 45 (contas bancárias no nível do grupo) num Postgres
# local descartável. Não toca em produção. Requer psql no PATH e um servidor
# local. Uso: tests/migracao-45/verificar.sh
set -euo pipefail
export PGOPTIONS='-c client_min_messages=notice'

AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
BANCO="${BANCO_TESTE_CONTAS_GRUPO:-contas_grupo_test_364}"
MIGRACAO_35="$RAIZ/supabase/atualizacao_35_conciliacao_bancaria.sql"
MIGRACAO="$RAIZ/supabase/atualizacao_45_contas_bancarias_grupo.sql"

command -v psql >/dev/null || { echo "psql não encontrado no PATH"; exit 1; }
pg_isready -q || { echo "nenhum Postgres local aceitando conexões"; exit 1; }

limpar() {
  # O papel é do cluster, não do banco: dropdb não o remove.
  dropdb --if-exists "$BANCO" >/dev/null 2>&1 || true
  psql -q -d postgres -c 'drop role if exists usuario_teste_45;' >/dev/null 2>&1 || true
}
trap limpar EXIT
limpar
createdb "$BANCO"

# Mundo antes da 45: a fixture da 35, a própria 35, e os dados que só existem
# no formato antigo (é o que o backfill precisa encontrar).
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$RAIZ/tests/migracao-35/fixture.sql"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$MIGRACAO_35"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/fixture.sql"

# Duas vezes seguidas: prova idempotência.
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$MIGRACAO"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$MIGRACAO"

psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/cenarios.sql"

# Rollback: descomenta o bloco do fim do arquivo e roda. Antes, desfaz o que os
# cenários criaram e que o mundo antigo não comporta (conta sem empresa dona e
# o par (empresa_id, hash_dedupe) repetido) — é justamente por isso que o
# rollback não é automático em produção.
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" <<'SQL'
delete from public.extrato_lancamentos
  where conta_bancaria_id = 'cccccccc-0000-0000-0000-000000000013';
delete from public.extrato_importacoes
  where conta_bancaria_id = 'cccccccc-0000-0000-0000-000000000013';
delete from public.contas_bancarias where empresa_id is null;
delete from public.contas_bancarias where id = 'cccccccc-0000-0000-0000-000000000013';
SQL

sed -n '/^-- begin;/,/^-- commit;/p' "$MIGRACAO" | sed 's/^-- \{0,1\}//' > "$AQUI/.rollback.sql"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/.rollback.sql"
rm -f "$AQUI/.rollback.sql"

coluna=$(psql -tAq -d "$BANCO" -c "select count(*) from information_schema.columns
  where table_schema = 'public' and table_name = 'extrato_lancamentos'
    and column_name = 'conta_bancaria_id';")
[ "$coluna" = "0" ] || { echo "rollback deixou conta_bancaria_id em extrato_lancamentos"; exit 1; }

unico=$(psql -tAq -d "$BANCO" -c "select count(*) from pg_constraint
  where conrelid = 'public.extrato_lancamentos'::regclass
    and conname = 'extrato_lancamentos_empresa_id_hash_dedupe_key';")
[ "$unico" = "1" ] || { echo "rollback não devolveu o unique (empresa_id, hash_dedupe)"; exit 1; }

policy=$(psql -tAq -d "$BANCO" -c "select count(*) from pg_policies
  where schemaname = 'public' and tablename = 'contas_bancarias'
    and policyname = 'empresa_scoped_access';")
[ "$policy" = "1" ] || { echo "rollback não devolveu a policy escopada por empresa"; exit 1; }

obrigatorio=$(psql -tAq -d "$BANCO" -c "select attnotnull from pg_attribute
  where attrelid = 'public.contas_bancarias'::regclass and attname = 'empresa_id';")
[ "$obrigatorio" = "t" ] || { echo "rollback deixou empresa_id opcional"; exit 1; }

echo "OK: rollback devolve o estado da 35"
echo "MIGRAÇÃO 45 OK"
