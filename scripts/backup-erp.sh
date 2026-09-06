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

echo "5) Subir a Google Drive..."
RCLONE=/home/u372536694/bin/rclone
GD_REMOTE="gdrive:ERP-Backups"
GD_OK=0
GD_COUNT="?"
# Cifrar ANTES de salir del servidor: el dump contiene clientes, RNC, facturas
# y hashes de contraseñas. La clave vive en ~/.backup_key (600) y DEBE tener
# copia fuera del servidor: sin ella el respaldo cifrado no se puede abrir.
# Restaurar: openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in X.tar.gz.enc -out X.tar.gz -pass file:~/.backup_key
KEY_FILE="/home/u372536694/.backup_key"
UPLOAD_FILE="$FINAL_FILE"
ENC_FILE=""
if [ -f "$KEY_FILE" ]; then
  ENC_FILE="$FINAL_FILE.enc"
  if openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$FINAL_FILE" -out "$ENC_FILE" -pass file:"$KEY_FILE" 2>/tmp/enc_err.log; then
    UPLOAD_FILE="$ENC_FILE"
    echo "   ✓ Cifrado AES-256 para la nube: $(du -h "$ENC_FILE" | cut -f1)"
  else
    echo "   ⚠️ Falló el cifrado ($(head -c 120 /tmp/enc_err.log)): se sube SIN cifrar"
    ENC_FILE=""
  fi
else
  echo "   ⚠️ Sin clave en $KEY_FILE: se sube SIN cifrar"
fi

if [ -x "$RCLONE" ]; then
  if "$RCLONE" copy "$UPLOAD_FILE" "$GD_REMOTE/" --retries 5 --low-level-retries 20 2>/tmp/rclone_err.log; then
    GD_OK=1
    echo "   ✓ Subido a Google Drive ($GD_REMOTE)"
    # Rotación en Drive: borrar backups con más de N días
    "$RCLONE" delete "$GD_REMOTE" --min-age ${DAYS_RETENTION}d 2>/dev/null || true
    GD_COUNT=$("$RCLONE" lsf "$GD_REMOTE" 2>/dev/null | wc -l)
    echo "   ✓ Rotación en Drive aplicada · $GD_COUNT backups en Drive"
  else
    echo "   ⚠️ Error subiendo a Drive: $(head -c 300 /tmp/rclone_err.log 2>/dev/null)"
  fi
else
  echo "   ⚠️ rclone no instalado en ~/bin/rclone"
fi
[ -n "$ENC_FILE" ] && rm -f "$ENC_FILE"

echo "6) Notificar por Telegram (solo texto, sin archivo)..."
if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$ADMIN_CHAT_ID" ]; then
  if [ "$GD_OK" = "1" ]; then
    MSG="✅ Backup ERP subido a Google Drive
📅 $FECHA_HUMANA
💾 BD: $DUMP_SIZE · Uploads: ${UPLOADS_SIZE:-N/A} · Total: $FINAL_SIZE
☁️ Drive: $GD_COUNT backups · 💽 VPS: $TOTAL_BACKUPS ($TOTAL_SIZE)"
  else
    MSG="🚨 Backup ERP: FALLÓ la subida a Google Drive
📅 $FECHA_HUMANA
El backup quedó solo en el VPS: $FINAL_FILE ($FINAL_SIZE). Revisar rclone."
  fi
  curl -s -o /dev/null -d "chat_id=$ADMIN_CHAT_ID" --data-urlencode "text=$MSG" \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" 2>/dev/null \
    && echo "   ✓ Notificación de texto enviada" \
    || echo "   ⚠️ No se pudo notificar por Telegram"
else
  echo "   - Sin token/chat_id, no se notifica"
fi

# Limpiar tmp
rm -rf "$TMPDIR"

echo "===== BACKUP COMPLETADO ====="
