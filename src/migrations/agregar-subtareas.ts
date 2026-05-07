/**
 * Migración: Agrega soporte de sub-tareas al sistema de lotes.
 *
 * Cambios:
 *   1. Agrega columna `tipo` a `lotes_produccion` (VARCHAR 20, default 'departamento')
 *   2. Agrega columna `tarea_nombre` a `lotes_produccion` (VARCHAR 100, nullable)
 *   3. Agrega columna `subtecnicas` a `tecnicas` (JSON, nullable)
 *   4. Para cada orden existente que tenga lotes de departamento con técnica que
 *      tiene sub-técnicas configuradas, genera los lotes de tarea correspondientes.
 *
 * Ejecución:
 *   cd erp-etex-api
 *   npx ts-node -r tsconfig-paths/register src/migrations/agregar-subtareas.ts
 */

import 'dotenv/config';
import * as mysql from 'mysql2/promise';

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

    // ── 1. Agregar columna `tipo` a lotes_produccion ──────────────────────────
    const [tipoRows] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lotes_produccion' AND COLUMN_NAME = 'tipo'`
    );
    if (tipoRows[0].cnt === 0) {
      await conn.execute(
        `ALTER TABLE lotes_produccion ADD COLUMN tipo VARCHAR(20) NOT NULL DEFAULT 'departamento'`
      );
      console.log('✅ Columna `tipo` agregada a lotes_produccion');
    } else {
      console.log('ℹ️  Columna `tipo` ya existe en lotes_produccion');
    }

    // ── 2. Agregar columna `tarea_nombre` a lotes_produccion ─────────────────
    const [tareaRows] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lotes_produccion' AND COLUMN_NAME = 'tarea_nombre'`
    );
    if (tareaRows[0].cnt === 0) {
      await conn.execute(
        `ALTER TABLE lotes_produccion ADD COLUMN tarea_nombre VARCHAR(100) NULL`
      );
      console.log('✅ Columna `tarea_nombre` agregada a lotes_produccion');
    } else {
      console.log('ℹ️  Columna `tarea_nombre` ya existe en lotes_produccion');
    }

    // ── 3. Agregar columna `subtecnicas` a tecnicas ───────────────────────────
    const [subRows] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tecnicas' AND COLUMN_NAME = 'subtecnicas'`
    );
    if (subRows[0].cnt === 0) {
      await conn.execute(
        `ALTER TABLE tecnicas ADD COLUMN subtecnicas JSON NULL`
      );
      console.log('✅ Columna `subtecnicas` agregada a tecnicas');
    } else {
      console.log('ℹ️  Columna `subtecnicas` ya existe en tecnicas');
    }

    // ── 4. Generar lotes de tarea para órdenes existentes ────────────────────
    // Obtener técnicas que tienen sub-técnicas configuradas
    const [tecnicas] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT id, nombre, subtecnicas FROM tecnicas WHERE subtecnicas IS NOT NULL AND subtecnicas != 'null'`
    );

    if (tecnicas.length === 0) {
      console.log('ℹ️  No hay técnicas con sub-técnicas configuradas. Configura primero las técnicas y vuelve a ejecutar si necesitas generar lotes de tarea para órdenes existentes.');
      return;
    }

    const tecnicasMap = new Map<string, Array<{ nombre: string; rol?: string }>>();
    for (const t of tecnicas) {
      const subs = typeof t.subtecnicas === 'string' ? JSON.parse(t.subtecnicas) : t.subtecnicas;
      if (Array.isArray(subs) && subs.length > 0) {
        tecnicasMap.set(t.nombre, subs);
      }
    }

    console.log(`ℹ️  Técnicas con sub-tareas: ${[...tecnicasMap.keys()].join(', ')}`);

    // Obtener todos los lotes de departamento que tengan técnica con sub-tareas
    // y que NO tengan ya lotes de tarea asociados
    const tecnicasConSubs = [...tecnicasMap.keys()];
    if (tecnicasConSubs.length === 0) {
      console.log('ℹ️  Sin técnicas con sub-tareas válidas');
      return;
    }

    const placeholders = tecnicasConSubs.map(() => '?').join(',');
    const [lotesDept] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT l.* FROM lotes_produccion l
       WHERE l.tipo = 'departamento'
         AND l.tecnica IN (${placeholders})
         AND NOT EXISTS (
           SELECT 1 FROM lotes_produccion t2 WHERE t2.lote_padre_id = l.id AND t2.tipo = 'tarea'
         )`,
      tecnicasConSubs
    );

    if (lotesDept.length === 0) {
      console.log('ℹ️  No hay lotes de departamento que necesiten lotes de tarea');
      return;
    }

    console.log(`🔧 Generando lotes de tarea para ${lotesDept.length} lote(s) de departamento...`);

    for (const lote of lotesDept) {
      const subtareas = tecnicasMap.get(lote.tecnica);
      if (!subtareas || subtareas.length === 0) continue;

      for (const sub of subtareas) {
        const numeroTarea = `${lote.numero}-T${subtareas.indexOf(sub) + 1}`;
        await conn.execute(
          `INSERT INTO lotes_produccion
             (numero, orden_id, tipo_lote, producto, descripcion, cantidad, departamento, tecnica,
              tipo_ejecucion, orden_ejecucion, lote_padre_id, estado, tipo, tarea_nombre, desbloquear_al)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'secuencial', ?, ?, ?, 'tarea', ?, 'completado')`,
          [
            numeroTarea,
            lote.orden_id,
            lote.tipo_lote,
            lote.producto,
            sub.nombre,
            lote.cantidad,
            lote.departamento,
            lote.tecnica,
            lote.orden_ejecucion,
            lote.id,
            lote.estado === 'completado' ? 'completado' : (lote.estado === 'en_proceso' ? 'desbloqueado' : 'pendiente'),
            sub.nombre,
          ]
        );
        console.log(`  ✅ Lote tarea: ${numeroTarea} → ${sub.nombre} (padre: ${lote.numero})`);
      }
    }

    console.log('\n🎉 Migración completada exitosamente');
  } finally {
    await conn.end();
  }
}

run().catch(err => {
  console.error('❌ Error en migración:', err);
  process.exit(1);
});
