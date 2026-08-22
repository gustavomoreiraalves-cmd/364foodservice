#!/usr/bin/env bash
# Exercita a atualização 29 (status da ficha de defumação + vínculo com o lote)
# num Postgres local descartável. Não toca em produção. Requer psql no PATH e
# um servidor local.
#
# Uso: tests/migracao-29/verificar.sh
set -euo pipefail

export PGOPTIONS='-c client_min_messages=warning'

AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
BANCO="${BANCO_TESTE_DEFUMACAO:-defumacao_test_364}"

command -v psql >/dev/null || { echo "psql não encontrado no PATH"; exit 1; }
pg_isready -q || { echo "nenhum Postgres local aceitando conexões"; exit 1; }

limpar() { dropdb --if-exists "$BANCO" >/dev/null 2>&1 || true; }
trap limpar EXIT

limpar
createdb "$BANCO"

psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/fixture.sql"
# A migração sob teste é o arquivo real que vai para produção. Aplicada duas
# vezes seguidas: prova idempotência de verdade (rodar o runner várias vezes
# só prova que ele é estável, não que a própria migração pode ser reaplicada
# sobre um banco onde já rodou uma vez, que é o caso real de produção).
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$RAIZ/supabase/atualizacao_29_ficha_defumacao.sql"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$RAIZ/supabase/atualizacao_29_ficha_defumacao.sql"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/cenarios.sql"

# O rollback vive comentado no fim da migração; extrai e aplica para provar que
# é SQL válido e que desfaz o que a migração criou.
sed -n '/^-- begin;/,/^-- commit;/p' "$RAIZ/supabase/atualizacao_29_ficha_defumacao.sql" | sed 's/^-- \{0,1\}//' > "$AQUI/.rollback.sql"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/.rollback.sql"
rm -f "$AQUI/.rollback.sql"

sobraram=$(psql -tAq -d "$BANCO" -c "select count(*) from information_schema.columns
  where (table_name = 'defumacoes' and column_name in ('status','cancelada_motivo','cancelada_em','cancelada_por_id','updated_at'))
     or (table_name = 'defumacao_itens' and column_name = 'recebimento_item_id');")
[ "$sobraram" = "0" ] || { echo "rollback não removeu todas as colunas novas (achou $sobraram)"; exit 1; }

constraint_lote=$(psql -tAq -d "$BANCO" -c "select count(*) from pg_constraint where conname = 'defumacoes_lote_unico_por_empresa';")
[ "$constraint_lote" = "0" ] || { echo "rollback não removeu a constraint unique(empresa_id, lote)"; exit 1; }

echo "OK: rollback desfaz a migração"
