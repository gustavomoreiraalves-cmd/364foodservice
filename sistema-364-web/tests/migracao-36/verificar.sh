#!/usr/bin/env bash
# Exercita a atualização 36 (cadastro fiscal e regras tributárias) num Postgres
# local descartável. Não toca em produção. Requer psql no PATH e um servidor
# local. Uso: tests/migracao-36/verificar.sh
set -euo pipefail
export PGOPTIONS='-c client_min_messages=notice'

AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
BANCO="${BANCO_TESTE_FISCAL:-cadastro_fiscal_test_364}"
MIGRACAO="$RAIZ/supabase/atualizacao_36_cadastro_fiscal.sql"

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
  ('grupos_tributarios','naturezas_operacao','regras_tributarias','parametros_simples_nacional',
   'tabela_ncm','tabela_cest','cest_uf_regra','tabela_cfop','tabela_unidade_medida',
   'municipios_ibge','tabela_cclasstrib');")
[ "$restantes" = "0" ] || { echo "rollback deixou $restantes tabela(s) da 36"; exit 1; }

colunas=$(psql -tAq -d "$BANCO" -c "select count(*) from information_schema.columns
  where table_schema = 'public' and table_name = 'produtos'
    and column_name in ('ncm','cest','gtin','origem_mercadoria','ativo_fiscal');")
[ "$colunas" = "0" ] || { echo "rollback deixou $colunas coluna(s) fiscal(is) em produtos"; exit 1; }

sobreviveu=$(psql -tAq -d "$BANCO" -c "select count(*) from information_schema.tables
  where table_schema = 'public' and table_name in ('produtos','clientes','empregadores');")
[ "$sobreviveu" = "3" ] || { echo "rollback derrubou tabela que não era da 36"; exit 1; }
echo "OK: rollback limpo (só o que a 36 criou some)"
echo "MIGRAÇÃO 36 OK"
