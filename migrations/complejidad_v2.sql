-- ============================================================
--  MIGRACIÓN: Complejidades v1 → v2
--  basica → sencilla  |  media → mediana  |  + exenta (nueva)
--  Ejecutar en orden — NO omitir ningún paso.
-- ============================================================

-- ── PASO 1: Ampliar el ENUM (añadir nuevos valores sin quitar los viejos) ──────

ALTER TABLE incentivos_config
  MODIFY COLUMN complejidad
  ENUM('basica','media','avanzada','exenta','sencilla','mediana') NOT NULL DEFAULT 'mediana';

ALTER TABLE ordenes_produccion
  MODIFY COLUMN complejidad
  ENUM('basica','media','avanzada','exenta','sencilla','mediana') DEFAULT 'mediana';

-- ── PASO 2: Migrar datos — renombrar valores existentes ───────────────────────

-- incentivos_config
UPDATE incentivos_config SET complejidad = 'sencilla' WHERE complejidad = 'basica';
UPDATE incentivos_config SET complejidad = 'mediana'  WHERE complejidad = 'media';

-- ordenes_produccion
UPDATE ordenes_produccion SET complejidad = 'sencilla' WHERE complejidad = 'basica';
UPDATE ordenes_produccion SET complejidad = 'mediana'  WHERE complejidad = 'media';

-- ── PASO 3: Migrar JSON de precios en incentivos_empleado ─────────────────────
--  { basica: X, media: Y, avanzada: Z }
--  → { exenta: 0, sencilla: X, mediana: Y, avanzada: Z }

UPDATE incentivos_empleado
SET precios = JSON_OBJECT(
  'exenta',   0,
  'sencilla', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(precios, '$.basica')),   0),
  'mediana',  COALESCE(JSON_UNQUOTE(JSON_EXTRACT(precios, '$.media')),    0),
  'avanzada', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(precios, '$.avanzada')), 0)
)
WHERE JSON_EXTRACT(precios, '$.basica') IS NOT NULL
   OR JSON_EXTRACT(precios, '$.media')  IS NOT NULL;

-- ── PASO 4: Cerrar el ENUM — quitar valores v1 obsoletos ─────────────────────

ALTER TABLE incentivos_config
  MODIFY COLUMN complejidad
  ENUM('exenta','sencilla','mediana','avanzada') NOT NULL DEFAULT 'mediana';

ALTER TABLE ordenes_produccion
  MODIFY COLUMN complejidad
  ENUM('exenta','sencilla','mediana','avanzada') DEFAULT 'mediana';

-- ── VERIFICACIÓN ──────────────────────────────────────────────────────────────

SELECT 'incentivos_config'  AS tabla, complejidad, COUNT(*) AS filas
FROM incentivos_config GROUP BY complejidad
UNION ALL
SELECT 'ordenes_produccion' AS tabla, IFNULL(complejidad,'NULL') AS complejidad, COUNT(*) AS filas
FROM ordenes_produccion GROUP BY complejidad;

-- Si la columna precios migró bien, todos los registros deben tener $.exenta:
SELECT id, usuario_nombre,
       JSON_EXTRACT(precios, '$.exenta')   AS exenta,
       JSON_EXTRACT(precios, '$.sencilla') AS sencilla,
       JSON_EXTRACT(precios, '$.mediana')  AS mediana,
       JSON_EXTRACT(precios, '$.avanzada') AS avanzada
FROM incentivos_empleado LIMIT 20;
