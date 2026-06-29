// READ-ONLY v2: audita lotes de producción "espurios" (técnica que el producto
// NO usa), usando el mapeo real de cada línea (tecnicas_aplicadas.departamento_nombre
// + técnica) y NORMALIZANDO sinónimos de departamento para evitar falsos positivos:
//   - IMPRESION DTF / SERIGRAFIA DTF  -> "DTF" (ambos son pasos del proceso DTF)
//   - CONFECCION / CONFECCIONES       -> "CONFECCION"
//   - SUBLIMAC*                       -> "SUBLIMACION"
//   - BORDADO*                        -> "BORDADO"
// Ignora DISEÑO* y TERMINAC* (son a nivel orden, aplican siempre).

const mysql = require('mysql2/promise');
const fs = require('fs'); const path = require('path');
function loadEnv(file){const e={};for(const l of fs.readFileSync(file,'utf8').split('\n')){const m=l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);if(!m)continue;let v=m[2];if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);e[m[1]]=v;}return e;}
const ENV = loadEnv(path.join(__dirname,'..','.env.production'));

const up = s => (s??'').toString().toUpperCase().trim();
function normDept(s){
  const x = up(s);
  if (!x) return '';
  if (x.includes('DTF')) return 'DTF';
  if (x.startsWith('CONFECCION')) return 'CONFECCION';
  if (x.startsWith('SUBLIMAC')) return 'SUBLIMACION';
  if (x.startsWith('BORDADO')) return 'BORDADO';
  if (x.startsWith('DISEÑO')||x.startsWith('DISENO')||x.startsWith('REDISE')) return 'DISENO';
  if (x.startsWith('TERMINAC')) return 'TERMINACION';
  return x;
}
const ORDER_LEVEL = new Set(['DISENO','TERMINACION']);

(async()=>{
  const conn = await mysql.createConnection({ socketPath: ENV.DB_SOCKET||'/var/lib/mysql/mysql.sock', user:ENV.DB_USER, password:ENV.DB_PASS, database:ENV.DB_NAME });
  const [ordenes] = await conn.query('SELECT id, numero, estado, lineas_produccion FROM ordenes_produccion');
  const [lotes] = await conn.query('SELECT * FROM lotes_produccion');
  const byOrden = new Map();
  for (const l of lotes){ if(!byOrden.has(l.orden_id))byOrden.set(l.orden_id,[]); byOrden.get(l.orden_id).push(l); }

  const espurios = []; const porEstadoOrden = {}; const inflacionResp = {};

  for (const o of ordenes){
    let lineas=[]; try{ lineas = typeof o.lineas_produccion==='string'?JSON.parse(o.lineas_produccion):(o.lineas_produccion||[]); }catch{ lineas=[]; }
    if(!Array.isArray(lineas)||!lineas.length) continue;

    // producto(normalizado) -> set de departamentos(normalizados) que usa
    const prodDepts = new Map();
    for (const ln of lineas){
      const p = up(ln.producto);
      if (!prodDepts.has(p)) prodDepts.set(p, new Set());
      const set = prodDepts.get(p);
      // de tecnicas_aplicadas
      const tecs = Array.isArray(ln.tecnicas_aplicadas)?ln.tecnicas_aplicadas:[];
      for (const t of tecs){ const d=normDept(t?.departamento_nombre||t?.nombre); if(d) set.add(d); }
      // de la cadena tecnica "A, B"
      for (const part of String(ln.tecnica||'').split(',')){ const d=normDept(part); if(d) set.add(d); }
    }

    const SOLO_RETRO = process.env.RETRO === '1';
    const ls = (byOrden.get(o.id)||[]).filter(l => (l.tipo??'departamento')==='departamento' && l.estado!=='cancelado'
      && (!SOLO_RETRO || /retroactiv/i.test(String(l.notas||''))));
    for (const lote of ls){
      const nd = normDept(lote.departamento);
      if (!nd || ORDER_LEVEL.has(nd)) continue; // diseño/terminación: nivel orden
      const prods = String(lote.producto||'').split(',').map(p=>up(p)).filter(Boolean);
      // ¿algún producto del lote realmente usa este departamento?
      const usa = prods.some(p => { const set = prodDepts.get(p); return set && set.has(nd); });
      if (!usa){
        espurios.push({ orden:o.numero, estadoOrden:o.estado, id:lote.id, dep:lote.departamento, nd, producto:String(lote.producto).slice(0,38), cant:Number(lote.cantidad), estadoLote:lote.estado, piezas:lote.piezas_ok, resp:lote.responsable });
        porEstadoOrden[o.estado]=(porEstadoOrden[o.estado]||0)+1;
        if (lote.estado==='completado' && lote.responsable && Number(lote.piezas_ok)>0){
          const k = lote.responsable;
          inflacionResp[k] = (inflacionResp[k]||0) + Number(lote.piezas_ok)*Number(lote.aplicaciones_por_pieza||1);
        }
      }
    }
  }

  console.log(`\n=== AUDITORÍA v2 — lotes ESPURIOS (producto NO usa esa técnica) ===`);
  console.log(`Total lotes espurios: ${espurios.length}`);
  console.log(`Por estado de orden:`, porEstadoOrden);
  const compl = espurios.filter(e=>e.estadoLote==='completado');
  console.log(`Completados (inflaron conteo): ${compl.length}`);
  console.log(`Inflación por operario (piezas fantasma):`, inflacionResp);
  console.log(`\n--- detalle (${Math.min(espurios.length,60)} de ${espurios.length}) ---`);
  for (const e of espurios.slice(0,60)) console.log(`  ${e.orden} [${e.estadoOrden}] L#${e.id} ${e.dep} prod="${e.producto}" cant ${e.cant} lote:${e.estadoLote} pzs:${e.piezas??'-'} resp:${e.resp??'-'}`);
  await conn.end();
})();
