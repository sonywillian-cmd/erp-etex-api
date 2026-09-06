#!/bin/bash
# Crea una instancia nueva de E-Tex 360 (un cliente): BD + semilla + admin + .env + pm2 + nginx.
# Uso: bash crear-instancia.sh /ruta/instancia.env [--forzar|--sin-bd]
# Ver README.md en esta carpeta.
set -euo pipefail
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARCHIVO_ENV="${1:-}"; MODO="${2:-}"     # --forzar | --sin-bd (solo genera archivos)
[ -f "$ARCHIVO_ENV" ] || { echo "Uso: $0 /ruta/instancia.env [--forzar|--sin-bd]  (ver plantillas/instancia.env.example)"; exit 1; }
set -a; . "$ARCHIVO_ENV"; set +a

ok()   { echo "  ✔ $*"; }
fail() { echo "  ✖ $*" >&2; exit 1; }

# ── 1. Validar ────────────────────────────────────────────────────────────────
for v in INSTANCIA EMPRESA_NOMBRE DOMINIO CODIGO_API CODIGO_FRONT CODIGO_BOT BASE_DIR PUERTO_API PUERTO_FRONT DB_HOST DB_PORT DB_NAME DB_USER DB_PASS ADMIN_EMAIL ADMIN_NOMBRE ADMIN_PASSWORD; do
  [ -n "${!v:-}" ] || fail "Falta $v en $ARCHIVO_ENV"
