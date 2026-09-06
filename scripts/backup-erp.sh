#!/bin/bash
# ───────────────────────────────────────────────────────────────────────
# Backup diario de una instancia de E-Tex 360 (BD + uploads → cifrado → Google Drive)
#
#   bash backup-erp.sh                          → instancia E-Tex (valores por defecto de siempre)
#   bash backup-erp.sh /ruta/api.env printex    → instancia "printex" con su api.env
#
# Todo sale del api.env de la instancia: DB_*, UPLOADS_DIR (o FOTO_UPLOAD_DIR), BACKUP_DIR,
# TELEGRAM_BOT_TOKEN y, opcionalmente, BACKUP_TELEGRAM_CHAT_ID, BACKUP_GD_REMOTE, BACKUP_KEY_FILE.
# ───────────────────────────────────────────────────────────────────────
set -e

ENV_API="${1:-$HOME/apps/api/.env}"
INSTANCIA="${2:-}"

load_env() {   # exporta las claves que nos interesan de un .env (portable, sin process substitution)
  local f="$1"; [ -f "$f" ] || return 0
  while IFS='=' read -r key val; do
    case "$key" in
      ''|\#*) continue ;;
      DB_*|TELEGRAM_*|UPLOADS_DIR|FOTO_UPLOAD_DIR|BACKUP_*)
        val="${val%%[[:space:]]#*}"; val="${val%\"}"; val="${val#\"}"; val="${val%\'}"; val="${val#\'}"
        export "$key=$val" ;;
    esac
  done < "$f"
}
load_env "$ENV_API"
[ -z "$INSTANCIA" ] && load_env "$HOME/apps/telegram-bot/.env"   # E-Tex: el token vive también en el .env del bot
[ -n "${DB_NAME:-}" ] || { echo "No encuentro DB_NAME en $ENV_API"; exit 1; }

# ── Configuración (por instancia, con los valores históricos de E-Tex por defecto) ──
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"
UPLOADS_DIR="${UPLOADS_DIR:-${FOTO_UPLOAD_DIR:+$(dirname "$FOTO_UPLOAD_DIR")}}"
UPLOADS_DIR="${UPLOADS_DIR:-$HOME/domains/etex360erp.com/public_html/uploads}"
ADMIN_CHAT_ID="${BACKUP_TELEGRAM_CHAT_ID:-${INSTANCIA:+}}"; [ -z "$INSTANCIA" ] && ADMIN_CHAT_ID="${BACKUP_TELEGRAM_CHAT_ID:-5013252774}"
GD_REMOTE="${BACKUP_GD_REMOTE:-gdrive:ERP-Backups${INSTANCIA:+/$INSTANCIA}}"
KEY_FILE="${BACKUP_KEY_FILE:-$HOME/.backup_key}"
RCLONE="${RCLONE:-$HOME/bin/rclone}"; [ -x "$RCLONE" ] || RCLONE="$(command -v rclone || true)"
PREFIJO="erp_backup${INSTANCIA:+_$INSTANCIA}"
DAYS_RETENTION="${BACKUP_RETENTION_DAYS:-30}"
ETIQUETA="${INSTANCIA:-ERP}"

TS=$(date +%Y%m%d_%H%M%S)
FECHA_HUMANA=$(date +"%d/%m/%Y %H:%M")
TMPDIR=$(mktemp -d)
mkdir -p "$BACKUP_DIR"

echo "===== BACKUP $ETIQUETA $TS ====="
echo "1) Dump de BD $DB_NAME..."
DUMP_FILE="$TMPDIR/db_$TS.sql.gz"
mysqldump -h "${DB_HOST:-127.0.0.1}" -P "${DB_PORT:-3306}" -u "${DB_USER}" -p"${DB_PASS}" \
  --single-transaction --quick --lock-tables=false \
  "${DB_NAME}" 2>/dev/null | gzip -9 > "$DUMP_FILE"
DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
echo "   ✓ DB comprimida: $DUMP_SIZE"

echo "2) Tar de uploads ($UPLOADS_DIR)..."
UPLOADS_FILE="$TMPDIR/uploads_$TS.tar.gz"
if [ -d "$UPLOADS_DIR" ]; then
  tar -czf "$UPLOADS_FILE" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")" 2>/dev/null
  UPLOADS_SIZE=$(du -h "$UPLOADS_FILE" | cut -f1)
  echo "   ✓ Uploads comprimidos: $UPLOADS_SIZE"
else
  UPLOADS_FILE=""
  echo "   - Sin carpeta de uploads (saltado)"
fi

