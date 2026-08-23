#!/usr/bin/env bash
# =========================================================
# 364 OS — BACKUP COMPLETO (banco + anexos do Storage)
#
# O que faz:
#   1. pg_dump do banco Supabase (formato custom, restauravel com pg_restore)
#   2. dump do schema em SQL puro (leitura/diff das migrations)
#   3. espelho INCREMENTAL dos buckets do Storage (so baixa arquivo novo)
#   4. retencao: mantem 14 dumps diarios + o dump do dia 01 de cada mes
#
# Uso:  bash scripts/backup-364.sh
# =========================================================
set -euo pipefail

PROJETO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJETO_DIR"

# Le arquivos .env SEM usar "source": o bash nao interpreta nada dentro do
# valor, entao senha com $, crase, aspas ou barra invertida funciona igual.
# Aspas externas (simples ou duplas) sao opcionais e removidas se houver par.
carregar_env() {
  local arquivo="$1" linha chave valor
  [ -f "$arquivo" ] || return 0
  while IFS= read -r linha || [ -n "$linha" ]; do
    linha="${linha%$'\r'}"
    case "$linha" in ''|'#'*) continue ;; esac
    case "$linha" in *=*) ;; *) continue ;; esac
    chave="${linha%%=*}"
    valor="${linha#*=}"
    chave="${chave#export }"
    chave="$(printf '%s' "$chave" | tr -d '[:space:]')"
    case "$chave" in
      ''|*[!A-Za-z0-9_]*) continue ;;
    esac
    case "$valor" in
      \"*\") valor="${valor#\"}" ; valor="${valor%\"}" ;;
      \'*\') valor="${valor#\'}" ; valor="${valor%\'}" ;;
    esac
    export "$chave=$valor"
  done < "$arquivo"
}

carregar_env "$PROJETO_DIR/.env.local"
carregar_env "$PROJETO_DIR/.env.backup"

# ---------- destino ----------
if [ -z "${BACKUP_DESTINO:-}" ]; then
  DRIVE_DIR="$(ls -d "$HOME/Library/CloudStorage/GoogleDrive-"*/ 2>/dev/null | head -n1 || true)"
  if [ -z "$DRIVE_DIR" ]; then
    echo "ERRO: Google Drive nao encontrado. Defina BACKUP_DESTINO no .env.backup." >&2
    exit 1
  fi
  BACKUP_DESTINO="${DRIVE_DIR}Meu Drive/364 Backups"
fi

DIR_BANCO="$BACKUP_DESTINO/banco"
DIR_STORAGE="$BACKUP_DESTINO/storage"
DIR_LOGS="$BACKUP_DESTINO/logs"
mkdir -p "$DIR_BANCO" "$DIR_STORAGE" "$DIR_LOGS"

CARIMBO="$(date +%Y-%m-%d_%H%M)"
LOG="$DIR_LOGS/backup-$(date +%Y-%m).log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

log "===== inicio do backup ($CARIMBO) ====="
log "destino: $BACKUP_DESTINO"

# ---------- pre-requisitos ----------
if ! command -v pg_dump >/dev/null 2>&1; then
  log "ERRO: pg_dump nao encontrado."
  log "Instale com:  brew install postgresql@17"
  log "e adicione ao PATH:  echo 'export PATH=\"/opt/homebrew/opt/postgresql@17/bin:\$PATH\"' >> ~/.zshrc"
  exit 1
fi

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  log "ERRO: SUPABASE_DB_URL nao definida no .env.backup."
  exit 1
fi

case "$SUPABASE_DB_URL" in
  postgres://*|postgresql://*) ;;
  *)
    log "ERRO: SUPABASE_DB_URL nao parece uma URI valida (deve comecar com postgresql://)."
    log "Provavel aspa sobrando ou linha quebrada no .env.backup."
    exit 1
    ;;
esac

PG_MAJOR="$(pg_dump --version | sed -E 's/[^0-9]*([0-9]+).*/\1/')"
if [ "$PG_MAJOR" -lt 15 ]; then
  log "ERRO: pg_dump v$PG_MAJOR e antigo demais para o Postgres do Supabase."
  log "Instale o postgresql@17 (brew) e refaca o PATH."
  exit 1
fi
log "pg_dump v$PG_MAJOR ok"

# ---------- 1. dump do banco ----------
TMP_DUMP="$(mktemp -t 364dump)"
trap 'rm -f "$TMP_DUMP" "$TMP_DUMP.sql"' EXIT

log "dump do banco em andamento..."
pg_dump "$SUPABASE_DB_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --quote-all-identifiers \
  --file="$TMP_DUMP"

ARQ_BANCO="$DIR_BANCO/364-banco-$CARIMBO.dump"
if [ -n "${BACKUP_SENHA:-}" ]; then
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
    -in "$TMP_DUMP" -out "$ARQ_BANCO.enc" -pass env:BACKUP_SENHA
  ARQ_BANCO="$ARQ_BANCO.enc"
  log "dump cifrado (AES-256)"
else
  cp "$TMP_DUMP" "$ARQ_BANCO"
  log "AVISO: dump SEM cifra. Defina BACKUP_SENHA no .env.backup (o dump contem CPF, e-mail e dado biometrico)."
fi
log "banco salvo: $(basename "$ARQ_BANCO") ($(du -h "$ARQ_BANCO" | cut -f1))"

# ---------- 2. schema em SQL puro ----------
pg_dump "$SUPABASE_DB_URL" --schema-only --no-owner --no-privileges \
  --file="$DIR_BANCO/364-schema-$CARIMBO.sql"
log "schema salvo: 364-schema-$CARIMBO.sql"

# ---------- 3. espelho do Storage ----------
if [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ] && [ -n "${NEXT_PUBLIC_SUPABASE_URL:-}" ]; then
  log "espelhando buckets do Storage (incremental)..."
  node "$PROJETO_DIR/scripts/backup-storage.mjs" "$DIR_STORAGE" 2>&1 | tee -a "$LOG"
else
  log "AVISO: Storage nao espelhado (falta NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no .env.local)."
fi

# ---------- 4. retencao ----------
# apaga dumps com mais de 14 dias, exceto os do dia 01 (arquivo mensal permanente)
APAGADOS=0
while IFS= read -r antigo; do
  case "$(basename "$antigo")" in
    *-01_*) continue ;;
  esac
  rm -f "$antigo"
  APAGADOS=$((APAGADOS + 1))
done < <(find "$DIR_BANCO" -type f \( -name '364-banco-*' -o -name '364-schema-*' \) -mtime +14 2>/dev/null)
log "retencao: $APAGADOS arquivo(s) antigo(s) removido(s) (dumps do dia 01 sao mantidos para sempre)"

# ---------- resumo ----------
{
  echo "Ultimo backup: $(date '+%d/%m/%Y as %H:%M')"
  echo "Banco:   $(basename "$ARQ_BANCO")"
  echo "Storage: $(du -sh "$DIR_STORAGE" 2>/dev/null | cut -f1) espelhados"
  echo "Cifrado: $([ -n "${BACKUP_SENHA:-}" ] && echo sim || echo NAO)"
} > "$BACKUP_DESTINO/ULTIMO-BACKUP.txt"

log "===== backup concluido ====="
