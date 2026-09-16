#!/usr/bin/env bash
# tests/migracao-54/verificar.sh
# Mesmo padrão de tests/migracao-52/verificar.sh — Postgres local descartável.
set -euo pipefail
export PGOPTIONS='-c client_min_messages=notice'

AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
BANCO="${BANCO_TESTE_LOTE_EXPEDICAO:-lote_produto_acabado_expedicao_test_364}"
MIGRACAO="$RAIZ/supabase/atualizacao_54_lote_produto_acabado_expedicao.sql"

command -v psql >/dev/null || { echo "psql não encontrado no PATH"; exit 1; }
pg_isready -q || { echo "nenhum Postgres local aceitando conexões"; exit 1; }

limpar() { dropdb --if-exists "$BANCO" >/dev/null 2>&1 || true; }
trap limpar EXIT
limpar
createdb "$BANCO"

psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/fixture.sql"

# Duas vezes seguidas: prova idempotência (add column if not exists / create or replace).
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$MIGRACAO"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$MIGRACAO"

psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/cenarios.sql"

echo "MIGRAÇÃO 54 OK"