echo "3) Empacar todo en un solo archivo..."
FINAL_FILE="$BACKUP_DIR/${PREFIJO}_$TS.tar.gz"
if [ -n "$UPLOADS_FILE" ]; then
  tar -czf "$FINAL_FILE" -C "$TMPDIR" "db_$TS.sql.gz" "uploads_$TS.tar.gz"
else
  tar -czf "$FINAL_FILE" -C "$TMPDIR" "db_$TS.sql.gz"
fi
FINAL_SIZE=$(du -h "$FINAL_FILE" | cut -f1)
echo "   ✓ Archivo final: $FINAL_FILE ($FINAL_SIZE)"

echo "4) Rotación local: más de $DAYS_RETENTION días..."
DELETED=$(find "$BACKUP_DIR" -name "${PREFIJO}_*.tar.gz" -mtime +$DAYS_RETENTION -delete -print | wc -l)
echo "   ✓ Eliminados: $DELETED archivos viejos"
TOTAL_BACKUPS=$(ls -1 "$BACKUP_DIR"/${PREFIJO}_*.tar.gz 2>/dev/null | wc -l)
TOTAL_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
echo "   ✓ Total backups en disco: $TOTAL_BACKUPS ($TOTAL_SIZE)"

echo "5) Subir a Google Drive ($GD_REMOTE)..."
GD_OK=0; GD_COUNT="?"
# Cifrar ANTES de salir del servidor: el dump contiene clientes, RNC, facturas y hashes.
# La clave vive en KEY_FILE (600) y DEBE tener copia fuera del servidor.
# Restaurar: openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in X.tar.gz.enc -out X.tar.gz -pass file:KEY_FILE
UPLOAD_FILE="$FINAL_FILE"; ENC_FILE=""
if [ -f "$KEY_FILE" ]; then
  ENC_FILE="$FINAL_FILE.enc"
  if openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$FINAL_FILE" -out "$ENC_FILE" -pass file:"$KEY_FILE" 2>/tmp/enc_err.log; then
    UPLOAD_FILE="$ENC_FILE"; echo "   ✓ Cifrado AES-256 para la nube: $(du -h "$ENC_FILE" | cut -f1)"
  else
    echo "   ⚠️ Falló el cifrado ($(head -c 120 /tmp/enc_err.log)): se sube SIN cifrar"; ENC_FILE=""
  fi
else
  echo "   ⚠️ Sin clave en $KEY_FILE: se sube SIN cifrar"
fi
if [ -n "$RCLONE" ] && [ -x "$RCLONE" ]; then
  if "$RCLONE" copy "$UPLOAD_FILE" "$GD_REMOTE/" --retries 5 --low-level-retries 20 2>/tmp/rclone_err.log; then
    GD_OK=1; echo "   ✓ Subido a Google Drive"
    "$RCLONE" delete "$GD_REMOTE" --min-age ${DAYS_RETENTION}d 2>/dev/null || true
    GD_COUNT=$("$RCLONE" lsf "$GD_REMOTE" 2>/dev/null | wc -l)
    echo "   ✓ Rotación en Drive aplicada · $GD_COUNT backups en Drive"
  else
    echo "   ⚠️ Error subiendo a Drive: $(head -c 300 /tmp/rclone_err.log 2>/dev/null)"
  fi
else
  echo "   ⚠️ rclone no encontrado"
fi
[ -n "$ENC_FILE" ] && rm -f "$ENC_FILE"

echo "6) Notificar por Telegram (solo texto)..."
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "$ADMIN_CHAT_ID" ]; then
  if [ "$GD_OK" = "1" ]; then
    MSG="✅ Backup $ETIQUETA subido a Google Drive
📅 $FECHA_HUMANA
💾 BD: $DUMP_SIZE · Uploads: ${UPLOADS_SIZE:-N/A} · Total: $FINAL_SIZE
☁️ Drive: $GD_COUNT backups · 💽 Servidor: $TOTAL_BACKUPS ($TOTAL_SIZE)"
  else
    MSG="🚨 Backup $ETIQUETA: FALLÓ la subida a Google Drive
📅 $FECHA_HUMANA
El backup quedó solo en el servidor: $FINAL_FILE ($FINAL_SIZE). Revisar rclone."
  fi
  curl -s -o /dev/null -d "chat_id=$ADMIN_CHAT_ID" --data-urlencode "text=$MSG" \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" 2>/dev/null \
    && echo "   ✓ Notificación enviada" || echo "   ⚠️ No se pudo notificar por Telegram"
else
  echo "   - Sin token/chat_id (BACKUP_TELEGRAM_CHAT_ID), no se notifica"
fi

rm -rf "$TMPDIR"
echo "===== BACKUP $ETIQUETA COMPLETADO ====="
