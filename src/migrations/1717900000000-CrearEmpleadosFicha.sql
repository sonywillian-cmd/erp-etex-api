-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  Módulo Empleados — Schema completo                                      ║
-- ║                                                                          ║
-- ║  3 tablas relacionadas, FK opcional con usuarios:                         ║
-- ║   - empleados_ficha       — la ficha de RRHH (1:1 con usuarios opcional)  ║
-- ║   - empleados_vacaciones  — registros por periodo (1:N por empleado)      ║
-- ║   - empleados_documentos  — documentos adjuntos (1:N por empleado)        ║
-- ║                                                                          ║
-- ║  Diseño: empleado_ficha es la fuente de verdad. La relación con          ║
-- ║  usuarios es opcional (un empleado puede no tener acceso al ERP).         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ── empleados_ficha ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS empleados_ficha (
  id                      INT             AUTO_INCREMENT PRIMARY KEY,
  usuario_id              INT             NULL UNIQUE,    -- opcional: empleado con/sin login
  codigo_empleado         VARCHAR(20)     NULL UNIQUE,    -- ej. EMP-001

  -- 1. DATOS PERSONALES
  nombre_completo         VARCHAR(150)    NOT NULL,
  cedula_pasaporte        VARCHAR(20)     NULL UNIQUE,
  fecha_nacimiento        DATE            NULL,
  sexo                    ENUM('masculino','femenino') NULL,
  estado_civil            ENUM('soltero','casado','union_libre','divorciado','viudo') NULL,
  nacionalidad            VARCHAR(60)     NULL DEFAULT 'Dominicana',
  direccion               VARCHAR(255)    NULL,
  sector_ciudad           VARCHAR(100)    NULL,
  telefono_personal       VARCHAR(30)     NULL,
  telefono_alternativo    VARCHAR(30)     NULL,
  correo_electronico      VARCHAR(120)    NULL,

  -- 2. CONTACTO DE EMERGENCIA
  emerg_nombre            VARCHAR(150)    NULL,
  emerg_parentesco        VARCHAR(60)     NULL,
  emerg_tel_principal     VARCHAR(30)     NULL,
  emerg_tel_secundario    VARCHAR(30)     NULL,
  emerg_direccion         VARCHAR(255)    NULL,

  -- 3. INFORMACIÓN FAMILIAR
  tiene_hijos             BOOLEAN         NOT NULL DEFAULT 0,
  cantidad_hijos          TINYINT         NULL,

  -- 4. INFORMACIÓN ACADÉMICA
  nivel_educativo         ENUM('primaria','secundaria','tecnico','universitario','postgrado','maestria','doctorado') NULL,
  profesion               VARCHAR(120)    NULL,
  carrera_estudiada       VARCHAR(120)    NULL,
  institucion_educativa   VARCHAR(150)    NULL,
  cursos_certificaciones  TEXT            NULL,

  -- 5. INFORMACIÓN LABORAL ACTUAL
  fecha_ingreso           DATE            NULL,
  departamento            VARCHAR(80)     NULL,
  cargo                   VARCHAR(80)     NULL,
  supervisor_inmediato    VARCHAR(120)    NULL,
  tipo_contrato           ENUM('fijo','indefinido','temporal','pasantia') NULL,
  horario_trabajo         VARCHAR(255)    NULL,
  salario                 DECIMAL(12,2)   NULL,
  sucursal                VARCHAR(80)     NULL,
  centro_costo            VARCHAR(80)     NULL,

  -- 7. INFORMACIÓN BANCARIA
  banco                   VARCHAR(80)     NULL,
  tipo_cuenta             ENUM('ahorro','corriente') NULL,
  numero_cuenta           VARCHAR(40)     NULL,
  titular_cuenta          VARCHAR(150)    NULL,

  -- 8. INFORMACIÓN DE SALUD Y SEGURIDAD
  tipo_sangre             VARCHAR(10)     NULL,
  tiene_condicion_medica  BOOLEAN         NOT NULL DEFAULT 0,
  condicion_medica_detalle TEXT           NULL,
  tiene_alergia           BOOLEAN         NOT NULL DEFAULT 0,
  alergia_detalle         TEXT            NULL,
  ars                     VARCHAR(80)     NULL,
  afp                     VARCHAR(80)     NULL,

  -- 9. HABILIDADES Y COMPETENCIAS
  -- niveles: NULL=no aplica, 1=básico, 2=intermedio, 3=avanzado
  habilidad_excel         TINYINT         NULL,
  habilidad_word          TINYINT         NULL,
  habilidad_powerpoint    TINYINT         NULL,
  habilidad_erp           TINYINT         NULL,
  habilidad_diseno_grafico TINYINT        NULL,
  otros_conocimientos     TEXT            NULL,

  -- 10. INTERESES PERSONALES
  pasatiempos             TEXT            NULL,
  deportes_favoritos      TEXT            NULL,
  metas_profesionales     TEXT            NULL,
  expectativas_empresa    TEXT            NULL,

  -- 11. RECURSOS ASIGNADOS POR LA EMPRESA (flags)
  rec_computadora         BOOLEAN         NOT NULL DEFAULT 0,
  rec_laptop              BOOLEAN         NOT NULL DEFAULT 0,
  rec_telefono            BOOLEAN         NOT NULL DEFAULT 0,
  rec_uniforme            BOOLEAN         NOT NULL DEFAULT 0,
  rec_correo_corporativo  BOOLEAN         NOT NULL DEFAULT 0,
  rec_usuario_sistema     BOOLEAN         NOT NULL DEFAULT 0,
  rec_vehiculo            BOOLEAN         NOT NULL DEFAULT 0,
  rec_herramientas        BOOLEAN         NOT NULL DEFAULT 0,
  recursos_observaciones  TEXT            NULL,

  -- 12. DOCUMENTOS ENTREGADOS (flags — los archivos van en empleados_documentos)
  doc_copia_cedula        BOOLEAN         NOT NULL DEFAULT 0,
  doc_curriculum          BOOLEAN         NOT NULL DEFAULT 0,
  doc_certificado_medico  BOOLEAN         NOT NULL DEFAULT 0,
  doc_buena_conducta      BOOLEAN         NOT NULL DEFAULT 0,
  doc_certif_academicas   BOOLEAN         NOT NULL DEFAULT 0,
  doc_foto_2x2            BOOLEAN         NOT NULL DEFAULT 0,
  doc_cuenta_bancaria     BOOLEAN         NOT NULL DEFAULT 0,
  doc_contrato_firmado    BOOLEAN         NOT NULL DEFAULT 0,

  -- 13. DECLARACIÓN
  declaracion_firmada     BOOLEAN         NOT NULL DEFAULT 0,
  fecha_firma             DATE            NULL,
  firmada_por_rrhh        VARCHAR(120)    NULL,
  firma_url               VARCHAR(255)    NULL,   -- imagen de la firma escaneada/dibujada

  -- ADICIONALES ERP
  talla_camisa            VARCHAR(10)     NULL,
  talla_pantalon          VARCHAR(10)     NULL,
  talla_zapatos           VARCHAR(10)     NULL,
  licencia_conducir       VARCHAR(40)     NULL,
  licencia_vencimiento    DATE            NULL,
  foto_url                VARCHAR(255)    NULL,

  -- META
  estado                  ENUM('activo','licencia','suspendido','baja') NOT NULL DEFAULT 'activo',
  fecha_baja              DATE            NULL,
  motivo_baja             VARCHAR(255)    NULL,
  notas                   TEXT            NULL,

  -- AUDITORÍA
  creado_por              VARCHAR(120)    NULL,
  creado_en               DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  actualizado_en          DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),

  -- ÍNDICES
  INDEX idx_emp_estado    (estado),
  INDEX idx_emp_dept      (departamento),
  INDEX idx_emp_cedula    (cedula_pasaporte),
  INDEX idx_emp_usuario   (usuario_id),

  -- FK suelta (no cascade) — un usuario puede borrarse y dejar la ficha histórica
  CONSTRAINT fk_emp_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ── empleados_vacaciones ─────────────────────────────────────────────────────
