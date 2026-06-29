SELECT op.id, op.numero, c.nombre AS cliente, jt.producto, jt.cantidad AS linea_qty, jt.tecnica
FROM ordenes_produccion op
JOIN clientes c ON c.id = op.cliente_id
JOIN JSON_TABLE(op.lineas_produccion, '$[*]' COLUMNS (
  producto VARCHAR(255) PATH '$.producto',
  cantidad DECIMAL(10,2) PATH '$.cantidad',
  tecnica  VARCHAR(255) PATH '$.tecnica'
)) jt ON 1=1
WHERE op.id IN (180,176,175,173,168,164,163,161,158,151)
  AND jt.producto LIKE 'SERVICIO%'
ORDER BY op.id DESC, jt.producto;
