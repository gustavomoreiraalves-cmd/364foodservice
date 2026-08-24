#!/usr/bin/env bash
# Exercita a atualização 35 (conciliação bancária) num Postgres local
# descartável. Não toca em produção. Requer psql no PATH e um servidor local.
# Uso: tests/migracao-35/verificar.sh
set -euo pipefail
export PGOPTIONS='-c client_min_messages=notice'

AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
BANCO="${BANCO_TESTE_CONCILIACAO:-conciliacao_test_364}"
MIGRACAO="$RAIZ/supabase/atualizacao_35_conciliacao_bancaria.sql"

command -v psql >/dev/null || { echo "psql não encontrado no PATH"; exit 1; }
pg_isready -q || { echo "nenhum Postgres local aceitando conexões"; exit 1; }

limpar() {
  # O papel é do cluster, não do banco: dropdb não o remove. Roda pelo banco
  # 'postgres' porque na primeira chamada o banco de teste ainda não existe.
  dropdb --if-exists "$BANCO" >/dev/null 2>&1 || true
  psql -q -d postgres -c 'drop role if exists usuario_teste_35;' >/dev/null 2>&1 || true
}
trap limpar EXIT
limpar
createdb "$BANCO"

psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/fixture.sql"

# Duas vezes seguidas: prova idempotência (if not exists + or replace).
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$MIGRACAO"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$MIGRACAO"

psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/cenarios.sql"

# Rollback: descomenta o bloco do fim do arquivo e roda.
sed -n '/^-- begin;/,/^-- commit;/p' "$MIGRACAO" | sed 's/^-- \{0,1\}//' > "$AQUI/.rollback.sql"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/.rollback.sql"
rm -f "$AQUI/.rollback.sql"

restantes=$(psql -tAq -d "$BANCO" -c "select count(*) from information_schema.tables
  where table_schema = 'public' and table_name in
  ('contas_bancarias','extrato_importacoes','extrato_lancamentos','conciliacao_vinculos','conciliacao_padroes');")
[ "$restantes" = "0" ] || { echo "rollback deixou $restantes tabela(s) da 35"; exit 1; }
sobreviveu=$(psql -tAq -d "$BANCO" -c "select count(*) from information_schema.tables
  where table_schema = 'public' and table_name = 'contas_a_pagar_parcelas';")
[ "$sobreviveu" = "1" ] || { echo "rollback derrubou contas_a_pagar_parcelas"; exit 1; }
echo "OK: rollback limpo (só as tabelas da 35 somem)"
echo "MIGRAÇÃO 35 OK"
