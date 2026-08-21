#!/usr/bin/env bash
# Exercita a atualização 28 (lote no recebimento + etiqueta) num Postgres local
# descartável. Não toca em produção. Requer psql no PATH e um servidor local.
#
# Uso: tests/migracao-28/verificar.sh
set -euo pipefail

export PGOPTIONS='-c client_min_messages=warning'

AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
BANCO="${BANCO_TESTE_LOTE:-lote_test_364}"

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
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$RAIZ/supabase/atualizacao_28_lote_recebimento.sql"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$RAIZ/supabase/atualizacao_28_lote_recebimento.sql"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/cenarios.sql"

# O rollback vive comentado no fim da migração; extrai e aplica para provar que
# é SQL válido e que desfaz o que a migração criou.
sed -n '/^-- begin;/,/^-- commit;/p' "$RAIZ/supabase/atualizacao_28_lote_recebimento.sql" | sed 's/^-- \{0,1\}//' > "$AQUI/.rollback.sql"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/.rollback.sql"
rm -f "$AQUI/.rollback.sql"

sobraram=$(psql -tAq -d "$BANCO" -c "select count(*) from information_schema.columns
  where (table_name = 'recebimento_itens' and column_name = 'volumes')
     or (table_name = 'produtos' and column_name = 'conservacao_texto')
     or (table_name = 'empresas' and column_name in ('sim_numero','sim_municipio'));")
[ "$sobraram" = "0" ] || { echo "rollback não removeu todas as colunas novas (achou $sobraram)"; exit 1; }

# O rollback NÃO estreita o check de source_type de volta a ('producao',
# 'producao_interna') — ver comentário no bloco de rollback da migração:
# a tabela é append-only e apagar auditoria para caber num rollback de schema
# seria a coisa errada a fazer. Confere que o check foi reinstalado igual,
# não removido nem estreitado.
check_def=$(psql -tAq -d "$BANCO" -c "select pg_get_constraintdef(oid) from pg_constraint where conname = 'etiqueta_impressoes_source_type_check';")
case "$check_def" in
  *recebimento_item*) ;;
  *) echo "rollback não deveria estreitar o check de source_type (achou: $check_def)"; exit 1 ;;
esac

echo "OK: rollback desfaz a migração"