-- Una fila por periodo/año por empleado.
CREATE TABLE IF NOT EXISTS empleados_vacaciones (
  id                INT             AUTO_INCREMENT PRIMARY KEY,
  empleado_id       INT             NOT NULL,
  periodo           VARCHAR(10)     NOT NULL,             -- ej. "2026" o "2025-2026"

  -- Días a los que tiene derecho ese periodo (típico RD: 14)
  dias_derecho      DECIMAL(5,2)    NOT NULL DEFAULT 14,

  -- ¿Decidió tomarlos o cobrarlos?
  decision          ENUM('tomar','cobrar','mixto','sin_definir') NOT NULL DEFAULT 'sin_definir',

  -- Si tomó días — cuántos y cuándo
  dias_tomados      DECIMAL(5,2)    NOT NULL DEFAULT 0,
  fecha_inicio      DATE            NULL,
  fecha_fin         DATE            NULL,

  -- El monto que la empresa le debe pagar por estas vacaciones
  monto_a_pagar     DECIMAL(12,2)   NULL,
  monto_pagado      DECIMAL(12,2)   NOT NULL DEFAULT 0,

  -- Estado del pago (calculado de monto_pagado vs monto_a_pagar pero lo
  -- mantenemos explícito para facilitar filtros)
  estado_pago       ENUM('pendiente','parcial','pagada','no_aplica') NOT NULL DEFAULT 'pendiente',
  fecha_pago        DATE            NULL,
  metodo_pago       VARCHAR(30)     NULL,
  referencia        VARCHAR(100)    NULL,

  notas             TEXT            NULL,

  -- AUDITORÍA
  creado_por        VARCHAR(120)    NULL,
  creado_en         DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  actualizado_en    DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),

  INDEX idx_vac_empleado  (empleado_id),
  INDEX idx_vac_periodo   (periodo),
  INDEX idx_vac_estado    (estado_pago),
  UNIQUE KEY uniq_emp_periodo (empleado_id, periodo),

  CONSTRAINT fk_vac_empleado FOREIGN KEY (empleado_id) REFERENCES empleados_ficha(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ── empleados_documentos ─────────────────────────────────────────────────────
-- Archivos adjuntos: copias de cédula, currículum, certificados, etc.
CREATE TABLE IF NOT EXISTS empleados_documentos (
  id               INT             AUTO_INCREMENT PRIMARY KEY,
  empleado_id      INT             NOT NULL,

  -- Tipo del documento (matchea con flags doc_* de empleados_ficha)
  tipo             ENUM(
    'cedula','curriculum','certificado_medico','buena_conducta',
    'certificacion_academica','foto_2x2','cuenta_bancaria','contrato',
    'firma','foto_empleado','otro'
  ) NOT NULL,

  nombre_archivo   VARCHAR(255)    NOT NULL,
  url              VARCHAR(500)    NOT NULL,        -- ruta en uploads/
  mime_type        VARCHAR(80)     NULL,
  tamano_bytes    INT             NULL,
  descripcion      VARCHAR(255)    NULL,

  -- AUDITORÍA
  subido_por       VARCHAR(120)    NULL,
  creado_en        DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

  INDEX idx_doc_empleado (empleado_id),
  INDEX idx_doc_tipo     (tipo),

  CONSTRAINT fk_doc_empleado FOREIGN KEY (empleado_id) REFERENCES empleados_ficha(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
