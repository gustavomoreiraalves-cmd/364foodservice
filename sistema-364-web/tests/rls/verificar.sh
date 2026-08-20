#!/usr/bin/env bash
# Exercita as policies de RLS multiempresa num Postgres local descartável.
# Não toca em produção. Requer psql no PATH e um servidor local rodando.
#
# Uso: tests/rls/verificar.sh
set -euo pipefail

# Os `drop ... if exists` das migrações emitem um NOTICE por objeto ausente.
# São esperados e escondem o que importa na saída.
export PGOPTIONS='-c client_min_messages=warning'

AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
BANCO="${BANCO_TESTE_RLS:-rls_test_364}"

command -v psql >/dev/null || { echo "psql não encontrado no PATH"; exit 1; }
pg_isready -q || { echo "nenhum Postgres local aceitando conexões"; exit 1; }

limpar() { dropdb --if-exists "$BANCO" >/dev/null 2>&1 || true; }
trap limpar EXIT

limpar
createdb "$BANCO"

psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/fixture.sql"
# A migração sob teste é o arquivo real que vai para produção.
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$RAIZ/supabase/atualizacao_20_rls_escopo_empresa.sql"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/cenarios.sql"

# O bloco de rollback vive comentado no fim da migração; extrai e aplica para
# provar que ele é SQL válido e restaura o estado anterior.
sed -n '/^-- begin;/,/^-- commit;/p' "$RAIZ/supabase/atualizacao_20_rls_escopo_empresa.sql" | sed 's/^-- \{0,1\}//' > "$AQUI/.rollback.sql"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/.rollback.sql"
rm -f "$AQUI/.rollback.sql"

restauradas=$(psql -tAq -d "$BANCO" -c "select count(*) from pg_policies where policyname in ('escalas_compartilhadas','via_escala');")
[ "$restauradas" = "2" ] || { echo "rollback não restaurou as policies originais (achou $restauradas de 2)"; exit 1; }
echo "OK: rollback restaura o estado anterior"
