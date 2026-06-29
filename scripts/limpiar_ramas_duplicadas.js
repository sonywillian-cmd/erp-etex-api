#!/usr/bin/env node
/**
 * Limpia ramas duplicadas de lotes_produccion en órdenes activas.
 *
 * Causa raíz: aplicarPlantillaRuta solo borraba pendientes — los completados
 * quedaban huérfanos y la nueva cadena se creaba paralela. Resultado: hasta 4
 * ramas paralelas de los mismos departamentos en una sola orden.
 *
 * Algoritmo (por orden afectada):
 *   1. Por cada departamento, identificar el "lote canónico":
 *      - Prioridad: completado > en_proceso > desbloqueado > pendiente
 *      - En empate: el más viejo (id ASC)
 *   2. Reasignar lote_padre_id de hijos legítimos → al canónico de su depto padre
 *   3. Eliminar los duplicados (mismo departamento, distinto id)
 *   4. Recalcular cadena: si padre canónico está completado, hijos quedan
 *      desbloqueados
 *
 * Antes de tocar: backup completo de la tabla afectada.
 * Modo de uso:  node limpiar_ramas_duplicadas.js [--dry-run]
 */
const path = require('path');
const mysql = require('mysql2/promise');
const fs    = require('fs');

const DRY_RUN = process.argv.includes('--dry-run');

// Carga .env del API
const envPath = '/home/u372536694/apps/api/.env';
const env = {};
for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.+)$/);
  if (m) env[m[1]] = m[2];
}

const PRIORIDAD_ESTADO = {
  completado:   1,
  en_proceso:   2,
  desbloqueado: 3,
  pendiente:    4,
  cancelado:    5,
};

