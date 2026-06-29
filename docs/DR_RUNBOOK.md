# Runbook de Recuperación ante Desastres — E-Tex 360 ERP

> **Audiencia**: Administrador del sistema (Sony Rosario o sustituto técnico).
> **Última actualización**: 2026-06-04
> **Tiempo objetivo de recuperación (RTO)**: 4 horas
> **Pérdida máxima aceptable de datos (RPO)**: 24 horas (último backup diario)

---

## 1. ¿Qué hacer cuando "el ERP no funciona"?

**Antes de nada: identifica qué está caído.**

| Síntoma | Probable causa | Sección |
|---------|----------------|---------|
| Web carga blanca / "Cannot GET /" | Frontend caído | §3.1 |
| Web carga pero API tira 500 | Backend caído | §3.2 |
| Login falla con "credenciales inválidas" | DB caída o JWT mal | §3.3 |
| Bot Telegram no responde | Bot caído | §3.4 |
| Toda la URL no carga | DNS / Hostinger caído | §4 |
| Datos perdidos / corruptos | Restaurar backup | §5 |
| VPS completamente perdido | Reconstrucción total | §6 |

---

## 2. Diagnóstico inicial (5 minutos)

### 2.1 Healthcheck remoto (desde cualquier navegador)

```
https://api.etex360.com/api/v1/health
```

Deberías ver JSON tipo:
```json
{
  "status": "ok",
  "checks": {
    "api":     {"status": "ok"},
    "database":{"status": "ok", "latency_ms": 2},
    "disk":    {"status": "ok", "usado_pct": 57},
    "memoria": {"status": "ok", "usado_pct": 63},
    "backups": {"status": "ok", "horas_desde": 1}
  }
}
```

- `status: "ok"` → API y DB funcionando, solo es un problema de frontend o red.
- `status: "degraded"` → algo no crítico falla (backup viejo, disco lleno).
- `status: "down"` o **sin respuesta** → API caída o DB caída. Ve a §3.2.

### 2.2 SSH al VPS

```bash
ssh erp-vps
# Equivale a: ssh u372536694@xxx.hostinger.com -p 65002
```

Si SSH no conecta → es problema de Hostinger / red. Ve a §4.

Una vez dentro, chequea PM2:
```bash
export PATH=$PATH:/home/u372536694/.nvm/versions/node/v22.22.2/bin
pm2 status
```

Deberías ver 4 procesos `online`:
- `erp-api` (puerto 3001)
- `erp-frontend` (puerto 3000)
- `erp-telegram-bot`
- `erp-backup-scheduler`

Cualquier proceso en `errored` o `stopped` → §3.

---

## 3. Recuperación por componente

### 3.1 Frontend caído

```bash
pm2 restart erp-frontend
pm2 logs erp-frontend --lines 50 --nostream
```

Si reinicia OK → listo.
Si tira error de build / falta dependencia:
```bash
cd /home/u372536694/apps/frontend
npm ci --production
pm2 restart erp-frontend
```

Si sigue fallando → restaurar desde git:
```bash
cd /home/u372536694/apps/frontend
git status
git diff HEAD~1   # revisar último cambio
git checkout HEAD~1 -- .next/  # rollback al build anterior
pm2 restart erp-frontend
```

### 3.2 Backend (API) caído

```bash
pm2 restart erp-api
pm2 logs erp-api --lines 50 --nostream
```

Errores comunes y solución:

| Error | Causa | Solución |
|-------|-------|----------|
| `ECONNREFUSED 127.0.0.1:3306` | MariaDB caída | Contactar Hostinger soporte |
| `ER_ACCESS_DENIED_ERROR` | Cambió contraseña DB | Revisar `/home/u372536694/apps/api/.env` y restaurar `DB_PASS` |
| `Cannot find module './xxx/xxx.module'` | dist/ incompleto | Ver §3.2.1 |
| `EADDRINUSE :::3001` | Otro proceso usando puerto | `lsof -i :3001` y `kill <pid>` |

