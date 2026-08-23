#!/usr/bin/env bash
# Exercita a atualização 33 (origem/drive_arquivos em pdv_lojas) num
# Postgres local descartável. Não toca em produção. Requer psql no PATH e
# um servidor local. A 33 depende de pdv_lojas, então roda a migração 32
# antes (reaproveita o fixture de tests/migracao-32/, como o próprio
# fixture do PDV Consumer já cobre empresas + funções auxiliares).
# Uso: tests/migracao-33/verificar.sh
set -euo pipefail
export PGOPTIONS='-c client_min_messages=warning'

AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
MIGRACAO_32="$AQUI/../migracao-32"
BANCO="${BANCO_TESTE_PDV_BACKUP:-pdv_backup_test_364}"

command -v psql >/dev/null || { echo "psql não encontrado no PATH"; exit 1; }
pg_isready -q || { echo "nenhum Postgres local aceitando conexões"; exit 1; }

limpar() { dropdb --if-exists "$BANCO" >/dev/null 2>&1 || true; }
trap limpar EXIT
limpar
createdb "$BANCO"

# Base: fixture + migração 32 (cria pdv_lojas e semeia as duas lojas).
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$MIGRACAO_32/fixture.sql"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$RAIZ/supabase/atualizacao_32_pdv_consumer.sql"

# Migração 33: duas vezes seguidas, prova idempotência (colunas e seed).
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$RAIZ/supabase/atualizacao_33_pdv_backup.sql"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$RAIZ/supabase/atualizacao_33_pdv_backup.sql"

# Cenários 1-3: seed intacto (Steakhouse com 7 chaves, Afya inativa, check
# de origem). Rodam antes do cenário 4 para não competir com a edição
# manual do mapa.
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/cenarios.sql"

# Cenário 4: editar drive_arquivos manualmente e rodar a migração de novo
# não pode sobrescrever a edição (guard `where drive_arquivos is null`).
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -c \
  "update pdv_lojas set drive_arquivos = '{\"editado\": \"manual\"}'::jsonb where id_connect = -2147478159;"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$RAIZ/supabase/atualizacao_33_pdv_backup.sql"
mapa=$(psql -tAq -d "$BANCO" -c "select drive_arquivos from pdv_lojas where id_connect = -2147478159;")
[ "$mapa" = '{"editado": "manual"}' ] || { echo "FALHA 4: mapa editado não sobreviveu, achou: $mapa"; exit 1; }
echo "OK 4: seed não pisa em cima de drive_arquivos editado manualmente"

# Rollback: só as duas colunas somem, o resto da 32 fica de pé.
sed -n '/^-- begin;/,/^-- commit;/p' "$RAIZ/supabase/atualizacao_33_pdv_backup.sql" | sed 's/^-- \{0,1\}//' > "$AQUI/.rollback.sql"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/.rollback.sql"
rm -f "$AQUI/.rollback.sql"

colunas=$(psql -tAq -d "$BANCO" -c "select count(*) from information_schema.columns where table_name = 'pdv_lojas' and column_name in ('origem','drive_arquivos');")
[ "$colunas" = "0" ] || { echo "rollback deixou $colunas coluna(s) em pdv_lojas"; exit 1; }
tabela=$(psql -tAq -d "$BANCO" -c "select count(*) from information_schema.tables where table_name = 'pdv_lojas';")
[ "$tabela" = "1" ] || { echo "rollback derrubou pdv_lojas (só devia tirar as colunas)"; exit 1; }
echo "OK: rollback limpo (só as colunas somem)"
echo "MIGRAÇÃO 33 OK"
