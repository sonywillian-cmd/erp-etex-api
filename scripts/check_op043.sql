-- 1. Datos de la orden 043 y todas con balance 0 sin factura
SELECT op.id, op.numero, c.nombre AS cliente,
       op.estado_produccion,
       op.factura_id,
       (SELECT SUM(monto) FROM recibos_ingreso ri WHERE ri.orden_produccion_id = op.id AND ri.factura_id IS NULL) AS total_anticipos,
       (SELECT SUM(lc.cantidad * lc.precio_unitario) FROM lineas_cotizacion lc WHERE lc.cotizacion_id = op.cotizacion_id) AS total_cotizacion
FROM ordenes_produccion op
JOIN clientes c ON c.id = op.cliente_id
WHERE op.numero LIKE '%-043'
   OR op.numero = 'OP-2026-043';

-- 2. Detalle de recibos de la 043
SELECT '--- recibos de 043 ---' AS info;
SELECT ri.id, ri.numero, ri.fecha, ri.monto, ri.metodo, ri.factura_id, ri.estado
FROM recibos_ingreso ri
JOIN ordenes_produccion op ON op.id = ri.orden_produccion_id
WHERE op.numero LIKE '%-043'
ORDER BY ri.fecha;

-- 3. Todas las órdenes con saldo 0 pero sin factura emitida (mismo problema)
SELECT '--- TODAS las ordenes con saldo 0 y sin factura ---' AS info;
SELECT op.id, op.numero, c.nombre AS cliente,
       op.estado_produccion AS estado,
       op.factura_id,
       (SELECT SUM(lc.cantidad * lc.precio_unitario) FROM lineas_cotizacion lc WHERE lc.cotizacion_id = op.cotizacion_id) AS total,
       (SELECT SUM(monto) FROM recibos_ingreso ri WHERE ri.orden_produccion_id = op.id AND ri.factura_id IS NULL) AS anticipos
FROM ordenes_produccion op
JOIN clientes c ON c.id = op.cliente_id
WHERE op.factura_id IS NULL
HAVING anticipos IS NOT NULL
   AND total IS NOT NULL
   AND ROUND(anticipos, 2) >= ROUND(total, 2)
ORDER BY op.id DESC;
