#!/usr/bin/env bash
# Exercita a atualização 46 (cadastro de produtos vindo do PDV) num Postgres
# local descartável. Não toca em produção. Requer psql no PATH e um servidor
# local. Uso: tests/migracao-46/verificar.sh
set -euo pipefail
export PGOPTIONS='-c client_min_messages=notice'

AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
BANCO="${BANCO_TESTE_PRODUTOS_PDV:-produtos_pdv_test_364}"
MIGRACAO="$RAIZ/supabase/atualizacao_46_produtos_pdv.sql"

command -v psql >/dev/null || { echo "psql não encontrado no PATH"; exit 1; }
pg_isready -q || { echo "nenhum Postgres local aceitando conexões"; exit 1; }

limpar() { dropdb --if-exists "$BANCO" >/dev/null 2>&1 || true; }
trap limpar EXIT
limpar
createdb "$BANCO"

psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/fixture.sql"

# Duas vezes seguidas: prova idempotência.
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$MIGRACAO"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$MIGRACAO"

psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/cenarios.sql"

sed -n '/^-- begin;/,/^-- commit;/p' "$MIGRACAO" | sed 's/^-- \{0,1\}//' > "$AQUI/.rollback.sql"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/.rollback.sql"
rm -f "$AQUI/.rollback.sql"

colunas=$(psql -tAq -d "$BANCO" -c "select count(*) from information_schema.columns
  where table_schema='public' and table_name in ('produtos','materias_primas')
    and column_name in ('pdv_codigo_produto','pdv_valores','pdv_importado_em');")
[ "$colunas" = "0" ] || { echo "rollback deixou $colunas coluna(s) da 46"; exit 1; }

sobreviveu=$(psql -tAq -d "$BANCO" -c "select count(*) from public.produtos;")
[ "$sobreviveu" != "0" ] || { echo "rollback apagou linhas de produtos"; exit 1; }

echo "OK: rollback limpo (só as colunas da 46 somem)"
echo "MIGRAÇÃO 46 OK"
