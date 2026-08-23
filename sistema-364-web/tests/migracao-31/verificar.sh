#!/usr/bin/env bash
# Exercita a atualização 31 (pessoa jurídica central + certificados) num Postgres
# local descartável. Não toca em produção. Requer psql no PATH e servidor local.
#
# Uso: tests/migracao-31/verificar.sh
set -euo pipefail
export PGOPTIONS='-c client_min_messages=warning'

AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
BANCO="${BANCO_TESTE_EMPRESAS:-empresas_test_364}"
MIG="$RAIZ/supabase/atualizacao_31_empresas_pessoa_juridica.sql"

command -v psql >/dev/null || { echo "psql não encontrado no PATH"; exit 1; }
pg_isready -q || { echo "nenhum Postgres local aceitando conexões"; exit 1; }

limpar() { dropdb --if-exists "$BANCO" >/dev/null 2>&1 || true; }
trap limpar EXIT
limpar
createdb "$BANCO"

psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/fixture.sql"
# Duas vezes: prova idempotência de verdade (reaplicar sobre banco onde já rodou).
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$MIG"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$MIG"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/cenarios.sql"

# Rollback comentado no fim da migração: extrai, aplica, confere que desfez.
sed -n '/^-- begin;/,/^-- commit;/p' "$MIG" | sed 's/^-- \{0,1\}//' > "$AQUI/.rollback.sql"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/.rollback.sql"
rm -f "$AQUI/.rollback.sql"

sobraram=$(psql -tAq -d "$BANCO" -c "select count(*) from information_schema.columns
  where (table_name = 'empregadores' and column_name in ('regime_tributario','cnae_principal','telefone','contador_nome','updated_at'))
     or (table_name = 'empresas' and column_name = 'empregador_id');")
[ "$sobraram" = "0" ] || { echo "rollback não removeu todas as colunas novas (achou $sobraram)"; exit 1; }
tabela=$(psql -tAq -d "$BANCO" -c "select count(*) from information_schema.tables where table_name = 'certificados_digitais';")
[ "$tabela" = "0" ] || { echo "rollback não removeu certificados_digitais"; exit 1; }
echo "OK: rollback desfaz a migração"
