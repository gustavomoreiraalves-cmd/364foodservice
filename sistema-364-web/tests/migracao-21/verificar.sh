#!/usr/bin/env bash
# Verifica a migração 21 (dashboard do grupo) num Postgres local descartável.
# Não toca em produção. Requer psql no PATH e um servidor local rodando.
#
# Uso: tests/migracao-21/verificar.sh
set -euo pipefail

export PGOPTIONS='-c client_min_messages=warning'

AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
MIG="$RAIZ/supabase/atualizacao_21_dashboard_grupo.sql"
BANCO="${BANCO_TESTE_MIG21:-mig21_teste}"

command -v psql >/dev/null || { echo "psql não encontrado no PATH"; exit 1; }
pg_isready -q || { echo "nenhum Postgres local aceitando conexões"; exit 1; }

limpar() { dropdb --if-exists "$BANCO" >/dev/null 2>&1 || true; }
trap limpar EXIT

novo_banco() {
  limpar; createdb "$BANCO"
  psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/fixture.sql"
}

echo "== 1. migração aplica e os cenários passam"
novo_banco
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$MIG" >/dev/null
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/cenarios.sql"

echo "== 2. rodar a migração duas vezes não quebra"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$MIG" >/dev/null
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/cenarios.sql" >/dev/null
echo "OK: migração é idempotente"

echo "== 3. falha no meio não deixa estado parcial"
novo_banco
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -c "drop table contas_a_pagar_parcelas;"
if psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$MIG" >/dev/null 2>&1; then
  echo "ERRO: a migração passou sem contas_a_pagar_parcelas, o que não deveria"; exit 1
fi
colunas=$(psql -tAq -d "$BANCO" -c "select count(*) from information_schema.columns where table_name='produtos' and column_name='custo_unitario';")
views=$(psql -tAq -d "$BANCO" -c "select count(*) from information_schema.views where table_name in ('vw_produto_custo','vw_consolidado_mensal');")
[ "$colunas" = "0" ] && [ "$views" = "0" ] || {
  echo "ERRO: a falha deixou $colunas coluna(s) e $views view(s) — a transação não segurou"; exit 1; }
echo "OK: nada foi aplicado, a transação desfez tudo"

echo
echo "3/3 cenários passaram"