#### 3.2.1 Restaurar dist/ del API desde git

```bash
cd /home/u372536694/apps/api
git status
git log --oneline | head -5

# Si dist/ está roto, volver al último commit conocido:
git checkout HEAD -- dist/
pm2 restart erp-api
```

#### 3.2.2 Reinstalar node_modules

Si falta una dependencia (poco común):
```bash
cd /home/u372536694/apps/api
npm ci --production
pm2 restart erp-api
```

### 3.3 DB inaccesible

MariaDB la administra Hostinger; **no podemos reiniciarla nosotros**.

1. Verificar conectividad desde el VPS:
   ```bash
   mysql -h $DB_HOST -u $DB_USER -p$DB_PASS -e "SELECT 1"
   ```
2. Si conecta → el problema es del API, no de la DB. Vuelve a §3.2.
3. Si NO conecta → abrir ticket urgente en **panel Hostinger → Soporte**.
   Mientras tanto, **NO** intentes restaurar backup encima (los datos pueden estar OK).

### 3.4 Bot Telegram caído

```bash
pm2 restart erp-telegram-bot
pm2 logs erp-telegram-bot --lines 50 --nostream
```

Si tira `401 Unauthorized` → el token del bot fue revocado. Generar nuevo con `@BotFather` y actualizar `TELEGRAM_BOT_TOKEN` en `/home/u372536694/apps/telegram-bot/.env`.

---

## 4. Hostinger / red caída

**No hay nada que podamos hacer técnicamente.** Acciones operacionales:

1. **Avisar a operación**: por WhatsApp al equipo (Ana, Moisés, Yelin) que el ERP estará caído temporalmente.
2. **Operación manual**:
   - Pedidos: anotar en libreta física con `Cliente | Detalle | Monto | Fecha`.
   - Facturas: usar talonario físico de NCF (B0100003486 en adelante, ver §7).
   - Pagos: anotar y registrar después.
3. **Monitor**: revisar https://www.hostinger-status.com/ cada 30 min.
4. **Contacto Hostinger**: chat 24/7 en el panel de Hostinger.

---

## 5. Restaurar desde backup

### 5.1 Identificar el backup a restaurar

Los backups están en `/home/u372536694/backups/erp_backup_YYYYMMDD_HHMMSS.tar.gz` y también offsite en el chat de Telegram del admin (`5013252774`).

```bash
ls -lt /home/u372536694/backups/erp_backup_*.tar.gz | head -5
```

### 5.2 Restaurar SOLO la base de datos

```bash
cd /tmp
cp /home/u372536694/backups/erp_backup_YYYYMMDD_HHMMSS.tar.gz .
tar xzf erp_backup_YYYYMMDD_HHMMSS.tar.gz
# Dentro hay: db.sql.gz, uploads.tar.gz, env-snapshot.txt

# Verificar tamaño esperado del dump (deberia ser > 1MB)
ls -lh db.sql.gz

# Restaurar (DESTRUCTIVO: borra datos actuales)
gunzip -c db.sql.gz | mysql -h $DB_HOST -u $DB_USER -p$DB_PASS $DB_NAME
```

⚠️ **Antes de restaurar**: tomar un backup del estado actual por si la decisión fue equivocada:
```bash
/home/u372536694/scripts/backup-erp.sh
```

### 5.3 Restaurar uploads (fotos, PDFs)

```bash
cd /home/u372536694/apps/api
mv uploads uploads.dañado-$(date +%s)
tar xzf /tmp/uploads.tar.gz
```

### 5.4 Restaurar desde backup offsite (Telegram)

Si los backups locales se perdieron:
1. Abrir el chat de admin de Telegram (`5013252774`)
2. Bajar el último `.tar.gz` que envió el bot
3. Subir al VPS:
   ```bash
   scp ~/Downloads/erp_backup_*.tar.gz erp-vps:/tmp/
   ```
4. Seguir desde §5.2.

---

## 6. Reconstrucción total (VPS perdido)

Escenario peor: el VPS está completamente perdido y hay que reconstruir en otro.

