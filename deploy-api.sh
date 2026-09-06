#!/bin/bash
# Deploy de la API E-Tex 360: compila desde src, sube el dist completo, verifica y reinicia
# TODAS las instancias (pm2 erp-api*). Desde el 6-sep-2026 src == dist, así que el dist entero
# se puede reemplazar sin riesgo de perder código "solo-en-servidor".
#
#   bash deploy-api.sh                 → compila y despliega
#   bash deploy-api.sh --sin-build     → despliega el dist ya compilado
#
# Servidor por variables (valores por defecto = servidor actual de E-Tex):
#   DEPLOY_SSH=erp-vps (alias de ~/.ssh/config)  DEPLOY_API_DIR=~/apps/api
set -e
cd "$(dirname "${BASH_SOURCE[0]}")"
SSH="${DEPLOY_SSH:-erp-vps}"
API_DIR="${DEPLOY_API_DIR:-apps/api}"          # relativo al home del usuario remoto
[ "${1:-}" = "--sin-build" ] || { echo "Compilando…"; rm -f tsconfig.build.tsbuildinfo; rm -rf dist; npx nest build; }
[ -f dist/main.js ] || { echo "No hay dist/main.js"; exit 1; }
N=$(find dist -name "*.js" | wc -l); echo "dist: $N archivos js"
tar czf /tmp/deploy_api_dist.tgz dist
reintento() { for i in 1 2 3 4; do "$@" && return 0; echo "  reintento $i…"; sleep 15; done; return 1; }
reintento scp -o ConnectTimeout=25 /tmp/deploy_api_dist.tgz "$SSH:/tmp/deploy_api_dist.tgz"
reintento ssh -o ConnectTimeout=25 "$SSH" "set -e; . ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use 22 >/dev/null 2>&1 || true
  cd ~/$API_DIR
  TS=\$(date +%Y%m%d_%H%M%S)
  tar czf dist_bak_\$TS.tgz dist && echo '  respaldo: dist_bak_'\$TS'.tgz'
  rm -rf dist.new && mkdir dist.new && tar xzf /tmp/deploy_api_dist.tgz -C dist.new && rm -rf dist.old && mv dist dist.old && mv dist.new/dist dist && rm -rf dist.new
  # Todo require() del dist debe resolver ANTES de reiniciar (deps de módulos, ver memoria caso 4)
  grep -rhoE 'require\(\"[^\"./][^\"]*\"\)' dist --include=*.js | sed -E 's/require\(\"([^\"]+)\"\)/\1/' | sed -E 's#^(@[^/]+/[^/]+|[^/]+).*#\1#' | sort -u > /tmp/reqs.txt
  node -e 'const b=[];for(const m of require(\"fs\").readFileSync(\"/tmp/reqs.txt\",\"utf8\").split(\"\\n\").filter(Boolean)){if(require(\"module\").builtinModules.includes(m)||m.startsWith(\"node:\"))continue;try{require.resolve(m)}catch(e){b.push(m)}}if(b.length){console.error(\"FALTAN dependencias: \"+b.join(\", \"));process.exit(1)}console.log(\"  dependencias OK\")'
  for app in \$(pm2 jlist | node -e 'const l=JSON.parse(require(\"fs\").readFileSync(0,\"utf8\"));console.log(l.filter(a=>/^erp-api/.test(a.name)).map(a=>a.name).join(\" \"))'); do pm2 restart \$app --update-env >/dev/null && echo \"  reiniciado \$app\"; done
  sleep 8; pm2 list | grep -E 'erp-api'
  rm -rf dist.old"
echo "=== Deploy API completado ==="
