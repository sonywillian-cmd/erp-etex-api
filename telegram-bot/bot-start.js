/**
 * Arranque del bot: lee su configuración desde Ajustes del ERP (token, Gemini, nombre,
 * activo) usando el secreto compartido, y solo entonces carga bot.js.
 *
 * - Si Ajustes no tiene valores, se usan los del .env (compatibilidad).
 * - Cada 60 s comprueba si la configuración cambió; si cambió, termina el proceso
 *   y pm2 lo vuelve a levantar con los valores nuevos.
 * - Si el bot está desactivado en Ajustes, queda a la espera sin conectarse a Telegram.
 */
require('dotenv').config({ path: process.env.ENV_FILE || '.env' });   // ENV_FILE: un .env por instancia
const axios = require('axios');

const API    = (process.env.ERP_API_URL || '').replace(/\/$/, '');
const SECRET = process.env.TELEGRAM_BOT_SHARED_SECRET;
if (!API || !SECRET) { console.error('FATAL: faltan ERP_API_URL o TELEGRAM_BOT_SHARED_SECRET en el .env'); process.exit(1); }

const espera = (ms) => new Promise(r => setTimeout(r, ms));

async function cargarConfig() {
  const r = await axios.get(`${API}/telegram/bot/config`, { headers: { 'x-bot-secret': SECRET }, timeout: 15000 });
  return r.data || {};
}

(async () => {
  let cfg = null;
  for (let i = 1; i <= 10 && !cfg; i++) {
    try { cfg = await cargarConfig(); }
    catch (e) { console.error(`[config] intento ${i}: ${e.message}`); await espera(6000); }
  }
  if (!cfg) {
    console.error('[config] No se pudo leer la configuración del ERP; se usa el .env');
  } else {
    if (cfg.token)           process.env.TELEGRAM_BOT_TOKEN = cfg.token;
    if (cfg.gemini_api_key)  process.env.GEMINI_API_KEY     = cfg.gemini_api_key;
    if (cfg.gemini_model)    process.env.GEMINI_MODEL       = cfg.gemini_model;
    if (cfg.nombre_empresa)  process.env.BOT_NOMBRE_EMPRESA = cfg.nombre_empresa;
    console.log(`[config] origen: ${cfg.origen || 'ajustes'} · modelo ${process.env.GEMINI_MODEL || '(default)'} · empresa ${process.env.BOT_NOMBRE_EMPRESA || '(sin nombre)'}`);
  }

  if (cfg && cfg.activo === false) {
    console.log('[config] Bot DESACTIVADO en Ajustes. En espera (revisa cada 60 s).');
    setInterval(async () => {
      try { const c = await cargarConfig(); if (c.activo !== false) { console.log('[config] Bot activado en Ajustes; reiniciando.'); process.exit(0); } }
      catch (_) { /* siguiente vuelta */ }
    }, 60000);
    return;
  }

  const version = cfg ? cfg.version : null;
  require('./bot.js');

  setInterval(async () => {
    try {
      const c = await cargarConfig();
      if (c.version !== version) { console.log('[config] La configuración del bot cambió en Ajustes; reiniciando para aplicarla.'); process.exit(0); }
    } catch (_) { /* siguiente vuelta */ }
  }, 60000);
})();
