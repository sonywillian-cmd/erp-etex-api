// Migración: fusiona los lotes POR-PRODUCTO de cada técnica en UN solo lote por
// técnica (modelo confirmado jun-2026: una técnica = una unidad, se divide por
// línea de producto en el modal Dividir). Solo toca grupos:
//   - con más de un lote en la misma (departamento, tipo, tarea_nombre)
//   - TODOS sin empezar (pendiente/desbloqueado)
//   - SIN lineas_asignadas y con número plano (-L<n>, no -L<n>-A): así NO deshace
//     divisiones por línea/cantidad ya hechas por el usuario.
// Re-apunta los lote_padre_id de los lotes borrados a su lote conservado.
//
// Uso:  DRY=1 node merge_lotes_por_tecnica.js   (preview)
//       DRY=0 node merge_lotes_por_tecnica.js   (aplica)

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const DRY = process.env.DRY !== '0';

function loadEnv(file) {
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v;
  }
  return env;
}
const ENV = loadEnv(path.join(__dirname, '..', '.env.production'));

const norm = (s) => (s ?? '').toString().toUpperCase().trim();
const UNSTARTED = new Set(['pendiente', 'desbloqueado']);
const NUM_PLANO = /-L\d+$/; // número de lote "crudo" (no sub-lote de división -A/-B)

function labelProductos(prods) {
  const u = [...new Set(prods.filter(Boolean))];
  if (!u.length) return 'VARIOS';
  if (u.length === 1) return u[0];
  const j = u.join(', ');
  return j.length <= 240 ? j : `${u.length} productos`;
}

(async () => {
  const conn = await mysql.createConnection({
    socketPath: ENV.DB_SOCKET || '/var/lib/mysql/mysql.sock',
    user: ENV.DB_USER, password: ENV.DB_PASS, database: ENV.DB_NAME,
  });

  const [lotes] = await conn.query('SELECT * FROM lotes_produccion ORDER BY orden_id, id');
  const [ordenes] = await conn.query('SELECT id, numero, estado FROM ordenes_produccion');
  const numById = new Map(ordenes.map(o => [o.id, o.numero]));
  const estadoById = new Map(ordenes.map(o => [o.id, o.estado]));

  const byOrden = new Map();
  for (const l of lotes) {
    if (!byOrden.has(l.orden_id)) byOrden.set(l.orden_id, []);
    byOrden.get(l.orden_id).push(l);
  }

  const plan = [];      // { ordenId, groups: [{keepId, cantidad, producto, aplic, responsable, deleteIds, depto, tipo}] }
  const reparent = [];  // { loteId, newPadre }
  const resumen = [];
  let mergedGroups = 0, deletedTotal = 0;
  const ordersTouched = new Set();

  for (const [ordenId, ls] of byOrden) {
    const groups = new Map();
    for (const l of ls) {
      const key = `${norm(l.departamento)}|${l.tipo}|${l.tarea_nombre ?? ''}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(l);
    }
    const idMap = new Map(); // deletedId -> keptId
    const orderPlan = [];
    for (const [, g] of groups) {
      if (g.length < 2) continue;
      if (!g.every(l => UNSTARTED.has(l.estado))) continue;          // algún lote con trabajo
      if (g.some(l => l.lineas_asignadas != null)) continue;          // división por línea ya hecha
      if (g.some(l => !NUM_PLANO.test(String(l.numero)))) continue;   // sub-lote de división (-A/-B)
      g.sort((a, b) => a.id - b.id);
      const keep = g[0];
      const others = g.slice(1);
      const cantidad = g.reduce((s, l) => s + Number(l.cantidad || 0), 0);
      const aplic = Math.max(...g.map(l => Number(l.aplicaciones_por_pieza || 1)));
      const resps = [...new Set(g.map(l => l.responsable).filter(Boolean))];
      const responsable = resps.length === 1 ? resps[0] : null;
      orderPlan.push({
        keepId: keep.id, cantidad, producto: labelProductos(g.map(l => l.producto)),
        aplic, responsable, deleteIds: others.map(o => o.id),
        depto: keep.departamento, tipo: keep.tipo,
      });
      for (const o of others) idMap.set(o.id, keep.id);
      mergedGroups++; deletedTotal += others.length; ordersTouched.add(ordenId);
    }
    if (!orderPlan.length) continue;
    for (const l of ls) {
      if (l.lote_padre_id != null && idMap.has(l.lote_padre_id)) {
        reparent.push({ loteId: l.id, newPadre: idMap.get(l.lote_padre_id) });
      }
    }
    plan.push({ ordenId, groups: orderPlan });
    for (const g of orderPlan) {
      if (g.tipo === 'departamento') {
        resumen.push(`${numById.get(ordenId)} [${estadoById.get(ordenId)}] ${g.depto}: fusiona ${g.deleteIds.length + 1} → 1 (cant ${g.cantidad}, ${g.producto.slice(0, 34)}${g.responsable ? ', resp ' + g.responsable : ''})`);
      }
    }
  }

  console.log(`\n=== MERGE LOTES POR TÉCNICA (${DRY ? 'DRY-RUN' : 'EJECUCIÓN'}) ===`);
  console.log(`Órdenes a tocar: ${ordersTouched.size} · grupos a fusionar: ${mergedGroups} · lotes a borrar: ${deletedTotal} · reparent: ${reparent.length}\n`);
  for (const r of resumen) console.log('  ' + r);

  if (DRY) { console.log('\n*** DRY-RUN — no se tocó nada. DRY=0 para aplicar. ***'); await conn.end(); return; }

  const deleteSet = new Set();
  for (const p of plan) for (const g of p.groups) for (const d of g.deleteIds) deleteSet.add(d);

  await conn.beginTransaction();
  try {
    for (const r of reparent) {
      if (deleteSet.has(r.loteId)) continue;
      await conn.query('UPDATE lotes_produccion SET lote_padre_id=? WHERE id=?', [r.newPadre, r.loteId]);
    }
    for (const p of plan) for (const g of p.groups) {
      await conn.query(
        'UPDATE lotes_produccion SET cantidad=?, producto=?, aplicaciones_por_pieza=?, responsable=?, lineas_asignadas=NULL WHERE id=?',
        [g.cantidad, g.producto, g.aplic, g.responsable, g.keepId],
      );
      if (g.deleteIds.length) {
        await conn.query(`DELETE FROM lotes_produccion WHERE id IN (${g.deleteIds.map(() => '?').join(',')})`, g.deleteIds);
      }
    }
    await conn.commit();
    console.log(`\n✓ Fusionados ${mergedGroups} grupos, borrados ${deletedTotal} lotes en ${ordersTouched.size} órdenes.`);
  } catch (e) {
    await conn.rollback();
    console.error('ERROR — rollback:', e.message);
    process.exitCode = 1;
  }
  await conn.end();
})();
