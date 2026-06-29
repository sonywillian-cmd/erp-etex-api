// Retroactivo: crea lotes faltantes en órdenes multi-producto donde la ruta
// se configuró solo para el primer producto (bug aplicarPlantillaRuta, jun 2026).
//
// Estrategia: por cada orden que YA tiene lotes (ruta configurada) pero a la que
// le faltan productos, se clona la cadena del producto plantilla (el que sí tiene
// lotes), EXCLUYENDO diseño (el arte se hace 1 sola vez por orden). Cada clon
// espeja el estado/responsable/tiempos del lote plantilla de su mismo
// departamento: si la entrega ya está completada, el clon queda completado con el
// mismo responsable (decisión del dueño); si está activa, queda en su estado
// natural trabajable.
//
// Uso:  DRY=1 node retro_lotes_multiproducto.js   (preview, no inserta)
//       DRY=0 node retro_lotes_multiproducto.js   (aplica)

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const DRY = process.env.DRY !== '0';

// Lee .env.production crudo (evita mangling de caracteres especiales por bash source)
function loadEnv(file) {
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[m[1]] = v;
  }
  return env;
}
const ENV = loadEnv(path.join(__dirname, '..', '.env.production'));

const norm = (s) => (s ?? '').toString().toUpperCase().trim();
const esDiseno = (d) => {
  const x = norm(d);
  return x.startsWith('DISEÑO') || x.startsWith('DISENO')
      || x.startsWith('REDISEÑO') || x.startsWith('REDISENO');
};
const esTerminacion = (d) => norm(d).startsWith('TERMINAC');
// Pasos a nivel ORDEN (se hacen una sola vez, ya cuentan el total): no se clonan
// por producto faltante para no duplicar conteos (diseño + terminación).
const esNivelOrden = (d) => esDiseno(d) || esTerminacion(d);

