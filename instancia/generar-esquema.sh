#!/bin/bash
# Regenera schema.sql y seed-config.sql desde la base de E-Tex (correr EN el servidor origen).
# Uso: bash generar-esquema.sh [/ruta/al/.env de la API]   → deja los archivos en /tmp/instancia
set -e
ENV_ORIGEN="${1:-$HOME/apps/api/.env}"
set -a; . "$ENV_ORIGEN"; set +a
OUT=/tmp/instancia; mkdir -p "$OUT"
H="${DB_HOST:-127.0.0.1}"

# 1) Tablas reales: fuera respaldos y temporales
TABLAS=$(mysql -h "$H" -u "$DB_USER" -p"$DB_PASS" -N -e \
  "SELECT table_name FROM information_schema.tables
   WHERE table_schema='$DB_NAME' AND table_type='BASE TABLE'
     AND table_name NOT REGEXP 'bak|bkp|backup|_old|_tmp|_test|_prueba'
   ORDER BY table_name" | tr '\n' ' ')
echo "Tablas reales: $(echo $TABLAS | wc -w)"

# 2) Estructura sin datos y sin AUTO_INCREMENT (la instancia nueva empieza en 1)
mysqldump -h "$H" -u "$DB_USER" -p"$DB_PASS" --no-data --skip-comments --skip-add-drop-table \
  --single-transaction "$DB_NAME" $TABLAS 2>/dev/null \
  | sed -E 's/ AUTO_INCREMENT=[0-9]+//' > "$OUT/schema.sql"
echo "schema.sql: $(grep -c 'CREATE TABLE' "$OUT/schema.sql") tablas"

# 3) Semilla: configuración que sí se copia
SEED="categorias_producto departamentos tecnicas marcas plantillas_ruta maquinas feriados flujos_produccion horario_plantillas horario_plantilla_dias inventario_interno_unidades incentivos_config"
mysqldump -h "$H" -u "$DB_USER" -p"$DB_PASS" --no-create-info --skip-comments --skip-triggers \
  --single-transaction --complete-insert "$DB_NAME" $SEED 2>/dev/null > "$OUT/seed-config.sql"
# configuracion_sistema: solo claves genéricas (nada de identidad, secretos ni bot_*)
mysqldump -h "$H" -u "$DB_USER" -p"$DB_PASS" --no-create-info --skip-comments --skip-triggers \
  --single-transaction --complete-insert \
  --where="clave IN ('tasa_itbis','margen_default','pdf_mostrar_logo','permisos_roles','accesos_rapidos','categorias_egreso','notif_config')" \
  "$DB_NAME" configuracion_sistema 2>/dev/null >> "$OUT/seed-config.sql"
echo "seed-config.sql: $(grep -c '^INSERT' "$OUT/seed-config.sql") inserts"

# 4) Control: nada sensible en la semilla
if grep -qiE "password|token|ip_publica|@gmail|api_key" "$OUT/seed-config.sql"; then
  echo "AVISO: la semilla contiene algo que parece sensible; revísala antes de subirla." >&2
fi
echo "Listo en $OUT — copiar schema.sql y seed-config.sql a erp-etex-api/instancia/"
