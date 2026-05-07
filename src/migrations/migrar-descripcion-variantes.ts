/**
 * Migración: Normaliza la descripción de variantes en cotizaciones y órdenes
 *
 * Problema: Anteriormente la descripción de una línea con variante se guardaba
 * como  "COLOR / TALLA"  (ej. "AZUL MARINO / L").
 * La nueva lógica la guarda como  "COLOR TALLA"  (ej. "AZUL MARINO L").
 *
 * Esta migración actualiza:
 *   1. lineas_cotizacion   — campo `descripcion`  (solo líneas con variante_id)
 *   2. ordenes_produccion  — campo `lineas_produccion` (JSON)
 *
 * Ejecución:
 *   cd erp-etex-api
 *   npx ts-node -r tsconfig-paths/register src/migrations/migrar-descripcion-variantes.ts
 */

import 'dotenv/config';
import * as mysql from 'mysql2/promise';

/** Reemplaza " / " por " " en una cadena */
function normalizarDesc(desc: string | null | undefined): string {
  if (!desc) return desc ?? '';
  return desc.replace(/ \/ /g, ' ');
}

async function main() {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST ?? 'localhost',
    port:     Number(process.env.DB_PORT ?? 3306),
    user:     process.env.DB_USER ?? 'root',
    password: process.env.DB_PASS ?? '',
    database: process.env.DB_NAME ?? 'erp_etex',
  });

  console.log('✅ Conectado a la base de datos\n');

  // ─────────────────────────────────────────────────────────────────────────
  // 1. lineas_cotizacion — solo filas que tengan variante_id (origen seguro)
  // ─────────────────────────────────────────────────────────────────────────
  const [lineas] = await conn.execute<mysql.RowDataPacket[]>(
    `SELECT id, descripcion
     FROM lineas_cotizacion
     WHERE variante_id IS NOT NULL
       AND descripcion LIKE '% / %'`,
  );

  console.log(`📋 lineas_cotizacion con " / ": ${lineas.length}`);

  let cotActualizadas = 0;
  for (const row of lineas) {
    const nueva = normalizarDesc(row.descripcion);
    if (nueva === row.descripcion) continue;
    await conn.execute(
      `UPDATE lineas_cotizacion SET descripcion = ? WHERE id = ?`,
      [nueva, row.id],
    );
    console.log(`  ✏️  linea #${row.id}: "${row.descripcion}"  →  "${nueva}"`);
    cotActualizadas++;
  }
  console.log(`   ✅ ${cotActualizadas} líneas actualizadas\n`);

  // ─────────────────────────────────────────────────────────────────────────
  // 2. ordenes_produccion — JSON lineas_produccion
  // ─────────────────────────────────────────────────────────────────────────
  const [ordenes] = await conn.execute<mysql.RowDataPacket[]>(
    `SELECT id, lineas_produccion
     FROM ordenes_produccion
     WHERE lineas_produccion IS NOT NULL
       AND lineas_produccion LIKE '% / %'`,
  );

  console.log(`🏭 ordenes_produccion con " / ": ${ordenes.length}`);

  let ordActualizadas = 0;
  let ordErrores      = 0;

  for (const orden of ordenes) {
    try {
      const lineas: any[] = typeof orden.lineas_produccion === 'string'
        ? JSON.parse(orden.lineas_produccion)
        : orden.lineas_produccion;

      if (!Array.isArray(lineas)) continue;

      let cambio = false;
      const nuevasLineas = lineas.map((l: any) => {
        const descOriginal = l.descripcion ?? '';
        const descNueva    = normalizarDesc(descOriginal);
        if (descNueva !== descOriginal) { cambio = true; }
        return { ...l, descripcion: descNueva };
      });

      if (!cambio) continue;

      await conn.execute(
        `UPDATE ordenes_produccion SET lineas_produccion = ? WHERE id = ?`,
        [JSON.stringify(nuevasLineas), orden.id],
      );
      console.log(`  ✏️  Orden #${orden.id} actualizada`);
      ordActualizadas++;
    } catch (err: any) {
      ordErrores++;
      console.error(`  ❌ Error en orden #${orden.id}:`, err.message);
    }
  }
  console.log(`   ✅ ${ordActualizadas} órdenes actualizadas`);
  if (ordErrores > 0) console.log(`   ❌ ${ordErrores} con errores`);

  await conn.end();

  console.log('\n─────────────────────────────────────────');
  console.log(`lineas_cotizacion actualizadas : ${cotActualizadas}`);
  console.log(`ordenes_produccion actualizadas: ${ordActualizadas}`);
  console.log('─────────────────────────────────────────');
}

main().catch(err => { console.error('Error fatal:', err); process.exit(1); });
