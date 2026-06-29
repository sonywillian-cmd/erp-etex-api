-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  AUDITORÍA DE FLUJO DE EFECTIVO — NAYELI (id=8)                  ║
-- ║  Comparado vs todos los demás usuarios con actividad en caja     ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- ─── 1. SESIONES DE CAJA: aperturas, cierres, diferencias ───────────
SELECT '=== 1. SESIONES DE CAJA — RESUMEN POR USUARIO ===' AS seccion;
SELECT
  usuario_nombre,
  COUNT(*) AS sesiones,
  SUM(CASE WHEN estado='abierta' THEN 1 ELSE 0 END) AS abiertas,
  SUM(CASE WHEN estado='por_validar' THEN 1 ELSE 0 END) AS por_validar,
  SUM(CASE WHEN estado='validada' THEN 1 ELSE 0 END) AS validadas,
  ROUND(SUM(efectivo_inicial), 2)        AS inicial_acum,
  ROUND(SUM(efectivo_cobrado), 2)        AS cobrado_acum,
  ROUND(SUM(efectivo_final_real), 2)     AS final_acum,
  -- Diferencia "declarada" en cierre: lo que dijo el cajero menos lo que esperaba el sistema
  ROUND(SUM(efectivo_final_real) - SUM(efectivo_inicial + efectivo_cobrado), 2) AS diferencia_global
FROM sesiones_caja
GROUP BY usuario_nombre
ORDER BY sesiones DESC;

-- ─── 2. SESIONES DE NAYELI: detalle por sesión ───────────────────────
SELECT '=== 2. SESIONES DE NAYELI — DETALLE CON DIFERENCIAS ===' AS seccion;
SELECT
  numero,
  estado,
  fecha_apertura,
  fecha_cierre,
  ROUND(efectivo_inicial, 2)          AS inicial,
  ROUND(efectivo_cobrado, 2)          AS cobrado,
  ROUND(efectivo_final_real, 2)       AS declarado,
  ROUND(efectivo_inicial + efectivo_cobrado, 2) AS esperado,
  ROUND(efectivo_final_real - (efectivo_inicial + efectivo_cobrado), 2) AS diferencia,
  validado_por,
  LEFT(notas_cierre, 80) AS notas
FROM sesiones_caja
WHERE usuario_nombre = 'NAYELI'
ORDER BY id DESC;

-- ─── 3. EGRESOS DE NAYELI ─────────────────────────────────────────────
SELECT '=== 3. EGRESOS — RESUMEN POR USUARIO ===' AS seccion;
SELECT
  registrado_por,
  COUNT(*) AS cant,
  ROUND(SUM(monto), 2) AS total,
  ROUND(AVG(monto), 2) AS promedio,
  ROUND(MAX(monto), 2) AS max_uno,
  SUM(CASE WHEN monto > 5000 THEN 1 ELSE 0 END) AS sobre_5k,
  SUM(CASE WHEN monto > 10000 THEN 1 ELSE 0 END) AS sobre_10k
FROM egresos_caja
WHERE registrado_por IS NOT NULL
GROUP BY registrado_por
ORDER BY total DESC;

SELECT '=== 4. EGRESOS DE NAYELI — TOP 10 POR MONTO ===' AS seccion;
SELECT
  id, fecha, ROUND(monto, 2) AS monto, categoria, destinatario,
  LEFT(comentario, 60) AS comentario, creado_en
FROM egresos_caja
WHERE registrado_por = 'NAYELI'
ORDER BY monto DESC
LIMIT 10;

-- ─── 5. FACTURAS CREADAS POR NAYELI ─────────────────────────────────
SELECT '=== 5. FACTURAS CREADAS POR NAYELI ===' AS seccion;
SELECT
  COUNT(*) AS total_facturas,
  SUM(CASE WHEN estado='anulada' THEN 1 ELSE 0 END) AS anuladas,
  SUM(CASE WHEN tipo_ncf='B01' THEN 1 ELSE 0 END) AS b01,
  SUM(CASE WHEN tipo_ncf='B02' THEN 1 ELSE 0 END) AS b02,
  SUM(CASE WHEN tipo_ncf='PROFORMA' THEN 1 ELSE 0 END) AS proforma,
  ROUND(SUM(total), 2) AS total_facturado,
  ROUND(SUM(CASE WHEN estado='anulada' THEN total ELSE 0 END), 2) AS total_anulado
FROM facturas
WHERE creado_por = 'NAYELI';

SELECT '=== 6. FACTURAS DE NAYELI VS TODOS — COMPARATIVA ===' AS seccion;
SELECT
  COALESCE(creado_por, 'NULL') AS usuario,
  COUNT(*) AS total,
  SUM(CASE WHEN estado='anulada' THEN 1 ELSE 0 END) AS anuladas,
  ROUND(SUM(CASE WHEN estado='anulada' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS pct_anuladas,
  ROUND(SUM(total), 2) AS facturado
FROM facturas
GROUP BY creado_por
ORDER BY total DESC
LIMIT 10;

-- ─── 7. ACCIONES SENSIBLES DE NAYELI EN AUDITORÍA ──────────────────────
SELECT '=== 7. ACCIONES DE NAYELI POR TIPO (auditoría) ===' AS seccion;
SELECT
  modulo, accion, COUNT(*) AS n,
  ROUND(SUM(monto), 2) AS monto_total
FROM auditoria_financiera
WHERE usuario_nombre = 'NAYELI'
GROUP BY modulo, accion
ORDER BY n DESC;

SELECT '=== 8. ACCIONES SOSPECHOSAS DE NAYELI (anulaciones, ediciones, validaciones) ===' AS seccion;
SELECT
  id, creado_en, modulo, accion, entidad_numero,
  ROUND(monto, 2) AS monto,
  LEFT(descripcion, 100) AS descripcion
FROM auditoria_financiera
WHERE usuario_nombre = 'NAYELI'
  AND accion IN ('anular_por_edicion_orden', 'factura_anulada', 'editar_orden_facturada',
                 'pago_revertido', 'cobro_revertido', 'recibo_eliminado',
                 'sesion_validada', 'desvalidar')
ORDER BY id DESC;

-- ─── 9. RECIBOS y VALIDACIONES tocadas por Nayeli ─────────────────────
SELECT '=== 9. RECIBOS CREADOS POR NAYELI vs VALIDADOS ===' AS seccion;
SELECT
  COUNT(*) AS total_recibos,
  ROUND(SUM(monto), 2) AS total_monto,
  SUM(CASE WHEN validado=1 THEN 1 ELSE 0 END) AS validados,
  SUM(CASE WHEN validado_por='NAYELI' THEN 1 ELSE 0 END) AS auto_validados
FROM recibos_ingreso
WHERE creado_por = 'NAYELI';

SELECT '=== 10. AUTOVALIDACIONES (Nayeli valida lo que creó) — SOSPECHOSO ===' AS seccion;
SELECT
  id, numero, fecha, monto, metodo, cliente_nombre,
  creado_en, validado_en
FROM recibos_ingreso
WHERE creado_por = 'NAYELI' AND validado_por = 'NAYELI'
ORDER BY id DESC
LIMIT 15;

-- ─── 11. EFECTIVO COBRADO en sesiones de Nayeli — desglose ───────────
SELECT '=== 11. PATRONES TEMPORALES: horas de actividad ===' AS seccion;
SELECT
  HOUR(creado_en) AS hora,
  COUNT(*) AS n_acciones
FROM auditoria_financiera
WHERE usuario_nombre = 'NAYELI'
GROUP BY HOUR(creado_en)
ORDER BY hora;
