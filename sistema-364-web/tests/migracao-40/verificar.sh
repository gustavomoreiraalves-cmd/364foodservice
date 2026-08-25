#!/usr/bin/env bash
# Exercita a atualização 40 (configuração de emissão fiscal NF-e/NFC-e) num
# Postgres local descartável. Não toca em produção. Requer psql no PATH e um
# servidor local. Uso: tests/migracao-40/verificar.sh
set -euo pipefail
export PGOPTIONS='-c client_min_messages=notice'

AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
BANCO="${BANCO_TESTE_FISCAL:-emissao_fiscal_test_364}"
MIGRACAO="$RAIZ/supabase/atualizacao_40_emissao_fiscal.sql"

command -v psql >/dev/null || { echo "psql não encontrado no PATH"; exit 1; }
pg_isready -q || { echo "nenhum Postgres local aceitando conexões"; exit 1; }

limpar() { dropdb --if-exists "$BANCO" >/dev/null 2>&1 || true; }
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
  ('empresas_emissao_fiscal','fiscal_numeracao');")
[ "$restantes" = "0" ] || { echo "rollback deixou $restantes tabela(s) da 40"; exit 1; }

colunas=$(psql -tAq -d "$BANCO" -c "select count(*) from information_schema.columns
  where table_schema = 'public' and table_name = 'empresas'
    and column_name = 'informacoes_complementares_padrao';")
[ "$colunas" = "0" ] || { echo "rollback deixou a coluna informacoes_complementares_padrao em empresas"; exit 1; }

sobreviveu=$(psql -tAq -d "$BANCO" -c "select count(*) from information_schema.tables
  where table_schema = 'public' and table_name in ('empresas','empregadores');")
[ "$sobreviveu" = "2" ] || { echo "rollback derrubou tabela que não era da 40"; exit 1; }
echo "OK: rollback limpo (só o que a 40 criou some)"
echo "MIGRAÇÃO 40 OK"
