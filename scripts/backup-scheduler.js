/**
 * Scheduler de backups — proceso pm2 (erp-backup-scheduler).
 * Corre backup-erp.sh todos los días a las 3:00 AM (hora RD) para CADA instancia.
 *
 * Instancias: variable BACKUP_INSTANCIAS = "nombre=/ruta/api.env,otra=/ruta/otra.env".
 * Sin la variable, respalda solo E-Tex con los valores de siempre (~/apps/api/.env).
 */
const cron = require('node-cron');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const SCRIPT  = process.env.BACKUP_SCRIPT || path.join(__dirname, 'backup-erp.sh');
const LOG_DIR = process.env.BACKUP_LOG_DIR || path.join(__dirname, 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });

const log = (msg) => {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}\n`;
  process.stdout.write(line);
  fs.appendFileSync(`${LOG_DIR}/scheduler-${ts.slice(0, 10)}.log`, line);
};

// [{ nombre, env, backupDir, prefijo }]
const instancias = (process.env.BACKUP_INSTANCIAS || '')
  .split(',').map(s => s.trim()).filter(Boolean)
  .map(s => { const [nombre, env] = s.split('='); return { nombre: nombre.trim(), env: (env || '').trim() }; });
if (instancias.length === 0) instancias.push({ nombre: '', env: path.join(os.homedir(), 'apps/api/.env') });

const backupDirDe = (inst) => {
  try {
    const m = fs.readFileSync(inst.env, 'utf8').match(/^BACKUP_DIR=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  } catch (_) { /* sin env */ }
  return path.join(os.homedir(), 'backups');
};

const runBackup = (inst, reason) => {
  const etiqueta = inst.nombre || 'E-Tex';
  log(`▶ Backup ${etiqueta} (${reason})`);
  exec(`bash "${SCRIPT}" "${inst.env}" ${inst.nombre ? `"${inst.nombre}"` : ''}`, { maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (stdout) log(`STDOUT ${etiqueta}:\n` + stdout);
    if (stderr) log(`STDERR ${etiqueta}:\n` + stderr);
    if (err) log(`❌ ERROR ${etiqueta}: ` + err.message); else log(`✅ Backup ${etiqueta} OK`);
  });
};

// Una detrás de otra, separadas 2 minutos, para no cargar el servidor con varios mysqldump a la vez
const runTodas = (reason) => instancias.forEach((inst, i) => setTimeout(() => runBackup(inst, reason), i * 120000));

const SCHEDULE = process.env.BACKUP_CRON || '0 3 * * *';
cron.schedule(SCHEDULE, () => runTodas('cron diario 3am'), { scheduled: true, timezone: 'America/Santo_Domingo' });
log(`📅 Scheduler iniciado · cron='${SCHEDULE}' · TZ=America/Santo_Domingo · instancias: ${instancias.map(i => i.nombre || 'E-Tex').join(', ')}`);
log(`📁 Script: ${SCRIPT} · logs: ${LOG_DIR}`);

// Al iniciar: si a alguna instancia le falta el backup de hoy, se hace ahora (por si pm2 estuvo caído)
const hoy = new Date().toISOString().slice(0, 10).replace(/-/g, '');
instancias.forEach((inst, i) => {
  const prefijo = `erp_backup${inst.nombre ? '_' + inst.nombre : ''}_${hoy}`;
  try {
    const files = fs.readdirSync(backupDirDe(inst)).filter(f => f.startsWith(prefijo));
    if (files.length === 0) { log(`⚠️ ${inst.nombre || 'E-Tex'}: sin backup de hoy, ejecutando…`); setTimeout(() => runBackup(inst, 'inicio sin backup del día'), 10000 + i * 120000); }
    else log(`✓ ${inst.nombre || 'E-Tex'}: ya hay ${files.length} backup(s) de hoy.`);
  } catch (e) {
    log(`⚠️ ${inst.nombre || 'E-Tex'}: no pude verificar (${e.message}); ejecutando…`);
    setTimeout(() => runBackup(inst, 'inicio sin verificación'), 10000 + i * 120000);
  }
});

setInterval(() => {}, 60000);
