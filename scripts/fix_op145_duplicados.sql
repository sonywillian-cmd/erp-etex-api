-- Fix OP-2026-145 (CONSTRUCCIONES CASANOVA): eliminar ramas duplicadas
START TRANSACTION;

-- Backup defensivo
CREATE TABLE IF NOT EXISTS _bkp_lotes_op145_dup
  AS SELECT * FROM lotes_produccion WHERE id IN (599,761,762,768,885,886,887);

-- 1. Reasignar SERIGRAFIA (762) al IMPRESION bueno (599)
UPDATE lotes_produccion SET lote_padre_id = 599 WHERE id = 762;

-- 2. Reasignar TERMINACION (887) al SERIGRAFIA bueno (762)
UPDATE lotes_produccion SET lote_padre_id = 762 WHERE id = 887;

-- 3. TERMINACION (887) ahora puede desbloquearse porque su padre 762 está completado
UPDATE lotes_produccion
   SET estado = 'desbloqueado'
 WHERE id = 887 AND estado = 'pendiente';

-- 4. Eliminar SERIGRAFIA duplicado (886, sin trabajo)
DELETE FROM lotes_produccion WHERE id = 886;

-- 5. Eliminar IMPRESION duplicados (3 lotes: 761, 768, 885)
DELETE FROM lotes_produccion WHERE id IN (761, 768, 885);

-- Verificación final
SELECT id, lote_padre_id, departamento, cantidad, estado, responsable, piezas_ok
FROM lotes_produccion
WHERE orden_id = 146
ORDER BY id;

COMMIT;
