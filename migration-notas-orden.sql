-- ═══════════════════════════════════════════════════════════════════════════
-- Migración: Notas internas en órdenes de producción
-- Ejecutar en la base de datos de producción
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE ordenes_produccion
  ADD COLUMN IF NOT EXISTS notas TEXT NULL AFTER especificaciones;
