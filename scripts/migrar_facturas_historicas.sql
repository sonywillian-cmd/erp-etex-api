-- ════════════════════════════════════════════════════════════════════
-- MIGRACIÓN DE FACTURAS HISTÓRICAS DEL SISTEMA ANTERIOR
-- ════════════════════════════════════════════════════════════════════
-- Fecha: 4 junio 2026
-- Origen: Sistema antiguo
-- Destino: ERP Etex 360
-- ════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────
-- 1) ELIMINAR FACTURA DE PRUEBA FAC-2026-0001 (id=106)
-- ────────────────────────────────────────────────────────────────────
DELETE FROM factura_pagos WHERE factura_id = 106;
DELETE FROM factura_lineas WHERE factura_id = 106;
DELETE FROM facturas WHERE id = 106;

-- ────────────────────────────────────────────────────────────────────
-- 2) CREAR 2 CLIENTES NUEVOS
-- ────────────────────────────────────────────────────────────────────
INSERT INTO clientes (nombre, tipo, documento, telefono, estado, aplica_itbis, ncf_tipo_default, creado_en, actualizado_en)
VALUES
  ('CONSULTORIO ODONTOLOGICO DENTALMENTE SRL', 'empresa', '132837959', '8298517777', 'activo', 1, 'B01', NOW(6), NOW(6)),
  ('ABS FOODS GROUP', 'empresa', '131346855', '8093993862', 'activo', 1, 'B01', NOW(6), NOW(6))
ON DUPLICATE KEY UPDATE
  ncf_tipo_default = 'B01';

-- Obtener IDs de los clientes
SET @id_bella     = (SELECT id FROM clientes WHERE documento = '131693679' LIMIT 1);
SET @id_manantial = (SELECT id FROM clientes WHERE documento = '101846046' LIMIT 1);
SET @id_coremed   = (SELECT id FROM clientes WHERE documento = '132762525' LIMIT 1);
SET @id_dental    = (SELECT id FROM clientes WHERE documento = '132837959' LIMIT 1);
SET @id_abs       = (SELECT id FROM clientes WHERE documento = '131346855' LIMIT 1);

-- ────────────────────────────────────────────────────────────────────
-- 3) CREAR SESIÓN DE CAJA HISTÓRICA PARA SONYW22 (02/06/2026)
-- ────────────────────────────────────────────────────────────────────
SET @sonyw22_id = (SELECT id FROM usuarios WHERE nombre = 'SONYW22' LIMIT 1);

-- Generar numero secuencial: SES-202606-XXX
SET @next_sesion = COALESCE(
  (SELECT MAX(CAST(SUBSTRING_INDEX(numero, '-', -1) AS UNSIGNED)) + 1 FROM sesiones_caja WHERE numero LIKE 'SES-202606-%'),
  1
);

INSERT INTO sesiones_caja (numero, usuario_nombre, usuario_id, estado, efectivo_inicial, efectivo_cobrado, efectivo_final_real, notas_cierre, cerrado_por, validado_por, fecha_apertura, fecha_cierre, fecha_validacion)
VALUES (
  CONCAT('SES-202606-', LPAD(@next_sesion, 3, '0')),
  'SONYW22',
  @sonyw22_id,
  'validada',
  0.00,
  33217.00,  -- total cobrado de las 5 facturas
  33217.00,
  'Sesión histórica creada para migración de facturas del sistema anterior (02-03 jun 2026).',
  'SONYW22',
  'SONYW22',
  '2026-06-02 09:00:00',
  '2026-06-03 19:00:00',
  '2026-06-03 19:00:00'
);

SET @sesion_id = LAST_INSERT_ID();

-- ────────────────────────────────────────────────────────────────────
-- 4) INSERTAR LAS 5 FACTURAS (orden cronológico)
-- ────────────────────────────────────────────────────────────────────

-- ──── FAC-2026-0001 — BELLA MBRIANA SRL (02/06 10:40am) — NCF 3480 ────
INSERT INTO facturas (
  numero, ncf, tipo_ncf, orden_produccion_id, cliente_id, cliente_nombre, cliente_rnc, cliente_telefono,
  metodo_pago, subtotal, itbis, total, total_pagado, saldo_pendiente, estado, estado_dgii,
  fecha_emision, notas, creado_por
) VALUES (
  'FAC-2026-0001', 'B0100003480', 'B01', NULL, @id_bella, 'BELLA MBRIANA SRL', '131693679', '8492779664',
  'efectivo', 400.00, 72.00, 472.00, 472.00, 0.00, 'pagada', 'no_aplica',
  '2026-06-02 10:40:00.000000', 'Migrada del sistema anterior. Equiv. # original: 501606. Especificaciones: LOGO BELLA MBRIANA Y MAS ABAJO VALENTINA',
  'NAYELY'
);
SET @fac1 = LAST_INSERT_ID();

