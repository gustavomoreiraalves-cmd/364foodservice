#!/usr/bin/env bash
# Verifica a migração 17 (produção interna) num Postgres local descartável.
# Não toca em produção. Requer psql no PATH e um servidor local rodando.
#
# Uso: tests/migracao-17/verificar.sh
set -euo pipefail

# Os `drop ... if exists` das migrações emitem um NOTICE por objeto ausente.
# São esperados e escondem o que importa na saída.
export PGOPTIONS='-c client_min_messages=warning'

AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
MIG="$RAIZ/supabase/atualizacao_17_producao_interna.sql"
BANCO="${BANCO_TESTE_MIG17:-mig17_teste}"

command -v psql >/dev/null || { echo "psql não encontrado no PATH"; exit 1; }
pg_isready -q || { echo "nenhum Postgres local aceitando conexões"; exit 1; }

limpar() { dropdb --if-exists "$BANCO" >/dev/null 2>&1 || true; }
trap limpar EXIT

novo_banco() {
  limpar; createdb "$BANCO"
  psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/fixture.sql"
}

# ---- 1. Schema como o de produção: audit_logs já existe, com as colunas dela.
echo "== 1. schema igual ao de produção"
novo_banco
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$MIG" >/dev/null
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/cenarios.sql"

# ---- 2. Banco novo: a migração precisa criar audit_logs sozinha.
echo "== 2. banco sem audit_logs"
novo_banco
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -c "drop table audit_logs;"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$MIG" >/dev/null
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/cenarios.sql" >/dev/null
echo "OK: migração criou audit_logs e os cenários passaram"

# ---- 3. Dependência ausente: tem que falhar SEM deixar schema parcial.
# Era assim que a versão anterior corrompia o estado — aplicava metade e parava.
echo "== 3. falha no meio não deixa estado parcial"
novo_banco
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -c "drop function public.fn_bloquear_alteracao();"
if psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$MIG" >/dev/null 2>&1; then
  echo "ERRO: a migração passou sem fn_bloquear_alteracao, o que não deveria"; exit 1
fi
sobrou=$(psql -tAq -d "$BANCO" -c "select count(*) from information_schema.tables where table_schema='public' and table_name in ('produto_regras_validade','producoes_internas','etiqueta_impressoes','producao_descartes');")
colunas=$(psql -tAq -d "$BANCO" -c "select count(*) from information_schema.columns where table_name='produtos' and column_name in ('producao_interna','modelo_etiqueta');")
[ "$sobrou" = "0" ] && [ "$colunas" = "0" ] || {
  echo "ERRO: a falha deixou $sobrou tabela(s) e $colunas coluna(s) aplicadas — a transação não segurou"; exit 1; }
echo "OK: nada foi aplicado, a transação desfez tudo"

echo
echo "3/3 cenários passaram"