### 6.1 Snapshot offline (preventivo, hoy mismo)

En la máquina del admin, descargar:
- `C:\backups-erp\snapshot-VPS-2026-06-04.tar.gz` (~80MB sin node_modules)
- Contiene: `api/`, `frontend/`, `telegram-bot/`, `scripts/`

### 6.2 Provisionar nuevo VPS

1. Cualquier VPS Linux con Node 22+ y MariaDB.
2. Crear usuario `u372536694` (o el que sea).
3. Subir snapshot a `/home/<usuario>/apps/`.
4. Para cada app (api, frontend, telegram-bot):
   ```bash
   cd /home/<usuario>/apps/<app>
   npm ci
   ```
5. Restaurar último backup de DB (§5.2).
6. Configurar `.env` con credenciales del nuevo VPS.
7. Lanzar con PM2:
   ```bash
   cd /home/<usuario>/apps
   pm2 start ecosystem.config.js
   pm2 save
   ```
8. Apuntar DNS de `etex360.com` y `api.etex360.com` al IP del nuevo VPS.

---

## 7. Información crítica de contacto y referencia

### 7.1 Credenciales y accesos

| Recurso | Dónde | Notas |
|---------|-------|-------|
| Hostinger panel | hostinger.com → cuenta de Sony | Login con email Sony |
| Cloudflare / DNS | si aplica | — |
| SSH al VPS | `ssh erp-vps` | Llave en `~/.ssh/` del admin |
| MariaDB | en `/home/u372536694/apps/api/.env` | `DB_HOST`, `DB_USER`, `DB_PASS`, `DB_NAME` |
| Bot Telegram | en `/home/u372536694/apps/telegram-bot/.env` | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_SHARED_SECRET` |
| Chat admin Telegram | `5013252774` | Recibe alertas + backups offsite |

### 7.2 NCFs en uso (DGII)

| Tipo | Rango asignado | Próxima a usar |
|------|----------------|----------------|
| B01 (Crédito fiscal) | B0100000001 → B0199999999 | revisar `secuencias_ncf` en DB |
| B02 (Consumidor final) | B0200000001 → B0299999999 | idem |
| B14 (Régimen especial) | B1400000001 → B1499999999 | idem |
| B15 (Gubernamental) | B1500000001 → B1599999999 | idem |
| PROFORMA | sin rango fiscal | numeración interna |

```sql
SELECT tipo, prefijo, actual, hasta, vigente_hasta FROM secuencias_ncf ORDER BY tipo;
```

### 7.3 Contactos urgentes

- **Hostinger 24/7**: chat en panel (responde en minutos)
- **DGII**: 809-689-2181 (atención al contribuyente)
- **Banco BHD** (cuenta operativa): 809-243-3232

---

## 8. Procedimientos preventivos (mensuales)

- [ ] Verificar `/api/v1/health` está `ok` en los 5 checks
- [ ] Probar restaurar el backup más reciente en una BD de pruebas
- [ ] Verificar que el bot Telegram envió backup ayer (chat `5013252774`)
- [ ] Descargar snapshot offline a `C:\backups-erp\`
- [ ] Revisar `pm2 logs erp-api --lines 200` por errores recurrentes
- [ ] `git log` en los 3 repos del VPS — confirmar que cambios están commiteados

---

## 9. Resumen "tarjeta de bolsillo"

```
ERP CAÍDO → 1. https://api.etex360.com/api/v1/health
            2. ssh erp-vps && pm2 status
            3. pm2 restart erp-api (o el proceso caído)
            4. pm2 logs erp-api --lines 50
            5. Si no resuelve → §3.X según síntoma
            6. Si DB caída → ticket Hostinger (no se restaura desde aquí)
            7. Datos perdidos → §5 (restaurar backup)
```

Cualquier acción **destructiva** (restaurar DB, `git reset --hard`, `rm -rf`) debe ir precedida de un backup manual:
```bash
/home/u372536694/scripts/backup-erp.sh
```
