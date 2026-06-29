/**
 * Scheduler de backups del ERP — se ejecuta como proceso PM2
 * Corre `backup-erp.sh` todos los días a las 3:00 AM (hora del VPS)
 */
const cron = require('node-cron');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const SCRIPT = '/home/u372536694/scripts/backup-erp.sh';
const LOG_DIR = '/home/u372536694/scripts/logs';
fs.mkdirSync(LOG_DIR, { recursive: true });

const log = (msg) => {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}\n`;
  process.stdout.write(line);
  const date = ts.slice(0, 10);
  fs.appendFileSync(`${LOG_DIR}/scheduler-${date}.log`, line);
};

const runBackup = (reason) => {
  log(`▶ Disparando backup (${reason})`);
  exec(`bash ${SCRIPT}`, { maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (stdout) log('STDOUT:\n' + stdout);
    if (stderr) log('STDERR:\n' + stderr);
    if (err) log('❌ ERROR: ' + err.message);
    else log('✅ Backup OK');
  });
};

// Cron schedule: "0 3 * * *" = todos los días a las 3:00 AM
const SCHEDULE = process.env.BACKUP_CRON || '0 3 * * *';
cron.schedule(SCHEDULE, () => runBackup('cron diario 3am'), {
  scheduled: true,
  timezone: 'America/Santo_Domingo',
});

log(`📅 Scheduler iniciado · cron='${SCHEDULE}' · TZ=America/Santo_Domingo`);
log(`📁 Script: ${SCRIPT}`);
log(`📝 Logs: ${LOG_DIR}/scheduler-YYYY-MM-DD.log`);

// Disparar uno al iniciar SI no hay backup hoy todavía (para no perder días si pm2 estaba caído)
const hoy = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const BACKUP_DIR = '/home/u372536694/backups';
try {
  const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith(`erp_backup_${hoy}`));
  if (files.length === 0) {
    log('⚠️ Sin backup de hoy. Ejecutando uno ahora...');
    setTimeout(() => runBackup('inicio sin backup del día'), 10000);  // 10s después
  } else {
    log(`✓ Ya hay ${files.length} backup(s) de hoy. Esperando cron.`);
  }
} catch (e) {
  log('⚠️ No pude verificar backups existentes: ' + e.message);
  setTimeout(() => runBackup('inicio sin verificación'), 10000);
}

// Mantener proceso vivo
setInterval(() => {}, 60000);
