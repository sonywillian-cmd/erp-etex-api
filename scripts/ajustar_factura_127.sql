-- Ajuste factura 127 (PRO-2026-0118, OP-2026-043 FERNANDO GUERRERO)
-- Cobrado: 9851.45 | Cotizado: 9550.00 | Diferencia: 301.45 (sobrepago)
-- Cierra la factura con el monto cobrado real.

START TRANSACTION;

-- 1. Agregar línea de ajuste por sobrepago
INSERT INTO factura_lineas (factura_id, descripcion, cantidad, precio_unitario, subtotal)
VALUES (127, 'Ajuste por cobro adicional', 1, 301.45, 301.45);

-- 2. Actualizar totales de la factura al monto cobrado real
UPDATE facturas
SET subtotal        = 9851.45,
    total           = 9851.45,
    saldo_pendiente = 0.00,
    estado          = 'pagada'
WHERE id = 127;

-- 3. Verificación: las líneas deben sumar al nuevo subtotal
SELECT
  (SELECT SUM(subtotal) FROM factura_lineas WHERE factura_id = 127) AS suma_lineas,
  (SELECT subtotal FROM facturas WHERE id = 127)                    AS subtotal_factura,
  (SELECT total_pagado FROM facturas WHERE id = 127)                AS total_pagado,
  (SELECT total FROM facturas WHERE id = 127)                       AS total_factura,
  (SELECT saldo_pendiente FROM facturas WHERE id = 127)             AS saldo;

COMMIT;