INSERT INTO factura_lineas (factura_id, descripcion, cantidad, precio_unitario, itbis_pct, itbis_monto, subtotal, total) VALUES
  (@fac1, 'BORDADO EN MADILES (BEM)', 1, 400.00, 18.00, 72.00, 400.00, 472.00);

INSERT INTO factura_pagos (factura_id, tipo, metodo, monto, fecha, validado, validado_por, validado_en, creado_por, sesion_caja_id) VALUES
  (@fac1, 'total', 'efectivo', 472.00, '2026-06-02', 1, 'SONYW22', '2026-06-02 10:40:00', 'NAYELY', @sesion_id);

SET @pago1 = LAST_INSERT_ID();

INSERT INTO recibos_ingreso (numero, tipo, factura_id, factura_pago_id, cliente_id, cliente_nombre, metodo, monto, fecha, validado, validado_por, validado_en, creado_por, sesion_caja_id) VALUES
  (CONCAT('REC-2026-', LPAD((SELECT IFNULL(MAX(CAST(SUBSTRING_INDEX(numero, '-', -1) AS UNSIGNED)),0)+1 FROM recibos_ingreso WHERE numero LIKE 'REC-2026-%'),4,'0')),
   'pago_total', @fac1, @pago1, @id_bella, 'BELLA MBRIANA SRL', 'efectivo', 472.00, '2026-06-02', 1, 'SONYW22', '2026-06-02 10:40:00', 'NAYELY', @sesion_id);

-- ──── FAC-2026-0002 — MANANTIAL DE LAS ANTILLAS (02/06 3:31pm) — NCF 3481 ────
INSERT INTO facturas (
  numero, ncf, tipo_ncf, orden_produccion_id, cliente_id, cliente_nombre, cliente_rnc, cliente_telefono,
  metodo_pago, subtotal, itbis, total, total_pagado, saldo_pendiente, estado, estado_dgii,
  fecha_emision, notas, creado_por
) VALUES (
  'FAC-2026-0002', 'B0100003481', 'B01', NULL, @id_manantial, 'MANANTIAL DE LAS ANTILLAS', '101846046', '8098136027',
  'efectivo', 10800.00, 1944.00, 12744.00, 12744.00, 0.00, 'pagada', 'no_aplica',
  '2026-06-02 15:31:00.000000',
  'Migrada del sistema anterior. Equiv. # original: 502606. Especificaciones: LOGO BORDADO FRENTE IZQ PITIRI Y NOMBRES DEBAJO. CAMISAS: M-LEANDRA LEBRON, L-AYDEE CORPORAN. POLOS: M-ISABEL GARCIA, S-KEILA MARTINEZ. GORRAS NOMBRES A LOS LADOS 2 ISABEL GARCIA Y 2 KEILA MARTINEZ',
  'NAYELY'
);
SET @fac2 = LAST_INSERT_ID();

INSERT INTO factura_lineas (factura_id, descripcion, cantidad, precio_unitario, itbis_pct, itbis_monto, subtotal, total) VALUES
  (@fac2, 'POLOSHIRT NEGROS P/Q - BORDADO (PB-09)',        2, 650.00, 18.00,  234.00, 1300.00, 1534.00),
  (@fac2, 'POLOSHIRT BLANCOS P/Q - BORDADO (PB-10)',       4, 650.00, 18.00,  468.00, 2600.00, 3068.00),
  (@fac2, 'GORRA REFORZADA BLANCA BORDADA (GRB-01)',       4, 450.00, 18.00,  324.00, 1800.00, 2124.00),
  (@fac2, 'CAMISA EN OXFOR MANGA CORTA DE MUJER (COMCM)',  6, 850.00, 18.00,  918.00, 5100.00, 6018.00);

INSERT INTO factura_pagos (factura_id, tipo, metodo, monto, fecha, validado, validado_por, validado_en, creado_por, sesion_caja_id) VALUES
  (@fac2, 'total', 'efectivo', 12744.00, '2026-06-02', 1, 'SONYW22', '2026-06-02 15:31:00', 'NAYELY', @sesion_id);

SET @pago2 = LAST_INSERT_ID();

INSERT INTO recibos_ingreso (numero, tipo, factura_id, factura_pago_id, cliente_id, cliente_nombre, metodo, monto, fecha, validado, validado_por, validado_en, creado_por, sesion_caja_id) VALUES
  (CONCAT('REC-2026-', LPAD((SELECT IFNULL(MAX(CAST(SUBSTRING_INDEX(numero, '-', -1) AS UNSIGNED)),0)+1 FROM recibos_ingreso WHERE numero LIKE 'REC-2026-%'),4,'0')),
   'pago_total', @fac2, @pago2, @id_manantial, 'MANANTIAL DE LAS ANTILLAS', 'efectivo', 12744.00, '2026-06-02', 1, 'SONYW22', '2026-06-02 15:31:00', 'NAYELY', @sesion_id);

