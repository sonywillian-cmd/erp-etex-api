// READ-ONLY: detecta lotes de técnica "espurios" o con cantidad inflada,
// producto de un error: el retro/per-producto clonó la cadena del 1er producto
// para todos, creando lotes de técnicas que ciertos productos NO usan.
//
// Por cada (orden, departamento) de producción (no DISEÑO/TERMINACION):
//   correctCant = suma de líneas cuya técnica incluye ese departamento
//   correctProds = productos de esas líneas
//   - lote ESPURIO  = su(s) producto(s) NO usan esa técnica (correctProds no los cubre)
//   - cantidad MAL  = el lote departamento no suma correctCant

const mysql = require('mysql2/promise');
const fs = require('fs'); const path = require('path');
function loadEnv(file){const e={};for(const l of fs.readFileSync(file,'utf8').split('\n')){const m=l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);if(!m)continue;let v=m[2];if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);e[m[1]]=v;}return e;}
const ENV = loadEnv(path.join(__dirname,'..','.env.production'));
const norm = s => (s??'').toString().toUpperCase().trim();
const esDisTerm = d => { const x=norm(d); return x.startsWith('DISEÑO')||x.startsWith('DISENO')||x.startsWith('REDISEÑO')||x.startsWith('REDISENO')||x.startsWith('TERMINAC'); };

(async()=>{
  const conn = await mysql.createConnection({ socketPath: ENV.DB_SOCKET||'/var/lib/mysql/mysql.sock', user:ENV.DB_USER, password:ENV.DB_PASS, database:ENV.DB_NAME });
  const [ordenes] = await conn.query('SELECT id, numero, estado, lineas_produccion FROM ordenes_produccion');
  const [lotes] = await conn.query('SELECT * FROM lotes_produccion');
  const byOrden = new Map();
  for (const l of lotes){ if(!byOrden.has(l.orden_id))byOrden.set(l.orden_id,[]); byOrden.get(l.orden_id).push(l); }

  const espurios = []; const cantMal = [];
  const estadoCount = {};

  for (const o of ordenes){
    let lineas=[]; try{ lineas = typeof o.lineas_produccion==='string'?JSON.parse(o.lineas_produccion):(o.lineas_produccion||[]); }catch{ lineas=[]; }
    if(!Array.isArray(lineas)||!lineas.length) continue;
    const ls = (byOrden.get(o.id)||[]).filter(l => (l.tipo??'departamento')==='departamento' && !esDisTerm(l.departamento) && l.estado!=='cancelado');
    if(!ls.length) continue;

    // técnica -> {cant, prods}
    const deptosLote = [...new Set(ls.map(l=>norm(l.departamento)))];
    for (const dep of deptosLote){
      const d = dep.toLowerCase();
      const usan = lineas.filter(ln => { const t=(ln.tecnica??'').toLowerCase().trim(); return !!t && (t.includes(d)||d.includes(t)); });
      const correctCant = usan.reduce((s,l)=>s+Number(l.cantidad||0),0);
      const correctProds = new Set(usan.map(l=>norm(l.producto)));
      const lotesDep = ls.filter(l=>norm(l.departamento)===dep);
      for (const lote of lotesDep){
        const loteProds = String(lote.producto||'').split(',').map(p=>norm(p)).filter(Boolean);
        const cubre = loteProds.some(p=>correctProds.has(p));
        if (!cubre || correctCant===0){
          espurios.push({ orden:o.numero, estado:o.estado, id:lote.id, dep, producto:String(lote.producto).slice(0,40), cant:Number(lote.cantidad), estadoLote:lote.estado, piezas:lote.piezas_ok, resp:lote.responsable });
          estadoCount[o.estado]=(estadoCount[o.estado]||0)+1;
        }
      }
      // cantidad del lote departamento (no dividido) vs correctCant
      const deptNoDiv = lotesDep.filter(l=>!String(l.numero).match(/-L\d+-/) && l.lineas_asignadas==null);
      const sumaDept = deptNoDiv.reduce((s,l)=>s+Number(l.cantidad||0),0);
      if (correctCant>0 && deptNoDiv.length>0 && sumaDept!==correctCant){
        cantMal.push({ orden:o.numero, estado:o.estado, dep, sumaActual:sumaDept, correcto:correctCant });
      }
    }
  }

  console.log(`\n=== LOTES ESPURIOS (técnica que el producto NO usa) ===`);
  console.log(`Total: ${espurios.length} | por estado de orden:`, estadoCount);
  const compl = espurios.filter(e=>e.estadoLote==='completado');
  console.log(`De ellos COMPLETADOS (inflaron conteo): ${compl.length}`);
  for (const e of espurios.slice(0,40)) console.log(`  ${e.orden} [${e.estado}] L#${e.id} ${e.dep} prod="${e.producto}" cant ${e.cant} estado:${e.estadoLote} pzs:${e.piezas??'-'} resp:${e.resp??'-'}`);

  console.log(`\n=== CANTIDADES INFLADAS/ERRADAS (lote depto vs líneas reales) ===`);
  console.log(`Total: ${cantMal.length}`);
  for (const c of cantMal.slice(0,40)) console.log(`  ${c.orden} [${c.estado}] ${c.dep}: actual ${c.sumaActual} → correcto ${c.correcto}`);

  await conn.end();
})();
