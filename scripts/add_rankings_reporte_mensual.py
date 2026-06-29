"""Agrega 3 secciones al reporte mensual:
1. top_productos (físicos)
2. top_servicios
3. top_operarios (volumen + eficiencia + velocidad)
4. comparacion_mes_anterior con deltas
"""
import re

F = '/home/u372536694/apps/api/dist/metricas/metricas.service.js'
s = open(F).read()

marker = "        // PAGOS HUERFANOS (sin sesion de caja)"

if 'top_productos' in s:
    print('Ya estaba agregado')
else:
    bloque_nuevo = '''
        // TOP PRODUCTOS (fisicos) — top 10 por monto vendido
        const topProductos = await this.ds.query(`
            SELECT
                COALESCE(p.nombre, fl.descripcion) AS nombre,
                p.id AS producto_id,
                COALESCE(p.tipo_producto, 'sin_clasificar') AS tipo,
                SUM(fl.cantidad) AS cantidad,
                ROUND(SUM(fl.subtotal), 2) AS monto
            FROM factura_lineas fl
            LEFT JOIN productos p ON p.id = fl.producto_id
            LEFT JOIN facturas f ON f.id = fl.factura_id
            WHERE f.fecha_emision BETWEEN ? AND ?
              AND f.estado != 'anulada'
              AND (p.tipo_producto IN ('fisico_fabricado', 'fisico_comprado') OR p.id IS NULL)
              AND fl.descripcion NOT REGEXP 'BORDADO|DISE[Ñ\\\\\\\\u00d1]O|SUBLIMACION|SUBLIMACI[ÓO]N|IMPRESI[ÓO]N|SERIGRAFIA'
            GROUP BY producto_id, nombre, tipo
            HAVING monto > 0
            ORDER BY monto DESC
            LIMIT 10
        `, [desde, hastaInclusive]);

        // TOP SERVICIOS — top 10 por monto generado
        const topServicios = await this.ds.query(`
            SELECT
                COALESCE(p.nombre, fl.descripcion) AS nombre,
                p.id AS producto_id,
                SUM(fl.cantidad) AS cantidad,
                ROUND(SUM(fl.subtotal), 2) AS monto
            FROM factura_lineas fl
            LEFT JOIN productos p ON p.id = fl.producto_id
            LEFT JOIN facturas f ON f.id = fl.factura_id
            WHERE f.fecha_emision BETWEEN ? AND ?
              AND f.estado != 'anulada'
              AND (p.tipo_producto = 'servicio'
                   OR fl.descripcion REGEXP 'BORDADO|DISE[Ñ\\\\\\\\u00d1]O|SUBLIMACION|SUBLIMACI[ÓO]N|IMPRESI[ÓO]N|SERIGRAFIA')
            GROUP BY producto_id, nombre
            HAVING monto > 0
            ORDER BY monto DESC
            LIMIT 10
        `, [desde, hastaInclusive]);

        // TOP OPERARIOS — 3 metricas distintas
        // a) Volumen: piezas OK totales
        const operariosVolumen = await this.ds.query(`
            SELECT operario_nombre AS nombre, departamento,
                   SUM(piezas_ok) AS piezas_ok,
                   SUM(piezas_retrabajo) AS piezas_retrabajo,
                   SUM(piezas_descarte) AS piezas_descarte,
                   COUNT(*) AS lotes_completados
            FROM registros_tiempo_operario
            WHERE fecha BETWEEN ? AND ? AND operario_nombre IS NOT NULL
            GROUP BY operario_nombre, departamento
            HAVING piezas_ok > 0
            ORDER BY piezas_ok DESC LIMIT 10
        `, [desde, hasta]);

        // b) Eficiencia: % de piezas OK sobre total procesadas
        const operariosEficiencia = await this.ds.query(`
            SELECT operario_nombre AS nombre, departamento,
                   SUM(piezas_ok) AS piezas_ok,
                   SUM(piezas_ok + piezas_retrabajo + piezas_descarte) AS total_procesadas,
                   ROUND(
                       100.0 * SUM(piezas_ok) / NULLIF(SUM(piezas_ok + piezas_retrabajo + piezas_descarte), 0),
                       1
                   ) AS pct_eficiencia
            FROM registros_tiempo_operario
            WHERE fecha BETWEEN ? AND ? AND operario_nombre IS NOT NULL
            GROUP BY operario_nombre, departamento
            HAVING total_procesadas >= 5
            ORDER BY pct_eficiencia DESC, piezas_ok DESC LIMIT 10
        `, [desde, hasta]);

        // c) Velocidad: minutos promedio por pieza (menor = mejor)
        const operariosVelocidad = await this.ds.query(`
            SELECT operario_nombre AS nombre, departamento,
                   ROUND(AVG(min_por_pieza), 2) AS min_por_pieza,
                   SUM(piezas_ok) AS piezas_ok,
                   COUNT(*) AS lotes
            FROM registros_tiempo_operario
            WHERE fecha BETWEEN ? AND ? AND operario_nombre IS NOT NULL
              AND min_por_pieza IS NOT NULL AND min_por_pieza > 0
            GROUP BY operario_nombre, departamento
            HAVING piezas_ok >= 5
            ORDER BY min_por_pieza ASC LIMIT 10
        `, [desde, hasta]);

        // COMPARACION MES ANTERIOR
        const fechaAnt = new Date(y, m - 2, 1);
        const yAnt = fechaAnt.getFullYear();
        const mAnt = fechaAnt.getMonth() + 1;
        const desdeAnt = yAnt + '-' + String(mAnt).padStart(2, '0') + '-01';
        const ultimoAnt = new Date(yAnt, mAnt, 0).getDate();
        const hastaAnt = yAnt + '-' + String(mAnt).padStart(2, '0') + '-' + String(ultimoAnt).padStart(2, '0');
        const hastaAntIncl = hastaAnt + ' 23:59:59';

        const [comparacion] = await this.ds.query(`
            SELECT
              (SELECT ROUND(COALESCE(SUM(monto),0),2) FROM recibos_ingreso WHERE fecha BETWEEN ? AND ?) AS ingresos_ant,
              (SELECT COUNT(*) FROM facturas WHERE fecha_emision BETWEEN ? AND ? AND estado != 'anulada') AS facturas_ant,
              (SELECT ROUND(COALESCE(SUM(monto),0),2) FROM gastos WHERE fecha BETWEEN ? AND ?) AS gastos_ant,
              (SELECT COUNT(*) FROM ordenes_produccion WHERE creado_en BETWEEN ? AND ?) AS ordenes_ant
        `, [desdeAnt, hastaAnt, desdeAnt, hastaAntIncl, desdeAnt, hastaAnt, desdeAnt, hastaAntIncl]);

''' + marker

    s2 = s.replace(marker, bloque_nuevo, 1)

    if s == s2:
        print('ERR: marker no encontrado')
    else:
        # Ahora agregar al objeto de retorno los nuevos campos
        ret_marker = '            pagos_huerfanos: huerfanos,\n        };'
        ret_new = (
            '            pagos_huerfanos: huerfanos,\n'
            '            top_productos: topProductos,\n'
            '            top_servicios: topServicios,\n'
            '            top_operarios: {\n'
            '                volumen: operariosVolumen,\n'
            '                eficiencia: operariosEficiencia,\n'
            '                velocidad: operariosVelocidad,\n'
            '            },\n'
            '            comparacion_mes_anterior: {\n'
            '                ingresos: Number(comparacion?.ingresos_ant || 0),\n'
            '                facturas: Number(comparacion?.facturas_ant || 0),\n'
            '                gastos: Number(comparacion?.gastos_ant || 0),\n'
            '                ordenes: Number(comparacion?.ordenes_ant || 0),\n'
            '                mes: yAnt + \'-\' + String(mAnt).padStart(2, \'0\'),\n'
            '            },\n'
            '        };'
        )
        if ret_marker in s2:
            s2 = s2.replace(ret_marker, ret_new, 1)
            open(F, 'w').write(s2)
            print('OK: rankings y comparacion agregados')
        else:
            print('ERR: ret_marker no encontrado')