(async () => {
  const conn = await mysql.createConnection({
    host:     env.DB_HOST,
    port:     Number(env.DB_PORT),
    user:     env.DB_USER,
    password: env.DB_PASS,
    database: env.DB_NAME,
    multipleStatements: true,
  });

  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN (sin cambios)' : 'EJECUTAR'}`);

  // Backup defensivo (solo si no dry-run)
  if (!DRY_RUN) {
    const ts = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS _bkp_lotes_dedup_${ts}
        AS SELECT * FROM lotes_produccion
      WHERE orden_id IN (
        SELECT orden_id FROM (
          SELECT orden_id, COUNT(*) AS ramas
          FROM lotes_produccion
          WHERE tipo = 'departamento' AND lote_padre_id IS NULL
          GROUP BY orden_id
          HAVING ramas > 1
        ) t
      )`);
    console.log(`Backup creado: _bkp_lotes_dedup_${ts}`);
  }

  // 1. Identificar órdenes afectadas
  const [ordenes] = await conn.query(`
    SELECT lp.orden_id, op.numero, c.nombre AS cliente, COUNT(*) AS ramas_raiz
      FROM lotes_produccion lp
      JOIN ordenes_produccion op ON op.id = lp.orden_id
      JOIN clientes c ON c.id = op.cliente_id
     WHERE lp.tipo = 'departamento' AND lp.lote_padre_id IS NULL
       AND op.estado NOT IN ('entregado', 'cancelado')
     GROUP BY lp.orden_id
    HAVING ramas_raiz > 1
     ORDER BY lp.orden_id DESC`);

  console.log(`\n${ordenes.length} órdenes afectadas\n`);

  let totalEliminados   = 0;
  let totalReasignados  = 0;
  let totalDesbloqueados = 0;

  for (const o of ordenes) {
    console.log(`\n────── ${o.numero} · ${o.cliente} ──────`);

    // 2. Cargar todos los lotes de la orden
    const [lotes] = await conn.query(
      `SELECT id, lote_padre_id, departamento, tipo, cantidad, estado, responsable, piezas_ok
         FROM lotes_produccion WHERE orden_id = ? ORDER BY id`,
      [o.orden_id]
    );

    // 3. Agrupar por departamento y elegir canónico
    const porDepto = {};
    for (const l of lotes) {
      if (l.tipo !== 'departamento') continue;  // saltar sub-tareas
      const k = l.departamento;
      if (!porDepto[k]) porDepto[k] = [];
      porDepto[k].push(l);
    }

    const canonicoDe = {};   // departamento → lote canónico
    const aEliminar  = new Set();
    for (const [depto, grupo] of Object.entries(porDepto)) {
      if (grupo.length === 1) {
        canonicoDe[depto] = grupo[0];
        continue;
      }
      // Ordenar por prioridad estado, luego id ASC
      grupo.sort((a, b) => {
        const pa = PRIORIDAD_ESTADO[a.estado] ?? 99;
        const pb = PRIORIDAD_ESTADO[b.estado] ?? 99;
        if (pa !== pb) return pa - pb;
        return a.id - b.id;
      });
      const canon = grupo[0];
      canonicoDe[depto] = canon;
      for (let i = 1; i < grupo.length; i++) {
        aEliminar.add(grupo[i].id);
      }
      console.log(`  ${depto}: canónico=${canon.id} (${canon.estado}${canon.responsable ? ' por '+canon.responsable : ''}), duplicados=[${grupo.slice(1).map(l => l.id).join(', ')}]`);
    }

    // 4. Reasignar hijos: si el padre actual está en aEliminar, redirigir
    //    al canónico del depto de ese padre eliminado.
    const reasignaciones = [];   // {hijo_id, nuevo_padre_id}
    for (const lote of lotes) {
      if (aEliminar.has(lote.id)) continue;       // los duplicados se borran, no se reasignan
      if (!lote.lote_padre_id) continue;
      if (!aEliminar.has(lote.lote_padre_id)) continue;  // padre legítimo, no tocar

      const padreEliminado = lotes.find(l => l.id === lote.lote_padre_id);
      if (!padreEliminado) continue;
      const canon = canonicoDe[padreEliminado.departamento];
      if (!canon || canon.id === lote.lote_padre_id) continue;

      reasignaciones.push({ hijo: lote.id, nuevo_padre: canon.id, depto: padreEliminado.departamento });
    }

    for (const r of reasignaciones) {
      console.log(`  reasignar lote ${r.hijo} → padre ${r.nuevo_padre} (${r.depto})`);
    }
    console.log(`  → ${aEliminar.size} duplicados a eliminar, ${reasignaciones.length} reasignaciones`);

    if (DRY_RUN) continue;

    // 5. EJECUTAR cambios en orden seguro
    for (const r of reasignaciones) {
      await conn.query(
        `UPDATE lotes_produccion SET lote_padre_id = ? WHERE id = ?`,
        [r.nuevo_padre, r.hijo]
      );
      totalReasignados++;
    }
    if (aEliminar.size > 0) {
      await conn.query(
        `DELETE FROM lotes_produccion WHERE id IN (?)`,
        [Array.from(aEliminar)]
      );
      totalEliminados += aEliminar.size;
    }

    // 6. Para cada canónico pendiente cuyo padre canónico está completado →
    //    desbloquearlo
    for (const depto of Object.keys(canonicoDe)) {
      const canon = canonicoDe[depto];
      if (canon.estado !== 'pendiente') continue;
      if (!canon.lote_padre_id) continue;
      // Buscar nuevo padre (puede haber sido reasignado arriba)
      const reass = reasignaciones.find(r => r.hijo === canon.id);
      const padreActualId = reass ? reass.nuevo_padre : canon.lote_padre_id;
      const padreCanon = Object.values(canonicoDe).find(l => l.id === padreActualId);
      if (padreCanon && padreCanon.estado === 'completado') {
        await conn.query(
          `UPDATE lotes_produccion SET estado = 'desbloqueado' WHERE id = ? AND estado = 'pendiente'`,
          [canon.id]
        );
        console.log(`  desbloquear lote ${canon.id} (${depto}) porque padre ${padreActualId} completado`);
        totalDesbloqueados++;
      }
    }
  }

  console.log(`\n══════════════ TOTAL ══════════════`);
  console.log(`Órdenes procesadas: ${ordenes.length}`);
  console.log(`Reasignaciones:     ${totalReasignados}`);
  console.log(`Lotes eliminados:   ${totalEliminados}`);
  console.log(`Lotes desbloqueados: ${totalDesbloqueados}`);
  if (DRY_RUN) console.log(`(DRY-RUN: no se aplicó ningún cambio)`);

  await conn.end();
})();