(async () => {
  const conn = await mysql.createConnection({
    socketPath: ENV.DB_SOCKET || '/var/lib/mysql/mysql.sock',
    user: ENV.DB_USER,
    password: ENV.DB_PASS,
    database: ENV.DB_NAME,
  });

  const [ordenes] = await conn.query(
    'SELECT id, numero, estado, lineas_produccion FROM ordenes_produccion',
  );
  const [lotesAll] = await conn.query(
    'SELECT * FROM lotes_produccion ORDER BY id ASC',
  );
  const lotesByOrden = new Map();
  for (const l of lotesAll) {
    if (!lotesByOrden.has(l.orden_id)) lotesByOrden.set(l.orden_id, []);
    lotesByOrden.get(l.orden_id).push(l);
  }

  const plan = [];   // { orden, clones: [...] }
  const resumen = [];

  for (const o of ordenes) {
    let lineas = [];
    try {
      lineas = typeof o.lineas_produccion === 'string'
        ? JSON.parse(o.lineas_produccion)
        : (o.lineas_produccion || []);
    } catch { lineas = []; }
    if (!Array.isArray(lineas) || !lineas.length) continue;

    const lotes = lotesByOrden.get(o.id) || [];
    if (!lotes.length) continue; // ruta nunca configurada → no es este bug

    // Productos físicos con técnica (excluye SERVICIO ADICIONAL y SERVICIO DE …)
    const prodCant = new Map();
    for (const ln of lineas) {
      const p = (ln.producto || '').trim();
      const tec = (ln.tecnica || '').trim();
      if (!p || !tec) continue;
      const pu = p.toUpperCase();
      if (pu === 'SERVICIO ADICIONAL') continue;
      if (pu.startsWith('SERVICIO DE ')) continue;
      prodCant.set(p, (prodCant.get(p) || 0) + Number(ln.cantidad || 0));
    }
    if (!prodCant.size) continue;

    const prodsConLote = new Set(lotes.map((l) => norm(l.producto)));

    // Producto plantilla = el que ya tiene lotes (primero encontrado)
    const tplProducto = lotes.find((l) => l.producto)?.producto || null;
    if (!tplProducto) continue;
    const tpl = lotes
      .filter((l) => norm(l.producto) === norm(tplProducto))
      .filter((l) => !esNivelOrden(l.departamento) && !esDiseno(l.tarea_nombre));
    if (!tpl.length) continue;

    let maxSeq = 0;
    for (const l of lotes) {
      const m = parseInt(String(l.numero).split('-L').pop(), 10);
      if (!isNaN(m) && m > maxSeq) maxSeq = m;
    }

    for (const [p, cant] of prodCant) {
      if (prodsConLote.has(norm(p))) continue; // ya tiene lotes
      const clones = [];
      for (const t of tpl) {
        maxSeq++;
        const completo = norm(t.estado) === 'COMPLETADO';
        clones.push({
          _oldId: t.id,
          _parentOld: t.lote_padre_id,
          numero: `${o.numero}-L${maxSeq}`,
          orden_id: o.id,
          tipo_lote: t.tipo_lote,
          producto: p,
          cantidad: cant,
          departamento: t.departamento,
          tecnica: t.tecnica,
          tipo_ejecucion: t.tipo_ejecucion,
          orden_ejecucion: t.orden_ejecucion,
          estado: t.estado,
          desbloquear_al: t.desbloquear_al,
          tipo: t.tipo,
          tarea_nombre: t.tarea_nombre,
          aplicaciones_por_pieza: 1,
          responsable: completo ? t.responsable : null,
          piezas_ok: completo ? cant : null,
          tiempo_inicio: completo ? t.tiempo_inicio : null,
          tiempo_fin: completo ? t.tiempo_fin : null,
        });
      }
      plan.push({ orden: o, clones });
      const comp = clones.filter((c) => norm(c.estado) === 'COMPLETADO');
      resumen.push({
        orden: o.numero,
        estado: o.estado,
        producto: p,
        cantidad: cant,
        lotes: clones.length,
        completados: comp.length,
        responsable: comp.find((c) => c.responsable)?.responsable || '—',
      });
    }
  }

  const totalClones = plan.reduce((s, g) => s + g.clones.length, 0);
  const ordenesTocadas = new Set(resumen.map((r) => r.orden)).size;

  console.log(`\n=== PLAN RETROACTIVO (${DRY ? 'DRY-RUN' : 'EJECUCIÓN'}) ===`);
  console.log(`Órdenes a tocar: ${ordenesTocadas} · productos: ${resumen.length} · lotes a crear: ${totalClones}\n`);
  for (const r of resumen) {
    console.log(
      `${r.orden.padEnd(12)} [${r.estado.padEnd(14)}] + ${r.producto.slice(0, 38).padEnd(40)} ` +
      `cant ${String(r.cantidad).padStart(4)} → ${r.lotes} lotes (${r.completados} compl.) resp:${r.responsable}`,
    );
  }

  if (DRY) {
    console.log('\n*** DRY-RUN — no se insertó nada. Ejecuta con DRY=0 para aplicar. ***');
    await conn.end();
    return;
  }

  await conn.beginTransaction();
  try {
    let inserted = 0;
    for (const grp of plan) {
      const oldToNew = new Map();
      for (const c of grp.clones) {
        let parentNew = c._parentOld != null && oldToNew.has(c._parentOld)
          ? oldToNew.get(c._parentOld)
          : null;
        let estado = c.estado;
        // Un lote pendiente sin padre nunca se desbloquearía (su padre era el
        // diseño, que no se clona). Lo dejamos desbloqueado para que sea trabajable.
        if (parentNew === null && norm(estado) === 'PENDIENTE') estado = 'desbloqueado';
        const [res] = await conn.query(
          `INSERT INTO lotes_produccion
             (numero, orden_id, tipo_lote, producto, cantidad, departamento, tecnica,
              tipo_ejecucion, orden_ejecucion, lote_padre_id, estado, desbloquear_al,
              tipo, tarea_nombre, aplicaciones_por_pieza, responsable, piezas_ok,
              tiempo_inicio, tiempo_fin, notas)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            c.numero, c.orden_id, c.tipo_lote, c.producto, c.cantidad, c.departamento,
            c.tecnica, c.tipo_ejecucion, c.orden_ejecucion, parentNew, estado,
            c.desbloquear_al, c.tipo, c.tarea_nombre, c.aplicaciones_por_pieza,
            c.responsable, c.piezas_ok, c.tiempo_inicio, c.tiempo_fin,
            'Lote retroactivo (fix multi-producto jun-2026): producto omitido al configurar la ruta.',
          ],
        );
        oldToNew.set(c._oldId, res.insertId);
        inserted++;
      }
    }
    await conn.commit();
    console.log(`\n✓ Insertados ${inserted} lotes en ${ordenesTocadas} órdenes.`);
  } catch (e) {
    await conn.rollback();
    console.error('ERROR — rollback:', e.message);
    process.exitCode = 1;
  }
  await conn.end();
})();
