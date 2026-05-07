/**
 * Migración: Crear recepciones de mercancía faltantes por bug en Diseño.
 *
 * Contexto del bug:
 *   La lógica original tenía una guarda:
 *     if (!DPTOS_SIN_RECEPCION.includes(lote.departamento)) { ... crear recepción ... }
 *   Esto causaba que cuando el departamento de DISEÑO completaba su lote,
 *   NINGUNA recepción se creaba para el departamento hijo (ej. Corte, Confección, etc.),
 *   aunque ese hijo necesitara confirmar la recepción de materiales.
 *
 * Lo que hace esta migración:
 *   1. Busca todos los lotes de tipo 'departamento' con departamento = 'Diseño'
 *      que ya estén completados.
 *   2. Para cada uno, encuentra sus lotes hijos directos (lote_padre_id) que:
 *      - No sean Diseño ellos mismos
 *      - Estén en estado desbloqueado, en_proceso o completado
 *   3. Si ese lote hijo NO tiene ninguna recepción en recepciones_departamento,
 *      crea la recepción faltante.
 *   4. Si el hijo ya está completado, la recepción se crea directamente como
 *      'confirmada' (retroactiva). Si está en proceso o desbloqueado, se crea
 *      como 'pendiente' para que el operario confirme al iniciar.
 *
 * Ejecución:
 *   cd erp-etex-api
 *   npx ts-node -r tsconfig-paths/register src/migrations/crear-recepciones-faltantes-diseno.ts
 */

import 'dotenv/config';
import * as mysql from 'mysql2/promise';

const DPTOS_SIN_RECEPCION = ['Diseño'];

async function run() {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST     ?? 'localhost',
    port:     parseInt(process.env.DB_PORT ?? '3306'),
    user:     process.env.DB_USER     ?? 'root',
    password: process.env.DB_PASS     ?? '',
    database: process.env.DB_NAME     ?? 'erp_etex',
  });

  try {
    console.log('🔌 Conectado a la base de datos');
    console.log('🔍 Buscando lotes de Diseño completados con recepciones faltantes...\n');

    // ── 1. Obtener todos los lotes Diseño completados ─────────────────────────
    const [lotesDiseno] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT
         l.id,
         l.numero,
         l.orden_id,
         l.producto,
         l.descripcion,
         l.cantidad,
         l.departamento,
         o.numero AS orden_numero
       FROM lotes_produccion l
       INNER JOIN ordenes_produccion o ON o.id = l.orden_id
       WHERE l.departamento IN (${DPTOS_SIN_RECEPCION.map(() => '?').join(',')})
         AND l.tipo = 'departamento'
         AND l.estado = 'completado'`,
      DPTOS_SIN_RECEPCION
    );

    if (lotesDiseno.length === 0) {
      console.log('ℹ️  No hay lotes de Diseño completados. Nada que migrar.');
      return;
    }

    console.log(`📋 Lotes de Diseño completados encontrados: ${lotesDiseno.length}`);

    let creados     = 0;
    let yaExistian  = 0;
    let omitidos    = 0;

    for (const loteOrigen of lotesDiseno) {
      // ── 2. Buscar lotes hijos desbloqueados o más avanzados ────────────────
      const [hijosRows] = await conn.execute<mysql.RowDataPacket[]>(
        `SELECT
           l.id,
           l.numero,
           l.orden_id,
           l.producto,
           l.descripcion,
           l.cantidad,
           l.departamento,
           l.estado
         FROM lotes_produccion l
         WHERE l.lote_padre_id = ?
           AND l.tipo = 'departamento'
           AND l.estado IN ('desbloqueado', 'en_proceso', 'completado')`,
        [loteOrigen.id]
      );

      for (const hijo of hijosRows) {
        // Saltar si el destino tampoco recibe mercancía física
        if (DPTOS_SIN_RECEPCION.includes(hijo.departamento)) {
          omitidos++;
          continue;
        }

        // ── 3. Verificar si ya existe una recepción para este lote hijo ───────
        const [existentes] = await conn.execute<mysql.RowDataPacket[]>(
          `SELECT COUNT(*) AS cnt FROM recepciones_departamento WHERE lote_id = ?`,
          [hijo.id]
        );

        if ((existentes[0] as mysql.RowDataPacket).cnt > 0) {
          console.log(`  ⏭  ${loteOrigen.orden_numero} | ${loteOrigen.departamento} → ${hijo.departamento} | ya tiene recepción`);
          yaExistian++;
          continue;
        }

        // ── 4. Crear la recepción faltante ────────────────────────────────────
        const estaCompletado = hijo.estado === 'completado';
        const estadoRecepcion = estaCompletado ? 'confirmada' : 'pendiente';

        const items = JSON.stringify([{
          lote_id:           loteOrigen.id,
          producto:          loteOrigen.producto,
          descripcion:       loteOrigen.descripcion ?? '',
          cantidad_enviada:  Number(loteOrigen.cantidad),
          cantidad_recibida: estaCompletado ? Number(loteOrigen.cantidad) : null,
        }]);

        await conn.execute(
          `INSERT INTO recepciones_departamento
             (lote_id, orden_id, orden_numero, dpto_origen, dpto_destino, items, estado, creado_en)
           VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            hijo.id,
            loteOrigen.orden_id,
            loteOrigen.orden_numero,
            loteOrigen.departamento,
            hijo.departamento,
            items,
            estadoRecepcion,
          ]
        );

        const icono = estaCompletado ? '✅ [retroactiva]' : '🆕 [pendiente]';
        console.log(`  ${icono} ${loteOrigen.orden_numero} | ${loteOrigen.departamento} → ${hijo.departamento} | lote hijo: ${hijo.numero}`);
        creados++;
      }
    }

    // ── Resumen ───────────────────────────────────────────────────────────────
    console.log('\n─────────────────────────────────────────');
    console.log(`📊 Resumen:`);
    console.log(`   ✅ Recepciones creadas  : ${creados}`);
    console.log(`   ⏭  Ya existían          : ${yaExistian}`);
    console.log(`   ➖ Omitidas (sin física): ${omitidos}`);
    console.log('─────────────────────────────────────────');

    if (creados === 0 && yaExistian === 0) {
      console.log('\n✔  No había datos que corregir.');
    } else {
      console.log('\n🎉 Migración completada exitosamente.');
    }

  } finally {
    await conn.end();
  }
}

run().catch(err => {
  console.error('❌ Error en migración:', err);
  process.exit(1);
});
