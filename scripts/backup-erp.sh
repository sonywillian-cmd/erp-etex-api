#!/bin/bash
# ───────────────────────────────────────────────────────────────────────
# Backup automático del ERP E-Tex 360
# Ejecutado diariamente por el scheduler PM2 a las 3:00 AM
# ───────────────────────────────────────────────────────────────────────
set -e

# Cargar variables de entorno desde ambos .env (portable, sin process substitution)
load_env() {
  local f="$1"
  [ -f "$f" ] || return 0
  while IFS='=' read -r key val; do
    case "$key" in
      ''|\#*) continue ;;
      DB_*|TELEGRAM_*)
        # Quitar comillas y espacios al final
        val="${val%\"}"; val="${val#\"}"
        val="${val%\'}"; val="${val#\'}"
        export "$key=$val"
        ;;
    esac
  done < "$f"
}
load_env /home/u372536694/apps/api/.env
load_env /home/u372536694/apps/telegram-bot/.env

# Configuración
BACKUP_DIR="/home/u372536694/backups"
TS=$(date +%Y%m%d_%H%M%S)
FECHA_HUMANA=$(date +"%d/%m/%Y %H:%M")
TMPDIR=$(mktemp -d)
ADMIN_CHAT_ID="5013252774"
DAYS_RETENTION=30

mkdir -p "$BACKUP_DIR"

echo "===== BACKUP $TS ====="
echo "1) Dump de BD..."
DUMP_FILE="$TMPDIR/db_$TS.sql.gz"
mysqldump -h "${DB_HOST:-127.0.0.1}" -u "${DB_USER}" -p"${DB_PASS}" \
  --single-transaction --quick --lock-tables=false \
  "${DB_NAME}" 2>/dev/null | gzip -9 > "$DUMP_FILE"

DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
echo "   ✓ DB comprimida: $DUMP_SIZE"

echo "2) Tar de uploads..."
UPLOADS_FILE="$TMPDIR/uploads_$TS.tar.gz"
if [ -d "/home/u372536694/domains/etex360erp.com/public_html/uploads" ]; then
  tar -czf "$UPLOADS_FILE" -C /home/u372536694/domains/etex360erp.com/public_html uploads 2>/dev/null
  UPLOADS_SIZE=$(du -h "$UPLOADS_FILE" | cut -f1)
  echo "   ✓ Uploads comprimidos: $UPLOADS_SIZE"
else
  UPLOADS_FILE=""
  echo "   - Sin carpeta de uploads (saltado)"
fi

echo "3) Empacar todo en un solo archivo..."
FINAL_FILE="$BACKUP_DIR/erp_backup_$TS.tar.gz"
if [ -n "$UPLOADS_FILE" ]; then
  tar -czf "$FINAL_FILE" -C "$TMPDIR" "db_$TS.sql.gz" "uploads_$TS.tar.gz"
else
  tar -czf "$FINAL_FILE" -C "$TMPDIR" "db_$TS.sql.gz"
fi
FINAL_SIZE=$(du -h "$FINAL_FILE" | cut -f1)
echo "   ✓ Archivo final: $FINAL_FILE ($FINAL_SIZE)"

echo "4) Rotación: eliminar backups de más de $DAYS_RETENTION días..."
DELETED=$(find "$BACKUP_DIR" -name "erp_backup_*.tar.gz" -mtime +$DAYS_RETENTION -delete -print | wc -l)
echo "   ✓ Eliminados: $DELETED archivos viejos"

# Listar backups actuales
TOTAL_BACKUPS=$(ls -1 "$BACKUP_DIR"/erp_backup_*.tar.gz 2>/dev/null | wc -l)
TOTAL_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
echo "   ✓ Total backups en disco: $TOTAL_BACKUPS ($TOTAL_SIZE)"

echo "5) Enviar copia a Telegram admin..."
if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$ADMIN_CHAT_ID" ]; then
  CAPTION="🗄️ Backup ERP E-Tex 360
📅 $FECHA_HUMANA
💾 BD: $DUMP_SIZE · Uploads: ${UPLOADS_SIZE:-N/A}
📦 Total: $FINAL_SIZE
🔄 Histórico local: $TOTAL_BACKUPS backups ($TOTAL_SIZE)"

  HTTP=$(curl -s -o /tmp/tg_response.json -w "%{http_code}" \
    -F "chat_id=$ADMIN_CHAT_ID" \
    -F "document=@$FINAL_FILE" \
    -F "caption=$CAPTION" \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument" 2>/dev/null)
  if [ "$HTTP" = "200" ]; then
    echo "   ✓ Enviado por Telegram (HTTP $HTTP)"
  else
    echo "   ⚠️ Error envío Telegram (HTTP $HTTP): $(cat /tmp/tg_response.json 2>/dev/null | head -c 200)"
  fi
else
  echo "   - Sin token/chat_id, no se envía a Telegram"
fi

# Limpiar tmp
rm -rf "$TMPDIR"

echo "===== BACKUP COMPLETADO ====="
