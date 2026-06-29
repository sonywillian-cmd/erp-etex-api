#!/bin/bash
# ── Watchdog de pm2 para E-Tex ───────────────────────────────────────────────
# Si erp-api no está "online" (o pm2 se vació / el host reinició), restaura los
# procesos desde el dump guardado. Pensado para hosting sin sudo/systemd.
# Se ejecuta por cron cada pocos minutos y en @reboot.
export PATH=/home/u372536694/.nvm/versions/node/v22.22.2/bin:$PATH
LOG=/home/u372536694/apps/pm2-watchdog.log
NODE=/home/u372536694/.nvm/versions/node/v22.22.2/bin/node

ONLINE=$(pm2 jlist 2>/dev/null | "$NODE" -e "
let d='';
process.stdin.on('data',c=>d+=c).on('end',()=>{
  try { const a=JSON.parse(d); const x=a.find(p=>p.name==='erp-api');
        process.stdout.write(x && x.pm2_env && x.pm2_env.status==='online' ? '1':'0'); }
  catch(e){ process.stdout.write('0'); }
});" 2>/dev/null)

if [ "$ONLINE" != "1" ]; then
  echo "$(date '+%F %T') watchdog: erp-api NO online → pm2 resurrect" >> "$LOG"
  pm2 resurrect >> "$LOG" 2>&1
fi
