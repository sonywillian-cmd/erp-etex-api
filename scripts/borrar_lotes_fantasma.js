// Borra los lotes FANTASMA creados por el retroactivo: lotes (depto o tarea)
// con nota "retroactivo" cuyo PRODUCTO no usa esa técnica (normalizada). Re-apunta
// los hijos al ancestro válido más cercano y respalda antes.
//
// Uso:  DRY=1 node borrar_lotes_fantasma.js   (preview)
//       DRY=0 node borrar_lotes_fantasma.js   (aplica)

const mysql = require('mysql2/promise');
const fs = require('fs'); const path = require('path');
const DRY = process.env.DRY !== '0';
function loadEnv(file){const e={};for(const l of fs.readFileSync(file,'utf8').split('\n')){const m=l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);if(!m)continue;let v=m[2];if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);e[m[1]]=v;}return e;}
const ENV = loadEnv(path.join(__dirname,'..','.env.production'));
const up = s => (s??'').toString().toUpperCase().trim();
function normDept(s){const x=up(s);if(!x)return '';if(x.includes('DTF'))return 'DTF';if(x.startsWith('CONFECCION'))return 'CONFECCION';if(x.startsWith('SUBLIMAC'))return 'SUBLIMACION';if(x.startsWith('BORDADO'))return 'BORDADO';if(x.startsWith('DISEÑO')||x.startsWith('DISENO')||x.startsWith('REDISE'))return 'DISENO';if(x.startsWith('TERMINAC'))return 'TERMINACION';return x;}
const ORDER_LEVEL = new Set(['DISENO','TERMINACION']);

(async()=>{
  const conn = await mysql.createConnection({ socketPath: ENV.DB_SOCKET||'/var/lib/mysql/mysql.sock', user:ENV.DB_USER, password:ENV.DB_PASS, database:ENV.DB_NAME });
  const [ordenes] = await conn.query('SELECT id, numero, lineas_produccion FROM ordenes_produccion');
  const [lotes] = await conn.query('SELECT * FROM lotes_produccion');
  const byId = new Map(lotes.map(l=>[l.id,l]));
  const linesByOrden = new Map();
  for (const o of ordenes){
    let ls=[]; try{ ls = typeof o.lineas_produccion==='string'?JSON.parse(o.lineas_produccion):(o.lineas_produccion||[]); }catch{ ls=[]; }
    const prodDepts = new Map();
    for (const ln of (Array.isArray(ls)?ls:[])){
      const p=up(ln.producto); if(!prodDepts.has(p))prodDepts.set(p,new Set());
      const set=prodDepts.get(p);
      for (const t of (Array.isArray(ln.tecnicas_aplicadas)?ln.tecnicas_aplicadas:[])){ const d=normDept(t?.departamento_nombre||t?.nombre); if(d)set.add(d); }
      for (const part of String(ln.tecnica||'').split(',')){ const d=normDept(part); if(d)set.add(d); }
    }
    linesByOrden.set(o.id, prodDepts);
  }

  // phantom = nota retro + producto NO usa esa técnica (y no es nivel orden)
  const phantom = new Set();
  for (const l of lotes){
    if (!/retroactiv/i.test(String(l.notas||''))) continue;
    const nd = normDept(l.departamento);
    if (!nd || ORDER_LEVEL.has(nd)) continue;
    const prodDepts = linesByOrden.get(l.orden_id); if(!prodDepts) continue;
    const prods = String(l.producto||'').split(',').map(p=>up(p)).filter(Boolean);
    const usa = prods.some(p=>{const s=prodDepts.get(p);return s&&s.has(nd);});
    if (!usa) phantom.add(l.id);
  }

  // ancestro válido más cercano (saltando phantom)
  function validParent(id){ let p = byId.get(id)?.lote_padre_id ?? null; while(p!=null && phantom.has(p)) p = byId.get(p)?.lote_padre_id ?? null; return p; }
  const reparent = [];
  for (const l of lotes){ if (l.lote_padre_id!=null && phantom.has(l.lote_padre_id) && !phantom.has(l.id)){ reparent.push({ id:l.id, newParent: validParent(l.lote_padre_id) }); } }

  // resumen por operario (solo completados, dept-level, MAX espejo ya colapsado: contamos dept lotes)
  const infl = {};
  for (const id of phantom){ const l=byId.get(id); if(l.estado==='completado' && (l.tipo??'departamento')==='departamento' && l.responsable && Number(l.piezas_ok)>0){ infl[l.responsable]=(infl[l.responsable]||0)+Number(l.piezas_ok)*Number(l.aplicaciones_por_pieza||1); } }

  console.log(`\n=== BORRAR LOTES FANTASMA (${DRY?'DRY-RUN':'EJECUCIÓN'}) ===`);
  console.log(`Fantasma a borrar (depto+tarea): ${phantom.size} | hijos a re-apuntar: ${reparent.length}`);
  console.log(`Corrección de conteo por operario:`, infl);
  const arr=[...phantom].map(id=>byId.get(id)).sort((a,b)=>a.orden_id-b.orden_id);
  for (const l of arr) console.log(`  L#${l.id} o#${l.orden_id} ${l.departamento}/${l.tipo} "${String(l.producto).slice(0,30)}" ${l.estado} pzs:${l.piezas_ok??'-'} resp:${l.responsable??'-'}`);

  if (DRY){ console.log('\n*** DRY-RUN — nada borrado. DRY=0 para aplicar. ***'); await conn.end(); return; }

  const BK = 'lotes_bkp_fantasma_' + (ENV.STAMP || 'run');
  await conn.beginTransaction();
  try{
    // respaldo de las filas a borrar
    const ids=[...phantom];
    await conn.query(`CREATE TABLE \`${BK}\` AS SELECT * FROM lotes_produccion WHERE id IN (${ids.map(()=>'?').join(',')})`, ids);
    for (const r of reparent){ await conn.query('UPDATE lotes_produccion SET lote_padre_id=? WHERE id=?', [r.newParent, r.id]); }
    await conn.query(`DELETE FROM lotes_produccion WHERE id IN (${ids.map(()=>'?').join(',')})`, ids);
    await conn.commit();
    console.log(`\n✓ Borrados ${ids.length} lotes fantasma. Respaldo: ${BK}`);
  }catch(e){ await conn.rollback(); console.error('ERROR — rollback:', e.message); process.exitCode=1; }
  await conn.end();
})();
