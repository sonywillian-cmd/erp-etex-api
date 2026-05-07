/**
 * Migración: Elimina el contenido auto-generado de `especificaciones` en órdenes existentes.
 *
 * Problema: Las órdenes creadas antes de este cambio tienen en `especificaciones`
 * el listado de productos auto-generado por el backend (ej: "1. Camisa\n   Técnica: Bordado\n   Cantidad: 10").
 * Ese contenido no es una especificación real — solo es el detalle del producto.
 *
 * Lógica de limpieza:
 *   - Si `especificaciones` contiene bloques numerados auto-generados (patrón: líneas con
 *     "N. NOMBRE" seguidas de "   Cantidad: X"), se intenta separar el texto MANUAL
 *     (escrito por el usuario en cotización) del texto AUTO-GENERADO.
 *   - El texto manual SIEMPRE precede al bloque numerado con una línea en blanco de separación.
 *   - Si solo hay texto auto-generado → se pone NULL.
 *   - Si hay texto manual + auto-generado → se conserva solo el texto manual.
 *   - Si no hay patrón auto-generado → no se toca el registro.
 *
 * Ejecución:
 *   cd erp-etex-api
 *   npx ts-node -r tsconfig-paths/register src/migrations/limpiar-especificaciones-autogeneradas.ts
 */

import 'dotenv/config';
import * as mysql from 'mysql2/promise';

// Detecta si un bloque de texto contiene el patrón auto-generado:
// líneas tipo "1. Producto\n   Cantidad: N"
const PATRON_NUMERAL = /^\d+\.\s+.+/m;
const PATRON_CANTIDAD = /^\s+Cantidad:\s+\d+/m;

function esAutoGenerado(texto: string): boolean {
  return PATRON_NUMERAL.test(texto) && PATRON_CANTIDAD.test(texto);
}

/**
 * Extrae el texto manual (si existe) separando el bloque auto-generado.
 * Retorna null si todo era auto-generado.
 */
function extraerManual(texto: string): string | null {
  if (!esAutoGenerado(texto)) return texto; // No tiene patrón → conservar tal cual

  // Buscar el índice donde empieza "1. " (inicio del bloque auto-generado)
  // Puede ir precedido de texto manual + línea(s) en blanco
  const matchIdx = texto.search(/(?:^|\n)1\. /);
  if (matchIdx <= 0) {
    // El texto empieza directamente con "1. " → todo es auto-generado
    return null;
  }

  // Hay texto antes del bloque numerado → es el texto manual
  const parteManual = texto.slice(0, matchIdx).replace(/\n+$/, '').trim();
  return parteManual || null;
}

async function main() {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST     ?? 'localhost',
    port:     Number(process.env.DB_PORT ?? 3306),
    user:     process.env.DB_USER     ?? 'root',
    password: process.env.DB_PASS     ?? '',
    database: process.env.DB_NAME     ?? 'erp_etex',
  });

  console.log('✅ Conectado a la base de datos');

  const [ordenes] = await conn.execute<mysql.RowDataPacket[]>(
    `SELECT id, especificaciones FROM ordenes_produccion WHERE especificaciones IS NOT NULL ORDER BY id ASC`,
  );

  console.log(`📦 ${ordenes.length} órdenes con especificaciones encontradas`);

  let nullificadas  = 0;
  let recortadas    = 0;
  let sinCambios    = 0;
  let errores       = 0;

  for (const orden of ordenes) {
    try {
      const texto: string = orden.especificaciones;

      if (!esAutoGenerado(texto)) {
        sinCambios++;
        continue; // Solo texto manual → no tocar
      }

      const manual = extraerManual(texto);

      if (manual === null) {
        // Todo era auto-generado → poner NULL
        await conn.execute(
          `UPDATE ordenes_produccion SET especificaciones = NULL WHERE id = ?`,
          [orden.id],
        );
        nullificadas++;
        console.log(`  🗑️  Orden #${orden.id} → NULL (solo tenía texto auto-generado)`);
      } else {
        // Había texto manual antes del bloque → conservar solo ese
        await conn.execute(
          `UPDATE ordenes_produccion SET especificaciones = ? WHERE id = ?`,
          [manual, orden.id],
        );
        recortadas++;
        console.log(`  ✂️  Orden #${orden.id} → recortada, manual: "${manual.slice(0, 60)}${manual.length > 60 ? '...' : ''}"`);
      }

    } catch (err: any) {
      errores++;
      console.error(`  ❌ Error en orden #${orden.id}:`, err.message);
    }
  }

  await conn.end();

  console.log('\n─────────────────────────────────────────');
  console.log(`🗑️  Nullificadas (solo auto)  : ${nullificadas}`);
  console.log(`✂️  Recortadas (manual+auto)  : ${recortadas}`);
  console.log(`⏭  Sin cambios (solo manual) : ${sinCambios}`);
  console.log(`❌ Con errores               : ${errores}`);
  console.log('─────────────────────────────────────────');
}

main().catch(err => { console.error('Error fatal:', err); process.exit(1); });
