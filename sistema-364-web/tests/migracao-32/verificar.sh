#!/usr/bin/env bash
# Exercita a atualização 32 (tabelas pdv_* do PDV Consumer) num Postgres
# local descartável. Não toca em produção. Requer psql no PATH e um servidor
# local. Uso: tests/migracao-32/verificar.sh
set -euo pipefail
export PGOPTIONS='-c client_min_messages=warning'

AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
BANCO="${BANCO_TESTE_PDV:-pdv_test_364}"

command -v psql >/dev/null || { echo "psql não encontrado no PATH"; exit 1; }
pg_isready -q || { echo "nenhum Postgres local aceitando conexões"; exit 1; }

limpar() { dropdb --if-exists "$BANCO" >/dev/null 2>&1 || true; }
trap limpar EXIT
limpar
createdb "$BANCO"

psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/fixture.sql"
# Duas vezes: prova idempotência da migração real.
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$RAIZ/supabase/atualizacao_32_pdv_consumer.sql"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$RAIZ/supabase/atualizacao_32_pdv_consumer.sql"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/cenarios.sql"

sed -n '/^-- begin;/,/^-- commit;/p' "$RAIZ/supabase/atualizacao_32_pdv_consumer.sql" | sed 's/^-- \{0,1\}//' > "$AQUI/.rollback.sql"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/.rollback.sql"
rm -f "$AQUI/.rollback.sql"

sobraram=$(psql -tAq -d "$BANCO" -c "select count(*) from information_schema.tables where table_name like 'pdv_%';")
[ "$sobraram" = "0" ] || { echo "rollback deixou $sobraram tabelas pdv_*"; exit 1; }
echo "OK: rollback limpo"
echo "MIGRAÇÃO 32 OK"