done
[[ "$INSTANCIA" =~ ^[a-z0-9-]+$ ]] || fail "INSTANCIA solo admite minúsculas, números y guiones"
[ ${#ADMIN_PASSWORD} -ge 8 ] || fail "ADMIN_PASSWORD debe tener al menos 8 caracteres"
[ -f "$CODIGO_API/dist/main.js" ] || echo "  ! Aviso: no encuentro $CODIGO_API/dist/main.js (despliega la API antes de arrancar pm2)"
[ "$MODO" = "--sin-bd" ] || [ -d "$CODIGO_API/node_modules/bcrypt" ] || fail "Necesito $CODIGO_API/node_modules (npm install en la API) para generar la contraseña del admin"
[ "$MODO" = "--sin-bd" ] || command -v mysql >/dev/null || fail "Falta el cliente mysql"
command -v node  >/dev/null || fail "Falta node"
DIR_INSTANCIA="$BASE_DIR/$INSTANCIA"
echo "Instancia: $INSTANCIA · $DOMINIO · BD $DB_NAME@$DB_HOST · carpeta $DIR_INSTANCIA"

# ── 2. Base de datos ──────────────────────────────────────────────────────────
if [ "$MODO" = "--sin-bd" ]; then echo "  · Modo --sin-bd: no toco la base de datos (impórtala a mano: schema.sql + seed-config.sql + admin)"; else
if [ -n "${MYSQL_ROOT_PASS:-}" ]; then
  mysql -h "$DB_HOST" -P "$DB_PORT" -u root -p"$MYSQL_ROOT_PASS" -e \
    "CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
     CREATE USER IF NOT EXISTS '$DB_USER'@'%' IDENTIFIED BY '$DB_PASS';
     CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASS';
     GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'%', '$DB_USER'@'localhost'; FLUSH PRIVILEGES;"
  ok "Base de datos y usuario creados"
fi
MYSQL=(mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME")
"${MYSQL[@]}" -e "SELECT 1" >/dev/null 2>&1 || fail "No puedo conectar a $DB_NAME con $DB_USER (¿existe la BD? en hosting compartido créala en hPanel)"
N_TABLAS=$("${MYSQL[@]}" -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$DB_NAME'")
if [ "$N_TABLAS" != "0" ] && [ "$MODO" != "--forzar" ]; then
  fail "La base $DB_NAME ya tiene $N_TABLAS tablas. No la toco. (usa --forzar solo si sabes lo que haces)"
fi

# ── 3. Esquema + semilla ──────────────────────────────────────────────────────
"${MYSQL[@]}" < "$AQUI/schema.sql";       ok "Esquema importado ($(grep -c 'CREATE TABLE' "$AQUI/schema.sql") tablas)"
"${MYSQL[@]}" < "$AQUI/seed-config.sql";  ok "Semilla de configuración importada"

# ── 4. Datos mínimos de la empresa ────────────────────────────────────────────
HASH=$(node "$AQUI/crear-admin.js" "$ADMIN_PASSWORD" "$CODIGO_API/node_modules")
esc() { printf "%s" "$1" | sed "s/'/''/g"; }
"${MYSQL[@]}" <<SQL
INSERT INTO sucursales (nombre, radio_m, activo) VALUES ('PRINCIPAL', 100, 1);
INSERT INTO configuracion_sistema (clave, valor, descripcion) VALUES
  ('nombre_empresa', '$(esc "$EMPRESA_NOMBRE")', 'Nombre comercial'),
  ('razon_social',   '$(esc "$EMPRESA_NOMBRE")', 'Razón social')
  ON DUPLICATE KEY UPDATE valor = VALUES(valor);
INSERT INTO usuarios (email, nombre, password_hash, rol, activo, debe_cambiar_password)
  VALUES ('$(esc "$ADMIN_EMAIL")', '$(esc "$ADMIN_NOMBRE")', '$HASH', 'admin', 1, 1);
SQL
ok "Sucursal PRINCIPAL, nombre de empresa y admin $ADMIN_EMAIL (debe cambiar la contraseña al entrar)"
fi

# ── 5. Carpetas y secretos ────────────────────────────────────────────────────
mkdir -p "$DIR_INSTANCIA/uploads/gastos" "$DIR_INSTANCIA/uploads/empleados" "$DIR_INSTANCIA/backups"
JWT_SECRET=$(openssl rand -hex 32); CONFIG_CIPHER_KEY=$(openssl rand -hex 32); TELEGRAM_BOT_SHARED_SECRET=$(openssl rand -hex 24)
export INSTANCIA EMPRESA_NOMBRE DOMINIO CODIGO_API CODIGO_FRONT CODIGO_BOT DIR_INSTANCIA PUERTO_API PUERTO_FRONT \
       DB_HOST DB_PORT DB_NAME DB_USER DB_PASS JWT_SECRET CONFIG_CIPHER_KEY TELEGRAM_BOT_SHARED_SECRET \
       TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}" GEMINI_API_KEY="${GEMINI_API_KEY:-}" GEMINI_MODEL="${GEMINI_MODEL:-gemini-2.5-flash}"
# Sustituye solo ${NOMBRE} de nuestra lista (las variables de nginx como $host quedan intactas). Sin dependencias.
VARS="INSTANCIA EMPRESA_NOMBRE DOMINIO CODIGO_API CODIGO_FRONT CODIGO_BOT DIR_INSTANCIA PUERTO_API PUERTO_FRONT DB_HOST DB_PORT DB_NAME DB_USER DB_PASS JWT_SECRET CONFIG_CIPHER_KEY TELEGRAM_BOT_SHARED_SECRET TELEGRAM_BOT_TOKEN GEMINI_API_KEY GEMINI_MODEL"
plantilla() {  # plantilla <origen> <destino>
  local cont; cont="$(cat "$1")"
  for v in $VARS; do local val="${!v:-}"; cont="${cont//\$\{$v\}/$val}"; done
  printf "%s
" "$cont" > "$2"
}
for p in api.env bot.env frontend.env; do plantilla "$AQUI/plantillas/$p" "$DIR_INSTANCIA/$p"; chmod 600 "$DIR_INSTANCIA/$p"; done
plantilla "$AQUI/plantillas/ecosystem.config.js" "$DIR_INSTANCIA/ecosystem.$INSTANCIA.config.js"
plantilla "$AQUI/plantillas/nginx.conf"          "$DIR_INSTANCIA/nginx.$INSTANCIA.conf"
ok "Archivos en $DIR_INSTANCIA: api.env, bot.env, frontend.env, ecosystem.$INSTANCIA.config.js, nginx.$INSTANCIA.conf"

cat <<FIN

Instancia '$INSTANCIA' creada. Siguientes pasos en el servidor:
  1. pm2 start $DIR_INSTANCIA/ecosystem.$INSTANCIA.config.js && pm2 save
  2. sudo cp $DIR_INSTANCIA/nginx.$INSTANCIA.conf /etc/nginx/sites-available/$INSTANCIA && sudo ln -s /etc/nginx/sites-available/$INSTANCIA /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx
  3. sudo certbot --nginx -d $DOMINIO
  4. Entrar en https://$DOMINIO con $ADMIN_EMAIL y la contraseña temporal; luego Ajustes: Empresa (logo, RNC), Apariencia, NCF, Cuentas bancarias, Bot de Telegram.
FIN
