-- ═══════════════════════════════════════════════════════════════════════════
-- Migración: Conduces de entrega + estado listo_parcial
-- Ejecutar en la base de datos de producción
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Agregar estado listo_parcial al enum
ALTER TABLE ordenes_produccion
  MODIFY COLUMN estado
    ENUM('pendiente','en_diseno','en_produccion','en_terminacion','atraso','listo','listo_parcial','entregado')
    NOT NULL DEFAULT 'pendiente';

-- 2. Columnas de entrega en ordenes_produccion
ALTER TABLE ordenes_produccion
  ADD COLUMN IF NOT EXISTS entregado_por    VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS fecha_entrega_real DATETIME NULL,
  ADD COLUMN IF NOT EXISTS notas_entrega    TEXT NULL;

-- 3. Tabla conduces_entrega
CREATE TABLE IF NOT EXISTS conduces_entrega (
  id            INT          NOT NULL AUTO_INCREMENT,
  numero        VARCHAR(30)  NOT NULL UNIQUE,
  orden_id      INT          NOT NULL,
  orden_numero  VARCHAR(50)  NOT NULL,
  tipo          ENUM('parcial','total') NOT NULL DEFAULT 'total',
  fecha         DATETIME     NOT NULL,
  entregado_por VARCHAR(255) NULL,
  recibido_por  VARCHAR(255) NULL,
  items         JSON         NOT NULL,
  notas         TEXT         NULL,
  creado_en     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_conduce_orden (orden_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
