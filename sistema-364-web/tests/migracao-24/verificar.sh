#!/usr/bin/env bash
# Exercita a atualização 24 (edição de pedido de venda) num Postgres local
# descartável. Não toca em produção. Requer psql no PATH e um servidor local.
#
# Uso: tests/migracao-24/verificar.sh
set -euo pipefail

export PGOPTIONS='-c client_min_messages=warning'

AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
BANCO="${BANCO_TESTE_PEDIDOS:-pedidos_test_364}"

command -v psql >/dev/null || { echo "psql não encontrado no PATH"; exit 1; }
pg_isready -q || { echo "nenhum Postgres local aceitando conexões"; exit 1; }

limpar() { dropdb --if-exists "$BANCO" >/dev/null 2>&1 || true; }
trap limpar EXIT

limpar
createdb "$BANCO"

psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/fixture.sql"
# A migração sob teste é o arquivo real que vai para produção.
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$RAIZ/supabase/atualizacao_24_pedidos_edicao.sql"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/cenarios.sql"

# O bloco de rollback vive comentado no fim da migração; extrai e aplica para
# provar que ele é SQL válido e desfaz o que a migração criou.
sed -n '/^-- begin;/,/^-- commit;/p' "$RAIZ/supabase/atualizacao_24_pedidos_edicao.sql" | sed 's/^-- \{0,1\}//' > "$AQUI/.rollback.sql"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/.rollback.sql"
rm -f "$AQUI/.rollback.sql"

sobraram=$(psql -tAq -d "$BANCO" -c "select count(*) from pg_trigger where tgname in ('trg_pedido_itens_bloquear_edicao','trg_pedidos_bloquear_cabecalho');")
[ "$sobraram" = "0" ] || { echo "rollback não removeu os triggers (achou $sobraram)"; exit 1; }
echo "OK: rollback desfaz a migração"