-- ──── FAC-2026-0003 — COREMED (02/06 5:18pm) — NCF 3482 ────
INSERT INTO facturas (
  numero, ncf, tipo_ncf, orden_produccion_id, cliente_id, cliente_nombre, cliente_rnc, cliente_telefono,
  metodo_pago, subtotal, itbis, total, total_pagado, saldo_pendiente, estado, estado_dgii,
  fecha_emision, notas, creado_por
) VALUES (
  'FAC-2026-0003', 'B0100003482', 'B01', NULL, @id_coremed, 'COREMED CENTRO DE OXIGENOTERAPIA Y REHABILITACION', '132762525', '8092874837',
  'efectivo', 11000.00, 1980.00, 12980.00, 12980.00, 0.00, 'pagada', 'no_aplica',
  '2026-06-02 17:18:00.000000', 'Migrada del sistema anterior. Equiv. # original: 502607. Especificaciones: LOGO COREMED',
  'NAYELY'
);
SET @fac3 = LAST_INSERT_ID();

INSERT INTO factura_lineas (factura_id, descripcion, cantidad, precio_unitario, itbis_pct, itbis_monto, subtotal, total) VALUES
  (@fac3, 'BORDADO EN TOALLA (SB-02)',          20, 350.00, 18.00, 1260.00, 7000.00, 8260.00),
  (@fac3, 'BORDADO EN TOALLA DE MANO (SB-09)',  20, 200.00, 18.00,  720.00, 4000.00, 4720.00);

INSERT INTO factura_pagos (factura_id, tipo, metodo, monto, fecha, validado, validado_por, validado_en, creado_por, sesion_caja_id) VALUES
  (@fac3, 'total', 'efectivo', 12980.00, '2026-06-02', 1, 'SONYW22', '2026-06-02 17:18:00', 'NAYELY', @sesion_id);

SET @pago3 = LAST_INSERT_ID();

INSERT INTO recibos_ingreso (numero, tipo, factura_id, factura_pago_id, cliente_id, cliente_nombre, metodo, monto, fecha, validado, validado_por, validado_en, creado_por, sesion_caja_id) VALUES
  (CONCAT('REC-2026-', LPAD((SELECT IFNULL(MAX(CAST(SUBSTRING_INDEX(numero, '-', -1) AS UNSIGNED)),0)+1 FROM recibos_ingreso WHERE numero LIKE 'REC-2026-%'),4,'0')),
   'pago_total', @fac3, @pago3, @id_coremed, 'COREMED CENTRO DE OXIGENOTERAPIA Y REHABILITACION', 'efectivo', 12980.00, '2026-06-02', 1, 'SONYW22', '2026-06-02 17:18:00', 'NAYELY', @sesion_id);

-- ──── FAC-2026-0004 — DENTALMENTE (02/06 6:55pm) — NCF 3483 ────
INSERT INTO facturas (
  numero, ncf, tipo_ncf, orden_produccion_id, cliente_id, cliente_nombre, cliente_rnc, cliente_telefono,
  metodo_pago, subtotal, itbis, total, total_pagado, saldo_pendiente, estado, estado_dgii,
  fecha_emision, notas, creado_por
) VALUES (
  'FAC-2026-0004', 'B0100003483', 'B01', NULL, @id_dental, 'CONSULTORIO ODONTOLOGICO DENTALMENTE SRL', '132837959', '8298517777',
  'efectivo', 2350.00, 423.00, 2773.00, 2773.00, 0.00, 'pagada', 'no_aplica',
  '2026-06-02 18:55:00.000000',
  'Migrada del sistema anterior. Equiv. # original: 502608. Especificaciones: FRENTE DER. LOGO PRECISION INTELIGENTE SIN LAS LETRAS DE ABAJO Y EN MANGA DER. ISO TIPO. COLORES: BLANCO Y GRIS Y NEGRO Y GRIS EN LA BLANCA. CAMISA BLANCA DEBAJO DEL LOGO CEO GEORDY RODRIGUEZ',
  'NAYELY'
);
SET @fac4 = LAST_INSERT_ID();

INSERT INTO factura_lineas (factura_id, descripcion, cantidad, precio_unitario, itbis_pct, itbis_monto, subtotal, total) VALUES
  (@fac4, 'BORDADO EN CAMISA (SB-05)',                3, 350.00, 18.00, 189.00, 1050.00, 1239.00),
  (@fac4, 'GORRA MICROFIBRA PRIMIUM NEGRA (GMPN)',    2, 650.00, 18.00, 234.00, 1300.00, 1534.00);

