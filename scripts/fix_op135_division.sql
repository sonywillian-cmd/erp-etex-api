-- Fix OP-2026-135: eliminar rama duplicada y dejar cadena única
-- Estado actual (verificado antes de cambiar):
--   560 IMPRESION DTF  94 completado HANZEL
--   747 SERIGRAFIA DTF 47 completado JOHN     (padre 560) ← SE QUEDA
--   877 IMPRESION DTF  94 desbloqueado        ← SE ELIMINA
--   878 SERIGRAFIA DTF 94 pendiente           (padre 877) ← SE ELIMINA
--   879 BORDADO        94 pendiente HECTOR    (padre 878) ← REASIGNAR padre = 747
--   880 TERMINACION    94 pendiente ANA       (padre 879) ← NO CAMBIA

START TRANSACTION;

-- Backup antes de tocar
CREATE TABLE IF NOT EXISTS _bkp_lotes_op135_division
  AS SELECT * FROM lotes_produccion WHERE id IN (877, 878, 879, 880);

-- 1. Reasignar BORDADO al SERIGRAFIA bueno (de JOHN)
UPDATE lotes_produccion
   SET lote_padre_id = 747
 WHERE id = 879;

-- 2. Eliminar el SERIGRAFIA duplicado (pendiente, sin trabajo)
DELETE FROM lotes_produccion WHERE id = 878;

-- 3. Eliminar el IMPRESION duplicado (desbloqueado, sin trabajo)
DELETE FROM lotes_produccion WHERE id = 877;

-- 4. Como SERIGRAFIA 747 está completado, BORDADO 879 debe quedar desbloqueado
UPDATE lotes_produccion
   SET estado = 'desbloqueado'
 WHERE id = 879 AND estado = 'pendiente';

-- Verificación
SELECT id, lote_padre_id, departamento, cantidad, estado, responsable, piezas_ok
FROM lotes_produccion
WHERE orden_id = (SELECT id FROM ordenes_produccion WHERE numero = 'OP-2026-135')
ORDER BY id;

COMMIT;
