/**
 * Limpieza de datos transaccionales.
 *
 * ELIMINA todos los registros de:
 *   - Producción  : ordenes_produccion, lotes_produccion, pausas_produccion,
 *                   recepciones_departamento, tareas_produccion, procesos_lote,
 *                   reservas_inventario
 *   - Ventas      : cotizaciones, lineas_cotizacion, pagos
 *   - Inventario  : movimientos_inventario, danos_produccion
 *                   + resetea stock en productos a 0
 *   - Compras     : ordenes_compra
 *   - Notas       : notas_recordatorio
 *
 * CONSERVA (no toca):
 *   usuarios, clientes, productos, variantes_producto, bom_items,
 *   departamentos, maquinas, tecnicas, plantillas_ruta, marcas,
 *   categorias_producto, configuracion_sistema, flujos_produccion,
 *   proveedores, proveedor_productos
 *
 * Ejecución:
 *   cd erp-etex-api
 *   npx ts-node -r tsconfig-paths/register src/migrations/limpiar-base-datos-transaccional.ts
 */

import 'dotenv/config';
import * as mysql from 'mysql2/promise';
import * as readline from 'readline';

// Tablas a vaciar, en orden que respeta dependencias (hijos primero)
const TABLAS_LIMPIAR = [
  // Producción — hijos primero
  'recepciones_departamento',
  'pausas_produccion',
  'procesos_lote',
  'tareas_produccion',
  'reservas_inventario',
  'lotes_produccion',
  'ordenes_produccion',
  // Ventas
  'lineas_cotizacion',
  'pagos',
  'cotizaciones',
  // Inventario
  'movimientos_inventario',
  'danos_produccion',
  // Compras
  'ordenes_compra',
  // Notas
  'notas_recordatorio',
];

async function confirmar(pregunta: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(pregunta, ans => {
      rl.close();
      resolve(ans.trim().toLowerCase() === 'si' || ans.trim().toLowerCase() === 's');
    });
  });
}

async function run() {
  console.log('\n⚠️  LIMPIEZA DE BASE DE DATOS TRANSACCIONAL');
  console.log('══════════════════════════════════════════════');
  console.log('Tablas que serán vaciadas:');
  TABLAS_LIMPIAR.forEach(t => console.log(`   • ${t}`));
  console.log('\nTablas que NO se tocarán:');
  console.log('   usuarios, clientes, productos, variantes_producto,');
  console.log('   bom_items, departamentos, maquinas, tecnicas,');
  console.log('   plantillas_ruta, marcas, categorias_producto,');
  console.log('   configuracion_sistema, flujos_produccion,');
  console.log('   proveedores, proveedor_productos');
  console.log('══════════════════════════════════════════════\n');

  const ok = await confirmar('¿Confirmas la limpieza? Escribe "si" para continuar: ');
  if (!ok) { console.log('❌ Operación cancelada.'); process.exit(0); }

  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST     ?? 'localhost',
    port:     parseInt(process.env.DB_PORT ?? '3306'),
    user:     process.env.DB_USER     ?? 'root',
    password: process.env.DB_PASS     ?? '',
    database: process.env.DB_NAME     ?? 'erp_etex',
  });

  try {
    console.log('\n🔌 Conectado a la base de datos');

    // Desactivar foreign keys para poder truncar sin orden
    await conn.execute('SET FOREIGN_KEY_CHECKS = 0');

    let totalFilas = 0;

    for (const tabla of TABLAS_LIMPIAR) {
      // Verificar que la tabla existe antes de truncar
      const [existe] = await conn.execute<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [tabla]
      );
      if ((existe[0] as mysql.RowDataPacket).cnt === 0) {
        console.log(`  ⏭  ${tabla} — tabla no encontrada, omitida`);
        continue;
      }

      // Contar filas antes de limpiar
      const [count] = await conn.execute<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS n FROM \`${tabla}\``);
      const filas = (count[0] as mysql.RowDataPacket).n as number;

      await conn.execute(`TRUNCATE TABLE \`${tabla}\``);
      totalFilas += filas;
      console.log(`  ✅ ${tabla.padEnd(32)} ${filas > 0 ? `${filas} fila(s) eliminadas` : '(vacía)'}`);
    }

    // ── Resetear stock en productos a 0 ──────────────────────────────────────
    const [colStock] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'stock_actual'`
    );
    if ((colStock[0] as mysql.RowDataPacket).cnt > 0) {
      const [upd] = await conn.execute<mysql.OkPacket>(`UPDATE productos SET stock_actual = 0`);
      console.log(`  ✅ productos.stock_actual      → reseteado a 0 (${(upd as any).affectedRows} productos)`);
    }

    // Columna alternativa "stock"
    const [colStock2] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'stock'`
    );
    if ((colStock2[0] as mysql.RowDataPacket).cnt > 0) {
      const [upd] = await conn.execute<mysql.OkPacket>(`UPDATE productos SET stock = 0`);
      console.log(`  ✅ productos.stock             → reseteado a 0 (${(upd as any).affectedRows} productos)`);
    }

    // ── Resetear AUTO_INCREMENT en tablas clave ──────────────────────────────
    const tablasClave = ['ordenes_produccion', 'cotizaciones', 'ordenes_compra', 'lotes_produccion'];
    for (const tabla of tablasClave) {
      const [existe] = await conn.execute<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [tabla]
      );
      if ((existe[0] as mysql.RowDataPacket).cnt > 0) {
        await conn.execute(`ALTER TABLE \`${tabla}\` AUTO_INCREMENT = 1`);
        console.log(`  🔄 ${tabla.padEnd(32)} AUTO_INCREMENT reseteado a 1`);
      }
    }

    // Reactivar foreign keys
    await conn.execute('SET FOREIGN_KEY_CHECKS = 1');

    console.log('\n──────────────────────────────────────────────');
    console.log(`📊 Total de filas eliminadas : ${totalFilas.toLocaleString()}`);
    console.log('──────────────────────────────────────────────');
    console.log('🎉 Limpieza completada. La base de datos está lista para uso.\n');

  } catch (err) {
    // Asegurarse de reactivar FK aunque haya error
    try { await conn.execute('SET FOREIGN_KEY_CHECKS = 1'); } catch {}
    throw err;
  } finally {
    await conn.end();
  }
}

run().catch(err => {
  console.error('\n❌ Error durante la limpieza:', err);
  process.exit(1);
});