INSERT INTO factura_pagos (factura_id, tipo, metodo, monto, fecha, validado, validado_por, validado_en, creado_por, sesion_caja_id) VALUES
  (@fac4, 'total', 'efectivo', 2773.00, '2026-06-02', 1, 'SONYW22', '2026-06-02 18:55:00', 'NAYELY', @sesion_id);

SET @pago4 = LAST_INSERT_ID();

INSERT INTO recibos_ingreso (numero, tipo, factura_id, factura_pago_id, cliente_id, cliente_nombre, metodo, monto, fecha, validado, validado_por, validado_en, creado_por, sesion_caja_id) VALUES
  (CONCAT('REC-2026-', LPAD((SELECT IFNULL(MAX(CAST(SUBSTRING_INDEX(numero, '-', -1) AS UNSIGNED)),0)+1 FROM recibos_ingreso WHERE numero LIKE 'REC-2026-%'),4,'0')),
   'pago_total', @fac4, @pago4, @id_dental, 'CONSULTORIO ODONTOLOGICO DENTALMENTE SRL', 'efectivo', 2773.00, '2026-06-02', 1, 'SONYW22', '2026-06-02 18:55:00', 'NAYELY', @sesion_id);

-- ──── FAC-2026-0005 — ABS FOODS GROUP (03/06 6:35pm) — NCF 3484 ────
INSERT INTO facturas (
  numero, ncf, tipo_ncf, orden_produccion_id, cliente_id, cliente_nombre, cliente_rnc, cliente_telefono,
  metodo_pago, subtotal, itbis, total, total_pagado, saldo_pendiente, estado, estado_dgii,
  fecha_emision, notas, creado_por
) VALUES (
  'FAC-2026-0005', 'B0100003484', 'B01', NULL, @id_abs, 'ABS FOODS GROUP', '131346855', '8093993862',
  'efectivo', 3600.00, 648.00, 4248.00, 4248.00, 0.00, 'pagada', 'no_aplica',
  '2026-06-03 18:35:00.000000', 'Migrada del sistema anterior. Equiv. # original: 502609. Especificaciones: LOGO ABS',
  'NAYELY'
);
SET @fac5 = LAST_INSERT_ID();

INSERT INTO factura_lineas (factura_id, descripcion, cantidad, precio_unitario, itbis_pct, itbis_monto, subtotal, total) VALUES
  (@fac5, 'BORDADO EN ABRIGOS (BEA)', 12, 300.00, 18.00, 648.00, 3600.00, 4248.00);

INSERT INTO factura_pagos (factura_id, tipo, metodo, monto, fecha, validado, validado_por, validado_en, creado_por, sesion_caja_id) VALUES
  (@fac5, 'total', 'efectivo', 4248.00, '2026-06-03', 1, 'SONYW22', '2026-06-03 18:35:00', 'NAYELY', @sesion_id);

SET @pago5 = LAST_INSERT_ID();

INSERT INTO recibos_ingreso (numero, tipo, factura_id, factura_pago_id, cliente_id, cliente_nombre, metodo, monto, fecha, validado, validado_por, validado_en, creado_por, sesion_caja_id) VALUES
  (CONCAT('REC-2026-', LPAD((SELECT IFNULL(MAX(CAST(SUBSTRING_INDEX(numero, '-', -1) AS UNSIGNED)),0)+1 FROM recibos_ingreso WHERE numero LIKE 'REC-2026-%'),4,'0')),
   'pago_total', @fac5, @pago5, @id_abs, 'ABS FOODS GROUP', 'efectivo', 4248.00, '2026-06-03', 1, 'SONYW22', '2026-06-03 18:35:00', 'NAYELY', @sesion_id);

-- ────────────────────────────────────────────────────────────────────
-- 5) VERIFICAR
-- ────────────────────────────────────────────────────────────────────
SELECT 'FACTURAS MIGRADAS:' AS info;
SELECT id, numero, ncf, cliente_nombre, total, estado, fecha_emision FROM facturas WHERE id IN (@fac1, @fac2, @fac3, @fac4, @fac5);

SELECT 'TOTAL COBRADO:' AS info;
SELECT SUM(total) AS total_facturado, SUM(total_pagado) AS total_cobrado FROM facturas WHERE id IN (@fac1, @fac2, @fac3, @fac4, @fac5);

SELECT 'SESION CAJA:' AS info;
SELECT id, numero, usuario_nombre, estado, efectivo_cobrado FROM sesiones_caja WHERE id = @sesion_id;

SELECT 'NCF SECUENCIA B01 ACTUAL:' AS info;
SELECT tipo, actual, (actual + 1) AS proximo, fecha_vencimiento FROM ncf_secuencias WHERE tipo = 'B01';
