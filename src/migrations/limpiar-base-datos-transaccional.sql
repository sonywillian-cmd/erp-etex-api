-- ══════════════════════════════════════════════════════════════════════
-- LIMPIEZA DE DATOS TRANSACCIONALES — E-Tex 360 ERP
-- Ejecutar en phpMyAdmin > base de datos u372536694_u372536694_erp
-- ══════════════════════════════════════════════════════════════════════

SET FOREIGN_KEY_CHECKS = 0;

-- ── Producción ──────────────────────────────────────────────────────
TRUNCATE TABLE recepciones_departamento;
TRUNCATE TABLE pausas_produccion;
TRUNCATE TABLE procesos_lote;
TRUNCATE TABLE tareas_produccion;
TRUNCATE TABLE reservas_inventario;
TRUNCATE TABLE lotes_produccion;
TRUNCATE TABLE ordenes_produccion;

-- ── Ventas / Cotizaciones ────────────────────────────────────────────
TRUNCATE TABLE lineas_cotizacion;
TRUNCATE TABLE pagos;
TRUNCATE TABLE cotizaciones;

-- ── Inventario ───────────────────────────────────────────────────────
TRUNCATE TABLE movimientos_inventario;
TRUNCATE TABLE danos_produccion;

-- ── Compras ──────────────────────────────────────────────────────────
TRUNCATE TABLE ordenes_compra;

-- ── Notas ────────────────────────────────────────────────────────────
TRUNCATE TABLE notas_recordatorio;

-- ── Resetear stock de productos a 0 ─────────────────────────────────
UPDATE productos SET stock_actual = 0 WHERE stock_actual IS NOT NULL;
UPDATE productos SET stock = 0 WHERE stock IS NOT NULL;

-- ── Resetear AUTO_INCREMENT ──────────────────────────────────────────
ALTER TABLE ordenes_produccion  AUTO_INCREMENT = 1;
ALTER TABLE cotizaciones         AUTO_INCREMENT = 1;
ALTER TABLE ordenes_compra       AUTO_INCREMENT = 1;
ALTER TABLE lotes_produccion     AUTO_INCREMENT = 1;

SET FOREIGN_KEY_CHECKS = 1;

-- ══════════════════════════════════════════════════════════════════════
-- Conservado intacto:
--   usuarios, clientes, productos, variantes_producto, bom_items,
--   departamentos, maquinas, tecnicas, plantillas_ruta, marcas,
--   categorias_producto, configuracion_sistema, flujos_produccion,
--   proveedores, proveedor_productos
-- ══════════════════════════════════════════════════════════════════════
