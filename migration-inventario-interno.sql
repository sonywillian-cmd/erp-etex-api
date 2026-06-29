-- ─────────────────────────────────────────────────────────────────────────────
-- Inventario Interno Departamental
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS inventario_interno_insumos (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  departamento_id     INT         NOT NULL,
  departamento_nombre VARCHAR(100) NOT NULL,
  nombre              VARCHAR(150) NOT NULL,
  descripcion         VARCHAR(500) NULL,
  unidad              VARCHAR(50)  NOT NULL DEFAULT 'unidad',
  stock_minimo        INT          NOT NULL DEFAULT 1,
  activo              TINYINT(1)   NOT NULL DEFAULT 1,
  creado_por          VARCHAR(100) NULL,
  creado_en           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS inventario_interno_unidades (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  insumo_id            INT         NOT NULL,
  estado               ENUM('sellado','en_uso','agotado') NOT NULL DEFAULT 'sellado',
  notas                VARCHAR(500) NULL,
  registrado_por       VARCHAR(100) NULL,
  modificado_por       VARCHAR(100) NULL,
  fecha_cambio_estado  DATETIME NULL,
  creado_en            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (insumo_id) REFERENCES inventario_interno_insumos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS inventario_interno_requerimientos (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  departamento_id     INT         NOT NULL,
  departamento_nombre VARCHAR(100) NOT NULL,
  estado              ENUM('pendiente','aprobado','rechazado','comprado','recibido') NOT NULL DEFAULT 'pendiente',
  solicitado_por      VARCHAR(100) NOT NULL,
  notas_solicitud     TEXT NULL,
  aprobado_por        VARCHAR(100) NULL,
  aprobado_en         DATETIME NULL,
  notas_admin         TEXT NULL,
  creado_en           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS inventario_interno_req_items (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  requerimiento_id    INT         NOT NULL,
  insumo_id           INT         NULL,
  nombre              VARCHAR(150) NOT NULL,
  unidad              VARCHAR(50)  NOT NULL,
  cantidad_solicitada INT          NOT NULL DEFAULT 1,
  cantidad_recibida   INT          NULL,
  notas               VARCHAR(500) NULL,
  FOREIGN KEY (requerimiento_id) REFERENCES inventario_interno_requerimientos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
