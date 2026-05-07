/**
 * Migración: Agrega producto_id a lineas_produccion en órdenes existentes
 *
 * Problema: Las órdenes creadas antes de implementar la reserva de inventario
 * no tienen `producto_id` en cada línea de lineas_produccion.
 * Esto impide que el bloque de materiales (Block 4) funcione correctamente.
 *
 * Solución: Para cada orden, cruzamos su cotizacion_id con lineas_cotizacion
 * y actualizamos el JSON conservando todos los campos existentes (producto,
 * descripcion, tecnica, cantidad) y añadiendo producto_id donde corresponda.
 *
 * Ejecución:
 *   cd erp-etex-api
 *   npx ts-node -r tsconfig-paths/register src/migrations/migrar-producto-id-lineas.ts
 */

import 'dotenv/config';
import * as mysql from 'mysql2/promise';

async function main() {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST     ?? 'localhost',
    port:     Number(process.env.DB_PORT ?? 3306),
    user:     process.env.DB_USER     ?? 'root',
    password: process.env.DB_PASS     ?? '',
    database: process.env.DB_NAME     ?? 'erp_etex',
  });

  console.log('✅ Conectado a la base de datos');

  // 1. Traer todas las órdenes que tienen lineas_produccion
  const [ordenes] = await conn.execute<mysql.RowDataPacket[]>(
    `SELECT id, cotizacion_id, lineas_produccion
     FROM ordenes_produccion
     WHERE lineas_produccion IS NOT NULL
     ORDER BY id ASC`,
  );

  console.log(`📦 ${ordenes.length} órdenes encontradas`);

  let actualizadas = 0;
  let sinCambios   = 0;
  let errores      = 0;

  for (const orden of ordenes) {
    try {
      const lineasProd: any[] = typeof orden.lineas_produccion === 'string'
        ? JSON.parse(orden.lineas_produccion)
        : orden.lineas_produccion;

      if (!lineasProd || lineasProd.length === 0) { sinCambios++; continue; }

      // Verificar si ya tienen todos producto_id
      const todasTienenId = lineasProd.every(l => l.producto_id != null);
      if (todasTienenId) { sinCambios++; continue; }

      // Traer lineas_cotizacion en el mismo orden que se usó al crear la orden
      const [lineasCot] = await conn.execute<mysql.RowDataPacket[]>(
        `SELECT lc.id, lc.producto_id, lc.descripcion, lc.cantidad,
                p.nombre AS prod_nombre, p.maneja_inventario,
                vp.atributos AS var_atributos
         FROM lineas_cotizacion lc
         LEFT JOIN productos p ON p.id = lc.producto_id
         LEFT JOIN variantes_producto vp ON vp.id = lc.variante_id
         WHERE lc.cotizacion_id = ?
         ORDER BY lc.orden ASC`,
        [orden.cotizacion_id],
      );

      if (lineasCot.length === 0) { sinCambios++; continue; }

      // Función auxiliar para construir descripción de variante
      const variantDesc = (raw: any): string => {
        if (!raw) return '';
        try {
          const attrs: Record<string, string> = typeof raw === 'string' ? JSON.parse(raw) : raw;
          const color = attrs['COLOR'] ?? attrs['COLORES'] ?? null;
          const talla = attrs['TALLA'] ?? attrs['TALLAS'] ?? null;
          if (color && talla) return `${color} / ${talla}`;
          if (color) return color;
          if (talla) return talla;
          return Object.values(attrs).filter(Boolean).join(' / ');
        } catch { return ''; }
      };

      // Reconstruir lineas_produccion con producto_id añadido
      // Usamos el índice para cruzar (mismo orden que el create original)
      const nuevasLineas = lineasProd.map((linea: any, idx: number) => {
        const cotLinea = lineasCot[idx];
        if (!cotLinea) return linea; // Sin pareja → dejar igual

        // Si ya tiene producto_id, no pisar
        if (linea.producto_id != null) return linea;

        const productoId = cotLinea.producto_id ?? undefined;

        // Reconstruir con mismo estilo que el create() actual
        const vDesc = variantDesc(cotLinea.var_atributos);
        return {
          producto:    cotLinea.prod_nombre || linea.producto || cotLinea.descripcion || '',
          producto_id: productoId,
          descripcion: cotLinea.prod_nombre ? (vDesc || linea.descripcion || '') : (linea.descripcion || ''),
          tecnica:     linea.tecnica ?? '',
          cantidad:    Number(linea.cantidad ?? 1),
        };
      });

      // Actualizar en DB
      await conn.execute(
        `UPDATE ordenes_produccion SET lineas_produccion = ? WHERE id = ?`,
        [JSON.stringify(nuevasLineas), orden.id],
      );

      actualizadas++;
      console.log(`  ✏️  Orden #${orden.id} actualizada (${nuevasLineas.length} líneas)`);

    } catch (err: any) {
      errores++;
      console.error(`  ❌ Error en orden #${orden.id}:`, err.message);
    }
  }

  await conn.end();

  console.log('\n─────────────────────────────────────────');
  console.log(`✅ Actualizadas : ${actualizadas}`);
  console.log(`⏭  Sin cambios  : ${sinCambios}`);
  console.log(`❌ Con errores  : ${errores}`);
  console.log('─────────────────────────────────────────');
}

main().catch(err => { console.error('Error fatal:', err); process.exit(1); });
